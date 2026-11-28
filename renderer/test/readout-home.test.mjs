// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Sorting pass row V22 (omx-panel#159): READOUT_RATE_HZ, the rate a readout is published and redrawn at, lives in
// omx-dsp (classic data/primitives/readout.json, rendered as OMX_READOUT_RATE_HZ in omxdsp/omxdsp_definitions.h,
// omx-dsp#123), never in omx-contract (data/primitives.json, omx_contract.h) and never as a copy here.
// (1) the home: the omx-dsp header this renderer is compiled against (pkg-config omxdsp) defines it, golden 50 Hz,
// frozen from omx-contract data/primitives.json:142 at 8155b8d; (3) no file of this tree names the item or omx-contract's
// header that held it. (2) omx-panel has no reader of the rate (plan row V22): a reader added later reads (1).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { treeGrep } from '../../test/tree-grep.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const includedir = execFileSync('pkg-config', ['--variable=includedir', 'omxdsp'], { encoding: 'utf8' }).trim();

test('(1) omx-dsp\'s header defines OMX_READOUT_RATE_HZ, 50 Hz', () => {
  const defs = readFileSync(join(includedir, 'omxdsp', 'omxdsp_definitions.h'), 'utf8');
  assert.match(defs, /^#define OMX_READOUT_RATE_HZ 50\b/m, `omx-dsp (${includedir}) does not define OMX_READOUT_RATE_HZ: it needs omx-dsp with the readout item (omx-dsp#123)`);
});

test('(3) no file of omx-panel names READOUT_RATE_HZ or omx-contract\'s header that held it, beside this test', () => {
  // read from the files, not by git grep: CI's container could not run it on a checkout another user owns ("detected
  // dubious ownership"), and a package build has no .git (#207)
  const out = treeGrep(ROOT, /READOUT_RATE_HZ|omx_contract\.h/, ['.'], ['renderer/test/readout-home.test.mjs', 'CHANGELOG.md', 'debian/changelog']);
  assert.equal(out, '', `omx-panel names the old home or a copy:\n${out}`);
});
