// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * Where store/Makefile reads the plugin-db domain whose version a new store records: <contractdir>/plugin-db/plugin-db.json,
 * the contract directory found as omx-contract's docs/contract-dir.md says ($OMX_CONTRACT_PATH, else pkg-config's
 * contractdir of libomx-domain, the omx-contract package the store builds against). A machine with neither, or with no
 * plugin-db domain in it, is refused by name, never read as the path '/plugin-db/plugin-db.json'.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { STORE, contractDir, tmp } from './helpers.mjs';

/** `make` of the generated header alone into a fresh build directory, with pkg-config reading only `pcDir`. */
function header(t, { contractPath, pcDir } = {}) {
  const b = tmp(t, 'omx-panel-store-mk-');
  const pc = pcDir ?? tmp(t, 'omx-panel-store-pc-');
  const env = { ...process.env, PKG_CONFIG_PATH: pc, PKG_CONFIG_LIBDIR: pc };
  delete env.OMX_CONTRACT_PATH;
  if (contractPath !== undefined) env.OMX_CONTRACT_PATH = contractPath;
  const r = spawnSync('make', ['-s', '-C', STORE, `B=${b}`, `${b}/schema_gen.h`], { encoding: 'utf8', env });
  return { ...r, file: join(b, 'schema_gen.h') };
}
const recorded = (file) => /#define OMX_PANEL_STORE_PLUGIN_DB_VERSION "([^"]*)"/.exec(readFileSync(file, 'utf8'))?.[1];

/** A libomx-domain.pc naming `contractdir`, as libomx-domain-devel installs it. */
function libomxDomainPc(t, contractdir) {
  const d = tmp(t, 'omx-panel-store-pc-');
  writeFileSync(join(d, 'libomx-domain.pc'), `prefix=/usr\ncontractdir=${contractdir}\n\nName: libomx-domain\nDescription: fixture\nVersion: 0.0.0\n`);
  return d;
}

test('no contract directory at all is refused by name, never read as /plugin-db/plugin-db.json', (t) => {
  const r = header(t);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /store: no contract directory: OMX_CONTRACT_PATH is unset and '.*--variable=contractdir libomx-domain' names none \(install libomx-domain-devel\)/);
  assert.doesNotMatch(r.stderr, /No rule to make target '\/plugin-db/);
});

test('a contract directory with no plugin-db domain is refused by name, naming the directory and the package', (t) => {
  const empty = tmp(t, 'omx-panel-store-cd-');
  const r = header(t, { pcDir: libomxDomainPc(t, empty) });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, new RegExp(`store: no plugin-db domain \\(plugin-db/plugin-db.json\\) in ${empty}: install plugin-db-contract`));
});

test("libomx-domain's contractdir is read: the domain's version is the one recorded", (t) => {
  const dir = contractDir(join(tmp(t, 'omx-panel-store-cd-'), 'contract.d'));
  const r = header(t, { pcDir: libomxDomainPc(t, dir) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(recorded(r.file), '1.0.0');
});

test('OMX_CONTRACT_PATH replaces pkg-config: its first directory holding the domain wins', (t) => {
  const none = tmp(t, 'omx-panel-store-cd-');
  const at = (version) => {
    const dir = contractDir(join(tmp(t, 'omx-panel-store-cd-'), 'contract.d'));
    const doc = join(dir, 'plugin-db', 'plugin-db.json');
    writeFileSync(doc, readFileSync(doc, 'utf8').replace('"version": "1.0.0"', `"version": "${version}"`));
    return dir;
  };
  const [first, second, pkgConfig] = [at('1.1.0'), at('1.2.0'), at('1.3.0')];
  const pcDir = libomxDomainPc(t, pkgConfig);
  for (const [path, want] of [[`${none}:${first}:${second}`, '1.1.0'], [`${none}:${second}:${first}`, '1.2.0'], [undefined, '1.3.0']]) {
    const r = header(t, { contractPath: path, pcDir });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(recorded(r.file), want, `OMX_CONTRACT_PATH=${path ?? '(unset)'}`);
  }
});
