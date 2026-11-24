// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * console-map-render.mjs — the map table of docs/modgui.md ("The map: the console's vintage, element by element"), printed
 * from tools/look/console-map.json, the MAP itself (#69). The table sits between the two marker comments; nothing between
 * them is typed by hand, so a row cannot be edited in the document and not in the map. A table that differs from the
 * committed one is red (--check, `make console-map`, test/console-map-render.test.mjs).
 *
 *   node tools/console-map-render.mjs           write the table into docs/modgui.md
 *   node tools/console-map-render.mjs --check   exit 1 when docs/modgui.md's table is not what the map gives
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '@openmixer/omx-contract/entry';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MAP_FILE = join(ROOT, 'tools/look/console-map.json');
export const DOC_FILE = join(ROOT, 'docs/modgui.md');
export const BEGIN = '<!-- the map table: printed from tools/look/console-map.json by tools/console-map-render.mjs, do not edit by hand -->';
export const END = '<!-- end of the map table -->';

/** A cell's text: a `|` would end the cell, so it is escaped as Markdown reads it. */
const cell = (s) => String(s).replaceAll('|', '\\|');

/** The table's lines for the map's rows: one row per map row, in the map's order. */
export function mapTable(rows) {
  const lines = ['| Row | Console element | MOD GUI element | Pinned tokens |', '|---|---|---|---|'];
  for (const r of rows) {
    const tokens = r.ownerMock ? "none (the owner's mock)" : r.tokens.map((t) => `\`${t}\``).join(', ');
    lines.push(`| \`${r.id}\` | ${cell(r.console)} | ${cell(r.modgui)} | ${tokens} |`);
  }
  return lines.join('\n');
}

/** `doc` with the text between the markers replaced by the table of `rows`; throws when the markers are not there once each, in order. */
export function withTable(doc, rows) {
  const b = doc.indexOf(BEGIN);
  const e = doc.indexOf(END);
  if (b < 0 || e < b || doc.indexOf(BEGIN, b + 1) >= 0 || doc.indexOf(END, e + 1) >= 0)
    throw new Error('console-map-render: docs/modgui.md holds the map table\'s two markers once each, the begin before the end');
  return `${doc.slice(0, b + BEGIN.length)}\n${mapTable(rows)}\n${doc.slice(e)}`;
}

if (isMain(import.meta.url)) {
  const rows = JSON.parse(readFileSync(MAP_FILE, 'utf8')).rows;
  const doc = readFileSync(DOC_FILE, 'utf8');
  const text = withTable(doc, rows);
  if (process.argv.includes('--check')) {
    if (text !== doc) {
      console.error('console-map-render: docs/modgui.md\'s map table is not what tools/look/console-map.json gives: run node tools/console-map-render.mjs, then commit');
      process.exit(1);
    }
    console.log('console-map-render: docs/modgui.md\'s map table is what tools/look/console-map.json gives');
  } else {
    writeFileSync(DOC_FILE, text);
    console.log('console-map-render: wrote the map table into docs/modgui.md');
  }
}
