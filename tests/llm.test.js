import test from 'node:test';
import assert from 'node:assert/strict';

import { askLLM, DEFAULT_MODEL, stripFences } from '../src/llm.js';

const KEY_VARS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'];

function clearKeys() {
  for (const name of KEY_VARS) delete process.env[name];
  delete process.env.HISAAB_LLM;
}

async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const reply = (text) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] })
});

test('stripFences removes ```json fences, prose wrappers and leaves plain JSON alone', () => {
  assert.equal(stripFences('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripFences('```\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripFences('Here you go: {"a":1} — done'), '{"a":1}');
  assert.equal(stripFences('  {"a":1}  '), '{"a":1}');
});

test('askLLM sends Gemini a JSON-mode request and returns unfenced text', async () => {
  clearKeys();
  process.env.GEMINI_API_KEY = 'test-key';
  let seen;
  try {
    const text = await withFetch(async (url, options) => {
      seen = { url, options, body: JSON.parse(options.body) };
      return reply('```json\n{"intent":"clarify","args":{}}\n```');
    }, () => askLLM('parse this'));

    assert.equal(text, '{"intent":"clarify","args":{}}');
    assert.match(seen.url, new RegExp(`/models/${encodeURIComponent(DEFAULT_MODEL)}:generateContent$`));
    assert.equal(seen.options.headers['x-goog-api-key'], 'test-key');
    assert.equal(seen.body.generationConfig.responseMimeType, 'application/json');
    assert.equal(seen.body.generationConfig.temperature, 0);
    assert.equal(seen.body.contents[0].parts[0].text, 'parse this');
    assert.ok(seen.options.signal, 'an AbortSignal must be attached for the timeout');
  } finally {
    clearKeys();
  }
});

test('askLLM fails clearly without a key so understand.js can fall back', async () => {
  clearKeys();
  await assert.rejects(() => askLLM('hi'), /No Gemini API key/);
});

test('askLLM reports the 8 second timeout', async () => {
  clearKeys();
  process.env.GEMINI_API_KEY = 'test-key';
  try {
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    await assert.rejects(
      () => withFetch(async () => { throw timeout; }, () => askLLM('hi')),
      /timed out after 8000 ms/
    );
  } finally {
    clearKeys();
  }
});

test('askLLM surfaces HTTP errors with the model and status', async () => {
  clearKeys();
  process.env.GEMINI_API_KEY = 'test-key';
  try {
    await assert.rejects(
      () => withFetch(async () => ({ ok: false, status: 429, text: async () => 'quota exceeded' }), () => askLLM('hi')),
      /returned 429: quota exceeded/
    );
  } finally {
    clearKeys();
  }
});

test('askLLM throws when Gemini returns no text, and HISAAB_LLM=off kills the call', async () => {
  clearKeys();
  process.env.GEMINI_API_KEY = 'test-key';
  try {
    await assert.rejects(
      () => withFetch(async () => reply(''), () => askLLM('hi')),
      /returned no text/
    );
    process.env.HISAAB_LLM = 'off';
    await assert.rejects(() => askLLM('hi'), /disabled by HISAAB_LLM=off/);
  } finally {
    clearKeys();
  }
});
