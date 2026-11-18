// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The runtime install check judges only what omx-panel itself ships. It names no plugin descriptor of another package
// (omx-plugins/omx-delay was a check pointing up a layer), and it reads the panel's own contract files from the package's
// file list, so a file the panel ships and the install lacks is red, and a list that ships nothing is red too.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const script = () => read('tools/runtime-install-check.sh');

test('the runtime install check names no omx-plugins descriptor', () => {
  assert.doesNotMatch(script(), /omx-plugins/, 'tools/runtime-install-check.sh names omx-plugins');
  assert.doesNotMatch(read('.github/workflows/ci.yml'), /omx-plugins/, 'the ci runtime-install job names omx-plugins');
});

test('the check reads the panel\'s shipped contract files from the package file list', () => {
  const s = script();
  assert.match(s, /rpm -qpl "\$PKG"/, 'the RPM file list is not read from the package');
  assert.match(s, /dpkg-deb -c "\$PKG"/, 'the DEB file list is not read from the package');
  assert.match(s, /\/usr\/share\/omx-contract\/contract\.d\//, 'the shipped list is not limited to the contract directory');
});

test('a shipped contract file that is not installed fails, and a package shipping none fails', () => {
  const s = script();
  assert.match(s, /\[ -e "\$f" \] \|\| fail/, 'no check that each shipped file is installed');
  assert.match(s, /ships no contract file/, 'no refusal of a package that ships nothing');
});

test('the sabotage arm: a planted omx-plugins descriptor demand is caught', () => {
  const planted = script().replace('expect "the descriptor', 'DESCRIPTOR=omx-plugins/omx-delay; expect "the descriptor');
  assert.match(planted, /omx-plugins/, 'the plant did not land');
});
