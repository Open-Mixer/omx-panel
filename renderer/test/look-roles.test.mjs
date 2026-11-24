// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The renderer and the colour roles (the one-panel spec §7.10): read_look takes the resolved roles its host passes, the
 * whole role list of schema/look-roles.json (renderer/src/look_roles.h); a look short of any role, drawn here or not, is
 * refused by the role's name; and each role the renderer draws, moved to a colour of its own, moves the pixels. A knob's
 * pointer is drawn in --knob-pointer and a curve's stroke in --curve-stroke, neither in --accent: each is given a colour
 * that is not the accent's and its pixels are read (docs/modgui.md "The look").
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLI, DATA, FIXTURES, ROOT, compare, decodePng, descriptionFile, rects, render, resolved, scratch, stateFile } from './harness.mjs';

const LOOK = JSON.parse(readFileSync(join(DATA, 'look.json'), 'utf8'));
const ROLES = JSON.parse(readFileSync(join(ROOT, 'schema/look-roles.json'), 'utf8')).roles.map((r) => r.name);

/** A data directory as tools/ is, its look.json's tokens `tokens`. */
function dataWith(tokens) {
  const dir = scratch();
  mkdirSync(join(dir, 'look'), { recursive: true });
  mkdirSync(join(dir, 'fonts'), { recursive: true });
  copyFileSync(join(DATA, 'look/geometry.json'), join(dir, 'look/geometry.json'));
  copyFileSync(join(DATA, LOOK.tokens['--font-file']), join(dir, LOOK.tokens['--font-file']));
  copyFileSync(join(ROOT, 'schema/gestures.json'), join(dir, 'gestures.json'));
  writeFileSync(join(dir, 'look.json'), JSON.stringify({ ...LOOK, tokens }));
  return dir;
}

/** The roles view.c's read_look maps onto what it draws. */
const DRAWN = [...readFileSync(join(ROOT, 'renderer/src/view.c'), 'utf8').matchAll(/\{\s*"(--[a-z0-9-]+)"\s*,\s*&v->col/g)].map((m) => m[1]);

/** omx-delay (the face, its sections, a switch), dyn-curve (a curve's frame, rim and body, points or none) and dyn-curve as an
 * eq_response with a spectrum (the meter gradient and the clip tick: the console analyser's parity bands). */
const PANELS = ['omx-delay', 'dyn-curve'].map((name) => {
  const fx = FIXTURES.find((f) => f.name === name), dir = scratch();
  return { name, description: descriptionFile(fx, dir), state: stateFile(fx, dir) };
});
{
  const fx = FIXTURES.find((f) => f.name === 'dyn-curve'), dir = scratch();
  const ref = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/rta/console-scene.json'), 'utf8')), b = ref.input.bands;
  const d = JSON.parse(readFileSync(descriptionFile(fx, dir), 'utf8'));
  d.displays[0].kind = 'eq_response', d.displays[0].axis = 'log-frequency';
  const st = JSON.parse(readFileSync(stateFile(fx, dir), 'utf8'));
  st.curves = { 0: { x: ref.input.curve.map((p) => p.hz), y: ref.input.curve.map((p) => p.gain) } }, st.marks = {};
  st.spectrum = { 0: { hz: b.map((x) => x.hz), db: b.map((x) => x.db), peak: b.map((x) => x.peakDb), dbMin: ref.window.dbMin,
    dbMax: ref.window.dbMax, gridDb: ref.window.gridDb } };
  writeFileSync(join(dir, 'eq-spectrum.layout.json'), JSON.stringify(d)), writeFileSync(join(dir, 'eq-spectrum.state.json'), JSON.stringify(st));
  PANELS.push({ name: 'eq-spectrum', description: join(dir, 'eq-spectrum.layout.json'), state: join(dir, 'eq-spectrum.state.json') });
}

test('a look short of a role, one the renderer draws (the knob pointer, the curve stroke) or not, is refused, naming the role', () => {
  const p = PANELS[0];
  for (const missing of ['--knob-pointer', '--curve-stroke', '--origin-room-mode', '--eq-delta-cut']) {
    const tokens = { ...LOOK.tokens };
    delete tokens[missing];
    const r = spawnSync(CLI, ['--description', p.description, '--data', dataWith(tokens), '--state', p.state, '--raw', join(scratch(), 'x.raw')], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, `a look without ${missing} was drawn`);
    assert.match(r.stderr, new RegExp(`the role ${missing} is not a #rrggbb colour`));
  }
});

test('positive control: the whole look draws, the same as the tools directory\'s', () => {
  const p = PANELS[0];
  assert.ok(compare(render(p.description, p.state, { data: dataWith(LOOK.tokens) }), render(p.description, p.state)).exact);
});

test('a fixture per role: each role the renderer draws, moved to a colour of its own, moves the pixels', () => {
  assert.ok(DRAWN.length >= 7 && DRAWN.every((n) => ROLES.includes(n)), DRAWN.join(' '));
  const was = PANELS.map((p) => render(p.description, p.state));
  for (const n of DRAWN) {
    const data = dataWith({ ...LOOK.tokens, [n]: '#010203' });
    const moved = PANELS.map((p, i) => compare(render(p.description, p.state, { data }), was[i]).off);
    assert.ok(moved.some((off) => off > 0), `${n} moved no pixel of ${PANELS.map((p) => p.name).join(' or ')}`);
  }
});


/* ------------------------------------------------------------------------- the knob pointer and the curve stroke */

const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Two colours no role of the look has, far from the accent and from each other. */
const POINTER = '#ff00ff', CURVE = '#00ff00';
const BODY = rgbOf(LOOK.tokens['--surface-3']), ACCENT = rgbOf(LOOK.tokens['--accent']);
/** The tools directory with the pointer and the curve stroke in colours of their own, the accent as the look has it. */
const apart = () => dataWith({ ...LOOK.tokens, '--knob-pointer': POINTER, '--curve-stroke': CURVE });

/** How many pixels of `img` inside the box [x, y, w, h] are `colour` painted over the body (--surface-3, what a knob and a
 * curve's frame are filled with): along the body-to-colour line by at least 0.6 and off it by less than 25, so a stroke's
 * blended edge counts and text, a rim and another role's paint do not. */
function painted(img, [x, y, w, h], colour) {
  const to = rgbOf(colour).map((c, k) => c - BODY[k]), dd = to.reduce((s, v) => s + v * v, 0);
  let n = 0;
  for (let yy = Math.round(y); yy < Math.round(y + h); yy++) for (let xx = Math.round(x); xx < Math.round(x + w); xx++) {
    const i = (yy * img.w + xx) * 4, p = [0, 1, 2].map((k) => img.data[i + k] - BODY[k]);
    const t = p.reduce((s, v, k) => s + v * to[k], 0) / dd;
    if (t > 0.6 && Math.hypot(...p.map((v, k) => v - t * to[k])) < 25) n++;
  }
  return n;
}
const hexOf = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
const ACCENT_HEX = hexOf(ACCENT);

const g = JSON.parse(readFileSync(join(DATA, 'look/geometry.json'), 'utf8')).geometry;
/** The first section's curve frame at scale 1, its inner area (the 5 px inset, the caption's 12 px left out): omx-delay's and
 * dyn-curve's sections are five cells wide. */
const PLOT = [g.pad + g.sectionPad + 5, g.sectionTop + g.sectionTitleH + 5, 5 * g.cellW - 10, g.curveH - 10 - 12];

test('the colours of this proof are no role\'s, and the accent is neither', () => {
  assert.ok(!Object.values(LOOK.tokens).includes(POINTER) && !Object.values(LOOK.tokens).includes(CURVE));
  assert.notEqual(ACCENT_HEX, POINTER);
  assert.notEqual(ACCENT_HEX, CURVE);
});

test('a knob\'s pointer is drawn in --knob-pointer, and nothing of a knob in --accent', () => {
  const p = PANELS.find((x) => x.name === 'dyn-curve');
  const knobs = JSON.parse(readFileSync(p.description, 'utf8')).controls.map((c, i) => [c, i]).filter(([c]) => c.widget === 'knob');
  const cells = rects(p.description, { scale: 2 });
  assert.ok(knobs.length >= 3, `${knobs.length} knobs`);
  const img = render(p.description, p.state, { scale: 2, data: apart() });
  for (const [c, i] of knobs) {
    // the knob itself: the cell's top, above the scribble strip that carries the value (its text is the accent's)
    const [cx, cy, cw] = cells[i], knob = [cx, cy, cw, (g.knobTop + g.knob) * 2];
    const inPointer = painted(img, knob, POINTER), inAccent = painted(img, knob, ACCENT_HEX);
    assert.ok(inPointer >= 20, `the knob ${c.symbol}: ${inPointer} pixels in --knob-pointer ${POINTER}, ${inAccent} in --accent ${ACCENT_HEX}`);
    assert.equal(inAccent, 0, `the knob ${c.symbol}: ${inAccent} pixels in --accent ${ACCENT_HEX}`);
  }
});

test('a transfer curve\'s stroke is drawn in --curve-stroke, and nothing of the curve in --accent', () => {
  const p = PANELS.find((x) => x.name === 'dyn-curve');
  assert.ok(Object.keys(JSON.parse(readFileSync(p.state, 'utf8')).curves).length > 0, 'the state carries the curve\'s points');
  const img = render(p.description, p.state, { data: apart() });
  const inCurve = painted(img, PLOT, CURVE), inAccent = painted(img, PLOT, ACCENT_HEX);
  assert.ok(inCurve >= 100, `${inCurve} pixels in --curve-stroke ${CURVE}, ${inAccent} in --accent ${ACCENT_HEX}`);
  assert.equal(inAccent, 0, `${inAccent} pixels of the curve in --accent ${ACCENT_HEX}`);
});

test('an eq response over a spectrum is stroked in --curve-stroke; the spectrum\'s own trace stays --accent', () => {
  const p = PANELS.find((x) => x.name === 'eq-spectrum');
  const img = render(p.description, p.state, { data: apart() });
  const inCurve = painted(img, PLOT, CURVE), inAccent = painted(img, PLOT, ACCENT_HEX);
  assert.ok(inCurve >= 100, `${inCurve} pixels in --curve-stroke ${CURVE}`);
  assert.ok(inAccent >= 100, `${inAccent} pixels of the trace in --accent ${ACCENT_HEX}`);
});

test('a time response\'s envelope is stroked in --curve-stroke; its stems stay --accent', () => {
  const p = PANELS.find((x) => x.name === 'omx-delay');
  const state = JSON.parse(readFileSync(p.state, 'utf8')), dir = scratch();
  const file = (name, extra) => (writeFileSync(join(dir, name), JSON.stringify({ ...state, marks: {}, ...extra })), join(dir, name));
  const envelope = { 0: { x: [0, 100, 200, 300], y: [0, -20, -40, -58] } };
  const alone = render(p.description, file('envelope.json', { curves: envelope, stems: {} }), { data: apart() });
  assert.ok(painted(alone, PLOT, CURVE) >= 100, `${painted(alone, PLOT, CURVE)} pixels in --curve-stroke ${CURVE}`);
  assert.equal(painted(alone, PLOT, ACCENT_HEX), 0, 'no pixel of the envelope in --accent');
  const stems = { 0: [{ x: 0, y: -6, shade: 1, letter: ' ' }, { x: 150, y: -12, shade: 1, letter: ' ' }, { x: 300, y: -30, shade: 1, letter: ' ' }] };
  const stemmed = render(p.description, file('stems.json', { curves: {}, stems }), { data: apart() });
  assert.ok(painted(stemmed, PLOT, ACCENT_HEX) >= 20, 'the stems are the accent\'s');
  assert.equal(painted(stemmed, PLOT, CURVE), 0, 'no stem in --curve-stroke');
});

// The MOD GUI's raster draws the same face: with the pointer and the stroke in colours of their own it is still the
// renderer's picture to the bit, so neither rasteriser draws either in --accent.
const { renderFace, layout, loadLook } = await import(join(ROOT, 'dist', 'tools', 'modgui-gen.mjs'));
test('the MOD GUI face is the renderer\'s at a look whose pointer and curve stroke are not the accent\'s', () => {
  const fx = FIXTURES.find((f) => f.name === 'dyn-curve'), p = PANELS.find((x) => x.name === 'dyn-curve');
  const r = resolved(fx), base = loadLook('console');
  const look = { ...base, tokens: { ...base.tokens, '--knob-pointer': POINTER, '--curve-stroke': CURVE } };
  const face = decodePng(renderFace({ ...layout(r), brand: r.brand, name: r.name ?? r.stem }, look, 1));
  assert.ok(painted(face, PLOT, CURVE) >= 100, `the MOD GUI face: ${painted(face, PLOT, CURVE)} pixels in --curve-stroke ${CURVE}`);
  const d = compare(render(p.description, p.state, { data: apart() }), face);
  assert.ok(d.exact, `${d.off} pixels apart`);
});
