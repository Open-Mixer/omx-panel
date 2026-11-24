// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The base, built centrally (docs/descriptions-store.md section 6 and lane 5): `omx-panel base --in <inputs> --out
 * <file>` derives each input's entry and `omx-panel-store build` writes them. Reproducible: two builds of the same
 * inputs, in two directories, give the same sorted dump and the same bytes. The file is layer 0 with `built_from`, page
 * size 4096, a DELETE journal and the schema's user_version, and the reader reads each entry from it, the LV2 input
 * with the groups the complement infers over its TTL. `built_from` comes from BUILT_FROM, else git, else the build is
 * refused by name.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { planBundle, readInstalledBundle } from '../../dist/tools/lv2-complement.mjs';
import { CMD, DatabaseSync, hex, run, tmp } from './helpers.mjs';
import { contract, descriptorOf, FIXTURES, OMX_PANEL, sourceOf, TRIPLE, bundle } from './plugin-world.mjs';

const BUILT = 'b'.repeat(40);
const COMP = JSON.parse(readFileSync(join(FIXTURES, 'descriptors', 'scanned-clap-omx-comp.json'), 'utf8'));

/** An inputs directory: triplePara (its bundle, a scan's descriptor, a reference key) and omx comp (CLAP), and BUILT_FROM. */
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
  if (builtFrom !== null) writeFileSync(join(root, 'BUILT_FROM'), `${builtFrom}\n`);
  return { d, root, in: join(root, 'inputs'), contract: contract(join(d, 'contract.d')), lane };
}

/** `omx-panel base`, the store command on PATH, the contract directories the derivation and the word checks read. */
function base(w, out) {
  const env = { PATH: dirname(CMD), HOME: join(w.d, 'nohome'), OMX_CONTRACT_PATH: w.contract };
  return spawnSync(process.execPath, [OMX_PANEL, 'base', '--in', w.in, '--out', out], { encoding: 'utf8', env, timeout: 120000 });
}

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
  assert.equal(clap.family, 'dynamics');
  assert.equal(existsSync(user), false);
});

test('built_from: a BUILT_FROM of 40 hex digits is taken; an unsubstituted one outside git is refused by name', (t) => {
  const w = inputs(t, { builtFrom: '$Format:%H$' });
  const f = join(w.d, 'out', 'panel.sqlite');
  const r = base(w, f);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /built-from-unknown/);
  assert.equal(existsSync(f), false, 'nothing written');
});

test('the tree\'s base inputs: BUILT_FROM is substituted by git archive (export-subst), and the inputs directory exists', () => {
  const root = join(dirname(CMD), '..', '..');
  assert.equal(readFileSync(join(root, 'base', 'BUILT_FROM'), 'utf8').trim(), '$Format:%H$');
  assert.match(readFileSync(join(root, '.gitattributes'), 'utf8'), /^base\/BUILT_FROM export-subst$/m);
  assert.ok(existsSync(join(root, 'base', 'inputs')));
});
