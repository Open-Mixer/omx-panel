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
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { describe, describeFromStored } from '../../dist/tools/describe.mjs';
import { readPluginPorts } from '../../dist/tools/group-infer.mjs';
import { pluginTriples, planBundle, readInstalledBundle } from '../../dist/tools/lv2-complement.mjs';
import { CMD, DatabaseSync, contractDir, entry, mkStore, panelVersion, ROOT, RULES, run, snapshot, tmp } from './helpers.mjs';

const OMX_PANEL = join(ROOT, 'dist', 'bin', 'omx-panel.mjs');
const LV2 = 'http://lv2plug.in/ns/lv2core#';
const TRIPLE = 'http://plugin.org.uk/swh-plugins/triplePara';
const DELAY = 'http://plugin.org.uk/swh-plugins/delayorama';
const FIXTURES = join(ROOT, 'test', 'fixtures');
const unprivileged = process.geteuid() !== 0;
if (!unprivileged) process.stderr.write('describe-plugin.test.mjs: skipping the user-layer arms: run as root, the writer writes the system layer\n');

/** The contract directories the derivation reads (the installed ones), with the store's fixture panel and plugin-db over them. */
function contract(dir) {
  const from = (process.env.OMX_CONTRACT_PATH || '/usr/share/omx-contract/contract.d').split(':').filter(Boolean).reverse();
  for (const d of from) if (existsSync(d)) cpSync(d, dir, { recursive: true });
  return contractDir(dir);
}

/** An installed bundle: the fixture's TTL, a manifest naming it and its binary, and the binary (bytes of its own). */
function bundle(lv2, name, fixture, uri) {
  const dir = join(lv2, `${name}.lv2`);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(FIXTURES, 'lv2-groups', fixture, 'plugin.ttl'), join(dir, 'plugin.ttl'));
  writeFileSync(join(dir, `${name}.so`), `the ${name} binary\n`);
  writeFileSync(join(dir, 'manifest.ttl'), `@prefix lv2: <${LV2}> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n`
    + `<${uri}> a lv2:Plugin ; lv2:binary <${name}.so> ; rdfs:seeAlso <plugin.ttl> .\n`);
  return { dir, binary: join(dir, `${name}.so`), uri };
}

/** The descriptor a scan writes for an installed LV2 plugin, made from its ports (its id the port symbol, as a scan's): no control states a group. */
function descriptorOf(b) {
  const ports = readPluginPorts(pluginTriples(readInstalledBundle(b.dir), b.uri), b.uri).ports.filter((p) => p.control && p.input);
  return {
    plugin: { format: 'lv2', id: b.uri, uri: b.uri, name: b.uri.split('/').at(-1), vendor: 'swh' },
    origin: 'scanned',
    controls: ports.map((p) => ({ id: p.symbol, name: p.name, kind: 'travel', travel: { min: p.min ?? 0, max: p.max ?? 1, default: p.min ?? 0, unit: '', scale: 'linear' } })),
  };
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const sourceOf = (format, path) => {
  const r = run(['source', '--format', format, '--path', path]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const keysOf = (path) => {
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db.prepare('SELECT sha256, format, uri FROM plugin ORDER BY uri').all().map((r) => ({ ...r }));
  db.close();
  return rows;
};

/** A world: two bundles on the search path, their descriptors where a scan writes them, an empty base, no layer yet. */
function world(t, { descriptors = true } = {}) {
  const d = tmp(t, 'omx-panel-describe-plugin-');
  const lv2 = join(d, 'lv2');
  const triple = bundle(lv2, 'triple_para-swh', 'swh-triplepara', TRIPLE);
  const delay = bundle(lv2, 'delayorama-swh', 'swh-delayorama', DELAY);
  const scans = join(d, 'descriptors');
  mkdirSync(scans, { recursive: true });
  if (descriptors) for (const b of [triple, delay]) writeFileSync(join(scans, `${b.uri.split('/').at(-1)}.json`), JSON.stringify(descriptorOf(b)));
  const places = { base: join(d, 'share', 'panel.sqlite'), system: join(d, 'var', 'panel.sqlite'), user: join(d, 'home', 'panel.sqlite'), contract: contract(join(d, 'contract.d')) };
  mkStore(places.base, { layer: 0, panel: panelVersion(places.contract) });
  return { d, lv2, triple, delay, scans, places };
}

/** The call, with the places by the command's variables and the store command on PATH; no plugin-hostd-probe there. */
function describePlugin(w, target, extra = []) {
  const env = {
    PATH: dirname(CMD), LV2_PATH: w.lv2, DESCRIPTOR_DIRS: w.scans, HOME: join(w.d, 'nohome'),
    OMX_PANEL_STORE_BASE: w.places.base, OMX_PANEL_STORE_SYSTEM: w.places.system, OMX_PANEL_STORE_USER: w.places.user, OMX_CONTRACT_PATH: w.places.contract,
  };
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
