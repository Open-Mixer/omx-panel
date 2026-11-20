// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * workflows-fedora45.test.mjs — Fedora 44 is out (the channel's omx-contract >= 3.20.2 is built for fc45 only): no workflow
 * runs a job in a fedora:44 image or builds for fc44. Run 44654812092 (release.yml dry run, 'Prove the release') and run
 * 44654801317 (ci.yml) died at `No match for argument: omx-contract-data >= 3.20.2` in every fedora:44 container.
 * The arm: a planted fedora:44 line is read.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const WF = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');
const FEDORA44 = /fedora:44\b|\bfc44\b/;
export const faults = (files) => files.flatMap(({ name, text }) => text.split('\n').flatMap((l, i) => (FEDORA44.test(l.replace(/^\s*#.*/, '')) ? [`${name}:${i + 1}: ${l.trim()}`] : [])));
const files = readdirSync(WF).filter((n) => /\.ya?ml$/.test(n)).map((name) => ({ name, text: readFileSync(join(WF, name), 'utf8') }));

test('no workflow job runs in a fedora:44 image or builds for fc44', () => {
  assert.ok(files.length > 0);
  assert.deepEqual(faults(files), []);
});
test('arm: a planted fedora:44 image is read', () => {
  assert.equal(faults([{ name: 'x.yml', text: 'jobs:\n  a:\n    container:\n      image: fedora:44\n' }]).length, 1);
  assert.equal(faults([{ name: 'x.yml', text: '# fedora:44 was here\n      image: fedora:45\n' }]).length, 0);
});
