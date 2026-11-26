// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The extra number in a CLAP name (#97, arm 1). A CLAP scan names no symbol, so a band's instance number is read from the
 * parameter's NAME (docs/group-model.md, "A descriptor of any origin is read"). A name that carries another number besides the
 * band's ("Band 3 Gain 2", a "2nd order" slope) gives the reader two numbers: the band's is the one that varies across the
 * group while the rest of the name stays put, so such a control joins its band; a true grid, where both numbers vary, is still
 * refused as two indices. Over scanned CLAP descriptors with no declared group, as a host's scan writes them.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { controlsOfDescriptor, inferGroupModel } from '../dist/tools/group-model.mjs';

let nextId = 100;
const travel = (name, unit, min, max) => ({ id: nextId++, name, kind: 'travel', travel: { min, max, default: min, unit } });
/** A scanned CLAP EQ of `bands` bands, no group declared; `extra(n)` the band's names that carry a second number. */
function scan(bands, extra) {
  const controls = [];
  for (let n = 1; n <= bands; n++) {
    controls.push(travel(`Band ${n} Frequency`, 'Hz', 20, 20000), travel(`Band ${n} Gain`, 'dB', -18, 18), travel(`Band ${n} Q`, 'unknown', 0.1, 10), ...extra(n));
  }
  return { origin: 'scanned', plugin: { id: 'org.example.eq', format: 'clap', name: 'EQ' }, controls, ports: [] };
}
const model = (d) => inferGroupModel(controlsOfDescriptor(d)).groups;
const keyOf = (d, name) => `p${d.controls.find((c) => c.name === name).id}`;

test('a second number in every band\'s name ("Band 3 Drive 2") does not take the control out of its band', () => {
  const d = scan(4, (n) => [travel(`Band ${n} Drive 2`, 'dB', 0, 12)]);
  const groups = model(d);
  assert.equal(groups.length, 1, JSON.stringify(groups.map((g) => [g.kind, g.reason, g.detail])));
  const [g] = groups;
  assert.deepEqual({ kind: g.kind, reason: g.reason ?? null }, { kind: 'repeated', reason: null }, g.detail);
  assert.deepEqual(g.instances.map((i) => i.label), ['Band 1', 'Band 2', 'Band 3', 'Band 4']);
  for (const [i, band] of g.instances.entries()) {
    const n = i + 1;
    assert.ok(Object.values(band.parameters).includes(keyOf(d, `Band ${n} Drive 2`)), `Band ${n} lacks its Drive 2: ${JSON.stringify(band.parameters)}`);
    assert.equal(band.parameters.freq, keyOf(d, `Band ${n} Frequency`));
  }
});

test('a "2nd order" slope, a number in the name that is no band\'s, sits in its band', () => {
  const d = scan(3, (n) => [{ id: nextId++, name: `Band ${n} 2nd Order`, kind: 'toggle' }]);
  const [g] = model(d);
  assert.equal(g.kind, 'repeated', `${g.reason}: ${g.detail}`);
  for (const [i, band] of g.instances.entries()) assert.ok(Object.values(band.parameters).includes(keyOf(d, `Band ${i + 1} 2nd Order`)) || band.on?.symbol === keyOf(d, `Band ${i + 1} 2nd Order`));
});

test('a grid, where both numbers vary ("Send 1 Bus 2" for every send and bus), is still two indices', () => {
  const controls = [];
  for (let s = 1; s <= 3; s++) for (let b = 1; b <= 3; b++) controls.push(travel(`Send ${s} Bus ${b}`, 'dB', -60, 6));
  const [g] = model({ origin: 'scanned', plugin: { id: 'org.example.grid', format: 'clap', name: 'Grid' }, controls, ports: [] });
  assert.equal(g.kind, 'list');
  assert.equal(g.reason, 'two-indices');
});
