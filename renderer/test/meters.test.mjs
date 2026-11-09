// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * A meter of the description is drawn as a bar and a marker over the description's range (contract 7.9, omx-dsp#301): the bar by
 * the value (a level from the foot of the range, a gain reduction from 0 dB), the marker holding the peak (the deepest
 * reduction) and falling by elapsed time at omx-dsp's rate, whatever the draw tick's rate, silence included. The rate is
 * omx-dsp's data/primitives/meter.json, read when the renderer was built: this reads the same file and the built header,
 * and holds them equal. Each rule has its arm in the sabotage of renderer/src/view.c the commit message names.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { FIXTURES, RENDERER, descriptionFile, render, scratch, stateFile } from './harness.mjs';

const modgui = await import(join(RENDERER, '..', 'dist', 'tools', 'modgui-gen.mjs'));
const fx = FIXTURES.find((f) => f.name === 'meters');
const g = modgui.GEOMETRY;
const look = modgui.loadLook().tokens;
const hex = (t) => [1, 3, 5].map((i) => parseInt(look[t].slice(i, i + 2), 16));
const ACCENT = hex('--accent'), INK = hex('--ink');
const p = modgui.resolvePanel(JSON.parse(readFileSync(join(RENDERER, '..', fx.descriptor), 'utf8')), { panel: JSON.parse(readFileSync(join(RENDERER, '..', fx.panel), 'utf8')), stem: fx.stem });
const lay = modgui.layout(p);
const METERS = ['in_level', 'out_level', 'gr', 'lufs'];
const row = (symbol) => METERS.indexOf(symbol);
/** The frame of a meter: x, y, inner width at scale 1. */
const frame = (symbol) => ({ x: lay.band.x + g.sectionPad, y: lay.band.y + g.sectionTitleH + row(symbol) * (g.meterH + g.meterGap), w: lay.band.w - 2 * g.sectionPad });

/** The meter law's fall, dB per second: the built header's, and the file's it was generated from. */
function lawFall() {
  const header = readFileSync(join(RENDERER, 'build', 'meter_law.h'), 'utf8');
  const fall = Number(/OMX_METER_FALL_DB_PER_S ([0-9.]+)/.exec(header)[1]);
  const from = /^\/\* from (.*), METER_VIEW/.exec(header)[1];
  assert.ok(existsSync(from), `the header names ${from}`);
  assert.equal(fall, JSON.parse(readFileSync(from, 'utf8')).METER_VIEW.value.fallDbPerSecond, 'the header is the file\'s value');
  return fall;
}

/** The picture with `ticks` given to the meter `symbol`; the pixels at scale 1. */
function draw(symbol, ticks) {
  const dir = scratch();
  const desc = descriptionFile(fx, dir), state = JSON.parse(readFileSync(stateFile(fx, dir), 'utf8'));
  state.meters = { [symbol]: ticks };
  const st = join(dir, 'meters.state.json');
  writeFileSync(st, JSON.stringify(state));
  return render(desc, st);
}
const near = (px, c) => px.every((v, k) => Math.abs(v - c[k]) <= 2);
const at = (img, x, y) => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 3));
/** How many pixels of `colour` along the row `y`, across the frame's inner width. */
const run = (img, f, y, colour) => { let n = 0; for (let x = Math.round(f.x) + 2; x < Math.round(f.x + f.w) - 2; x++) if (near(at(img, x, y), colour)) n++; return n; };
/** The bar's row (its middle) and the marker's top row, in px. */
const barRow = (f) => Math.round(f.y + g.meterH - 4);
const markRow = (f) => Math.round(f.y + g.meterH - 7);
/** The marker's x (its left edge), or null. */
const markerAt = (img, f) => { for (let x = Math.round(f.x) + 2; x < Math.round(f.x + f.w); x++) if (near(at(img, x, markRow(f)), INK)) return x - (Math.round(f.x) + 2); return null; };
/** Accent pixels of the row `y` right of the frame's inner edge: a bar that left its range. */
const outside = (img, f, y) => { let n = 0; for (let x = Math.round(f.x + f.w) - 1; x < img.w; x++) if (near(at(img, x, y), ACCENT)) n++; return n; };
const inner = (f) => f.w - 4;

test('the law the renderer was built with is omx-dsp\'s meter.json, 18 dB per second', () => {
  assert.equal(lawFall(), 18);
});
test('a level bar is the value\'s place in the description\'s range, from its foot', () => {
  const f = frame('in_level');
  for (const [value, share] of [[-60, 0], [-45, 0.25], [-30, 0.5], [0, 1], [-90, 0], [6, 1]]) {
    const n = run(draw('in_level', [{ value, elapsed: 0 }]), f, barRow(f), ACCENT);
    assert.ok(Math.abs(n - share * inner(f)) <= 3, `${value} dBFS fills ${n} of ${inner(f)}`);
    const img = draw('in_level', [{ value, elapsed: 0 }]);
    assert.equal(outside(img, f, barRow(f)), 0, `${value} dBFS stays inside its frame`);
  }
});
test('the range is each meter\'s own: the loudness meter\'s -70 to 0', () => {
  const f = frame('lufs');
  const n = run(draw('lufs', [{ value: -35, elapsed: 0 }]), f, barRow(f), ACCENT);
  assert.ok(Math.abs(n - 0.5 * inner(f)) <= 3, `${n}`);
});
test('a gain reduction grows from 0 dB toward the foot of its range', () => {
  const f = frame('gr');
  for (const [value, share] of [[0, 0], [-6, 0.25], [-12, 0.5], [-24, 1], [-40, 1]]) {
    const n = run(draw('gr', [{ value, elapsed: 0 }]), f, barRow(f), ACCENT);
    assert.ok(Math.abs(n - share * inner(f)) <= 3, `${value} dB fills ${n} of ${inner(f)}`);
  }
});
test('with no reading the frame stands: no bar, no marker', () => {
  const dir = scratch();
  const img = render(descriptionFile(fx, dir), stateFile(fx, dir));
  const f = frame('in_level');
  assert.equal(run(img, f, barRow(f), ACCENT), 0);
  assert.equal(markerAt(img, f), null);
});
test('the marker falls by elapsed time at the law\'s rate: the peak, then 18 dB for each second', () => {
  const f = frame('in_level'), fall = lawFall();
  const place = (db) => ((db + 60) / 60) * inner(f);
  for (const [elapsed, from] of [[0, -6], [0.5, -6], [1, -6], [2, -6]]) {
    const m = markerAt(draw('in_level', [{ value: from, elapsed: 0 }, { value: -60, elapsed }]), f);
    const want = place(Math.max(-60, from - fall * elapsed));
    assert.ok(m !== null && Math.abs(m + 1 - want) <= 2, `${elapsed} s: marker at ${m}, wanted about ${want}`);
  }
});
test('the fall is by elapsed time, not by tick: one second in one tick, in ten and in sixty is one place', () => {
  const f = frame('in_level');
  const at1 = (n) => markerAt(draw('in_level', [{ value: -6, elapsed: 0 }, ...Array.from({ length: n }, () => ({ value: -60, elapsed: 1 / n }))]), f);
  const one = at1(1);
  assert.ok(one !== null);
  for (const n of [5, 10, 20, 60]) assert.ok(Math.abs(at1(n) - one) <= 1, `${n} ticks`);
});
test('the marker keeps the peak while the level stays under it, and rises with a louder one', () => {
  const f = frame('in_level');
  const held = markerAt(draw('in_level', [{ value: -12, elapsed: 0 }, { value: -40, elapsed: 0.1 }]), f);
  const up = markerAt(draw('in_level', [{ value: -12, elapsed: 0 }, { value: -3, elapsed: 0.1 }]), f);
  assert.ok(up > held, `${up} over ${held}`);
  assert.ok(Math.abs(held + 1 - ((-12 - 1.8 + 60) / 60) * inner(f)) <= 2);
});
test('silence falls: the marker reaches the foot of the range and stays', () => {
  const f = frame('in_level');
  assert.equal(markerAt(draw('in_level', [{ value: -6, elapsed: 0 }, { value: -60, elapsed: 5 }]), f), 0);
});
test('a gain reduction\'s marker holds the deepest and recovers toward 0 dB at the same rate', () => {
  const f = frame('gr');
  const place = (db) => ((0 - db) / 24) * inner(f);
  const m = markerAt(draw('gr', [{ value: -20, elapsed: 0 }, { value: 0, elapsed: 0.5 }]), f);
  assert.ok(m !== null && Math.abs(m + 1 - place(-20 + 18 * 0.5)) <= 2, `${m}`);
});
test('a reading that is no finite value, or a negative elapsed time, is refused by the command', () => {
  const dir = scratch();
  const desc = descriptionFile(fx, dir), state = JSON.parse(readFileSync(stateFile(fx, dir), 'utf8'));
  for (const bad of [[{ value: 1e999, elapsed: 0 }], [{ value: -6, elapsed: -1 }], [{ elapsed: 0 }]]) {
    writeFileSync(join(dir, 's.json'), JSON.stringify({ ...state, meters: { gr: bad } }).replace('null', '1e999'));
    assert.throws(() => render(desc, join(dir, 's.json')), /meter/);
  }
});
test('a state that names a meter the panel has not is refused', () => {
  const dir = scratch();
  const state = JSON.parse(readFileSync(stateFile(fx, dir), 'utf8'));
  writeFileSync(join(dir, 's.json'), JSON.stringify({ ...state, meters: { nope: [{ value: 0 }] } }));
  assert.throws(() => execFileSync(join(RENDERER, 'build', 'omx-panel-render'), ['--description', descriptionFile(fx, dir), '--data', join(RENDERER, '..', 'tools'), '--state', join(dir, 's.json'), '--raw', join(dir, 'o.raw')], { stdio: 'pipe' }), /no meter of the panel/);
});
