// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The served matrix (docs/group-model.md, "The served matrix: one function, served once, read everywhere"): the group
 * model's servedMatrix is the one place the shape is made; `omx-panel describe` and `describe --layout` carry it on one
 * merged section titled by it, for every grouped plugin; the MOD GUI face draws THAT matrix, never one of its own; the
 * head row is always first (L3, ruled omx-panel#121) and a caption has a row of its own; a cell whose parameter is not its
 * row's carries its own caption in the row's `labels` (omx-panel#122); a count a visibleWhen rule governs is not served; and the
 * visible-column rule answers the cross-language vector (test/fixtures/group-model/visible-columns.json).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { describe } from '../dist/tools/describe.mjs';
import * as model from '../dist/tools/group-model.mjs';
import { GEOMETRY, layout, resolvePanel } from '../dist/tools/modgui-gen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = join(ROOT, 'test', 'fixtures', 'group-model');
const json = (file) => JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
const GROUPED = {
  'omx-eq8': 'test/fixtures/group-model/omx-plugins/omx-eq8.descriptor.json',
  'omx-eq16': 'test/fixtures/group-model/omx-plugins/omx-eq16.descriptor.json',
  'omx-eq32': 'test/fixtures/group-model/omx-plugins/omx-eq32.descriptor.json',
  'omx-strip': 'test/fixtures/group-model/omx-plugins/omx-strip.descriptor.json',
  'omx-dyneq': 'test/fixtures/group-model/omx-plugins/omx-dyneq.descriptor.json',
  'omx-delay': 'test/fixtures/group-model/omx-plugins/omx-delay.descriptor.json',
  mbc: 'test/fixtures/group-model/mbc.descriptor.json',
};

/** `omx-panel describe --layout` of a descriptor, through the command (what the renderer draws). */
function describedLayout(file) {
  const r = spawnSync(process.execPath, [join(ROOT, 'dist/bin/omx-panel.mjs'), 'describe', '--layout', '--descriptor', join(ROOT, file)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, `describe --layout refused ${file}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
const served = (file) => describe(json(file), { where: file }).description.sections.find((s) => s.matrix)?.matrix;
const faceSection = (file, panel) => layout(resolvePanel(json(file), { panel, stem: 'x' })).sections.find((s) => s.matrix);

test('the group model exports the one served-matrix function, and drawnHeads beside it', () => {
  assert.equal(typeof model.servedMatrix, 'function');
  assert.equal(typeof model.drawnHeads, 'function');
});

for (const [name, file] of Object.entries(GROUPED)) {
  test(`${name}: describe --layout serves the merged section and its matrix, titled by it, every placed control in it`, () => {
    const l = describedLayout(file);
    const at = l.sections.flatMap((s, i) => (s.matrix ? [i] : []));
    assert.equal(at.length, 1, `${name}: ${at.length} sections carry a matrix in --layout`);
    const s = l.sections[at[0]];
    const m = s.matrix;
    assert.equal(s.label, m.title, 'the section is titled by the served title');
    assert.deepEqual(m.rows[0].head, true, 'the head row is the first');
    assert.equal(m.rows.filter((r) => r.head).length, 1);
    assert.deepEqual(m.cells[0], m.heads.map((h) => h.on?.symbol ?? null), 'the head row\'s cells are the heads\' on/off');
    for (const sym of [...m.cells.flat().filter(Boolean), ...(m.count ? [m.count.symbol] : [])]) {
      const c = l.controls.find((x) => x.symbol === sym);
      assert.ok(c, `${sym} is a control of the layout`);
      assert.equal(c.section, at[0], `${sym} is in the matrix's section`);
      assert.equal(c.sectionKey, s.key, `${sym}'s sectionKey`);
    }
    for (const d of l.displays) assert.ok(d.section < l.sections.length && l.sections[d.section].key === d.sectionKey, `display ${d.kind}`);
    assert.deepEqual(m, served(file), 'describe and describe --layout serve one matrix');
  });
}

test('the served title is the face\'s: omx-eq8\'s section is "Bands" in the description and on the MOD GUI face', () => {
  const file = GROUPED['omx-eq8'];
  const d = describe(json(file), { where: file }).description;
  const s = d.sections.find((x) => x.matrix);
  assert.equal(s.matrix.title, 'Bands');
  assert.equal(s.label, 'Bands');
  assert.equal(faceSection(file).label, s.label);
});

for (const name of ['omx-eq8', 'omx-strip', 'omx-delay', 'mbc']) {
  test(`${name}: the MOD GUI face draws the served matrix, never one of its own`, () => {
    const file = GROUPED[name];
    const face = faceSection(file);
    assert.deepEqual(face.matrix, served(file));
    assert.equal(face.label, face.matrix.title);
  });
}

test('a head with no on/off has its caption in a row of its own, the first: omx-delay\'s taps never overprint the Gain row', () => {
  const file = GROUPED['omx-delay'];
  const m = served(file);
  assert.deepEqual(m.rows[0], { label: '', head: true });
  assert.deepEqual(m.cells[0], [null, null, null, null]);
  const face = layout(resolvePanel(json(file), { stem: 'x' })).sections.find((s) => s.matrix);
  const gridYs = new Set(face.controls.filter((k) => m.cells.flat().includes(k.symbol)).map((k) => k.y));
  assert.ok(face.captions.length > 0);
  for (const cap of face.captions) assert.ok(!gridYs.has(cap.y), `caption '${cap.text}' at y ${cap.y} overprints a row of controls`);
  assert.ok(face.captions.every((cap) => cap.y < Math.min(...gridYs)), 'the caption row is the first');
});

/** An EQ whose declared panel governs each band by visibleWhen on its count (the visible-when strip). */
function governedStrip() {
  const controls = [
    { symbol: 'eqOn', name: 'EQ', kind: 'toggle', default: true },
    { symbol: 'eqBands', name: 'Bands', kind: 'travel', travel: { min: 1, max: 8, step: 1, default: 4, unit: 'none', scale: 'linear' } },
  ];
  const fields = ['Freq', 'Gain', 'Q', 'Type', 'On'];
  for (let n = 1; n <= 8; n++) {
    controls.push(
      { symbol: `b${n}Freq`, name: `${n} Freq`, kind: 'travel', travel: { min: 20, max: 20000, default: 1000, unit: 'Hz', scale: 'log' } },
      { symbol: `b${n}Gain`, name: `${n} Gain`, kind: 'travel', travel: { min: -18, max: 18, default: 0, unit: 'dB', scale: 'linear' } },
      { symbol: `b${n}Q`, name: `${n} Q`, kind: 'travel', travel: { min: 0.1, max: 10, default: 0.7, unit: 'none', scale: 'log' } },
      { symbol: `b${n}Type`, name: `${n} Type`, kind: 'choice', ids: ['bell', 'shelf'], values: [0, 1], default: 'bell' },
      { symbol: `b${n}On`, name: `${n} On`, kind: 'toggle', default: true },
    );
  }
  controls.forEach((c, i) => { c.id = i; c.group = ['EQ']; });
  const bands = [1, 2, 3, 4, 5, 6, 7, 8];
  const panel = {
    family: 'none',
    sections: [{ key: 'eq', label: 'EQ', controls: ['eqOn', 'eqBands', ...bands.flatMap((n) => fields.map((f) => `b${n}${f}`))] }],
    visibleWhen: Object.fromEntries(bands.flatMap((n) => fields.map((f) => [`b${n}${f}`, { param: 'eqBands', atLeast: n }]))),
  };
  return { descriptor: { plugin: { id: 'urn:example:strip-eq', format: 'lv2', name: 'Strip EQ', vendor: 'Example' }, origin: 'authored', controls }, panel };
}

test('a count a visibleWhen rule governs is not served: every band keeps its cell, the rule hides it (red when governed is ignored)', () => {
  const { descriptor, panel } = governedStrip();
  const d = describe(descriptor, { panel, where: 'governed' }).description;
  const m = d.sections.find((s) => s.matrix)?.matrix;
  assert.ok(m, 'the governed EQ is served as a matrix');
  assert.equal(m.count, undefined, 'a governed count is not served');
  assert.equal(m.heads.filter((h) => h.edge === null).length, 8);
  const face = layout(resolvePanel(descriptor, { panel, stem: 'strip' })).sections.find((s) => s.matrix);
  assert.ok(face.controls.some((k) => k.symbol === 'b8Freq'), 'band 8 stays on the face, hidden by its rule');
  assert.deepEqual(model.drawnHeads(face.matrix, 4).length, 8, 'no count closes a governed matrix up');
});

test('visibleColumns and selectedColumn take the served matrix and never throw on it', () => {
  for (const file of Object.values(GROUPED)) {
    const m = served(file);
    assert.doesNotThrow(() => model.visibleColumns(m, { width: 500, column: GEOMETRY.cellW }), file);
    const sel = model.selectedColumn(m, 1);
    assert.equal(sel.cells.length, m.rows.length, file);
    assert.equal(sel.cells[0], sel.on?.symbol ?? null, `${file}: the head row is the column's first cell`);
  }
  const eq8 = served(GROUPED['omx-eq8']);
  assert.equal(model.selectedColumn(eq8, 0).edge, 'hpf');
  assert.equal(model.selectedColumn(eq8, 99).edge, 'lpf');
  // the count closes the selectable heads up too: omx-strip at 4 bands selects among HPF, 4 bands, LPF
  assert.equal(model.selectedColumn(served(GROUPED['omx-strip']), 5).edge, 'lpf');
});

test('the visible-column rule answers the cross-language vector (the C renderer reads the same file)', () => {
  const { vectors } = JSON.parse(readFileSync(join(CORPUS, 'visible-columns.json'), 'utf8'));
  assert.ok(vectors.length >= 8);
  for (const v of vectors) {
    const m = describedLayout(v.descriptor).sections.find((s) => s.matrix).matrix;
    assert.equal(model.visibleColumns(m, { width: v.width, column: GEOMETRY.cellW * v.scale, ...(v.count !== undefined ? { count: v.count } : {}) }), v.expect, v.name);
  }
});

test('one section merge: the home is the matrix\'s, a folded or donor section stays only while it still holds something', () => {
  assert.equal(typeof model.mergedSections, 'function');
  const placed = { home: 'b1', folded: ['b2'], donors: ['hpf', 'filters'], members: new Set() };
  const sections = ['in', 'hpf', 'b1', 'b2', 'filters', 'out'].map((id) => ({ id }));
  const holds = new Set(['in', 'filters', 'out']);
  const out = model.mergedSections(placed, sections, { idOf: (s) => s.id, holdsAfter: (s) => holds.has(s.id) });
  assert.deepEqual(out.map((x) => [x.section.id, x.home]), [['in', false], ['b1', true], ['filters', false], ['out', false]]);
});

test('L6: a row empty at every drawn head is left out: omx-delay\'s Time row at one tap, back at two; the head row always', () => {
  const mx = served(GROUPED['omx-delay']);
  const time = mx.rows.findIndex((r) => r.label === 'Time');
  assert.ok(time > 0 && mx.count?.default === 1);
  const lines = (count) => model.drawnLines(mx, model.drawnHeads(mx, count)).map((li) => mx.rows[li].label);
  assert.deepEqual(lines(), ['', 'Gain', 'Pan'], 'tap 1 has no Time cell: no Time row');
  assert.deepEqual(lines(1), ['', 'Gain', 'Pan']);
  assert.deepEqual(lines(2), ['', 'Gain', 'Pan', 'Time']);
  assert.deepEqual(lines(0), [''], 'no tap drawn: the head row alone');
  // the EQ's rows are all held by some band: none is left out
  const eq = served(GROUPED['omx-eq8']);
  assert.equal(model.drawnLines(eq).length, eq.rows.length);
});
