// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The base, built centrally (docs/descriptions-store.md section 6 and lane 5): `omx-panel base --in <inputs> --out
 * <file>` derives each input's entry and `omx-panel-store build` writes them. Reproducible: two builds of the same
 * inputs, in two directories, give the same sorted dump and the same bytes. The file is layer 0 with `built_from`, page
 * size 4096, a DELETE journal and the schema's user_version, and the reader reads each entry from it, the LV2 input
 * with the groups the complement infers over its TTL. `built_from` comes from BUILT_FROM.txt, else git, else the build is
 * refused by name. A build given its reference sets holds the base to them: every set plugin, in every format the set
 * lists, has a description with controls in it, or the build is refused and leaves no file (sabotaged: no inputs, an
 * empty set, a descriptor with no controls; and `--check` of a base that holds nothing). `omx-panel base-inputs` writes a
 * set's inputs from the set as installed, and a host with that set installed reads each plugin from the base it builds
 * without deriving. The tree's own base holds every omx-plugin, LV2 and CLAP.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { describe } from '../../dist/tools/describe.mjs';
import { planBundle, readInstalledBundle } from '../../dist/tools/lv2-complement.mjs';
import { CMD, DatabaseSync, hex, mkStore, panelVersion, run, tmp } from './helpers.mjs';
import { bundle, clapFile, contract, descriptorOf, fakeClapScan, FIXTURES, OMX_PANEL, sha256, sourceOf, TRIPLE } from './plugin-world.mjs';

const BUILT = 'b'.repeat(40);
const COMP = JSON.parse(readFileSync(join(FIXTURES, 'descriptors', 'scanned-clap-omx-comp.json'), 'utf8'));

/** An inputs directory: triplePara (its bundle, a scan's descriptor, a reference key) and omx comp (CLAP), and BUILT_FROM.txt. */
function inputs(t, { builtFrom = BUILT } = {}) {
  const d = tmp(t, 'omx-panel-base-');
  const lv2 = join(d, 'lv2');
  const b = bundle(lv2, 'triple_para-swh', 'swh-triplepara', TRIPLE);
  const root = join(d, 'base');
  const lane = join(root, 'inputs', 'swh-triplepara');
  mkdirSync(lane, { recursive: true });
  cpSync(b.dir, join(lane, 'bundle'), { recursive: true });
  writeFileSync(join(lane, 'key.json'), JSON.stringify({ sha256: hex('a'), format: 'lv2', uri: TRIPLE }));
  writeFileSync(join(lane, 'descriptor.json'), JSON.stringify(descriptorOf(b)));
  const comp = join(root, 'inputs', 'omx-comp');
  mkdirSync(comp, { recursive: true });
  writeFileSync(join(comp, 'key.json'), JSON.stringify({ sha256: hex('c'), format: 'clap', uri: COMP.plugin.id }));
  cpSync(join(FIXTURES, 'descriptors', 'scanned-clap-omx-comp.json'), join(comp, 'descriptor.json'));
  if (builtFrom !== null) writeFileSync(join(root, 'BUILT_FROM.txt'), `${builtFrom}\n`);
  return { d, root, in: join(root, 'inputs'), contract: contract(join(d, 'contract.d')), lane };
}

/** `omx-panel base`, the store command on PATH, the contract directories the derivation and the word checks read. */
function base(w, out, extra = []) {
  return omxPanel(w, ['base', '--in', w.in, '--out', out, ...extra]);
}
/** `omx-panel <args>` in world `w`, with `env` over the base environment. */
function omxPanel(w, args, env = {}) {
  const e = { PATH: dirname(CMD), HOME: join(w.d, 'nohome'), OMX_CONTRACT_PATH: w.contract, ...env };
  return spawnSync(process.execPath, [OMX_PANEL, ...args], { encoding: 'utf8', env: e, timeout: 300000 });
}
/** A set file listing the plugins `plugins` ([{ name, lv2?, clap? }]). */
function setFile(w, plugins, name = 'fixture') {
  const f = join(w.root, 'sets', `${name}.json`);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify({ set: name, plugins }));
  return f;
}
const FIXTURE_SET = [{ name: 'swh-triplepara', lv2: TRIPLE }, { name: 'omx-comp', clap: COMP.plugin.id }];

/** Every table of a store file, its rows sorted, and the pragmas a reproducible file holds. */
function dump(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
  const out = { pragmas: { user_version: db.prepare('PRAGMA user_version').get().user_version, page_size: db.prepare('PRAGMA page_size').get().page_size, journal_mode: db.prepare('PRAGMA journal_mode').get().journal_mode } };
  for (const t of tables) out[t] = db.prepare(`SELECT * FROM ${t}`).all().map((r) => JSON.stringify(r)).sort();
  db.close();
  return out;
}

test('two builds of the same inputs give the same sorted dump and the same bytes', (t) => {
  const a = inputs(t);
  const b = inputs(t);
  const fa = join(a.d, 'out', 'panel.sqlite');
  const fb = join(b.d, 'elsewhere', 'panel.sqlite');
  for (const [w, f] of [[a, fa], [b, fb]]) {
    const r = base(w, f);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  assert.deepEqual(dump(fa), dump(fb));
  assert.ok(readFileSync(fa).equals(readFileSync(fb)), 'byte-identical');
  assert.equal(dump(fa).plugin.length, 2, 'both inputs are in it');
});

test('the base is layer 0 with built_from, page size 4096, a DELETE journal and the schema\'s version; nothing beside it', (t) => {
  const w = inputs(t);
  const f = join(w.d, 'out', 'panel.sqlite');
  assert.equal(base(w, f).status, 0);
  const d = dump(f);
  assert.deepEqual(d.store_info.map((r) => JSON.parse(r)).map((r) => [r.layer, r.built_from]), [[0, BUILT]]);
  assert.deepEqual(d.pragmas, { user_version: 1, page_size: 4096, journal_mode: 'delete' });
  assert.deepEqual(spawnSync('ls', ['-A', dirname(f)], { encoding: 'utf8' }).stdout, 'panel.sqlite\n', 'no work file left beside it');
});

test('the reader reads the base: the LV2 input with the complement\'s groups, the CLAP input by its key', (t) => {
  const w = inputs(t);
  const f = join(w.d, 'out', 'panel.sqlite');
  assert.equal(base(w, f).status, 0);
  const user = join(w.d, 'home', 'panel.sqlite');
  const get = (key, source) => {
    const r = run(['get', '--base', f, '--system', join(w.d, 'var', 'panel.sqlite'), '--user', user, '--contract-dir', w.contract, '--sha256', key.sha256, '--format', key.format, '--uri', key.uri, '--source', source, '--json']);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const lv2 = get({ sha256: hex('a'), format: 'lv2', uri: TRIPLE }, sourceOf('lv2', join(w.lane, 'bundle')));
  assert.equal(lv2.layer, 'base');
  const plan = planBundle(readInstalledBundle(join(w.lane, 'bundle'))).plugins[0].verdict;
  assert.deepEqual(lv2.groups.map((g) => g.symbol).sort(), plan.groups.map((g) => g.symbol).sort());
  const clap = get({ sha256: hex('c'), format: 'clap', uri: COMP.plugin.id }, sourceOf('clap', join(w.in, 'omx-comp', 'descriptor.json')));
  assert.equal(clap.layer, 'base');
  assert.equal(clap.family, describe(COMP).description.family, 'the family describe derives');
  assert.ok(clap.body?.sections.length > 0, 'a body was stored');
  assert.equal(existsSync(user), false);
});

test('built_from: a BUILT_FROM.txt of 40 hex digits is taken; an unsubstituted one outside git is refused by name', (t) => {
  const w = inputs(t, { builtFrom: '$Format:%H$' });
  const f = join(w.d, 'out', 'panel.sqlite');
  const r = base(w, f);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /built-from-unknown/);
  assert.equal(existsSync(f), false, 'nothing written');
});

test('the tree\'s base inputs: BUILT_FROM.txt is substituted by git archive (export-subst), and the inputs directory exists', () => {
  const root = join(dirname(CMD), '..', '..');
  assert.equal(readFileSync(join(root, 'base', 'BUILT_FROM.txt'), 'utf8').trim(), '$Format:%H$');
  assert.match(readFileSync(join(root, '.gitattributes'), 'utf8'), /^base\/BUILT_FROM\.txt export-subst$/m);
  assert.ok(existsSync(join(root, 'base', 'inputs')));
});

test('a build given its set holds the base to it: every set plugin answered with a description with controls', (t) => {
  const w = inputs(t);
  const f = join(w.d, 'out', 'panel.sqlite');
  const r = base(w, f, ['--set', setFile(w, FIXTURE_SET)]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /each of the sets' 2 keys with a description with controls/);
  const c = omxPanel(w, ['base', '--in', w.in, '--check', f, '--set', setFile(w, FIXTURE_SET)]);
  assert.equal(c.status, 0, c.stderr + c.stdout);
});

test('sabotage: no inputs, the set held: the build is refused base-incomplete naming each plugin, and no file is left', (t) => {
  const w = inputs(t);
  for (const d of readdirSync(w.in)) spawnSync('rm', ['-rf', join(w.in, d)]);
  const f = join(w.d, 'out', 'panel.sqlite');
  assert.equal(base(w, f).status, 0, 'with no set an empty base is still a base');
  const r = base(w, f, ['--set', setFile(w, FIXTURE_SET)]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /base-incomplete: 2 of the sets' keys/);
  assert.match(r.stderr, new RegExp(`lv2:${TRIPLE} \\(no input\\)`));
  assert.match(r.stderr, new RegExp(`clap:${COMP.plugin.id.replace(/\./g, '\\.')} \\(no input\\)`));
  assert.equal(existsSync(f), false, 'no incomplete base is left to be packaged');
});

test('sabotage: a set that names nothing is refused, so an empty set cannot hold an empty base to nothing', (t) => {
  const w = inputs(t);
  const f = join(w.d, 'out', 'panel.sqlite');
  const r = base(w, f, ['--set', setFile(w, [])]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /names no plugin/);
  assert.equal(existsSync(f), false);
});

test('sabotage: an input whose descriptor has no controls is named: no description with controls', (t) => {
  const w = inputs(t);
  writeFileSync(join(w.in, 'omx-comp', 'descriptor.json'), JSON.stringify({ ...COMP, controls: [] }));
  const r = base(w, join(w.d, 'out', 'panel.sqlite'), ['--set', setFile(w, FIXTURE_SET)]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, new RegExp(`clap:${COMP.plugin.id.replace(/\./g, '\\.')} \\((refused [a-z.-]+|no controls)\\)`));
  assert.doesNotMatch(r.stderr, /lv2:/, 'the LV2 input is held');
});

test('sabotage: --check of a base that holds no entry (a schema-only file) is red', (t) => {
  const w = inputs(t);
  const empty = join(w.d, 'empty', 'panel.sqlite');
  mkStore(empty, { layer: 0, panel: panelVersion(w.contract), builtFrom: BUILT });
  const r = omxPanel(w, ['base', '--in', w.in, '--check', empty, '--set', setFile(w, FIXTURE_SET)]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /base-incomplete: 2 of the sets' keys .*not in the base/);
});

/** A set installed: an LV2 bundle and a CLAP file, their declarations under a package of the contract directory, a scanner. */
function installedSet(t) {
  const w = inputs(t);
  const lv2 = join(w.d, 'installed-lv2');
  const b = bundle(lv2, 'triple_para-swh', 'swh-triplepara', TRIPLE);
  const clap = clapFile(join(w.d, 'installed-clap'), 'omx-comp', COMP.plugin.id);
  const pkg = join(w.contract, 'fixture-set');
  mkdirSync(join(pkg, 'plugins'), { recursive: true });
  writeFileSync(join(pkg, 'role-meanings.json'), '{}\n');
  writeFileSync(join(pkg, 'plugins', 'swh-triplepara.json'), JSON.stringify(descriptorOf(b)));
  cpSync(join(FIXTURES, 'descriptors', 'scanned-clap-omx-comp.json'), join(pkg, 'plugins', 'omx-comp.json'));
  const bin = join(w.d, 'bin');
  fakeClapScan(bin);
  const fresh = join(w.d, 'fresh');
  mkdirSync(join(fresh, 'inputs'), { recursive: true });
  writeFileSync(join(fresh, 'BUILT_FROM.txt'), `${BUILT}\n`);
  return { ...w, lv2, b, clap, pkg, bin, fresh, PATH: `${bin}:${dirname(CMD)}` };
}
const baseInputs = (s, extra = []) => omxPanel(s, ['base-inputs', '--set', 'fixture-set', '--declarations', join(s.pkg, 'plugins'), '--base', s.fresh,
  '--lv2-path', s.lv2, '--clap-path', join(s.d, 'installed-clap'), ...extra], { PATH: s.PATH });

test('base-inputs writes a set\'s inputs from the set as installed, and a host with it installed reads the base it builds', (t) => {
  const s = installedSet(t);
  const r = baseInputs(s);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(readdirSync(join(s.fresh, 'inputs')).sort(), ['fixture-set-clap-omx-comp', 'fixture-set-lv2-swh-triplepara']);
  const lv2In = join(s.fresh, 'inputs', 'fixture-set-lv2-swh-triplepara');
  assert.deepEqual(JSON.parse(readFileSync(join(lv2In, 'key.json'), 'utf8')), { sha256: sha256(s.b.binary), format: 'lv2', uri: TRIPLE });
  assert.deepEqual(readdirSync(join(lv2In, 'bundle')).sort(), ['manifest.ttl', 'plugin.ttl'], 'the TTL files, no binary');
  const clapIn = join(s.fresh, 'inputs', 'fixture-set-clap-omx-comp');
  assert.deepEqual(JSON.parse(readFileSync(join(clapIn, 'key.json'), 'utf8')), { sha256: sha256(s.clap.path), format: 'clap', uri: COMP.plugin.id });
  assert.ok(readFileSync(join(clapIn, 'descriptor.json')).equals(readFileSync(join(s.pkg, 'plugins', 'omx-comp.json'))), 'the declaration byte for byte');
  assert.deepEqual(readdirSync(join(s.fresh, 'contract.d', 'fixture-set')), ['role-meanings.json'], 'the package\'s domain files, not its declarations');
  const set = JSON.parse(readFileSync(join(s.fresh, 'sets', 'fixture-set.json'), 'utf8'));
  assert.deepEqual(set.plugins, [{ name: 'omx-comp', clap: COMP.plugin.id }, { name: 'swh-triplepara', lv2: TRIPLE }]);

  const out = join(s.d, 'built', 'panel.sqlite');
  const b = omxPanel(s, ['base', '--in', join(s.fresh, 'inputs'), '--out', out, '--set', join(s.fresh, 'sets', 'fixture-set.json')]);
  assert.equal(b.status, 0, b.stderr + b.stdout);
  // the host: the set installed where base-inputs read it, the built base as its base, no other layer yet
  const host = { PATH: s.PATH, LV2_PATH: s.lv2, OMX_PANEL_STORE_BASE: out, OMX_PANEL_STORE_SYSTEM: join(s.d, 'host', 'system.sqlite'), OMX_PANEL_STORE_USER: join(s.d, 'host', 'user.sqlite') };
  for (const target of [`lv2:${TRIPLE}`, `clap:${s.clap.path}#${COMP.plugin.id}`]) {
    const d = omxPanel(s, ['describe', '--plugin', target, '--store'], host);
    assert.equal(d.status, 0, d.stderr);
    const answer = JSON.parse(d.stdout);
    assert.equal(answer.layer, 'base', `${target} is read from the base`);
    assert.ok(answer.controls.length > 0, `${target} has controls`);
  }
  assert.equal(existsSync(join(s.d, 'host')), false, 'nothing derived, no layer written');
});

test('base-inputs: a second run replaces the set\'s inputs; a declared plugin installed in neither format is refused', (t) => {
  const s = installedSet(t);
  mkdirSync(join(s.fresh, 'inputs', 'fixture-set-lv2-gone'), { recursive: true });
  mkdirSync(join(s.fresh, 'inputs', 'other-set-lv2-kept'), { recursive: true });
  assert.equal(baseInputs(s).status, 0);
  assert.deepEqual(readdirSync(join(s.fresh, 'inputs')).sort(), ['fixture-set-clap-omx-comp', 'fixture-set-lv2-swh-triplepara', 'other-set-lv2-kept']);
  writeFileSync(join(s.pkg, 'plugins', 'missing.json'), JSON.stringify({ plugin: { format: 'clap', id: 'org.example.missing', uri: 'urn:example:missing' }, controls: [] }));
  const r = baseInputs(s);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing is installed in no format/);
});

test('the tree\'s base holds every plugin of its sets, every omx-plugin in LV2 and CLAP, each with controls', (t) => {
  const tree = join(dirname(CMD), '..', '..', 'base');
  const sets = readdirSync(join(tree, 'sets')).filter((f) => f.endsWith('.json')).map((f) => join(tree, 'sets', f));
  assert.ok(sets.some((f) => f.endsWith('omx-plugins.json')), 'the omx-plugins set is listed');
  const omx = JSON.parse(readFileSync(join(tree, 'sets', 'omx-plugins.json'), 'utf8'));
  assert.ok(omx.plugins.length >= 30, `the omx-plugins set lists ${omx.plugins.length} plugins`);
  for (const p of omx.plugins) assert.ok(p.lv2 && p.clap, `${p.name} is listed in both formats`);
  // every input is of a set, and every set key has its input
  const keys = readdirSync(join(tree, 'inputs'), { withFileTypes: true }).filter((e) => e.isDirectory())
    .map((e) => JSON.parse(readFileSync(join(tree, 'inputs', e.name, 'key.json'), 'utf8'))).map((k) => `${k.format}:${k.uri}`).sort();
  const listed = sets.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).plugins.flatMap((p) => ['lv2', 'clap'].filter((x) => p[x]).map((x) => `${x}:${p[x]}`))).sort();
  assert.deepEqual(keys, listed);
  // built as make base builds it: the set packages' domain files in place of installed ones
  const d = tmp(t, 'omx-panel-tree-base-');
  const w = { d, in: join(tree, 'inputs'), contract: contract(join(d, 'contract.d')) };
  for (const pkg of readdirSync(join(tree, 'contract.d'))) {
    spawnSync('rm', ['-rf', join(w.contract, pkg)]);
    cpSync(join(tree, 'contract.d', pkg), join(w.contract, pkg), { recursive: true });
  }
  cpSync(w.in, join(d, 'base', 'inputs'), { recursive: true });
  writeFileSync(join(d, 'base', 'BUILT_FROM.txt'), `${BUILT}\n`);
  w.in = join(d, 'base', 'inputs');
  const r = base(w, join(d, 'out', 'panel.sqlite'), sets.flatMap((f) => ['--set', f]));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, new RegExp(`each of the sets' ${listed.length} keys with a description with controls`));
});
