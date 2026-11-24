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
