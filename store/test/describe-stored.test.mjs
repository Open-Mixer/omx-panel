// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * `omx-panel describe --stored <answer.json> --format <lv2|clap>` through the real store (#220, docs/descriptions-store.md
 * section 11, zynthian-ui): the job a client that is not Node.js runs. A plugin's entry is written by the real command
 * (`describe --plugin --store`, or a person's edit through `omx-panel-store put`), read back by the real
 * `omx-panel-store get --json`, and that answer file is all `describe --stored` is given. The oracle is the command that
 * derives: for a derived entry its stdout is byte for byte `describe --descriptor`'s, whole and as pages; for an edited
 * entry the pages carry the edit, which `describe --descriptor` never serves.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { describeStored } from '../../dist/tools/describe.mjs';
import { entryOf } from '../../dist/tools/store-entry.mjs';
import { flags, get, RULES, run } from './helpers.mjs';
import { FIXTURES, OMX_PANEL, sha256, sourceOf, storeEnv, world } from './plugin-world.mjs';

const unprivileged = process.geteuid() !== 0;
if (!unprivileged) process.stderr.write('describe-stored.test.mjs: skipping: run as root, the writer writes the system layer\n');

const FILE = join(FIXTURES, 'descriptors', 'scanned-clap-omx-comp.json');
const DESCRIPTOR = JSON.parse(readFileSync(FILE, 'utf8'));
const panel = (args, env) => spawnSync(process.execPath, [OMX_PANEL, 'describe', ...args], { encoding: 'utf8', env, timeout: 60000 });

/** A world holding the omx-comp binary, and the store key of it: { w, key } with key { sha, format, uri, source }. */
function clapWorld(t) {
  const w = world(t);
  const binary = join(w.d, 'clap', 'omx-comp.clap');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, 'the omx-comp binary\n');
  return { w, binary, key: { sha: sha256(binary), format: 'clap', uri: DESCRIPTOR.plugin.id, source: sourceOf('clap', FILE) } };
}

/** The real `omx-panel-store get --json` answer for `key`, written to a file as a client would hand it over. */
function answerFile(w, key) {
  const r = get(w.places, key);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.answer.body, 'the store answers an entry with a body');
  const file = join(w.d, 'answer.json');
  writeFileSync(file, JSON.stringify(r.answer));
  return { file, answer: r.answer };
}

test('the entry the real command put, read back by get, is cut by describe --stored as describe --descriptor cuts it', { skip: !unprivileged }, (t) => {
  const { w, binary, key } = clapWorld(t);
  const put = spawnSync(process.execPath, [OMX_PANEL, 'describe', '--plugin', `clap:${binary}#${key.uri}`, '--descriptor', FILE, '--store'], { encoding: 'utf8', env: storeEnv(w), timeout: 60000 });
  assert.equal(put.status, 0, put.stderr);
  const { file, answer } = answerFile(w, key);
  assert.equal(answer.layer, 'user');
  for (const extra of [[], ['--pages'], ['--pages', '--per-page', '4']]) {
    const want = panel(['--descriptor', FILE, ...extra]);
    assert.equal(want.status, 0, want.stderr);
    const got = panel(['--stored', file, '--format', 'clap', ...extra]);
    assert.equal(got.status, 0, got.stderr);
    assert.equal(got.stdout, want.stdout, extra.join(' ') || 'whole');
  }
});

test('a person\'s edit put through omx-panel-store reaches the pages describe --stored cuts, and describe never serves it', { skip: !unprivileged }, (t) => {
  const { w, key } = clapWorld(t);
  const derived = describeStored(DESCRIPTOR, { where: FILE });
  const entry = entryOf({ derived, source: key.source, rules: RULES, madeBy: 'a person' });
  const first = entry.body.sections[0];
  entry.body = { ...entry.body, sections: entry.body.sections.map((s) => (s.key === first.key ? { ...s, label: 'Colour', labelKey: '' } : s)) };
  entry.edited = 1;
  const put = run(['put', ...flags(w.places), '--sha256', key.sha, '--format', 'clap', '--uri', key.uri], { input: JSON.stringify(entry) });
  assert.equal(put.status, 0, put.stderr);
  const { file, answer } = answerFile(w, key);
  assert.equal(answer.edited, 1, 'the store holds the edit');
  const names = (r) => {
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).map((p) => p.pageName ?? p.sectionName);
  };
  const stored = names(panel(['--stored', file, '--format', 'clap', '--pages', '--per-page', '4']));
  const derivedPages = names(panel(['--descriptor', FILE, '--pages', '--per-page', '4']));
  assert.ok(stored.some((n) => n.startsWith('Colour')), stored.join(', '));
  assert.ok(!derivedPages.some((n) => n.startsWith('Colour')), derivedPages.join(', '));
  assert.equal(stored.length, derivedPages.length, 'the edit renames a section; the cut is the same');
});
