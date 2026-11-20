// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * gui-stage.test.mjs — `omx-panel gui-stage --set <file> --descriptors <dir> --package <name> --out <dir>` (docs/descriptions-store.md
 * 6, owner decision 2026-11-19): the generated GUI files of a KNOWN plugin set are staged, KEY-GATED, for a host to activate.
 * Per plugin of the set (one installed bundle path per line) it writes <out>/<package>/<sha256 of the binary>/modgui/ and one
 * <out>/<package>/keys.json naming, per plugin, the binary's sha256, its format and uri and the hash of every staged file.
 * The bytes are deterministic: two builds give the same tree. A path of the set that is no installed bundle is a named error.
 * Held by value, each rule with an arm that breaks its input and reads the result change.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PANEL = join(ROOT, 'dist/bin/omx-panel.mjs');
const example = (name) => createRequire(import.meta.url).resolve(`@openmixer/omx-contract/examples/descriptors/${name}`);
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** An installed LV2 bundle: manifest, plugin ttl, a fake binary with the given bytes. */
function bundle(dir, stem, uri, name, bytes) {
  const b = join(dir, `${stem}.lv2`);
  mkdirSync(b, { recursive: true });
  writeFileSync(join(b, 'manifest.ttl'), `@prefix lv2: <http://lv2plug.in/ns/lv2core#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
<${uri}> a lv2:Plugin ; lv2:binary <${stem}.so> ; rdfs:seeAlso <${stem}.ttl> .
`);
  writeFileSync(join(b, `${stem}.ttl`), `@prefix lv2: <http://lv2plug.in/ns/lv2core#> .
@prefix doap: <http://usefulinc.com/ns/doap#> .
<${uri}> a lv2:Plugin ; doap:name "${name}" ;
  lv2:port [ a lv2:InputPort , lv2:ControlPort ; lv2:index 0 ; lv2:symbol "gain" ; lv2:name "Gain" ;
             lv2:default 0.0 ; lv2:minimum -40.0 ; lv2:maximum 20.0 ] .
`);
  writeFileSync(join(b, `${stem}.so`), bytes);
  return b;
}

/** The descriptor of `uri` in a directory of descriptors (the scanned compressor with one control). */
function descriptor(dir, uri, name) {
  const d = JSON.parse(readFileSync(example('scanned-lv2-compressor.json'), 'utf8'));
  d.plugin.id = uri;
  d.plugin.uri = uri;
  d.plugin.name = name;
  delete d.plugin.vendor;
  d.controls = d.controls.filter((c) => c.id === 'makeup');
  writeFileSync(join(dir, `${name.replace(/\W+/g, '-')}.json`), JSON.stringify(d));
}

function rig(binary = Buffer.from('fake plugin binary one')) {
  const dir = mkdtempSync(join(tmpdir(), 'omx-gui-stage-'));
  const r = { dir, lv2: join(dir, 'lv2'), desc: join(dir, 'desc') };
  for (const d of [r.lv2, r.desc]) mkdirSync(d, { recursive: true });
  r.bundle = bundle(r.lv2, 'testgain', 'urn:test:gain', 'Test Gain', binary);
  descriptor(r.desc, 'urn:test:gain', 'Test Gain');
  r.set = join(dir, 'set.txt');
  writeFileSync(r.set, `# the known set\n${r.bundle}\n\n`);
  r.stage = (out, extra = []) => spawnSync(process.execPath, [PANEL, 'gui-stage', '--set', r.set, '--descriptors', r.desc, '--package', 'testpkg', '--out', out, ...extra], { encoding: 'utf8' });
  return r;
}

const tree = (root) => {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(root, p)] = sha(readFileSync(p));
    }
  };
  walk(root);
  return out;
};

test('a plugin of the set is staged under the sha256 of its binary, with a keys.json that names it', () => {
  const r = rig();
  const out = join(r.dir, 'out');
  const run = r.stage(out);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const key = sha(Buffer.from('fake plugin binary one'));
  const keys = JSON.parse(readFileSync(join(out, 'testpkg', 'keys.json'), 'utf8'));
  assert.equal(keys.package, 'testpkg');
  assert.equal(keys.plugins.length, 1);
  const [p] = keys.plugins;
  assert.deepEqual([p.sha256, p.format, p.uri], [key, 'lv2', 'urn:test:gain']);
  for (const f of ['modgui.ttl']) assert.ok(existsSync(join(out, 'testpkg', key, 'modgui', f)), f);
  assert.ok(readdirSync(join(out, 'testpkg', key, 'modgui', 'modgui')).some((f) => f.startsWith('icon-')), 'the icon');
  // every staged file is hashed in keys.json, and the hash is the file's
  const staged = tree(join(out, 'testpkg', key, 'modgui'));
  assert.deepEqual(p.formats.modgui.files, staged);
  assert.equal(keys.look, 'vintage');
});

test('the bytes are deterministic: two builds into two places give the same tree', () => {
  const r = rig();
  const a = join(r.dir, 'a');
  const b = join(r.dir, 'b');
  assert.equal(r.stage(a).status, 0);
  assert.equal(r.stage(b).status, 0);
  assert.deepEqual(tree(a), tree(b));
});

test('another binary is another key: the staged directory is named by the binary, not by the uri', () => {
  const one = rig(Buffer.from('fake plugin binary one'));
  const two = rig(Buffer.from('fake plugin binary two'));
  assert.equal(one.stage(join(one.dir, 'o')).status, 0);
  assert.equal(two.stage(join(two.dir, 'o')).status, 0);
  const keyOf = (r) => JSON.parse(readFileSync(join(r.dir, 'o', 'testpkg', 'keys.json'), 'utf8')).plugins[0].sha256;
  assert.notEqual(keyOf(one), keyOf(two));
  assert.equal(keyOf(two), sha(Buffer.from('fake plugin binary two')));
});

test('a look other than the default is recorded in keys.json and wears in the staged files', () => {
  const r = rig();
  const vintage = join(r.dir, 'v');
  const consoleLook = join(r.dir, 'c');
  assert.equal(r.stage(vintage).status, 0);
  const run = r.stage(consoleLook, ['--look', 'console']);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(JSON.parse(readFileSync(join(consoleLook, 'testpkg', 'keys.json'), 'utf8')).look, 'console');
  assert.notDeepEqual(tree(vintage), tree(consoleLook));
});

test('a path of the set that is no installed bundle is a named error and stages nothing', () => {
  const r = rig();
  writeFileSync(r.set, `${r.bundle}\n${join(r.dir, 'nowhere.lv2')}\n`);
  const out = join(r.dir, 'out');
  const run = r.stage(out);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /nowhere\.lv2/);
  assert.equal(existsSync(join(out, 'testpkg')), false, 'nothing is staged when the set is refused');
});

test('a plugin with no descriptor in --descriptors is named, and the others are still staged', () => {
  const r = rig();
  bundle(r.lv2, 'other', 'urn:test:other', 'Other', Buffer.from('other binary'));
  writeFileSync(r.set, `${r.bundle}\n${join(r.lv2, 'other.lv2')}\n`);
  const out = join(r.dir, 'out');
  const run = r.stage(out);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /urn:test:other: no descriptor/);
  const keys = JSON.parse(readFileSync(join(out, 'testpkg', 'keys.json'), 'utf8'));
  assert.deepEqual(keys.plugins.map((p) => p.uri), ['urn:test:gain']);
});
