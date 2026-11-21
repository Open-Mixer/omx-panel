// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * What the ui library's tests share (omx_panel_ui.h): ZamComp's committed layout, the parameters a plugin would hand in for its knobs, the
 * driver run over a case, and the cases, each with the check that its answers are the right ones. ui.test.mjs holds the real build to them
 * and ui-sabotage.test.mjs holds each arm's broken copy of src/ui.c to at least one of them.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, ROOT, scratch } from './harness.mjs';

export const RENDERER = join(ROOT, 'renderer');
export const DRIVER = join(RENDERER, 'build', 'ui_driver');
const dir = scratch('omx-panel-ui-');
// ZamComp's committed layout (examples/worked-example): ten controls, knobs and the rest. A plugin hands in the layout and its parameters;
// here a travel of 0..100 for each knob, the first (20..20000) logarithmic.
export const LAYOUT = join(ROOT, 'examples', 'worked-example', 'zamcomp', 'zamcomp.layout.json');
const knobs = JSON.parse(readFileSync(LAYOUT, 'utf8')).controls.filter((c) => c.widget === 'knob');
export const PARAMS = knobs.map((k, i) => ({ symbol: k.symbol, unit: k.unit === 'unknown' ? '' : k.unit ?? '', min: i === 0 ? 20 : 0, max: i === 0 ? 20000 : 100, def: i === 0 ? 1000 : 50, has_def: true, log: i === 0 }));

/** The lines `driver` prints for `steps` over `params`, split on spaces. */
export function run(driver, steps, params = PARAMS) {
  const file = join(dir, `case-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify({ params, steps }));
  return execFileSync(driver, [LAYOUT, DATA, file], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map((l) => l.split(' '));
}

const told = (out) => out.filter((l) => ['begin', 'set', 'end'].includes(l[0]));
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

/** [name, check(driver)]: a check throws (assert) when the driver's answers are wrong. */
export const CASES = [
  ['a value the host reads is shown in the parameter\'s own unit, on a linear travel, and is not told back', (d, assert) => {
    const out = run(d, [{ set: [1, 25] }, { read: 1 }]);
    assert.deepEqual(out[0], ['set-ok', '1', '1']);
    assert.equal(out[1][2], '1');
    assert.ok(near(Number(out[1][4]), 25), `the control reads ${out[1][4]}`);
    assert.ok(near(Number(out[1][3]), 0.25), `the fraction is ${out[1][3]}`);
    assert.equal(told(out).length, 0, 'the host was told its own value');
  }],
  ['a value on a logarithmic travel sits at its log fraction', (d, assert) => {
    const out = run(d, [{ set: [0, Math.sqrt(20 * 20000)] }, { read: 0 }]);
    assert.ok(near(Number(out[1][3]), 0.5, 1e-6), `the fraction of the geometric middle is ${out[1][3]}`);
  }],
  ['a drag moves the control; the host is told begin, then the values in the parameter\'s unit, then end', (d, assert) => {
    const out = run(d, [{ set: [1, 50] }, { drag: 1, dy: -60 }]);
    const t = told(out);
    assert.equal(t[0]?.[0], 'begin', JSON.stringify(t));
    assert.equal(t.at(-1)?.[0], 'end');
    const sets = t.filter((l) => l[0] === 'set').map((l) => Number(l[2]));
    assert.ok(sets.length > 0, 'no value reached the host');
    for (const v of sets) assert.ok(v >= -1e-9 && v <= 100 + 1e-9, `${v} is outside 0..100`);
    assert.ok(sets.at(-1) > 50, `a drag up left the value at ${sets.at(-1)}`);
    assert.equal(t.filter((l) => l[0] === 'begin').length, 1);
    assert.equal(t.filter((l) => l[0] === 'end').length, 1);
    assert.ok(t.filter((l) => l[0] === 'set').every((l) => l[1] === '1'), 'a value was told of another parameter');
  }],
  ['a read-only parameter takes no gesture', (d, assert) => {
    const out = run(d, [{ drag: 0, dy: -60 }], PARAMS.map((p, i) => (i === 0 ? { ...p, read_only: true } : p)));
    assert.equal(out.filter((l) => l[0] === 'set').length, 0);
  }],
  ['a control no parameter drives takes no gesture', (d, assert) => {
    const at = run(d, [{ target: 1 }]).find((l) => l[0] === 'target');
    assert.equal(at[2], '1', 'the knob has a target');
    const [x, y, w, h] = at.slice(3, 7).map(Number);
    const sets = (list) => run(d, [{ pressat: [x + w / 2, y + h / 2], dy: -60 }], list).filter((l) => l[0] === 'set');
    assert.ok(sets(PARAMS).length > 0, 'with its parameter handed in, a drag moves the knob');
    assert.equal(sets(PARAMS.filter((_p, i) => i !== 1)).length, 0, 'without it, the same drag moves nothing');
  }],
  ['a parameter the layout does not draw is refused by name', (d, assert) => {
    const out = run(d, [{ set: [0, 1] }, { read: 0 }], [{ symbol: 'not-a-control', unit: '', min: 0, max: 1, def: 0, has_def: true }]);
    assert.deepEqual(out[0], ['set-ok', '0', '0']);
    assert.equal(out[1][2], '0');
  }],
  ['an integer parameter reads back its step', (d, assert) => {
    const p = [{ ...PARAMS[1], min: 0, max: 2, def: 0, integer: true, labels: ['Off', 'Soft', 'Hard'] }];
    const out = run(d, [{ set: [0, 2] }, { read: 0 }], p);
    assert.deepEqual(out[0], ['set-ok', '0', '1']);
    assert.ok(near(Number(out[1][4]), 2), `reads ${out[1][4]}`);
  }],
];
