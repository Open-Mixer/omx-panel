// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * unit-text.test.mjs — what a face shows a person for a unit is the x-symbol of its PARAM_UNITS id (C2): a served param whose
 * stated unit has no served token carries it as unitText. The descriptor's word stays the id.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { servedParamOf } from '../dist/tools/describe.mjs';

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
