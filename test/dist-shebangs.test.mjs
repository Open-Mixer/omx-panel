// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Every file dist/ (the installed tree) carries that starts with a shebang is a command copy-data makes executable:
// lintian refuses a shebang on a file that is not executable (#180 run 44843760359, "build and lint the DEB (trixie
// arm64)": script-not-executable on tools/codes-render and tools/skin-schema-words, .mjs and .d.mts).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../tools/copy-data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

test('no file of dist/ but a command starts with a shebang', () => {
  const files = readdirSync(DIST, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && /\.(mjs|mts|js)$/.test(e.name))
    .map((e) => relative(DIST, join(e.parentPath, e.name)));
  const bad = files.filter((f) => !COMMANDS.includes(f) && readFileSync(join(DIST, f), 'utf8').startsWith('#!'));
  assert.deepEqual(bad, []);
});
