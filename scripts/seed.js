// npm run seed — resets the demo: copies data/seed.json to data/data.json
import { copyFileSync, renameSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = path.join(root, 'data', 'seed.json');
const target = path.join(root, 'data', 'data.json');
const tmp = target + '.tmp';

// make sure the seed is valid JSON before touching data.json
const parsed = JSON.parse(readFileSync(seed, 'utf8'));

// write temp file, then rename, so a crash never leaves a half-written data.json
copyFileSync(seed, tmp);
renameSync(tmp, target);

console.log(
  `Seeded data/data.json: ${parsed.helpers.length} helpers, ` +
  `${parsed.events.length} events, ${parsed.purchases.length} purchases.`
);
