// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The renderer's tests read the role vocabulary (docs/renderer.md): `make renderer-check` points $OMX_ROLE_MEANINGS at this
 * tree's stand-in, and a run whose vocabulary declares no role FAILS, naming it, before it draws anything: an EQ laid out
 * with no role plays no meaning and derives no curve, and its goldens would be drawn without one.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  // the recipe is read, not dry-run: `make -n` still runs a recipe line that calls $(MAKE), the whole renderer check
  const make = readFileSync(join(ROOT, 'Makefile'), 'utf8');
  const recipe = /^renderer-check:.*\n((?:\t.*\n|.*\\\n)+)/m.exec(make)?.[1] ?? '';
  assert.match(recipe, /OMX_ROLE_MEANINGS="\$\$\{OMX_ROLE_MEANINGS:-\$\(CURDIR\)\/test\/fixtures\/role-meanings\/panel-roles\.json\}"/);
});

test('every CI step that runs a renderer test script with node, outside make renderer-check, names $OMX_ROLE_MEANINGS', () => {
  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  // each step: from its `- name:` or `- uses:` to the next
  const steps = ci.split(/\n(?=\s+- (?:name|uses):)/);
  const direct = steps.filter((s) => /\brun:.*\bnode renderer\/test\/\S+\.mjs/.test(s));
  assert.ok(direct.length > 0, 'the meter-surfaces step runs renderer/test/meter-surfaces.mjs with node');
  for (const s of direct) assert.match(s, /OMX_ROLE_MEANINGS:\s*\S*test\/fixtures\/role-meanings\/panel-roles\.json/, `step without the vocabulary:\n${s.trim()}`);
});
