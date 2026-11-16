// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The renderer's time_response (the processing-view spec, amendment 2026-09-16h; the one-panel spec §7.2): x is time in ms from 0 to
 * the content's end, y is level in dB on a window from −60 (the floor) to 0, raised to the next 6 dB when a level exceeds 0. Two
 * arrays, each drawn when present and both from the host: the ENVELOPE as the display's curve (omx_panel_view_set_curve) and the
 * STEMS (omx_panel_view_set_stems), one per tap from the floor up to its level, its paint dimmed by its shade and its leg letter
 * above. Held by value on omx-delay's own panel (its delay section's display): a stem's pixels stand where its time and level map,
 * an envelope's where its points map, a refused stem or envelope changes nothing and the panel is not drawn.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DATA, FIXTURES, ROOT, descriptionFile, render, scratch, stateFile } from './harness.mjs';

const fx = FIXTURES.find((f) => f.name === 'omx-delay');
const look = JSON.parse(readFileSync(join(ROOT, 'tools/look.json'), 'utf8')).tokens;
const ACCENT = [1, 3, 5].map((i) => parseInt(look['--accent'].slice(i, i + 2), 16));
const BODY = [1, 3, 5].map((i) => parseInt(look['--surface-3'].slice(i, i + 2), 16));
const g = JSON.parse(readFileSync(join(DATA, 'look/geometry.json'), 'utf8')).geometry;

/** The pixels inside `frame` that lean toward the accent over the body by at least `lean` (a dimmed stem leans less than a full one). */
function strokes(img, frame, lean = 0.4) {
  const out = [], d = ACCENT.map((c, k) => c - BODY[k]), dd = d.reduce((s, v) => s + v * v, 0);
  for (let y = frame.y + 5; y < frame.y + frame.h - 17; y++) for (let x = frame.x + 5; x < frame.x + frame.w - 5; x++) {
    const i = (y * img.w + x) * 4, p = [0, 1, 2].map((k) => img.data[i + k] - BODY[k]);
    const t = p.reduce((s, v, k) => s + v * d[k], 0) / dd;
    const off = Math.hypot(...p.map((v, k) => v - t * d[k]));
    if (t > lean && off < 25) out.push([x, y, t]);
  }
  return out;
}
const near = (pixels, [x, y], r = 1.5) => pixels.some(([px, py]) => Math.hypot(px - x, py - y) <= r);
const column = (pixels, x, r = 1.5) => pixels.filter(([px]) => Math.abs(px - x) <= r);

// the delay section's frame at scale 1: five controls wide, after the section title
const FRAME = { x: g.pad + g.sectionPad, y: g.sectionTop + g.sectionTitleH, w: 5 * g.cellW, h: g.curveH };
const inner = { ix: FRAME.x + 5, iy: FRAME.y + 5, iw: FRAME.w - 10, ih: FRAME.h - 10 - 12 };
/** Where (t ms, level dB) lands with the x axis 0..tMax and the y window lo..hi. */
const at = (t, db, tMax, lo = -60, hi = 0) => [inner.ix + (t / tMax) * inner.iw, inner.iy + inner.ih - ((db - lo) / (hi - lo)) * inner.ih];

let nth = 0;
const withData = (dir, extra) => {
  const desc = descriptionFile(fx, dir);
  const state = JSON.parse(readFileSync(stateFile(fx, dir), 'utf8'));
  const file = join(dir, `time-${nth++}.state.json`); // one file per call: two states in one test must not share a name
  writeFileSync(file, JSON.stringify({ ...state, curves: {}, marks: {}, stems: {}, ...extra }));
  return { desc, state: file };
};

test("omx-delay's panel carries one time_response display, on its delay section", () => {
  const dir = scratch();
  const d = JSON.parse(readFileSync(descriptionFile(fx, dir), 'utf8'));
  assert.deepEqual(d.displays.map((x) => [x.kind, x.section]), [['time_response', 0]]);
});

test('with nothing set the display is its frame and its basis word, no stroke', () => {
  const dir = scratch();
  const { desc, state } = withData(dir, {});
  assert.deepEqual(strokes(render(desc, state), FRAME), []);
});

test('stems stand where their time and level map: a 120 ms train at feedback 0.5, four taps, the last sets the axis end', () => {
  const dir = scratch();
  // the dry tap at 0 ms at −6 dB (mix 0.5), echoes at 120/240/360 ms at 0, −6, −12 dB
  const stems = [{ x: 0, y: -6, shade: 1, letter: ' ' }, { x: 120, y: 0, shade: 1, letter: ' ' }, { x: 240, y: -6, shade: 1, letter: ' ' }, { x: 360, y: -12, shade: 1, letter: ' ' }];
  const { desc, state } = withData(dir, { stems: { 0: stems } });
  const px = strokes(render(desc, state), FRAME);
  assert.ok(px.length > 20, 'the stems are drawn');
  for (const s of stems) {
    const [x, top] = at(s.x, s.y, 360);
    const col = column(px, x);
    assert.ok(col.length > 0, `a stem at ${s.x} ms (x=${x})`);
    const highest = Math.min(...col.map(([, y]) => y)), lowest = Math.max(...col.map(([, y]) => y));
    assert.ok(Math.abs(highest - top) <= 2, `the ${s.x} ms stem reaches ${s.y} dB (y=${top}, drawn to ${highest})`);
    assert.ok(lowest >= inner.iy + inner.ih - 3, `the ${s.x} ms stem starts at the floor`);
  }
  assert.equal(column(px, at(180, 0, 360)[0]).length, 0, 'nothing stands between taps');
});

test('a dimmed stem leans less toward the accent, and a leg letter stands above it', () => {
  const dir = scratch();
  // the axis ends at a third stem at 100 ms, so the measured stem at 50 ms stands clear of the frame's edges and the 0 dB line
  const full = withData(dir, { stems: { 0: [{ x: 0, y: -6, shade: 1, letter: ' ' }, { x: 50, y: -6, shade: 1, letter: ' ' }, { x: 100, y: -6, shade: 1, letter: ' ' }] } });
  const dim = withData(dir, { stems: { 0: [{ x: 0, y: -6, shade: 1, letter: ' ' }, { x: 50, y: -6, shade: 0.3, letter: 'L' }, { x: 100, y: -6, shade: 1, letter: ' ' }] } });
  const x1 = at(50, -6, 100)[0];
  const leanFull = Math.max(...column(strokes(render(full.desc, full.state), FRAME, 0.1), x1).map(([, , t]) => t));
  const leanDim = Math.max(...column(strokes(render(dim.desc, dim.state), FRAME, 0.1), x1).map(([, , t]) => t));
  assert.ok(leanDim < leanFull * 0.6, `the dimmed stem leans ${leanDim}, the full one ${leanFull}`);
});

test('an envelope is drawn from its points: a 20 ms gap, then a straight decay to −60 dB at 1020 ms', () => {
  const dir = scratch();
  const x = [0, 20, 20.001, 1020], y = [-60, -60, 0, -60];
  const { desc, state } = withData(dir, { curves: { 0: { x, y } } });
  const px = strokes(render(desc, state), FRAME);
  assert.ok(near(px, at(20, 0, 1020)), 'the onset at 20 ms, 0 dB');
  assert.ok(near(px, at(520, -30, 1020)), 'half way down at 520 ms');
  assert.ok(near(px, at(1020, -60, 1020), 2.5), 'the end at 1020 ms on the floor');
});

test('a level above 0 dB raises the window to the next 6 dB; the stems and the envelope share one axis', () => {
  const dir = scratch();
  const { desc, state } = withData(dir, { stems: { 0: [{ x: 50, y: 3, shade: 1, letter: ' ' }] }, curves: { 0: { x: [0, 200], y: [0, -60] } } });
  const px = strokes(render(desc, state), FRAME);
  const [x, top] = at(50, 3, 200, -60, 6);
  const col = column(px, x);
  assert.ok(col.length && Math.abs(Math.min(...col.map(([, y]) => y)) - top) <= 2, 'the stem at +3 dB on a −60..6 window');
  assert.ok(near(px, at(0, 0, 200, -60, 6)), 'the envelope starts at 0 dB on the same window');
});

test('one tap only, at 0 ms: the axis end falls back to 1 ms and the stem stands at the left edge', () => {
  const dir = scratch();
  const { desc, state } = withData(dir, { stems: { 0: [{ x: 0, y: -6, shade: 1, letter: ' ' }] } });
  const px = strokes(render(desc, state), FRAME);
  const [x, top] = at(0, -6, 1);
  const col = column(px, x);
  assert.ok(col.length > 0, 'the one stem is drawn, at the left edge');
  assert.ok(Math.abs(Math.min(...col.map(([, y]) => y)) - top) <= 2, 'it reaches −6 dB');
  assert.equal(px.filter(([qx]) => qx > x + 3).length, 0, 'nothing else is drawn');
});

test('32 taps: the last one sets the axis end, at the right edge', () => {
  const dir = scratch();
  const stems = Array.from({ length: 32 }, (_, k) => ({ x: 10 * k, y: -1.5 * k, shade: 1, letter: ' ' }));
  const { desc, state } = withData(dir, { stems: { 0: stems } });
  const px = strokes(render(desc, state), FRAME);
  const [xLast, topLast] = at(310, -46.5, 310);
  const col = column(px, xLast);
  assert.ok(col.length > 0, 'the 32nd stem stands at the right edge');
  assert.ok(Math.abs(Math.min(...col.map(([, y]) => y)) - topLast) <= 2, 'at its own level');
  const [xMid, topMid] = at(150, -22.5, 310);
  assert.ok(Math.abs(Math.min(...column(px, xMid).map(([, y]) => y)) - topMid) <= 2, 'the 16th stands half way, on the same axis');
});

test('an envelope that falls past −60 dB is held at the floor', () => {
  const dir = scratch();
  // a point at −90 dB is drawn AT the floor, never under it: the polyline's end is held to −60 dB at 300 ms, so the
  // line from 0 dB passes −30 dB half way, at 150 ms (a host that wants the knee at 200 ms sends the point there)
  const { desc, state } = withData(dir, { curves: { 0: { x: [0, 300], y: [0, -90] } } });
  const px = strokes(render(desc, state), FRAME);
  assert.ok(near(px, at(0, 0, 300)), 'starts at 0 dB');
  assert.ok(near(px, at(150, -30, 300)), 'half way down at 150 ms');
  assert.ok(near(px, at(300, -60, 300), 2.5), 'the end on the floor at 300 ms, not below it');
  assert.equal(px.filter(([, y]) => y > inner.iy + inner.ih + 1).length, 0, 'nothing is drawn under the floor');
});

test('a stem at or below −60 dB is not drawn', () => {
  const dir = scratch();
  const stems = [{ x: 0, y: -6, shade: 1, letter: ' ' }, { x: 100, y: -60, shade: 1, letter: 'L' }, { x: 200, y: -72, shade: 1, letter: 'R' }, { x: 300, y: -6, shade: 1, letter: ' ' }];
  const { desc, state } = withData(dir, { stems: { 0: stems } });
  const px = strokes(render(desc, state), FRAME);
  assert.ok(column(px, at(300, -6, 300)[0]).length > 0, 'the last audible tap sets the axis and is drawn');
  assert.equal(column(px, at(100, -60, 300)[0]).length, 0, 'the −60 dB stem is not there');
  assert.equal(column(px, at(200, -72, 300)[0]).length, 0, 'the −72 dB stem is not there');
});

test('a leg letter over a stem at the ceiling is held inside the frame', () => {
  const dir = scratch();
  const { desc, state } = withData(dir, { stems: { 0: [{ x: 0, y: -6, shade: 1, letter: ' ' }, { x: 100, y: 0, shade: 1, letter: 'L' }] } });
  const img = render(desc, state);
  // ink above the frame's top edge would be the letter spilling out: the band over the section's curve frame stays the panel's own
  const spill = [];
  for (let y = FRAME.y - 8; y < FRAME.y + 1; y++) for (let x = FRAME.x; x < FRAME.x + FRAME.w; x++) {
    const i = (y * img.w + x) * 4;
    if (img.data[i] > 200 && img.data[i + 1] > 200 && img.data[i + 2] > 200) spill.push([x, y]);
  }
  assert.deepEqual(spill, [], 'no ink over the frame');
});

test('a refused stem or envelope changes nothing and the panel is not drawn', () => {
  const dir = scratch();
  for (const bad of [
    { stems: { 0: [{ x: -1, y: 0, shade: 1, letter: ' ' }] } },
    { stems: { 0: [{ x: 0, y: 'x', shade: 1, letter: ' ' }] } },
    { stems: { 0: [{ x: 0, y: 0, shade: 2, letter: ' ' }] } },
    { stems: { 0: [{ x: 0, y: 0, shade: 1, letter: 'LR' }] } },
    { curves: { 0: { x: [-5, 100], y: [0, -60] } } },
    { stems: { 3: [{ x: 0, y: 0, shade: 1, letter: ' ' }] } },
  ]) {
    const { desc, state } = withData(dir, bad);
    assert.throws(() => render(desc, state), /./, JSON.stringify(bad));
  }
  // stems on a display that is no time_response
  const dyn = FIXTURES.find((f) => f.name === 'dyn-curve');
  const desc = descriptionFile(dyn, dir);
  const state = JSON.parse(readFileSync(stateFile(dyn, dir), 'utf8'));
  const file = join(dir, 'dyn.state.json');
  writeFileSync(file, JSON.stringify({ ...state, stems: { 0: [{ x: 0, y: 0, shade: 1, letter: ' ' }] } }));
  assert.throws(() => render(desc, file), /./, 'a transfer_curve takes no stems');
});
