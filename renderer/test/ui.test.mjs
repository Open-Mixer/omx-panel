// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The ui library binds a plugin's panel to its parameters (omx_panel_ui.h, docs/plugin-ui.md), headless: build/ui_driver runs the cases of
 * ui-cases.mjs over ZamComp's layout. The host reads a value and the control shows it in the parameter's own unit; a gesture moves a
 * control and the host is told the value in that unit, bracketed by begin and end; a parameter the layout does not draw is refused by
 * name; a control no parameter drives takes no gesture; the host's own read-back is never told back; the exports are the header's.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CASES, DRIVER, PARAMS, RENDERER } from './ui-cases.mjs';

const SO = join(RENDERER, 'build', 'libomx-panel-ui.so.0');

test('the ui driver is built', () => assert.ok(existsSync(DRIVER), `${DRIVER}: make -C renderer check builds it`));
test('the layout has knobs to drive', () => assert.ok(PARAMS.length >= 3, `${PARAMS.length} knobs`));
for (const [name, check] of CASES) test(name, () => check(DRIVER, assert));

test('the library exports the header\'s functions and nothing else', () => {
  assert.ok(existsSync(SO), `${SO}: make -C renderer builds it`);
  const declared = [...readFileSync(join(RENDERER, 'include', 'omx_panel_ui.h'), 'utf8').matchAll(/\b(omx_panel_ui_[a-z_]+)\s*\(/g)].map((m) => m[1]);
  const exported = execFileSync('nm', ['-D', '--defined-only', SO], { encoding: 'utf8' }).split('\n').map((l) => l.trim().split(/\s+/)).filter((f) => f.length === 3 && f[1] === 'T').map((f) => f[2].replace(/@.*$/, ''));
  assert.deepEqual([...new Set(declared)].sort(), exported.sort());
});
