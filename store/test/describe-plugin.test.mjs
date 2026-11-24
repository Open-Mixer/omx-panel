// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * `omx-panel describe --plugin <target> --store` (docs/descriptions-store.md, section 6 and lane 3): one plugin, inferred
 * once, written to the layer of the effective uid. The job, end to end through the real command and the real store: an
 * LV2 search path holding two installed bundles, the descriptors a scan wrote, an empty base; the call for one plugin
 * writes that plugin's entry to the user layer and nothing else, a second call writes nothing, a key the base holds is
 * printed and never derived, and an LV2 plugin with no pg:group is stored with the groups the complement infers and a
 * description whose sections are those groups. The store's reader is the oracle: what the call wrote, `get` reads, and
 * `describeFromStored` over that answer is what `describe` serves.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { describe, describeFromStored } from '../../dist/tools/describe.mjs';
import { planBundle, readInstalledBundle } from '../../dist/tools/lv2-complement.mjs';
import { CMD, entry, mkStore, panelVersion, RULES, run, snapshot } from './helpers.mjs';
import { DELAY, descriptorOf, FIXTURES, keysOf, OMX_PANEL, sha256, sourceOf, storeEnv, TRIPLE, world } from './plugin-world.mjs';

const unprivileged = process.geteuid() !== 0;
if (!unprivileged) process.stderr.write('describe-plugin.test.mjs: skipping the user-layer arms: run as root, the writer writes the system layer\n');

/** The call, with the places by the command's variables and the store command on PATH; no plugin-hostd-probe there. */
function describePlugin(w, target, extra = []) {
  const env = storeEnv(w);
  const r = spawnSync(process.execPath, [OMX_PANEL, 'describe', '--plugin', target, ...extra, '--store'], { encoding: 'utf8', env, timeout: 60000 });
  return { ...r, answer: r.status === 0 && r.stdout.trim() ? JSON.parse(r.stdout) : undefined };
}

/** The complement's verdict for one plugin of a bundle, as the store holds it: the rule's word, `declared` for the plugin's own. */
const WORD_OF_RULE = ['instance', 'own', 'designation', 'name', 'unit', 'index', 'modgui'];
function complementGroups(b) {
  const plan = planBundle(readInstalledBundle(b.dir)).plugins.find((p) => p.uri === b.uri);
  return { outcome: plan.verdict.outcome, groups: (plan.verdict.groups ?? []).map((g) => ({ symbol: g.symbol, name: g.name, display_priority: g.displayPriority, rule: WORD_OF_RULE[g.rule], declared: g.rule === 1 ? 1 : 0, ports: g.ports })) };
}
const bySymbol = (gs) => [...gs].sort((a, b) => (a.symbol < b.symbol ? -1 : 1));

test('describe --plugin without --store is a usage error, never a derivation that writes nothing', (t) => {
  const w = world(t);
  const r = spawnSync(process.execPath, [OMX_PANEL, 'describe', '--plugin', `lv2:${TRIPLE}`], { encoding: 'utf8', env: { PATH: dirname(CMD), LV2_PATH: w.lv2 } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--plugin <target>.*--store/);
});

test('two plugins installed: the call for one writes only its entry, to the user layer when unprivileged', { skip: !unprivileged }, (t) => {
  const w = world(t);
  const r = describePlugin(w, `lv2:${TRIPLE}`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.answer.layer, 'user', 'the answer is the user layer\'s');
  assert.deepEqual(keysOf(w.places.user), [{ sha256: sha256(w.triple.binary), format: 'lv2', uri: TRIPLE }], 'the named plugin\'s key, by its binary, and no other');
  assert.equal(existsSync(w.places.system), false, 'the system layer is never written by an unprivileged call');
});

test('a second call writes nothing: the stored entry answers, the layer is byte for byte as the first call left it', { skip: !unprivileged }, (t) => {
  const w = world(t);
  const first = describePlugin(w, `lv2:${TRIPLE}`);
  assert.equal(first.status, 0, first.stderr);
  const before = snapshot(w.places.user);
  const second = describePlugin(w, `lv2:${TRIPLE}`);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(snapshot(w.places.user), before, 'the second call wrote the layer');
  assert.deepEqual(second.answer, first.answer, 'the same entry answers both calls');
});

test('a key the base holds is printed, not derived: no descriptor exists, no layer is written', { skip: !unprivileged }, (t) => {
  const w = world(t, { descriptors: false });
  const held = entry({ sha: sha256(w.triple.binary), format: 'lv2', uri: TRIPLE, source: sourceOf('lv2', w.triple.dir), body: { family: 'eq', from: 'the base', displays: [] } });
  mkStore(w.places.base, { layer: 0, panel: panelVersion(w.places.contract), entries: [held] });
  const r = describePlugin(w, `lv2:${TRIPLE}`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.answer.layer, 'base');
  assert.deepEqual(r.answer.body, held.body, 'the base\'s body, as stored');
  assert.equal(existsSync(w.places.user), false, 'nothing was written');
  // the control: the same world without the base's entry has nothing to derive from, so a derivation would have failed
  mkStore(w.places.base, { layer: 0, panel: panelVersion(w.places.contract) });
  const none = describePlugin(w, `lv2:${TRIPLE}`);
  assert.equal(none.status, 1, 'no descriptor: the call fails when it has to derive');
  assert.match(none.stderr, /no descriptor/);
});

test('an LV2 plugin with no pg:group is stored with the complement\'s groups and a description whose sections are those groups', { skip: !unprivileged }, (t) => {
  const w = world(t);
  const want = complementGroups(w.triple);
  assert.equal(want.outcome, 'grouped', 'the fixture is one the complement groups');
  const r = describePlugin(w, `lv2:${TRIPLE}`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.answer.group_outcome, 'grouped');
  assert.deepEqual(bySymbol(r.answer.groups), bySymbol(want.groups), 'the stored groups are the complement\'s');
  assert.deepEqual(r.answer.body.sections.map((s) => s.label).sort(), want.groups.map((g) => g.name).sort(), 'one section per group, named by it');
  // the round trip: the stored entry serves what describe serves for the descriptor with those groups
  const grouped = descriptorOf(w.triple);
  const groupOf = new Map(want.groups.flatMap((g) => g.ports.map((p) => [p, g.name])));
  for (const c of grouped.controls) if (groupOf.has(c.id)) c.group = [groupOf.get(c.id)];
  const stored = { plugin: TRIPLE, body: r.answer.body, controls: r.answer.controls, groups: r.answer.groups_json };
  for (const width of [{}, { perPage: 4 }]) assert.deepEqual(describeFromStored(stored, width).description, describe(grouped, width).description, JSON.stringify(width));
});

test('a CLAP plugin: the key by its binary, the entry round-trips through the store to what describe serves', { skip: !unprivileged }, async (t) => {
  const w = world(t);
  const file = join(FIXTURES, 'descriptors', 'scanned-clap-omx-comp.json');
  const descriptor = JSON.parse(readFileSync(file, 'utf8'));
  const binary = join(w.d, 'clap', 'omx-comp.clap');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, 'the omx-comp binary\n');
  const r = describePlugin(w, `clap:${binary}#${descriptor.plugin.id}`, ['--descriptor', file]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(keysOf(w.places.user), [{ sha256: sha256(binary), format: 'clap', uri: descriptor.plugin.id }]);
  assert.equal(r.answer.group_outcome, null, 'CLAP states no port groups: no verdict');
  const { storedOf } = await import('../../dist/tools/store-entry.mjs');
  for (const width of [{}, { perPage: 4 }]) assert.deepEqual(describeFromStored(storedOf(r.answer, 'clap'), width).description, describe(descriptor, width).description, JSON.stringify(width));
});

test('--sha256 given is the key, the binary is not hashed', { skip: !unprivileged }, (t) => {
  const w = world(t);
  const given = 'c'.repeat(64);
  const r = describePlugin(w, `lv2:${DELAY}`, ['--sha256', given]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(keysOf(w.places.user), [{ sha256: given, format: 'lv2', uri: DELAY }]);
});

test('the fixture world holds two plugins, so "only the named one" has another to leave out', (t) => {
  const w = world(t);
  assert.equal(readdirSync(w.lv2).length, 2);
  assert.equal(readdirSync(w.scans).length, 2);
});

test('omx-panel-store rules prints the header\'s OMX_PANEL_RULES_VERSION, the rules a derived entry is put with', () => {
  const r = run(['rules']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${RULES}\n`);
  assert.equal(run(['rules', '--json']).status, 2, 'rules takes no flag');
});
