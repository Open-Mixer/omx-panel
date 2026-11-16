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
function face(name) {
  const lay = layout(resolvePanel(descriptor(name), { stem: name }));
  const at = new Map(lay.sections.flatMap((s) => s.controls.map((k) => [k.symbol, { x: s.x + k.x, y: s.y + k.y, section: s.key, name: k.name }])));
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

test('omx-strip: its EQ is 32 columns headed by eqN On, its own on and band count above; its Filters and Gate stay flowed lists', () => {
  const { at } = face('omx-strip');
  const bands = Array.from({ length: 32 }, (_, i) => i + 1);
  for (const p of ['Type', 'Freq', 'Gain', 'Q', 'On']) assert.equal(new Set(bands.map((b) => at.get(`eq${b}${p}`).y)).size, 1, p);
  const xs = bands.map((b) => at.get(`eq${b}Freq`).x);
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]));
  assert.ok(at.get('eqOn').y < at.get('eq1On').y && at.get('eqBands').y < at.get('eq1On').y);
  assert.notEqual(at.get('hpfFreq').section, at.get('eq1Freq').section);
});

test('the MOD GUI template places every band control at its cell, by the layout', () => {
  const out = generateModgui(descriptor('omx-eq8'), { stem: 'omx-eq8', source: 'test' });
  const html = String(out.find(([path]) => /icon-.*\.html$/.test(path))[1]);
  const left = (sym) => Number(new RegExp(`left:(\\d+)px;top:(\\d+)px[^"]*"[^>]*data-symbol="${sym}"`).exec(html)?.[1]);
  assert.ok(left('hpf_freq') < left('b1_freq') && left('b8_freq') < left('lpf_freq'), `${left('hpf_freq')} ${left('b1_freq')} ${left('b8_freq')} ${left('lpf_freq')}`);
});
