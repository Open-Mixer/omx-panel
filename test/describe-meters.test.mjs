// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * describe-meters.test.mjs — the meters of the panel description (contract 7.9, omx-dsp#301): `describe` reads the
 * descriptor's `meters` word, one meter control each with { kind, measurement, unit, min, max, channels, symbol, held, clip };
 * a dynamics family's gain reduction is its section's gain_reduction_bar, the transfer curve's operating point reads the input
 * and output meters, a foreign read-only level control stays a meter with no measurement, and a name that is an analogue
 * input state is refused by code. Meter facts stay out of the canonical form and the fingerprint. Each rule is held by
 * value, with an arm that breaks its input and reads the result change.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describe, DESCRIBE_CODES } from '../dist/tools/describe.mjs';
import { MEASUREMENTS } from '../dist/tools/panel-description.mjs';

const travel = (name, meaning, t = {}, extra = {}) => ({ name, kind: 'travel', ...(meaning ? { meaning } : {}), travel: { min: 0, max: 1, unit: 'unknown', scale: 'linear', default: 0, ...t }, ...extra });
const dyn = () => ['threshold', 'ratio', 'attack', 'release'].map((n) => travel(n, n, { min: n === 'ratio' ? 1 : -60, max: n === 'ratio' ? 20 : 0, unit: n === 'ratio' ? 'ratio' : n === 'threshold' ? 'dB' : 'ms' }));
const meter = (symbol, kind, extra = {}) => ({ id: symbol, symbol, kind, channels: 1, unit: kind === 'level' ? 'dBFS' : 'dB', min: kind === 'level' ? -60 : -24, max: kind === 'level' ? 0 : 0, scale: 'linear', ...extra });
const descriptor = (controls, meters, extra = {}) => ({
  origin: 'scanned', plugin: { id: 'urn:test:plugin', format: 'lv2', name: 'Test', features: ['audio-effect'] },
  controls: controls.map((c, i) => ({ id: `c${i}`, symbol: `c${i}`, ...c })), ports: [],
  extensions: { lv2: { 'lv2:CompressorPlugin': true } }, ...(meters ? { meters } : {}), ...extra,
});
const METERS = [
  meter('in_level', 'level', { measurement: 'peak', held: true, clip: true, channels: 2 }),
  meter('out_level', 'level', { measurement: 'true-peak', unit: 'dBTP', held: true, clip: true, channels: 2 }),
  meter('gr', 'gain-reduction', { measurement: 'gain-reduction', held: true }),
];

test('the descriptor meters word becomes meter controls, in order, with their facts', () => {
  const { description, refusals } = describe(descriptor(dyn(), METERS));
  assert.deepEqual(refusals, []);
  assert.deepEqual(description.meters.map((m) => [m.symbol, m.kind, m.measurement, m.unit, m.min, m.max, m.channels, m.held, m.clip]), [
    ['in_level', 'level', 'peak', 'dBFS', -60, 0, 2, true, true],
    ['out_level', 'level', 'true-peak', 'dBTP', -60, 0, 2, true, true],
    ['gr', 'gain-reduction', 'gain-reduction', 'dB', -24, 0, 1, true, false],
  ]);
});
test('arm: a descriptor with no meters word serves no meters', () => {
  assert.deepEqual(describe(descriptor(dyn())).description.meters, []);
});
test('held and clip default to false when the descriptor does not say; clip is digital only', () => {
  const m = describe(descriptor(dyn(), [meter('a', 'level', { measurement: 'lufs-m', unit: 'LUFS', min: -70, max: 0, clip: true }), meter('b', 'level', { measurement: 'peak' })])).description.meters;
  assert.deepEqual(m.map((x) => [x.held, x.clip]), [[false, false], [false, false]]);
});
test('the measurements are the descriptor\'s six, and rms, vu and ppm are not among them', () => {
  assert.deepEqual(MEASUREMENTS, ['peak', 'true-peak', 'lufs-m', 'lufs-s', 'lufs-i', 'lra']);
  for (const w of ['rms', 'vu', 'ppm']) assert.ok(!MEASUREMENTS.includes(w));
});
test('a dynamics family\'s gain reduction is its section\'s gain_reduction_bar, read from the meters', () => {
  const { description } = describe(descriptor(dyn(), METERS));
  const bar = description.displays.find((d) => d.kind === 'gain_reduction_bar');
  assert.ok(bar);
  assert.equal(bar.source, 'meters');
  assert.deepEqual(bar.meterIds, [2, null]);
  assert.equal(description.meters[bar.meterIds[0]].kind, 'gain-reduction');
});
test('arm: with no gain-reduction meter there is no bar; a family that is not dynamics draws none', () => {
  assert.equal(describe(descriptor(dyn(), METERS.slice(0, 2))).description.displays.some((d) => d.kind === 'gain_reduction_bar'), false);
  const plain = descriptor([travel('gain', 'gain', { min: -12, max: 12, unit: 'dB' })], METERS, { extensions: undefined });
  assert.equal(describe(plain).description.displays.some((d) => d.kind === 'gain_reduction_bar'), false);
});
test('the transfer curve\'s operating point reads the input and output meters', () => {
  const { description } = describe(descriptor(dyn(), METERS));
  assert.deepEqual(description.displays.find((d) => d.kind === 'transfer_curve').meterIds, [0, 1]);
});
test('arm: without both a named input and output level meter the curve reads none', () => {
  assert.deepEqual(describe(descriptor(dyn(), [METERS[0], METERS[2]])).description.displays.find((d) => d.kind === 'transfer_curve').meterIds, [null, null]);
});
test('a foreign read-only control in a level unit stays a meter: measurement null, held false, clip false', () => {
  const d = descriptor([...dyn(), travel('peak out', undefined, { min: -60, max: 0, unit: 'dB' }, { readonly: true, id: 'peak_out', symbol: 'peak_out' })]);
  const { description } = describe(d);
  assert.deepEqual(description.meters.map((m) => [m.symbol, m.kind, m.measurement, m.unit, m.held, m.clip]), [['peak_out', 'level', null, 'dB', false, false]]);
});
test('arm: a read-only control in a unit that is no level stays a display and is no meter', () => {
  const d = descriptor([...dyn(), travel('rate', undefined, { min: 0, max: 10, unit: 'Hz' }, { readonly: true, id: 'rate', symbol: 'rate' })]);
  assert.deepEqual(describe(d).description.meters, []);
});
test('a meter whose name is phantom, pad or head-amp state is refused by code, and not served', () => {
  for (const sym of ['phantom_on', 'pad_state', 'head_amp_gain']) {
    const { description, refusals } = describe(descriptor(dyn(), [METERS[0], meter(sym, 'level', { measurement: 'peak' })]));
    assert.deepEqual(description.meters.map((m) => m.symbol), ['in_level'], sym);
    assert.deepEqual(refusals.map((r) => [r.code, r.args.symbol]), [[DESCRIBE_CODES.meterRefused, sym]], sym);
  }
});
test('a foreign read-only control whose meaning names such a state is refused, too', () => {
  const d = descriptor([...dyn(), travel('Input', 'padState', { min: -60, max: 0, unit: 'dB' }, { readonly: true, id: 'in_state', symbol: 'in_state' })]);
  const { description, refusals } = describe(d);
  assert.deepEqual(description.meters, []);
  assert.equal(refusals[0].code, DESCRIBE_CODES.meterRefused);
});
test('arm: a name that merely contains the letters is no state (a gain "pad"ded word, "keypad" is none either way)', () => {
  const { description, refusals } = describe(descriptor(dyn(), [meter('spade_level', 'level', { measurement: 'peak' })]));
  assert.deepEqual(description.meters.map((m) => m.symbol), ['spade_level']);
  assert.deepEqual(refusals, []);
});
test('the meters stay out of the canonical form and the fingerprint', () => {
  const a = describe(descriptor(dyn(), METERS)).description;
  const b = describe(descriptor(dyn())).description;
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notDeepEqual(a.displays.map((d) => d.kind), b.displays.map((d) => d.kind));
});
test('arm: the fingerprint does move with a control, so the equality above is not vacuous', () => {
  const c = dyn(); c.push(travel('makeup', 'makeupGain', { min: 0, max: 24, unit: 'dB' }));
  assert.notEqual(describe(descriptor(c, METERS)).description.fingerprint, describe(descriptor(dyn(), METERS)).description.fingerprint);
});
test('no ballistics in a description: a meter carries no release, fall or attack', () => {
  for (const m of describe(descriptor(dyn(), METERS)).description.meters) for (const k of Object.keys(m)) assert.ok(!/release|fall|attack|ballistic|decay/i.test(k), k);
});
