// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * codes-render.mjs — schema/codes.json (the refusal codes omx-panel emits and the words its surfaces draw of their own, omx-contract's codes shape) and
 * catalogs/<lang>.json (their sentences in each language) rendered from the two domains omx-panel owns: PANEL_SKIN_CODES,
 * PANEL_MODGUI_CODES, PANEL_DESCRIBE_CODES and PANEL_LABELS of contract.d/panel/panel.json (sorting pass row V3), then GESTURES_CODES
 * of contract.d/gestures/gestures.json (#106: a gesture refusal's const is its code word panel.gesture.<kebab>, its x-name the
 * GESTURE_* name the units answer), each word's const the code, title its key, x-text its English sentence,
 * x-args its placeholders, and each domain's catalogs. Neither file is written by hand; the surfaces and the console read
 * them as before.
 *
 *   node tools/codes-render.mjs                              write schema/codes.json and catalogs/<lang>.json
 *   node tools/codes-render.mjs --check                      exit 1 when a file is not what the domains give
 *   node tools/codes-render.mjs [--check] --contract-dir <d> read <d>/panel/ and <d>/gestures/ instead of this tree's
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '@openmixer/omx-contract/entry';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CONTRACT_DIR = join(ROOT, 'contract.d');
/** The items the sheet is made of, in the sheet's order, each with the domain that declares it. */
export const SHEET_ITEMS = [
  { domain: 'panel', item: 'PANEL_SKIN_CODES' },
  { domain: 'panel', item: 'PANEL_MODGUI_CODES' },
  { domain: 'panel', item: 'PANEL_DESCRIBE_CODES' },
  { domain: 'panel', item: 'PANEL_LABELS' },
  { domain: 'gestures', item: 'GESTURES_CODES' },
];
const SHEET_DOC = "The refusal codes omx-panel emits, by the code word a refusal carries, and the words its surfaces draw of their own (panel.label.*, by the key a description serves), each with its source sentence in English and the placeholders it may use (omx-contract's codes shape; translations are not here). Each language's sentences are in catalogs/<lang>.json, keyed by the code. The surfaces read both; no module repeats a sentence. A code is never reworded.";
const OWNER = 'omx-panel';

const text = (v) => `${JSON.stringify(v, null, 2)}\n`;

/** Every rendered file of the domains at `dir` (a contract directory holding panel/ and gestures/): `{ <path in the tree>: <text> }`. */
export function renderAll(dir = CONTRACT_DIR) {
  const schemas = {};
  const words = SHEET_ITEMS.flatMap(({ domain, item }) => {
    schemas[domain] ??= JSON.parse(readFileSync(join(dir, domain, `${domain}.json`), 'utf8')).components.schemas;
    if (!schemas[domain][item]) throw new Error(`codes-render: the ${domain} domain at ${join(dir, domain)} has no ${item}`);
    return schemas[domain][item].oneOf.map((w) => ({ domain, item, w }));
  });
  const codes = {};
  for (const { item, w } of words) {
    if (w.title in codes) throw new Error(`codes-render: ${item}.${w.const} has the key '${w.title}' another code of the sheet has`);
    codes[w.title] = { code: w.const, text: { en: w['x-text'] }, ...(w['x-args'] ? { args: w['x-args'] } : {}) };
  }
  const out = { 'schema/codes.json': text({ kind: 'codes', doc: SHEET_DOC, codes }) };
  // the languages are the panel domain's; every other domain of the sheet has a catalog for each of them
  for (const f of readdirSync(join(dir, 'panel', 'catalogs')).filter((n) => n.endsWith('.json')).sort()) {
    const cats = {};
    const catalog = (domain) => (cats[domain] ??= JSON.parse(readFileSync(join(dir, domain, 'catalogs', f), 'utf8')));
    const lang = catalog('panel').lang;
    const messages = {};
    for (const { domain, item, w } of words) {
      const entry = catalog(domain).messages[`${item}.${w.const}`];
      if (entry === undefined) throw new Error(`codes-render: the ${lang} catalog of the ${domain} domain has no ${item}.${w.const}`);
      messages[w.const] = entry;
    }
    out[`catalogs/${f}`] = text({ kind: 'catalog', lang, owner: OWNER, messages });
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
      console.error(`codes-render: not what the domains give: ${stale.join(', ')}: run node tools/codes-render.mjs, then commit`);
      process.exit(1);
    }
    console.log(`codes-render: schema/codes.json and ${Object.keys(files).length - 1} catalogs are what the domains give`);
  } else {
    for (const [f, t] of Object.entries(files)) writeFileSync(join(ROOT, f), t);
    console.log(`codes-render: wrote ${Object.keys(files).join(', ')}`);
  }
}
