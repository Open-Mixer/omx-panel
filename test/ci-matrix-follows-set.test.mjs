// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Ruling D25: a CI matrix follows the release set, never a hand list. bookworm is a full cell, built and served its
// floors only by the wave-end full release; while the organisation variable OMX_RELEASE_MATRIX is quick it cannot meet a
// floor released quick-only, so a hand-written bookworm cell turns the pull request red. A workflow line that names
// bookworm outside a comment chooses it through OMX_RELEASE_MATRIX on that same line.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, '.github/workflows');

export function handBookworm(name, text) {
  return text
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*#/.test(line) && /bookworm/.test(line) && !/OMX_RELEASE_MATRIX/.test(line))
    .map(({ line, n }) => `${name}:${n}: ${line.trim()}`);
}

test('no workflow names bookworm outside the OMX_RELEASE_MATRIX switch (D25)', { skip: !existsSync(DIR) && 'no .github/workflows in this tree' }, () => {
  const bad = readdirSync(DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((f) => handBookworm(f, readFileSync(join(DIR, f), 'utf8')));
  assert.deepEqual(bad, [], 'a hand-written bookworm cell: CI follows the release set (vars.OMX_RELEASE_MATRIX)');
});

test('the check is red on a hand bookworm cell and green on the switch', () => {
  assert.equal(handBookworm('x', "      matrix:\n        suite: [bookworm, trixie]\n").length, 1);
  assert.equal(handBookworm('x', "        image: ['fedora:44', 'debian:bookworm']\n").length, 1);
  assert.equal(handBookworm('x', "        # bookworm is a full cell\n").length, 0);
  assert.equal(handBookworm('x', "        suite: ${{ fromJSON(vars.OMX_RELEASE_MATRIX == 'full' && '[\"bookworm\", \"trixie\"]' || '[\"trixie\"]') }}\n").length, 0);
});
