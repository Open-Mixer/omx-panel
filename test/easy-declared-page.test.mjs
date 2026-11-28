// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The plugin's declared Easy page is THE Easy page (docs/panel-layout.md, Pages): one Easy, from the plugin's declaration.
// omx-strip declares its remote-controls pages, Easy first, as the cut at eight of its declaration: Easy holds trimDb, hpfFreq,
// hpfSlope and lpfFreq (ids 1, 4, 5, 7). A scan of it keeps no meanings, so the rule derives a description `easy` of the first
// four controls in order (trimOn, trimDb, filterOn, hpfOn: ids 0..3), which is not the declared page; both were cut, and
// Zynthian showed two Easy pages, "Easy" and "Easy +" (2026-11-28). By hand-built layouts in omx-strip's shape.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { describe } from '../dist/tools/describe.mjs';
import { GROUP, pagesOf } from '../tools/panel-description.mjs';

const control = (param, symbol, label, section, group) => ({ param, symbol, label, section, ...(group ? { [GROUP]: group } : {}) });
const strip = () => ({
  sections: [{ label: 'Input' }, { label: 'Filters' }],
  controls: [
    control(0, 'trimOn', 'Input', 0), control(1, 'trimDb', 'Trim', 0),
    control(2, 'filterOn', 'Filters', 1), control(3, 'hpfOn', 'HPF', 1), control(4, 'hpfFreq', 'HPF Freq', 1),
    control(5, 'hpfSlope', 'HPF Slope', 1), control(6, 'lpfOn', 'LPF', 1), control(7, 'lpfFreq', 'LPF Freq', 1),
    control(8, 'lpfSlope', 'LPF Slope', 1),
  ],
  // the rule's easy of a scan: the first four in order
  easy: ['trimOn', 'trimDb', 'filterOn', 'hpfOn'],
});
// the plugin's remote-controls pages as plugin-hostd reports them (omx-plugins' generated OMX_STRIP_PANEL_PAGES)
const REMOTE = [
  { name: 'Easy', ids: [1, 4, 5, 7, null, null, null, null] },
  { name: 'Input', ids: [0, null, null, null, null, null, null, null] },
  { name: 'Filters', ids: [2, 3, 6, 8, null, null, null, null] },
];
const named = (pages) => pages.map((p) => [p.pageName, p.ids.filter((id) => id !== null)]);

for (const perPage of [4, 8]) {
  test(`at ${perPage}: one Easy page, the plugin's declared one, first`, () => {
    const pages = pagesOf(strip(), { perPage, remote: REMOTE });
    assert.deepEqual(named(pages), [['Easy', [1, 4, 5, 7]], ['Input', [0]], ['Filters', [2, 3, 6, 8]]]);
    assert.equal(pages.filter((p) => p.sectionName === 'Easy').length, 1, 'the derived easy is not cut beside it');
  });
}

test('a declared Easy page wider than the surface runs on as the Easy pages', () => {
  const remote = [{ name: 'Easy', ids: [1, 4, 5, 7, 8, 0] }, REMOTE[2]];
  assert.deepEqual(named(pagesOf(strip(), { perPage: 4, remote })), [['Easy', [1, 4, 5, 7]], ['Easy 2/2', [8, 0]], ['Filters', [2, 3, 6, 8]]]);
});

test('an easy list declared by a skin wins: the plugin\'s Easy page is not cut', () => {
  const x = { ...strip(), easy: ['lpfSlope', 'trimDb'] };
  assert.deepEqual(named(pagesOf(x, { perPage: 4, remote: REMOTE, easyDeclared: true })), [['Easy', [8, 1]], ['Input', [0]], ['Filters', [2, 3, 6, 8]]]);
});

test('with no declared Easy page the description\'s easy is the Easy page, as before', () => {
  assert.deepEqual(named(pagesOf(strip(), { perPage: 4, remote: REMOTE.slice(1) })), [['Easy', [0, 1, 2, 3]], ['Input', [0]], ['Filters', [2, 3, 6, 8]]]);
  assert.deepEqual(named(pagesOf(strip(), { perPage: 4 }))[0], ['Easy', [0, 1, 2, 3]], 'no remote page: the derived cut');
});

// the door a surface that is not node takes (`describe --pages --remote`, Zynthian's): describe hands the cut whether a skin
// declared the easy list
test('describe: the plugin\'s Easy page is the Easy page; a skin\'s easy wins over it', () => {
  const d = JSON.parse(readFileSync(new URL('fixtures/organ/organ.descriptor.json', import.meta.url), 'utf8'));
  const ids = d.controls.map((c) => c.id);
  const remote = [{ name: 'Easy', ids: [ids[3], ids[1]] }, { name: 'Mix', ids: [ids[0]] }];
  const pages = describe(d, { remote, perPage: 4 }).description.pages;
  assert.deepEqual(pages.map((p) => [p.pageName, p.ids.filter((id) => id !== null)]), [['Easy', [ids[3], ids[1]]], ['Mix', [ids[0]]]]);
  const symbols = d.controls.map((c) => c.symbol ?? c.id);
  const skin = { schema: 1, plugin: d.plugin.id, licence: 'CC0-1.0', easy: [symbols[2]] };
  const skinned = describe(d, { remote, perPage: 4, skin }).description.pages;
  assert.deepEqual(skinned.map((p) => [p.pageName, p.ids.filter((id) => id !== null)]), [['Easy', [ids[2]]], ['Mix', [ids[0]]]]);
});
