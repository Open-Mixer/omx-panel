// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The map table of docs/modgui.md is printed from tools/look/console-map.json (#69): the committed table is what the map gives,
// row for row and cell for cell, so a row edited in one place and not the other is red.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BEGIN, DOC_FILE, END, MAP_FILE, mapTable, withTable } from '../tools/console-map-render.mjs';

const ROWS = JSON.parse(readFileSync(MAP_FILE, 'utf8')).rows;
const DOC = readFileSync(DOC_FILE, 'utf8');

test('docs/modgui.md\'s map table is the one tools/look/console-map.json gives', () => {
  assert.equal(withTable(DOC, ROWS), DOC);
});

test('the table has one line per map row, in the map\'s order, each opening with its id', () => {
  const body = DOC.slice(DOC.indexOf(BEGIN) + BEGIN.length, DOC.indexOf(END)).trim().split('\n').slice(2);
  assert.deepEqual(body.map((l) => l.split(' | ')[0]), ROWS.map((r) => `| \`${r.id}\``));
});

test('a cell edited in the document and not in the map is red, and so is a row the map gained', () => {
  const edited = DOC.replace('| knob film strip, the rim |', '| knob film strip, the bright rim |');
  assert.notEqual(edited, DOC, 'the edit landed');
  assert.notEqual(withTable(edited, ROWS), edited);
  const grown = [...ROWS, { id: 'new-row', console: 'a console element', modgui: '.omx-new', tokens: ['console:--glass'] }];
  assert.notEqual(withTable(DOC, grown), DOC);
  assert.match(mapTable(grown), /\| `new-row` \| a console element \| \.omx-new \| `console:--glass` \|$/);
});

test('a document without the markers is refused, never written blind', () => {
  assert.throws(() => withTable(DOC.replace(BEGIN, ''), ROWS), /markers once each/);
  assert.throws(() => withTable(`${DOC}\n${END}\n`, ROWS), /markers once each/);
});

test('--check passes on the committed tree', () => {
  const out = execFileSync(process.execPath, ['tools/console-map-render.mjs', '--check'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.match(out, /is what tools\/look\/console-map.json gives/);
});
