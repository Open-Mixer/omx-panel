// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The deb: every file omx-panel-contract ships (debian/omx-panel-contract.install, taken from debian/tmp) is moved
// there by debian/rules out of the omx-panel tree `make install` writes, or dh_install aborts on missing files (#180,
// run 44839463463, "build with no network (deb trixie arm64)": the gestures domain and omxdomain/panel_codes.h).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rules = readFileSync(join(ROOT, 'debian/rules'), 'utf8');
const shipped = readFileSync(join(ROOT, 'debian/omx-panel-contract.install'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));

test('debian/rules moves every file omx-panel-contract ships into debian/tmp', () => {
  for (const path of shipped) {
    const p = path.replace(/\/$/, '');
    const moved = rules.split('\n').some((l) => /^\tmv /.test(l) && l.includes(`debian/omx-panel/${p}`) && l.includes('debian/tmp/'));
    assert.ok(moved, `debian/rules does not move ${p} from debian/omx-panel into debian/tmp`);
  }
});
