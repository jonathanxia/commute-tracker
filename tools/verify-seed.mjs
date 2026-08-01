#!/usr/bin/env node
// Node runner for the seed round-trip check.
//
//     node tools/verify-seed.mjs [path/to/seed.local.json]
//
// If node isn't installed, open verify.html in the browser instead — it runs
// the identical check via tools/verify-seed.js.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runVerification, formatReport } from './verify-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const seedPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(here, '..', 'seed.local.json');

let seed;
try {
  seed = JSON.parse(await readFile(seedPath, 'utf8'));
} catch (err) {
  console.error(`Could not read seed file at ${seedPath}\n${err.message}`);
  console.error('Copy seed.example.json to seed.local.json to get started.');
  process.exit(2);
}

const result = runVerification(seed);
console.log(formatReport(result));
process.exit(result.pass ? 0 : 1);
