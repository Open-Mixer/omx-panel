// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Owner rule: "when we draw group items, like N EQs, they should be aligned." A repeated group (the EQ's bands) is an aligned MATRIX,
// never flowed: an EQ's bands are COLUMNS, left to right, low to high (HPF the leftmost, the bands in order, LPF the rightmost), each
// column stacking its parameters in the same order (on/off at the head), so the same parameter has the same y in every column; no band's
// controls wrap into another's. Read on the generated template of omx-strip's declared EQ (the band roles are arrays).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { generateModgui } from '../tools/modgui-gen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'test/fixtures/strip-eq');
const read = (f) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));
const descriptor = read('strip-eq.descriptor.json');
const declared = read('strip-eq.panel.json');
const html = (look = 'console', tier) => new Map(generateModgui(descriptor, { panel: declared, stem: 'strip-eq', source: 't', look, ...(tier ? { tier } : {}) })).get('modgui/icon-strip-eq.html').toString();

/** Every control of the EQ section: `{ symbol, col, row, x, y }`, the matrix attributes and the position the template gives it. */
const eqControls = (text) => {
  const sec = text.split('data-section="eq"')[1].split('<div class="omx-section"')[0];
  return [...sec.matchAll(/<div class="omx-control [^"]*"[^>]*data-symbol="([^"]+)"([^>]*)>/g)].map(([tag, symbol, rest]) => {
    const a = (n) => tag.match(new RegExp(`${n}="([^"]*)"`))?.[1];
    return { symbol, col: a('data-mx-col'), row: a('data-mx-row'), x: Number(tag.match(/left:(-?[\d.]+)px/)[1]), y: Number(tag.match(/top:(-?[\d.]+)px/)[1]), hidden: /display:none/.test(tag) };
  });
};
const matrix = (text) => eqControls(text).filter((k) => k.col !== undefined);

test('the EQ is a matrix: its bands are columns, HPF first and LPF last, low to high', () => {
  const shown = matrix(html()).filter((k) => !k.hidden);
  assert.ok(shown.length > 0, 'no control carries a matrix column');
  const order = [...new Set(shown.map((k) => k.col))];
  assert.deepEqual(order, ['hpf', 'b1', 'b2', 'b3', 'b4', 'lpf']);
  const xs = order.map((c) => shown.find((k) => k.col === c).x);
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b), 'the columns are not left to right');
  assert.equal(new Set(xs).size, xs.length);
});

test('every control of a column has that column\'s x, and the same parameter has the same y in every column', () => {
  const shown = matrix(html()).filter((k) => !k.hidden);
  assert.ok(shown.length > 0, 'no matrix');
  for (const col of new Set(shown.map((k) => k.col))) assert.equal(new Set(shown.filter((k) => k.col === col).map((k) => k.x)).size, 1, `${col}: its controls wrap`);
  for (const row of new Set(shown.map((k) => k.row))) assert.equal(new Set(shown.filter((k) => k.row === row).map((k) => k.y)).size, 1, `${row}: not on one y across the columns`);
  const pos = shown.map((k) => `${k.x},${k.y}`);
  assert.equal(new Set(pos).size, pos.length, 'two controls share a cell');
});

test('the on/off is the head of each column', () => {
  const shown = matrix(html()).filter((k) => !k.hidden);
  assert.ok(shown.length > 0, 'no matrix');
  const ys = (row) => shown.find((k) => k.row === row).y;
  for (const row of new Set(shown.map((k) => k.row))) if (row !== 'on') assert.ok(ys('on') < ys(row), `${row} sits above on`);
});

test('the bands past the count are not laid out', () => {
  const hidden = matrix(html()).filter((k) => k.hidden);
  assert.ok(hidden.length > 0);
});

test('a matrix cell is one column wide: a selector in a column never spans into the next', () => {
  const text = html();
  const sec = text.split('data-section="eq"')[1].split('<div class="omx-section"')[0];
  const cells = [...sec.matchAll(/<div class="omx-control [^"]*"[^>]*data-mx-col="[^"]*"[^>]*>/g)].map(([t]) => t);
  assert.ok(cells.length > 0);
  for (const tag of cells) assert.doesNotMatch(tag, /data-span=|width:\d+px/, 'a cell is wider than its column');
});
