// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * unit-text.test.mjs — what a face shows a person for a unit is the x-symbol of its PARAM_UNITS id (C2): a served param whose
 * stated unit has no served token carries it as unitText, and every meter of the description carries its unit's x-symbol
 * as unitText, the caption the renderer draws (renderer/test/meter-caption.test.mjs). The descriptor's word stays the id.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describe, servedParamOf } from '../dist/tools/describe.mjs';
import { standardUnits, unitSymbolOf } from '../dist/tools/vocabulary.mjs';

const travel = (name, t = {}) => ({ name, kind: 'travel', travel: { min: 0, max: 1, unit: 'unknown', scale: 'linear', default: 0, ...t } });

test('a stated unit with no served token is served as unitText, its display spelling', () => {
  const p = servedParamOf({ id: 'f', symbol: 'f', ...travel('Distance', { unit: 'furlong' }) });
  assert.equal(p.unit, 'none');
  assert.equal(p.unitText, 'furlong', 'a unit PARAM_UNITS does not hold is shown as written');
});

test('arm: a served unit carries no unitText, and none states no unit', () => {
  assert.equal(servedParamOf({ id: 'g', symbol: 'g', ...travel('Gain', { unit: 'dB' }) }).unitText, undefined);
  assert.equal(servedParamOf({ id: 'n', symbol: 'n', ...travel('Amount', { unit: 'none' }) }).unitText, undefined);
});

test('every meter of the description carries its unit\'s x-symbol as unitText; the unit stays the id', () => {
  const level = ['dBFS', 'dBTP', 'LUFS'].filter((u) => standardUnits().has(u));
  assert.ok(level.length > 0, 'PARAM_UNITS holds the level units');
  const meters = level.map((unit, i) => ({ id: `m${i}`, symbol: `m${i}`, kind: 'level', channels: 1, unit, min: -60, max: 0, scale: 'linear', measurement: 'peak' }));
  const descriptor = {
    origin: 'scanned', plugin: { id: 'urn:test:plugin', format: 'lv2', name: 'Test', features: ['audio-effect'] },
    controls: [travel('gain', { min: -12, max: 12, unit: 'dB' })].map((c, i) => ({ id: `c${i}`, symbol: `c${i}`, ...c })), ports: [], meters,
  };
  const served = describe(descriptor).description.meters;
  assert.deepEqual(served.map((m) => [m.unit, m.unitText]), level.map((u) => [u, unitSymbolOf(u)]));
});
