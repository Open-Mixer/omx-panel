// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The build of the RPM and the DEB runs the suite (%check, dh_auto_test) where the omx-contract CLI and omx-dsp's packaged
// curve module must already be installed: the spec and the control name both as build dependencies, and the test run
// exports OMX_CONTRACT_CLI to the CLI's installed path. No vendored copy of the omx-dsp twin is kept in the tree: the
// packaged omx-dsp-wasm is the one source. Each check has a sabotage arm: the same text with the line removed is red.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { packagingFloor, re } from './packaging-floors.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const CLI = '/usr/lib/omx-contract/bin/omx-contract.mjs';
// the floors the spec's main package states (packaging-floors.mjs): the build dependencies must say the same
const WASM_FLOOR = packagingFloor('omx-dsp-wasm');
const CONTRACT_FLOOR = packagingFloor('omx-contract');

/** The body of the spec's %check section (to the next section header). */
function specCheck(spec) {
  const m = spec.match(/^%check\n([\s\S]*?)(?=^%\w|(?![\s\S]))/m);
  return m ? m[1] : '';
}

/** The body of debian/rules' override_dh_auto_test target (to the next target). */
function rulesTest(rules) {
  const m = rules.match(/^override_dh_auto_test:\n([\s\S]*?)(?=^[\w.-]+:|(?![\s\S]))/m);
  return m ? m[1] : '';
}

/** The Build-Depends field of debian/control's source stanza, as its entries. */
function buildDepends(control) {
  const m = control.match(/^Build-Depends:([\s\S]*?)(?=^\S)/m);
  return m ? m[1].replace(/\n\s+/g, ' ').split(',').map((s) => s.trim()).filter(Boolean) : [];
}

test('the spec builds against the omx-contract CLI package and the packaged omx-dsp-wasm at its floor', () => {
  const spec = read('packaging/omx-panel.spec');
  assert.match(spec, new RegExp(`^BuildRequires: omx-contract >= ${re(CONTRACT_FLOOR)}$`, 'm'), `the spec lacks BuildRequires: omx-contract >= ${CONTRACT_FLOOR} (the CLI formats and validates the panel domain from that floor)`);
  assert.match(spec, new RegExp(`^BuildRequires: omx-dsp-wasm >= ${re(WASM_FLOOR)}$`, 'm'),
    `the spec lacks BuildRequires: omx-dsp-wasm >= ${WASM_FLOOR}`);
});

test('the spec %check exports OMX_CONTRACT_CLI to the installed CLI', () => {
  assert.ok(specCheck(read('packaging/omx-panel.spec')).includes(`OMX_CONTRACT_CLI=${CLI}`),
    `the %check section does not export OMX_CONTRACT_CLI=${CLI}`);
});

test('the DEB build-depends on omx-contract and omx-dsp-wasm at its floor', () => {
  const deps = buildDepends(read('debian/control'));
  assert.ok(deps.includes(`omx-contract (>= ${CONTRACT_FLOOR}~)`), `Build-Depends has no omx-contract (>= ${CONTRACT_FLOOR}~): ${deps.join(' | ')}`);
  assert.ok(deps.includes(`omx-dsp-wasm (>= ${WASM_FLOOR}~)`), `Build-Depends has no omx-dsp-wasm (>= ${WASM_FLOOR}~): ${deps.join(' | ')}`);
});

test('debian/rules exports OMX_CONTRACT_CLI for the test run', () => {
  assert.ok(rulesTest(read('debian/rules')).includes(`OMX_CONTRACT_CLI=${CLI}`),
    `override_dh_auto_test does not export OMX_CONTRACT_CLI=${CLI}`);
});

test('no vendored copy of the omx-dsp twin is kept in the tree', () => {
  const spec = read('packaging/omx-panel.spec');
  const control = read('debian/control');
  assert.doesNotMatch(spec + control, /vendor\w*\/omx-dsp|omx-dsp.*vendor/i, 'the packaging names a vendored omx-dsp');
});

test('the sabotage arm: a spec without the CLI build dependency is red', () => {
  const line = new RegExp(`^BuildRequires: omx-contract >= ${re(CONTRACT_FLOOR)}$`, 'm');
  assert.match(read('packaging/omx-panel.spec'), line, 'the plant needs the line to remove');
  const spec = read('packaging/omx-panel.spec').replace(new RegExp(`^BuildRequires: omx-contract >= ${re(CONTRACT_FLOOR)}\n`, 'm'), '');
  assert.doesNotMatch(spec, line);
  const control = read('debian/control').replace(`omx-dsp-wasm (>= ${WASM_FLOOR}~)`, '');
  assert.equal(buildDepends(control).some((d) => d.startsWith('omx-dsp-wasm')), false);
});

// omx-panel#118: ci.yml's package jobs prove the build dependencies: the RPM job installs them with `dnf builddep` on the
// spec and lets rpmbuild check them (no --nodeps); the DEB job installs them with `apt-get build-dep` on the source and
// lets dpkg-buildpackage check them (no -d). A floor the channel does not serve is red there, never built around.
/** The text of one ci.yml job (from its key to the next job key), its comment lines left out. */
function ciJob(ci, key) {
  const m = ci.match(new RegExp(`^  ${key}:\\n([\\s\\S]*?)(?=^  [\\w-]+:\\n|(?![\\s\\S]))`, 'm'));
  return m ? m[1].split('\n').filter((l) => !/^\s*#/.test(l)).join('\n') : '';
}
/** What makes a package job skip its build dependencies, by name. */
function skipsBuildDeps(ci) {
  const out = [];
  const rpm = ciJob(ci, 'packages');
  const deb = ciJob(ci, 'packages-deb');
  if (!rpm || !deb) out.push('ci.yml has no packages or packages-deb job');
  if (/rpmbuild[^\n]*--nodeps/.test(rpm)) out.push('packages: rpmbuild --nodeps');
  if (!/dnf builddep[^\n]*packaging\/omx-panel\.spec/.test(rpm)) out.push('packages: no dnf builddep on the spec');
  if (/dpkg-buildpackage[^\n]*\s-d(\s|$)/.test(deb)) out.push('packages-deb: dpkg-buildpackage -d');
  if (!/apt-get[^\n]*build-dep/.test(deb)) out.push('packages-deb: no apt-get build-dep');
  return out;
}

test('ci.yml\'s package jobs resolve and check the build dependencies (#118)', () => {
  assert.deepEqual(skipsBuildDeps(read('.github/workflows/ci.yml')), []);
});

test('the sabotage arm: a package job built with --nodeps or -d is red (#118)', () => {
  const ci = read('.github/workflows/ci.yml');
  const rpm = ci.replace(/rpmbuild -bb /, 'rpmbuild -bb --nodeps ');
  assert.notEqual(rpm, ci, 'the plant did not land');
  assert.ok(skipsBuildDeps(rpm).includes('packages: rpmbuild --nodeps'));
  const deb = ci.replace(/dpkg-buildpackage -b /, 'dpkg-buildpackage -d -b ');
  assert.notEqual(deb, ci, 'the plant did not land');
  assert.ok(skipsBuildDeps(deb).includes('packages-deb: dpkg-buildpackage -d'));
});
