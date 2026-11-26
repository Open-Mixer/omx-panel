// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The installed tree is a node package a consumer links as node_modules/@openmixer/omx-panel (openmixer's server build):
 * every file its package.json names, every export target and the bin, is a file the install carries, as in the npm
 * tarball. `make install` copies dist/ whole to the package directory (share/omx-panel/tools, the renderer's data
 * directory, is public), so the installed package.json names that tree, not dist/. 0.17.0 installed the source
 * package.json: every export answered ./dist/..., a path the RPM does not ship, and
 * `Cannot find module @openmixer/omx-panel/store-entry` broke the consumer's build.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAKE_FLAGS = ['PREFIX=/usr', 'BINDIR=/usr/bin', 'DATADIR=/usr/share', 'UNITDIR=/usr/lib/systemd/system', 'SYSCONFDIR=/etc'];
const PKG = 'usr/share/omx-panel';

/** Every target string under an exports entry (a string, or a conditions object, nested). */
function targets(entry) {
  if (typeof entry === 'string') return [entry];
  if (entry && typeof entry === 'object') return Object.values(entry).flatMap(targets);
  return [];
}

/** Whether `target` (relative to `dir`) names a file there; a pattern (one `*`, within one directory) needs a match. */
function present(dir, target) {
  if (!target.includes('*')) return existsSync(join(dir, target));
  const [head, tail] = target.split('*');
  assert.ok(!tail.includes('/'), `${target}: a pattern across directories`);
  const at = join(dir, head.slice(0, head.lastIndexOf('/') + 1));
  const lead = head.slice(head.lastIndexOf('/') + 1);
  return existsSync(at) && readdirSync(at).some((n) => n.length > lead.length + tail.length && n.startsWith(lead) && n.endsWith(tail));
}

/** The package directory `make install` writes, under a fresh DESTDIR; `fn` reads it before it is removed. */
function withInstalled(fn) {
  const dest = mkdtempSync(join(tmpdir(), 'omx-panel-exports-'));
  try {
    const r = spawnSync('make', ['-C', ROOT, '-o', 'build', 'install', `DESTDIR=${dest}`, ...MAKE_FLAGS], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return fn(join(dest, PKG));
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
}

test('every export target and the bin of the installed package.json is a file the install carries', () => {
  withInstalled((pkgdir) => {
    const pkg = JSON.parse(readFileSync(join(pkgdir, 'package.json'), 'utf8'));
    const named = [...Object.values(pkg.exports).flatMap(targets), ...Object.values(pkg.bin ?? {})];
    assert.ok(named.length > 40, `the installed package.json names only ${named.length} files`);
    const missing = named.filter((t) => !present(pkgdir, t));
    assert.deepEqual(missing, [], `the installed package.json names files the install does not carry: ${missing.join(', ')}`);
    // every name the source exports, the install exports: the consumer's import names are the same
    const source = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.deepEqual(Object.keys(pkg.exports), Object.keys(source.exports));
    assert.equal(pkg.version, source.version);
  });
});

test('a consumer that links the installed tree resolves @openmixer/omx-panel/store-entry and its types', () => {
  withInstalled((pkgdir) => {
    const pkg = JSON.parse(readFileSync(join(pkgdir, 'package.json'), 'utf8'));
    // resolved as the package resolves itself, through its exports map
    const req = createRequire(join(pkgdir, 'package.json'));
    const at = req.resolve(`${pkg.name}/store-entry`);
    assert.equal(at, join(pkgdir, 'tools/store-entry.mjs'));
    assert.ok(existsSync(at), `${at} is not installed`);
    // the types the consumer's tsc reads, through the same map
    assert.ok(existsSync(join(pkgdir, pkg.exports['./store-entry'].types)), 'the store codec\'s types are not installed');
    assert.equal(req.resolve(pkg.name), join(pkgdir, 'src/skin-package.js'));
  });
});
