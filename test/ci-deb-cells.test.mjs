// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Every ci job that builds, lints or installs a DEB runs on cells from Open-Mixer/.github's check-matrix, each on the
// runner of its own architecture (runs-on: matrix.cell.runner), never on a runner written by hand. A Debian container of
// one architecture cannot install the packages of another: apt picked libomxdsp-dev arm64 on an amd64 runner and dpkg
// refused it ("package architecture (arm64) does not match system (amd64)", omx-panel ci 44563540081). The set decides
// the cells (ruling D25): no hand-written arch or suite list, so no amd64 deb cell runs while the set is quick.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CI = join(dirname(fileURLToPath(import.meta.url)), '..', '.github/workflows/ci.yml');

// the jobs of a workflow, by id: the non-comment lines under each two-space key of jobs:
export function jobs(text) {
  const out = {};
  let inJobs = false;
  let id = null;
  for (const line of text.split('\n')) {
    if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
    if (!inJobs) continue;
    if (/^\S/.test(line)) { inJobs = false; id = null; continue; }
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) { id = m[1]; out[id] = []; continue; }
    if (id && !/^\s*#/.test(line)) out[id].push(line);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n')]));
}

// what is wrong with the DEB jobs of a workflow: one line per fault
export function debFaults(text) {
  const all = jobs(text);
  const faults = [];
  const checks = Object.entries(all).find(([, body]) => /actions\/check-matrix@/.test(body));
  if (!checks) faults.push('no job asks check-matrix for the cells');
  else {
    const [, body] = checks;
    if (!/x86-runner:\s*\$\{\{\s*vars\.OMX_RUNNER \|\| 'ubuntu-latest'\s*\}\}/.test(body)) faults.push(`${checks[0]}: no x86-runner of OMX_RUNNER`);
    if (/rpm-releases:.*44/.test(body)) faults.push(`${checks[0]}: Fedora 44 in the matrix`);
  }
  for (const [id, body] of Object.entries(all)) {
    if (checks && id === checks[0]) continue;
    if (!/debian:|\.deb\b|dpkg|offline-build-check\.sh deb|\bdeb-lint-check\b|kind:.*\bdeb\b/.test(body)) continue;
    if (!/^ {4}runs-on: \$\{\{ matrix\.cell\.runner \}\}\s*$/m.test(body)) faults.push(`${id}: a DEB job whose runner is not its cell's`);
    if (!/cell: \$\{\{ fromJSON\(needs\.[A-Za-z0-9_-]+\.outputs\.(deb|cells)\) \}\}/.test(body)) faults.push(`${id}: a DEB job whose cells are not check-matrix's`);
    if (/\bamd64\b|\barm64\b/.test(body)) faults.push(`${id}: a DEB job names an architecture by hand`);
    if (/debian:(bookworm|trixie|\$DEB_SUITE)/.test(body)) faults.push(`${id}: a DEB job names a Debian image by hand`);
    if (/fedora:44/.test(body)) faults.push(`${id}: Fedora 44 in a DEB job's cells`);
  }
  return faults;
}

test('every DEB job in ci.yml runs on a check-matrix cell, on that cell\'s runner', () => {
  assert.deepEqual(debFaults(readFileSync(CI, 'utf8')), []);
});

test('the check is red on a DEB job with a fixed x86 runner and on a hand amd64 cell, green on cells', () => {
  const checks = `jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: Open-Mixer/.github/.github/actions/check-matrix@openmixer-v1
        with:
          rpm-releases: '["45"]'
          x86-runner: \${{ vars.OMX_RUNNER || 'ubuntu-latest' }}
`;
  const good = `${checks}  lint:
    runs-on: \${{ matrix.cell.runner }}
    strategy: { matrix: { cell: \${{ fromJSON(needs.checks.outputs.deb) }} } }
    container: { image: '\${{ matrix.cell.image }}' }
    steps:
      - run: tools/deb-lint-check.sh out
`;
  assert.deepEqual(debFaults(good), []);
  const fixed = good.replace('runs-on: ${{ matrix.cell.runner }}', "runs-on: ${{ vars.OMX_RUNNER || 'ubuntu-latest' }}");
  assert.notEqual(fixed, good, 'the plant did not land');
  assert.match(debFaults(fixed).join('\n'), /runner is not its cell's/);
  const hand = good.replace('cell: ${{ fromJSON(needs.checks.outputs.deb) }}', "arch: [amd64, arm64]");
  assert.notEqual(hand, good, 'the plant did not land');
  assert.match(debFaults(hand).join('\n'), /names an architecture by hand/);
  assert.match(debFaults(good.replace("'[\"45\"]'", "'[\"44\", \"45\"]'")).join('\n'), /Fedora 44/);
  assert.match(debFaults(good.replace(/ {10}x86-runner.*\n/, '')).join('\n'), /no x86-runner/);
});
