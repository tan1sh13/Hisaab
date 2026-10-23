// Hisaab page: the "simulated Alexa+". Per utterance: understand -> matching tool -> reply (+ card) -> speak `say`.
// English only.
import { connect, callTool, onLog, MOCK } from './mcp-client.js';
import { toSpeakable } from './speech-text.js';

const $ = (id) => document.getElementById(id);
const chat = $('chat'), log = $('log'), textBox = $('text'), mic = $('mic'), hint = $('hint');
const dateInput = $('demoDate'), dot = $('status'), statusText = $('statusText');
const hood = $('hood'), hoodBtn = $('hoodBtn');

const LANG = 'en';
const SPEECH_LANG = 'en-IN';
// "Today" is the real date in India, unless a demo date is picked in Under the hood
// (the video uses 31 Oct 2026 so the bills cover a whole month).
const realToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
// Tools whose schema takes `date` / `raw` (others would just drop them, but keep the panel tidy).
const TAKES_DATE = new Set(['understand', 'log_helper_event', 'get_bill', 'month_summary', 'log_purchase']);
const TAKES_RAW = new Set(['log_helper_event', 'log_purchase']);
// Small entries get a quiet "Noted ✓" line; everything else gets a full card.
const QUIET = new Set(['log_helper_event', 'add_helper', 'undo_last']);

const EXAMPLES = [
  ['Helpers', 'Shanti did not come today'],
  ['Helpers', 'The milkman gave half a litre extra today'],
  ['Groceries', 'Bought tomatoes at 40 rupees a kilo'],
  ['Bills', 'How much do I owe everyone this month?'],
  ['Prices', 'What is the usual price of tomatoes?'],
  ['Ask', 'How much have I spent on vegetables this month?']
];

// ---- small helpers ----------------------------------------------------------
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
};
const demoDate = () => dateInput.value || realToday();
const rupees = (n) => `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;
const signed = (n) => (n < 0 ? `− ${rupees(-n)}` : rupees(n));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const monthName = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
const prettyDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : String(k));
  return n;
}

function add(node) {
  $('welcome')?.remove(); // starters only show on an empty conversation
  chat.append(node);
  node.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return node;
}
const bubble = (who, text) => add(el('div', { class: `bubble ${who}` }, text));

// ---- under the hood: demo date + MCP panel ----------------------------------
function setHood(open) {
  hood.hidden = !open;
  hoodBtn.setAttribute('aria-expanded', String(open));
  store.set('hisaab.hood', open ? '1' : '');
}
hoodBtn.addEventListener('click', () => setHood(hood.hidden));
$('hoodClose').addEventListener('click', () => setHood(false));

const sentLabel = {}; // request id -> label, so each result names its call
onLog((dir, msg) => {
  const isReq = dir === '→';
  const label = isReq
    ? (msg.method === 'tools/call' ? `tools/call ${msg.params.name}` : msg.method)
    : `result · ${sentLabel[msg.id] ?? `#${msg.id}`}`;
  if (isReq && msg.id != null) sentLabel[msg.id] = label;
  const isErr = !isReq && (msg.error || msg.result?.isError);
  const li = el('li', { class: `${isReq ? 'req' : 'res'}${isErr ? ' error' : ''}` },
    el('div', { class: 'head', onclick: () => li.classList.toggle('collapsed') },
      el('span', { class: 'dir' }, dir), el('span', { class: 'name' }, label),
      el('span', { class: 'time' }, new Date().toLocaleTimeString('en-IN', { hour12: false }))),
    el('pre', {}, prettyRpc(msg)));
  // Keep only the newest request/response pair open so the call sequence stays readable.
  if (isReq) for (const old of log.children) old.classList.add('collapsed');
  log.append(li);
  log.scrollTop = log.scrollHeight;
});

// Show tool results as parsed JSON, not as an escaped string.
function prettyRpc(msg) {
  const copy = structuredClone(msg);
  for (const c of copy.result?.content ?? []) {
    if (c.type === 'text') try { c.text = JSON.parse(c.text); } catch { /* leave as is */ }
  }
  if (copy.result?.tools) copy.result.tools = copy.result.tools.map((t) => t.name);
  return JSON.stringify(copy, null, 2);
}
$('clearPanel').addEventListener('click', () => { log.innerHTML = ''; });

// ---- voice out ------------------------------------------------------------
let voices = [];
function loadVoices() { voices = speechSynthesis.getVoices(); }
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}
// ONE voice for the whole chat, always with an Indian accent (free, unlimited, built into the browser).
// Best first:
//   1. an Indian English female voice (Veena/Isha on Mac, Neerja/Swara in Edge…) if the computer has one
//   2. Chrome's built-in Google Indian voice (female; it reads our English text with an Indian accent —
//      numbers are turned into English words first, see speech-text.js)
//   3. any Indian English voice (e.g. Rishi), then any English voice
const SPEECH_RATE = 1.1; // a little quicker than normal (1.0)
const FEMALE_IN = /veena|isha|sangeeta|lekha|kajal|neerja|heera|priya|aditi|raveena|swara|ananya|kavya|female/i;
const MALE = /rishi|ravi|prabhat|hemant|aman|madhur|male|daniel|alex|fred|david|mark|george/i;
const langOf = (v) => v.lang.replace('_', '-').toLowerCase();
function pickVoice() {
  const inEn = voices.filter((v) => langOf(v) === 'en-in');
  const inHi = voices.filter((v) => langOf(v) === 'hi-in');
  return inEn.find((v) => FEMALE_IN.test(v.name) && !/\bmale\b/i.test(v.name))
    ?? inEn.find((v) => !MALE.test(v.name))
    ?? inHi.find((v) => /google/i.test(v.name))
    ?? inHi.find((v) => !MALE.test(v.name))
    ?? inEn[0]
    ?? voices.find((v) => langOf(v).startsWith('en') && /female|samantha|karen|moira|tessa|serena|victoria|zira|aria|jenny/i.test(v.name) && !/\bmale\b/i.test(v.name))
    ?? voices.find((v) => langOf(v).startsWith('en'));
}
// Shown in "Under the hood" (in English: Chrome's Indian voice has a non-English name).
const voiceLabel = (v) => {
  if (!v) return 'browser default';
  const name = v.name.replace(/[^\x20-\x7E]+/g, '').trim() || 'Chrome';
  return langOf(v) === 'hi-in' ? `${name} Indian accent (built into Chrome)` : `${name} (${v.lang})`;
};
let shownVoice = null;
const noteVoice = (v) => showVoice(voiceLabel(v));

// "indian" (default): the browser's Indian-accent voice for every reply — free and unlimited.
// "gemini": Gemini's voice while its small free daily quota lasts, then the Indian voice.
const VOICE_KEY = 'hisaab.voice';
let voiceMode = store.get(VOICE_KEY) === 'gemini' ? 'gemini' : 'indian';

// Resolves when Hisaab has finished talking, so the mic never hears its own voice.
// First choice: Gemini's female voice from our server (/tts). If that fails or takes too long,
// the browser's own voice says it instead, so a reply is never silent.
const GEMINI_WAIT_MS = 7000;
async function speak(text) {
  if (!text) return;
  if (voiceMode === 'gemini') {
    try {
      const r = await fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(GEMINI_WAIT_MS)
      });
      if (r.ok) {
        showVoice(r.headers.get('X-Hisaab-Voice') ?? 'Gemini');
        return await playWav(await r.blob());
      }
      console.info('[voice] Gemini voice unavailable, using the browser voice:', (await r.json().catch(() => ({}))).error);
    } catch (e) {
      console.info('[voice] Gemini voice failed, using the browser voice:', e.message);
    }
  }
  return speakWithBrowser(text);
}

let player = null;
function playWav(blob) {
  return new Promise((resolve) => {
    player?.pause();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    player = audio;
    audio.playbackRate = SPEECH_RATE;
    audio.preservesPitch = true;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      needsClickToHear(false);
      setTimeout(resolve, 300); // let the speaker's tail die out before the mic opens
    };
    audio.onended = finish;
    audio.onerror = finish;
    audio.play().catch((e) => {
      if (e.name !== 'NotAllowedError') return finish();
      // Chrome won't play sound until the page has been clicked once. Ask, then play.
      needsClickToHear(true, () => audio.play().catch(finish));
      setTimeout(() => { if (audio.paused) finish(); }, 8000); // nobody clicked: the text is on screen anyway
    });
  });
}
function stopTalking() {
  player?.pause();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

let onClickToHear = null;
function needsClickToHear(on, then) {
  const go = () => { const f = onClickToHear; needsClickToHear(false); f?.(); };
  if (on) {
    onClickToHear = then;
    hint.textContent = 'Click anywhere once so you can hear me';
    hint.classList.add('nudge');
    window.addEventListener('pointerdown', go, { capture: true, once: true });
    window.addEventListener('keydown', go, { capture: true, once: true });
  } else if (onClickToHear) {
    onClickToHear = null;
    hint.classList.remove('nudge');
  }
}

function showVoice(name) {
  if (name === shownVoice) return;
  shownVoice = name;
  console.info('[voice] speaking with', name);
  $('voiceName').textContent = `Voice: ${name}`;
}

// The browser voice. Text is made "speakable" (numbers as English words) and spoken a sentence at a
// time, because Chrome's built-in voices can stop halfway through a long sentence.
// Resolves when it has finished; Chrome sometimes skips `onend`, so we also poll speechSynthesis.speaking.
function speakWithBrowser(text) {
  return new Promise((resolve) => {
    if (!text || !('speechSynthesis' in window)) return resolve();
    speechSynthesis.cancel();
    const voice = pickVoice();
    noteVoice(voice);
    const parts = toSpeakable(text).split(/(?<=[.!?])\s+/).filter(Boolean);
    let done = false;
    let left = parts.length;
    const started = Date.now();
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      setTimeout(resolve, 300);
    };
    const poll = setInterval(() => {
      const quiet = !speechSynthesis.speaking && !speechSynthesis.pending;
      if ((quiet && Date.now() - started > 600) || Date.now() - started > 45000) finish();
    }, 200);
    for (const part of parts) {
      const u = new SpeechSynthesisUtterance(part);
      u.lang = voice?.lang ?? SPEECH_LANG;
      try { if (voice) u.voice = voice; } catch { /* odd voice object: keep the default voice */ }
      u.rate = SPEECH_RATE;
      u.onend = () => { left -= 1; if (left <= 0) finish(); };
      u.onerror = u.onend;
      speechSynthesis.speak(u);
    }
    if (!parts.length) finish();
  });
}

// ---- voice in: wake word "San", tap-to-talk, follow-up answers ----------------
// One continuous recognizer. Modes:
//   wake    — hands-free is on; waiting to hear "San" at the start of a phrase
//   command — the next thing you say is sent to Hisaab
//   off     — mic closed (busy, Hisaab is talking, or hands-free is off)
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
// What Chrome's en-IN recognizer tends to write when you say "San". Tune here if needed
// (open the console: every phrase heard while waiting is logged as [wake]).
// Wake phrase: "Hey San" (just "San" on its own does nothing).
// Chrome writes it in many ways: "hey san", "hey sun", "hey son", "hey Sam", "a son", "hi San",
// or as one word: "Hasan", "Hesan", "Heysan". We accept all of those.
const WAKE_SOUND = /^(?:s|sh|z)(?:a|aa|ah|u|o|au|ha)(?:n|nn|m|ng|nd|hn)$/;          // san, sun, son, sam, sang, shan…
const WAKE_EXTRA = new Set(['sean', 'shaun', 'shawn', 'saan', 'sanh', 'sahan', 'shaan', 'sahn']);
const HEY = new Set(['hey', 'hay', 'hei', 'he', 'hi', 'hai', 'a', 'ay', 'eh', 'ey', 'hy']);
const HEY_SAN_ONE_WORD = /^(?:hey|hay|he|ha|hi|hai|a|e)(?:s|ss|sh|z)(?:a|aa|u|o|ah)(?:n|nn|m|hn)$/; // hasan, hesan, heysan…
const FILLER = new Set(['ok', 'okay', 'so', 'um', 'uh', 'oh', 'and', 'yeah']);
const wordKey = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const isSan = (w) => { const k = wordKey(w); return WAKE_SOUND.test(k) || WAKE_EXTRA.has(k); };

// Where "Hey San" ends in a list of words: index of its last word, or -1.
function heySanAt(words, i) {
  if (HEY_SAN_ONE_WORD.test(wordKey(words[i] ?? ''))) return i;
  if (HEY.has(wordKey(words[i] ?? '')) && isSan(words[i + 1] ?? '')) return i + 1;
  return -1;
}

// Finds "Hey San" in a phrase. Returns the words after it (maybe ''), or null if it isn't there.
//   start: "Hey San …" (optionally after one filler like "okay")
//   tail:  "… Hey San" (said at the end of a phrase; the command follows)
//   any:   the last "Hey San" anywhere (used once we are already listening for a command)
function findWake(text, where = 'start') {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const after = (i) => words.slice(i + 1).join(' ').replace(/^[\s,.!?:;-]+/, '').trim();
  for (let i = 0; i < Math.min(2, words.length); i++) {
    if (i === 1 && !FILLER.has(wordKey(words[0]))) break;
    const end = heySanAt(words, i);
    if (end >= 0) return after(end);
  }
  if (where === 'tail') {
    const n = words.length;
    if (n && HEY_SAN_ONE_WORD.test(wordKey(words[n - 1]))) return '';
    if (n >= 2 && heySanAt(words, n - 2) === n - 1) return '';
  }
  if (where === 'any') {
    for (let i = words.length - 1; i >= 0; i--) { const end = heySanAt(words, i); if (end >= 0) return after(end); }
  }
  return null;
}
const stripWake = (text) => findWake(text, 'start') ?? text; // typed "Hey San, what's my bill" -> "what's my bill"
const COMMAND_MS = 8000;   // after "San" (or a mic tap): time to start speaking
const FOLLOW_UP_MS = 2000; // after Hisaab asks a question: time to start answering
const HANDS_FREE_KEY = 'hisaab.handsfree';

let busy = false;      // a sentence is being handled
let rec = null;
let mode = 'off';
let handsFree = false;
let windowTimer = null;
let speakingNow = false;
let followUpTo = null; // Hisaab's question, while we wait for the answer
let blocked = false;   // mic permission refused
let micLive = false;   // the recognizer has really started (Chrome said so)
let noBias = false;    // Chrome refused the "expect San" hint: don't send it again
let heardTimer = null;

const HINTS = {
  off: () => (handsFree ? 'One moment…' : 'Tap the mic and speak, or type and press Enter'),
  wake: () => 'Say “Hey San” — or tap the mic',
  command: () => (followUpTo ? 'Listening for your answer…' : 'Listening…')
};
function setMode(next) {
  mode = next;
  mic.classList.toggle('listening', next === 'command');
  mic.classList.toggle('armed', next === 'wake');
  wakeBtn.classList.toggle('on', handsFree);
  wakeBtn.setAttribute('aria-pressed', String(handsFree));
  hint.textContent = HINTS[next]();
}

function startRec() {
  if (rec || !Recognition || blocked) return;
  const r = new Recognition();
  r.lang = SPEECH_LANG;
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 5; // look at Chrome's other guesses too: "Hey San" is often guess #2 or #3
  // Newer Chrome can be told which words to expect (contextual biasing). Older Chrome ignores this.
  if (!noBias && 'phrases' in r && window.SpeechRecognitionPhrase) {
    try { r.phrases = [new SpeechRecognitionPhrase('Hey San', 10)]; } catch { /* unsupported */ }
  }
  r.onresult = (e) => { lastMicEvent = Date.now(); onSpeech(e); };
  r.onstart = () => { micLive = true; lastMicEvent = Date.now(); restartDelay = 300; needsClick(false); };
  r.onaudiostart = r.onsoundstart = r.onspeechstart = () => { lastMicEvent = Date.now(); };
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      // Either the mic is really blocked, Chrome wants one click on the page first,
      // or Chrome briefly refused (e.g. the tab was in the background): then just try again.
      blocked = true;
      micPermission().then((state) => {
        if (state === 'granted' && navigator.userActivation?.hasBeenActive !== false) {
          blocked = false; // the watchdog restarts it
        } else if (state === 'denied') {
          handsFree = false;
          setMode('off');
          bubble('bot err', 'The microphone is blocked for this page. Click the 🔒 icon in the address bar, allow the microphone and reload — or just type.');
        } else {
          needsClick(true);
        }
      });
    } else if (e.error === 'phrases-not-supported') {
      noBias = true; // restart (onend) without the hint
    } else if (!['no-speech', 'aborted', 'network'].includes(e.error)) {
      console.warn('[mic]', e.error);
    }
  };
  // Chrome ends continuous recognition after a while on its own: quietly restart while we still want it.
  r.onend = () => {
    micLive = false;
    if (rec !== r) return;
    rec = null;
    if (wantMic()) setTimeout(startRec, restartDelay);
    else setMode('off');
    restartDelay = Math.min(restartDelay * 2, 4000); // back off if Chrome keeps ending it straight away
  };
  rec = r;
  try {
    r.start();
  } catch (e) {
    // Chrome sometimes refuses a new start while the last session is still closing: try again shortly.
    rec = null;
    console.debug('[mic] start refused, retrying:', e.message);
    setTimeout(() => { if (wantMic()) startRec(); }, 600);
  }
}

// Watchdog: whenever Hisaab should be listening but isn't (Chrome stopped it, the tab was hidden,
// a start was refused…), start it again. Also recycles a session that has gone silent for 25 s,
// because Chrome can stop delivering audio without telling us.
let lastMicEvent = 0;
let restartDelay = 300;
setInterval(() => {
  if (!Recognition || blocked) return;
  if (wantMic() && !rec) { startRec(); return; }
  if (rec && mode === 'wake' && micLive && Date.now() - lastMicEvent > 25000) {
    console.debug('[mic] no audio events for 25 s, restarting the mic');
    stopRec();
    startRec();
  }
}, 2000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && handsFree) { blocked = false; if (!rec && wantMic()) startRec(); }
});
function stopRec() {
  const r = rec;
  rec = null;
  if (r) { r.onend = null; try { r.abort(); } catch { /* already stopped */ } }
}
const wantMic = () => !busy && !speakingNow && (handsFree || mode === 'command');

// Listen for the next phrase as a command, for `ms` until you start talking.
function openWindow(ms) {
  clearTimeout(windowTimer);
  setMode('command');
  startRec();
  windowTimer = setTimeout(closeWindow, ms);
}
function closeWindow() {
  clearTimeout(windowTimer);
  followUpTo = null;
  if (handsFree) { setMode('wake'); startRec(); } else { stopRec(); setMode('off'); }
}

function onSpeech(e) {
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const res = e.results[i];
    const heard = res[0].transcript.trim();
    if (!heard) continue;
    const guesses = Array.from({ length: res.length }, (_, j) => res[j].transcript.trim()).filter(Boolean);

    if (mode === 'wake') {
      // "San" in any of Chrome's guesses, at the start of the phrase or as its last word
      const hit = guesses.map((g) => findWake(g, 'tail')).find((rest) => rest != null);
      if (hit == null) {
        if (res.isFinal) showHeard(heard);
        continue;
      }
      console.info('[wake] heard “Hey San” in:', guesses);
      openWindow(COMMAND_MS); // the light comes on immediately
    }
    if (mode !== 'command') continue;

    // Drop the wake word and anything before it: "Hey San, Shanti didn't come" -> "Shanti didn't come"
    const best = guesses.find((g) => findWake(g, 'any') != null) ?? heard;
    const said = (findWake(best, 'any') ?? heard).trim();
    if (!said) continue;
    clearTimeout(windowTimer); // you started talking: wait for you to finish (with a safety cap)
    windowTimer = setTimeout(closeWindow, 12000);
    hint.textContent = `“${said}”`;
    if (res.isFinal) {
      const previous = followUpTo;
      followUpTo = null;
      stopRec();
      setMode('off');
      handle(said, { previous });
      return;
    }
  }
}

// While waiting for "San", show what Chrome heard, so you can tell if it is mishearing the wake word.
function showHeard(heard) {
  console.debug('[wake] heard (no “Hey San”):', heard);
  hint.textContent = `Heard “${heard.length > 40 ? `${heard.slice(0, 40)}…` : heard}” — say “Hey San” first`;
  clearTimeout(heardTimer);
  heardTimer = setTimeout(() => { if (mode === 'wake') setMode('wake'); }, 3000);
}

// After every reply: answer window if Hisaab asked something, else back to waiting for "San".
function afterReply(sayLine) {
  if (blocked || !Recognition) return setMode('off');
  if (/\?\s*$/.test(sayLine ?? '')) {
    followUpTo = sayLine;
    openWindow(FOLLOW_UP_MS);
  } else if (handsFree) {
    setMode('wake');
    startRec();
  } else {
    setMode('off');
  }
}

function setHandsFree(on, remember = true) {
  handsFree = on && !!Recognition && !blocked;
  if (remember) store.set(HANDS_FREE_KEY, handsFree ? '1' : '0');
  if (handsFree && mode === 'off' && !busy && !speakingNow) { setMode('wake'); startRec(); }
  else if (!handsFree && mode === 'wake') { stopRec(); setMode('off'); }
  else setMode(mode);
}

// The wake-word switch lives next to the hint under the input.
const wakeBtn = el('button', { type: 'button', class: 'wake', 'aria-pressed': 'false', title: 'Turn the “Hey San” wake word on or off' }, 'Hands-free “Hey San”');
const below = el('div', { class: 'below' });
hint.replaceWith(below);
below.append(wakeBtn, hint);

if (!Recognition) {
  mic.disabled = true;
  wakeBtn.hidden = true;
  hint.textContent = 'Voice needs Chrome or Edge — type instead';
} else {
  mic.addEventListener('click', () => {
    if (mode === 'command') return closeWindow(); // tap again to stop
    stopTalking();
    blocked = false;
    openWindow(COMMAND_MS);
  });
  wakeBtn.addEventListener('click', () => { blocked = false; setHandsFree(!handsFree); });
  // Hands-free is ON by default: the page starts waiting for "San" as soon as it opens.
  // (It stays off only if you switched it off yourself.)
  if (store.get(HANDS_FREE_KEY) !== '0') {
    setHandsFree(true, false);
    // If Chrome hasn't started the mic within 2 s, it is waiting for one click/key on the page.
    setTimeout(() => { if (handsFree && !micLive && !speakingNow && !busy) needsClick(true); }, 2000);
  }
  // Mic allowed later (e.g. from the address bar)? Start without a reload.
  micPermission(true);
}

async function micPermission(watch = false) {
  try {
    const p = await navigator.permissions.query({ name: 'microphone' });
    if (watch) p.onchange = () => { if (p.state === 'granted' && handsFree && !micLive) { blocked = false; startRec(); } };
    return p.state; // granted | prompt | denied
  } catch { return 'unknown'; }
}

// Chrome needs one interaction on a fresh page before it opens the mic. Any click or key does it.
let waitingForClick = false;
function needsClick(on) {
  if (on === waitingForClick) return;
  waitingForClick = on;
  if (on) {
    hint.textContent = 'Click anywhere once so I can hear “Hey San”';
    hint.classList.add('nudge');
    window.addEventListener('pointerdown', wakeUpMic, true);
    window.addEventListener('keydown', wakeUpMic, true);
  } else {
    hint.classList.remove('nudge');
    window.removeEventListener('pointerdown', wakeUpMic, true);
    window.removeEventListener('keydown', wakeUpMic, true);
    setMode(mode);
  }
}
function wakeUpMic() {
  needsClick(false);
  blocked = false;
  if (handsFree && !busy && !speakingNow) { stopRec(); setMode('wake'); startRec(); }
}

// ---- the per-utterance flow -------------------------------------------------
async function handle(text, { previous = null } = {}) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  clearTimeout(windowTimer);
  stopRec(); // the mic stays closed while we think and while Hisaab talks
  setMode('off');
  bubble('user', text);
  const thinking = add(el('div', { class: 'bubble bot thinking' }, el('i'), el('i'), el('i')));
  const date = demoDate();
  let sayLine = null;
  try {
    const u = await callTool('understand', { text, date, lang: LANG });
    if (u.intent === 'clarify') {
      // Not a command: let Gemini answer it from the ledger instead of saying "sorry".
      const a = await callTool('ask', { question: text, date, lang: LANG, ...(previous ? { previous } : {}) });
      thinking.remove();
      bubble('bot', a.say);
      sayLine = a.say;
    } else {
      const args = { ...u.args, lang: LANG };
      if (u.intent === 'log_helper_event' || u.intent === 'log_purchase') {
        args.date = u.args.date ?? date; // keep the day you said ("on 10th October", "yesterday")
        args.today = date;               // the demo's "today", so the reply can say "today" / "on 10 October"
      } else if (TAKES_DATE.has(u.intent)) {
        args.date = date;
      }
      if (TAKES_RAW.has(u.intent)) args.raw = text;
      if ((u.intent === 'get_bill' || u.intent === 'month_summary') && !args.month) args.month = date.slice(0, 7);
      const r = await callTool(u.intent, args);
      thinking.remove();
      reply(u.intent, r);
      sayLine = r.say;
    }
  } catch (e) {
    thinking.remove();
    bubble('bot err', e.say ?? `Something went wrong: ${e.message}`);
    sayLine = e.say;
  } finally {
    busy = false;
  }
  await talk(sayLine);
}

// Speak with the mic closed, then reopen it the right way.
async function talk(sayLine) {
  speakingNow = true;
  stopRec();
  setMode('off');
  try { await speak(sayLine); } finally { speakingNow = false; }
  afterReply(sayLine);
}

function reply(intent, r) {
  if (QUIET.has(intent)) return add(noted(intent, r));
  bubble('bot', r.say);
  const card = CARDS[intent]?.(r);
  if (card) add(card);
}

// Undo THIS line's entry (not just whatever was added last).
async function undo(link, target) {
  if (busy) return;
  const status = el('span', { class: 'undone' }, 'undoing…');
  link.replaceWith(status);
  try {
    const r = await callTool('undo_last', { lang: LANG, ...(target ?? {}) });
    status.textContent = 'undone';
    status.closest('.noted')?.classList.add('struck');
    talk(r.say);
  } catch (e) {
    status.replaceWith(link); // let them try again
    bubble('bot err', e.say ?? `Couldn't undo: ${e.message}`);
  }
}

// ---- quiet "Noted ✓" lines -------------------------------------------------
const EVENT_WORDS = {
  absent: (e) => `absent on ${prettyDate(e.date)}`,
  extra: (e) => `${e.qty} extra on ${prettyDate(e.date)}`,
  less: (e) => `${e.qty} less on ${prettyDate(e.date)}`,
  advance: (e) => `advance of ${rupees(e.amount)}`,
  visit: (e) => `${e.qty} visit${e.qty === 1 ? '' : 's'} on ${prettyDate(e.date)}`
};

function noted(intent, r) {
  const what = {
    log_helper_event: () => `${r.helperName} — ${EVENT_WORDS[r.event.type]?.(r.event) ?? r.event.type}`,
    add_helper: () => `Added ${r.helper.name} · ${rupees(r.helper.rate)}${r.helper.unit ? `/${r.helper.unit}` : ''}`,
    undo_last: () => `Removed: ${r.removed.raw || r.removed.type || r.removed.item}`
  }[intent]();
  const line = el('div', { class: 'noted' },
    el('span', { class: 'tick' }, intent === 'undo_last' ? '↺' : '✓'),
    el('span', {}, r.say || what),
    el('span', { class: 'what' }, what));
  const target = intent === 'log_helper_event' ? { kind: 'event', id: r.event.id }
    : intent === 'add_helper' ? { kind: 'helper', id: r.helper.id } : null;
  if (r.duplicate) {
    line.querySelector('.tick').textContent = '•'; // nothing new was saved, so nothing to undo
  } else if (target) {
    const link = el('button', { type: 'button', class: 'link', onclick: () => undo(link, target) }, 'Undo');
    line.append(link);
  }
  return line;
}

// ---- cards ----------------------------------------------------------------
const CARDS = {
  log_purchase: ({ purchase, alert }) => {
    const label = { high: 'Overpriced', low: 'Good deal', normal: 'Fair price', new: 'First time' }[alert.level];
    return el('div', { class: `card ${alert.level}` },
      el('h3', {}, purchase.vendor && purchase.vendor !== 'unknown' ? `${cap(purchase.item)} · ${purchase.vendor}` : cap(purchase.item), el('span', { class: 'badge' }, label)),
      el('div', { class: 'big' }, `${rupees(purchase.price)}/${purchase.unit}`),
      el('div', { class: 'sub' },
        alert.baseline != null ? `Usually ${rupees(alert.baseline)}/${purchase.unit}` : 'I’ll remember this price',
        purchase.qty !== 1 ? ` · qty ${purchase.qty}` : ''),
      alert.cheapest && el('div', { class: 'sub' }, `Cheapest lately: ${alert.cheapest.vendor} at ${rupees(alert.cheapest.price)}`));
  },

  get_bill: ({ bills }) => (bills.length === 1 ? billCard(bills[0]) : summaryCard({ bills })),

  month_summary: (r) => summaryCard(r),

  price_check: ({ item, avg, min, max, cheapestVendor, lastPrices }) =>
    avg == null ? null : el('div', { class: 'card' },
      el('h3', {}, cap(item), el('span', { class: 'badge' }, 'price memory')),
      el('div', { class: 'big' }, `~${rupees(avg)}`),
      el('div', { class: 'sub' }, `Range ${rupees(min)} – ${rupees(max)}`, cheapestVendor ? ` · cheapest: ${cheapestVendor}` : ''),
      lastPrices?.length ? el('div', { class: 'prices' }, 'Last:', lastPrices.map((p) => el('span', {}, rupees(p)))) : null)
};

function billCard(b, whatsapp) {
  return el('div', { class: 'card' },
    el('h3', {}, b.helperName, el('span', { class: 'badge' }, monthName(b.month))),
    el('table', { class: 'lines' },
      b.lines.map((l) => el('tr', {}, el('td', {}, l.label), el('td', { class: l.amount < 0 ? 'neg' : '' }, signed(l.amount)))),
      el('tr', { class: 'total' }, el('td', {}, 'To pay'), el('td', {}, rupees(b.total)))),
    whatsapp && el('div', { class: 'actions' },
      el('button', { class: 'btn', type: 'button', onclick: (e) => copy(whatsapp, e.currentTarget) }, 'Copy WhatsApp message'),
      el('a', { class: 'btn wa', href: `https://wa.me/?text=${encodeURIComponent(whatsapp)}`, target: '_blank', rel: 'noopener' }, 'Open WhatsApp')));
}

function summaryCard({ bills, total, whatsapp = [] }) {
  total ??= bills.reduce((s, b) => s + b.total, 0);
  const textFor = (b) => whatsapp.find((w) => w.helperName === b.helperName)?.text;
  return el('div', { class: 'card summary' },
    el('div', { class: 'grand' },
      el('span', {}, monthName(bills[0]?.month ?? demoDate().slice(0, 7))),
      el('strong', {}, rupees(total))),
    el('div', { class: 'summary-grid' }, bills.map((b) => billCard(b, textFor(b)))));
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea', {}, text);
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  const old = btn.textContent;
  btn.textContent = 'Copied ✓';
  setTimeout(() => { btn.textContent = old; }, 1500);
}

// ---- setup ------------------------------------------------------------------
for (const [tag, s] of EXAMPLES) {
  $('examples').append(el('button', { type: 'button', onclick: () => handle(s) }, el('small', {}, tag), s));
}
dateInput.value = store.get('hisaab.date.v2') ?? realToday(); // .v2: forget the old 31 Oct default
dateInput.addEventListener('change', () => { store.set('hisaab.date.v2', demoDate()); showToday(); });
const voiceSelect = $('voiceMode');
voiceSelect.value = voiceMode;
voiceSelect.addEventListener('change', () => {
  voiceMode = voiceSelect.value === 'gemini' ? 'gemini' : 'indian';
  store.set(VOICE_KEY, voiceMode);
  shownVoice = null;
});
setHood(store.get('hisaab.hood') === '1');

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = textBox.value;
  textBox.value = '';
  handle(stripWake(t));
});

// The date Hisaab treats as "today", shown next to the logo.
function showToday() {
  const d = demoDate();
  const label = new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  $('today').textContent = d === realToday() ? label : `${label} · demo date`;
  $('today').classList.toggle('demo', d !== realToday());
}
showToday();

function setStatus(kind, text) {
  dot.className = `dot ${kind}`;
  dot.title = text;
  statusText.className = `status ${kind}`;
  statusText.textContent = text;
}

// ---- start ----------------------------------------------------------------
(async () => {
  try {
    const tools = await connect();
    setStatus(MOCK ? 'mock' : 'ok', `${MOCK ? 'mock' : 'connected'} · ${tools.length} tools`);
  } catch (e) {
    setStatus('bad', 'server offline');
    bubble('bot err', `I can’t reach the server right now (${e.message}). Run npm start, or open ?mock=1.`);
  }
})();
