// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * One drawing, two painters (omx-panel#123, PR 2): the vintage knob is a scene of tools/look.json, painted for the MOD GUI's film strips
 * and face by tools/svg-knob.mjs over tools/raster.mjs, and for the renderer by omx_scene_paint (renderer/src/scene.c), a port of
 * the same arithmetic. This holds the two equal byte for byte, over every finish of the console's pin, the pointer's whole sweep, three
 * scales and sub-pixel origins, and holds a scene the renderer cannot paint to a refusal by name.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { canvas } from '../../tools/raster.mjs';
import { paintScene, sceneAt } from '../../tools/svg-knob.mjs';
import { RENDERER, ROOT, scratch } from './harness.mjs';

const DRIVER = join(RENDERER, 'build', 'scene_driver');
const LOOK_FILE = join(ROOT, 'tools', 'look.json');
const LOOK = JSON.parse(readFileSync(LOOK_FILE, 'utf8'));
const tokens = LOOK.tokens;
const pinnedFor = (finish) => Object.fromEntries([...Object.entries(LOOK.console.tokens).map(([k, v]) => [`console:${k}`, v]), ...Object.entries(LOOK.console.finish[finish]).map(([k, v]) => [`finish:${k}`, v])]);

/** The driver's bytes for a drawing of `lookFile`, or the spawn result when it fails. */
function viaC(lookFile, drawing, finish, angle, k, ox, oy, w, h) {
  const out = join(scratch(), 'scene.raw');
  const r = spawnSync(DRIVER, [lookFile, drawing, finish, String(angle), String(k), String(ox), String(oy), String(w), String(h), out], { encoding: 'utf8' });
  return r.status === 0 ? readFileSync(out) : r;
}

function viaJs(drawing, finish, angle, k, ox, oy, w, h) {
  const c = canvas(w, h);
  paintScene(c, sceneAt(drawing, tokens, angle, pinnedFor(finish)), ox, oy, k);
  return Buffer.from(c.data);
}

test('the driver is built', () => assert.ok(existsSync(DRIVER), `no ${DRIVER}: make -C renderer build/scene_driver`));

for (const finish of Object.keys(LOOK.console.finish)) {
  test(`the renderer paints the knob scene byte for byte as the film painter does: ${finish}`, () => {
    for (const k of [1, 0.7, 1.9]) {
      for (const [ox, oy] of [[0, 0], [3.3, 2.1], [0.25, 5.75]]) {
        const w = Math.ceil(48 * k + ox) + 4, h = Math.ceil(48 * k + oy) + 4;
        for (const angle of [-135, -90, -42.7, 0, 17.3, 90, 135]) {
          const c = viaC(LOOK_FILE, 'knob-vintage', finish, angle, k, ox, oy, w, h);
          assert.ok(Buffer.isBuffer(c), `the driver failed: ${c.stderr}`);
          const js = viaJs(LOOK.drawings['knob-vintage'], finish, angle, k, ox, oy, w, h);
          let off = 0, worst = 0;
          for (let i = 0; i < js.length; i++) if (c[i] !== js[i]) { off++; worst = Math.max(worst, Math.abs(c[i] - js[i])); }
          assert.equal(off, 0, `${finish} k=${k} origin ${ox},${oy} angle ${angle}: ${off} bytes differ, by up to ${worst}`);
        }
      }
    }
  });
}

/** A copy of look.json with `mutate` applied to its parsed document, written where the driver can read it. */
function altered(mutate) {
  const doc = structuredClone(LOOK);
  mutate(doc);
  const file = join(scratch(), 'look.json');
  writeFileSync(file, JSON.stringify(doc));
  return file;
}
const refusal = (file, drawing = 'knob-vintage', finish = 'aluminium') => {
  const r = viaC(file, drawing, finish, 0, 1, 0, 0, 52, 52);
  assert.ok(!Buffer.isBuffer(r), 'the driver painted a scene it should refuse');
  assert.equal(r.status, 1, r.stderr);
  return r.stderr;
};

test('a drawing the look does not carry is refused by name', () => {
  assert.match(refusal(LOOK_FILE, 'knob-nothing'), /knob-nothing/);
});

test('a gradient of three stops is refused by name: the backends take two', () => {
  const file = altered((d) => d.drawings['knob-vintage'].gradients.cap.stops.push({ offset: 0.5, color: '{finish:--knob-face}' }));
  assert.match(refusal(file), /gradient 'cap'.*3 stops/);
});

test('a shape outside the subset is refused by name', () => {
  const file = altered((d) => d.drawings['knob-vintage'].shapes.push({ tag: 'path', attrs: { d: 'M0 0' }, rotate: [] }));
  assert.match(refusal(file), /'path'/);
});

test('a placeholder the look and the pin do not carry is refused by name', () => {
  const file = altered((d) => { d.drawings['knob-vintage'].shapes[0].attrs.stroke = '{finish:--knob-nope}'; });
  assert.match(refusal(file), /--knob-nope/);
});

test('a finish the console\'s pin does not carry is refused by name', () => {
  assert.match(refusal(LOOK_FILE, 'knob-vintage', 'brass'), /brass/);
});
