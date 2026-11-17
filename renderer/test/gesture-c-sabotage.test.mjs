// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas
/*
 * Sabotage rows for the C gesture reference: each arm breaks one rule of docs/panel-gestures.md in a copy of src/gesture.c,
 * builds a driver from the copy and runs the same cases as gesture-c.test.mjs (the shipped scripts, the rules, the seeded fuzz);
 * the arm holds when at least one case then disagrees with the JavaScript reference (or with the shipped expectation). An
 * unverified guard is decoration. Each arm first proves its injection landed: the text it replaces is in the source exactly once.
 * The untouched source is the first test: green, so a red arm is the arm's doing.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SCRIPTS } from '../../test/gesture-scripts.mjs';
import { CASES, DRIVER, RENDERER, agree, fuzzCases, viaC, viaJs } from './gesture-c.mjs';
import { tapWithNoTapCell, wheelForHiddenControl } from './gesture-c-doors.mjs';

const SOURCE = readFileSync(join(RENDERER, 'src', 'gesture.c'), 'utf8');
const CASES_ALL = [...CASES, ...fuzzCases(7, 600)];
const REFERENCE = CASES_ALL.map((c) => viaJs(c));
const tolerant = (c) => JSON.stringify(c.control).includes('"log"');
const differing = (answers) => CASES_ALL.flatMap((c, i) => (agree(answers[i], REFERENCE[i], tolerant(c)) ? [] : [c.name]));

/** A driver built from `source` (gesture.c with one change), in a scratch directory, run over every case: the names of the cases that differ from the JS reference. */
function sabotaged(source) {
  const dir = mkdtempSync(join(tmpdir(), 'gesture-sabotage-'));
  try {
    writeFileSync(join(dir, 'gesture.c'), source);
    const flags = execFileSync('pkg-config', ['--cflags', '--libs', 'libcjson'], { encoding: 'utf8' }).trim().split(/\s+/);
    execFileSync('cc', ['-std=c11', '-D_DEFAULT_SOURCE', '-ffp-contract=off', '-O1', '-Wall', '-Wno-unused-function', `-I${join(RENDERER, 'include')}`, `-I${join(RENDERER, 'src')}`,
      '-o', join(dir, 'driver'), join(dir, 'gesture.c'), join(RENDERER, 'test', 'gesture_driver.c'), ...flags, '-lm'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      return differing(viaC(CASES_ALL, join(dir, 'driver')));
    } catch {
      return ['the driver crashed']; // a broken rule that takes the unit down is red too
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the untouched gesture.c agrees with the JS reference on every case the arms run', () => {
  assert.deepEqual(differing(viaC(CASES_ALL, DRIVER)), []);
  assert.equal(SCRIPTS.length, 20);
});

/** [what the arm breaks, the text it replaces (once in gesture.c), what it puts there] */
const ARMS = [
  ['the fine ratio is not 0.3', 'double ratio = ev->fine ? d->fine_ratio : 1;', 'double ratio = ev->fine ? 0.5 : 1;'],
  ['the drag threshold is not 10 px', 'if (hypot(ev->x - p->x0, ev->y - p->y0) <= d->drag_start_px) return;', 'if (hypot(ev->x - p->x0, ev->y - p->y0) <= 0) return;'],
  ['dead travel: the value moves from the press, not from where the threshold was crossed', 'p->px = ev->x, p->py = ev->y;\n  }\n  gest *g', 'p->px = p->x0, p->py = p->y0;\n  }\n  gest *g'],
  ['a coarse step is one step, not five', '(input == IN_WHEEL_COARSE || input == IN_DETENT_COARSE || input == IN_ARROW_COARSE ? d->coarse_steps : 1)', '(input == IN_WHEEL_COARSE || input == IN_DETENT_COARSE || input == IN_ARROW_COARSE ? 1 : 1)'],
  ['a step with no declared step is not 1% of the travel', 'return d->step_fraction;', 'return d->step_fraction * 2;'],
  ['a declared step is ignored', 'if (m->step > 0 && !m->log) return m->step / (m->max - m->min);', 'if (0) return m->step / (m->max - m->min);'],
  ['the second (Q) is the gain', 'if (word == OMX_PANEL_WORD_SECOND) key = 2;', 'if (word == OMX_PANEL_WORD_SECOND) key = 1;'],
  ['a handle reset takes frequency and Q with the gain', 'size_t m = t->kind == GE_HANDLE ? 1 : key;', 'size_t m = key;'],
  ['a reset with no declared default resets to zero', 'if (!t->m[m].has_def) {', 'if (0) {'],
  ['a read-only control takes a press', 'if (read_only(e, t)) return refuse(e, OMX_PANEL_REFUSED_READ_ONLY, ev->t_ms, "a %s that is read-only takes no gesture", t->widget);\n  if (t->claim_on', 'if (0) return refuse(e, OMX_PANEL_REFUSED_READ_ONLY, ev->t_ms, "a %s that is read-only takes no gesture", t->widget);\n  if (t->claim_on'],
  ['a read-only control takes a wheel', 'if (read_only(e, t)) return refuse(e, OMX_PANEL_REFUSED_READ_ONLY, ev->t_ms, "a %s that is read-only takes no gesture", t->widget);\n  char source', 'if (0) return refuse(e, OMX_PANEL_REFUSED_READ_ONLY, ev->t_ms, "a %s that is read-only takes no gesture", t->widget);\n  char source'],
  ['a second pointer is not refused ownership', 'if (!pinch_ok) {', 'if (0) {'],
  ['a stepper\'s claim does not keep a press out', 'if (t->claim_on && ev->t_ms < t->claim_until)\n    return', 'if (0)\n    return'],
  ['another input may step inside the claim', '(t->claim_on && ev->t_ms < t->claim_until && strcmp(t->claim_source, source))', '(0 && strcmp(t->claim_source, source))'],
  ['the palm guard is not held', 'ev->t_ms - t->owner_t0 <= d->ms[TM_PALM_GUARD] &&', '1 &&'],
  ['a pinch of two pointer types', 't->owner_type == (int)ev->type &&', '1 &&'],
  ['a tap acts on release outside the target', 'if (!hit(t, ev->x, ev->y) || (t->kind == GE_BAR && column_of(t, ev->x) != pp.col)) {', 'if (0) {'],
  ['a tap changes the value it selects', '/* a tap selects and never changes a value */', 'set_member(e, g, key, t->m[key].def);'],
  ['a toggle does not flip', 'set_member(e, g, key, m->value == m->max ? m->min : m->max);', 'set_member(e, g, key, m->max);'],
  ['the double-tap window is not held', 'ev->t_ms - t->tap_t <= d->ms[TM_DOUBLE_TAP]', '1'],
  ['the long press never fires', 'now - p->t0 < d->ms[TM_LONG_PRESS]) continue;', '1) continue;'],
  ['a hold control acts on a short press', 'if (t->hold && ev->t_ms - pp.t0 < d->ms[TM_SAFETY_HOLD]) {', 'if (0) {'],
  ['the safety hold may be set below its floor', 'if (ms < e->d->floor[k]) {', 'if (0) {'],
  ['painting is off', 'col != p->col && paint_with(e, p->type)) {', 'col != p->col && 0) {'],
  ['a mouse paints though it was not asked to', 'static int paint_with(const ge_engine *e, int type) { return type == OMX_PANEL_POINTER_MOUSE ? e->paint_mouse : 1; }', 'static int paint_with(const ge_engine *e, int type) { (void)e; (void)type; return 1; }'],
  ['a sweep is more than one gesture id', 'p->painting = 1;\n    g->word', 'p->painting = 1;\n    p->g = open_g(e, p->target, OMX_PANEL_WORD_PAINT, IN_SWEEP, ev->t_ms, 1);\n    g = gest_at(e, p->g);\n    g->word'],
  ['columns jumped over are not entered', 'int count = dir == 0 ? 1 : abs(col - from);', 'int count = 1;'],
  ['a painted bar takes the height of the column it entered in the wrong place', 'return ge_value_of_norm(&t->m[m], clamp01((r[1] + r[3] - y) / r[3]));', 'return ge_value_of_norm(&t->m[m], clamp01((r[1] + r[3] - y) / (r[3] * 1.1)));'],
  ['an integer travel rounds a negative half away from zero', 'if (v - r == 0.5) r += 1;', ''],
  ['an integer travel rounds as floor(v + 0.5)', 'double r = round(v);', 'double r = floor(v + 0.5);'],
  ['a negative that rounds to zero is +0', 'return r == 0 && signbit(v) ? -0.0 : r;', 'return r;'],
  ['the notch count is an int32', 's->n = jhas(j, "n") ? jnum(j, "n", 0) : NAN,', 's->n = jhas(j, "n") ? (double)(int32_t)jnum(j, "n", 0) : NAN,'],
  ['a key with no n steps by zero', 'double count = (isnan(n) ? 1 : fabs(n)) *', 'double count = (isnan(n) ? 0 : fabs(n)) *'],
  ['every encoder but 3 is one source', 'snprintf(source, sizeof source, "detent%d", (int)ev->encoder);', 'snprintf(source, sizeof source, "detent%d", ev->encoder == 3 ? 3 : 1);'],
  ['a step the item is not in the table (GESTURE_NOT_IN_TABLE)', 'if (!word) return refuse(e, OMX_PANEL_REFUSED_NOT_IN_TABLE, ev->t_ms, "a %s has no %s"', 'if (0) return refuse(e, OMX_PANEL_REFUSED_NOT_IN_TABLE, ev->t_ms, "a %s has no %s"'],
  ['a step with no member is refused as another code (GESTURE_NO_TARGET)', 'if (key < 0 || (size_t)key >= t->n) return refuse(e, OMX_PANEL_REFUSED_NO_TARGET,', 'if (key < 0 || (size_t)key >= t->n) return refuse(e, OMX_PANEL_REFUSED_NOT_IN_TABLE,'],
  ['painting may be turned off for touch (GESTURE_PAINT_REQUIRED_ON_TOUCH)', 'cJSON_IsFalse(cJSON_GetObjectItemCaseSensitive(s, "paintWithTouch"))', '0'],
  ['a time of zero is a setting (GESTURE_BAD_SETTING)', 'if (!(ms > 0)) {', 'if (0) {'],
  ['an unknown timing is a setting (GESTURE_BAD_SETTING)', 'if (k < 0) {\n    for', 'if (0) {\n    for'],
  ['an event of no type is read as a key (GESTURE_BAD_INPUT)', 'if (!pointer && !(type && (!strcmp(type, "wheel") || !strcmp(type, "detent") || !strcmp(type, "key"))))', 'if (0)'],
  ['an event with no t is read (GESTURE_BAD_INPUT)', 'if (!is_num(cJSON_GetObjectItemCaseSensitive(j, "t"))) return bad', 'if (0) return bad'],
  ['a negative step is read (GESTURE_BAD_INPUT)', 'if (jhas(m, "step") && jnum(m, "step", 0) < 0) return bad', 'if (0) return bad'],
  ['a travelPx of zero is read (GESTURE_BAD_INPUT)', 'if (px && !(is_num(px) && px->valuedouble > 0)) return bad', 'if (0) return bad'],
  ['a non-boolean fine flag is read (GESTURE_BAD_INPUT)', 'if (f && !cJSON_IsBool(f)) return bad(why, cap, "event %d: %s is true or false", i, flags[k]);', ''],
  ['an unknown selected bar is read (GESTURE_BAD_INPUT)', 'if (!found) return bad(why, cap, "selected is a bar of the group");', ''],
  ['a selected on a knob is read (GESTURE_BAD_INPUT)', 'if (present(c, "selected")) return bad(why, cap, "selected is for a bar group");', ''],
  ['a timing that is no number is read (GESTURE_BAD_SETTING)', 'if (!ctx->refused && !cJSON_IsNumber(it)) {', 'if (0) {'],
  ['a control that is not an object is read (GESTURE_BAD_INPUT)', 'if (!cJSON_IsObject(control) || !cJSON_IsArray(events) || !e) answer_error', 'if (!control || !events || !e) answer_error'],
  ['a log travel is linear', 'double a = m->log ? log(m->min) : m->min, b = m->log ? log(m->max) : m->max;', 'double a = m->min, b = m->max;'],
];

for (const [name, find, replace] of ARMS) {
  test(`sabotage: ${name}`, () => {
    assert.equal(SOURCE.split(find).length - 1, 1, 'the text the arm replaces is in gesture.c exactly once');
    const red = sabotaged(SOURCE.replace(find, () => replace));
    assert.ok(red.length > 0, 'a case goes red');
  });
}

// ---- the two guards the shipped table never trips, each through its public door ----------------------------------------------

/** The omx-panel-render command built from a renderer tree whose gesture.c is `source`, in a scratch directory. */
function sabotagedCli(source) {
  const dir = mkdtempSync(join(tmpdir(), 'gesture-sabotage-cli-'));
  try {
    for (const f of ['src', 'include', 'Makefile', 'omx-panel-render.pc.in']) cpSync(join(RENDERER, f), join(dir, 'renderer', f), { recursive: true });
    cpSync(join(RENDERER, '..', 'package.json'), join(dir, 'package.json'));
    writeFileSync(join(dir, 'renderer', 'src', 'gesture.c'), source);
    execFileSync('make', ['-C', join(dir, 'renderer'), 'build/omx-panel-render', '-j4'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return wheelForHiddenControl(join(dir, 'renderer', 'build', 'omx-panel-render'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('sabotage: a step for a control in no target is not refused (through omx_panel_view_input)', () => {
  const find = 'if (target == GE_NONE) return refuse(e, OMX_PANEL_REFUSED_NO_TARGET,';
  assert.equal(SOURCE.split(find).length - 1, 1, 'the injection lands exactly once');
  assert.deepEqual(wheelForHiddenControl(), { refused: ['GESTURE_NO_TARGET'], gestures: 0, thr: 0 }, 'the untouched command is right');
  const got = sabotagedCli(SOURCE.replace(find, () => 'if (0) return refuse(e, OMX_PANEL_REFUSED_NO_TARGET,'));
  assert.notDeepEqual(got, { refused: ['GESTURE_NO_TARGET'], gestures: 0, thr: 0 });
  assert.ok(got.thr !== 0 || got.gestures > 0, 'the wrong control stepped');
});

test('sabotage: a tap with no tap cell is not refused (through the JSON door)', () => {
  const find = 'if (!word) return refuse(e, OMX_PANEL_REFUSED_NOT_IN_TABLE, ev->t_ms, "a %s has no tap", t->widget);';
  assert.equal(SOURCE.split(find).length - 1, 1, 'the injection lands exactly once');
  const dir = mkdtempSync(join(tmpdir(), 'gesture-sabotage-'));
  try {
    writeFileSync(join(dir, 'gesture.c'), SOURCE.replace(find, () => 'if (!word) return;'));
    const flags = execFileSync('pkg-config', ['--cflags', '--libs', 'libcjson'], { encoding: 'utf8' }).trim().split(/\s+/);
    execFileSync('cc', ['-std=c11', '-D_DEFAULT_SOURCE', '-O1', `-I${join(RENDERER, 'include')}`, `-I${join(RENDERER, 'src')}`, '-o', join(dir, 'driver'), join(dir, 'gesture.c'),
      join(RENDERER, 'test', 'gesture_driver.c'), ...flags, '-lm'], { stdio: ['ignore', 'pipe', 'pipe'] });
    assert.notDeepEqual(tapWithNoTapCell(join(dir, 'driver')), { refused: ['GESTURE_NOT_IN_TABLE'], gestures: 0, value: 20 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
