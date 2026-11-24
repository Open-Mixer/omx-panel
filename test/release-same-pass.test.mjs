// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * release-same-pass.test.mjs — release.yml passes the same-pass list to every shared build and publish call that takes
 * one. The list is the dispatch input same_pass, else .github/release-same-pass read at the commit the run builds (the
 * tag on a push). The channel-installability gate reads it to report, not fail, a breakage a package released later in
 * the same pass causes or suffers. A release.yml that calls build-rpm or build-deb without it leaves that gate blind.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = '.github/workflows/release.yml';
const SHARED = /Open-Mixer\/\.github\/\.github\/workflows\/(build-rpm|build-deb|release-c-lib|channel-installability)\.yml@/;
const PASS = 'same-pass: ${{ inputs.same_pass || needs.samepass.outputs.list }}';

/** The jobs block of a workflow, split into { name, body } per job. */
export function jobsOf(text) {
  const at = text.indexOf('\njobs:\n');
  if (at < 0) return [];
  return text
    .slice(at + '\njobs:\n'.length)
    .split(/\n(?=  [a-z][\w-]*:\n)/)
    .map((chunk) => ({ name: /^ {2}([a-z][\w-]*):/.exec(chunk)?.[1], body: chunk }))
    .filter((j) => j.name);
}

/** Problems with a release workflow's same-pass wiring; empty when it is wired as plugin-hostd wires it. */
export function samePassProblems(text) {
  const problems = [];
  const dispatch = /\n  workflow_dispatch:\n[\s\S]*?\n(?=  \w|\njobs:)/.exec(text)?.[0] ?? '';
  if (!/^      same_pass:\n        description: 'Packages other repositories release later in the same pass/m.test(dispatch)) {
    problems.push('workflow_dispatch has no same_pass input');
  }
  const jobs = jobsOf(text);
  const reader = jobs.find((j) => /^\s+sparse-checkout: \.github\/release-same-pass$/m.test(j.body));
  if (!reader) problems.push('no job reads .github/release-same-pass');
  const shared = jobs.filter((j) => SHARED.test(j.body));
  if (shared.length === 0) problems.push('no shared build or publish call found');
  for (const j of shared) {
    if (!j.body.includes(PASS)) problems.push(`${j.name} does not pass the same-pass list`);
    if (!/^ {4}needs:.*\bsamepass\b/m.test(j.body)) problems.push(`${j.name} does not wait for the samepass job`);
  }
  return problems;
}

test('release.yml reads the same-pass list and passes it to every shared build and publish call', () => {
  assert.deepEqual(samePassProblems(readFileSync(join(ROOT, RELEASE), 'utf8')), []);
});

test('the check is red on a release.yml without the wiring and green on the plugin-hostd shape', () => {
  const bare = [
    'on:',
    '  workflow_dispatch:',
    '    inputs:',
    "      staged:",
    "        type: boolean",
    'jobs:',
    '  rpm:',
    '    uses: Open-Mixer/.github/.github/workflows/build-rpm.yml@openmixer-v1',
    '    with:',
    '      staged: ${{ inputs.staged == true }}',
    '',
  ].join('\n');
  assert.ok(samePassProblems(bare).length >= 2, 'a release.yml with no same-pass wiring must be red');
  const wired = [
    'on:',
    '  workflow_dispatch:',
    '    inputs:',
    '      same_pass:',
    "        description: 'Packages other repositories release later in the same pass, space separated; empty reads .github/release-same-pass at the commit built'",
    '        type: string',
    '        default: \'\'',
    'jobs:',
    '  samepass:',
    '    runs-on: ubuntu-latest',
    '    outputs:',
    '      list: ${{ steps.read.outputs.list }}',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          sparse-checkout: .github/release-same-pass',
    '          sparse-checkout-cone-mode: false',
    '  rpm:',
    '    needs: [check, samepass]',
    '    uses: Open-Mixer/.github/.github/workflows/build-rpm.yml@openmixer-v1',
    '    with:',
    `      same-pass: ${PASS}`,
    '',
  ].join('\n');
  assert.deepEqual(samePassProblems(wired), []);
});
