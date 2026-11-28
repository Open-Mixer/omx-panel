// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Debian is trixie only (owner ruling 2026-11-28, "we don't do bookworm"; it supersedes D25, where bookworm was a full
// cell chosen through OMX_RELEASE_MATRIX). No workflow line outside a comment names bookworm, the switch included.
// The same rule runs in every repository from Open-Mixer/.github's public-sources-check (retired-debian-check); this
// copy holds the line until that check reaches this repository through openmixer-v1, and goes with it then.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, '.github/workflows');

export function namesBookworm(name, text) {
  return text
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*#/.test(line) && /bookworm/i.test(line.replace(/\s#.*$/, '')))
    .map(({ line, n }) => `${name}:${n}: ${line.trim()}`);
}

test('no workflow names bookworm (Debian is trixie only)', { skip: !existsSync(DIR) && 'no .github/workflows in this tree' }, () => {
  const bad = readdirSync(DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((f) => namesBookworm(f, readFileSync(join(DIR, f), 'utf8')));
  assert.deepEqual(bad, [], 'a workflow names bookworm: Debian is trixie only (owner ruling 2026-11-28)');
});

test('the check is red on any bookworm, the OMX_RELEASE_MATRIX switch included, and green on a comment', () => {
  assert.equal(namesBookworm('x', "      matrix:\n        suite: [bookworm, trixie]\n").length, 1);
  assert.equal(namesBookworm('x', "        image: ['fedora:45', 'debian:bookworm']\n").length, 1);
  assert.equal(namesBookworm('x', "        deb-releases: ${{ vars.OMX_RELEASE_MATRIX == 'full' && '[\"bookworm\", \"trixie\"]' || '[\"trixie\"]' }}\n").length, 1);
  assert.equal(namesBookworm('x', "        # bookworm was a full cell\n").length, 0);
  assert.equal(namesBookworm('x', "        suite: [trixie] # no bookworm\n").length, 0);
});
