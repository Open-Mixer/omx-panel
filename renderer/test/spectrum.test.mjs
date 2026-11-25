// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The spectrum layer (omx_panel_view_set_spectrum; the Zynthian RTA's renderer part): while a spectrum is set an eq_response is
 * drawn on the console analyser's axes, the log frequency axis the bands and the curve share, ONE dB graticule (the level
 * window's, a line every grid_db), the spectrum in the console's line look under the curve, and the curve, a gain, parked with
 * 0 dB at the window's middle. The taps are the console's modes: PRE or POST alone is filled; BOTH fills POST and draws PRE as
 * a dim reference line; with the delta the two are full-strength lines and each wedge of omx-dsp's omx_rta_band_delta between
 * them is filled in the boost or the cut role at 45 % to 90 % with its strength. Held against the console's own picture of the
 * same bands and curve (test/fixtures/rta/console-scene.json, made by tools/rta-console-reference.mjs from the console's RTA
 * scene builder): every stroke pixel within 1 px of the console's, both ways, the graticule's rows within 1 px, PRE's dim line
 * on the console's, and a wedge on every one of the console's and nowhere else. n == 0 gives the display its own curve axis
 * back, exactly. Refused input changes nothing. The goldens: renderer/test/golden/eq-spectrum[-<mode>]-<size>@<scale>x.png.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { FIXTURES, RENDERER, ROOT, DATA, compare, decodePng, descriptionFile, encodePng, render, scratch, stateFile } from './harness.mjs';

const fx = FIXTURES.find((f) => f.name === 'dyn-curve');
const ref = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/rta/console-scene.json'), 'utf8'));
const vectors = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/rta/bands-48k-64.json'), 'utf8')).cases;
const look = JSON.parse(readFileSync(join(ROOT, 'tools/look.json'), 'utf8')).tokens;
const rgb = (t) => [1, 3, 5].map((i) => parseInt(look[t].slice(i, i + 2), 16));
const ACCENT = rgb('--accent'), BODY = rgb('--surface-3'), RED = rgb('--meter-red'), INKDIM = rgb('--ink-dim');
const BOOST = rgb('--eq-delta-boost'), CUT = rgb('--eq-delta-cut');
/** A colour `a` of the way from `under` to `c`, rounded as the renderer lays a colour at an alpha. */
const over = (under, c, a) => under.map((u, k) => Math.round(u + (c[k] - u) * a));
const DIM = over(BODY, INKDIM, 0.7);
// omx-dsp's numbers the delta is drawn by, from the header the renderer was compiled against: the deadband and the EQ's gain limit
const defs = readFileSync(join(execFileSync('pkg-config', ['--variable=includedir', 'omxdsp'], { encoding: 'utf8' }).trim(), 'omxdsp',
  'omxdsp_definitions.h'), 'utf8');
const define = (name) => Number(defs.match(new RegExp(`#define ${name} (-?[0-9.]+)`))[1]);
const DEADBAND = define('OMX_RTA_DELTA_DEADBAND_DB_DOUBLE'), EQ_MAX = define('OMX_EQ_GAIN_RANGE_MAX');
const geometry = JSON.parse(readFileSync(join(DATA, 'look/geometry.json'), 'utf8')).geometry;
const g = geometry;
// the eq_response frame of the dyn-curve fixture at 1x (curve.test.mjs's), and its plot box
const FRAME = { x: g.pad + g.sectionPad, y: g.sectionTop + g.sectionTitleH, w: 5 * g.cellW, h: g.curveH };
const PLOT = { x: FRAME.x + 5, y: FRAME.y + 5, w: FRAME.w - 10, h: FRAME.h - 10 - 12 };
const W = ref.window;

/** The state of the dyn-curve fixture with its display as an eq_response, the curve given and, when `spectrum` is, the spectrum. */
function withSpectrum(dir, { curve = ref.input.curve, spectrum = null } = {}) {
  const d = JSON.parse(readFileSync(descriptionFile(fx, dir), 'utf8'));
  d.displays[0].kind = 'eq_response', d.displays[0].axis = 'log-frequency';
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
  hz: ref.input.bands.map((b) => b.hz), post: ref.input.bands.map((b) => b.db), peak: ref.input.bands.map((b) => b.peakDb),
  mode: 'post', dbMin: W.dbMin, dbMax: W.dbMax, gridDb: W.gridDb,
};
/** The console's two taps: PRE what the EQ was given (the POST bands less its gain), POST what it gave. */
const PRE = ref.input.pre.map((b) => b.db);
const BOTH = { ...SPECTRUM, pre: PRE, mode: 'both' };
const DELTA = { ...BOTH, delta: true };

const px = (img, x, y) => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 3));
const near = (a, b, d) => a.every((v, k) => Math.abs(v - b[k]) <= d);
const STROKE = rgb('--curve-stroke');
const apart = (a, b) => Math.hypot(...a.map((v, k) => v - b[k]));
/** The strokes' pixels in the plot: the trace's, in the accent, and the curve's, in the curve stroke. A stroke is a 0.75 px hairline, so
 * its core is three quarters the role's colour over what is under it: over the green foot of the fill the vintage orange lands 46 from
 * itself in red, hence the 50. The clip tick is --meter-red, which the orange sits near: a pixel nearer the red than either stroke is
 * the tick's, not a stroke's. */
function accentPixels(img) {
  const out = [];
  for (let y = Math.floor(PLOT.y) - 1; y <= PLOT.y + PLOT.h + 1; y++) for (let x = Math.floor(PLOT.x) - 1; x <= PLOT.x + PLOT.w + 1; x++) {
    const p = px(img, x, y);
    if ((near(p, ACCENT, 50) || near(p, STROKE, 50)) && Math.min(apart(p, ACCENT), apart(p, STROKE)) < apart(p, RED)) out.push([x, y]);
  }
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
  const silent = { ...SPECTRUM, post: SPECTRUM.post.map(() => -Infinity), peak: SPECTRUM.peak.map(() => -Infinity) };
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
  const cleared = withSpectrum(scratch(), { spectrum: { ...SPECTRUM, hz: [], post: [], peak: [] } });
  const d = compare(render(cleared.desc, cleared.state), render(plain.desc, plain.state));
  assert.ok(d.sameSize && d.exact, `${d.off} pixels differ`);
});

for (const [why, change] of [
  ['an hz that does not ascend', { hz: SPECTRUM.hz.map((h, k) => (k === 5 ? SPECTRUM.hz[3] : h)) }],
  ['an hz not above zero', { hz: SPECTRUM.hz.map((h, k) => (k === 0 ? 0 : h)) }],
  ['db_min not below db_max', { dbMin: 0, dbMax: 0 }],
  ['a grid_db not above zero', { gridDb: 0 }],
  ['a window that is not finite', { dbMax: 1e400 }],
  ['a mode outside the three', { mode: 'sideways' }],
  ['the delta without both taps', { mode: 'post', delta: true }],
  ['both taps shown and PRE not given', { mode: 'both' }],
  ['PRE shown and not given', { mode: 'pre' }],
]) {
  test(`a spectrum with ${why} is refused and the panel is not drawn`, () => {
    const dir = scratch();
    const { desc, state } = withSpectrum(dir, { spectrum: { ...SPECTRUM, ...change } });
    assert.throws(() => render(desc, state), /spectrum/);
  });
}

test('a spectrum on a display with no log frequency axis (a transfer_curve on its linear axis) is refused', () => {
  const dir = scratch();
  const { desc, state } = withSpectrum(dir, { spectrum: SPECTRUM });
  const d = JSON.parse(readFileSync(desc, 'utf8'));
  d.displays[0].kind = 'transfer_curve', d.displays[0].axis = 'linear';
  writeFileSync(desc, JSON.stringify(d));
  const st = JSON.parse(readFileSync(state, 'utf8'));
  st.curves = { 0: { x: [-80, 0], y: [-80, 0] } };
  writeFileSync(state, JSON.stringify(st));
  assert.throws(() => render(desc, state), /spectrum/);
});

test('silence (-INFINITY) is drawn as nothing: a silent spectrum leaves the graticule alone, no accent and no fill', () => {
  const dir = scratch();
  const silent = { ...SPECTRUM, post: SPECTRUM.post.map(() => -Infinity), peak: SPECTRUM.peak.map(() => -Infinity) };
  const { desc, state } = withSpectrum(dir, { curve: null, spectrum: silent });
  assert.deepEqual(accentPixels(render(desc, state)), []);
});

// the goldens: omx-dsp's band vectors (48 kHz, 64 bands, the slope and the tiers) as POST, PRE the same less the fixture's EQ
// gain (the reference tool's curve), the fixture's curve; POST alone keeps its names of 0.13.8, each other mode its own
const GOLDEN = join(RENDERER, 'test', 'golden');
const UPDATE = process.env.OMX_PANEL_RENDER_UPDATE === '1';
const gainAt = (hz) => -12 * Math.exp(-((Math.log10(hz / 1000) / 0.05) ** 2)) + 6 / (1 + Math.pow(5000 / hz, 2));
const level = (x) => (x === null ? -Infinity : x);
for (const [modeName, extra] of [['', { mode: 'post' }], ['pre-', { mode: 'pre' }], ['both-', { mode: 'both' }], ['delta-', { mode: 'both', delta: true }]]) {
  for (const [sizeName, size] of [['natural', null], ['compact', [320, 200]]]) {
    for (const scale of [1, 2]) {
      test(`eq-spectrum, ${modeName || 'post-'}${sizeName}, ${scale}x: the golden image`, () => {
        const file = join(GOLDEN, `eq-spectrum-${modeName}${sizeName}@${scale}x.png`);
        const v = vectors.find((c) => c.kind === (sizeName === 'natural' ? 'slope' : 'tiers'));
        const post = v.db.map(level), pre = v.db.map((x, k) => level(x) - gainAt(v.hz[k]));
        const peak = extra.mode === 'pre' ? v.peak.map((x, k) => level(x) - gainAt(v.hz[k])) : v.peak.map(level);
        const { desc, state } = withSpectrum(scratch(), { spectrum: { hz: v.hz, pre, post, peak, ...extra,
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
}

// ------------------------------------------------------------------------------------------------- the taps and the delta

const X = (f) => PLOT.x + f * PLOT.w, Y = (f) => PLOT.y + f * PLOT.h;
const lum = (c) => c[0] + c[1] + c[2];
/** The brightest pixel within `r` px of (x, y), by the sum of its channels. */
function brightest(img, x, y, r = 2) {
  let best = null;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const c = px(img, Math.round(x) + dx, Math.round(y) + dy);
    if (!best || lum(c) > lum(best)) best = c;
  }
  return best;
}
const gratRows = ref.graticule.map(Y);
const clearOfGrid = (y) => gratRows.every((g) => Math.abs(g - y) > 2);
// the console's POST and PRE traces in plot fractions, band by band
const postAt = ref.trace, preAt = ref.both.preTrace;

test('PRE alone fills PRE as POST alone fills POST: the same picture, and the tap PRE mode hides is not drawn', () => {
  const asPost = withSpectrum(scratch(), { spectrum: SPECTRUM });
  const asPre = withSpectrum(scratch(), { spectrum: { ...SPECTRUM, mode: 'pre', pre: SPECTRUM.post, post: undefined } });
  const withHidden = withSpectrum(scratch(), { spectrum: { ...SPECTRUM, mode: 'pre', pre: SPECTRUM.post, post: PRE } });
  const want = render(asPost.desc, asPost.state);
  for (const [why, f] of [['PRE alone', asPre], ['PRE with POST given and hidden', withHidden]]) {
    const d = compare(render(f.desc, f.state), want);
    assert.ok(d.sameSize && d.exact, `${why}: ${d.off} pixels differ from POST alone`);
  }
});

test('POST alone needs no PRE: a hidden tap may be left out', () => {
  const { desc, state } = withSpectrum(scratch(), { spectrum: { ...SPECTRUM, pre: undefined } });
  assert.doesNotThrow(() => render(desc, state));
});

test('both: POST and the curve are still the console\'s strokes within 1 px both ways (PRE is no accent stroke)', () => {
  const { desc, state } = withSpectrum(scratch(), { spectrum: BOTH });
  const drawn = accentPixels(render(desc, state));
  const want = [...polylinePixels(ref.trace), ...polylinePixels(ref.curve)];
  assert.equal(within1(drawn, want).length, 0, 'a drawn accent pixel off the console\'s strokes');
  assert.equal(within1(want, drawn).length, 0, 'a console stroke pixel not drawn');
});

/** The bands where PRE is louder than POST by at least `gap` px: PRE's line there stands clear of POST's area. */
const preAbove = (gap) => preAt.map((p, k) => k).filter((k) => (postAt[k].y - preAt[k].y) * PLOT.h >= gap);

test('both: PRE is a dim reference line on the console\'s pre trace, never at full weight', () => {
  const { desc, state } = withSpectrum(scratch(), { spectrum: BOTH, curve: null });
  const img = render(desc, state);
  const bands = preAbove(4);
  assert.ok(bands.length >= 1, 'the fixture has a band where PRE stands above POST');
  for (const k of bands) {
    const c = brightest(img, X(preAt[k].x), Y(preAt[k].y), 1);
    assert.ok(lum(c) >= lum(BODY) + 0.35 * (lum(DIM) - lum(BODY)), `band ${k}: no PRE line at the console's pre trace (${c})`);
    assert.ok(lum(c) <= lum(DIM) + 6, `band ${k}: PRE at ${c} is brighter than the dim line (${DIM}): drawn at full weight`);
  }
});

test('both: PRE is not filled, the gap above POST is the plot\'s body', () => {
  const { desc, state } = withSpectrum(scratch(), { spectrum: BOTH, curve: null });
  const img = render(desc, state);
  const bands = preAbove(8).filter((k) => clearOfGrid(Y((preAt[k].y + postAt[k].y) / 2)));
  assert.ok(bands.length >= 1, 'a band with a gap of 8 px clear of the graticule');
  for (const k of bands) {
    const at = px(img, Math.round(X(preAt[k].x)), Math.round(Y((preAt[k].y + postAt[k].y) / 2)));
    assert.ok(near(at, BODY, 6), `band ${k}: the gap between PRE and POST is ${at}, not the body ${BODY}: PRE is filled`);
  }
});

/** What omx_rta_band_delta says of the pair (k, k + 1) of the fixture's taps: none, or its sign and its alpha. */
function wedgeOf(k) {
  const d0 = SPECTRUM.post[k] - PRE[k], d1 = SPECTRUM.post[k + 1] - PRE[k + 1], m = Math.max(Math.abs(d0), Math.abs(d1));
  if (m < DEADBAND) return null;
  return { sign: d0 + d1 >= 0 ? 'boost' : 'cut', alpha: Math.round(45 + 45 * Math.min(1, m / EQ_MAX)) / 100 };
}

test('delta: a wedge where the console draws one, in its sign\'s role at 45 % to 90 % with its strength, and none elsewhere', () => {
  const { desc, state } = withSpectrum(scratch(), { spectrum: { ...DELTA }, curve: null });
  const img = render(desc, state);
  const console = new Map(ref.delta.wedges.map((w) => [w.band, w]));
  assert.ok(console.size >= 3, `the console draws ${console.size} wedges for the fixture`);
  let checked = 0;
  for (let k = 0; k + 1 < SPECTRUM.hz.length; k++) {
    const w = wedgeOf(k), c = console.get(k);
    assert.equal(!!w, !!c, `pair ${k}: omx-dsp's delta and the console's scene disagree on a wedge`);
    if (c) assert.equal(w.sign, c.sign, `pair ${k}: the console's wedge is a ${c.sign}`);
    const cx = (X(preAt[k].x) + X(preAt[k + 1].x)) / 2;
    const ya = (Y(preAt[k].y) + Y(preAt[k + 1].y)) / 2, yb = (Y(postAt[k].y) + Y(postAt[k + 1].y)) / 2, cy = (ya + yb) / 2;
    if (Math.abs(yb - ya) < 3.5 || !clearOfGrid(cy)) continue;
    const at = px(img, Math.round(cx), Math.round(cy));
    if (w) {
      const want = over(BODY, w.sign === 'boost' ? BOOST : CUT, w.alpha);
      assert.ok(near(at, want, 8), `pair ${k}: the ${w.sign} wedge is ${at}, want ${want} (alpha ${w.alpha})`);
    } else assert.ok(near(at, BODY, 6), `pair ${k}: inside the deadband, yet ${at} is drawn`);
    checked++;
  }
  assert.ok(checked >= 3, `${checked} pairs had room to check`);
});

// the deadband, on a level window narrow enough that 0.3 dB is pixels: POST flat near -1 dB, PRE below it by less than
// omx-dsp's deadband over the first half of the bands and by more over the second; each level on a pixel row's centre, so a
// line's core pixel is its colour at full coverage
const NB = 16, NARROW = { dbMin: -2, dbMax: 0, gridDb: 1 };
const ROW_DB = (NARROW.dbMax - NARROW.dbMin) / PLOT.h; // one pixel row in dB
const centred = (row) => NARROW.dbMax - (row + 0.5 - (PLOT.y - Math.floor(PLOT.y))) * ROW_DB;
const SMALL = 9 * ROW_DB, BIG = 19 * ROW_DB;
const nhz = Array.from({ length: NB }, (_, k) => 100 * Math.pow(100, k / (NB - 1)));
const npost = nhz.map(() => centred(30)), npre = nhz.map((_, k) => centred(k < NB / 2 ? 39 : 49));
const NSPEC = { hz: nhz, pre: npre, post: npost, peak: npost, mode: 'both', delta: true, ...NARROW };
const nx = (k) => PLOT.x + (Math.log10(nhz[k]) - 2) / 2 * PLOT.w, ny = (db) => PLOT.y + (0 - db) / 2 * PLOT.h;

test('delta: a pair whose larger difference is under omx-dsp\'s deadband draws no wedge; one past it does', () => {
  assert.ok(SMALL < DEADBAND && BIG >= DEADBAND, `${SMALL} dB and ${BIG} dB straddle the deadband ${DEADBAND} dB`);
  const { desc, state } = withSpectrum(scratch(), { spectrum: NSPEC, curve: null });
  const img = render(desc, state);
  const centre = (k) => px(img, Math.round((nx(k) + nx(k + 1)) / 2), Math.round((ny(npre[k]) + ny(npost[k])) / 2));
  for (const k of [1, 3, 5]) assert.ok(near(centre(k), BODY, 6), `pair ${k} (${SMALL.toFixed(3)} dB) is drawn: ${centre(k)}`);
  const alpha = Math.round(45 + 45 * Math.min(1, BIG / EQ_MAX)) / 100;
  for (const k of [9, 11, 13]) assert.ok(near(centre(k), over(BODY, BOOST, alpha), 8), `pair ${k} (${BIG.toFixed(3)} dB): ${centre(k)}`);
});

test('delta: PRE and POST are full-strength lines and nothing is filled', () => {
  const delta = render(...Object.values(withSpectrum(scratch(), { spectrum: NSPEC, curve: null })));
  for (const k of [2, 4]) {
    const x = (nx(k) + nx(k + 1)) / 2;
    const pre = brightest(delta, x, ny(npre[k])), post = brightest(delta, x, ny(npost[k]));
    assert.ok(near(pre, INKDIM, 12), `pair ${k}: PRE with the delta is ${pre}, not the dim ink at full strength ${INKDIM}`);
    assert.ok(near(post, ACCENT, 12), `pair ${k}: POST with the delta is ${post}, not the accent ${ACCENT}`);
    const foot = px(delta, Math.round(x), Math.round(PLOT.y + PLOT.h - 3));
    assert.ok(near(foot, BODY, 6), `pair ${k}: the foot under the traces is ${foot}: an area is filled with the delta`);
  }
});
