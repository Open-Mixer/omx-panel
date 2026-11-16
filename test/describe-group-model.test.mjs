// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The served description carries the group model (docs/group-model.md, "The served description carries the model"):
 * `omx-panel describe` gives the section that holds a repeated group `matrix: matrixOf(g)` in the symbols it serves, so the
 * C renderer and the console read it and never re-derive. Over the corpus' omx-plugins descriptors, through the command.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'test', 'fixtures', 'group-model', 'omx-plugins');
/** `omx-panel describe` of a corpus descriptor: its description. */
function describeOf(name) {
  const r = spawnSync(process.execPath, [join(ROOT, 'dist/bin/omx-panel.mjs'), 'describe', '--descriptor', join(DIR, `${name}.descriptor.json`)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).description;
}
const withMatrix = (d) => d.sections.filter((s) => s.matrix);
const sectionOf = (d, symbol) => d.controls.find((c) => c.symbol === symbol)?.section;

test('omx-eq8: one section carries the matrix, HPF first, the bands, LPF last, in served symbols', () => {
  const d = describeOf('omx-eq8');
  const [s, ...more] = withMatrix(d);
  assert.equal(more.length, 0);
  const m = s.matrix;
  assert.equal(m.orientation, 'columns');
  assert.deepEqual(m.heads.map((x) => x.edge), ['hpf', ...Array(8).fill(null), 'lpf']);
  assert.deepEqual(m.heads.map((x) => x.label), ['HPF', ...Array.from({ length: 8 }, (_, i) => `Band ${i + 1}`), 'LPF']);
  assert.deepEqual(m.heads[0].on, { symbol: 'hpf_on', sense: 'on' });
  assert.deepEqual(m.heads[1].on, { symbol: 'b1_on', sense: 'on' });
  assert.deepEqual(m.rows.map((r) => r.label), ['Type', 'Slope', 'Frequency', 'Gain', 'Q']);
  assert.deepEqual(Object.keys(m).sort(), ['cells', 'heads', 'orientation', 'rows']);
  const freq = m.rows.findIndex((r) => r.label === 'Frequency');
  assert.deepEqual(m.cells[freq], ['hpf_freq', ...Array.from({ length: 8 }, (_, i) => `b${i + 1}_freq`), 'lpf_freq']);
  assert.equal(m.count, undefined);
  // every cell is a control the description serves, in the section that carries the matrix; none is drawn twice
  for (const sym of m.cells.flat().filter(Boolean)) assert.equal(sectionOf(d, sym), s.key, sym);
  assert.equal(new Set(d.sections.map((x) => x.key)).size, d.sections.length);
});

test('omx-strip: HPF first, LPF last, 32 EQ columns between; the count is eqBands, drawn as a selector; filterOn stays in Filters', () => {
  const d = describeOf('omx-strip');
  const [s, ...more] = withMatrix(d);
  assert.equal(more.length, 0);
  assert.equal(s.key, 'eq');
  const m = s.matrix;
  assert.equal(m.heads.length, 34);
  assert.equal(m.heads[0].edge, 'hpf');
  assert.equal(m.heads.at(-1).edge, 'lpf');
  assert.equal(m.heads.filter((x) => x.edge === null).length, 32);
  assert.equal(m.cells.length, m.rows.length);
  assert.ok(m.cells.every((row) => row.length === 34));
  assert.deepEqual(m.count, { symbol: 'eqBands', default: 4 });
  assert.equal(sectionOf(d, 'hpfFreq'), 'eq');
  assert.equal(sectionOf(d, 'lpfSlope'), 'eq');
  assert.equal(sectionOf(d, 'filterOn'), 'filters');
  assert.equal(d.controls.find((c) => c.symbol === 'eqBands').widget, 'auto');
});

test('omx-delay: the Taps matrix carries Time under taps 2..4 with tap 1\'s cell empty, and fxDelayTaps as its count', () => {
  const d = describeOf('omx-delay');
  const [s] = withMatrix(d);
  const m = s.matrix;
  const time = m.rows.findIndex((r) => r.label === 'Time');
  assert.equal(m.orientation, 'columns');
  assert.deepEqual(m.cells[time], [null, 'tap1Factor', 'tap2Factor', 'tap3Factor']);
  assert.deepEqual(m.count, { symbol: 'fxDelayTaps', default: 1 });
});

test('omx-dyneq: the Band matrix keys type, freq, gain, q by their roles, and threshold and range as rows of their own', () => {
  const d = describeOf('omx-dyneq');
  const [s] = withMatrix(d);
  assert.deepEqual(s.matrix.rows.map((r) => r.label), ['Type', 'Freq', 'Gain', 'Q', 'Dynamics', 'Threshold', 'Ratio', 'Range', 'Attack', 'Release', 'Listen']);
});
