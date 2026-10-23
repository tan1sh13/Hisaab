// Thin Gemini wrapper. One job: send a prompt, get JSON text back.
// - 8 s timeout (guide section 6), so a slow model never stalls the voice demo
// - JSON response mode, plus fence stripping because models still wrap JSON in ```json
// - throws on every failure; understand.js turns a throw into the regex fallback

// Free tier: Flash-Lite allows ~500 requests/day, Flash only ~20/day. So Flash-Lite goes first,
// and when one model is out of quota (429) we use the next one. All of them are free-tier models.
export const DEFAULT_MODEL = 'gemini-3.8-flash-lite';
export const MODELS = [DEFAULT_MODEL, process.env.GEMINI_MODEL, 'gemini-3.8-flash']
  .filter((m, i, all) => m && all.indexOf(m) === i);
const resting = new Map(); // model -> time it may be used again (after a 429)
const REST_MS = 30 * 60 * 1000;
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

// Tries each free model in turn; a model that says "quota exhausted" (429) is skipped for 30 minutes.
export async function askLLM(prompt, options = {}) {
  if (options.model) return askModel(prompt, options);
  const now = Date.now();
  const ready = MODELS.filter((m) => (resting.get(m) ?? 0) <= now);
  let lastError = new Error('All free Gemini models are resting after hitting their daily quota');
  for (const model of ready.length ? ready : MODELS) {
    try {
      return await askModel(prompt, { ...options, model });
    } catch (error) {
      lastError = error;
      if (error.status !== 429 && error.status !== 404) throw error;
      resting.set(model, Date.now() + REST_MS);
      console.warn(`[llm] ${model} is out of free quota (or unavailable); trying the next model`);
    }
  }
  throw lastError;
}
export const _resetModels = () => resting.clear();

async function askModel(prompt, { model = DEFAULT_MODEL, timeoutMs = TIMEOUT_MS, maxOutputTokens = 512, temperature = 0 } = {}) {
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
          temperature,
          maxOutputTokens,
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
    throw Object.assign(new Error(`Gemini ${model} returned ${res.status}: ${body.slice(0, 200)}`), { status: res.status });
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
