// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * No version relation on a package of ours is typed by hand (a third party's, Node.js or SQLite, stays): not in the spec, debian/control or package.json's @openmixer ranges and engines,
 * nor a floor constant or pkg-config version check in a Makefile or a tool. A build uses what is installed; a relation
 * that must exist is generated (soname dependencies, `= %{version}-%{release}`, `= ${binary:Version}`). Each sabotage
 * A lower layer does not point up either: nothing here depends on omx-plugins-contract. Each sabotage
 * arm plants one in a copy and must be refused by name; the real tree must pass.
 */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// files that install or name a package of the stack in a command or a sentence: `<package> >= x.y`, `<package> (>= x.y~)`
const TEXTS = ['.github/workflows/ci.yml', '.github/workflows/release.yml', 'tools/offline-build-check.sh', 'BUILDING.md', 'docs/renderer.md',
  'renderer/omx-panel-render.pc.in', 'renderer/omx-panel-window.pc.in'];
const FILES = ['packaging/omx-panel.spec', 'debian/control', 'package.json', 'renderer/Makefile', 'store/Makefile', 'tools/modgui-gen.mjs', ...TEXTS];
const TEXT_FLOOR = /(?:omx-[a-z-]+|libomx[a-z-]*|omxdsp|plugin-[a-z-]+)["'`]?\s*\(?\s*(?:>=|<<|<=|<)\s*\d/;
// our packages, as RPM, DEB, pkg-config and npm name them
const OURS = /\b(?:lib)?(?:omx|plugin)-|\blibomx|\bomxdsp\b|@openmixer\//;
const SPEC_DEP = /^(Build)?(Requires|Recommends|Suggests|Supplements|Conflicts|Obsoletes)(\([^)]*\))?\s*:/;

/** Every typed version relation under `root`, as `file:line text`. */
export function typedFloors(root) {
  const errors = [];
  const add = (file, n, line) => errors.push(`${file}:${n + 1} ${line.trim()}`);
  const lines = (file) => readFileSync(join(root, file), 'utf8').split('\n');
  for (const [n, line] of lines('packaging/omx-panel.spec').entries()) {
    if (line === '%changelog') break;
    if (SPEC_DEP.test(line) && OURS.test(line) && (/[<>]=?/.test(line) || /=\s*\d/.test(line))) add('packaging/omx-panel.spec', n, line);
  }
  for (const [n, line] of lines('debian/control').entries())
    if (!line.startsWith('#')) for (const dep of line.split(','))
      if (OURS.test(dep) && (/\(\s*[<>]/.test(dep) || /\(\s*=\s*\d/.test(dep))) add('debian/control', n, dep);
  for (const [n, line] of lines('package.json').entries())
    if (/"(@openmixer\/[^"]+)":\s*"[^"*]*\d/.test(line)) add('package.json', n, line);
  for (const file of ['renderer/Makefile', 'store/Makefile'])
    for (const [n, line] of lines(file).entries()) if (/OMXDSP_FLOOR|(?:atleast|exact|max)-version[^\n]*\bomx/.test(line)) add(file, n, line);
  for (const [n, line] of lines('tools/modgui-gen.mjs').entries()) if (/DSP_FLOOR\b/.test(line)) add('tools/modgui-gen.mjs', n, line);
  for (const file of TEXTS) for (const [n, line] of lines(file).entries()) if (TEXT_FLOOR.test(line)) add(file, n, line);
  return errors;
}

/** Every dependency line under `root` that names omx-plugins-contract, a package above this one. */
export function upwardDeps(root) {
  const errors = [];
  for (const file of ['packaging/omx-panel.spec', 'debian/control'])
    for (const [n, line] of readFileSync(join(root, file), 'utf8').split('\n%changelog')[0].split('\n').entries())
      if (!line.startsWith('#') && line.includes('omx-plugins-contract')) errors.push(`${file}:${n + 1} ${line.trim()}`);
  return errors;
}

test('nothing depends on omx-plugins-contract', () => {
  assert.deepEqual(upwardDeps(ROOT), []);
});

for (const [file, find, plant] of [
  ['packaging/omx-panel.spec', 'Provides: bundled(nodejs-ajv)', 'Recommends: omx-plugins-contract\nProvides: bundled(nodejs-ajv)'],
  ['debian/control', 'Recommends: plugin-hostd', 'Recommends: plugin-hostd, omx-plugins-contract'],
])
  test(`a planted upward dependency in ${file} is refused`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'upward-'));
    try {
      for (const f of ['packaging/omx-panel.spec', 'debian/control']) cpSync(join(ROOT, f), join(dir, f), { recursive: true });
      const text = readFileSync(join(dir, file), 'utf8');
      assert.ok(text.includes(find), `${file}: "${find}" to plant into`);
      writeFileSync(join(dir, file), text.replace(find, plant));
      assert.equal(upwardDeps(dir).length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

test('no version relation is typed by hand', () => {
  assert.deepEqual(typedFloors(ROOT), []);
});

const PLANTS = {
  'spec floor': ['packaging/omx-panel.spec', 'BuildRequires: npm', 'BuildRequires: omx-contract >= 9\nBuildRequires: npm'],
  'spec ceiling': ['packaging/omx-panel.spec', 'BuildRequires: npm', 'BuildRequires: (omx-contract with omx-contract < 99)\nBuildRequires: npm'],
  'control floor': ['debian/control', '               npm,', '               omx-contract (>= 9~),\n               npm,'],
  'package.json range': ['package.json', '"@openmixer/omx-dsp": "*"', '"@openmixer/omx-dsp": ">=0.33.0"'],
  'Makefile version check': ['store/Makefile', '.PHONY: all check install clean', 'X := $(shell pkg-config --atleast-version=3 omxdsp)\n.PHONY: all check install clean'],
  'workflow floor': ['.github/workflows/ci.yml', 'jobs:', "# dnf install 'omx-contract >= 3.21.0'\njobs:"],
  'tool floor constant': ['tools/modgui-gen.mjs', 'import ', "const DSP_FLOOR = '>=1';\nimport "],
};
for (const [name, [file, find, plant]] of Object.entries(PLANTS))
  test(`a planted ${name} is refused`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-floors-'));
    try {
      for (const f of FILES) cpSync(join(ROOT, f), join(dir, f), { recursive: true });
      const text = readFileSync(join(dir, file), 'utf8');
      assert.ok(text.includes(find), `${file}: "${find}" to plant into`);
      const before = typedFloors(dir).length;
      writeFileSync(join(dir, file), text.replace(find, plant));
      assert.equal(typedFloors(dir).length, before + 1, `the planted ${name} was not refused`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
