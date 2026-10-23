// Hisaab's voice: Gemini text-to-speech (free tier), female, Indian English where available.
//
// Staying free and fast:
//  - Every line is saved to data/tts-cache/ the first time. Repeats (rehearsals, the video's fixed
//    lines) play from disk: no API call, no quota used, no delay.
//  - A daily cap (TTS_DAILY_LIMIT, default 200 API calls) stops us from ever running through the
//    free quota by accident. Over the cap, or on any error/timeout, the page uses the browser voice.
//  - Two free TTS models: if one says "rate limited" (429) we try the other.
// Charges only happen if the Google project behind the key has billing set up; the free tier
// without billing cannot charge.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiKey } from './llm.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE_DIR = path.join(ROOT, 'data', 'tts-cache');

const MODELS = [
  process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts'
].filter((m, i, all) => all.indexOf(m) === i);

// Female prebuilt voices (Gemini's catalog). Sulafat = "Warm". Used if no Indian voice is found.
export const FALLBACK_VOICE = process.env.GEMINI_TTS_VOICE || 'Sulafat';
const STYLE = 'warm, friendly and natural, like a helpful Indian home assistant; a slightly brisk pace';
const STYLE_WITH_ACCENT = `${STYLE}; soft Indian English accent`;
const TIMEOUT_MS = 6000;
const DAILY_LIMIT = Number(process.env.TTS_DAILY_LIMIT || 200);

let usage = { day: '', calls: 0 };
let chosen = null; // { voice, indian } once looked up

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

function countCall() {
  const d = today();
  if (usage.day !== d) usage = { day: d, calls: 0 };
  if (usage.calls >= DAILY_LIMIT) return false;
  usage.calls += 1;
  return true;
}
export const usageToday = () => ({ ...usage, limit: DAILY_LIMIT });

// Ask Gemini's voice library for a female Indian English voice, once. Falls back to Sulafat.
export async function chooseVoice(key = apiKey()) {
  if (chosen) return chosen;
  if (process.env.GEMINI_TTS_VOICE) return (chosen = { voice: FALLBACK_VOICE, indian: false });
  const tries = [
    { language_code: 'en-IN', gender: 'female' },
    { region_code: 'IN', gender: 'female' },
    { accent: 'Indian', gender: 'female' }
  ];
  for (const params of tries) {
    try {
      const q = new URLSearchParams({ ...params, page_size: '20' });
      const r = await fetch(`${API}/voices?${q}`, {
        headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(4000)
      });
      if (!r.ok) continue;
      const body = await r.json();
      const list = body.voices ?? body.items ?? [];
      const pick = list.find((v) => /female/i.test(v.gender ?? 'female') &&
        (/en-IN/i.test(v.language_code ?? v.languageCode ?? '') || /india/i.test(v.accent ?? '') || /IN/.test(v.region_code ?? v.regionCode ?? '')));
      if (pick?.id) {
        chosen = { voice: pick.id, name: pick.display_name ?? pick.displayName ?? pick.id, indian: true };
        console.log(`[tts] voice: ${chosen.name} (Indian English, female)`);
        return chosen;
      }
    } catch { /* try the next filter */ }
  }
  chosen = { voice: FALLBACK_VOICE, indian: false };
  console.log(`[tts] no Indian voice in the library; using ${FALLBACK_VOICE} with an Indian accent style`);
  return chosen;
}

// 16-bit mono PCM -> WAV (in case Gemini ever sends raw PCM).
export function toWav(pcm, sampleRate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function audioFrom(body) {
  const blocks = (body.steps ?? [])
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === 'audio' && c.data);
  const data = blocks.at(-1)?.data
    // older generateContent-style shape, just in case
    ?? body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
  if (!data) throw new Error('Gemini TTS returned no audio');
  const buf = Buffer.from(data, 'base64');
  return buf.subarray(0, 4).toString() === 'RIFF' ? buf : toWav(buf);
}

async function callGemini(text, voice, style, model, key) {
  const r = await fetch(`${API}/interactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model,
      input: [{
        type: 'user_input',
        content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }]
      }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice }] }
    })
  });
  if (!r.ok) {
    const err = new Error(`Gemini TTS ${model} ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  return audioFrom(await r.json());
}

// Returns { wav: Buffer, voice, cached } or throws (the page then uses the browser voice).
export async function synthesize(text) {
  const line = String(text ?? '').trim().slice(0, 600);
  if (!line) throw new Error('nothing to say');
  const key = apiKey();
  if (!key) throw new Error('No Gemini API key');

  const v = await chooseVoice(key);
  const style = v.indian ? STYLE : STYLE_WITH_ACCENT;
  const file = path.join(CACHE_DIR, `${crypto.createHash('sha1').update(`${v.voice}|${style}|${line}`).digest('hex')}.wav`);
  if (fs.existsSync(file)) return { wav: fs.readFileSync(file), voice: v.name ?? v.voice, cached: true };

  let lastError;
  for (const model of MODELS) {
    if (!countCall()) throw new Error(`Daily TTS cap of ${DAILY_LIMIT} reached (keeps us inside the free tier)`);
    try {
      let wav;
      try {
        wav = await callGemini(line, v.voice, style, model, key);
      } catch (e) {
        // Library voice id not accepted? Drop to the prebuilt female voice and remember that.
        if (v.indian && e.status >= 400 && e.status < 500 && e.status !== 429) {
          chosen = { voice: FALLBACK_VOICE, indian: false };
          return synthesize(line);
        }
        throw e;
      }
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, wav);
      return { wav, voice: v.name ?? v.voice, cached: false };
    } catch (e) {
      lastError = e;
      if (e.status !== 429 && e.status !== 404) break; // only rate limits / missing model try the other model
    }
  }
  throw lastError;
}

// Express handler: POST /tts { text } -> audio/wav. Any failure -> 503 and the page speaks with the browser voice.
export async function ttsRoute(req, res) {
  try {
    const { wav, voice, cached } = await synthesize(req.body?.text);
    res.set({ 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Hisaab-Voice': `Gemini (${voice})`, 'X-Hisaab-Cached': String(cached) });
    res.send(wav);
  } catch (e) {
    console.warn('[tts]', e.message);
    res.status(503).json({ error: e.message });
  }
}

export const _reset = () => { usage = { day: '', calls: 0 }; chosen = null; };
