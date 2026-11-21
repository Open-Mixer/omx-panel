// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The ui library's window (omx_panel_ui.h, "the window"), under a display: build/ui_window_driver opens a window of its own over ZamComp's layout,
 * shows it and reads its frames. The window is the panel's natural size and has a native handle; it drew (pixels are opaque); the value a host reads
 * is what the next frame shows (parameter 0 at its minimum and at its maximum draw differently); closing it releases it.
 *
 * Needs the library built with the window (make WINDOW=1) and a display (xvfb-run). Without them each test is skipped, unless
 * OMX_PANEL_WINDOW_REQUIRED=1, as CI sets it, makes a missing window a failure.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { DATA, scratch } from './harness.mjs';
import { LAYOUT, PARAMS, RENDERER } from './ui-cases.mjs';

const DRIVER = join(RENDERER, 'build', 'ui_window_driver');
const REQUIRED = process.env.OMX_PANEL_WINDOW_REQUIRED === '1';
const why = !existsSync(DRIVER) ? 'the library is built without the window (make WINDOW=1)' : !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ? 'no display' : null;
const opts = { skip: !REQUIRED && why };

function frames() {
  const file = join(scratch('omx-panel-ui-window-'), 'case.json');
  writeFileSync(file, JSON.stringify({ params: PARAMS, steps: [] }));
  const out = execFileSync(DRIVER, [LAYOUT, DATA, file], { encoding: 'utf8' }).trim().split('\n').map((l) => l.split(' '));
  return Object.fromEntries(out.map(([k, ...v]) => [k, v.map(Number)]));
}

test('the window is the panel\'s natural size and has a native handle', opts, () => {
  assert.ok(!why, why);
  const r = frames();
  assert.deepEqual(r.size, r.natural);
  assert.equal(r.native[0], 1);
});

test('the window draws, and the value a host reads is what the next frame shows', opts, () => {
  assert.ok(!why, why);
  const r = frames();
  assert.equal(r.read[0], 1, 'a frame was read back');
  assert.ok(r.opaque[0] > 0.5 * r.size[0] * r.size[1], `the first frame has ${r.opaque[0]} opaque pixels`);
  assert.ok(r.changed[0] > 0, 'parameter 0 at its minimum and at its maximum draw the same');
});

test('closing the ui releases its window', opts, () => {
  assert.ok(!why, why);
  assert.equal(frames().closed[0], 1);
});
