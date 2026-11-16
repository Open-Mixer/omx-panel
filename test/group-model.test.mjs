// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The group model (docs/group-model.md): the corpus, each plugin's inference compared in full with the one written down
 * before the library, and each rule and reason code by the smallest plugin that shows it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTurtle } from '../dist/tools/turtle-read.mjs';
import { controlsOfDescriptor, controlsOfLv2, inferGroupModel, matrixOf, REASONS } from '../dist/tools/group-model.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const EXPECTED = join(FIXTURES, 'group-model', 'expected');

/** A plugin's controls, from the corpus input an expectation names. */
function controlsOf({ input, uri }) {
  const at = input.startsWith('lv2-groups/') ? join(FIXTURES, input) : join(FIXTURES, 'group-model', input.replace(/^group-model\//, ''));
  if (at.endsWith('.json')) return controlsOfDescriptor(JSON.parse(readFileSync(at, 'utf8')));
  return controlsOfLv2(parseTurtle(readFileSync(at, 'utf8'), `file://${at}`), uri);
}

/** The model as the expectations write it: a list's parameters and reason, a repeat's matrix in full. */
export function summarize({ groups }) {
  return groups.map((g) => {
    if (g.kind === 'list') return { key: g.key, label: g.label, kind: 'list', source: g.source, reason: g.reason ?? null, parameters: g.parameters };
    const m = matrixOf(g);
    const [heads, lines] = m.orientation === 'columns' ? [m.columns, m.rows] : [m.rows, m.columns];
    return {
      key: g.key, label: g.label, kind: 'repeated', source: g.source, family: g.family, parameters: g.parameters, orientation: m.orientation,
      heads: heads.map((h) => ({ key: h.key, label: h.label, on: h.on?.symbol ?? null, sense: h.on?.sense ?? null })),
      lines: lines.map((l) => ({ key: l.key, label: l.label })),
      cells: m.cells,
    };
  });
}

const corpus = readdirSync(EXPECTED).filter((f) => f.endsWith('.expected.json')).sort();

test('the corpus holds the seven plugins of the spec and the two ambiguous ones (a check over nothing proves nothing)', () => {
  assert.deepEqual(corpus.map((f) => f.replace('.expected.json', '')), [
    'ams-advenv', 'calf-multiband-compressor', 'lsp-para-equalizer-x8-mono', 'omx-eq16', 'omx-eq32', 'omx-eq8', 'omx-strip', 'x42-fil4', 'x42-matrixmixer',
  ]);
});

for (const f of corpus) {
  test(`corpus: ${f.replace('.expected.json', '')} is inferred as written down`, () => {
    const want = JSON.parse(readFileSync(join(EXPECTED, f), 'utf8'));
    assert.deepEqual(summarize(inferGroupModel(controlsOf(want))), want.groups);
  });
}

test('corpus: at least one ambiguous plugin falls back to a plain list with its reason code', () => {
  const reasons = corpus.flatMap((f) => JSON.parse(readFileSync(join(EXPECTED, f), 'utf8')).groups.map((g) => g.reason).filter(Boolean));
  assert.ok(reasons.length >= 2, reasons.join(', '));
  for (const r of reasons) assert.ok(r in REASONS, r);
});

// ---- the rules, each by the smallest plugin that shows it ----

/** A synthetic control: travel unless said, no unit unless said, declared path none unless said. */
const c = (symbol, name, index, extra = {}) => ({ symbol, name, index, kind: 'travel', unit: '', min: 0, max: 1, path: [], ...extra });
/** n bands of `stems` (symbol `b<i>_<stem>`, name `Band <i> <Stem>`), with per-band overrides. */
function bands(n, stems, over = () => ({})) {
  const out = [];
  for (let i = 1; i <= n; i++) for (const [s, extra] of Object.entries(stems)) out.push(c(`b${i}_${s}`, `Band ${i} ${s[0].toUpperCase()}${s.slice(1)}`, out.length, { ...extra, ...over(i, s) }));
  return out;
}
const EQ = { on: { kind: 'toggle' }, freq: { unit: 'hz', min: 20, max: 20000 }, gain: { unit: 'db', min: -18, max: 18 }, q: { min: 0.1, max: 10 } };
const only = (controls) => {
  const { groups } = inferGroupModel(controls);
  assert.equal(groups.length, 1, JSON.stringify(groups));
  return groups[0];
};

test('S1: a repeat never crosses a declared group', () => {
  const g = inferGroupModel([c('a1', 'A 1', 0, { path: ['X'] }), c('b1', 'B 1', 1, { path: ['X'] }), c('a2', 'A 2', 2, { path: ['Y'] }), c('b2', 'B 2', 3, { path: ['Y'] })]).groups;
  assert.deepEqual(g.map((x) => [x.key, x.kind]), [['X', 'list'], ['Y', 'list']]);
});

test('S2: a declared band whose symbols carry another number is refused (declared-index-conflict)', () => {
  const ok = bands(3, EQ).map((x) => ({ ...x, path: ['Bands', x.name.split(' ').slice(0, 2).join(' ')] }));
  assert.equal(only(ok).kind, 'repeated');
  const bad = ok.map((x) => (x.symbol === 'b3_q' ? { ...x, symbol: 'b7_q' } : x));
  assert.equal(only(bad).reason, 'declared-index-conflict');
});

test('S4: kind, unit and range mismatches are refused, each by its code; a frequency may span another range per band', () => {
  assert.equal(only(bands(3, EQ)).kind, 'repeated');
  assert.equal(only(bands(3, EQ, (i, s) => (i === 2 && s === 'q' ? { kind: 'choice', options: 3 } : {}))).reason, 'kind-mismatch');
  assert.equal(only(bands(3, EQ, (i, s) => (i === 2 && s === 'gain' ? { unit: 'coef' } : {}))).reason, 'unit-mismatch');
  assert.equal(only(bands(3, EQ, (i, s) => (i === 2 && s === 'gain' ? { max: 24 } : {}))).reason, 'range-mismatch');
  assert.equal(only(bands(3, EQ, (i, s) => (s === 'freq' ? { min: 20 * i, max: 2000 * i } : {}))).kind, 'repeated');
});

test('one-parameter: one repeated control per instance is a row, not a matrix', () => {
  assert.equal(only(bands(4, { gain: { unit: 'db' } })).reason, 'one-parameter');
});

test('index-gap: instance numbers 1, 2, 4 are refused', () => {
  assert.equal(only(bands(4, EQ).filter((x) => !x.symbol.startsWith('b3_'))).reason, 'index-gap');
});

test('name-number-disagrees: two instances whose names print the same number are refused', () => {
  assert.equal(only(bands(3, EQ).map((x) => (x.symbol === 'b3_gain' ? { ...x, name: 'Band 2 Gain' } : x))).reason, 'name-number-disagrees');
});

test('ragged-instances and two-indices are named by their codes on a synthetic plugin too', () => {
  const ragged = [c('a1', 'A 1', 0), c('a2', 'A 2', 1), c('b1', 'B 1', 2), c('c1', 'C 1', 3), c('c2', 'C 2', 4), c('c3', 'C 3', 5), c('d3', 'D 3', 6), c('d2', 'D 2', 7)];
  assert.equal(only(ragged).reason, 'ragged-instances');
  assert.equal(only([c('m_1_1', 'M 1 1', 0), c('m_1_2', 'M 1 2', 1), c('m_2_1', 'M 2 1', 2), c('g', 'G', 3)]).reason, 'two-indices');
});

test('every reason code is one the spec lists, and the spec lists every code', () => {
  const spec = readFileSync(join(FIXTURES, '..', '..', 'docs', 'group-model.md'), 'utf8');
  const table = [...spec.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(table.sort(), Object.keys(REASONS).sort());
});

test('L1: every row holds one parameter across the instances, a missing one left empty', () => {
  const m = matrixOf(only(bands(3, EQ)));
  for (const [r, row] of m.rows.entries()) {
    const stems = new Set(m.cells[r].filter(Boolean).map((s) => s.replace(/\d+/g, '#')));
    assert.equal(stems.size, 1, `${row.key}: ${m.cells[r].join(' ')}`);
  }
});

test('L2: an EQ of more rows than bands is still columns, its bands low to high', () => {
  const extra = { ...EQ, type: { kind: 'choice', options: 4 }, slope: { kind: 'choice', options: 2 }, mode: {}, solo: { kind: 'toggle' } };
  const m = matrixOf(only(bands(2, extra).reverse()));
  assert.equal(m.orientation, 'columns');
  assert.deepEqual(m.columns.map((x) => x.label), ['Band 1', 'Band 2']);
  assert.deepEqual(m.rows.slice(0, 5).map((r) => r.key), ['type', 'slope', 'freq', 'gain', 'q']);
});

test('L4: another repeat is columns when its instances are at least its rows, else rows', () => {
  const four = { threshold: { unit: 'db' }, ratio: {} };
  assert.equal(matrixOf(only(bands(2, four))).orientation, 'columns');
  assert.equal(matrixOf(only(bands(3, { ...four, attack: { unit: 'ms' }, release: { unit: 'ms' } }))).orientation, 'rows');
});

test('matrixOf refuses a list: a surface never draws a guessed matrix', () => {
  assert.throws(() => matrixOf(only(bands(4, { gain: { unit: 'db' } }))), /not a repeated group/);
});
