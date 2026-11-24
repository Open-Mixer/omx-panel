// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Sorting pass rows M4, P1 (omx-panel#160, #161): omx-panel speaks the standard unit ids, read from omx-contract's param
// domain (PARAM_UNITS: each word's id, its symbol x-symbol and its x-dimension, V23a). It reads no LV2 table
// (plugin-hostd's PLUGIN_HOSTD_LV2_MAP, P1): a unit's LV2 term is plugin-db's F1 word. V23d (and with it P2) is out of the
// pass (%4). A unit is served when omx-contract's PARAM_UNITS_CLAP_ENCODED holds its id (V23d, P2). Its own unit
// groups (tools/role-table.mjs, the level units of tools/panel-description.mjs) name standard ids and dimensions (M4, F3).
// (a) golden: a descriptor unit's id, the role table's ids, the level units by dimension; (c) a temporary contract
// directory whose param domain has no dBu: a dBu control has no unit id and a read-only one is no level meter.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { contractDirs } from '../dist/tools/vocabulary.mjs';
import { ROLES } from '../dist/tools/role-table.mjs';
import { treeGrep } from './tree-grep.mjs';

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

test('(a) the param domain is installed where the tools read it', () => {
  assert.ok(paramDir(), `no param/param.json in ${contractDirs().join(':')}`);
});

test('(a) a descriptor unit is read as its standard id; a unit the list lacks has none', () => {
  assert.deepEqual(answers(['dB', 'percent', 'none', 'kHz', 'coef', 'st', 'cents', 'furlong']).map(([id]) => id),
    ['dB', 'percent', 'none', 'kHz', 'coef', 'st', 'cents', null]);
  // C2 (plugin-hostd#215 D1/D2): a symbol is display, never a descriptor's word: `%`, `dB/oct` and `""` have no id
  assert.deepEqual(answers(['%', 'dB/oct', '']).map(([id]) => id), [null, null, null]);
});

test('(a) every unit the role table names is a standard id', () => {
  const known = new Set(ids());
  for (const [family, roles] of Object.entries(ROLES)) {
    for (const [role, units] of Object.entries(roles)) for (const u of units) assert.ok(known.has(u), `${family}.${role}: ${u} is no PARAM_UNITS id`);
  }
});

test('(a) a read-only control in a unit of the gain, level or loudness dimension is a level meter, any other a display', () => {
  assert.deepEqual(answers(['dB', 'dBFS', 'dBTP', 'dBu', 'LUFS', 'LU', 'Hz', 'ms', 'percent']).map(([, w]) => w),
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

const HOSTD_NAMES = /PLUGIN_HOSTD_LV2_MAP|PLUGIN_HOSTD_TABLES|plugin-hostd-contract/;
const HOSTD_PATHS = ['tools', 'src', 'bin', 'lib', 'Makefile', 'debian/control', 'debian/rules', '.github', 'BUILDING.md', 'README.md', 'docs', 'man'];

/** The lines of this tree (or of `root`) that name plugin-hostd's LV2 table or its package: code, packaging, CI, docs.
 * Read from the files (tree-grep.mjs), not by git grep: a package build (rpmbuild's %check, a `git archive` tree) has
 * no .git, and the guard holds there too (#207). */
function hostdNames(root = ROOT) {
  const out = treeGrep(root, HOSTD_NAMES, HOSTD_PATHS);
  // the spec's package sections (its %changelog is history)
  const spec = readFileSync(join(root, 'packaging/omx-panel.spec'), 'utf8').split('\n%changelog')[0];
  return out + (HOSTD_NAMES.test(spec) ? 'packaging/omx-panel.spec: names plugin-hostd\n' : '');
}

test('(3) no file reads plugin-hostd\'s LV2 table or names its package, docs and CI included', () => {
  assert.equal(hostdNames(), '');
});

test('(3) arm: plugin-hostd-contract planted in release.yml is seen', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-hostd-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // a scratch tree holding this tree's release.yml and spec, the package name planted in release.yml
  for (const rel of ['.github/workflows/release.yml', 'packaging/omx-panel.spec']) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    cpSync(join(ROOT, rel), join(dir, rel));
  }
  const f = join(dir, '.github/workflows/release.yml');
  writeFileSync(f, `${readFileSync(f, 'utf8')}# plugin-hostd-contract\n`);
  // the scratch tree has no .git, as a package build's has none: the guard reads it all the same
  assert.match(hostdNames(dir), /release\.yml:\d+:.*plugin-hostd-contract/);
});

// V23d, P2 (omx-panel#162): a unit is served when omx-contract's PARAM_UNITS_CLAP_ENCODED (its param domain, the ids
// org.openmixer.param-contract/1 encodes) holds its standard id. omx-panel reads omx-contract only: no code sheet, no
// LV2 term, nothing of omx-clap.
test('(a) a standard unit the param-contract extension encodes takes its role; one it does not encode takes none', () => {
  assert.deepEqual(answers(['dB', 'percent', 'x', 'coef', 'st', 'cents', 'dBFS', 'LUFS', 'dBu', 'dBTP', 'LU', 'dBPerS', 'dBPerOct', 'none']).map(([id]) => id),
    ['dB', 'percent', null, 'coef', 'st', 'cents', 'dBFS', 'LUFS', 'dBu', 'dBTP', 'LU', 'dBPerS', 'dBPerOct', 'none']);
});

test('(c) omx-contract\'s served set decides: a PARAM_UNITS_CLAP_ENCODED with no LUFS leaves LUFS unserved', (t) => {
  assert.ok(paramDir(), `no param/param.json in ${contractDirs().join(':')}`);
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-p2-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const doc = JSON.parse(readFileSync(join(paramDir(), 'param/param.json'), 'utf8'));
  const served = doc.components.schemas.PARAM_UNITS_CLAP_ENCODED;
  assert.ok(served?.oneOf?.some((w) => w.const === 'LUFS'), 'positive control: the installed served set holds LUFS');
  served.oneOf = served.oneOf.filter((w) => w.const !== 'LUFS').map((w, i) => ({ ...w, 'x-code': i }));
  mkdirSync(join(dir, 'param'), { recursive: true });
  writeFileSync(join(dir, 'param/param.json'), JSON.stringify(doc));
  assert.deepEqual(answers(['LUFS', 'dB'], { OMX_CONTRACT_PATH: [dir, ...contractDirs()].join(':') }).map(([id]) => id), [null, 'dB']);
});

// Owner ruling 2026-11-23 (units keep standard symbols only; a non-standard spelling is a bug at its source): a unit id is
// letters and digits from a letter (omx-contract's PARAM_UNITS, `dB/oct` is `dBPerOct`). No unit this tree states, in the
// role table, a descriptor or panel fixture, a domain, an example or a schema, carries '/' or '-': a symbol (`dB/oct`) or
// an old spelling (`dB-oct`, `dB-s`) stated as a unit is refused by file and key. LV2 Turtle is a format's own text
// (`units:symbol`) and is not read.
const UNIT_DIRS = ['test/fixtures', 'fixtures', 'examples', 'contract.d', 'schema', 'tools', 'store', 'catalogs'];

/** Every unit word the JSON under `root`'s UNIT_DIRS states: a string `unit`, and each value of a `choiceUnits`. */
function statedUnits(root = ROOT) {
  const out = [];
  const visit = (v, where) => {
    if (Array.isArray(v)) { v.forEach((x, i) => visit(x, `${where}[${i}]`)); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (k === 'unit' && typeof x === 'string') out.push([`${where}.unit`, x]);
      else if (k === 'choiceUnits' && x && typeof x === 'object' && !('type' in x)) for (const [s, u] of Object.entries(x)) out.push([`${where}.choiceUnits.${s}`, u]);
      visit(x, `${where}.${k}`);
    }
  };
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (e.name.endsWith('.json')) visit(JSON.parse(readFileSync(p, 'utf8')), relative(root, p));
    }
  };
  for (const d of UNIT_DIRS) walk(join(root, d));
  return out;
}

const NOT_AN_ID = /[/-]/;

test('(a) no unit the tree states carries / or -: the role table and every JSON unit and choiceUnits are ids', () => {
  const stated = statedUnits();
  assert.ok(stated.some(([, u]) => u === 'dBPerOct'), 'positive control: the scan reads the strip-eq descriptor\'s choiceUnits');
  assert.ok(stated.length > 500, `positive control: the scan reads the fixtures (${stated.length} units)`);
  const bad = stated.filter(([, u]) => NOT_AN_ID.test(u)).map(([w, u]) => `${w}: ${u}`);
  for (const [family, roles] of Object.entries(ROLES)) {
    for (const [role, units] of Object.entries(roles)) for (const u of units) if (NOT_AN_ID.test(u)) bad.push(`role-table ${family}.${role}: ${u}`);
  }
  assert.deepEqual(bad, []);
});

test('(a) arm: a unit `dB/oct` and a choiceUnits `dB-s` planted in a fixture are seen', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-unit-ids-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'test/fixtures/planted'), { recursive: true });
  writeFileSync(join(dir, 'test/fixtures/planted/p.json'),
    JSON.stringify({ controls: [{ travel: { unit: 'dB/oct' } }, { travel: { unit: 'dBPerOct' } }], choiceUnits: { hpfSlope: 'dB-s' } }));
  assert.deepEqual(statedUnits(dir).filter(([, u]) => NOT_AN_ID.test(u)),
    [['test/fixtures/planted/p.json.controls[0].travel.unit', 'dB/oct'], ['test/fixtures/planted/p.json.choiceUnits.hpfSlope', 'dB-s']]);
});
