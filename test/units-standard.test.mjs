// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Sorting pass rows M4, P1, P2 (omx-panel#160, #161, #162): omx-panel speaks the standard unit ids only, read from
// omx-contract's param domain (PARAM_UNITS: each word's id, its symbol x-symbol and its x-dimension, V23a). It reads no
// LV2 table (plugin-hostd's PLUGIN_HOSTD_LV2_MAP, P1) and no CLAP code sheet (OMX_PARAM_CONTRACT_UNITS, P2): whether a
// face serves a unit is the face writer's question (%7). Its own unit groups (tools/role-table.mjs, the level units of
// tools/panel-description.mjs) name standard ids and dimensions (M4, F3).
// (a) golden: a descriptor unit's id, the role table's ids, the level units by dimension; (c) a temporary contract
// directory whose param domain has no dBu: a dBu control has no unit id and a read-only one is no level meter.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { contractDirs } from '../dist/tools/vocabulary.mjs';
import { ROLES } from '../dist/tools/role-table.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PD = join(ROOT, 'dist/tools/panel-description.mjs');
const paramDir = () => contractDirs().find((d) => existsSync(join(d, 'param/param.json')));
const ids = () => JSON.parse(readFileSync(join(paramDir(), 'param/param.json'), 'utf8')).components.schemas.PARAM_UNITS.oneOf.map((w) => w.const);

/** The answers of panel-description for `units` in a child with `env`: each unit's id, and the widget of a read-only control in it. */
function answers(units, env = {}) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { unitToken, widgetOf } = await import(${JSON.stringify(PD)});
    const units = ${JSON.stringify(units)};
    console.log(JSON.stringify(units.map((u) => [unitToken(u) ?? null, widgetOf({ kind: 'travel', readonly: true, travel: { unit: u, min: 0, max: 1 } }).widget])));`],
  { encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('(a) the param domain is installed where the tools read it (omx-contract >= 3.21.0)', () => {
  assert.ok(paramDir(), `no param/param.json in ${contractDirs().join(':')}`);
});

test('(a) a descriptor unit is read as its standard id; a unit the list lacks has none', () => {
  assert.deepEqual(answers(['dB', '%', 'dB/oct', '', 'kHz', 'x', 'st', 'cents', 'furlong']).map(([id]) => id),
    ['dB', 'percent', 'dB-oct', 'none', 'kHz', 'x', 'st', 'cents', null]);
});

test('(a) every unit the role table names is a standard id', () => {
  const known = new Set(ids());
  for (const [family, roles] of Object.entries(ROLES)) {
    for (const [role, units] of Object.entries(roles)) for (const u of units) assert.ok(known.has(u), `${family}.${role}: ${u} is no PARAM_UNITS id`);
  }
});

test('(a) a read-only control in a unit of the gain, level or loudness dimension is a level meter, any other a display', () => {
  assert.deepEqual(answers(['dB', 'dBFS', 'dBTP', 'dBu', 'LUFS', 'LU', 'Hz', 'ms', '%']).map(([, w]) => w),
    ['meter', 'meter', 'meter', 'meter', 'meter', 'meter', 'display', 'display', 'display']);
});

test('(c) a param domain with no dBu: a dBu unit has no id and a read-only dBu control is no meter', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-m4-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(paramDir(), 'param'), join(dir, 'param'), { recursive: true });
  const f = join(dir, 'param/param.json');
  const doc = JSON.parse(readFileSync(f, 'utf8'));
  doc.components.schemas.PARAM_UNITS.oneOf = doc.components.schemas.PARAM_UNITS.oneOf.filter((w) => w.const !== 'dBu');
  writeFileSync(f, JSON.stringify(doc, null, 2));
  assert.deepEqual(answers(['dBu'], { OMX_CONTRACT_PATH: [dir, ...contractDirs()].join(':') }), [[null, 'display']]);
});

test('(3) no file reads plugin-hostd\'s LV2 table or the CLAP code sheet', () => {
  let out = '';
  try {
    out = execFileSync('git', ['grep', '-n', '-e', 'PLUGIN_HOSTD_LV2_MAP', '-e', 'OMX_PARAM_CONTRACT_UNITS', '-e', 'param-contract.json', '-e', 'PLUGIN_HOSTD_TABLES',
      '--', 'tools', 'src', 'bin', 'lib', 'Makefile', 'debian/control', '.github'], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    assert.equal(e.status, 1, e.stderr);
  }
  assert.equal(out, '', out);
  // the spec's package sections (its %changelog is history)
  const spec = readFileSync(join(ROOT, 'packaging/omx-panel.spec'), 'utf8').split('\n%changelog')[0];
  assert.doesNotMatch(spec, /PLUGIN_HOSTD_LV2_MAP|OMX_PARAM_CONTRACT_UNITS|param-contract\.json|plugin-hostd-contract/);
});
