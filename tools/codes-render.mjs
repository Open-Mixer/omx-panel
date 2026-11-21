// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * codes-render.mjs — schema/codes.json (the refusal codes omx-panel emits, omx-contract's codes shape) and
 * catalogs/<lang>.json (their sentences in each language) rendered from the panel domain: PANEL_SKIN_CODES,
 * PANEL_MODGUI_CODES and PANEL_DESCRIBE_CODES of contract.d/panel/panel.json (const the code, title its key, x-text its
 * English sentence, x-args its placeholders) and the domain's catalogs (sorting pass row V3). Neither file is written by
 * hand; the surfaces and the console read them as before.
 *
 *   node tools/codes-render.mjs                              write schema/codes.json and catalogs/<lang>.json
 *   node tools/codes-render.mjs --check                      exit 1 when a file is not what the domain gives
 *   node tools/codes-render.mjs [--check] --contract-dir <d> read <d>/panel/ instead of this tree's contract.d/panel/
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '@openmixer/omx-contract/entry';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CONTRACT_DIR = join(ROOT, 'contract.d');
/** The items the sheet is made of, in the sheet's order. */
export const SHEET_ITEMS = ['PANEL_SKIN_CODES', 'PANEL_MODGUI_CODES', 'PANEL_DESCRIBE_CODES'];
const SHEET_DOC = "The refusal codes omx-panel emits, by the code word a refusal carries, each with its source sentence in English and the placeholders it may use (omx-contract's codes shape; translations are not here). Each language's sentences are in catalogs/<lang>.json, keyed by the code. The surfaces read both; no module repeats a sentence. A code is never reworded.";
const OWNER = 'omx-panel';

const text = (v) => `${JSON.stringify(v, null, 2)}\n`;

/** Every rendered file of the domain at `dir` (a contract directory holding panel/): `{ <path in the tree>: <text> }`. */
export function renderAll(dir = CONTRACT_DIR) {
  const domain = join(dir, 'panel');
  const schemas = JSON.parse(readFileSync(join(domain, 'panel.json'), 'utf8')).components.schemas;
  const words = SHEET_ITEMS.flatMap((item) => {
    if (!schemas[item]) throw new Error(`codes-render: the panel domain at ${domain} has no ${item}`);
    return schemas[item].oneOf.map((w) => ({ item, w }));
  });
  const codes = {};
  for (const { w } of words) codes[w.title] = { code: w.const, text: { en: w['x-text'] }, ...(w['x-args'] ? { args: w['x-args'] } : {}) };
  const out = { 'schema/codes.json': text({ kind: 'codes', doc: SHEET_DOC, codes }) };
  for (const f of readdirSync(join(domain, 'catalogs')).filter((n) => n.endsWith('.json')).sort()) {
    const cat = JSON.parse(readFileSync(join(domain, 'catalogs', f), 'utf8'));
    const messages = {};
    for (const { item, w } of words) {
      const entry = cat.messages[`${item}.${w.const}`];
      if (entry === undefined) throw new Error(`codes-render: the ${cat.lang} catalog of the panel domain has no ${item}.${w.const}`);
      messages[w.const] = entry;
    }
    out[`catalogs/${f}`] = text({ kind: 'catalog', lang: cat.lang, owner: OWNER, messages });
  }
  return out;
}

if (isMain(import.meta.url)) {
  const at = process.argv.indexOf('--contract-dir');
  const files = renderAll(at >= 0 ? process.argv[at + 1] : CONTRACT_DIR);
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([f, t]) => {
      try {
        return readFileSync(join(ROOT, f), 'utf8') !== t;
      } catch {
        return true;
      }
    }).map(([f]) => f);
    if (stale.length) {
      console.error(`codes-render: not what the panel domain gives: ${stale.join(', ')}: run node tools/codes-render.mjs, then commit`);
      process.exit(1);
    }
    console.log(`codes-render: schema/codes.json and ${Object.keys(files).length - 1} catalogs are what the panel domain gives`);
  } else {
    for (const [f, t] of Object.entries(files)) writeFileSync(join(ROOT, f), t);
    console.log(`codes-render: wrote ${Object.keys(files).join(', ')}`);
  }
}
