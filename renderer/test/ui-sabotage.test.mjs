// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * Sabotage rows for the ui library: each arm breaks one rule of the binding in a copy of src/ui.c, builds a driver from the copy and runs the
 * cases of ui-cases.mjs; the arm holds when at least one case then fails. Each arm first proves its injection landed: the text it replaces is
 * in the source exactly once. The untouched source is the first test: green, so a red arm is the arm's doing.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CASES, DRIVER, RENDERER } from './ui-cases.mjs';

const SOURCE = readFileSync(join(RENDERER, 'src', 'ui.c'), 'utf8');

/** The names of the cases that fail against the driver at `driver`. */
function failing(driver) {
  return CASES.flatMap(([name, check]) => {
    try { check(driver, assert); return []; } catch { return [name]; }
  });
}

/** A driver built from `source` (ui.c with one change), in a scratch directory: the names of the cases that fail against it. */
function sabotaged(source) {
  const dir = mkdtempSync(join(tmpdir(), 'ui-sabotage-'));
  try {
    writeFileSync(join(dir, 'ui.c'), source);
    const flags = execFileSync('pkg-config', ['--cflags', '--libs', 'libcjson'], { encoding: 'utf8' }).trim().split(/\s+/);
    execFileSync('cc', ['-std=c11', '-D_DEFAULT_SOURCE', '-ffp-contract=off', '-O1', '-Wall', `-I${join(RENDERER, 'include')}`, `-I${join(RENDERER, 'src')}`,
      '-o', join(dir, 'driver'), join(dir, 'ui.c'), join(RENDERER, 'test', 'ui_driver.c'), join(RENDERER, 'build', 'libomx-panel-render.a'), ...flags, '-lm'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    try { return failing(join(dir, 'driver')); } catch { return ['the driver crashed']; }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the untouched ui.c passes every case the arms run', () => assert.deepEqual(failing(DRIVER), []));

/** [what the arm breaks, the text it replaces (once in ui.c), what it puts there] */
const ARMS = [
  ['the host is not told a gesture began', 'if (ui->host.begin) ui->host.begin(ui->host.user, (uint32_t)p);', ''],
  ['the host is not told a gesture ended', 'if (ui->host.end) ui->host.end(ui->host.user, ui->open_param);\n    ui->open_gesture = NO_GESTURE;', 'ui->open_gesture = NO_GESTURE;'],
  ['the host is told its own value back', '  char text[96];\n  text_of(b, value, text, sizeof text);', '  char text[96];\n  if (ui->host.set) ui->host.set(ui->host.user, param, value);\n  text_of(b, value, text, sizeof text);'],
  ['the travel is not given to the control', 'omx_panel_view_set_travel(view, (uint32_t)b->control, &t);', ''],
  ['a read-only parameter takes a gesture', 'omx_panel_view_set_read_only(view, (uint32_t)b->control, params[i].read_only);', ''],
  ['a logarithmic travel is read as linear', 'if (b->p.log && lo > 0 && value > 0) return', 'if (0) return'],
];
// Not armed, because the host cannot tell the difference: a control no parameter drives is read-only in the view, which only its own drawing shows, and
// the host is told of no value of it either way; a parameter no control draws is refused by the view's own index check; the text of a step is drawn, not read back.

for (const [what, from, to] of ARMS) {
  test(`arm: ${what} goes red`, () => {
    assert.equal(SOURCE.split(from).length - 1, 1, `the text the arm replaces is not once in ui.c: ${from}`);
    const red = sabotaged(SOURCE.replace(from, to));
    assert.ok(red.length > 0, `no case went red`);
  });
}
