// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The renderer answers input with the one gesture vocabulary (one-panel spec 7.8). tools/gestures.mjs is the reference and
 * schema/gestures.json the declaration; the renderer keeps no timing or threshold of its own (it reads that file), so
 * every check here runs the renderer's `--input` over a fixture's description and holds what it answers to the reference module:
 *
 *   - the 7.5 fixtures' scripted gestures (test/fixtures/gestures/scripts.json), retargeted onto the renderer's own cells: the value
 *     within one declared step of the reference's in the control's own unit, reset and tap exact, the words and the counts equal;
 *   - the same gestures built from the renderer's geometry in fractions of the travel, against a hand-worked value;
 *   - the guards, each with its sabotage arm: a changed fine ratio, a read-only control, a second pointer on an owned control, the
 *     palm guard, the safety hold and its floor, a view given no declaration.
 * The renderer-against-MOD-GUI raster parity is parity.test.mjs, unchanged and still exact.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLI, DATA, FIXTURES, ROOT, descriptionFile, scratch } from './harness.mjs';
import { GESTURES, memberOf, normOf, runGesture, stepOf, withinStep } from '../../dist/tools/gestures.mjs';

const SCRIPTS = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/gestures/scripts.json'), 'utf8')).scripts;
const descriptorOf = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));

// ---- the fixtures: the three that take a gesture, and the 8-band graphic EQ's bar group, which has no descriptor of its own ----

const dir = scratch();
const graphicEq = join(dir, 'graphic-eq.descriptor.json');
{
  const organ = descriptorOf('test/fixtures/organ/organ.descriptor.json');
  writeFileSync(graphicEq, JSON.stringify({
    ...organ,
    plugin: { ...organ.plugin, id: 'urn:omx-panel:test:graphic-eq', uri: 'urn:omx-panel:test:graphic-eq', name: 'Test Graphic EQ' },
    controls: Array.from({ length: 8 }, (_x, i) => ({ id: `g${i}`, symbol: `g${i}`, name: `${100 * 2 ** i} Hz`, label: `${100 * 2 ** i} Hz`, kind: 'travel', group: ['Graphic EQ'], travel: { min: -12, max: 12, unit: 'dB', scale: 'linear', default: 0 } })),
  }));
}
const FIXTURE = {
  eq: FIXTURES.find((f) => f.name === 'eq-marks'),
  comp: FIXTURES.find((f) => f.name === 'dyn-curve'),
  organ: FIXTURES.find((f) => f.name === 'organ'),
  graphic: { name: 'graphic-eq', descriptor: graphicEq },
};
const fixtureOf = (s) => (s.name.startsWith('omx-eq') ? FIXTURE.eq : s.name.startsWith('omx-comp') ? FIXTURE.comp : s.name.startsWith('8-band') ? FIXTURE.graphic : FIXTURE.organ);
const descriptions = new Map();
const descriptionOf = (fx) => (descriptions.has(fx) ? descriptions.get(fx) : descriptions.set(fx, descriptionFile(fx, dir)).get(fx));
function descriptorControls(fx) {
  const d = fx.descriptor.startsWith('/') ? JSON.parse(readFileSync(fx.descriptor, 'utf8')) : descriptorOf(fx.descriptor);
  return Object.fromEntries(d.controls.filter((c) => c.travel).map((c) => [c.symbol, c.travel]));
}

let n = 0;
/** The renderer's `--input` over `fx` with `input`, parsed. `data` is a tools directory (the declaration is found beside it). */
function renderer(fx, input, { data = DATA } = {}) {
  const file = join(dir, `input-${++n}.json`);
  writeFileSync(file, JSON.stringify(input));
  return JSON.parse(execFileSync(CLI, ['--description', descriptionOf(fx), '--data', data, '--input', file], { encoding: 'utf8' }));
}

/** Each control's travel and, where a start value is given, its place on it: what the host hands the renderer. */
function hostOf(fx, start = {}) {
  const travel = {}, fractions = {};
  for (const [symbol, t] of Object.entries(descriptorControls(fx))) {
    const m = memberOf({ travel: t });
    travel[symbol] = { min: m.min, max: m.max, def: m.def, ...(m.step !== undefined ? { step: m.step } : {}), log: m.scale === 'log', integer: m.integer };
    fractions[symbol] = normOf(m, start[symbol] ?? m.def ?? m.min);
  }
  return { travel, fractions };
}
const memberFor = (fx, symbol, extra = {}) => memberOf({ travel: descriptorControls(fx)[symbol] }, extra);

// ---- the scripts of the 7.5 fixtures, retargeted onto the renderer's cells -------------------------------------------------

/** One script of scripts.json run through the renderer and through the reference; what each answered, or the faults. */
function parity(s, { data = DATA, settings } = {}) {
  const fx = fixtureOf(s), c = s.control;
  const mouse = s.mouse ? { paintWithMouse: false } : {};
  const base = { ...settings, ...mouse };
  let symbols, start, retarget, refControl;
  if (c.widget === 'handle') {
    symbols = [c.members.freq, c.members.gain, c.members.q];
    start = Object.fromEntries(Object.entries(c.start).map(([k, v]) => [c.members[k], v]));
    // the renderer draws no handle: the surface binds it, with the geometry its script gives (so the script runs as written)
    const handles = [{ freq: symbols[0], gain: symbols[1], q: symbols[2], target: [c.target.x, c.target.y, c.target.w, c.target.h], plot: [c.plot.w, c.plot.h] }];
    const host = hostOf(fx, start);
    const run = renderer(fx, { ...host, handles, settings: base, events: s.script.map((e) => (e.type === 'down' || e.type === 'move' || e.type === 'up' ? e : { ...e, control: symbols[0] })) }, { data });
    refControl = { widget: 'handle', target: c.target, plot: c.plot, freq: memberFor(fx, symbols[0], c.start.freq !== undefined ? { value: c.start.freq } : {}), gain: memberFor(fx, symbols[1], c.start.gain !== undefined ? { value: c.start.gain } : {}), q: memberFor(fx, symbols[2], c.start.q !== undefined ? { value: c.start.q } : {}) };
    const ref = runGesture(refControl, s.script.map((e) => e), s.mouse ? { paintWithMouse: false } : {});
    return { run, ref, symbols, members: { [symbols[0]]: refControl.freq, [symbols[1]]: refControl.gain, [symbols[2]]: refControl.q }, refValue: { [symbols[0]]: ref.value.freq, [symbols[1]]: ref.value.gain, [symbols[2]]: ref.value.q }, handle: true };
  }
  const geo = renderer(fx, { ...hostOf(fx), settings: base, events: [] }, { data }).geometry;
  if (c.widget === 'bar') {
    symbols = c.symbols ?? c.members.map((b) => b.symbol);
    start = c.start ?? {};
    const scriptCols = c.symbols ? symbols.map((_x, i) => ({ x: i * c.geometry.pitch, w: c.geometry.w })) : c.members.map((b) => b.target);
    const top = (c.symbols ? 0 : c.members[0].target.y), height = c.symbols ? c.geometry.h : c.members[0].target.h;
    retarget = (e) => {
      if (e.x === undefined) return e;
      let i = scriptCols.findLastIndex((col) => e.x >= col.x);
      i = Math.max(0, i);
      const r = geo[symbols[i]].rect, col = scriptCols[i];
      // a bar is a track of its own height here: x by column, y by the share of the track
      return { ...e, x: r[0] + Math.min(r[2] - 1e-6, (e.x - col.x) * (r[2] / col.w)), y: r[1] + (e.y - top) * (r[3] / height) };
    };
    refControl = { widget: 'bar', bars: symbols.map((symbol) => ({ ...memberFor(fx, symbol, start[symbol] !== undefined ? { value: start[symbol] } : {}), symbol, target: { x: geo[symbol].rect[0], y: geo[symbol].rect[1], w: geo[symbol].rect[2], h: geo[symbol].rect[3] } })) };
  } else {
    symbols = [c.member];
    start = c.start.value !== undefined ? { [c.member]: c.start.value } : {};
    const r = geo[c.member].rect;
    retarget = (e) => (e.x === undefined ? e : { ...e, x: r[0] + (e.x - c.target.x), y: r[1] + (e.y - c.target.y) });
    refControl = { widget: descriptorWidget(fx, c.member), ...memberFor(fx, c.member, start[c.member] !== undefined ? { value: start[c.member] } : {}), target: { x: r[0], y: r[1], w: r[2], h: r[3] }, travelPx: geo[c.member].travelPx };
  }
  const events = s.script.map(retarget);
  const named = events.map((e) => (e.type === 'down' || e.type === 'move' || e.type === 'up' ? e : { ...e, control: e.bar ?? symbols[0] }));
  const run = renderer(fx, { ...hostOf(fx, start), settings: base, events: named }, { data });
  const ref = runGesture(refControl, events, s.mouse ? { paintWithMouse: false } : {});
  const members = c.widget === 'bar' ? Object.fromEntries(refControl.bars.map((b) => [b.symbol, b])) : { [symbols[0]]: refControl };
  const refValue = c.widget === 'bar' ? ref.value : { [symbols[0]]: ref.value };
  return { run, ref, symbols, members, refValue, handle: false };
}
const descriptorWidget = (fx, symbol) => {
  const d = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'dist/bin/omx-panel.mjs'), 'layout', '--descriptor', fx.descriptor.startsWith('/') ? fx.descriptor : join(ROOT, fx.descriptor), ...(fx.panel ? ['--panel', join(ROOT, fx.panel)] : [])], { encoding: 'utf8' }));
  return d.controls.find((k) => k.symbol === symbol).standard.widget;
};

/** What differs between the renderer's answer and the reference's: [] when they agree. */
function faults(s, p) {
  const out = [];
  const exact = s.expect.tolerance === 'exact';
  for (const symbol of Object.keys(p.refValue)) {
    const got = p.run.controls[symbol].value, want = p.refValue[symbol], m = p.members[symbol];
    // a value the gesture set is the reference's exactly (a reset is the declared default); one it left alone only went through the host's fraction
    const set = Object.keys(p.run.gestures.at(-1)?.changes ?? {}).includes(symbol);
    if (exact ? (set ? got !== want : Math.abs(got - want) > 1e-9 * Math.max(1, Math.abs(want))) : !withinStep(m, got, want)) out.push(`${symbol}: the renderer ${got}, the reference ${want}${exact ? ' (exact)' : ` (one step is ${stepOf(m, want)})`}`);
  }
  if (p.run.error) out.push(`error ${p.run.error}`);
  const words = p.run.gestures.map((g) => g.word).join(), refWords = p.ref.gestures.map((g) => g.word).join();
  if (words !== refWords) out.push(`gestures ${words}, the reference ${refWords}`);
  if (p.run.refused.map((r) => r.code).join() !== p.ref.refused.map((r) => r.code).join()) out.push(`refused ${p.run.refused.map((r) => r.code)}, the reference ${p.ref.refused.map((r) => r.code)}`);
  const undo = p.run.gestures.filter((g) => Object.keys(g.changes).length).length;
  if (undo !== p.ref.undo.length) out.push(`undo entries ${undo}, the reference ${p.ref.undo.length}`);
  const last = p.run.gestures.at(-1), refLast = p.ref.gesture;
  if (last && refLast && (last.begin !== refLast.begin || last.end !== refLast.end)) out.push(`begin/end ${last.begin}/${last.end}, the reference ${refLast.begin}/${refLast.end}`);
  return out;
}

for (const s of SCRIPTS) {
  test(`renderer input: ${s.name}`, () => {
    const p = parity(s);
    assert.deepEqual(faults(s, p), []);
    // the hand-worked value and word of scripts.json, where the geometry is the script's own (a handle's, a step's)
    if (s.expect.word) assert.equal(p.run.gestures.at(-1).word, s.expect.word);
    if (s.expect.gestures !== undefined) assert.equal(p.run.gestures.length, s.expect.gestures);
    if (s.expect.selected !== undefined) assert.equal(p.run.selected === p.symbols[0] && p.handle ? 'handle' : p.run.selected, s.expect.selected);
    if (p.handle || s.expect.word === 'step' || s.expect.word === 'second' || s.expect.word === 'select' || s.expect.word === 'reset') {
      const want = typeof s.expect.value === 'object' ? s.expect.value : { [p.symbols[0]]: s.expect.value };
      const keys = typeof s.expect.value === 'object' ? (p.handle ? { freq: p.symbols[0], gain: p.symbols[1], q: p.symbols[2] } : Object.fromEntries(Object.keys(want).map((k) => [k, k]))) : { [p.symbols[0]]: p.symbols[0] };
      for (const [k, w] of Object.entries(want)) {
        const symbol = p.handle ? keys[k] : keys[k] ?? k, got = p.run.controls[symbol].value, m = p.members[symbol];
        if (s.expect.tolerance === 'exact') assert.ok(Math.abs(got - w) <= 1e-9 * Math.max(1, Math.abs(w)), `${symbol} ${got} exact against ${w}`);
        else if (s.expect.word !== 'step' || p.handle || m) assert.ok(m ? withinStep(m, got, w) : got === w, `${symbol}: ${got} against ${w}`);
      }
    }
  });
}

test('every script of scripts.json is run: the handle, the single control and both bar groups', () => {
  const kinds = new Set(SCRIPTS.map((s) => `${s.control.widget}:${fixtureOf(s).name}`));
  for (const k of ['handle:eq-marks', 'fader:dyn-curve', 'bar:graphic-eq', 'bar:organ']) assert.ok(kinds.has(k), k);
  assert.equal(SCRIPTS.length, 20);
});

// ---- the same gestures built from the renderer's geometry, with a hand-worked value --------------------------------------------

const D = (t, id, x, y, ptype = 'touch') => ({ t, type: 'down', id, ptype, x, y });
const M = (t, id, x, y, ptype = 'touch', fine) => ({ t, type: 'move', id, ptype, x, y, ...(fine ? { fine: true } : {}) });
const U = (t, id, x, y, ptype = 'touch') => ({ t, type: 'up', id, ptype, x, y });
const geometry = (fx) => renderer(fx, { ...hostOf(fx), events: [] }).geometry;

test('a fader drag moves the value by the drag over its travel, from where the threshold was crossed', () => {
  const fx = FIXTURE.comp, g = geometry(fx).threshold, [x, y, w, h] = g.rect, cx = x + w / 2, cy = y + h / 2;
  const m = memberFor(fx, 'threshold');
  // 11 px crosses the threshold (dead travel); then half the travel up
  const half = g.travelPx / 2;
  const run = renderer(fx, { ...hostOf(fx, { threshold: -40 }), events: [D(0, 'p', cx, cy), M(10, 'p', cx, cy - 11), M(20, 'p', cx, cy - 11 - half), U(30, 'p', cx, cy - 11 - half)] });
  const want = -40 + 0.5 * (m.max - m.min);
  assert.ok(withinStep(m, run.controls.threshold.value, want), `${run.controls.threshold.value} against ${want}`);
  assert.deepEqual([run.gestures[0].word, run.gestures[0].begin, run.gestures[0].end], ['drag', 0, 30]);
  const fine = renderer(fx, { ...hostOf(fx, { threshold: -40 }), events: [D(0, 'p', cx, cy), M(10, 'p', cx, cy - 11, 'touch', true), M(20, 'p', cx, cy - 11 - half, 'touch', true), U(30, 'p', cx, cy - 11 - half)] });
  const wantFine = -40 + GESTURES.thresholds.fineRatio * 0.5 * (m.max - m.min);
  assert.ok(withinStep(m, fine.controls.threshold.value, wantFine), `${fine.controls.threshold.value} against ${wantFine}`);
  assert.equal(fine.gestures[0].word, 'fine');
});

test('a sweep across the bars paints each bar it enters at the height of the finger, one gesture, one undo entry', () => {
  const fx = FIXTURE.graphic, geo = geometry(fx), cols = Array.from({ length: 8 }, (_x, i) => geo[`g${i}`].rect);
  const at = (i, f) => [cols[i][0] + cols[i][2] / 2, cols[i][1] + cols[i][3] * (1 - f)];
  const fr = [0.25, 0.5, 0.75, 0.1];
  const events = [D(0, 'p', at(0, fr[0])[0] - 12, at(0, fr[0])[1]), M(10, 'p', at(0, fr[0])[0] + 12, at(0, fr[0])[1]), ...fr.slice(1).map((f, k) => M(20 + 10 * k, 'p', ...at(k + 1, f))), U(60, 'p', ...at(3, fr[3]))];
  const run = renderer(fx, { ...hostOf(fx), events });
  assert.equal(run.gestures.length, 1);
  assert.equal(run.gestures[0].word, 'paint');
  assert.deepEqual(Object.keys(run.gestures[0].changes), ['g0', 'g1', 'g2', 'g3']);
  const m = memberFor(fx, 'g0');
  fr.forEach((f, i) => assert.ok(Math.abs(run.controls[`g${i}`].fraction - f) <= 0.011, `g${i}: ${run.controls[`g${i}`].fraction} against ${f}`));
  assert.ok(m.max - m.min === 24);
  // a mouse paints only when the surface asks
  const mouse = events.map((e) => ({ ...e, ptype: 'mouse' }));
  assert.equal(renderer(fx, { ...hostOf(fx), events: mouse }).gestures[0].word, 'drag');
  assert.equal(renderer(fx, { ...hostOf(fx), settings: { paintWithMouse: true }, events: mouse }).gestures[0].word, 'paint');
  assert.equal(renderer(fx, { ...hostOf(fx), settings: { paintWithTouch: false }, events }).error, 'GESTURE_PAINT_REQUIRED_ON_TOUCH');
});

test('a tap selects and changes nothing; a double tap resets to the declared default; a wheel notch is one step', () => {
  const fx = FIXTURE.comp, g = geometry(fx).threshold, [x, y] = g.rect, m = memberFor(fx, 'threshold');
  const tap = renderer(fx, { ...hostOf(fx, { threshold: -40 }), events: [D(0, 'p', x + 5, y + 5), U(60, 'p', x + 5, y + 5)] });
  assert.equal(tap.controls.threshold.value, -40);
  assert.deepEqual(tap.gestures.map((q) => [q.word, Object.keys(q.changes).length]), [['select', 0]]);
  const twice = renderer(fx, { ...hostOf(fx, { threshold: -40 }), events: [D(0, 'p', x + 5, y + 5), U(60, 'p', x + 5, y + 5), D(150, 'p', x + 5, y + 5), U(200, 'p', x + 5, y + 5)] });
  assert.equal(twice.controls.threshold.value, -18, 'reset is exact');
  const wheel = renderer(fx, { ...hostOf(fx, { threshold: -40 }), events: [{ t: 0, type: 'wheel', n: 1, control: 'threshold' }] });
  assert.ok(Math.abs(wheel.controls.threshold.value - (-40 + 0.01 * (m.max - m.min))) < 1e-9, `${wheel.controls.threshold.value}`);
});

// ---- the guards, each with its arm ---------------------------------------------------------------------------------------------

/** A tools directory whose declaration (beside it, ../schema/gestures.json) is `edit`ed. */
function toolsWith(edit, name) {
  const root = join(dir, name), tools = join(root, 'tools');
  mkdirSync(join(root, 'schema'), { recursive: true });
  cpSync(DATA, tools, { recursive: true });
  const decl = JSON.parse(readFileSync(join(ROOT, 'schema/gestures.json'), 'utf8'));
  edit(decl);
  writeFileSync(join(root, 'schema/gestures.json'), JSON.stringify(decl));
  return tools;
}

test('arm: a changed fine ratio is seen: the renderer reads it from the declaration, and the parity check goes red', () => {
  const fine = SCRIPTS.find((s) => s.expect.word === 'fine' && s.control.widget === 'fader');
  assert.deepEqual(faults(fine, parity(fine)), [], 'the declared ratio agrees with the reference');
  const sabotaged = toolsWith((d) => { d.thresholds.fineRatio = 0.5; }, 'fine-ratio');
  const bad = faults(fine, parity(fine, { data: sabotaged }));
  assert.ok(bad.length > 0, 'a fine ratio the reference does not hold is a fault');
  // and the renderer follows the declaration it is given, not a ratio of its own: the same fine drag moves 0.5 where it moved 0.3
  const fx = FIXTURE.comp, [x, y, w, h] = geometry(fx).threshold.rect, cx = x + w / 2, cy = y + h / 2;
  const drag = (data) => renderer(fx, { ...hostOf(fx, { threshold: -40 }), events: [D(0, 'p', cx, cy), M(10, 'p', cx, cy - 11, 'touch', true), M(20, 'p', cx, cy - 31, 'touch', true), U(30, 'p', cx, cy - 31)] }, { data }).controls.threshold.fraction - normOf(memberFor(fx, 'threshold'), -40);
  assert.ok(Math.abs(drag(DATA) / drag(sabotaged) - 0.3 / 0.5) < 1e-9, `${drag(DATA)} against ${drag(sabotaged)}`);
});

test('a timing is the declaration\'s: a longer double-tap, a surface\'s own safety hold, never below the floor', () => {
  const fx = FIXTURE.comp, [x, y] = geometry(fx).threshold.rect;
  const taps = (gap) => [D(0, 'p', x + 5, y + 5), U(60, 'p', x + 5, y + 5), D(60 + gap, 'p', x + 5, y + 5), U(120 + gap, 'p', x + 5, y + 5)];
  const reset = (gap, settings) => renderer(fx, { ...hostOf(fx, { threshold: -40 }), settings, events: taps(gap) }).controls.threshold.value === -18;
  assert.equal(reset(300), true, 'at the declared double-tap time');
  assert.equal(reset(301), false, 'past it');
  assert.equal(reset(301, { timings: { doubleTapMs: 400 } }), true, 'a surface that lengthens it');
  assert.equal(reset(300, { timings: { doubleTapMs: 100 } }), false, 'or shortens it: the renderer has no number of its own');
  assert.equal(renderer(fx, { ...hostOf(fx), settings: { timings: { safetyHoldMs: 799 } }, events: [] }).error, 'GESTURE_HOLD_BELOW_FLOOR');
  assert.equal(renderer(fx, { ...hostOf(fx), settings: { timings: { safetyHoldMs: 1200 } }, events: [] }).error, undefined, 'a longer hold is the surface\'s');
  assert.equal(renderer(fx, { ...hostOf(fx), settings: { timings: { holdMs: 900 } }, events: [] }).error, 'GESTURE_BAD_SETTING');
  assert.equal(renderer(fx, { ...hostOf(fx), settings: { timings: { longPressMs: 0 } }, events: [] }).error, 'GESTURE_BAD_SETTING');
});

test('a safety-hold control acts only when held the hold, and a long-press is `more`, never a value', () => {
  const fx = FIXTURE.comp, [x, y] = geometry(fx).threshold.rect;
  const held = (ms, settings) => renderer(fx, { ...hostOf(fx, { threshold: -40 }), hold: ['threshold'], settings, events: [D(0, 'p', x + 5, y + 5), U(ms, 'p', x + 5, y + 5)] });
  assert.equal(held(799).refused[0].code, 'GESTURE_HOLD_SHORT');
  assert.equal(held(800).refused.length, 0);
  assert.equal(held(1000, { timings: { safetyHoldMs: 1200 } }).refused[0].code, 'GESTURE_HOLD_SHORT');
  const press = renderer(fx, { ...hostOf(fx, { threshold: -40 }), events: [D(0, 'p', x + 5, y + 5), U(700, 'p', x + 5, y + 5)] });
  assert.deepEqual(press.gestures.map((q) => [q.word, q.begin, Object.keys(q.changes).length]), [['more', 500, 0]]);
  assert.equal(press.controls.threshold.value, -40);
});

test('arm: a read-only control takes no gesture, whatever the input', () => {
  const fx = FIXTURE.comp, [x, y] = geometry(fx).threshold.rect, symbol = 'threshold';
  const inputs = [
    [D(0, 'p', x + 5, y + 5), M(20, 'p', x + 5, y - 30), U(40, 'p', x + 5, y - 30)],
    [D(0, 'p', x + 5, y + 5), U(60, 'p', x + 5, y + 5)],
    [D(0, 'p', x + 5, y + 5), U(60, 'p', x + 5, y + 5), D(150, 'p', x + 5, y + 5), U(200, 'p', x + 5, y + 5)],
    [{ t: 0, type: 'wheel', n: 1, control: symbol }],
    [{ t: 0, type: 'key', key: 'Backspace', control: symbol }],
    [D(0, 'p', x + 5, y + 5), U(900, 'p', x + 5, y + 5)],
  ];
  for (const events of inputs) {
    const r = renderer(fx, { ...hostOf(fx, { threshold: -40 }), readOnly: [symbol], events });
    assert.equal(r.controls[symbol].value, -40);
    assert.equal(r.gestures.length, 0, 'a read-only control took a gesture');
    assert.ok(r.refused.length > 0 && r.refused.every((q) => q.code === 'GESTURE_READ_ONLY'), JSON.stringify(r.refused));
  }
  // a meter is read-only by its widget, with nothing declared
  const meter = renderer(FIXTURE.eq, { ...hostOf(FIXTURE.eq), events: [] });
  assert.ok(meter.geometry);
});

test('arm: a control belongs to the pointer that pressed it; a later press, a mouse or a fader touch, is refused by name', () => {
  const fx = FIXTURE.comp, [x, y] = geometry(fx).threshold.rect;
  const second = renderer(fx, { ...hostOf(fx, { threshold: -40 }), events: [D(0, 'a', x + 5, y + 5), D(100, 'b', x + 8, y + 8, 'mouse'), M(120, 'b', x + 8, y - 40, 'mouse'), U(150, 'b', x + 8, y - 40, 'mouse'), U(200, 'a', x + 5, y + 5)] });
  assert.equal(second.refused[0].code, 'GESTURE_CONTROL_OWNED');
  assert.deepEqual(second.gestures.map((q) => q.word), ['select'], 'only the first pointer\'s tap');
  assert.equal(second.controls.threshold.value, -40);
  const fader = renderer(fx, { ...hostOf(fx, { threshold: -40 }), events: [D(0, 'hw', x + 5, y + 5, 'fader'), D(20, 'finger', x + 5, y + 5), U(40, 'finger', x + 5, y + 5), U(60, 'hw', x + 5, y + 5, 'fader')] });
  assert.equal(fader.refused[0].code, 'GESTURE_CONTROL_OWNED');
  const encoder = renderer(fx, { ...hostOf(fx, { threshold: -40 }), events: [D(0, 'a', x + 5, y + 5), { t: 50, type: 'detent', n: 1, control: 'threshold' }, U(100, 'a', x + 5, y + 5)] });
  assert.equal(encoder.refused[0].code, 'GESTURE_CONTROL_OWNED');
  assert.equal(encoder.controls.threshold.value, -40);
  // after a step the control is the stepper's through the claim
  const claimed = renderer(fx, { ...hostOf(fx, { threshold: -40 }), events: [{ t: 0, type: 'wheel', n: 1, control: 'threshold' }, D(100, 'p', x + 5, y + 5), U(160, 'p', x + 5, y + 5)] });
  assert.equal(claimed.refused[0].code, 'GESTURE_CONTROL_OWNED');
});

test('arm: a pinch is two pointers of one type within the palm guard; a later one is refused, never a pinch', () => {
  const fx = FIXTURE.eq, c = SCRIPTS.find((s) => s.control.widget === 'handle').control;
  const handles = [{ freq: 'f0', gain: 'g0', q: 'q0', target: [c.target.x, c.target.y, c.target.w, c.target.h], plot: [c.plot.w, c.plot.h] }];
  const pinch = (late, ptype2 = 'touch') => renderer(fx, { ...hostOf(fx, { f0: 500, g0: 9, q0: 2 }), handles, events: [D(0, 'a', 104, 83), D(late, 'b', 114, 93, ptype2), M(late + 20, 'b', 124, 103, ptype2), U(late + 40, 'b', 124, 103, ptype2), U(late + 60, 'a', 104, 83)] });
  const ok = pinch(100);
  assert.equal(ok.gestures.at(-1).word, 'second');
  assert.ok(ok.controls.q0.value > 2, `Q follows the spread: ${ok.controls.q0.value}`);
  assert.deepEqual(ok.refused, []);
  const late = pinch(301);
  assert.equal(late.controls.q0.value, 2);
  assert.equal(late.refused[0].code, 'GESTURE_CONTROL_OWNED');
  assert.ok(late.gestures.every((q) => q.word !== 'second'));
  assert.equal(pinch(300).gestures.at(-1).word, 'second', 'at the palm guard still a pinch');
  assert.equal(pinch(100, 'pen').refused[0].code, 'GESTURE_CONTROL_OWNED', 'another pointer type is not a pinch');
});

test('a view given no declaration refuses by name instead of answering less', () => {
  const root = join(dir, 'no-declaration'), tools = join(root, 'tools');
  mkdirSync(tools, { recursive: true });
  cpSync(DATA, tools, { recursive: true });
  const fx = FIXTURE.comp;
  const [x, y] = geometry(fx).threshold.rect;
  const r = renderer(fx, { ...hostOf(fx, { threshold: -40 }), events: [D(0, 'p', x + 5, y + 5), U(60, 'p', x + 5, y + 5)] }, { data: tools });
  assert.equal(r.refused[0].code, 'GESTURE_NO_TABLE');
  assert.equal(r.gestures.length, 0);
});

test('the renderer\'s sources keep no timing: nothing beside the declared defaults, and every number is read from the declaration', () => {
  const text = ['view.c', 'input.c', 'cli.c'].map((f) => readFileSync(join(ROOT, 'renderer/src', f), 'utf8')).join('\n');
  const declared = Object.values(GESTURES.timings).map((t) => t.default);
  for (const ms of declared) assert.ok(!new RegExp(`(?<![\\w.])${ms}(?![\\w.])`).test(text.replace(/\/\*[\s\S]*?\*\//g, '')), `${ms} is typed in the renderer`);
  assert.deepEqual(readdirSync(join(ROOT, 'renderer/src')).filter((f) => /gestures/.test(f)), []);
});
