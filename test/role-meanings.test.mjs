// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The meaning a panel role plays is what the installed packages declare in their `roleMeanings` items (omx-contract
// docs/contract-dir.md, "A package's role meanings"), read from the contract directories; omx-panel keeps no list of its
// own. A role no package declares plays none, whatever its name; a role declared twice is refused.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VOCABULARY = join(ROOT, 'dist/tools/vocabulary.mjs');
const work = mkdtempSync(join(tmpdir(), 'role-meanings-'));
after(() => rmSync(work, { recursive: true, force: true }));

/** A contract directory whose package `pkg` declares `roles` (role -> meaning) in an item named `name`. */
function contractDir(packages) {
  const dir = mkdtempSync(join(work, 'c-'));
  for (const [pkg, name, roles] of packages) {
    mkdirSync(join(dir, '3', pkg), { recursive: true });
    const rows = Object.fromEntries(Object.entries(roles).map(([role, meaning]) => [role, { role, meaning }]));
    writeFileSync(join(dir, '3', pkg, 'role-meanings.json'), JSON.stringify({ [name]: { kind: 'roleMeanings', since: '1.0.0', roles: rows } }));
  }
  return dir;
}

/** `expr` over the module `v`, in a process that reads the contract directory `dir` and nothing else. */
function lookup(expr, dir) {
  const env = { ...process.env, OMX_CONTRACT_PATH: dir, PKG_CONFIG: '/nonexistent/pkg-config' };
  delete env.OMX_ROLE_MEANINGS;
  const code = `const v = await import(${JSON.stringify(VOCABULARY)}); process.stdout.write(JSON.stringify(${expr}));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env });
  return r.status === 0 ? { value: JSON.parse(r.stdout) } : { error: r.stderr };
}

test('a role plays the meaning a package declares for it, renamed or not', () => {
  const dir = contractDir([['a-plugins', 'A_ROLE_MEANINGS', { mix: 'wetDryRatio', thresh: 'threshold', threshold: 'threshold' }]]);
  assert.deepEqual(lookup('["mix", "thresh", "threshold"].map(v.meaningOfRole)', dir).value, ['wetDryRatio', 'threshold', 'threshold']);
});

test('a role no package declares plays none, even one named as a meaning', () => {
  const dir = contractDir([['a-plugins', 'A_ROLE_MEANINGS', { mix: 'wetDryRatio' }]]);
  assert.deepEqual(lookup('["threshold", "ratio", "time"].map((r) => v.meaningOfRole(r) ?? null)', dir).value, [null, null, null]);
});

test('a role declared unknown, or as a word the schema does not list, plays none', () => {
  const dir = contractDir([['a-plugins', 'A_ROLE_MEANINGS', { band_type: 'unknown', odd: 'notAMeaning', ratio: 'ratio' }]]);
  assert.deepEqual(lookup('["band_type", "odd", "ratio"].map((r) => v.meaningOfRole(r) ?? null)', dir).value, [null, null, 'ratio']);
});

test('every package of every contract directory is read', () => {
  const dir = contractDir([['a-plugins', 'A_ROLE_MEANINGS', { mix: 'wetDryRatio' }], ['b-plugins', 'B_ROLE_MEANINGS', { drive: 'drive' }]]);
  assert.deepEqual(lookup('["mix", "drive"].map(v.meaningOfRole)', dir).value, ['wetDryRatio', 'drive']);
});

test('a role two packages declare is refused: a role has one owner', () => {
  const dir = contractDir([['a-plugins', 'A_ROLE_MEANINGS', { mix: 'wetDryRatio' }], ['b-plugins', 'B_ROLE_MEANINGS', { mix: 'depth' }]]);
  const r = lookup('v.meaningOfRole("mix")', dir);
  assert.match(r.error ?? '', /contract\.role\.duplicate: role 'mix' is declared by/);
});

test('no package declaring roles: every role plays none', () => {
  const dir = mkdtempSync(join(work, 'empty-'));
  assert.deepEqual(lookup('["mix", "threshold"].map((r) => v.meaningOfRole(r) ?? null)', dir).value, [null, null]);
});

test('omx-panel keeps no role-to-meaning list of its own', () => {
  const src = readFileSync(join(ROOT, 'tools/vocabulary.mjs'), 'utf8');
  assert.doesNotMatch(src, /wetDryRatio|cutoffFrequency|MEANING_OF_ROLE/);
});
