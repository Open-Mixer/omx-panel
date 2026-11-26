// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * gestures-render.mjs — schema/gestures.json, the one gesture declaration the surfaces and the C renderer read at run
 * time, rendered from the gestures domain (contract.d/gestures/gestures.json, the GESTURES_* items; docs/contract-domains.md).
 * The domain is the source and the file is its rendering, byte for byte what the hand file was: the heading, the timings,
 * the thresholds, the words, the inputs, the table, the paint rule, the codes and the exceptions, in that order.
 *
 *   node tools/gestures-render.mjs                          write schema/gestures.json
 *   node tools/gestures-render.mjs --check                  exit 1 when the file is not what the domain gives
 *   node tools/gestures-render.mjs [--check] --contract-dir <dir>   read <dir>/gestures/gestures.json instead of the tree's
 *
 * A domain that does not hold together is refused by item: a table or an exception that names a word GESTURES_WORDS does
 * not declare, an input the table uses that GESTURES_INPUTS does not list, an item missing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '@openmixer/omx-contract/entry';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CONTRACT_DIR = join(ROOT, 'contract.d');
export const SCHEMA_FILE = join(ROOT, 'schema', 'gestures.json');

const SHEETS = { head: 'GESTURES_HEAD', timings: 'GESTURES_TIMINGS', thresholds: 'GESTURES_THRESHOLDS', inputs: 'GESTURES_INPUTS', table: 'GESTURES_TABLE', paint: 'GESTURES_PAINT', exceptions: 'GESTURES_EXCEPTIONS' };

export class GesturesDomainError extends Error {}
const refuse = (m) => { throw new GesturesDomainError(m); };

/** The declaration the domain gives, in the shape of schema/gestures.json; refused by item when the domain does not hold together. */
export function declarationOf(doc) {
  const items = doc?.components?.schemas ?? {};
  const item = (name) => items[name] ?? refuse(`GESTURES: the item ${name} is missing`);
  const sheet = (name) => item(name)['x-value'] ?? refuse(`${name}: no x-value`);
  // a word keyed by its const; a code by its x-name, the GESTURE_* name the units answer (its const is the code word of
  // schema/codes.json, panel.gesture.<kebab>: docs/panel-gestures.md, omx-panel#106)
  const wordsOf = (name) => Object.fromEntries((item(name).oneOf ?? refuse(`${name}: no words`)).map((w) => [w['x-name'] ?? w.const, w.description]));
  const head = sheet(SHEETS.head);
  const out = {
    schema: head.schema, title: head.title, description: head.description,
    timings: sheet(SHEETS.timings), thresholds: sheet(SHEETS.thresholds), words: wordsOf('GESTURES_WORDS'),
    inputs: sheet(SHEETS.inputs).inputs ?? refuse('GESTURES_INPUTS: no inputs'), table: sheet(SHEETS.table), paint: sheet(SHEETS.paint),
    codes: wordsOf('GESTURES_CODES'), exceptions: sheet(SHEETS.exceptions).exceptions ?? refuse('GESTURES_EXCEPTIONS: no exceptions'),
  };
  for (const [widget, row] of Object.entries(out.table)) {
    for (const [input, word] of Object.entries(row)) {
      if (!out.inputs.includes(input)) refuse(`GESTURES_TABLE ${widget}.${input}: GESTURES_INPUTS does not list the input ${input}`);
      if (!(word in out.words)) refuse(`GESTURES_TABLE ${widget}.${input} names the word "${word}", which GESTURES_WORDS does not declare`);
    }
  }
  for (const e of out.exceptions) if (!(e.word in out.words)) refuse(`GESTURES_EXCEPTIONS names the word "${e.word}", which GESTURES_WORDS does not declare`);
  return out;
}

/** The domain document of `dir` (a contract directory), read and refused as declarationOf refuses. */
export function readDomain(dir = CONTRACT_DIR) {
  const file = join(dir, 'gestures', 'gestures.json');
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { refuse(`GESTURES: ${file} cannot be read: ${e.message}`); }
  declarationOf(doc);
  return doc;
}

/** The declaration of the domain in `dir`. */
export const declarationIn = (dir = CONTRACT_DIR) => declarationOf(readDomain(dir));

const j = JSON.stringify;
const inline = (o) => (Array.isArray(o) ? `[${o.map(j).join(', ')}]` : Object.keys(o).length ? `{ ${Object.entries(o).map(([k, v]) => `${j(k)}: ${j(v)}`).join(', ')} }` : '{}');
const lines = (o, f) => `{\n${Object.entries(o).map(([k, v]) => `    ${j(k)}: ${f(v)}`).join(',\n')}\n  }`;

/** schema/gestures.json's text for a domain document. */
export function renderGestures(doc) {
  const d = declarationOf(doc);
  const fields = [
    ['schema', j(d.schema)], ['title', j(d.title)], ['description', j(d.description)],
    ['timings', lines(d.timings, inline)], ['thresholds', lines(d.thresholds, j)], ['words', lines(d.words, j)],
    ['inputs', inline(d.inputs)], ['table', lines(d.table, inline)], ['paint', inline(d.paint)],
    ['codes', lines(d.codes, j)], ['exceptions', inline(d.exceptions)],
  ];
  return `{\n${fields.map(([k, v]) => `  ${j(k)}: ${v}`).join(',\n')}\n}\n`;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--contract-dir');
  const dir = at >= 0 ? args[at + 1] : CONTRACT_DIR;
  try {
    const text = renderGestures(readDomain(dir));
    if (args.includes('--check')) {
      let have = '';
      try { have = readFileSync(SCHEMA_FILE, 'utf8'); } catch { /* absent: a problem below */ }
      if (have !== text) {
        console.error(`gestures-render: schema/gestures.json is not what the gestures domain (${join(dir, 'gestures', 'gestures.json')}) gives: run node tools/gestures-render.mjs, then commit`);
        process.exit(1);
      }
      console.log('gestures-render: schema/gestures.json is what the gestures domain gives');
    } else {
      writeFileSync(SCHEMA_FILE, text);
      console.log('gestures-render: wrote schema/gestures.json');
    }
  } catch (e) {
    if (!(e instanceof GesturesDomainError)) throw e;
    console.error(`gestures-render: ${e.message}`);
    process.exit(1);
  }
}
