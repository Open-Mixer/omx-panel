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
      key: g.key, label: g.label, kind: 'repeated', source: g.source, family: g.family, parameters: g.parameters, ...(g.count ? { count: g.count.symbol } : {}), orientation: m.orientation,
      heads: heads.map((h) => ({ key: h.key, label: h.label, on: h.on?.symbol ?? null, sense: h.on?.sense ?? null })),
      lines: lines.map((l) => ({ key: l.key, label: l.label })),
      cells: m.cells,
    };
  });
}

const corpus = readdirSync(EXPECTED).filter((f) => f.endsWith('.expected.json')).sort();

test('the corpus holds the nine plugins of the spec and the two ambiguous ones (a check over nothing proves nothing)', () => {
  assert.deepEqual(corpus.map((f) => f.replace('.expected.json', '')), [
    'ams-advenv', 'calf-multiband-compressor', 'lsp-para-equalizer-x8-mono', 'omx-delay', 'omx-dyneq', 'omx-eq16', 'omx-eq32', 'omx-eq8', 'omx-strip', 'x42-fil4', 'x42-matrixmixer',
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
  assert.deepEqual(m.rows.slice(0, 5).map((r) => r.key), ['freq', 'gain', 'slope', 'q', 'type']);
});

test('L4: another repeat is columns when its instances are at least its rows, else rows', () => {
  const four = { threshold: { unit: 'db' }, ratio: {} };
  assert.equal(matrixOf(only(bands(2, four))).orientation, 'columns');
  assert.equal(matrixOf(only(bands(3, { ...four, attack: { unit: 'ms' }, release: { unit: 'ms' } }))).orientation, 'rows');
});

test('matrixOf refuses a list: a surface never draws a guessed matrix', () => {
  assert.throws(() => matrixOf(only(bands(4, { gain: { unit: 'db' } }))), /not a repeated group/);
});

// ---- the rulings of the review of omx-panel#63 ----

test('S5: a stem held by all but one instance is a row with an empty cell; a crossover that names two numbers is not one', () => {
  const taps = [...bands(3, { gain: { unit: 'db' }, pan: {} }), c('b2_time', 'Band 2 Time', 90), c('b3_time', 'Band 3 Time', 91)];
  const g = only(taps);
  assert.equal(g.kind, 'repeated');
  const m = matrixOf(g);
  const at = m.rows.findIndex((r) => r.label === 'Time');
  assert.ok(at >= 0, JSON.stringify(m.rows));
  assert.deepEqual(m.cells[at], [null, 'b2_time', 'b3_time']);
  assert.deepEqual(g.parameters, []);
  // between four bands, three crossovers: each names two numbers, so none is one band's own
  const split = [...bands(4, { gain: { unit: 'db' }, pan: {} }), c('x1', 'Split 1/2', 90), c('x2', 'Split 2/3', 91), c('x3', 'Split 3/4', 92)];
  const h = only(split);
  assert.deepEqual(h.parameters, ['x1', 'x2', 'x3']);
  assert.deepEqual(matrixOf(h).rows.map((r) => r.label), ['Gain', 'Pan']);
  // held by two of four instances is no row
  const few = [...bands(4, { gain: { unit: 'db' }, pan: {} }), c('b1_time', 'Band 1 Time', 90), c('b2_time', 'Band 2 Time', 91)];
  assert.deepEqual(only(few).parameters, ['b1_time', 'b2_time']);
});

test('S8: a role a control\'s words claim wins over one its unit claims; the unit stands where no word claims it', () => {
  const dyn = { on: { kind: 'toggle' }, freq: { unit: 'hz', min: 20, max: 20000 }, gain: { unit: 'db', min: -18, max: 18 }, q: { min: 0.1, max: 10 }, threshold: { unit: 'db', min: -60, max: 0 }, range: { unit: 'db', min: -24, max: 12 } };
  const g = only(bands(3, dyn));
  const m = matrixOf(g);
  assert.deepEqual(m.rows.map((r) => r.key), ['freq', 'gain', 'q', 'b#_threshold', 'b#_range']);
  assert.deepEqual(m.cells[1], ['b1_gain', 'b2_gain', 'b3_gain']);
  const trim = only(bands(3, { on: { kind: 'toggle' }, freq: dyn.freq, q: dyn.q, trim: { unit: 'db', min: -18, max: 18 } }));
  assert.deepEqual(matrixOf(trim).rows.map((r) => r.key), ['freq', 'gain', 'q']);
});

test('S9: every control opening with an edge word is taken from any list group, the remainder stays; HPF first, LPF last', () => {
  const f = (symbol, name, index, extra = {}) => c(symbol, name, index, { path: ['Filters'], ...extra });
  const controls = [
    f('filterOn', 'Filters', 0, { kind: 'toggle' }),
    f('hpfOn', 'HPF', 1, { kind: 'toggle' }), f('hpfFreq', 'HPF Freq', 2, { unit: 'hz', min: 20, max: 1000 }), f('hpfSlope', 'HPF Slope', 3, { kind: 'choice', options: 2 }),
    f('lpfOn', 'LPF', 4, { kind: 'toggle' }), f('lpfFreq', 'LPF Freq', 5, { unit: 'hz', min: 1000, max: 20000 }),
    ...bands(3, EQ).map((x) => ({ ...x, index: x.index + 10, path: ['EQ'] })),
  ];
  const { groups } = inferGroupModel(controls);
  assert.deepEqual(groups.map((x) => [x.key, x.kind]), [['Filters', 'list'], ['EQ', 'repeated']]);
  assert.deepEqual(groups[0].parameters, ['filterOn']);
  const m = matrixOf(groups[1]);
  assert.deepEqual(m.columns.map((x) => x.key), ['hpf', 'EQ#1', 'EQ#2', 'EQ#3', 'lpf']);
  assert.deepEqual(m.columns.map((x) => x.on?.symbol ?? null).filter(Boolean).slice(0, 1), ['hpfOn']);
  const slope = m.rows.findIndex((r) => r.key === 'slope');
  assert.deepEqual(m.cells[slope], ['hpfSlope', null, null, null, null]);
  // an edge word with no frequency is no edge: its controls stay where they were
  const noFreq = [f('hpfSlope', 'HPF Slope', 0, { kind: 'choice', options: 2 }), ...bands(3, EQ).map((x) => ({ ...x, index: x.index + 10, path: ['EQ'] }))];
  const kept = inferGroupModel(noFreq).groups;
  assert.deepEqual(kept.find((x) => x.key === 'Filters').parameters, ['hpfSlope']);
  assert.equal(kept.find((x) => x.key === 'EQ').edges, undefined);
});

test('S10: a repeated group\'s count is its own whole-number travel, 1..instances, named by the group; anything else is none', () => {
  const four = bands(4, EQ);
  const n = (extra) => c('bandCount', 'Bands', 100, { kind: 'travel', min: 1, max: 4, integer: true, ...extra });
  assert.deepEqual(only([...four, n()]).count, { symbol: 'bandCount' });
  assert.equal(only([...four, n({ max: 5 })]).count, null, 'its maximum is not the instances');
  assert.equal(only([...four, n({ integer: false })]).count, null, 'a continuous travel counts nothing');
  assert.equal(only([...four, n({ name: 'Mode' })]).count, null, 'its name is not the group\'s');
  assert.equal(only(four).count, null);
});

test('L6: only the first `count` instances are drawn, no gap, the edges always; the heads carry their ordinal', () => {
  const g = only([...bands(4, EQ), c('bandCount', 'Bands', 100, { min: 1, max: 4, integer: true }), c('hpf_freq', 'HPF Freq', 101, { unit: 'hz', min: 20, max: 1000 })]);
  assert.deepEqual(matrixOf(g).columns.map((x) => x.key), ['hpf', '#1', '#2', '#3', '#4']);
  const two = matrixOf(g, { values: { bandCount: 2 } });
  assert.deepEqual(two.columns.map((x) => x.label), ['HPF', 'Band 1', 'Band 2']);
  assert.deepEqual(two.cells[0].length, 3);
  assert.deepEqual(matrixOf(g).columns.map((x) => x.ordinal), [null, 0, 1, 2, 3]);
});

test('L7: rows align across bands, a missing control an empty cell; the columns fill the width; one knob selects the column', async () => {
  const { visibleColumns, selectedColumn } = await import('../dist/tools/group-model.mjs');
  const g = only([...bands(3, EQ), c('hpf_freq', 'HPF Freq', 100, { unit: 'hz', min: 20, max: 1000 }), c('hpf_on', 'HPF', 101, { kind: 'toggle' })]);
  const m = matrixOf(g);
  const gain = m.rows.findIndex((r) => r.key === 'gain');
  const freq = m.rows.findIndex((r) => r.key === 'freq');
  assert.equal(m.cells[gain][0], null, 'the HPF has no gain');
  assert.equal(m.cells[freq][0], 'hpf_freq');
  assert.ok(m.cells.every((row) => row.length === m.columns.length));
  assert.deepEqual(m.cells[freq].slice(1), ['b1_freq', 'b2_freq', 'b3_freq']);
  assert.equal(visibleColumns(m, { width: 700, column: 72 }), 4);
  assert.equal(visibleColumns(m, { width: 100, column: 72 }), 1);
  assert.equal(visibleColumns(m, { width: 216, column: 72 }), 3);
  assert.equal(selectedColumn(m, 2).key, m.columns[2].key);
  assert.equal(selectedColumn(m, 99).key, m.columns.at(-1).key);
  assert.deepEqual(selectedColumn(m, 0).cells, m.cells.map((r) => r[0]));
});
