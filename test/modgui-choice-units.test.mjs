// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// A choice's unit reaches the curve twin: a filter slope that is a CHOICE (12 or 24) has no unit in a descriptor, so the panel
// declares it (`panel.choiceUnits`, the panel description's own extras shape) and the MOD GUI's curve takes the roll-off
// in dB per octave. Without the declaration the twin has no slope term it can use (`termMissing`) and draws no curve.
// Needs the omx-dsp twin: it FAILS, never skips, without it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { generateModgui } from '../tools/modgui-gen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'test/fixtures/eq-marks');
const read = (f) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));
const d = read('eq.descriptor.json');
const panel = read('eq.panel.json');

test('the omx-dsp twin is installed', async () => {
  await import('@openmixer/omx-dsp');
});

const hpf = [
  { symbol: 'hf', id: 'hf', name: 'HPF Hz', kind: 'travel', travel: { min: 20, max: 2000, default: 400, unit: 'Hz' } },
  { symbol: 'hs', id: 'hs', name: 'HPF slope', kind: 'choice', ids: ['12', '24'], labels: ['12 dB/oct', '24 dB/oct'], values: [12, 24], default: '24' },
];
const poly = (patch) => {
  const p = { ...panel, sections: [{ ...panel.sections[0], controls: [...panel.sections[0].controls, 'hf', 'hs'] }], ...patch };
  const text = generateModgui({ ...d, controls: [...d.controls, ...hpf] }, { panel: p, stem: 'x', source: 't', look: 'console' }).find(([f]) => f.endsWith('.html'))[1].toString();
  return text.match(/<polyline class="omx-curve-line" fill="none" points="([^"]+)"/)?.[1] ?? null;
};
const roles = { ...panel.roles, hpf_freq: 'hf', hpf_slope: 'hs' };

test('a choice slope with its unit declared reaches the twin: the curve holds the high-pass roll-off', () => {
  const rolled = poly({ roles, choiceUnits: { hs: 'dB' } });
  assert.notEqual(rolled, null, 'no curve: the twin refused the slope term (termMissing)');
  assert.notEqual(rolled, poly({ roles: panel.roles }), 'a 400 Hz high-pass at 24 dB/oct moved nothing on the curve');
});

test('a unit on a choice that is no slope changes nothing', () => {
  assert.equal(poly({ roles: panel.roles, choiceUnits: { hs: 'dB' } }), poly({ roles: panel.roles }));
});

test('a choice slope in dB/oct, the unit omx-dsp\'s kernels spell for a filter slope, reaches the twin as a slope', () => {
  const rolled = poly({ roles, choiceUnits: { hs: 'dB/oct' } });
  assert.notEqual(rolled, null, 'no curve: dB/oct is no slope unit of the twin (termMissing)');
  assert.equal(rolled, poly({ roles, choiceUnits: { hs: 'dB' } }), 'dB/oct and dB are one slope');
});
