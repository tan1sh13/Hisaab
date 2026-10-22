import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(root, 'data', 'data.json');
const SEED = path.join(root, 'data', 'seed.json');
const EMPTY = { helpers: [], events: [], purchases: [] };

// Creates data.json from seed.json (or empty) if missing, then reads it.
export function load() {
  if (!fs.existsSync(DATA)) {
    fs.mkdirSync(path.dirname(DATA), { recursive: true });
    if (fs.existsSync(SEED)) fs.copyFileSync(SEED, DATA);
    else fs.writeFileSync(DATA, JSON.stringify(EMPTY, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(DATA, 'utf8'));
  } catch {
    throw new Error('data/data.json is unreadable. Run `npm run seed` to restore it.');
  }
}

// Write to a temp file, then rename: a crash never leaves a half-written file.
export function save(data) {
  const tmp = `${DATA}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA);
}

// Next id like "e7" / "p12": highest existing number + 1 (safe after undo).
export function nextId(list, prefix) {
  const max = list.reduce((m, x) => Math.max(m, Number(String(x.id).slice(prefix.length)) || 0), 0);
  return `${prefix}${max + 1}`;
}
