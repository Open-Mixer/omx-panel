// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * look-pin.mjs — the vintage look's lit glass is the OpenMixer console's own, never retyped here: the console's vintage
 * tokens (the glass, its grid, the legend and the orange accent; the RELIEF shadows; the base control paint; and the three FINISH
 * blocks, aluminium the default) are read
 * from the console's tokens.css at ONE pinned commit and kept in tools/look/console-vintage.json beside the commit and
 * the sha-256 of the whole file. A package build needs no console checkout and no network: it reads the pinned
 * copy, which tools/look.mjs writes into tools/look.json. A release check hands this script the file at the pinned commit
 * (`--check <tokens.css>`, or $OPENMIXER_TOKENS_CSS) and it fails when the file's hash or any pinned value differs.
 *
 * `--self` is the CI check: the pin's values hash to its own seal (`source.valuesSha256`), so no value is edited without a re-pin; it needs
 * neither the console nor a network. `--drift <tokens.css>` is the by-hand check against the console's tokens.css as it is now (values only);
 * the console's own repository checks the public pin against its tokens.css.
 *
 * Usage: `node tools/look-pin.mjs --write <tokens.css> <commit>` re-pins (then `node tools/look.mjs`);
 *        `node tools/look-pin.mjs --check <tokens.css>` verifies the pin against that file.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PIN_JSON = join(dirname(fileURLToPath(import.meta.url)), 'look', 'console-vintage.json');
/** The four tokens of the vintage glass the first pin carried (the pin's `tokens`). */
export const PINNED = ['--glass', '--glass-grid', '--legend', '--accent'];
/** The relief the console draws depth with (`:root`: the drop shadows, the inset track, the one black every shadow mixes toward). */
export const RELIEF = ['--shade', '--shadow-1', '--shadow-2', '--inset-track'];
/** The base-layer control paint that no finish changes: the carved pointer, the fader's cream line, the cream legend on a cap. */
export const BASE = ['--knob-pointer', '--fader-cap-line', '--cap-legend'];
/** The hardware metal a finish block sets, and the finishes of the console (aluminium is the default, the bare `:root`). */
export const FINISH_KEYS = ['--knob-face', '--knob-edge', '--knob-cap-hi', '--knob-knurl', '--fader-cap', '--fader-cap-ridge', '--fader-cap-groove', '--btn-face', '--toggle-face', '--screw'];
export const FINISHES = ['aluminium', 'graphite', 'black'];
/** The console's text ink on a LIGHT plate (its light theme's `--ink` and `--ink-dim`): the vintage enclosure is a light plate, and its text is set in these. */
export const LIGHT_INK = ['--ink', '--ink-dim'];
export const loadPin = (file = PIN_JSON) => JSON.parse(readFileSync(file, 'utf8'));

const first = (css, re, what) => {
  const m = re.exec(css);
  if (!m) throw new Error(`look-pin: tokens.css sets no ${what}`);
  return m[1].trim();
};
const tokenOf = (css, name) => first(css, new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm'), name);
// a declaration inside a block: the first `--name: value;` of the block text (a `--x` that merely ends in `name` is not it)
const declOf = (block, name, where) => first(block, new RegExp(`(?:^|[\\s;{])${name}:\\s*([^;]+);`), `${name} in ${where}`);

/** The four tokens of the console's vintage dark theme, read out of `css`: the first `--glass`, `--glass-grid` and `--legend` of the dark palette, and the orange accent (the default accent). */
export function extractTokens(css) {
  return {
    '--glass': tokenOf(css, '--glass'),
    '--glass-grid': first(css, /--glass-grid:\s*([^;]+);/m, '--glass-grid'),
    '--legend': tokenOf(css, '--legend'),
    '--accent': first(css, /:root,\s*:root\[data-accent="orange"\]\s*\{\s*--accent:\s*([^;]+);/m, 'orange --accent'),
  };
}

/** The finish blocks of `css`, each finish's metal: the aluminium one is `:root, :root[data-finish="aluminium"]`. */
export function extractFinishes(css) {
  const blocks = {};
  for (const m of css.matchAll(/:root(?:,\s*:root)?\[data-finish="([a-z]+)"\]\s*\{([^}]*)\}/g)) blocks[m[1]] ??= m[2];
  return Object.fromEntries(FINISHES.map((f) => {
    if (!blocks[f]) throw new Error(`look-pin: tokens.css has no finish block '${f}'`);
    return [f, Object.fromEntries(FINISH_KEYS.map((k) => [k, declOf(blocks[f], k, `the ${f} finish`)]))];
  }));
}

/** The console's default finish, read where the console sets it: the finish block whose selector is the bare `:root` too (`:root, :root[data-finish="x"]`). */
export function extractDefaultFinish(css) {
  return first(css, /:root\s*,\s*:root\[data-finish="([a-z]+)"\]/, 'default finish block (:root, :root[data-finish="…"])');
}

/** The light theme's text inks, read out of `css`: `:root[data-theme="light"] { … }`. */
export function extractLight(css) {
  const m = /:root\[data-theme="light"\]\s*\{([^}]*)\}/.exec(css);
  if (!m) throw new Error('look-pin: tokens.css has no light theme block');
  return Object.fromEntries(LIGHT_INK.map((k) => [k, declOf(m[1], k, 'the light theme')]));
}

/** Everything the pin keeps, read out of `css`: the glass, the relief, the base paint and every finish. */
export function extractPin(css) {
  return {
    tokens: extractTokens(css),
    relief: Object.fromEntries(RELIEF.map((k) => [k, tokenOf(css, k)])),
    base: Object.fromEntries(BASE.map((k) => [k, tokenOf(css, k)])),
    light: extractLight(css),
    defaultFinish: extractDefaultFinish(css),
    finish: extractFinishes(css),
  };
}

/** The flat map a `{console:--token}` names: the glass, the relief and the base paint. */
export const consoleTokens = (pin = loadPin()) => ({ ...pin.tokens, ...pin.relief, ...pin.base, '--ink-light': pin.light['--ink'], '--ink-dim-light': pin.light['--ink-dim'] });
/** The metal `{finish:--token}` names, in the finish `name`. */
export const finishTokens = (name, pin = loadPin()) => {
  if (!pin.finish[name]) throw new Error(`look-pin: the console has no finish '${name}' (${Object.keys(pin.finish).join(', ')})`);
  return pin.finish[name];
};

const sha = (text) => createHash('sha256').update(text).digest('hex');

/** The sha-256 of the pin's VALUES (everything but `source`), the pin's own seal: a value edited by hand, without a re-pin, no longer matches it. */
export const valuesSha = (pin) => { const { $comment, source, ...values } = pin; return sha(JSON.stringify(values)); };

/** The faults of the pin against ITSELF, as sentences, or none: its values hash to the seal a re-pin wrote (`source.valuesSha256`). Needs no console and no network. */
export function checkSelf(pin = loadPin()) {
  if (!pin.source?.valuesSha256) return ['the pin carries no source.valuesSha256: re-pin with --write'];
  const have = valuesSha(pin);
  return have === pin.source.valuesSha256 ? [] : [`the pin's values hash ${have} and its seal says ${pin.source.valuesSha256}: a value was edited without a re-pin`];
}

/** Where a pinned token lives, for a sentence: a `[section, finish?, key]` of every value the pin keeps. */
export function pinnedValues(pin) {
  const out = [];
  for (const s of ['tokens', 'relief', 'base']) for (const [k, v] of Object.entries(pin[s] ?? {})) out.push({ id: k, value: v });
  for (const [k, v] of Object.entries(pin.light ?? {})) out.push({ id: `light:${k}`, value: v });
  for (const [f, block] of Object.entries(pin.finish ?? {})) for (const [k, v] of Object.entries(block)) out.push({ id: `${f}:${k}`, value: v });
  return out;
}

/** The faults of the pin's VALUES against the tokens.css text `css`, as sentences, or none (the hash is checkPin's). */
export function diffPin(css, pin = loadPin()) {
  const have = pinnedValues(extractPin(css)), want = new Map(pinnedValues(pin).map((e) => [e.id, e.value]));
  const faults = [];
  for (const e of have) if (want.get(e.id) !== e.value) faults.push(`${e.id} is ${e.value} in tokens.css and ${want.get(e.id)} in the pin`);
  for (const id of want.keys()) if (!have.some((e) => e.id === id)) faults.push(`${id} is in the pin and not in tokens.css`);
  return faults;
}

/** The faults of the pin against the tokens.css text `css`, as sentences, or none. */
export function checkPin(css, pin = loadPin()) {
  const faults = [];
  if (sha(css) !== pin.source.sha256) faults.push(`tokens.css hashes ${sha(css)}, the pin says ${pin.source.sha256} (commit ${pin.source.commit})`);
  return [...faults, ...diffPin(css, pin)];
}

function main(argv) {
  const [mode, file, commit] = argv;
  if (!['--write', '--check', '--drift', '--self'].includes(mode) || (mode !== '--self' && !file) || (mode === '--write' && !commit)) {
    console.error('usage: look-pin.mjs --write <tokens.css> <commit> | --check <tokens.css> | --drift <tokens.css> | --self');
    process.exit(2);
  }
  if (mode === '--self') {
    // CI's check: the pin is self-consistent, no console needed
    const faults = checkSelf();
    if (faults.length) {
      console.error(`look-pin: ${faults.join('; ')}`);
      process.exit(1);
    }
    console.log('look-pin: tools/look/console-vintage.json hashes to its own seal');
    return;
  }
  const css = readFileSync(file, 'utf8');
  if (mode === '--write') {
    const values = extractPin(css);
    const pin = { $comment: 'GENERATED — the console\'s vintage glass, pinned. Re-pin: `node tools/look-pin.mjs --write <tokens.css> <commit>`, then `node tools/look.mjs`.', source: { project: 'the OpenMixer console, its tokens.css (vintage dark theme)', commit, sha256: sha(css), valuesSha256: '' }, ...values };
    pin.source.valuesSha256 = valuesSha(pin);
    writeFileSync(PIN_JSON, `${JSON.stringify(pin, null, 2)}\n`);
    console.log(`look-pin: pinned ${commit}`);
    return;
  }
  if (mode === '--drift') {
    // the console's tokens.css at its CURRENT ref: every pinned value must still be what it holds (its hash is any edit's)
    const drift = diffPin(css);
    if (drift.length) {
      console.error(`look-pin: the console moved: ${drift.join('; ')}; re-pin with --write, then node tools/look.mjs`);
      process.exit(1);
    }
    console.log('look-pin: every pinned value is what the console\'s tokens.css holds now');
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
