// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The renderer draws the MOD GUI's face to the bit. Until the MOD GUI's images come from the renderer itself, two codes
 * draw the same face (tools/modgui-gen.mjs renderFace over tools/raster.mjs, and renderer/src); this holds them equal,
 * pixel for pixel, at the generator's own scales, and against the screenshots it committed.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { modgui, skipWithoutTwin, CLI, DATA, FIXTURES, RENDERER, ROOT, compare, decodePng, descriptionFile, face, render, scratch, stateFile } from './harness.mjs';

for (const fx of FIXTURES) {
  for (const scale of [1, 0.5, 2]) {
    test(`${fx.name} at ${scale}x is the MOD GUI face, pixel for pixel`, skipWithoutTwin(fx), () => {
      const dir = scratch();
      const want = face(fx, scale);
      const drawn = render(descriptionFile(fx, dir), stateFile(fx, dir), { scale });
      const d = compare(drawn, want);
      assert.ok(d.sameSize, `size ${drawn.w}x${drawn.h}, the face is ${want.w}x${want.h}`);
      assert.ok(d.exact, `${d.off} pixels differ, by up to ${d.worst}`);
    });
  }
  if (fx.screenshot) {
    // The bundle the repository commits wears the generator's default (vintage) look, which the renderer does not draw. The flat look's
    // screenshot of the same fixture is COMMITTED here (golden/modgui-<fixture>-flat.png), written by the generator and held both ways:
    // the generator's output must be the committed file byte for byte (a drift guard: rewrite it with OMX_PANEL_RENDER_UPDATE=1 after a
    // change meant to move it), and the renderer must draw the committed file pixel for pixel.
    test(`${fx.name}: the committed flat-look MOD GUI screenshot is what the generator writes and what the renderer draws`, skipWithoutTwin(fx), () => {
      const dir = scratch();
      const file = join(RENDERER, 'test', 'golden', `modgui-${fx.name}-flat.png`);
      const descriptor = JSON.parse(readFileSync(join(ROOT, fx.descriptor), 'utf8'));
      const panel = fx.panel ? JSON.parse(readFileSync(join(ROOT, fx.panel), 'utf8')) : undefined;
      const written = new Map(modgui.generateModgui(descriptor, { panel, stem: fx.stem, source: 'parity', look: 'console' })).get(`modgui/screenshot-${fx.stem}.png`);
      if (process.env.OMX_PANEL_RENDER_UPDATE === '1') writeFileSync(file, written);
      assert.ok(existsSync(file), `no committed shot ${file}: write it with OMX_PANEL_RENDER_UPDATE=1`);
      const committed = readFileSync(file);
      assert.ok(Buffer.from(written).equals(committed), 'the generator no longer writes the committed shot: rewrite it with OMX_PANEL_RENDER_UPDATE=1 and look at it');
      const d = compare(render(descriptionFile(fx, dir), stateFile(fx, dir)), decodePng(committed));
      assert.ok(d.sameSize && d.exact, `${d.off} pixels differ, by up to ${d.worst}`);
    });
  }
}

/** `straight` (RGBA, straight alpha) as `format` and `alpha` lay it out: the channels swapped for BGRA, each colour times its
 * alpha, rounded to the nearest, when premultiplied. */
function expected(straight, format, alpha) {
  const out = new Uint8Array(straight.data.length);
  for (let i = 0; i < out.length; i += 4) {
    const a = straight.data[i + 3];
    const c = [0, 1, 2].map((k) => (alpha === 'premultiplied' ? Math.floor((straight.data[i + k] * a + 127) / 255) : straight.data[i + k]));
    out.set(format === 'bgra' ? [c[2], c[1], c[0], a] : [c[0], c[1], c[2], a], i);
  }
  return { ...straight, data: out };
}

for (const format of ['rgba', 'bgra']) {
  for (const alpha of ['straight', 'premultiplied']) {
    test(`${format.toUpperCase()}, ${alpha}: the same pixels in that layout`, () => {
      const dir = scratch();
      const fx = FIXTURES[0];
      const desc = descriptionFile(fx, dir), state = stateFile(fx, dir);
      const straight = render(desc, state);
      const drawn = render(desc, state, { format, alpha });
      // the panel's rounded corners are partly covered: premultiplying must have something to change
      assert.ok(straight.data.some((v, i) => i % 4 === 3 && v > 0 && v < 255));
      const d = compare(drawn, expected(straight, format, alpha));
      assert.ok(d.exact, `${d.off} pixels differ, by up to ${d.worst}`);
    });
  }
}

test('premultiplied is the default: a buffer that names no alpha gets it', () => {
  const dir = scratch();
  const fx = FIXTURES[0];
  const desc = descriptionFile(fx, dir), state = stateFile(fx, dir);
  const out = join(dir, 'default.raw');
  execFileSync(CLI, ['--description', desc, '--data', DATA, '--state', state, '--raw', out]);
  const d = compare({ ...render(desc, state), data: new Uint8Array(readFileSync(out)) }, expected(render(desc, state), 'rgba', 'premultiplied'));
  assert.ok(d.exact, `${d.off} pixels differ`);
});
