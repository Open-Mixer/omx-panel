// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * OMX_PANEL_RULES_VERSION is raised by every change that moves describe's output for the same input (3.6), so a derived
 * entry stored by an older omx-panel is derived again. THIS GOLDEN IS MINIMAL: one fixture descriptor, the SHA-256 of what
 * describe makes of it, held per rules version. Changing describe's output turns it red; the way to green is to raise the
 * version in include/omx-panel/omx_panel_store.h and add the new hash under the new version. A hash recorded under an
 * earlier version stays: it is the history, and no test can stop an edit of it, only the diff shows one.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { describe } from '../../dist/tools/describe.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const rules = Number(/#define OMX_PANEL_RULES_VERSION (\d+)/.exec(readFileSync(join(ROOT, 'store/include/omx-panel/omx_panel_store.h'), 'utf8'))[1]);
const golden = JSON.parse(readFileSync(join(ROOT, 'store/test/rules-golden.json'), 'utf8'));
const descriptor = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/descriptors/scanned-lv2-lsp-compressor-mono.json'), 'utf8'));
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

test('describe of the fixture is what the golden holds for this rules version', () => {
  assert.ok(golden[String(rules)], `no hash for rules version ${rules}: raise the version and add the hash`);
  assert.equal(hash(describe(descriptor)), golden[String(rules)], `describe's output moved: raise OMX_PANEL_RULES_VERSION (now ${rules}) and record the new hash under the new version`);
});
test('the golden holds a hash for no version above the header\'s', () => {
  for (const v of Object.keys(golden)) assert.ok(Number(v) <= rules, `${v} is above ${rules}`);
});
