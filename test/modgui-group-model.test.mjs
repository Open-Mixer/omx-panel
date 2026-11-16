// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * modgui-gen draws a repeated group by the group model's matrix (docs/group-model.md, "The consumers"): over the corpus'
 * omx-plugins descriptors, the same parameter of every band on one row, the bands as columns left to right low to high,
 * the high-pass leftmost and the low-pass rightmost, the band's on/off at its head; never flowed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { generateModgui, layout, resolvePanel } from '../tools/modgui-gen.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'group-model', 'omx-plugins');
const descriptor = (name) => JSON.parse(readFileSync(join(DIR, `${name}.descriptor.json`), 'utf8'));
/** The face's boxes for a descriptor, and each drawn control by symbol at its absolute place. */
function face(name, edit = (d) => d) {
  const lay = layout(resolvePanel(edit(descriptor(name)), { stem: name }));
  const at = new Map(lay.sections.flatMap((s) => s.controls.map((k) => [k.symbol, { x: s.x + k.x, y: s.y + k.y, section: s.key, name: k.name, widget: k.widget }])));
  return { lay, at };
}

for (const [name, n] of [['omx-eq8', 8], ['omx-eq16', 16], ['omx-eq32', 32]]) {
  test(`${name}: one section, HPF, bands 1..${n}, LPF as columns; each parameter on one row; the on/off at each head`, () => {
    const { lay, at } = face(name);
    const bands = Array.from({ length: n }, (_, i) => i + 1);
    const sections = new Set([...at.values()].map((p) => p.section));
    assert.equal(sections.size, 1, [...sections].join(', '));
    // the columns: hpf, b1..bn, lpf, strictly left to right
    const xs = [at.get('hpf_freq').x, ...bands.map((b) => at.get(`b${b}_freq`).x), at.get('lpf_freq').x];
    assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]), xs.join(' '));
    // one row per parameter, one column per band: never flowed
    for (const p of ['type', 'freq', 'gain', 'q', 'on']) assert.equal(new Set(bands.map((b) => at.get(`b${b}_${p}`).y)).size, 1, p);
    for (const b of bands) assert.equal(new Set(['type', 'freq', 'gain', 'q', 'on'].map((p) => at.get(`b${b}_${p}`).x)).size, 1, `band ${b}`);
    // the head row first, then type, slope, freq, gain, q
    const y = (sym) => at.get(sym).y;
    assert.ok(y('b1_on') < y('b1_type') && y('b1_type') < y('hpf_slope') && y('hpf_slope') < y('b1_freq') && y('b1_freq') < y('b1_gain') && y('b1_gain') < y('b1_q'));
    assert.equal(y('hpf_freq'), y('b1_freq'));
    assert.equal(y('lpf_on'), y('b1_on'));
    // a head is named by its band, a cell by its parameter
    assert.equal(at.get('b3_on').name, 'Band 3');
    assert.equal(at.get('b3_gain').name, 'Gain');
    assert.ok(lay.w >= (n + 2) * 72, `${lay.w}`);
  });
}

test('omx-strip: HPF first, LPF last, the first eqBands (4) bands between, each parameter on one row; filterOn stays in Filters', () => {
  const { at } = face('omx-strip');
  const bands = [1, 2, 3, 4];
  for (const p of ['Type', 'Freq', 'Gain', 'Q', 'On']) assert.equal(new Set(bands.map((b) => at.get(`eq${b}${p}`).y)).size, 1, p);
  const xs = [at.get('hpfFreq').x, ...bands.map((b) => at.get(`eq${b}Freq`).x), at.get('lpfFreq').x];
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]), xs.join(' '));
  assert.equal(at.get('hpfFreq').y, at.get('eq1Freq').y);
  assert.equal(at.get('hpfFreq').section, at.get('eq1Freq').section);
  assert.equal(at.get('lpfFreq').section, at.get('eq1Freq').section);
  assert.ok(at.get('eqOn').y < at.get('eq1On').y && at.get('eqBands').y < at.get('eq1On').y);
  assert.notEqual(at.get('filterOn').section, at.get('eq1Freq').section);
});

test('omx-strip: only the first eqBands instances are drawn, at the port\'s come-up value (4 of 32), no gap; the count is a selector', () => {
  const { at, lay } = face('omx-strip');
  for (const b of [5, 6, 17, 32]) assert.equal(at.has(`eq${b}Freq`), false, `eq${b}Freq is drawn`);
  assert.equal(at.get('eqBands').widget, 'selector');
  const xs = [1, 2, 3, 4].map((b) => at.get(`eq${b}Freq`).x);
  assert.ok(xs.every((x, i) => i === 0 || x - xs[i - 1] === xs[1] - xs[0]), xs.join(' '));
  assert.equal(at.get('lpfFreq').x - xs[3], xs[1] - xs[0], 'the low-pass closes up on the last live band');
  assert.ok(lay.w < 14 * 72, `${lay.w}`);
});

/** omx-delay with its tap count come up at `n`. */
const taps = (n) => (d) => { d.controls.find((c) => c.symbol === 'fxDelayTaps').travel.default = n; return d; };

test('omx-delay: the Taps are four columns at a count of 4, Time under tap 2..4 only, the count a selector', () => {
  const { at } = face('omx-delay', taps(4));
  const xs = [0, 1, 2, 3].map((i) => at.get(`tap${i}Gain`).x);
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]));
  for (const i of [1, 2, 3]) assert.equal(at.get(`tap${i}Factor`).x, at.get(`tap${i}Gain`).x, `tap ${i}`);
  assert.equal(new Set([1, 2, 3].map((i) => at.get(`tap${i}Factor`).y)).size, 1, 'Time is one row');
  assert.ok(at.get('tap1Factor').y > at.get('tap1Pan').y, 'Time is a row of the matrix, after Gain and Pan');
  assert.equal(at.has('tap0Factor'), false);
  assert.equal(at.get('fxDelayTaps').widget, 'selector');
});

test('omx-delay: at its come-up count (1) only tap 1 is drawn', () => {
  const { at } = face('omx-delay');
  assert.ok(at.has('tap0Gain') && at.has('tap0Pan'));
  for (const i of [1, 2, 3]) assert.equal(at.has(`tap${i}Gain`) || at.has(`tap${i}Factor`), false, `tap ${i + 1}`);
});

test('the MOD GUI template places every band control at its cell, by the layout', () => {
  const out = generateModgui(descriptor('omx-eq8'), { stem: 'omx-eq8', source: 'test' });
  const html = String(out.find(([path]) => /icon-.*\.html$/.test(path))[1]);
  const left = (sym) => Number(new RegExp(`left:(\\d+)px;top:(\\d+)px[^"]*"[^>]*data-symbol="${sym}"`).exec(html)?.[1]);
  assert.ok(left('hpf_freq') < left('b1_freq') && left('b8_freq') < left('lpf_freq'), `${left('hpf_freq')} ${left('b1_freq')} ${left('b8_freq')} ${left('lpf_freq')}`);
});
