// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * A one-band-only control is paged after the matrix, never before the high-pass (#97, arm 3). A control only one band has
 * ("Band 3 Drive") is no row of the repeated group, so it is the section's own; the section's own controls were all paged
 * before the instances, which put it on a screen ahead of the HPF, against the owner's rule that every screen walks HPF, the
 * bands, LPF (docs/group-model.md, L7 and P1). Ruled here: the section's own controls that print a number (one band's) are
 * paged after the instances; the count and the master on, which print none, stay before them.
 * Over `omx-panel describe --pages`, as a surface reads it, on omx-eq8's shipped descriptor with the one extra control.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EQ8 = join(ROOT, 'test/fixtures/group-model/omx-plugins/omx-eq8.descriptor.json');

function pages(descriptor, perPage) {
  const dir = mkdtempSync(join(tmpdir(), 'band-only-'));
  try {
    writeFileSync(join(dir, 'd.json'), JSON.stringify(descriptor));
    const r = spawnSync(process.execPath, [join(ROOT, 'dist/bin/omx-panel.mjs'), 'describe', '--descriptor', join(dir, 'd.json'), '--pages', '--per-page', String(perPage)], { encoding: 'utf8', maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const d = JSON.parse(readFileSync(EQ8, 'utf8'));
const b3 = d.controls.find((c) => c.symbol === 'b3_gain');
// no meaning: a control the Easy face would pick is paged there and not in the section, which would hide the defect
const { meaning: _m, ...plain } = b3;
const drive = { ...plain, id: Math.max(...d.controls.map((c) => Number(c.id))) + 1, symbol: 'b3_drive', name: 'Band 3 Drive' };
const withDrive = { ...d, controls: [...d.controls, drive] };
const idOf = (symbol) => withDrive.controls.find((c) => c.symbol === symbol).id;

for (const perPage of [4, 8]) {
  test(`omx-eq8 with a Band 3 Drive, ${perPage} slots: the one-band control is paged after the LPF, never before the HPF`, () => {
    const cut = pages(withDrive, perPage).filter((p) => p.section !== null);
    const at = (symbol) => cut.findIndex((p) => p.ids.includes(idOf(symbol)));
    assert.ok(at('b3_drive') >= 0, 'the Band 3 Drive is on no page');
    assert.ok(at('b3_drive') > at('hpf_freq'), `the Band 3 Drive is paged at ${at('b3_drive')}, before the HPF at ${at('hpf_freq')}`);
    assert.ok(at('b3_drive') > at('lpf_freq'), `the Band 3 Drive is paged at ${at('b3_drive')}, inside the matrix walk (LPF at ${at('lpf_freq')})`);
  });
}
