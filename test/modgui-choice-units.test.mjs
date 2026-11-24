// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// A choice's unit reaches the curve twin: a filter slope that is a CHOICE (12 or 24) takes its unit from the descriptor's own
// `choiceUnits` (omx-contract: the control's name to its unit, declared once by the plugin, #68), and the MOD GUI's curve and the
// panel description take the roll-off in dB per octave. Without it the twin has no slope term it can use (`termMissing`). A panel
// block declares no unit: the schema has no word for it and panelLayout refuses the option.
// Needs the omx-dsp twin: it FAILS, never skips, without it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { generateModgui } from '../tools/modgui-gen.mjs';
import { panelLayout } from '../tools/panel-description.mjs';

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
const withHpf = (choiceUnits) => ({ ...d, controls: [...d.controls, ...hpf], ...(choiceUnits ? { choiceUnits } : {}) });
const poly = ({ choiceUnits, ...patch }) => {
  const p = { ...panel, sections: [{ ...panel.sections[0], controls: [...panel.sections[0].controls, 'hf', 'hs'] }], ...patch };
  const text = generateModgui(withHpf(choiceUnits), { panel: p, stem: 'x', source: 't', look: 'console' }).find(([f]) => f.endsWith('.html'))[1].toString();
  return text.match(/<polyline class="omx-curve-line" fill="none" points="([^"]+)"/)?.[1] ?? null;
};
const roles = { ...panel.roles, hpf_freq: 'hf', hpf_slope: 'hs' };

test('a choice slope with its unit declared reaches the twin: the curve holds the high-pass roll-off', () => {
  const rolled = poly({ roles, choiceUnits: { 'HPF slope': 'dB' } });
  assert.notEqual(rolled, null, 'no curve: the twin refused the slope term (termMissing)');
  assert.notEqual(rolled, poly({ roles: panel.roles }), 'a 400 Hz high-pass at 24 dB/oct moved nothing on the curve');
});

test('a unit on a choice that is no slope changes nothing', () => {
  assert.equal(poly({ roles: panel.roles, choiceUnits: { 'HPF slope': 'dB' } }), poly({ roles: panel.roles }));
});

test('a choice slope in dB/oct, the unit omx-dsp\'s kernels spell for a filter slope, reaches the twin as a slope', () => {
  const rolled = poly({ roles, choiceUnits: { 'HPF slope': 'dB/oct' } });
  assert.notEqual(rolled, null, 'no curve: dB/oct is no slope unit of the twin (termMissing)');
  assert.equal(rolled, poly({ roles, choiceUnits: { 'HPF slope': 'dB' } }), 'dB/oct and dB are one slope');
});

test('the served description carries the descriptor\'s choice unit on the slope role, as every host reads it', () => {
  const layout = (choiceUnits) => panelLayout(withHpf(choiceUnits), { panel: { ...panel, roles, sections: [{ ...panel.sections[0], controls: [...panel.sections[0].controls, 'hf', 'hs'] }] } });
  const x = layout({ 'HPF slope': 'dB' });
  assert.equal(x.roles.find((r) => r.symbol === 'hs')?.unit, 'dB', JSON.stringify(x.unpublished));
  // with no descriptor unit the role carries none: the unit came from the descriptor, nowhere else
  assert.equal(layout().roles.find((r) => r.symbol === 'hs')?.unit, '');
});

test('a choice unit offered as a layout option, or declared in a panel block, is refused: the descriptor holds it', () => {
  assert.throws(() => panelLayout(withHpf(), { panel, choiceUnits: { hs: 'dB/oct' } }), /choiceUnits is the descriptor's/);
  const schema = JSON.parse(readFileSync(join(ROOT, 'schema/panel.schema.json'), 'utf8'));
  assert.equal(schema.$defs.choiceUnits, undefined, 'the panel schema still declares choiceUnits for a plugin\'s declaration to reference');
});
