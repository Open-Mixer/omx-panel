// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The renderer's tests read the role vocabulary (docs/renderer.md): `make renderer-check` points $OMX_ROLE_MEANINGS at this
 * tree's stand-in, and a run whose vocabulary declares no role FAILS, naming it, before it draws anything: an EQ laid out
 * with no role plays no meaning and derives no curve, and its goldens would be drawn without one.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT, RENDERER } from './harness.mjs';

test('with no role vocabulary a fixture is not drawn: the harness fails, naming $OMX_ROLE_MEANINGS', () => {
  const script = `const h = await import(${JSON.stringify(join(RENDERER, 'test', 'harness.mjs'))});
const fx = h.FIXTURES.find((f) => f.name === 'omx-eq8');
h.descriptionFile(fx, h.scratch());`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, OMX_ROLE_MEANINGS: '/nonexistent/panel-roles.json' } });
  assert.notEqual(r.status, 0, 'the fixture was drawn with no role vocabulary');
  assert.match(r.stderr, /no role vocabulary.*OMX_ROLE_MEANINGS/s);
});

test('make renderer-check points $OMX_ROLE_MEANINGS at the tree\'s stand-in unless the caller names one', () => {
  const env = { ...process.env };
  delete env.OMX_ROLE_MEANINGS;
  const dry = execFileSync('make', ['-n', '-s', '-C', ROOT, 'renderer-check'], { encoding: 'utf8', env });
  assert.match(dry, /OMX_ROLE_MEANINGS=\S*test\/fixtures\/role-meanings\/panel-roles\.json/);
});
