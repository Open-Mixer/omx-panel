// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// A page is named by the labels the description declares, never by the controls it holds (docs/panel-layout.md, Pages).
// Zynthian showed omx-strip's pages as "Gate: Gate - Gate Knee End", "Gate: Gate - Gate Knee End 2" and
// "EQ: EQ 2 Type - EQ 2 2": the group word repeated and a continuation's bare "2". By hand-built layouts in omx-strip's
// shape (its Gate section of ten controls, its EQ section of the EQ switch, the band count and grouped bands).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GROUP, pagesOf } from '../tools/panel-description.mjs';

const control = (param, label, section, group) => ({ param, label, symbol: `s${param}`, section, ...(group ? { [GROUP]: group } : {}) });
const strip = () => ({
  sections: [{ label: 'Gate' }, { label: 'EQ' }],
  controls: [
    ...['Gate', 'Gate Threshold', 'Gate Ratio', 'Gate Range', 'Gate Attack', 'Gate Release', 'Gate Knee Start', 'Gate Knee End', 'Gate Hold', 'Gate Hysteresis']
      .map((l, i) => control(i + 1, l, 0, 'Gate')),
    control(20, 'EQ', 1, 'EQ'),
    control(21, 'EQ Bands', 1, 'EQ'),
    ...[1, 2].flatMap((n) => ['Type', 'Freq', 'Gain', 'Q', ''].map((l, i) => control(30 + 10 * n + i, `EQ ${n}${l ? ` ${l}` : ''}`, 1, `EQ / EQ ${n}`))),
  ],
});
const names = (pages) => pages.map((p) => p.pageName);

test('at 8: a section of one group is named by its section, its second page numbered', () => {
  const pages = pagesOf(strip(), { perPage: 8 });
  assert.deepEqual(names(pages), ['Gate', 'Gate 2/2', 'EQ', 'EQ: EQ 2']);
});

test('at 4: a page of one group is <section>: <group>, and a repeated name is numbered from its second page', () => {
  const pages = pagesOf(strip(), { perPage: 4 });
  assert.deepEqual(names(pages), ['Gate', 'Gate 2/3', 'Gate 3/3', 'EQ', 'EQ: EQ 1', 'EQ: EQ 1 2/2', 'EQ: EQ 2', 'EQ: EQ 2 2/2']);
});

test('no page name repeats a group word or holds a control range', () => {
  for (const perPage of [2, 3, 4, 8]) {
    for (const name of names(pagesOf(strip(), { perPage }))) {
      assert.doesNotMatch(name, / - /, `${name} at ${perPage}`);
      assert.doesNotMatch(name, /^(\w+): \1$/, `${name} at ${perPage}`);
      assert.doesNotMatch(name, / \d+ \d+$/, `${name} at ${perPage}: a bare continuation number`);
    }
  }
});

test('a declared page wider than the surface runs on as name, name 2/N', () => {
  const pages = pagesOf(strip(), { perPage: 4, remote: [{ name: 'Gate', ids: [1, 2, 3, 4, 5, 6, 7, 8] }, { name: 'Hold', ids: [9, 10] }] });
  assert.deepEqual(names(pages), ['Gate', 'Gate 2/2', 'Hold']);
});

test('a declared page holding exactly the Easy controls is the Easy page, not cut twice', () => {
  const x = { ...strip(), easy: ['s2', 's3'] };
  const pages = pagesOf(x, { perPage: 4, remote: [{ name: 'Easy', ids: [2, 3, null, null] }, { name: 'Gate', ids: [1, 4] }] });
  assert.deepEqual(pages.map((p) => [p.pageName, p.ids]), [['Easy', [2, 3, null, null]], ['Gate', [1, 4, null, null]]]);
  // a declared page that only shares some Easy controls is the plugin's own page: kept, not edited
  const kept = pagesOf(x, { perPage: 4, remote: [{ name: 'Mix', ids: [2, 9] }] });
  assert.deepEqual(names(kept), ['Easy', 'Mix']);
});
