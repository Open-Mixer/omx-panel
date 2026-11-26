// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * describe-utility.test.mjs — the utility family (a trim, a width control, a balancer, a clipper): a plugin that declares the
 * family has it served, with the roles its declaration binds, and a role the family has no place for is not published. The
 * controls are omx-plugins' omx-trim and omx-width as their descriptors state them (no meaning, units as written).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describe } from '../dist/tools/describe.mjs';
import { FAMILIES } from '../dist/tools/panel-description.mjs';
import { EASY_ROLES } from '../dist/tools/easy.mjs';
import { REQUIRED_ROLES, ROLES } from '../dist/tools/role-table.mjs';

const travel = (symbol, name, unit, min, max, def) => ({ id: symbol, symbol, name, kind: 'travel', travel: { min, max, unit, scale: 'linear', default: def } });
const toggle = (symbol, name) => ({ id: symbol, symbol, name, kind: 'toggle' });
const descriptor = (id, controls) => ({ origin: 'authored', plugin: { id, format: 'lv2', name: id, features: ['audio-effect'] }, controls, ports: [] });

const trim = descriptor('urn:test:trim', [travel('trimDb', 'Trim', 'dB', -24, 24, 0)]);
const width = descriptor('urn:test:width', [
  travel('widthPct', 'Width', 'percent', 0, 200, 100), toggle('bassMono', 'Bass Mono'), travel('bassMonoHz', 'Bass Mono Frequency', 'Hz', 20, 500, 120),
]);
const panelOf = (roles, controls) => ({ family: 'utility', roles, sections: [{ key: 'u', label: 'Utility', controls }] });

test('utility is a family of the layout, with roles, a required one and an Easy row', () => {
  assert.ok(FAMILIES.includes('utility'));
  assert.deepEqual(Object.keys(ROLES.utility), ['gain', 'width', 'pseudo', 'pseudo_time', 'bass_mono', 'bass_mono_freq', 'amount', 'range', 'drive', 'ceiling', 'softness', 'speed', 'slope']);
  assert.deepEqual(REQUIRED_ROLES.utility, [['gain', 'width', 'amount', 'drive']]);
  assert.ok(EASY_ROLES.utility.length > 0 && EASY_ROLES.utility.length <= 6);
});

test('a trim that declares the utility family is served as utility, carrying its gain role, with no refusal', () => {
  const { description, refusals } = describe(trim, { panel: panelOf({ gain: 'trimDb' }, ['trimDb']) });
  assert.deepEqual(refusals, []);
  assert.equal(description.family, 'utility');
  assert.deepEqual(description.roles.map((r) => [r.role, r.symbol]), [['gain', 'trimDb']]);
});

test('a width control carries its width, bass-mono and bass-mono frequency roles', () => {
  const panel = panelOf({ width: 'widthPct', bass_mono: 'bassMono', bass_mono_freq: 'bassMonoHz' }, ['widthPct', 'bassMono', 'bassMonoHz']);
  const { description, refusals } = describe(width, { panel });
  assert.deepEqual(refusals, []);
  assert.equal(description.family, 'utility');
  assert.deepEqual(description.roles.map((r) => [r.role, r.symbol]).sort(), [['bass_mono', 'bassMono'], ['bass_mono_freq', 'bassMonoHz'], ['width', 'widthPct']]);
});

test('a balancer carries its amount, range, speed and slope roles: dB/oct is served (PARAM_UNITS_CLAP_ENCODED holds dBPerOct)', () => {
  const balancer = descriptor('urn:test:balancer', [
    travel('amountPct', 'Amount', 'percent', 0, 100, 0), travel('rangeDb', 'Range', 'dB', 1, 12, 3),
    travel('speedDbPerS', 'Speed', 'dB', 0.1, 6, 0.5), travel('slopeDbOct', 'Slope', 'dBPerOct', -6, 0, -3),
  ]);
  const panel = panelOf({ amount: 'amountPct', range: 'rangeDb', speed: 'speedDbPerS', slope: 'slopeDbOct' }, ['amountPct', 'rangeDb', 'speedDbPerS', 'slopeDbOct']);
  const { description, refusals } = describe(balancer, { panel });
  assert.deepEqual(refusals, []);
  assert.deepEqual(description.roles.map((r) => [r.role, r.symbol]).sort(), [['amount', 'amountPct'], ['range', 'rangeDb'], ['slope', 'slopeDbOct'], ['speed', 'speedDbPerS']]);
});

test('arm: a role the family has no place for is not served', () => {
  const { description } = describe(trim, { panel: panelOf({ gain: 'trimDb', threshold: 'trimDb' }, ['trimDb']) });
  assert.equal(description.family, 'utility');
  assert.deepEqual(description.roles.map((r) => r.role), ['gain']);
});

test('arm: a family the extension does not list is none, so utility is served only because it is listed', () => {
  const { description } = describe(trim, { panel: { ...panelOf({ gain: 'trimDb' }, ['trimDb']), family: 'utilityx' } });
  assert.equal(description.family, 'none');
});
