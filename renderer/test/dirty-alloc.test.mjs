// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * A dirty draw short of memory draws the panel whole and reports the whole buffer; it never crashes and never leaves a half repaint
 * (docs/renderer.md "Dirty rectangles"). dirty_alloc.c links the library with its allocator wrapped and fails each allocation of the
 * dirty path in turn. An arm that dereferences an allocation unchecked (the layout's, or what the view keeps) is a crash, and an arm that
 * answers dirty from a layout it did not get reports a rectangle that is not the whole buffer: both go red here.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { DATA, FIXTURES, RENDERER, descriptionFile, scratch } from './harness.mjs';

test('every allocation of the dirty path failed in turn: whole buffer reported, pixels of a full draw, no crash', () => {
  const dir = scratch();
  const exe = join(dir, 'dirty_alloc');
  const libs = execFileSync('pkg-config', ['--libs', 'libcjson'], { encoding: 'utf8' }).trim().split(/\s+/);
  const cflags = execFileSync('pkg-config', ['--cflags', 'libcjson'], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
  execFileSync('cc', ['-std=c11', '-D_DEFAULT_SOURCE', '-Wall', '-Wextra', '-Werror', '-I', join(RENDERER, 'include'), ...cflags, '-o', exe, join(RENDERER, 'test', 'dirty_alloc.c'),
    join(RENDERER, 'build', 'libomx-panel-render.a'), ...libs, '-lm', '-Wl,--wrap=malloc,--wrap=calloc,--wrap=realloc']);
  const description = descriptionFile(FIXTURES.find((f) => f.name === 'omx-delay'), dir);
  const run = spawnSync(exe, [description, DATA], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stderr}${run.signal ? ` (signal ${run.signal})` : ''}`);
  assert.match(run.stdout, /^held: \d+ layout allocations, \d+ in a full draw/);
});
