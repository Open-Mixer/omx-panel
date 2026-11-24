// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The ui library is installed whole or not at all. Without the window (WINDOW=0, what the omx-panel packages build) libomx-panel-ui
 * is not installed, so neither is its header nor its pkg-config file: a package build that staged them alone stopped on files no
 * package lists (ci run 45433573844, "Installed (but unpackaged) file(s) found: omx_panel_ui.h, omx-panel-ui.pc"). The library's
 * own package, with the window, is omx-panel#187.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { RENDERER, scratch } from './harness.mjs';

const staged = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => !e.isDirectory()).map((e) => e.name).sort();

test('an install without the window stages nothing of the ui library: no header, no pkg-config file, no library', () => {
  const dest = scratch('omx-panel-ui-install-');
  const r = spawnSync('make', ['-C', RENDERER, 'install', 'WINDOW=0', `DESTDIR=${dest}`, 'PREFIX=/usr', 'LIBDIR=/usr/lib'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const files = staged(dest);
  assert.ok(files.includes('omx_panel_render.h') && files.includes('omx-panel-render.pc'), `the renderer is staged: ${files.join(', ')}`);
  assert.deepEqual(files.filter((f) => /omx[-_]panel[-_]ui/.test(f)), []);
});
