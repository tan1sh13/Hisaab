import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.GEMINI_API_KEY = 'test-key';
process.env.TTS_DAILY_LIMIT = '3';
const { synthesize, chooseVoice, toWav, usageToday, CACHE_DIR, FALLBACK_VOICE, _reset } = await import('../src/tts.js');

const wavB64 = toWav(Buffer.alloc(480)).toString('base64');
const audioReply = (data = wavB64) => ({
  ok: true, status: 200,
  json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'audio', data }] }] })
});
const fail = (status) => ({ ok: false, status, text: async () => 'nope' });

async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null }); return fake(String(url), calls.length); };
  try { await fn(); } finally { globalThis.fetch = real; }
  return calls;
}
const fresh = () => { _reset(); fs.rmSync(CACHE_DIR, { recursive: true, force: true }); };
test.after(() => fs.rmSync(CACHE_DIR, { recursive: true, force: true }));

test('picks a female Indian English voice from the voice library', async () => {
  fresh();
  await withFetch((url) => ({
    ok: true, status: 200,
    json: async () => ({ voices: [
      { id: 'us-1', gender: 'female', language_code: 'en-US' },
      { id: 'in-7', display_name: 'Meera', gender: 'female', language_code: 'en-IN' }
    ] })
  }), async () => {
    const v = await chooseVoice();
    assert.equal(v.voice, 'in-7');
    assert.equal(v.indian, true);
  });
});

test('no Indian voice -> warm female prebuilt voice with an Indian accent style', async () => {
  fresh();
  const calls = await withFetch((url) => (url.includes('/voices') ? fail(404) : audioReply()), async () => {
    const r = await synthesize('Got it. Shanti did not come today.');
    assert.equal(r.voice, FALLBACK_VOICE);
    assert.equal(r.wav.subarray(0, 4).toString(), 'RIFF');
  });
  const tts = calls.find((c) => c.url.endsWith('/interactions'));
  assert.deepEqual(tts.body.generation_config.speech_config, [{ voice: FALLBACK_VOICE }]);
  assert.match(tts.body.input[0].content[0].annotations[0].style, /Indian English accent/);
  assert.equal(tts.body.response_format.type, 'audio');
});

test('the same line again plays from the saved copy: no API call, no quota used', async () => {
  const before = usageToday().calls;
  const calls = await withFetch(() => { throw new Error('should not be called'); }, async () => {
    const r = await synthesize('Got it. Shanti did not come today.');
    assert.equal(r.cached, true);
  });
  assert.equal(calls.length, 0);
  assert.equal(usageToday().calls, before);
});

test('rate limited (429) on one model -> tries the other free model', async () => {
  const calls = await withFetch((url, n) => (url.includes('/interactions') && n === 1 ? fail(429) : audioReply()), async () => {
    const r = await synthesize('Tomato is usually 30 rupees.');
    assert.equal(r.cached, false);
  });
  const models = calls.filter((c) => c.url.endsWith('/interactions')).map((c) => c.body.model);
  assert.deepEqual(models, ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']);
});

test('daily cap stops API calls (stays inside the free tier); errors make the page use the browser voice', async () => {
  fresh(); // cap is 3 calls a day in this test
  const gemini = (url) => (url.includes('/voices') ? fail(404) : audioReply());
  for (const line of ['One.', 'Two.', 'Three.']) await withFetch(gemini, () => synthesize(line));
  await assert.rejects(() => withFetch(gemini, () => synthesize('Four.')), /Daily TTS cap/);
  // a line already saved still plays after the cap
  await withFetch(gemini, async () => assert.equal((await synthesize('Two.')).cached, true));
});

test('raw PCM from Gemini is wrapped into a playable WAV', async () => {
  fresh();
  process.env.TTS_DAILY_LIMIT = '3';
  await withFetch((url) => (url.includes('/voices') ? fail(404) : audioReply(Buffer.alloc(100).toString('base64'))), async () => {
    const r = await synthesize('Raw audio please.');
    assert.equal(r.wav.subarray(0, 4).toString(), 'RIFF');
    assert.equal(r.wav.length, 144);
  });
});

test('server error -> throws (no silent failure)', async () => {
  fresh();
  await assert.rejects(() => withFetch((url) => (url.includes('/voices') ? fail(404) : fail(500)), () => synthesize('Hello there.')), /500/);
});
