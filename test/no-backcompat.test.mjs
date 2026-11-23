// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas
// No backward-compatibility mechanism is left in omx-panel: no Breaks/Replaces on a language pack, no `choice` widget
// alias, no old checkout-variable name, no ignored `staged-deps` input, and no unit sheet read as one named file. Each
// check has a sabotage arm: the old thing planted in a copy of the text must be found.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** What each file may not say, as [file, pattern, what it was]. */
const FORBIDDEN = [
  ['debian/control', /^(Breaks|Replaces):/m, 'a language pack Breaks/Replaces pair'],
  ['.github/workflows/ci.yml', /^\s*moved:/m, 'a `moved:` language for the langpacks step'],
  ['tools/panel-description.mjs', /choice:\s*'selector'/, 'the `choice` widget alias'],
  ['Makefile', /FREEMIXER_DOTGITHUB|freemixer-dotgithub/, 'the old shared-checks checkout name'],
  ['.github/workflows/release.yml', /freemixer-dotgithub/, 'the old shared-checks checkout name'],
  ['.github/workflows/release.yml', /staged-deps/, 'the ignored `staged-deps` input'],
  ['tools/vocabulary.mjs', /packageDir\('omx-contract'\)/, 'the unit sheet read as one named file'],
];

const found = (text, file) => FORBIDDEN.filter(([f, re]) => f === file && re.test(text)).map(([, , what]) => what);

test('no back-compat mechanism is left in the files that carried one', () => {
  for (const file of new Set(FORBIDDEN.map(([f]) => f))) assert.deepEqual(found(read(file), file), [], file);
});

test('the check finds each old mechanism planted in a copy', () => {
  const planted = {
    'debian/control': 'Breaks: omx-panel (<< 0.13.6~)\n',
    '.github/workflows/ci.yml': '          moved: ca:0.13.6\n',
    'tools/panel-description.mjs': "const D = { choice: 'selector' };",
    'Makefile': 'X ?= $(or $(FREEMIXER_DOTGITHUB),../freemixer-dotgithub)\n',
    '.github/workflows/release.yml': "staged-deps: ${{ inputs.staged-deps }} freemixer-dotgithub",
    'tools/vocabulary.mjs': "const dir = packageDir('omx-contract');",
  };
  for (const [file, text] of Object.entries(planted)) {
    const hits = found(read(file) + '\n' + text, file);
    assert.ok(hits.length >= 1, `${file}: the planted old mechanism was not found`);
  }
  assert.equal(found(planted['.github/workflows/release.yml'], '.github/workflows/release.yml').length, 2);
});
