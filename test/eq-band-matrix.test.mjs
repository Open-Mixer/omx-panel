// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The owner's rule for every grouped EQ drawing (docs/group-model.md, L7 and P1): ONE aligned band matrix, the high-pass
 * its first band and the low-pass its last, the parametric bands between in their number order; every screen walks that
 * order and keeps each parameter at the same place in every band. The audio order is untouched: no id moves.
 *
 * Over `omx-panel describe`, as a surface reads it, for omx-eq8 and omx-eq16 both as omx-plugins ships their descriptors
 * (test/fixtures/group-model/omx-plugins) and as a host's scan writes them (test/fixtures/descriptors/scanned-*: the
 * omx-eq16 one is `plugin-hostd-probe describe lv2:urn:openmixer:eq16` over omx-plugins-lv2 0.19.3, the file as written).
 * Both plugins declare their parameters HPF, LPF, Band 1 .. Band N.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { controlsOfDescriptor, inferGroupModel } from '../dist/tools/group-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test', 'fixtures');
const EQS = [
  { name: 'omx-eq8, shipped descriptor', file: 'group-model/omx-plugins/omx-eq8.descriptor.json', bands: 8 },
  { name: 'omx-eq16, shipped descriptor', file: 'group-model/omx-plugins/omx-eq16.descriptor.json', bands: 16 },
  { name: 'omx-eq8, LV2 scan', file: 'descriptors/scanned-lv2-omx-eq8.json', bands: 8 },
  { name: 'omx-eq16, LV2 scan', file: 'descriptors/scanned-lv2-omx-eq16.json', bands: 16 },
  { name: 'omx-eq8, CLAP scan', file: 'descriptors/scanned-clap-omx-eq8.json', bands: 8 },
];
const WIDTHS = [4, 5, 8];

function command(file, ...args) {
  const r = spawnSync(process.execPath, [join(ROOT, 'dist/bin/omx-panel.mjs'), 'describe', '--descriptor', join(FIXTURES, file), ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const descriptorOf = (file) => JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
/** The symbol the description serves a descriptor control by: its symbol, else its id. */
const served = (c) => c.symbol ?? String(c.id);

/** The one matrix of an EQ's description; fails by name when the description carries none, or two. */
function matrixOf(file) {
  const withMatrix = command(file).description.sections.filter((s) => s.matrix);
  assert.equal(withMatrix.length, 1, `one section carries the band matrix; the sections with one: [${withMatrix.map((s) => s.key)}]`);
  return withMatrix[0].matrix;
}
const order = (bands) => ['HPF', ...Array.from({ length: bands }, (_, i) => `Band ${i + 1}`), 'LPF'];
/** symbol -> { column, row } of a served matrix, the head row's cells (each head's on/off) among them. */
function placesOf(m) {
  const at = new Map();
  m.cells.forEach((row, r) => row.forEach((symbol, column) => { if (symbol !== null) at.set(symbol, { column, row: m.rows[r].label }); }));
  return at;
}
/** The instance pages of a cut: each as its slots, a slot `{ column, row }` or null, the Easy pages and the pages of no band left out. */
function bandPages(file, perPage, places) {
  const symbolOf = new Map(descriptorOf(file).controls.map((c) => [c.id, served(c)]));
  return command(file, '--pages', '--per-page', String(perPage))
    .filter((p) => p.section !== null)
    .map((p) => ({ name: p.pageName, slots: p.ids.map((id) => (id === null ? null : places.get(symbolOf.get(id)) ?? { column: -1, row: symbolOf.get(id) })) }))
    .filter((p) => p.slots.some((s) => s && s.column >= 0));
}
/** The band screens of a cut (the controls of one band) and its row screens (one row of the matrix across several bands). */
function splitScreens(pages) {
  const several = (p) => new Set(p.slots.filter(Boolean).map((s) => s.column)).size > 1;
  return { bands: pages.filter((p) => !several(p)), rows: pages.filter(several) };
}

for (const eq of EQS) {
  test(`${eq.name}: the band matrix is HPF, Band 1 .. Band ${eq.bands}, LPF`, () => {
    const m = matrixOf(eq.file);
    assert.equal(m.orientation, 'columns');
    assert.deepEqual(m.heads.map((h) => h.label), order(eq.bands));
    assert.deepEqual(m.heads.map((h) => h.edge), ['hpf', ...Array(eq.bands).fill(null), 'lpf']);
  });

  test(`${eq.name}: the matrix is aligned, a row is one parameter in every band`, () => {
    const m = matrixOf(eq.file);
    const nameOf = new Map(descriptorOf(eq.file).controls.map((c) => [served(c), c.name]));
    assert.deepEqual(m.rows.map((r) => r.label), ['On', 'Frequency', 'Gain', 'Q', 'Type']);
    m.rows.forEach((row, r) => {
      // a band's control is called "Band <n> <parameter>": the parameter is the row's, in every band
      const words = m.cells[r].slice(1, -1).map((symbol, i) => (symbol === null ? null : nameOf.get(symbol).replace(`Band ${i + 1} `, '')));
      assert.deepEqual(words, Array(eq.bands).fill(row.label), `row ${row.label}`);
    });
    // the edges sit on the bands' rows: their frequency on Frequency, their slope on Gain, their on/off on On
    const edge = (column, row) => nameOf.get(m.cells[m.rows.findIndex((r) => r.label === row)].at(column));
    assert.deepEqual([edge(0, 'Frequency'), edge(0, 'Gain'), edge(0, 'On')], ['HPF Frequency', 'HPF Slope', 'HPF On']);
    assert.deepEqual([edge(-1, 'Frequency'), edge(-1, 'Gain'), edge(-1, 'On')], ['LPF Frequency', 'LPF Slope', 'LPF On']);
  });

  for (const perPage of WIDTHS) {
    test(`${eq.name} at ${perPage} slots: the screens walk HPF, the bands, LPF, one band a screen, each run contiguous`, () => {
      const m = matrixOf(eq.file);
      const { bands: pages } = splitScreens(bandPages(eq.file, perPage, placesOf(m)));
      const columns = pages.map((p) => [...new Set(p.slots.filter(Boolean).map((s) => s.column))]);
      for (const [i, held] of columns.entries()) assert.equal(held.length, 1, `${pages[i].name} holds the controls of one band, not of ${held.map((c) => m.heads[c]?.label ?? 'no band')}`);
      // the screens in order: each band's screens together, the bands in the matrix's order, none left out
      const walked = columns.map(([c]) => c).filter((c, i, all) => c !== all[i - 1]);
      assert.deepEqual(walked.map((c) => m.heads[c].label), order(eq.bands));
    });

    test(`${eq.name} at ${perPage} slots: a screen of several bands is one row of the matrix over a contiguous run, band j on slot j`, () => {
      const m = matrixOf(eq.file);
      const { rows } = splitScreens(bandPages(eq.file, perPage, placesOf(m)));
      // a band is longer than the page only below five slots (on, freq, gain, q, type): its type is then a row screen
      assert.equal(rows.length > 0, perPage < 5, rows.map((p) => p.name).join(', '));
      for (const p of rows) {
        const held = p.slots.filter(Boolean);
        assert.equal(new Set(held.map((s) => s.row)).size, 1, `${p.name} holds one row`);
        const at = p.slots.map((s) => s?.column ?? null);
        assert.ok(at.every((c, j) => c === null || j === 0 || at[j - 1] === null || c === at[j - 1] + 1), `${p.name}: the bands of a contiguous run, in order: ${at}`);
        assert.ok(p.slots.length <= perPage);
      }
      // every band's type is on one row screen, once
      const types = rows.flatMap((p) => p.slots.filter(Boolean)).filter((s) => s.row === 'Type').map((s) => m.heads[s.column].label);
      assert.deepEqual(types, perPage < 5 ? order(eq.bands).slice(1, -1) : []);
    });

    test(`${eq.name} at ${perPage} slots: place k of a band's screens is the same parameter in every band`, () => {
      const m = matrixOf(eq.file);
      const { bands: pages } = splitScreens(bandPages(eq.file, perPage, placesOf(m)));
      // a band's places: its screens end to end, a blank slot counted
      const placesByColumn = new Map();
      for (const p of pages) {
        const column = p.slots.find(Boolean).column;
        placesByColumn.set(column, [...(placesByColumn.get(column) ?? []), ...p.slots.map((s) => s?.row ?? null)]);
      }
      const placeOfRow = new Map();
      for (const [column, rows] of placesByColumn) rows.forEach((row, k) => {
        if (row === null) return;
        if (!placeOfRow.has(row)) placeOfRow.set(row, { k, label: m.heads[column].label });
        assert.equal(k, placeOfRow.get(row).k, `${row} is at place ${placeOfRow.get(row).k} of ${placeOfRow.get(row).label} and at place ${k} of ${m.heads[column].label}`);
      });
      assert.equal(placeOfRow.get('On').k, 0, 'a band\'s screen opens with its on/off');
    });
  }

  test(`${eq.name}: the audio order is untouched, the drawing moves no parameter id`, () => {
    const d = descriptorOf(eq.file);
    const params = command(eq.file).description.params.map((p) => p.symbol);
    assert.deepEqual(params.filter((s) => d.controls.some((c) => served(c) === s)), d.controls.map(served));
  });
}

test('an EQ with no high-pass and no low-pass keeps its band order: omx-dyneq, Band 1 .. Band 6', () => {
  const m = matrixOf('group-model/omx-plugins/omx-dyneq.descriptor.json');
  assert.deepEqual(m.heads.map((h) => h.label), Array.from({ length: 6 }, (_, i) => `Band ${i + 1}`));
  assert.deepEqual(m.heads.map((h) => h.edge), Array(6).fill(null));
});

// -- the two things a CLAP scan does not state (docs/group-model.md, "A descriptor of any origin is read"), each held on the
// model itself, so the arm that fails names what was decided and not only that no matrix came out. These read dist/, as
// every arm here does: `npm test` builds first, a bare `node --test` after an edit reads the build before it.
const CLAP = 'descriptors/scanned-clap-omx-eq8.json';
/** The CLAP scan's EQ group, and the layout key (`p<id>`) of the control a name names. */
function clapBands() {
  const d = descriptorOf(CLAP);
  const key = (name) => `p${d.controls.find((c) => c.name === name).id}`;
  const g = inferGroupModel(controlsOfDescriptor(d)).groups.find((x) => x.label === 'Bands');
  return { g, key };
}

test('omx-eq8, CLAP scan: a band holds the controls whose NAME carries its number, whatever digits their ids have', () => {
  const { g, key } = clapBands();
  // read from the id's digits (`p7` .. `p10` for Band 1) the declared band disagrees with its controls and is refused
  assert.deepEqual({ kind: g.kind, reason: g.reason ?? null, detail: g.detail ?? null }, { kind: 'repeated', reason: null, detail: null });
  assert.deepEqual(g.instances.map((i) => i.label), Array.from({ length: 8 }, (_, i) => `Band ${i + 1}`));
  for (const [i, band] of g.instances.entries()) {
    const n = i + 1;
    const { type, freq, gain, q } = band.parameters;
    assert.deepEqual({ type, freq, gain, q }, { type: key(`Band ${n} Type`), freq: key(`Band ${n} Frequency`), gain: key(`Band ${n} Gain`), q: key(`Band ${n} Q`) }, `Band ${n}`);
  }
});

test('omx-eq8, CLAP scan: a 0..1 whole-number travel called On is the band\'s head toggle, not a row', () => {
  const { g, key } = clapBands();
  assert.equal(g.kind, 'repeated', g.reason);
  assert.deepEqual(g.instances.map((i) => i.on), Array.from({ length: 8 }, (_, i) => ({ symbol: key(`Band ${i + 1} On`), sense: 'on' })));
  assert.deepEqual(g.edges.map((e) => [e.edge, e.on]), [['hpf', { symbol: key('HPF On'), sense: 'on' }], ['lpf', { symbol: key('LPF On'), sense: 'on' }]]);
  assert.deepEqual(g.rows.map((r) => r.key), ['freq', 'gain', 'q', 'type'], 'no On row: the on/off is each head\'s');
});
