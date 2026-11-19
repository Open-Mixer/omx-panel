// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * tools/omx-dsp-link-check.mjs is the runtime-install job's read of the installed package: one curve answered by the
 * omx-dsp behind node_modules/@openmixer/omx-dsp. A root whose link reaches omx-dsp passes; a missing, dangling or
 * wrong link fails, naming what it found.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = join(ROOT, 'tools/omx-dsp-link-check.mjs');
const DSP = join(ROOT, 'node_modules/@openmixer/omx-dsp');

/** An install root whose node_modules/@openmixer/omx-dsp is a link to `target`, or no link when `target` is null. */
function installRoot(target) {
  const root = mkdtempSync(join(tmpdir(), 'omx-dsp-link-'));
  mkdirSync(join(root, 'node_modules/@openmixer'), { recursive: true });
  if (target) symlinkSync(target, join(root, 'node_modules/@openmixer/omx-dsp'));
  return root;
}
const run = (root) => spawnSync(process.execPath, [CHECK, root], { encoding: 'utf8' });

test('a link that reaches omx-dsp answers the compressor curve through it', () => {
  const root = installRoot(DSP);
  try {
    const r = run(root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^PASS omx-dsp curve: 0 dB in is -13\.5 dB out through /m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [name, target] of [['no link', null], ['a dangling link', '/nonexistent/omx-dsp'], ['a link to a directory with no omx-dsp', tmpdir()]]) {
  test(`${name} fails by name`, () => {
    const root = installRoot(target);
    try {
      const r = run(root);
      assert.equal(r.status, 1);
      assert.match(r.stdout, /^FAIL omx-dsp curve: /m);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
