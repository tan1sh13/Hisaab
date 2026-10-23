// Thin Gemini wrapper. One job: send a prompt, get JSON text back.
// - 8 s timeout (guide section 6), so a slow model never stalls the voice demo
// - JSON response mode, plus fence stripping because models still wrap JSON in ```json
// - throws on every failure; understand.js turns a throw into the regex fallback

export const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
export const TIMEOUT_MS = 8000;

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const KEY_VARS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'];

export const apiKey = () => {
  for (const name of KEY_VARS) if (process.env[name]) return process.env[name];
  return null;
};

// ```json { ... } ``` -> { ... }. Also keeps a trailing sentence from breaking JSON.parse.
export function stripFences(text) {
  let out = String(text ?? '').trim();
  const fenced = out.match(/^```[a-z]*\s*([\s\S]*?)\s*```$/i);
  if (fenced) out = fenced[1].trim();
  if (!out.startsWith('{')) {
    const start = out.indexOf('{');
    const end = out.lastIndexOf('}');
    if (start !== -1 && end > start) out = out.slice(start, end + 1);
  }
  return out.trim();
}

export async function askLLM(prompt, { model = DEFAULT_MODEL, timeoutMs = TIMEOUT_MS } = {}) {
  if (process.env.HISAAB_LLM === 'off') throw new Error('LLM disabled by HISAAB_LLM=off');

  const key = apiKey();
  if (!key) throw new Error('No Gemini API key. Set GEMINI_API_KEY in .env');
  if (!prompt || typeof prompt !== 'string') throw new Error('askLLM needs a prompt string');

  const url = `${API}/${encodeURIComponent(model)}:generateContent`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 512,
          responseMimeType: 'application/json'
        }
      })
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error(`Gemini timed out after ${timeoutMs} ms`);
    }
    throw new Error(`Gemini request failed: ${error?.message ?? error}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini ${model} returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json().catch(() => null);
  if (!json) throw new Error('Gemini returned a non-JSON HTTP body');
  if (json.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the prompt: ${json.promptFeedback.blockReason}`);
  }

  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part?.text ?? '')
    .join('')
    .trim();
  if (!text) {
    const reason = json.candidates?.[0]?.finishReason ?? 'unknown';
    throw new Error(`Gemini returned no text (finishReason: ${reason})`);
  }

  return stripFences(text);
}
