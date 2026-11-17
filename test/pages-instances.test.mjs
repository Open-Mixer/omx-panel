// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The page cut by instance (docs/group-model.md, P1; Open-Mixer/zynthian-ui#54): over `omx-panel describe --pages`, a
 * section that carries a group-model matrix is cut one instance to a page where it fits, the instance's on/off first,
 * and never a page across two instances, at any width a surface cuts at.
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
const held = (page) => page.symbols.filter((s) => s !== null);

for (const perPage of [4, 5, 8]) {
  test(`omx-eq8 at ${perPage}: no page holds controls of two instances`, () => {
    for (const page of pagesOf('omx-plugins/omx-eq8.descriptor.json', perPage).filter((p) => !p.name.startsWith('Easy'))) {
      assert.equal(new Set(held(page).map(instanceOf)).size, 1, `${page.name}: ${held(page)}`);
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

test('omx-eq8 at 4: a band is longer than a page, so it is the only thing split, and opens with its on/off', () => {
  const pages = pagesOf('omx-plugins/omx-eq8.descriptor.json', 4, { easy: false });
  for (let n = 1; n <= 8; n++) {
    const mine = pages.filter((p) => held(p).some((s) => instanceOf(s) === `b${n}`));
    assert.equal(mine.length, 2, `band ${n} is two screens`);
    assert.equal(mine[0].symbols[0], `b${n}_on`);
  }
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
