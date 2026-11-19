// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The floors-only guard (issue 65, the owner's rule): a dependency on one of ours states a floor and no ceiling, and
 * omx-panel never recommends omx-plugins-contract, because a lower layer does not point up at omx-plugins. This reads
 * the spec's dependency lines (before %changelog) and debian/control's dependency fields and refuses a ceiling
 * (`with X <`, `<<`, `<=`, `<`) or a Recommends on omx-plugins-contract. Each sabotage arm plants one in a copy of the
 * packaging and must be refused; the real tree must pass.
 */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DEP = /^(Build)?(Requires|Recommends)\s*:/;
const DEP_FIELD = /^(Build-Depends|Depends|Pre-Depends|Recommends|Suggests)\s*:/;
const CEILING = /<=?\s*\d/;

/** Every floors-only violation under `root`: a ceiling on a dependency, or a Recommends on omx-plugins-contract. */
export function floorErrors(root) {
  const errors = [];
  const spec = readFileSync(join(root, 'packaging/omx-panel.spec'), 'utf8').split('\n%changelog')[0].split('\n');
  for (const line of spec) {
    if (!SPEC_DEP.test(line)) continue;
    if (CEILING.test(line)) errors.push(`packaging/omx-panel.spec states a ceiling: ${line.trim()}`);
    if (line.includes('omx-plugins-contract')) errors.push(`packaging/omx-panel.spec recommends omx-plugins-contract: ${line.trim()}`);
  }
  let inDeps = false;
  for (const line of readFileSync(join(root, 'debian/control'), 'utf8').split('\n')) {
    if (/^\S/.test(line)) inDeps = DEP_FIELD.test(line);
    if (!inDeps) continue;
    if (CEILING.test(line)) errors.push(`debian/control states a ceiling: ${line.trim()}`);
    if (line.includes('omx-plugins-contract')) errors.push(`debian/control recommends omx-plugins-contract: ${line.trim()}`);
  }
  return errors;
}

test('omx-panel states floors only and never recommends omx-plugins-contract', () => {
  assert.deepEqual(floorErrors(ROOT), []);
});

// each arm: the file, the text to find (must occur once), and the text that plants the violation
const PLANTS = {
  'spec ceiling with on contract-data': ['packaging/omx-panel.spec', 'BuildRequires: omx-contract-data >= 3.20.0', 'BuildRequires: (omx-contract-data >= 3.20.0 with omx-contract-data < 4)'],
  'spec ceiling on the plugin-hostd Recommends': ['packaging/omx-panel.spec', 'Recommends: plugin-hostd >= 0.20.7', 'Recommends: (plugin-hostd >= 0.20.7 with plugin-hostd < 0.21)'],
  'spec upward Recommends on omx-plugins-contract': ['packaging/omx-panel.spec', 'Provides: bundled(nodejs-ajv)', 'Recommends: omx-plugins-contract >= 0.19.3\nProvides: bundled(nodejs-ajv)'],
  'control << ceiling': ['debian/control', 'omx-contract-data (>= 3.20.0~) <!nocheck>,', 'omx-contract-data (>= 3.20.0~), omx-contract-data (<< 4~) <!nocheck>,'],
  'control <= ceiling': ['debian/control', 'plugin-hostd-contract (>= 0.20.7~), omx-dsp-wasm', 'plugin-hostd-contract (>= 0.20.7~), plugin-hostd-contract (<= 0.21~), omx-dsp-wasm'],
  'control < ceiling': ['debian/control', 'Recommends: plugin-hostd (>= 0.20.7~)', 'Recommends: plugin-hostd (>= 0.20.7~), plugin-hostd (< 0.21~)'],
  'control upward Recommends on omx-plugins-contract': ['debian/control', 'Recommends: plugin-hostd (>= 0.20.7~)', 'Recommends: plugin-hostd (>= 0.20.7~), omx-plugins-contract (>= 0.19.3~)'],
};

for (const [name, [file, find, plant]] of Object.entries(PLANTS)) {
  test(`a planted ${name} is refused`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'floors-only-'));
    try {
      for (const d of ['packaging', 'debian']) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
      const text = readFileSync(join(dir, file), 'utf8');
      assert.equal(text.split(find).length - 1, 1, `${file}: "${find}" must occur once to plant into`);
      writeFileSync(join(dir, file), text.replace(find, plant));
      assert.ok(floorErrors(dir).length > 0, `the planted ${name} was not refused`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
