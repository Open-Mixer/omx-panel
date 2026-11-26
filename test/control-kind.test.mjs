// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The kind of a scanned control (docs/control-kind.md, #153): the conformance vectors of schema/control-kind-vectors.json
// hold to their schema and are consistent (one row per distinct statement, every case the rule names present),
// controlKind() gives every row its kind, omx-panel's two readers (the LV2 port reader of the group inference and the
// group model over a descriptor) apply the one rule, and the files reach the package.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeValidator } from '../dist/lib/validate.mjs';
import { controlKind } from '../dist/tools/control-kind.mjs';
import { readPluginPorts } from '../dist/tools/group-infer.mjs';
import { controlsOfDescriptor } from '../dist/tools/group-model.mjs';
import { parseTurtle } from '../dist/tools/turtle-read.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VECTORS_REL = 'schema/control-kind-vectors.json';
const SCHEMA_REL = 'schema/control-kind-vectors.schema.json';
const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const VECTORS = read(VECTORS_REL);
const SCHEMA = read(SCHEMA_REL);

/** The cases the rule names (docs/control-kind.md) and the review's plants, each one row of the table. */
const NAMED_CASES = [
  'clap-stepped-0-1-default-0', 'clap-stepped-0-1-default-1', 'clap-stepped-0-1-default-0.5', 'clap-stepped-0-1-default-0.3',
  'clap-stepped-0-1-step-0.25', 'contract-stepped-no-flag-0-1', 'clap-stepped-contract-linear-0-1', 'clap-enum-stepped-0-1',
  'clap-stepped-1-2', 'clap-stepped-minus1-0', 'clap-stepped-0-2', 'lv2-toggled-default-1',
];

/** Every row through `kindOf`; the mismatches as strings. */
function misses(kindOf, rows = VECTORS.rows) {
  const out = [];
  for (const row of rows) {
    const got = kindOf(row.stated);
    try { assert.deepEqual(got, row.expect); } catch { out.push(`${row.id}: ${JSON.stringify(got)}, not ${JSON.stringify(row.expect)}`); }
  }
  return out;
}

/** A row's statement as one key, the keys in one order, so two rows stating the same inputs are found. */
const statementKey = (stated) => JSON.stringify(Object.fromEntries(Object.entries(stated).sort(([a], [b]) => a.localeCompare(b))));

/** Only the kind of what the rule gives: what a reader that keeps the kind alone answers. */
const kindOnly = (k) => k.kind;

test('the vectors validate against their schema, and the schema refuses a row with no expect', () => {
  const validate = makeValidator(SCHEMA);
  assert.equal(validate(VECTORS).ok, true, JSON.stringify(validate(VECTORS).errors));
  const broken = structuredClone(VECTORS);
  delete broken.rows[0].expect;
  assert.equal(validate(broken).ok, false, 'positive control: the schema refuses a row with no expect');
  const wrongShape = structuredClone(VECTORS);
  wrongShape.rows[0].expect = { kind: 'choice', default: true };
  assert.equal(validate(wrongShape).ok, false, 'a choice carries no default');
});

test('the vectors are consistent: ids unique, statements unique, every named case present', () => {
  const ids = VECTORS.rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'one row per id');
  const keys = VECTORS.rows.map((r) => statementKey(r.stated));
  assert.equal(new Set(keys).size, keys.length, 'one row per statement: two rows stating the same inputs could expect two kinds');
  for (const id of NAMED_CASES) assert.ok(ids.includes(id), `${id} is a row`);
  for (const row of VECTORS.rows) {
    if (row.expect.kind === 'toggle' && !row.stated.toggled) assert.ok(row.stated.min === 0 && row.stated.max === 1, `${row.id}: a toggle not stated toggled is over 0..1`);
    if (row.expect.kind === 'choice') assert.equal(row.stated.enumeration, true, `${row.id}: a choice is stated an enumeration`);
    if ('default' in row.expect) assert.ok('default' in row.stated, `${row.id}: a toggle's default comes from a stated default`);
  }
});

test('controlKind gives every row its kind', () => {
  assert.deepEqual(misses(controlKind), []);
});

test('sabotage: a row expecting a toggle for an enumeration goes red', () => {
  const rows = structuredClone(VECTORS.rows);
  rows.find((r) => r.id === 'clap-enum-stepped-0-1').expect = { kind: 'toggle', default: false };
  assert.deepEqual(misses(controlKind, rows).map((m) => m.split(':')[0]), ['clap-enum-stepped-0-1']);
});

// --- omx-panel's readers, each through its own door ---------------------------------------------------------------

const LV2 = 'http://lv2plug.in/ns/lv2core#';
const PPROPS = 'http://lv2plug.in/ns/ext/port-props#';

/** An LV2 plugin of one control port per row that LV2 can state (no contract scale word other than log, no step): the row's statement as Turtle. */
function lv2Of(rows) {
  const ports = rows.map((r, i) => {
    const props = [r.stated.enumeration && 'lv2:enumeration', r.stated.toggled && 'lv2:toggled', r.stated.stepped && 'lv2:integer', r.stated.scale === 'log' && 'pprops:logarithmic'].filter(Boolean);
    return `[ a lv2:InputPort , lv2:ControlPort ; lv2:index ${i} ; lv2:symbol "p${i}" ; lv2:name "P ${i}" ; lv2:minimum ${r.stated.min} ; lv2:maximum ${r.stated.max}${'default' in r.stated ? ` ; lv2:default ${r.stated.default}` : ''}${props.length ? ` ; lv2:portProperty ${props.join(' , ')}` : ''} ]`;
  });
  return `@prefix lv2: <${LV2}> . @prefix pprops: <${PPROPS}> .\n<urn:omx-panel:test:kind> a lv2:Plugin ; lv2:port ${ports.join(' ,\n  ')} .\n`;
}
/** The rows LV2 can state: no contract scale word but log, and no step. */
const LV2_ROWS = VECTORS.rows.filter((r) => (r.stated.scale === undefined || r.stated.scale === 'log') && r.stated.step === undefined);

test('the LV2 port reader of the group inference gives every row LV2 can state the rule\'s kind', () => {
  assert.ok(LV2_ROWS.length >= 15, `${LV2_ROWS.length} rows`);
  const { ports } = readPluginPorts(parseTurtle(lv2Of(LV2_ROWS), 'file:///t/kind.ttl'), 'urn:omx-panel:test:kind');
  const got = LV2_ROWS.map((r, i) => `${r.id}: ${ports.find((p) => p.index === i)?.kind}`);
  assert.deepEqual(got, LV2_ROWS.map((r) => `${r.id}: ${kindOnly(r.expect)}`));
});

/** The rows a descriptor's travel states: a scale word (a scan writes `stepped` for a stepped flag), no enumeration, no toggle. */
const TRAVEL_ROWS = VECTORS.rows.filter((r) => !r.stated.enumeration && !r.stated.toggled && r.stated.scale !== undefined && r.stated.scale !== 'unknown');

test('the group model over a descriptor gives every travel a scan wrote the rule\'s kind', () => {
  assert.ok(TRAVEL_ROWS.length >= 5, `${TRAVEL_ROWS.length} rows`);
  const descriptor = {
    controls: TRAVEL_ROWS.map((r, i) => ({
      kind: 'travel', id: i, symbol: `p${i}`, name: `P ${i}`,
      travel: { min: r.stated.min, max: r.stated.max, scale: r.stated.scale, unit: '', ...('step' in r.stated ? { step: r.stated.step } : {}), ...('default' in r.stated ? { default: r.stated.default } : {}) },
    })),
  };
  const controls = controlsOfDescriptor(descriptor);
  assert.deepEqual(controls.map((c) => `${TRAVEL_ROWS[c.index].id}: ${c.kind}`), TRAVEL_ROWS.map((r) => `${r.id}: ${kindOnly(r.expect)}`));
});

test('the rule, the vectors and their schema are exported by name and documented', () => {
  const pkg = read('package.json');
  assert.deepEqual(pkg.exports['./control-kind'], { types: './dist/tools/control-kind.d.mts', default: './dist/tools/control-kind.mjs' });
  assert.equal(pkg.exports['./control-kind-vectors.json'], `./dist/${VECTORS_REL}`);
  assert.equal(pkg.exports['./control-kind-vectors.schema.json'], `./dist/${SCHEMA_REL}`);
  for (const rel of [VECTORS_REL, SCHEMA_REL]) assert.deepEqual(read(`dist/${rel}`), read(rel), `dist/${rel} is the tree's`);
  const doc = readFileSync(join(ROOT, 'docs/control-kind.md'), 'utf8');
  assert.match(doc, /^# The kind of a scanned control$/m);
  assert.ok(doc.includes(VECTORS_REL) && doc.includes(SCHEMA_REL), 'the page names both files');
});
