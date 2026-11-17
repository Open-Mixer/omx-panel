// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The C gesture reference (renderer/src/gesture.c, include/omx_panel_gesture.h: omx_gesture_open, omx_gesture_run,
 * omx_gesture_close) against the shipped scripted fixtures (test/fixtures/gestures/scripts.json, exported by the package as
 * ./gestures/scripts.json) and against the JavaScript reference (tools/gestures.mjs), which stays the JS until the wasm loader
 * replaces it. Each case is run through both and the answers must be EQUAL: the value, every gesture (id, word, input, begin,
 * end, changes, fine, the shown record), the undo ids, what was selected, every refusal with its code, time and words, every
 * cancellation. The shipped scripts' own hand-worked expectations (word, selected, counts, value within a declared step or
 * exact) are held on the C answers too, so equality with the JS is not the only anchor. renderer/test/gesture-c-sabotage.test.mjs
 * breaks the C unit and watches this go red.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCRIPTS } from '../../test/gesture-scripts.mjs';
import { readFileSync } from 'node:fs';
import { GESTURES, GESTURE_CODES } from '../../dist/tools/gestures.mjs';
import { CASES, RULES, SHIPPED, agree, fuzzCases, viaC, viaJs } from './gesture-c.mjs';

const viaJsControl = () => RULES.find((r) => r.name.startsWith('rule: a pinch of two touches')).control;

const ANSWERS = viaC(CASES);

test('the driver answers every case, one answer each', () => {
  assert.equal(ANSWERS.length, CASES.length);
  assert.ok(ANSWERS.every((a) => a && typeof a === 'object'));
});

test('the shipped scripts are all run: twenty, the handle, the fader, both bar groups', () => {
  assert.equal(SHIPPED.length, SCRIPTS.length);
  assert.equal(SHIPPED.length, 20);
  const widgets = new Set(SHIPPED.map((c) => c.control.widget));
  for (const w of ['handle', 'fader', 'bar']) assert.ok(widgets.has(w), w);
});

CASES.forEach((c, i) => {
  test(`C equals the JS reference: ${c.name}`, () => {
    assert.deepStrictEqual(ANSWERS[i], viaJs(c));
  });
});

// ---- the rules at random: 3 x 1500 controls and scripts, the answers held to the JS reference's -----------------------------------

for (const seed of [1, 2, 3]) {
  test(`C equals the JS reference over 1500 random controls and scripts (seed ${seed})`, () => {
    const cases = fuzzCases(seed, 1500), answers = viaC(cases);
    const bad = cases.flatMap((c, i) => (agree(answers[i], viaJs(c), JSON.stringify(c.control).includes('"log"')) ? [] : [i]));
    assert.deepEqual(bad, [], `cases that differ: ${bad.slice(0, 5).map((i) => JSON.stringify(cases[i]).slice(0, 300)).join('\n')}`);
    assert.ok(answers.filter((a) => a.gestures?.length).length > 300, 'the random scripts do gesture');
  });
}

// the shipped scripts' hand-worked expectations, held on the C answers (one step of the member's own travel, exact for a reset or a tap)
const memberOf = (control, key) => (control.widget === 'handle' ? control[key] : control.widget === 'bar' ? control.bars.find((b) => b.symbol === key) : control);
const stepFraction = (m) => (m.integer ? 1 / (m.max - m.min) : m.step && m.scale !== 'log' ? m.step / (m.max - m.min) : 0.01);
const place = (m, v) => (m.scale === 'log' ? Math.log(v / m.min) / Math.log(m.max / m.min) : (v - m.min) / (m.max - m.min));

SCRIPTS.forEach((s, i) => {
  test(`C meets the shipped expectation: ${s.name}`, () => {
    const a = ANSWERS[i], control = SHIPPED[i].control;
    const want = typeof s.expect.value === 'object' ? s.expect.value : { value: s.expect.value };
    const got = typeof a.value === 'object' ? a.value : { value: a.value };
    for (const [key, w] of Object.entries(want)) {
      const m = memberOf(control, key);
      if (s.expect.tolerance === 'exact') assert.equal(got[key], w, `${key} exact`);
      else assert.ok(Math.abs(place(m, got[key]) - place(m, w)) <= stepFraction(m) + 1e-9, `${key}: ${got[key]} is within one declared step of ${w}`);
    }
    if (s.expect.word) assert.equal(a.gesture.word, s.expect.word);
    if (s.expect.selected !== undefined) assert.equal(a.selected, s.expect.selected);
    if (s.expect.gestures !== undefined) assert.equal(a.gestures.length, s.expect.gestures, 'gestures');
    if (s.expect.undo !== undefined) assert.equal(a.undo.length, s.expect.undo, 'undo entries');
    if (s.expect.changed) assert.deepEqual(Object.keys(a.gestures.at(-1).changes), s.expect.changed);
    assert.deepEqual(a.refused, [], 'nothing refused');
  });
});

// ---- what the rules answer, said outright, so a matching bug in both references would still be caught -----------------------------

const rule = (name) => ANSWERS[SHIPPED.length + RULES.findIndex((r) => r.name === `rule: ${name}`)];

test('rule answers: refusals carry their codes', () => {
  assert.deepEqual(rule('a read-only control refuses GESTURE_READ_ONLY').refused.map((r) => r.code), ['GESTURE_READ_ONLY', 'GESTURE_READ_ONLY', 'GESTURE_READ_ONLY']);
  assert.deepEqual(rule('a second pointer on an owned control is GESTURE_CONTROL_OWNED').refused.map((r) => r.code), ['GESTURE_CONTROL_OWNED', 'GESTURE_CONTROL_OWNED']);
  assert.ok(rule('no default refuses GESTURE_NO_DEFAULT').refused.some((r) => r.code === 'GESTURE_NO_DEFAULT'));
  assert.equal(rule('a hold control held short refuses GESTURE_HOLD_SHORT').refused[0].code, 'GESTURE_HOLD_SHORT');
  assert.equal(rule('a safety hold below the declared floor is GESTURE_HOLD_BELOW_FLOOR').error.code, 'GESTURE_HOLD_BELOW_FLOOR');
  assert.equal(rule('painting off for touch is GESTURE_PAINT_REQUIRED_ON_TOUCH').error.code, 'GESTURE_PAINT_REQUIRED_ON_TOUCH');
});

test('rule answers: ten px is a tap and eleven a drag; fine is 0.3; a tap changes nothing', () => {
  assert.equal(rule('a drag starts past 10 px (ten is a tap)').gesture.word, 'select');
  assert.equal(rule('a drag starts past 10 px (ten is a tap)').value, 20);
  // 11 px crosses the threshold and is dead; the 20 px after it are a tenth of the 200 px travel: 20 + 10
  assert.ok(Math.abs(rule('a drag past 10 px moves from where the threshold was crossed').value - 30) < 1e-9);
  // fine: the first move (20 px) crosses the threshold and is dead; the 40 px after it at 0.3 are 12 px of 200: 6% of 100, on 20
  const fine = rule('fine is 0.3 of the drag');
  assert.equal(fine.gesture.word, 'fine');
  assert.ok(Math.abs(fine.value - 26) < 1e-9, `${fine.value}`);
});

test('rule answers: a sweep is one gesture id and one undo entry across the bars it entered', () => {
  const a = rule('a bar sweep paints, one gesture id, columns jumped over are interpolated');
  assert.equal(a.gestures.length, 1);
  assert.equal(a.undo.length, 1);
  assert.equal(a.gesture.word, 'paint');
  assert.ok(Object.keys(a.gesture.changes).length >= 5, 'it painted the bars it crossed');
});

test('rule answers: more and select never change a value', () => {
  const more = rule('a long press is more, and never a value');
  assert.equal(more.gestures[0].word, 'more');
  assert.deepEqual(more.undo, []);
  assert.equal(more.value, 20);
});

test('finding: the JS reference throws on a move of the finger left of a pinch after the other lifted; the C unit ignores it', () => {
  const handle = viaJsControl();
  const events = [
    { t: 0, type: 'down', id: 'a', ptype: 'touch', x: 20, y: 30 }, { t: 100, type: 'down', id: 'b', ptype: 'touch', x: 40, y: 30 },
    { t: 150, type: 'up', id: 'b', ptype: 'touch', x: 40, y: 30 }, { t: 200, type: 'move', id: 'a', ptype: 'touch', x: 25, y: 30 },
  ];
  assert.throws(() => viaJs({ control: handle, events }), TypeError);
  const [a] = viaC([{ control: handle, events }]);
  assert.equal(a.error, undefined);
  assert.equal(a.gestures.length, 1);
  assert.equal(a.gesture.word, 'second');
});

test('a bad control or script is answered as an error, never a crash', () => {
  const [bars, noTarget, notArray] = viaC([
    { control: { widget: 'bar', bars: [] }, events: [] },
    { control: { widget: 'knob', min: 0, max: 1 }, events: [] },
    { control: { widget: 'knob', min: 0, max: 1, target: { x: 0, y: 0, w: 1, h: 1 } }, events: { t: 0 } },
  ]);
  for (const a of [bars, noTarget, notArray]) assert.equal(a.error.code, 'GESTURE_BAD_INPUT');
});

test('a reset with no bar selected is worded as the JS reference words it', () => {
  const none = { control: { widget: 'bar', bars: [{ symbol: 'b0', min: 0, max: 1, def: 0, target: { x: 0, y: 0, w: 10, h: 10 } }] }, events: [{ t: 0, type: 'key', key: 'Backspace' }] };
  const [c] = viaC([none]);
  assert.equal(c.refused[0].why, 'null declares no default');
  assert.equal(c.refused[0].why, viaJs(none).refused[0].why);
});

test('every refusal code, the JS reference\'s and the C unit\'s, is declared in schema/gestures.json with its sentence, and named in docs/panel-gestures.md', () => {
  const md = readFileSync(new URL('../../docs/panel-gestures.md', import.meta.url), 'utf8');
  const codes = new Set([...Object.values(GESTURE_CODES), 'GESTURE_BAD_INPUT']);
  for (const code of codes) {
    assert.equal(typeof GESTURES.codes?.[code], 'string', `${code} is declared with a sentence`);
    assert.ok(md.includes(`\`${code}\``), `${code} is in docs/panel-gestures.md`);
  }
  assert.deepEqual(Object.keys(GESTURES.codes).sort(), [...codes].sort());
  const [bad] = viaC([{ control: { widget: 'bar', bars: [] }, events: [] }]);
  assert.ok(codes.has(bad.error.code));
});
