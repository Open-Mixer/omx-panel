// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * An EQ mark off the plot's axes is HELD on the plot's edge, by both faces. The renderer holds it (renderer/src/view.c hold(): a band whose
 * frequency or depth lies off the axes sits on the frame's edge); the MOD GUI face places its marks through curveGeometry
 * (tools/modgui-gen.mjs), which the PNG face and the template's SVG both read, so it must hold them by the same rule. The parity
 * tests elsewhere use in-range marks only; this one gives both faces the same curve and off-axis marks and holds their pixels equal.
 * The curve and the marks are given here, not computed by omx-dsp's twin, so the test needs no twin.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { FIXTURES, ROOT, compare, decodePng, descriptionFile, render, resolved, scratch, stateFile } from './harness.mjs';

const modgui = await import(join(ROOT, 'dist', 'tools', 'modgui-gen.mjs'));
const fx = FIXTURES.find((f) => f.name === 'eq-marks');

// a curve whose axis is +-6 dB (its largest |y| is 3, the next 6 dB up is 6), and marks the axes do not reach
const X = [20, 200, 2000, 20000], Y = [0, 3, -3, 0];
const ABOVE = { freq: 1000, depthDb: 12, origin: 'fbs-fixed' }; // twice the axis: held on the top edge
const RIGHT = { freq: 40000, depthDb: 0, origin: 'hrp' }; // an octave past the last point: held on the right edge
const IN = { freq: 1000, depthDb: 3, origin: 'hrp' }; // in range: where the axes put it, held or not

/** Both faces of the EQ fixture with `marks` on a given curve: the MOD GUI's raster and the renderer's, from the same points and marks. */
function faces(marks) {
  const dir = scratch();
  const p = resolved(fx);
  const curve = { points: X.map((x, i) => ({ x, y: Y[i] })), marks };
  const q = { ...p, sections: p.sections.map((s, si) => ({ ...s, displays: s.displays.map((d, di) => (si === 0 && di === 0 ? { ...d, curve } : d)) })) };
  const mod = decodePng(modgui.renderFace({ ...modgui.layout(q), brand: q.brand, name: q.name ?? q.stem }, modgui.loadLook(), 1));
  const state = JSON.parse(readFileSync(stateFile(fx, dir), 'utf8'));
  const file = join(dir, 'held.state.json');
  writeFileSync(file, JSON.stringify({
    ...state,
    curves: { 0: { x: X, y: Y } },
    marks: { 0: marks.map((m) => ({ freq: m.freq, depth: m.depthDb, letter: modgui.ORIGIN_LETTER[m.origin] })) },
  }));
  return { mod, ren: render(descriptionFile(fx, dir), file) };
}

test('control: an in-range mark on the given curve is the same pixels in both faces', () => {
  const { mod, ren } = faces([IN]);
  assert.ok(compare(mod, ren).exact, 'the MOD GUI and the renderer agree where no mark is held');
});

test('a mark deeper than the axis (depth 12 on a +-6 dB plot) sits on the top edge in both faces: the same pixels', () => {
  const { mod, ren } = faces([ABOVE]);
  const c = compare(mod, ren);
  assert.ok(c.exact, `the MOD GUI draws the held mark where the renderer does (${c.off} pixels differ, worst ${c.worst})`);
});

test('a mark past the frequency axis sits on the right edge in both faces: the same pixels', () => {
  const { mod, ren } = faces([RIGHT]);
  const c = compare(mod, ren);
  assert.ok(c.exact, `the MOD GUI draws the held mark where the renderer does (${c.off} pixels differ, worst ${c.worst})`);
});

test('the MOD GUI geometry holds an off-axis mark on the plot: x and y inside the inner frame, an in-range mark untouched', () => {
  const cw = 400, ch = 120, s = 1, ix = 5, iy = 5, iw = cw - 10, ih = ch - 10 - 12;
  const curve = { points: X.map((x, i) => ({ x, y: Y[i] })), marks: [ABOVE, RIGHT, IN] };
  const [above, right, inside] = modgui.curveGeometry(curve, 'eq_response', cw, ch, s).marks.map((m) => m.at);
  assert.equal(above[1], iy, 'depth 12 on a +-6 dB axis: the top edge');
  assert.equal(right[0], ix + iw, '40 kHz past a 20 kHz axis: the right edge');
  assert.equal(inside[1], iy + ih - ((3 + 6) / 12) * ih, '3 dB: where the axis puts it');
});
