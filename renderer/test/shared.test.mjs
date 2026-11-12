// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The shared library (build/libomx-panel-render.so.0, what a surface loads at run time) exports every function the header
 * declares and nothing else, under its soname. An arm drops a function from the export map and the first check goes red; an
 * arm exports `*` and the second does.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const HERE = new URL('..', import.meta.url).pathname;
const SO = join(HERE, 'build', 'libomx-panel-render.so.0');

const declared = [...readFileSync(join(HERE, 'include', 'omx_panel_render.h'), 'utf8').matchAll(/\b(omx_panel_[a-z_]+)\s*\(/g)]
  .map((m) => m[1]);
const exported = execFileSync('nm', ['-D', '--defined-only', SO], { encoding: 'utf8' })
  .split('\n')
  .map((l) => l.trim().split(/\s+/))
  .filter((f) => f.length === 3 && f[1] === 'T')
  .map((f) => f[2].replace(/@.*$/, ''));

test('every function the header declares is exported', () => {
  const missing = [...new Set(declared)].filter((f) => !exported.includes(f));
  assert.deepEqual(missing, []);
});

test('nothing else is exported', () => {
  const extra = exported.filter((f) => !declared.includes(f));
  assert.deepEqual(extra, []);
});

test('the soname is libomx-panel-render.so.0', () => {
  const dyn = execFileSync('readelf', ['-d', SO], { encoding: 'utf8' });
  assert.match(dyn, /\(SONAME\)\s+Library soname: \[libomx-panel-render\.so\.0\]/);
});
