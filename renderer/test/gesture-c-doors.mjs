// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas
/*
 * Two guards of gesture.c that the shipped table never trips, each reached through a public door: a step for a control that is
 * in no target, through omx_panel_view_input (the command's --input), and a tap on a widget whose declaration has no tap cell, through
 * the JSON door with such a declaration. Shared by gesture-c.test.mjs, which holds the right answer, and gesture-c-sabotage.test.mjs,
 * which disables each guard and watches it go red.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLI, DATA, FIXTURES, descriptionFile, scratch } from './harness.mjs';
import { DECLARATION, viaC } from './gesture-c.mjs';

const fx = FIXTURES.find((f) => f.name === 'zamcomp-panel');

/**
 * ZamComp's panel with `rat` hidden (its visibility mask is never set), then a wheel event naming `rat` placed over `thr`'s cell:
 * the renderer must refuse it as GESTURE_NO_TARGET and leave `thr` alone. Where the control is in no target and nothing says so, the wheel
 * is taken by whatever sits at x, y and the wrong control steps. `cli` is the omx-panel-render command to run.
 */
export function wheelForHiddenControl(cli = CLI) {
  const dir = scratch();
  const x = JSON.parse(readFileSync(descriptionFile(fx, dir), 'utf8'));
  x.controls = x.controls.map((c) => (c.symbol === 'rat' ? { ...c, visible: 99, mask: '0', visibleWhen: { symbol: 'mode', default: 0 } } : c));
  const description = join(dir, 'hidden.layout.json'), input = join(dir, 'hidden.input.json');
  writeFileSync(description, JSON.stringify(x));
  const travel = Object.fromEntries(x.controls.map((c) => [c.symbol, { min: 0, max: 10, def: 5 }]));
  const run = (events) => {
    writeFileSync(input, JSON.stringify({ travel, fractions: {}, events }));
    return JSON.parse(execFileSync(cli, ['--description', description, '--data', DATA, '--input', input], { encoding: 'utf8' }));
  };
  const [gx, gy, gw, gh] = run([]).geometry.thr.rect;
  const answer = run([{ t: 0, type: 'wheel', n: 3, x: gx + gw / 2, y: gy + gh / 2, control: 'rat' }]);
  return { refused: answer.refused.map((r) => r.code), gestures: answer.gestures.length, thr: answer.controls.thr.value };
}

/** A tap on a knob, through the JSON door, with a declaration whose knob row has no `tap`: refused GESTURE_NOT_IN_TABLE, no gesture. */
export function tapWithNoTapCell(driver) {
  const decl = JSON.parse(readFileSync(DECLARATION, 'utf8'));
  delete decl.table.knob.tap;
  const file = join(scratch(), 'no-tap.gestures.json');
  writeFileSync(file, JSON.stringify(decl));
  const control = { widget: 'knob', min: 0, max: 100, def: 50, value: 20, target: { x: 0, y: 0, w: 40, h: 40 } };
  const [a] = viaC([{ control, events: [{ t: 0, type: 'down', id: 'p', ptype: 'touch', x: 5, y: 5 }, { t: 60, type: 'up', id: 'p', ptype: 'touch', x: 5, y: 5 }] }], driver, file);
  return { refused: a.refused.map((r) => r.code), gestures: a.gestures.length, value: a.value };
}
