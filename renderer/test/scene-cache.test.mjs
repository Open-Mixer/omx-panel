// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The scene's static-layer cache (omx-panel#123, PR 2b). Painting the vintage knob takes the same bytes with the cache as without
 * it, whatever is behind the knob: the cache stores the knob's box as it stood before the static layers (the backdrop) and after
 * them, and uses the patch only while the backdrop is byte for byte the one it was made over. test/scene_cache_driver.c paints
 * 7 pointer angles twice each over a backdrop that is not flat, with the cache off and on, then changes one backdrop pixel inside
 * the knob and paints them all again.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ROOT, TOOLS } from './harness.mjs';

const DRIVER = join(ROOT, 'renderer', 'build', 'scene_cache_driver');
const LOOK = join(TOOLS, 'look.json');

function run(finish, k, ox, oy, w = 120, h = 120) {
  const out = execFileSync(DRIVER, [LOOK, 'knob-vintage', finish, String(k), String(ox), String(oy), String(w), String(h)], { encoding: 'utf8' });
  return Object.fromEntries(out.trim().split('\n').map((l) => l.split(' ')).map(([a, b]) => [a, Number(b)]));
}

test('the cache driver is built', () => assert.ok(existsSync(DRIVER), `${DRIVER}: make -C renderer builds it`));

for (const [finish, k, ox, oy] of [['aluminium', 1, 10, 10], ['graphite', 1.5, 7.3, 5.6], ['black', 0.8, 20.25, 3.5]]) {
  test(`the cache paints the same bytes as no cache, over a backdrop and over a changed one: ${finish} at ${k}x`, () => {
    const r = run(finish, k, ox, oy);
    assert.equal(r.equal, 1, 'cached and uncached bytes differ');
    assert.equal(r.stale, 0, 'a changed backdrop was painted from a stale patch');
  });
  test(`the cache is used: the second paint of a backdrop is a hit, a changed backdrop a miss: ${finish} at ${k}x`, () => {
    const r = run(finish, k, ox, oy);
    // 2 phases x 7 angles x 2 repeats = 28 cached paints; each phase misses once (the first paint) and hits the other 13
    assert.equal(r.misses, 2, `misses: ${r.misses}`);
    assert.equal(r.hits, 26, `hits: ${r.hits}`);
  });
}

test('a knob partly off the canvas is painted as without the cache', () => {
  const r = run('aluminium', 1, -20, -15, 60, 60);
  assert.equal(r.equal, 1);
});
