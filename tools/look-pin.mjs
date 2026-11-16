// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * look-pin.mjs — the vintage look's lit glass is the OpenMixer console's own, never retyped here: the four tokens the
 * vintage screens wear (the glass, its grid, the legend and the orange accent, the console's vintage dark theme) are read
 * from the console's tokens.css at ONE pinned commit and kept in tools/look/console-vintage.json beside the commit and
 * the sha-256 of the whole file. A package build needs no console checkout and no network: it reads the pinned
 * copy, which tools/look.mjs writes into tools/look.json. A release check hands this script the file at the pinned commit
 * (`--check <tokens.css>`, or $OPENMIXER_TOKENS_CSS) and it fails when the file's hash or any of the four values differs.
 *
 * Usage: `node tools/look-pin.mjs --write <tokens.css> <commit>` re-pins (then `node tools/look.mjs`);
 *        `node tools/look-pin.mjs --check <tokens.css>` verifies the pin against that file.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PIN_JSON = join(dirname(fileURLToPath(import.meta.url)), 'look', 'console-vintage.json');
export const PINNED = ['--glass', '--glass-grid', '--legend', '--accent'];
export const loadPin = (file = PIN_JSON) => JSON.parse(readFileSync(file, 'utf8'));

/** The four tokens of the console's vintage dark theme, read out of `css`: the first `--glass`, `--glass-grid` and `--legend` of the dark palette, and the orange accent (the default accent). */
export function extractTokens(css) {
  const first = (re, what) => {
    const m = re.exec(css);
    if (!m) throw new Error(`look-pin: tokens.css sets no ${what}`);
    return m[1].trim();
  };
  return {
    '--glass': first(/^\s*--glass:\s*([^;]+);/m, '--glass'),
    '--glass-grid': first(/--glass-grid:\s*([^;]+);/m, '--glass-grid'),
    '--legend': first(/^\s*--legend:\s*([^;]+);/m, '--legend'),
    '--accent': first(/:root,\s*:root\[data-accent="orange"\]\s*\{\s*--accent:\s*([^;]+);/m, 'orange --accent'),
  };
}

const sha = (text) => createHash('sha256').update(text).digest('hex');

/** The faults of the pin against the tokens.css text `css`, as sentences, or none. */
export function checkPin(css, pin = loadPin()) {
  const faults = [];
  if (sha(css) !== pin.source.sha256) faults.push(`tokens.css hashes ${sha(css)}, the pin says ${pin.source.sha256} (commit ${pin.source.commit})`);
  const have = extractTokens(css);
  for (const k of PINNED) if (have[k] !== pin.tokens[k]) faults.push(`${k} is ${have[k]} in tokens.css and ${pin.tokens[k]} in the pin`);
  return faults;
}

function main(argv) {
  const [mode, file, commit] = argv;
  if (!['--write', '--check'].includes(mode) || !file || (mode === '--write' && !commit)) {
    console.error('usage: look-pin.mjs --write <tokens.css> <commit> | --check <tokens.css>');
    process.exit(2);
  }
  const css = readFileSync(file, 'utf8');
  if (mode === '--write') {
    const pin = { $comment: 'GENERATED — the console\'s vintage glass, pinned. Re-pin: `node tools/look-pin.mjs --write <tokens.css> <commit>`, then `node tools/look.mjs`.', source: { project: 'the OpenMixer console, its tokens.css (vintage dark theme)', commit, sha256: sha(css) }, tokens: extractTokens(css) };
    writeFileSync(PIN_JSON, `${JSON.stringify(pin, null, 2)}\n`);
    console.log(`look-pin: pinned ${commit}`);
    return;
  }
  const faults = checkPin(css);
  if (faults.length) {
    console.error(`look-pin: ${faults.join('; ')}`);
    process.exit(1);
  }
  console.log('look-pin: tools/look/console-vintage.json is what tokens.css holds at the pinned commit');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
