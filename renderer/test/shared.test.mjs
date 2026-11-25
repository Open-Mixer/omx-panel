// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The shared library (build/libomx-panel-render.so.1, what a surface loads at run time) exports every function its two headers
 * declare (omx_panel_render.h, omx_panel_gesture.h) and nothing else, under its soname. An arm drops a function from the export
 * map and the first check goes red; an arm exports `*` and the second does. abi/omx_panel_gesture.abi lists the gesture unit's
 * symbols with their version and prototype: it is held to the header and to the library both ways.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const HERE = new URL('..', import.meta.url).pathname;
const SO = join(HERE, 'build', 'libomx-panel-render.so.1');

const header = (name, prefix) => [...readFileSync(join(HERE, 'include', name), 'utf8').matchAll(new RegExp(`\\b(${prefix}[a-z_]+)\\s*\\(`, 'g'))].map((m) => m[1]);
const gestureDeclared = header('omx_panel_gesture.h', 'omx_gesture_');
const declared = [...header('omx_panel_render.h', 'omx_panel_'), ...gestureDeclared];
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

const abi = readFileSync(join(HERE, 'abi', 'omx_panel_gesture.abi'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
  .map((l) => { const [sym, proto] = l.split(': '); const [name, version] = sym.split('@@'); return { name, version, proto }; });
const versioned = execFileSync('nm', ['-D', '--defined-only', SO], { encoding: 'utf8' }).split('\n')
  .map((l) => l.trim().split(/\s+/)).filter((f) => f.length === 3 && f[1] === 'T' && f[2].startsWith('omx_gesture_')).map((f) => f[2]);

test('the gesture unit\'s ABI file lists the functions of its header, and the library exports them under its version', () => {
  assert.deepEqual(abi.map((a) => a.name).sort(), [...new Set(gestureDeclared)].sort());
  assert.deepEqual(versioned.sort(), abi.map((a) => `${a.name}@@${a.version}`).sort());
});

test('each prototype the ABI file gives is the header\'s', () => {
  const text = readFileSync(join(HERE, 'include', 'omx_panel_gesture.h'), 'utf8').replace(/\s+/g, ' ');
  for (const a of abi) assert.ok(text.includes(`${a.proto};`), a.proto);
});

/** The Doxygen comment written directly before a declaration, or null. */
const docOf = (text, declaration) => {
  const at = text.indexOf(declaration);
  if (at < 0) return null;
  const end = text.lastIndexOf('*/', at);
  const start = text.lastIndexOf('/**', end);
  return start >= 0 && end >= 0 && /^\s*$/.test(text.slice(end + 2, at)) ? text.slice(start, end + 2) : null;
};

test('every public symbol of the gesture header is documented, each parameter and the return (the doc gate)', () => {
  const text = readFileSync(join(HERE, 'include', 'omx_panel_gesture.h'), 'utf8');
  assert.match(text, /@file/);
  assert.ok(docOf(text, 'typedef struct omx_gesture omx_gesture_t;'), 'the context type is documented');
  for (const a of abi) {
    const doc = docOf(text, a.proto);
    assert.ok(doc, `${a.name} has a Doxygen comment before it`);
    const params = a.proto.slice(a.proto.indexOf('(') + 1, a.proto.lastIndexOf(')')).split(',').map((p) => p.trim().split(/[ *]+/).pop()).filter((p) => p && p !== 'void');
    for (const p of params) assert.match(doc, new RegExp(`@param\\s+${p}\\b`), `${a.name}: @param ${p}`);
    if (!/^void\b/.test(a.proto)) assert.match(doc, /@return/, `${a.name}: @return`);
  }
});

test('the soname is libomx-panel-render.so.1', () => {
  // readelf translates its labels ('Library soname') under the caller's locale: read them in C
  const dyn = execFileSync('readelf', ['-d', SO], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  assert.match(dyn, /\(SONAME\)\s+Library soname: \[libomx-panel-render\.so\.1\]/);
});
