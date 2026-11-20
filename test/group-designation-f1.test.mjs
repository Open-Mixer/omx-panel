// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Sorting pass row P3 (omx-panel#163): rule 2 of the port-group inference reads what an LV2 designation means from
// plugin-db's F1 mapping (the lv2 domain's LV2_DESIGNATION_MEANINGS: term -> standard meaning) and groups by the
// standard meaning; omx-panel keeps no LV2 designation table for the designations F1 maps. sustain, waveform,
// pulseWidth, amplitude, wetLevel and dryLevel have no standard meaning and no F1 word: they stay omx-panel's own
// (C2 2026-11-20). Call level: inferGroups' verdict.
// (a) golden verdicts frozen from origin/main 3cace582's rule 2; (c) a temporary contract directory whose F1 word for
// cutoffFrequency means tone (a meaning rule 2 has no group for) takes the cutoff controls out of rule 2's Filter.
// The lv2 domain is plugin-db's (plugin-db-contract): $OMX_CONTRACT_PATH or the installed contract directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { contractDirs } from '../dist/tools/vocabulary.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GOLD = join(ROOT, 'test/fixtures/group-designation/golden.mjs');
const GOLDEN = {"A":{"outcome":"grouped","groups":["Envelope:attack0,attack1,decay0,decay1,sustain0,sustain1,release0,release1,hold0,hold1,delay0,delay1","Filter:cutoffFrequency0,cutoffFrequency1,resonance0,resonance1","Oscillator:waveform0,waveform1,pulseWidth0,pulseWidth1,frequency0,frequency1,amplitude0,amplitude1","Output:gain0,gain1,wetLevel0,wetLevel1,dryLevel0,dryLevel1,wetDryRatio0,wetDryRatio1"],"placedBy":{"attack0":2,"attack1":2,"decay0":2,"decay1":2,"sustain0":2,"sustain1":2,"release0":2,"release1":2,"hold0":2,"hold1":2,"delay0":2,"delay1":2,"cutoffFrequency0":2,"cutoffFrequency1":2,"resonance0":2,"resonance1":2,"waveform0":2,"waveform1":2,"pulseWidth0":2,"pulseWidth1":2,"frequency0":2,"frequency1":2,"amplitude0":2,"amplitude1":2,"gain0":2,"gain1":2,"wetLevel0":2,"wetLevel1":2,"dryLevel0":2,"dryLevel1":2,"wetDryRatio0":2,"wetDryRatio1":2}},"B":{"outcome":"grouped","groups":["Dynamics:threshold0,threshold1,ratio0,ratio1,attack0,attack1,release0,release1,hold0,hold1","Envelope:decay0,decay1","Filter:cutoffFrequency0,cutoffFrequency1","Output:gain0,gain1"],"placedBy":{"threshold0":2,"threshold1":2,"ratio0":2,"ratio1":2,"attack0":2,"attack1":2,"release0":2,"release1":2,"hold0":2,"hold1":2,"decay0":2,"decay1":2,"cutoffFrequency0":2,"cutoffFrequency1":2,"gain0":2,"gain1":2}}};

const run = (env = {}) => {
  const r = spawnSync(process.execPath, [GOLD, join(ROOT, 'dist/tools/group-infer.mjs')], { encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test('(a) rule 2 groups by designation as before: the golden verdicts', () => {
  assert.deepEqual(run(), GOLDEN);
});

test('(c) the F1 mapping decides: a cutoffFrequency that F1 says is tone is no longer rule 2\'s Filter', (t) => {
  const from = contractDirs().find((d) => { try { readFileSync(join(d, 'lv2/lv2.json')); return true; } catch { return false; } });
  assert.ok(from, `no lv2 domain (plugin-db-contract) in ${contractDirs().join(':')}`);
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-p3-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(from, 'lv2'), join(dir, 'lv2'), { recursive: true });
  const f = join(dir, 'lv2/lv2.json');
  const doc = JSON.parse(readFileSync(f, 'utf8'));
  doc.components.schemas.LV2_DESIGNATION_MEANINGS.oneOf.find((w) => w.title === 'cutoffFrequency').const = 'tone';
  writeFileSync(f, JSON.stringify(doc, null, 2));
  const got = run({ OMX_CONTRACT_PATH: [dir, ...contractDirs()].join(':') });
  assert.notEqual(got.A.placedBy?.cutoffFrequency0, 2, `rule 2 still placed cutoff: ${JSON.stringify(got.A.groups)}`);
  assert.ok(!got.A.groups.some((g) => g.startsWith('Filter:') && g.includes('cutoffFrequency0')), `cutoff did not follow F1: ${JSON.stringify(got.A.groups)}`);
});
