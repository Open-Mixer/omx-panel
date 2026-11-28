// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The page cut by instance (docs/group-model.md, P1; Open-Mixer/zynthian-ui#54): over `omx-panel describe --pages`, a
 * section that carries a group-model matrix is cut one instance to a page, the instance's on/off first, and never a page
 * across two instances, at any width a surface cuts at. An instance longer than the page has its first places as its
 * screen; each place past them is a row of the aligned matrix, one screen holding that parameter of a run of instances
 * (P1). No screen has zero visible items: a screen whose every slot is blank is not cut.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GM = join(ROOT, 'test', 'fixtures', 'group-model');

/**
 * The pages of a corpus descriptor at a width, each slot as its control's symbol (null for a blank slot). `easy: false`
 * serves a skin with an empty Easy list: the Easy controls (derived from the roles) come off the bands' screens, which is
 * the Easy rule's business, not this cut's.
 */
function pagesOf(file, perPage, { easy = true } = {}) {
  const descriptor = JSON.parse(readFileSync(join(GM, file), 'utf8'));
  const skin = easy ? [] : ['--skin', (() => {
    const at = join(mkdtempSync(join(tmpdir(), 'omx-pages-instances-')), 'skin.json');
    writeFileSync(at, JSON.stringify({ schema: 1, plugin: descriptor.plugin.id, licence: 'CC0-1.0', easy: [] }));
    return at;
  })()];
  const r = spawnSync(process.execPath, [join(ROOT, 'dist/bin/omx-panel.mjs'), 'describe', '--descriptor', join(GM, file), ...skin, '--pages', '--per-page', String(perPage)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  const symbolOf = new Map(descriptor.controls.map((c) => [c.id, c.symbol]));
  return JSON.parse(r.stdout).map((p) => ({ name: p.pageName, symbols: p.ids.map((id) => (id === null ? null : symbolOf.get(id))) }));
}
/** The instance a symbol belongs to: omx-eq8's `b3_freq` -> `b3`, `hpf_on` -> `hpf`; the mbc fixture's `b2_thresh` -> `b2`. */
const instanceOf = (symbol) => symbol.split('_')[0];
/** The parameter a symbol is of: `b3_freq` -> `freq`. */
const parameterOf = (symbol) => symbol.split('_').slice(1).join('_');
const held = (page) => page.symbols.filter((s) => s !== null);

for (const perPage of [4, 5, 8]) {
  test(`omx-eq8 at ${perPage}: a page holds one instance, or one parameter across instances (a row of the matrix), never a mix`, () => {
    for (const page of pagesOf('omx-plugins/omx-eq8.descriptor.json', perPage).filter((p) => !p.name.startsWith('Easy'))) {
      const one = new Set(held(page).map(instanceOf)).size === 1 || new Set(held(page).map(parameterOf)).size === 1;
      assert.ok(one, `${page.name}: ${held(page)}`);
    }
  });
}

test('omx-eq8 at 8: eight band screens, each opening with the band\'s on/off, holding every control of the band', () => {
  const pages = pagesOf('omx-plugins/omx-eq8.descriptor.json', 8, { easy: false });
  for (let n = 1; n <= 8; n++) {
    const mine = pages.filter((p) => held(p).some((s) => instanceOf(s) === `b${n}`));
    assert.equal(mine.length, 1, `band ${n} is one screen`);
    assert.equal(mine[0].symbols[0], `b${n}_on`, `band ${n} opens with its on/off`);
    assert.deepEqual(held(mine[0]).sort(), [`b${n}_freq`, `b${n}_gain`, `b${n}_on`, `b${n}_q`, `b${n}_type`].sort());
  }
});

test('omx-eq8 at 4: a band is longer than a page, so its first four places are its screen and its type goes on the Type row screens', () => {
  const pages = pagesOf('omx-plugins/omx-eq8.descriptor.json', 4, { easy: false });
  for (let n = 1; n <= 8; n++) {
    const mine = pages.filter((p) => p.name === `Bands: Band ${n}`);
    assert.equal(mine.length, 1, `band ${n} is one screen`);
    assert.deepEqual(mine[0].symbols, [`b${n}_on`, `b${n}_freq`, `b${n}_gain`, `b${n}_q`]);
  }
  // the place past the page, every band's type, is one row of the aligned matrix: four bands a screen, band j on encoder j
  assert.deepEqual(pages.filter((p) => p.name.startsWith('Bands: Type')).map((p) => [p.name, p.symbols]), [
    ['Bands: Type', ['b1_type', 'b2_type', 'b3_type', 'b4_type']],
    ['Bands: Type 2/2', ['b5_type', 'b6_type', 'b7_type', 'b8_type']],
  ]);
});

/** The screens of a cut that hold no control: a screen of blank slots shows nothing to turn . */
const emptyScreens = (pages) => pages.filter((p) => held(p).length === 0).map((p) => p.name);

for (const perPage of [2, 3, 4, 5, 8]) {
  for (const file of ['mbc.descriptor.json', 'omx-plugins/omx-eq8.descriptor.json', 'omx-plugins/omx-eq16.descriptor.json', 'taps.descriptor.json']) {
    test(`${file} at ${perPage}, its Easy controls derived: no screen has zero visible items`, () => {
      assert.deepEqual(emptyScreens(pagesOf(file, perPage)), []);
    });
  }
}

test('calf-mbc at 4: band 1\'s first four places are all Easy controls, so it has no screen of its own; release and makeup are row screens', () => {
  const pages = pagesOf('mbc.descriptor.json', 4);
  assert.deepEqual(pages.map((p) => [p.name, p.symbols]), [
    ['Easy', ['b1_bypass', 'b1_thresh', 'b1_ratio', 'b1_attack']],
    ['Band: Band 2', ['b2_bypass', 'b2_thresh', 'b2_ratio', 'b2_attack']],
    ['Band: Band 3', ['b3_bypass', 'b3_thresh', 'b3_ratio', 'b3_attack']],
    ['Band: Band 4', ['b4_bypass', 'b4_thresh', 'b4_ratio', 'b4_attack']],
    ['Band: Release', ['b1_release', 'b2_release', 'b3_release', 'b4_release']],
    ['Band: Makeup', ['b1_makeup', 'b2_makeup', 'b3_makeup', 'b4_makeup']],
  ]);
});

test('SABOTAGE: the empty band 1 screen omx-panel 0.15.1 cut for calf-mbc, put back, reads red', () => {
  const pages = pagesOf('mbc.descriptor.json', 4).filter((p) => held(p).length > 0);
  const restored = [pages[0], { name: 'Band: Band 1', symbols: [null, null, null, null] }, ...pages.slice(1)];
  assert.deepEqual(emptyScreens(restored), ['Band: Band 1'], 'the check sees the restored empty screen');
  assert.throws(() => assert.deepEqual(emptyScreens(restored), []), /Band: Band 1/);
});

test('omx-eq8 at 4, its Easy controls derived (one gain a band for six bands): 14 screens by the aligned matrix', () => {
  const pages = pagesOf('omx-plugins/omx-eq8.descriptor.json', 4);
  const easy = pages.filter((p) => p.name.startsWith('Easy')).flatMap(held);
  // 2 Easy + HPF + 8 bands (their first four places: on, freq, gain or its blank, q) + ceil(8 / 4) Type rows + LPF
  assert.equal(pages.length, Math.ceil(easy.length / 4) + 1 + 8 + Math.ceil(8 / 4) + 1, pages.map((p) => p.name).join(', '));
  assert.equal(pages.length, 14);
  for (let n = 1; n <= 8; n++) {
    const [band] = pages.filter((p) => p.name === `Bands: Band ${n}`);
    assert.deepEqual(band.symbols, [`b${n}_on`, `b${n}_freq`, easy.includes(`b${n}_gain`) ? null : `b${n}_gain`, `b${n}_q`], `band ${n}`);
  }
  assert.equal(pages.filter((p) => / \d+ 2$/.test(p.name)).length, 0, 'no band spills onto a continuation screen of its own');
});

test('a Calf-multiband-shaped plugin at 8: each band is one screen of its own, opening with its bypass', () => {
  const pages = pagesOf('mbc.descriptor.json', 8, { easy: false }).filter((p) => !p.name.startsWith('Easy'));
  for (const page of pages) assert.equal(new Set(held(page).map(instanceOf)).size, 1, `${page.name}: ${held(page)}`);
  const bands = new Set(pages.flatMap((p) => held(p).map(instanceOf)));
  assert.ok(bands.size >= 2, 'the fixture has bands');
  for (const b of bands) {
    const mine = pages.filter((p) => held(p).some((s) => instanceOf(s) === b));
    assert.equal(mine.length, 1, `${b} is one screen`);
  }
});
