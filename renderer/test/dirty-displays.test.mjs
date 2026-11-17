// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * A display's drawing reaches beyond its frame by at most what BLEED_DISPLAY says (a mark's letter over its disc), whatever the host sends:
 * a mark off the axes is held to the plot's edge, a stem at the ceiling or under the floor, a spectrum with silent bands and peaks at the
 * top. Each case is drawn dirty into one buffer and held to a full draw of the same state, byte for byte, with nothing outside the
 * reported rectangles moved; with 1 to 3 rectangles allowed, at a fractional scale, and with two displays in one section where the second's
 * letters reach the first's frame. None of it needs omx-dsp's twin: the points are the host's.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIXTURES } from './harness.mjs';
import { bare, firstDiff, outsideUntouched, prng, steps } from './dirty-harness.mjs';

const fixture = (name) => FIXTURES.find((f) => f.name === name);
const CURVE = { x: [20, 200, 2000, 20000], y: [0, 3, -3, 0] };

function held(out, what) {
  for (const s of out) {
    assert.equal(firstDiff(s.after, s.full), -1, `${what}, step ${s.step}: the buffer is the full draw (${JSON.stringify(s.rects)})`);
    if (s.step) assert.equal(outsideUntouched(s), null, `${what}, step ${s.step}`);
  }
}

const mark = (freq, depth, letter = 'A') => ({ freq, depth, letter });

test('eq marks: off the axes in depth and frequency, the buffer is the full draw (the case that drew outside the frame: depth 12 on a +-6 dB curve)', () => {
  const f = bare(fixture('eq-marks'));
  const out = steps(f.description, f.state, [
    { curves: { 0: CURVE } },
    { marks: { 0: [mark(1000, 12)] } },
    { marks: { 0: [mark(1000, -12, 'P')] } },
    { marks: { 0: [mark(5, 3), mark(90000, -3, 'O')] } },
    { marks: { 0: [mark(1000, 400), mark(30, -400, 'O'), mark(20000, 0, 'P')] } },
    { marks: { 0: [] } },
  ]);
  held(out, 'marks');
  assert.ok(out[2].rects.length >= 1);
});

test('eq marks at a fractional scale and with one rectangle allowed', () => {
  const f = bare(fixture('eq-marks'));
  for (const [scale, cap] of [[1.5, 1], [1.25, 2], [2, 3]])
    held(steps(f.description, f.state, [{ curves: { 0: CURVE } }, { marks: { 0: [mark(1000, 12)] } }, { marks: { 0: [mark(700, -30, 'O')] } }, { curves: { 0: { x: CURVE.x, y: [0, -5, 5, 0] } } }], { scale, cap }), `scale ${scale} cap ${cap}`);
});

test('the eq spectrum: levels, silent bands, peaks at the top, with the curve and marks over it', () => {
  const f = bare(fixture('eq-marks'));
  const hz = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const spec = (db, peak) => ({ hz, db, peak, dbMin: -90, dbMax: 0, gridDb: 18 });
  const out = steps(f.description, f.state, [
    { curves: { 0: CURVE } },
    { spectrum: { 0: spec(hz.map((_, i) => -60 + 4 * i), hz.map((_, i) => -50 + 5 * i)) } },
    { spectrum: { 0: spec(hz.map((_, i) => (i === 3 ? null : -30 - 3 * i)), hz.map(() => 0)) } },
    { marks: { 0: [mark(1000, 12), mark(10, -80, 'O')] } },
    { spectrum: { 0: spec(hz.map(() => null), hz.map(() => null)) } },
    { spectrum: { 0: spec(hz.map((_, i) => -10 - i), hz.map((_, i) => -5 - i)) } },
  ]);
  held(out, 'spectrum');
});

test('time-response stems: at the ceiling, over it, at and under the floor, with letters', () => {
  const f = bare(fixture('omx-reverb'));
  const stem = (x, y, shade, letter) => ({ x, y, shade, letter });
  const out = steps(f.description, f.state, [
    { curves: { 0: { x: [0, 50, 100, 400], y: [0, -10, -25, -50] } } },
    { stems: { 0: [stem(0, 0, 1, 'L'), stem(40, -12, 0.5, 'R'), stem(120, -30, 0, ' ')] } },
    { stems: { 0: [stem(10, 18, 1, 'L'), stem(300, -60, 1, 'R'), stem(350, -90, 1, 'L'), stem(500, -3, 0.2, 'R')] } },
    { stems: { 0: [] } },
    { stems: { 0: [stem(0, 6, 1, 'L'), stem(1, 6, 1, 'R')] } },
  ]);
  held(out, 'stems');
});

test('several changes at once with 1, 2 and 3 rectangles allowed: never more, none dropped, the buffer the full draw', () => {
  const f = bare(fixture('zamcomp-panel'));
  const symbols = f.controls.filter((c) => c.widget !== 'display').map((c) => c.symbol);
  for (const cap of [1, 2, 3]) {
    const rnd = prng(cap * 31);
    const deltas = [];
    for (let n = 0; n < 12; n++) {
      const values = {};
      for (let k = 0; k < 5; k++) values[symbols[Math.floor(rnd() * symbols.length)]] = { fraction: Math.round(rnd() * 100) / 100, text: `${Math.floor(rnd() * 3)}` };
      deltas.push({ values });
    }
    const out = steps(f.description, f.state, deltas, { cap, scale: 1.5 });
    held(out, `cap ${cap}`);
    for (const s of out) assert.ok(s.rects.length <= cap, `cap ${cap}: step ${s.step} reported ${s.rects.length}`);
    assert.ok(out.some((s) => s.rects.length === cap), `cap ${cap}: some step needed all of them`);
  }
});

test('two displays in a section: a mark held at the top of the second reaches into the first\'s frame, and each is repainted whole', () => {
  const f = bare(fixture('eq-marks'), (x) => ({ ...x, displays: [...x.displays, { ...x.displays[0], label: 'EQ 2' }] }));
  const out = steps(f.description, f.state, [
    { curves: { 0: CURVE, 1: CURVE } },
    { marks: { 1: [mark(1000, 60), mark(100, 60, 'O')] } },
    { curves: { 0: { x: CURVE.x, y: [0, -2, 2, 0] } } },
    { marks: { 1: [mark(1000, 60)] }, curves: { 0: CURVE } },
    { curves: { 1: { x: CURVE.x, y: [0, 1, -1, 0] } } },
  ]);
  held(out, 'two displays');
});
