// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The spectrum layer (omx_panel_view_set_spectrum; openmixer's spec 2026-11-15-zynthian-rta-from-a-jack-reader.md §5): while a
 * spectrum is set an eq_response is drawn on the console analyser's axes, the log frequency axis the bands and the curve share,
 * ONE dB graticule (the level window's, a line every grid_db), the spectrum in the console's line look under the curve, and the
 * curve, a gain, parked with 0 dB at the window's middle. Held against the console's own picture of the same bands and curve
 * (test/fixtures/rta/console-scene.json, made by tools/rta-console-reference.mjs from openmixer's buildRtaScene): every stroke
 * pixel within 1 px of the console's, both ways, and the graticule's rows within 1 px. n == 0 gives the display its own curve
 * axis back, exactly. Refused input changes nothing. The goldens: renderer/test/golden/eq-spectrum-<size>@<scale>x.png.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { FIXTURES, RENDERER, ROOT, DATA, compare, decodePng, descriptionFile, encodePng, render, scratch, stateFile } from './harness.mjs';

const fx = FIXTURES.find((f) => f.name === 'dyn-curve');
const ref = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/rta/console-scene.json'), 'utf8'));
const vectors = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/rta/bands-48k-64.json'), 'utf8')).cases;
const look = JSON.parse(readFileSync(join(ROOT, 'tools/look.json'), 'utf8')).tokens;
const rgb = (t) => [1, 3, 5].map((i) => parseInt(look[t].slice(i, i + 2), 16));
const ACCENT = rgb('--accent'), BODY = rgb('--surface-3'), BORDER = rgb('--border'), RED = rgb('--meter-red');
const geometry = JSON.parse(readFileSync(join(DATA, 'look/geometry.json'), 'utf8')).geometry;
const g = geometry;
// the eq_response frame of the dyn-curve fixture at 1x (curve.test.mjs's), and its plot box
const FRAME = { x: g.pad + g.sectionPad, y: g.sectionTop + g.sectionTitleH, w: 5 * g.cellW, h: g.curveH };
const PLOT = { x: FRAME.x + 5, y: FRAME.y + 5, w: FRAME.w - 10, h: FRAME.h - 10 - 12 };
const W = ref.window;

/** The state of the dyn-curve fixture with its display as an eq_response, the curve given and, when `spectrum` is, the spectrum. */
function withSpectrum(dir, { curve = ref.input.curve, spectrum = null } = {}) {
  const d = JSON.parse(readFileSync(descriptionFile(fx, dir), 'utf8'));
  d.displays[0].kind = 'eq_response';
  const desc = join(dir, 'eq.layout.json');
  writeFileSync(desc, JSON.stringify(d));
  const state = JSON.parse(readFileSync(stateFile(fx, dir), 'utf8'));
  const file = join(dir, 'spectrum.state.json');
  const next = { ...state, curves: curve ? { 0: { x: curve.map((p) => p.hz), y: curve.map((p) => p.gain) } } : {}, marks: {} };
  if (spectrum) next.spectrum = { 0: spectrum };
  writeFileSync(file, JSON.stringify(next, (_k, v) => (v === -Infinity ? null : v)));
  return { desc, state: file };
}
const SPECTRUM = {
  hz: ref.input.bands.map((b) => b.hz), db: ref.input.bands.map((b) => b.db), peak: ref.input.bands.map((b) => b.peakDb),
  dbMin: W.dbMin, dbMax: W.dbMax, gridDb: W.gridDb,
};

const px = (img, x, y) => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 3));
const near = (a, b, d) => a.every((v, k) => Math.abs(v - b[k]) <= d);
/** The accent's pixels in the plot: the trace's and the curve's strokes (their cores are the accent at full strength). */
function accentPixels(img) {
  const out = [];
  for (let y = Math.floor(PLOT.y) - 1; y <= PLOT.y + PLOT.h + 1; y++) for (let x = Math.floor(PLOT.x) - 1; x <= PLOT.x + PLOT.w + 1; x++)
    if (near(px(img, x, y), ACCENT, 40)) out.push([x, y]);
  return out;
}
/** A polyline of plot fractions, sampled every 0.25 px and set as the pixels it crosses. */
function polylinePixels(pts) {
  const set = new Set(), out = [];
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    const ax = PLOT.x + a.x * PLOT.w, ay = PLOT.y + a.y * PLOT.h, bx = PLOT.x + b.x * PLOT.w, by = PLOT.y + b.y * PLOT.h;
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 4) || 1;
    for (let s = 0; s <= steps; s++) {
      const x = Math.floor(ax + ((bx - ax) * s) / steps), y = Math.floor(ay + ((by - ay) * s) / steps), key = `${x},${y}`;
      if (!set.has(key)) set.add(key), out.push([x, y]);
    }
  }
  return out;
}
const within1 = (from, to) => {
  const set = new Set(to.map(([x, y]) => `${x},${y}`));
  return from.filter(([x, y]) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (set.has(`${x + dx},${y + dy}`)) return false; return true; });
};

test('the spectrum and the curve are the console analyser\'s strokes, within 1 px both ways', () => {
  const dir = scratch();
  const { desc, state } = withSpectrum(dir, { spectrum: SPECTRUM });
  const drawn = accentPixels(render(desc, state));
  const want = [...polylinePixels(ref.trace), ...polylinePixels(ref.curve)];
  assert.ok(drawn.length > 200, `${drawn.length} accent pixels`);
  const stray = within1(drawn, want), missing = within1(want, drawn);
  assert.equal(stray.length, 0, `${stray.length} drawn stroke pixels are not within 1 px of the console's (first ${JSON.stringify(stray.slice(0, 4))})`);
  assert.equal(missing.length, 0, `${missing.length} of the console's stroke pixels are not drawn within 1 px (first ${JSON.stringify(missing.slice(0, 4))})`);
});

test('one dB graticule, the level window\'s: a row every grid_db, at the console\'s rows within 1 px', () => {
  const dir = scratch();
  const silent = { ...SPECTRUM, db: SPECTRUM.db.map(() => -Infinity), peak: SPECTRUM.peak.map(() => -Infinity) };
  const { desc, state } = withSpectrum(dir, { curve: null, spectrum: silent });
  const img = render(desc, state);
  const col = Math.round(PLOT.x + 0.37 * PLOT.w);
  const rows = [];
  for (let y = Math.floor(PLOT.y) - 1; y <= PLOT.y + PLOT.h + 1; y++) if (!near(px(img, col, y), BODY, 6)) rows.push(y);
  const want = ref.graticule.map((f) => PLOT.y + f * PLOT.h);
  for (const y of want) assert.ok(rows.some((r) => Math.abs(r - y) <= 1), `a graticule row at ${y.toFixed(1)}: rows ${rows}`);
  for (const r of rows) assert.ok(want.some((y) => Math.abs(r - y) <= 1.5), `row ${r} is no row of the console's graticule (${want.map((y) => y.toFixed(1))})`);
});

test('the console\'s line look: the fill in the meter gradient under the trace, a clip tick where a peak reaches the top', () => {
  const dir = scratch();
  const { desc, state } = withSpectrum(dir, { curve: null, spectrum: SPECTRUM });
  const img = render(desc, state);
  const tx = Math.round(PLOT.x + ref.clipTicksX[0] * PLOT.w);
  assert.ok([0, 1, 2].some((dy) => near(px(img, tx, Math.round(PLOT.y) + dy), RED, 30)), 'a red clip tick at the top over the clipping band');
  // under the trace, near the foot: the green end of the gradient over the body, at the fill's alpha
  const fx0 = Math.round(PLOT.x + 0.3 * PLOT.w), foot = Math.round(PLOT.y + PLOT.h - 2);
  const want = [0, 1, 2].map((k) => BODY[k] + (rgb('--meter-green')[k] - BODY[k]) * ref.area.alpha);
  assert.ok(near(px(img, fx0, foot), want, 14), `the fill near the foot ${px(img, fx0, foot)} is green at ${ref.area.alpha} over the body (${want.map(Math.round)})`);
});

test('n == 0 clears the spectrum: the display is drawn on its own curve axis again, exactly as with no spectrum', () => {
  const dir = scratch();
  const plain = withSpectrum(dir);
  const cleared = withSpectrum(scratch(), { spectrum: { ...SPECTRUM, hz: [], db: [], peak: [] } });
  const d = compare(render(cleared.desc, cleared.state), render(plain.desc, plain.state));
  assert.ok(d.sameSize && d.exact, `${d.off} pixels differ`);
});

for (const [why, change] of [
  ['an hz that does not ascend', { hz: SPECTRUM.hz.map((h, k) => (k === 5 ? SPECTRUM.hz[3] : h)) }],
  ['an hz not above zero', { hz: SPECTRUM.hz.map((h, k) => (k === 0 ? 0 : h)) }],
  ['db_min not below db_max', { dbMin: 0, dbMax: 0 }],
  ['a grid_db not above zero', { gridDb: 0 }],
  ['a window that is not finite', { dbMax: 1e400 }],
]) {
  test(`a spectrum with ${why} is refused and the panel is not drawn`, () => {
    const dir = scratch();
    const { desc, state } = withSpectrum(dir, { spectrum: { ...SPECTRUM, ...change } });
    assert.throws(() => render(desc, state), /spectrum/);
  });
}

test('a spectrum on a display with no log axis (a transfer_curve) is refused', () => {
  const dir = scratch();
  const { desc, state } = withSpectrum(dir, { spectrum: SPECTRUM });
  const d = JSON.parse(readFileSync(desc, 'utf8'));
  d.displays[0].kind = 'transfer_curve';
  writeFileSync(desc, JSON.stringify(d));
  const st = JSON.parse(readFileSync(state, 'utf8'));
  st.curves = { 0: { x: [-80, 0], y: [-80, 0] } };
  writeFileSync(state, JSON.stringify(st));
  assert.throws(() => render(desc, state), /spectrum/);
});

test('silence (-INFINITY) is drawn as nothing: a silent spectrum leaves the graticule alone, no accent and no fill', () => {
  const dir = scratch();
  const silent = { ...SPECTRUM, db: SPECTRUM.db.map(() => -Infinity), peak: SPECTRUM.peak.map(() => -Infinity) };
  const { desc, state } = withSpectrum(dir, { curve: null, spectrum: silent });
  assert.deepEqual(accentPixels(render(desc, state)), []);
});

// the goldens: omx-dsp's band vectors (48 kHz, 64 bands, the slope and the tiers), the fixture's curve
const GOLDEN = join(RENDERER, 'test', 'golden');
const UPDATE = process.env.OMX_PANEL_RENDER_UPDATE === '1';
for (const [sizeName, size] of [['natural', null], ['compact', [320, 200]]]) {
  for (const scale of [1, 2]) {
    test(`eq-spectrum, ${sizeName}, ${scale}x: the golden image`, () => {
      const file = join(GOLDEN, `eq-spectrum-${sizeName}@${scale}x.png`);
      const v = vectors.find((c) => c.kind === (sizeName === 'natural' ? 'slope' : 'tiers'));
      const { desc, state } = withSpectrum(scratch(), { spectrum: {
        hz: v.hz, db: v.db.map((x) => (x === null ? -Infinity : x)), peak: v.peak.map((x) => (x === null ? -Infinity : x)),
        dbMin: W.dbMin, dbMax: W.dbMax, gridDb: W.gridDb } });
      const drawn = render(desc, state, { scale, ...(size ? { size: size.map((n) => n * scale) } : {}) });
      if (UPDATE || !existsSync(file)) {
        assert.ok(UPDATE, `no golden image ${file}: write it with OMX_PANEL_RENDER_UPDATE=1`);
        mkdirSync(GOLDEN, { recursive: true });
        writeFileSync(file, encodePng(drawn));
        return;
      }
      const d = compare(drawn, decodePng(readFileSync(file)), 2);
      assert.ok(d.sameSize, `size ${drawn.w}x${drawn.h}`);
      assert.ok(d.off <= drawn.w * drawn.h * 0.001, `${d.off} pixels differ by more than 2`);
    });
  }
}
