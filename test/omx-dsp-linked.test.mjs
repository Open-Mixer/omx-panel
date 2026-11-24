// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The curve function comes from the packaged omx-dsp-wasm (omx-panel#114): the package depends on it with a floor, ships
 * no copy of @openmixer/omx-dsp among its vendored node_modules, and carries one symlink, node_modules/@openmixer/omx-dsp
 * -> /usr/share/omx-dsp, where that package installs its dist/ and wasm/.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readdirSync, readlinkSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareVersions, packagingFloor, re } from './packaging-floors.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAKE_FLAGS = ['PREFIX=/usr', 'BINDIR=/usr/bin', 'DATADIR=/usr/share', 'UNITDIR=/usr/lib/systemd/system', 'SYSCONFDIR=/etc'];
const LINK = 'usr/share/omx-panel/node_modules/@openmixer/omx-dsp';

/** Every path under `dir`, relative to it, a symlink counted as one entry and never followed. */
function walk(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? [relative(base, p) + '/', ...walk(p, base)] : [relative(base, p)];
  });
}

/** What `make install` puts under node_modules/@openmixer/omx-dsp, by the Makefile at `root`. */
export function installedUnderDsp(root) {
  const dest = mkdtempSync(join(tmpdir(), 'omx-dsp-linked-'));
  try {
    const r = spawnSync('make', ['-C', root, '-o', 'build', 'install', `DESTDIR=${dest}`, ...MAKE_FLAGS], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const parent = join(dest, dirname(LINK));
    const entries = walk(parent).filter((p) => p === 'omx-dsp' || p.startsWith('omx-dsp/'));
    const link = lstatSync(join(dest, LINK), { throwIfNoEntry: false });
    return { entries, target: link?.isSymbolicLink() ? readlinkSync(join(dest, LINK)) : null };
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
}

test('the package ships no file of @openmixer/omx-dsp: one link to /usr/share/omx-dsp', () => {
  const { entries, target } = installedUnderDsp(ROOT);
  assert.deepEqual(entries, ['omx-dsp']);
  assert.equal(target, '/usr/share/omx-dsp');
});

test('the spec and debian/control depend on omx-dsp-wasm with the floor of the release that exports loadCurve', () => {
  // the release that exports loadCurve: package.json's npm floor (it follows the npm publish); the packages' floor is the
  // spec's (packaging-floors.mjs), at or above it, and debian/control states the same one
  const loadCurve = /"@openmixer\/omx-dsp":\s*">=([0-9.]+)"/.exec(readFileSync(join(ROOT, 'package.json'), 'utf8'))[1];
  const floor = packagingFloor('omx-dsp-wasm');
  assert.ok(compareVersions(floor, loadCurve) >= 0, `the spec floors omx-dsp-wasm at ${floor}, below ${loadCurve}, the release that exports loadCurve`);
  const control = readFileSync(join(ROOT, 'debian/control'), 'utf8');
  const depends = /^Package: omx-panel\n(?:.*\n)*?Depends:(.*(?:\n[ \t].*)*)/m.exec(control)[1];
  assert.match(depends, new RegExp(`omx-dsp-wasm \\(>= ${re(floor)}~\\)`));
});
