// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The renderer and the colour roles (the one-panel spec §7.10): read_look takes the resolved roles its host passes, the
 * whole role list of schema/look-roles.json (renderer/src/look_roles.h); a look short of any role, drawn here or not, is
 * refused by the role's name; and each role the renderer draws, moved to a colour of its own, moves the pixels.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLI, DATA, FIXTURES, ROOT, compare, descriptionFile, render, scratch, stateFile } from './harness.mjs';

const LOOK = JSON.parse(readFileSync(join(DATA, 'look.json'), 'utf8'));
const ROLES = JSON.parse(readFileSync(join(ROOT, 'schema/look-roles.json'), 'utf8')).roles.map((r) => r.name);

/** A data directory as tools/ is, its look.json's tokens `tokens`. */
function dataWith(tokens) {
  const dir = scratch();
  mkdirSync(join(dir, 'look'), { recursive: true });
  mkdirSync(join(dir, 'fonts'), { recursive: true });
  copyFileSync(join(DATA, 'look/geometry.json'), join(dir, 'look/geometry.json'));
  copyFileSync(join(DATA, LOOK.tokens['--font-file']), join(dir, LOOK.tokens['--font-file']));
  copyFileSync(join(ROOT, 'schema/gestures.json'), join(dir, 'gestures.json'));
  writeFileSync(join(dir, 'look.json'), JSON.stringify({ ...LOOK, tokens }));
  return dir;
}

/** The roles view.c's read_look maps onto what it draws. */
const DRAWN = [...readFileSync(join(ROOT, 'renderer/src/view.c'), 'utf8').matchAll(/\{\s*"(--[a-z0-9-]+)"\s*,\s*&v->col/g)].map((m) => m[1]);

/** omx-delay (the face, its sections, a switch) and dyn-curve (a curve's frame, rim and body, points or none). */
const PANELS = ['omx-delay', 'dyn-curve'].map((name) => {
  const fx = FIXTURES.find((f) => f.name === name), dir = scratch();
  return { name, description: descriptionFile(fx, dir), state: stateFile(fx, dir) };
});

test('the role list read_look walks is the role file\'s, in its order', () => {
  const header = readFileSync(join(ROOT, 'renderer/src/look_roles.h'), 'utf8');
  assert.deepEqual([...header.matchAll(/^ {4}"(--[a-z0-9-]+)",$/gm)].map((m) => m[1]), ROLES);
  assert.ok(DRAWN.length >= 7 && DRAWN.every((n) => ROLES.includes(n)), DRAWN.join(' '));
});

test('a look short of a role the renderer does not draw is refused, naming the role', () => {
  const p = PANELS[0];
  for (const missing of ['--origin-room-mode', '--meter-red']) {
    const tokens = { ...LOOK.tokens };
    delete tokens[missing];
    const r = spawnSync(CLI, ['--description', p.description, '--data', dataWith(tokens), '--state', p.state, '--raw', join(scratch(), 'x.raw')], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, `a look without ${missing} was drawn`);
    assert.match(r.stderr, new RegExp(`the role ${missing} is not a #rrggbb colour`));
  }
});

test('positive control: the whole look draws, the same as the tools directory\'s', () => {
  const p = PANELS[0];
  assert.ok(compare(render(p.description, p.state, { data: dataWith(LOOK.tokens) }), render(p.description, p.state)).exact);
});

test('a fixture per role: each role the renderer draws, moved to a colour of its own, moves the pixels', () => {
  const was = PANELS.map((p) => render(p.description, p.state));
  for (const n of DRAWN) {
    const data = dataWith({ ...LOOK.tokens, [n]: '#010203' });
    const moved = PANELS.map((p, i) => compare(render(p.description, p.state, { data }), was[i]).off);
    assert.ok(moved.some((off) => off > 0), `${n} moved no pixel of ${PANELS.map((p) => p.name).join(' or ')}`);
  }
});

