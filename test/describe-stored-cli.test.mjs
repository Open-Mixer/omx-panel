// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * describe-stored-cli.test.mjs — `omx-panel describe --stored <answer.json> --format <lv2|clap>` (#220,
 * docs/descriptions-store.md section 11, zynthian-ui): the door for a client that is not Node.js. The answer is what
 * `omx-panel-store get --json` prints (body, groups_json, controls with their ids as text); the command reads it by
 * `storedOf` and cuts it by `describeFromStored`. Held by value: over the corpus, for each plugin, the command's stdout
 * is byte-equal to `describe --descriptor`'s, whole and as pages at two widths. An edited entry serves the edit, the
 * format turns a CLAP id back into its number, a refused entry says its code, and every flag that would read something
 * other than the answer is a usage error. store/test/describe-stored.test.mjs is the same job through the real store.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { describeStored } from '../dist/tools/describe.mjs';
import { entryOf } from '../dist/tools/store-entry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test', 'fixtures');
const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'dist/bin/omx-panel.mjs'), 'describe', ...args], { encoding: 'utf8' });
const DIRS = [[join(FIXTURES, 'group-model', 'omx-plugins'), '.descriptor.json'], [join(FIXTURES, 'descriptors'), '.json']];
const corpus = DIRS.flatMap(([dir, ext]) => readdirSync(dir).filter((f) => f.endsWith(ext)).sort().map((f) => {
  const file = join(dir, f);
  return { name: f, file, descriptor: JSON.parse(readFileSync(file, 'utf8')) };
}));
const dir = mkdtempSync(join(tmpdir(), 'omx-panel-stored-'));

/** The answer `omx-panel-store get --json` prints for the entry `describe --store` puts of `descriptor` (store/src/cli.c print_entry). */
function answerOf(descriptor) {
  const e = entryOf({ derived: describeStored(descriptor), source: 'f'.repeat(64), rules: 1, madeBy: 'omx-panel test' });
  return { layer: 'user', stale_edit_layer: null, edited: e.edited, made_by: e.made_by, family: e.family, fingerprint: e.fingerprint,
    body: e.body, groups_json: e.groups, refused: e.refused, group_outcome: null, group_reason: null, groups: [], controls: e.controls };
}
let n = 0;
const fileOf = (doc) => {
  const f = join(dir, `answer-${n++}.json`);
  writeFileSync(f, JSON.stringify(doc));
  return f;
};

test('the corpus holds both formats and a plugin with no panel, so each arm below has something to read', () => {
  const formats = new Set(corpus.map((c) => c.descriptor.plugin.format));
  assert.deepEqual([...formats].sort(), ['clap', 'lv2']);
  assert.ok(corpus.some((c) => answerOf(c.descriptor).body === null), 'a refused derivation in the corpus');
  assert.ok(corpus.length >= 15, `${corpus.length} plugins`);
});

for (const { name, file, descriptor } of corpus) {
  const answer = answerOf(descriptor);
  if (answer.body === null) continue;
  test(`${name}: describe --stored prints what describe --descriptor prints, whole and as pages`, () => {
    const stored = fileOf(answer);
    const format = descriptor.plugin.format;
    for (const extra of [[], ['--pages'], ['--pages', '--per-page', '4']]) {
      const want = run('--descriptor', file, ...extra);
      assert.equal(want.status, 0, want.stderr);
      const got = run('--stored', stored, '--format', format, ...extra);
      assert.equal(got.status, 0, `${extra.join(' ')}: ${got.stderr}`);
      assert.equal(got.stdout, want.stdout, `${name} ${extra.join(' ')}`);
    }
  });
}

test('a skin and the host\'s remote pages are applied to the stored entry as describe applies them', () => {
  const { file, descriptor } = corpus.find((c) => c.name === 'omx-eq8.descriptor.json');
  const description = JSON.parse(run('--descriptor', file).stdout).description;
  const first = description.sections[0];
  const skin = fileOf({ schema: 1, plugin: descriptor.plugin.id, licence: 'CC0-1.0',
    sections: [{ key: first.key, controls: description.controls.filter((c) => c.section === first.key).map((c) => c.symbol).reverse() }] });
  const remote = fileOf([{ name: 'Host', ids: description.controls.slice(0, 3).map((c) => c.symbol) }]);
  const stored = fileOf(answerOf(descriptor));
  for (const extra of [['--skin', skin], ['--remote', remote, '--pages', '--per-page', '4']]) {
    const want = run('--descriptor', file, ...extra);
    assert.equal(want.status, 0, want.stderr);
    assert.notEqual(want.stdout, run('--descriptor', file, ...extra.slice(2)).stdout, `${extra[0]} moves the output`);
    assert.equal(run('--stored', stored, '--format', 'clap', ...extra).stdout, want.stdout, extra[0]);
  }
});

test('an edited entry serves the edit: the pages name the section as the store holds it, not as describe derives it', () => {
  const { file, descriptor } = corpus.find((c) => c.name === 'scanned-lv2-omx-eq8.json');
  const answer = answerOf(descriptor);
  const section = answer.body.sections.find((s) => !s.bars);
  const derived = JSON.parse(run('--descriptor', file, '--pages').stdout);
  answer.body.sections = answer.body.sections.map((s) => (s.key === section.key ? { ...s, label: 'Colour', labelKey: '' } : s));
  const pages = run('--stored', fileOf(answer), '--format', 'lv2', '--pages');
  assert.equal(pages.status, 0, pages.stderr);
  const named = (ps) => ps.map((p) => p.pageName ?? p.sectionName);
  assert.ok(named(JSON.parse(pages.stdout)).some((p) => p.startsWith('Colour')), named(JSON.parse(pages.stdout)).join(', '));
  assert.ok(!named(derived).some((p) => p.startsWith('Colour')), 'the descriptor names no section Colour');
});

test('--format reads a CLAP id back as its number: the same answer read as lv2 serves other pages', () => {
  const { file, descriptor } = corpus.find((c) => c.name === 'scanned-clap-omx-eq8.json');
  const stored = fileOf(answerOf(descriptor));
  const want = run('--descriptor', file, '--pages').stdout;
  assert.equal(run('--stored', stored, '--format', 'clap', '--pages').stdout, want);
  assert.notEqual(run('--stored', stored, '--format', 'lv2', '--pages').stdout, want, 'the ids stay text when read as lv2');
});

test('a refused entry prints its code and its sentence, naming the answer\'s file, and exits 1', () => {
  const { descriptor } = corpus.find((c) => answerOf(c.descriptor).body === null);
  const answer = answerOf(descriptor);
  const stored = fileOf(answer);
  for (const extra of [[], ['--pages']]) {
    const r = run('--stored', stored, '--format', descriptor.plugin.format, ...extra);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.startsWith(`omx-panel: ${answer.refused}: `), r.stderr);
    assert.ok(r.stderr.includes(stored) && !r.stderr.includes('{plugin}'), `the plugin placeholder is the answer's file: ${r.stderr}`);
  }
});

test('describe --stored reads the answer and nothing else: every other source, and --layout, is a usage error', () => {
  const { file, descriptor } = corpus.find((c) => c.name === 'scanned-lv2-omx-eq8.json');
  const stored = fileOf(answerOf(descriptor));
  for (const args of [
    ['--stored', stored],
    ['--stored', stored, '--format', 'vst3'],
    ['--stored', stored, '--format'],
    ['--stored', '--format', 'lv2'],
    ['--stored', stored, '--format', 'lv2', '--descriptor', file],
    ['--stored', stored, '--format', 'lv2', '--panel', file],
    ['--stored', stored, '--format', 'lv2', '--ns', 'x'],
    ['--stored', stored, '--format', 'lv2', '--layout'],
    ['--stored', stored, '--format', 'lv2', '--pages', '--per-page', '0'],
    ['--stored', stored, '--format', 'lv2', '--plugin', 'lv2:urn:x', '--store'],
  ]) {
    const r = run(...args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stdout, '', args.join(' '));
  }
  assert.match(run('--stored', stored).stderr, /describe --stored <answer\.json> --format <lv2\|clap>/, 'the usage names the door');
});
