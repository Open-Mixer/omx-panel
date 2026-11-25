// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The runtime install check judges only what omx-panel itself ships. It names no plugin descriptor of another package
// (omx-plugins/omx-delay was a check pointing up a layer). The panel's own contract files are the omx-panel-contract
// package's (the panel domain): the check takes that package beside omx-panel, installs it, and reads its files from that
// package's file list, so a file it ships and the install lacks is red, a list that ships nothing is red, and a panel
// domain file in omx-panel itself (a second copy) is red too.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const script = () => read('tools/runtime-install-check.sh');

test('the runtime install check names no omx-plugins descriptor', () => {
  // the recommendation omx-plugins-contract (step 3) is the package's own; a descriptor of omx-plugins/ is not
  assert.doesNotMatch(script(), /omx-plugins\//, 'tools/runtime-install-check.sh demands an omx-plugins descriptor');
  assert.doesNotMatch(read('.github/workflows/ci.yml'), /omx-plugins\//, 'the ci runtime-install job demands an omx-plugins descriptor');
});

test('the check takes the contract package and reads the panel\'s contract files from its file list', () => {
  const s = script();
  assert.match(s, /^CPKG=\$\{2:\?/m, 'the contract package is not the second, required argument');
  assert.match(s, /rpm -qpl "\$CPKG"/, 'the RPM file list is not read from the contract package');
  assert.match(s, /dpkg-deb -c "\$CPKG"/, 'the DEB file list is not read from the contract package');
  assert.match(s, /\/usr\/share\/omx-contract\/contract\.d\//, 'the shipped list is not limited to the contract directory');
  assert.match(s, /install-under-test\.sh" "\$CPKG"/, 'the contract package is not installed');
});

test('a panel domain file in omx-panel itself is a second copy and fails', () => {
  assert.match(script(), /second copy/, 'no refusal of a panel domain file shipped by omx-panel itself');
});

test('ci copies the contract packages and hands both packages to the check', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /omx-panel-contract-\[0-9\]\*\.rpm/, 'the RPM build does not keep omx-panel-contract');
  assert.match(ci, /omx-panel-contract_\*_all\.deb/, 'the DEB build does not keep omx-panel-contract');
  assert.match(ci, /runtime-install-check\.sh "\$PWD\/\$pkg" "\$PWD\/\$cpkg"/, 'the runtime install is not handed the contract package');
});

test('a shipped contract file that is not installed fails, and a package shipping none fails', () => {
  const s = script();
  assert.match(s, /if \[ -e "\$f" \]; then pass .*; else fail /, 'no check that each shipped file is installed');
  assert.match(s, /ships no contract file/, 'no refusal of a package that ships nothing');
});

test('the sabotage arm: a planted omx-plugins descriptor demand is caught', () => {
  const planted = script() + '\nexpect "the descriptor omx-plugins/omx-delay" "x"\n';
  assert.match(planted, /omx-plugins\//, 'the plant did not land');
});

// omx-panel requires omx-panel-contract at its own version (packaging/omx-panel.spec, debian/control). On a version bump
// the channel holds only the previous one, so the requirement is satisfied by the contract package this build made, the
// check's second argument, installed in the same transaction, never asked of the channel (omx-panel#257: both runtime
// install cells were red with "the channel satisfies no 'omx-panel-contract >= 0.16.2-1.fc45'").
test('a requirement on the contract package is satisfied by the one this build made, installed with omx-panel', () => {
  const s = script();
  assert.match(s, /^OWN=\$\(/m, 'the check does not read the contract package\'s own name');
  assert.match(s, /\[ "\$name" = "\$OWN" \]/, 'a requirement on the contract package is asked of the channel');
  assert.match(s, /install -y -q[^\n]*"\$PKG" "\$CPKG"/, 'omx-panel is not installed with the contract package this build made');
});
