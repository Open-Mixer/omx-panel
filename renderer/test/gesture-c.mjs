// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * What the C gesture reference's tests share: the cases (the shipped scripted fixtures of test/fixtures/gestures/scripts.json,
 * and the rules of docs/panel-gestures.md each as a small control and script), the C driver's answers (build/gesture_driver,
 * renderer/test/gesture_driver.c over omx_gesture_run) and the JavaScript reference's (tools/gestures.mjs `runGesture`) in
 * one shape, so a test can hold the first to the second exactly.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GestureError, runGesture } from '../../dist/tools/gestures.mjs';
import { SCRIPTS, controlOf } from '../../test/gesture-scripts.mjs';

export const RENDERER = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = resolve(RENDERER, '..');
export const DRIVER = join(RENDERER, 'build', 'gesture_driver');
export const DECLARATION = join(ROOT, 'schema', 'gestures.json');

// ---- the cases ---------------------------------------------------------------------------------------------------------------

/** The shipped scripts: each as {name, settings, control, events}, the settings the script file implies (a mouse script keeps painting off). */
export const SHIPPED = SCRIPTS.map((s) => ({ name: `script: ${s.name}`, settings: s.mouse ? { paintWithMouse: false } : {}, control: controlOf(s), events: s.script }));

const D = (t, id, x, y, ptype = 'touch') => ({ t, type: 'down', id, ptype, x, y });
const M = (t, id, x, y, ptype = 'touch', fine) => ({ t, type: 'move', id, ptype, x, y, ...(fine ? { fine: true } : {}) });
const U = (t, id, x, y, ptype = 'touch') => ({ t, type: 'up', id, ptype, x, y });
const TAP = (t, id, x, y, ptype = 'touch') => [D(t, id, x, y, ptype), U(t + 60, id, x, y, ptype)];
const wheel = (t, n, extra = {}) => ({ t, type: 'wheel', n, ...extra });
const detent = (t, n, extra = {}) => ({ t, type: 'detent', n, ...extra });
const key = (t, k, extra = {}) => ({ t, type: 'key', key: k, ...extra });

const knob = (extra = {}) => ({ widget: 'knob', min: 0, max: 100, def: 50, value: 20, travelPx: 200, target: { x: 0, y: 0, w: 40, h: 220 }, ...extra });
const handle = (extra = {}, q = 2) => ({
  widget: 'handle', target: { x: 0, y: 0, w: 60, h: 60 }, plot: { w: 400, h: 200 },
  freq: { min: 20, max: 20000, def: 120, scale: 'log', value: 500 }, gain: { min: -18, max: 18, def: 3, value: 9 }, q: { min: 0.3, max: 16, def: 1, scale: 'log', value: q }, ...extra,
});
const bars = (extra = {}, n = 8) => ({
  widget: 'bar', bars: Array.from({ length: n }, (_x, i) => ({ symbol: `b${i}`, min: -12, max: 12, def: 0, value: 0, target: { x: 20 * i, y: 0, w: 18, h: 200 } })), ...extra,
});

/** The rules of docs/panel-gestures.md and what refuses, one small control and script each: the C reference answers all of them as the JavaScript one does. */
export const RULES = [
  { name: 'rule: a drag starts past 10 px (ten is a tap)', control: knob(), events: [D(0, 'p', 10, 10), M(20, 'p', 10, 0), U(40, 'p', 10, 0)] },
  { name: 'rule: a drag past 10 px moves from where the threshold was crossed', control: knob(), events: [D(0, 'p', 10, 20), M(20, 'p', 10, 9), M(40, 'p', 10, -11), U(60, 'p', 10, -11)] },
  { name: 'rule: fine is 0.3 of the drag', control: knob(), events: [D(0, 'p', 10, 100), M(20, 'p', 10, 80, 'touch', true), M(40, 'p', 10, 40, 'touch', true), U(60, 'p', 10, 40)] },
  { name: 'rule: a drag on a log travel', control: knob({ scale: 'log', min: 20, max: 20000, def: 1000, value: 200 }), events: [D(0, 'p', 10, 100), M(20, 'p', 10, 80), M(40, 'p', 10, 30), U(60, 'p', 10, 30)] },
  { name: 'rule: a horizontal fader drags along x', control: knob({ widget: 'fader', orientation: 'horizontal', target: { x: 0, y: 0, w: 220, h: 40 } }), events: [D(0, 'p', 10, 10), M(20, 'p', 30, 10), M(40, 'p', 90, 10), U(60, 'p', 90, 10)] },
  { name: 'rule: a drag that gives no travel is 200 px', control: knob({ travelPx: undefined }), events: [D(0, 'p', 10, 100), M(20, 'p', 10, 60), M(40, 'p', 10, 20), U(60, 'p', 10, 20)] },
  { name: 'rule: a wheel notch is one declared step; coarse is five', control: knob({ step: 5 }), events: [wheel(0, 2), wheel(100, -1, { coarse: true })] },
  { name: 'rule: a step with no declared step is 1% of the travel', control: knob(), events: [detent(0, 3), detent(50, -1), key(100, 'ArrowUp')] },
  { name: 'rule: steps of one source within the claim are one gesture; another source is owned', control: knob(), events: [wheel(0, 1), wheel(100, 1), detent(200, 1), wheel(900, 1)] },
  { name: 'rule: an integer selector steps by one', control: { widget: 'selector', min: 0, max: 4, def: 0, value: 1, integer: true, target: { x: 0, y: 0, w: 40, h: 40 } }, events: [wheel(0, 1), wheel(400, 1), wheel(800, 9), wheel(1200, -20)] },
  { name: 'rule: a negative integer travel rounds as Math.round does', control: { widget: 'selector', min: -4, max: 4, def: 0, value: -1, integer: true, target: { x: 0, y: 0, w: 40, h: 40 } }, events: [wheel(0, 1), wheel(400, -3), wheel(800, 1)] },
  { name: 'rule: a drag onto a negative half of an integer travel rounds as Math.round does', control: { widget: 'selector', min: -4, max: 4, def: 0, value: -1, integer: true, travelPx: 200, target: { x: 0, y: 0, w: 40, h: 200 } }, events: [D(0, 'p', 10, 50), M(20, 'p', 10, 63), M(40, 'p', 10, 75.5), U(60, 'p', 10, 75.5)] },
  { name: 'rule: reset is the declared default (double-tap, Backspace)', control: knob(), events: [...TAP(0, 'p', 10, 10), ...TAP(100, 'p', 10, 10), key(700, 'Backspace')] },
  { name: 'rule: no default refuses GESTURE_NO_DEFAULT', control: knob({ def: undefined }), events: [...TAP(0, 'p', 10, 10), ...TAP(100, 'p', 10, 10), key(700, 'Backspace')] },
  { name: 'rule: a double-tap past doubleTapMs is two taps', control: knob(), events: [...TAP(0, 'p', 10, 10), ...TAP(500, 'p', 10, 10)] },
  { name: 'rule: a read-only control refuses GESTURE_READ_ONLY', control: knob({ readOnly: true }), events: [D(0, 'p', 10, 10), U(60, 'p', 10, 10), wheel(100, 1), key(200, 'Backspace')] },
  { name: 'rule: a meter takes no gesture', control: knob({ widget: 'meter' }), events: [D(0, 'p', 10, 10), U(60, 'p', 10, 10)] },
  { name: 'rule: a widget the table does not know takes no gesture', control: knob({ widget: 'dial' }), events: [D(0, 'p', 10, 10), U(60, 'p', 10, 10)] },
  { name: 'rule: a second pointer on an owned control is GESTURE_CONTROL_OWNED', control: knob(), events: [D(0, 'a', 10, 10, 'mouse'), D(50, 'b', 12, 12, 'touch'), D(60, 'c', 14, 14, 'touch'), U(100, 'a', 10, 10, 'mouse')] },
  { name: 'rule: a press inside the stepper\'s claim is GESTURE_CONTROL_OWNED', control: knob(), events: [wheel(0, 1), D(100, 'p', 10, 10), U(150, 'p', 10, 10), D(400, 'p', 10, 10), U(450, 'p', 10, 10)] },
  { name: 'rule: a long press is more, and never a value', control: knob(), events: [D(0, 'p', 10, 10), U(600, 'p', 10, 10)] },
  { name: 'rule: a long press shorter than longPressMs is a tap', control: knob(), events: [D(0, 'p', 10, 10), U(400, 'p', 10, 10)] },
  { name: 'rule: a long press with a surface\'s own longer time', control: knob(), settings: { timings: { longPressMs: 900 } }, events: [D(0, 'p', 10, 10), U(600, 'p', 10, 10)] },
  { name: 'rule: a switch toggles on release inside', control: { widget: 'switch', min: 0, max: 1, def: 0, value: 0, target: { x: 0, y: 0, w: 40, h: 40 } }, events: [...TAP(0, 'p', 10, 10), ...TAP(500, 'p', 10, 10)] },
  { name: 'rule: a release outside the target is nothing', control: { widget: 'switch', min: 0, max: 1, def: 0, value: 0, target: { x: 0, y: 0, w: 40, h: 40 } }, events: [D(0, 'p', 10, 10), U(60, 'p', 90, 90)] },
  { name: 'rule: a hold control held short refuses GESTURE_HOLD_SHORT', control: { widget: 'switch', hold: true, min: 0, max: 1, def: 0, value: 0, target: { x: 0, y: 0, w: 40, h: 40 } }, events: [D(0, 'p', 10, 10), U(300, 'p', 10, 10)] },
  { name: 'rule: a hold control held the safety hold acts, and has no long press', control: { widget: 'switch', hold: true, min: 0, max: 1, def: 0, value: 0, target: { x: 0, y: 0, w: 40, h: 40 } }, events: [D(0, 'p', 10, 10), U(900, 'p', 10, 10)] },
  { name: 'rule: a safety hold lengthened by the surface', control: { widget: 'switch', hold: true, min: 0, max: 1, def: 0, value: 0, target: { x: 0, y: 0, w: 40, h: 40 } }, settings: { timings: { safetyHoldMs: 1200 } }, events: [D(0, 'p', 10, 10), U(900, 'p', 10, 10)] },
  { name: 'rule: a safety hold below the declared floor is GESTURE_HOLD_BELOW_FLOOR', control: knob(), settings: { timings: { safetyHoldMs: 400 } }, events: [] },
  { name: 'rule: an unknown timing is GESTURE_BAD_SETTING', control: knob(), settings: { timings: { bogusMs: 400 } }, events: [] },
  { name: 'rule: a time not above zero is GESTURE_BAD_SETTING', control: knob(), settings: { timings: { claimMs: 0 } }, events: [] },
  { name: 'rule: painting off for touch is GESTURE_PAINT_REQUIRED_ON_TOUCH', control: bars(), settings: { paintWithTouch: false }, events: [] },
  { name: 'rule: events out of order run in time order', control: knob(), events: [U(60, 'p', 10, 10), D(0, 'p', 10, 10)] },
  { name: 'rule: a handle drags frequency and gain; fine is 0.3', control: handle(), events: [D(0, 'p', 30, 30), M(10, 'p', 50, 40), M(20, 'p', 90, 10), U(30, 'p', 90, 10), D(500, 'p', 30, 30), M(510, 'p', 50, 40, 'touch', true), U(520, 'p', 50, 40)] },
  { name: 'rule: a handle\'s reset is its gain, frequency and Q keep', control: handle(), events: [...TAP(0, 'p', 30, 30), ...TAP(100, 'p', 30, 30)] },
  { name: 'rule: a handle\'s arrows step the gain and the frequency; Shift is the second', control: handle(), events: [key(0, 'ArrowUp'), key(400, 'ArrowRight'), key(800, 'ArrowDown', { shift: true }), key(1200, 'ArrowLeft', { shift: true }), key(1600, 'Backspace')] },
  { name: 'rule: a handle takes the wheel and encoder 3 as its Q', control: handle(), events: [wheel(0, 2), detent(400, -1, { encoder: 3 }), detent(800, 1, { encoder: 3 })] },
  { name: 'rule: a pinch of two touches that began within the palm guard scales Q', control: handle(), events: [D(0, 'a', 20, 30), D(100, 'b', 40, 30), M(150, 'b', 50, 30), M(200, 'b', 70, 30), U(300, 'b', 70, 30), U(350, 'a', 20, 30)] },
  { name: 'rule: a pinch whose second finger came after the palm guard is refused', control: handle(), events: [D(0, 'a', 20, 30), D(400, 'b', 40, 30)] },
  { name: 'rule: a pinch of two pointers of different types is refused', control: handle(), events: [D(0, 'a', 20, 30, 'touch'), D(100, 'b', 40, 30, 'mouse')] },
  { name: 'rule: a tap on a handle selects it', control: handle(), events: TAP(0, 'p', 30, 30) },
  { name: 'rule: a bar sweep paints, one gesture id, columns jumped over are interpolated', control: bars(), events: [D(0, 'p', 9, 100), M(10, 'p', 30, 60), M(20, 'p', 130, 160), M(30, 'p', 70, 20), U(40, 'p', 70, 20)] },
  { name: 'rule: a sweep to the left paints the columns it enters', control: bars(), events: [D(0, 'p', 150, 100), M(10, 'p', 90, 50), M(20, 'p', 10, 150), U(30, 'p', 10, 150)] },
  { name: 'rule: a mouse sweep paints nothing unless it is asked to', control: bars(), settings: { paintWithMouse: false }, events: [D(0, 'p', 9, 100, 'mouse'), M(10, 'p', 30, 60, 'mouse'), M(20, 'p', 70, 20, 'mouse'), U(30, 'p', 70, 20, 'mouse')] },
  { name: 'rule: a mouse sweep paints when it is asked to', control: bars(), settings: { paintWithMouse: true }, events: [D(0, 'p', 9, 100, 'mouse'), M(10, 'p', 30, 60, 'mouse'), M(20, 'p', 70, 20, 'mouse'), U(30, 'p', 70, 20, 'mouse')] },
  { name: 'rule: a drag inside the pressed bar\'s column stays a drag of that bar', control: bars(), events: [D(0, 'p', 15, 150), M(10, 'p', 15, 100), M(20, 'p', 15, 50), U(30, 'p', 15, 50)] },
  { name: 'rule: a bar tap selects it and a key then steps it', control: bars(), events: [...TAP(0, 'p', 79, 100), key(500, 'ArrowUp'), key(900, 'ArrowUp', { shift: true })] },
  { name: 'rule: a key with no bar selected has no target', control: bars(), events: [key(0, 'ArrowUp'), wheel(400, 1)] },
  { name: 'rule: a wheel names its bar', control: bars(), events: [wheel(0, 3, { bar: 'b3' }), wheel(400, -1, { bar: 'b5', coarse: true })] },
  { name: 'rule: a bar group\'s selected bar resets by Backspace', control: bars({ selected: 'b2', bars: bars().bars.map((b, i) => ({ ...b, value: i })) }), events: [key(0, 'Backspace'), key(100, 'Backspace', { bar: 'b4' })] },
  { name: 'rule: a bar double-tap resets only that bar', control: bars({ bars: bars().bars.map((b, i) => ({ ...b, value: i })) }), events: [...TAP(0, 'p', 79, 100), ...TAP(100, 'p', 79, 100)] },
  { name: 'rule: a bar that declares no default has nothing to reset', control: bars({ bars: bars().bars.map((b) => ({ ...b, def: undefined })) }), events: [...TAP(0, 'p', 79, 100), ...TAP(100, 'p', 79, 100)] },
  { name: 'rule: an xy has no wheel', control: knob({ widget: 'xy' }), events: [wheel(0, 1), key(100, 'ArrowUp')] },
  { name: 'rule: an unknown key is no step', control: knob(), events: [key(0, 'Enter')] },
];

export const CASES = [...SHIPPED, ...RULES];

// ---- the two references ----------------------------------------------------------------------------------------------------

/** The JavaScript reference's answer in the C answer's shape: the bookkeeping a gesture carries inside the module (`closed`, `dead`) is not part of the answer; a throw is `{error}`. */
export function viaJs(c) {
  try {
    const r = runGesture(structuredClone(c.control), structuredClone(c.events), structuredClone(c.settings ?? {}));
    const gesture = (g) => (g ? (({ closed: _c, dead: _d, ...rest }) => rest)(g) : null);
    return structuredClone({ value: r.value, gestures: r.gestures.map(gesture), gesture: gesture(r.gesture), begin: r.begin, end: r.end, undo: r.undo, selected: r.selected, refused: r.refused, cancelled: r.cancelled });
  } catch (e) {
    if (!(e instanceof GestureError)) throw e;
    return { error: { code: e.code, why: e.message.slice(e.code.length + 2) } };
  }
}

/** The C reference's answers to `cases`, through `driver` (build/gesture_driver, or one built from a mutated gesture.c). */
export function viaC(cases, driver = DRIVER) {
  const dir = mkdtempSync(join(tmpdir(), 'gesture-c-'));
  try {
    const file = join(dir, 'cases.json');
    writeFileSync(file, JSON.stringify(cases.map((c) => ({ settings: JSON.stringify(c.settings ?? {}), control: JSON.stringify(c.control), events: JSON.stringify(c.events) }))));
    return JSON.parse(execFileSync(driver, [DECLARATION, file], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- a seeded differential fuzz ---------------------------------------------------------------------------------------------

/**
 * `n` random controls (every widget, log and integer and stepped travels, read-only and hold) with random scripts (every event
 * type, two pointers of any type, gaps either side of every declared timing), from a linear congruential generator seeded with
 * `seed`: the same cases on every run.
 */
export function fuzzCases(seed, n) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const R = (a, b) => a + rnd() * (b - a);
  const member = (fixed) => {
    const log = fixed ? fixed.scale === 'log' : rnd() < 0.3, integer = !fixed && !log && rnd() < 0.25;
    const min = fixed ? fixed.min : log ? R(0.5, 50) : R(-30, 5), max = fixed ? fixed.max : min + (log ? R(10, 5000) : R(5, 100));
    const m = { min: integer ? Math.round(min) : min, max: integer ? Math.round(max) : max, scale: log ? 'log' : 'linear', integer };
    if (rnd() < 0.7) m.def = m.min + rnd() * (m.max - m.min);
    if (rnd() < 0.3 && !log) m.step = R(0.1, 5);
    if (rnd() < 0.7) m.value = m.min + rnd() * (m.max - m.min);
    return m;
  };
  const control = () => {
    const widget = pick(['knob', 'fader', 'selector', 'switch', 'xy', 'handle', 'bar', 'bar', 'meter']);
    const flags = { ...(rnd() < 0.1 ? { readOnly: true } : {}), ...(rnd() < 0.15 ? { hold: true } : {}) };
    if (widget === 'handle') {
      return { widget, ...flags, target: { x: 0, y: 0, w: 60, h: 60 }, plot: { w: R(100, 500), h: R(100, 300) },
        freq: member({ scale: 'log', min: 20, max: 20000 }), gain: member({ scale: 'linear', min: -18, max: 18 }), q: member({ scale: 'log', min: 0.3, max: 16 }) };
    }
    if (widget === 'bar') {
      const bars = Array.from({ length: 2 + Math.floor(rnd() * 6) }, (_x, i) => ({ ...member(), symbol: `b${i}`, target: { x: 22 * i, y: 0, w: 20, h: 150 } }));
      return { widget, ...flags, ...(rnd() < 0.3 ? { selected: pick(bars).symbol } : {}), bars };
    }
    return { widget, ...flags, ...member(), ...(rnd() < 0.5 ? { travelPx: R(50, 300) } : {}), ...(widget === 'fader' && rnd() < 0.3 ? { orientation: 'horizontal' } : {}), target: { x: 0, y: 0, w: 40, h: 200 } };
  };
  const events = (c) => {
    let t = 0;
    const width = c.widget === 'bar' ? 22 * c.bars.length : 60, barOf = () => (c.widget === 'bar' && rnd() < 0.5 ? { bar: pick(c.bars).symbol } : {});
    return Array.from({ length: 1 + Math.floor(rnd() * 10) }, () => {
      t += pick([0, 5, 20, 60, 120, 250, 310, 520, 900]);
      const type = pick(['down', 'move', 'move', 'up', 'wheel', 'detent', 'key']);
      if (type === 'down' || type === 'move' || type === 'up') return { t, type, id: pick(['a', 'b']), ptype: pick(['touch', 'touch', 'mouse', 'pen', 'fader']), x: R(-5, width + 5), y: R(-5, 155), ...(rnd() < 0.2 ? { fine: true } : {}) };
      if (type === 'key') return { t, type, key: pick(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace']), ...(rnd() < 0.3 ? { shift: true } : {}), ...barOf() };
      return { t, type, n: pick([-3, -1, 1, 2, 5]), ...(rnd() < 0.3 ? { coarse: true } : {}), ...(type === 'detent' && rnd() < 0.3 ? { encoder: 3 } : {}), ...barOf() };
    });
  };
  return Array.from({ length: n }, (_x, i) => {
    const c = control();
    return { name: `fuzz ${seed}/${i}`, control: c, events: events(c), settings: rnd() < 0.2 ? { paintWithMouse: rnd() < 0.5 } : {} };
  });
}

/**
 * Whether two answers agree: every number equal, except where the control has a logarithmic travel, where two C libraries' `log` and
 * `exp` (V8's and the platform's) may differ in the last digits, so a relative 1e-11 is allowed; and the words of the one refusal the
 * reference words badly (a reset with no bar selected: 'null declares no default') are the same refusal in both.
 */
export function agree(a, b, tolerant) {
  if (typeof a === 'number' && typeof b === 'number') return a === b || (tolerant && Math.abs(a - b) <= 1e-11 * Math.max(Math.abs(a), Math.abs(b)));
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys({ ...a, ...b });
    return Array.isArray(a) === Array.isArray(b) && keys.every((k) => agree(a[k], b[k], tolerant));
  }
  return Object.is(a, b);
}
