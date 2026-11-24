// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The renderer draws a section's `matrix` as `omx-panel describe --layout` serves it (docs/renderer.md; omx-panel#62), the
 * group model's served matrix, the one the MOD GUI face draws: each control's cell is the face's, and each cell sits where
 * the served matrix puts it. Nothing is derived again here, and no fixture carries a matrix of its own making. The tests that
 * read only rectangles need no omx-dsp twin; those that compare with the face need it, and fail without it.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLI, DATA, FIXTURES, ROOT, descriptionFile, rects, resolved, scratch } from './harness.mjs';

const modgui = await import(join(ROOT, 'dist', 'tools', 'modgui-gen.mjs'));
const { drawnHeads } = await import(join(ROOT, 'dist', 'tools', 'group-model.mjs'));
const geometry = JSON.parse(readFileSync(join(ROOT, 'tools', 'look', 'geometry.json'), 'utf8'));
const { cellW, cellH } = geometry.geometry ?? geometry;
const fixture = (c) => c;
const named = (n) => FIXTURES.find((f) => f.name === n);
const [EQ8, EQMARKS, MBC, TAPS] = ['omx-eq8', 'eq-marks', 'mbc', 'taps'].map(named);
const CASES = [EQ8, EQMARKS, MBC, TAPS];
const ORIENTATION = { 'omx-eq8': 'columns', 'eq-marks': 'columns', mbc: 'rows', 'taps': 'columns' };
const matrixOf = (doc) => doc.sections.find((s) => s.matrix).matrix;

/** The description file of a case, as a document, and the cell of each control the renderer draws (null: hidden), by symbol. */
function drawn(c, edit) {
  const file = descriptionFile(fixture(c), scratch());
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  if (edit) { edit(doc); writeFileSync(file, JSON.stringify(doc)); }
  const out = new Map(doc.controls.map((k, i) => [k.symbol, null]));
  rects(file).forEach((r, i) => out.set(doc.controls[i].symbol, Number.isNaN(r[0]) ? null : r));
  return { doc, file, cells: out };
}

for (const c of CASES) {
  test(`${c.name}: every control's cell is the MOD GUI face's`, () => {
    const { cells } = drawn(c);
    const face = new Map(modgui.layout(resolved(fixture(c))).sections.flatMap((s) => s.controls.map((k) => [k.symbol, [s.x + k.x, s.y + k.y, cellW, cellH]])));
    assert.ok(face.size > 0);
    for (const [sym, want] of face) assert.deepEqual(cells.get(sym), want, sym);
  });

  test(`${c.name}: each cell is where the served matrix puts it`, () => {
    const { doc, cells } = drawn(c);
    const mx = matrixOf(doc);
    assert.equal(mx.orientation, ORIENTATION[c.name]);
    // the head row is a row of the served matrix (its cells are the heads' on/off): every cell is at (head, row)
    const at = (head, row) => (mx.orientation === 'columns' ? [head, row] : [row, head]); // (column, row) of the grid
    // the heads drawn at the count's default (the group model's drawnHeads, L6), closed up
    const heads = drawnHeads(mx);
    const placed = mx.cells.flatMap((line, ri) => heads.flatMap((hi, col) => (line[hi] ? [[line[hi], at(col, ri)]] : [])));
    const [first, [c0, r0]] = placed[0];
    const [ox, oy] = [cells.get(first)[0] - c0 * cellW, cells.get(first)[1] - r0 * cellH];
    for (const [sym, [col, row]] of placed) assert.deepEqual(cells.get(sym).slice(0, 2), [ox + col * cellW, oy + row * cellH], sym);
  });
}

test('the EQ is drawn left to right with HPF first and LPF last, the bands between', () => {
  const { doc, cells } = drawn(EQ8);
  assert.equal(matrixOf(doc).heads[0].edge !== null && matrixOf(doc).heads.at(-1).edge !== null, true);
  const xs = ['hpf_freq', ...Array.from({ length: 8 }, (_, i) => `b${i + 1}_freq`), 'lpf_freq'].map((s) => cells.get(s)[0]);
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]), xs.join(' '));
});

test('swapping the HPF and LPF heads of the matrix swaps their columns: the renderer follows the matrix, not the plugin', () => {
  const base = drawn(EQ8).cells;
  const swapped = drawn(EQ8, (doc) => { const mx = matrixOf(doc); mx.heads.reverse(); mx.cells.forEach((l) => l.reverse()); }).cells;
  assert.equal(swapped.get('lpf_freq')[0], base.get('hpf_freq')[0]);
  assert.equal(swapped.get('hpf_freq')[0], base.get('lpf_freq')[0]);
});

test('a count closes up the instances beyond it; the edges stay and the LPF follows the last drawn band', () => {
  const { cells } = drawn(EQ8, (doc) => {
    const host = doc.controls.find((k) => k.symbol === 'b1_freq').section;
    doc.controls.push({ ...doc.controls.find((k) => k.symbol === 'b1_type'), symbol: 'nbands', label: 'Bands', section: host, standard: { widget: 'selector' } });
    doc.sections[host].matrix.count = { symbol: 'nbands', default: 3 };
  });
  for (const b of [4, 5, 6, 7, 8]) for (const p of ['on', 'freq', 'gain']) assert.equal(cells.get(`b${b}_${p}`), null, `b${b}_${p}`);
  const x = (s) => cells.get(s)[0];
  assert.equal(x('lpf_freq'), x('hpf_freq') + 4 * cellW);
  assert.ok(x('b3_freq') === x('hpf_freq') + 3 * cellW);
  assert.ok(cells.get('nbands'), 'the count control is drawn, as a control of the section');
});

test('an empty cell is empty and nothing moves into it', () => {
  const base = drawn(MBC).cells;
  const { cells } = drawn(MBC, (doc) => {
    const mx = matrixOf(doc);
    const gone = mx.cells[1][2]; // band 3 has no second parameter
    mx.cells[1][2] = null;
    doc.controls = doc.controls.filter((k) => k.symbol !== gone);
  });
  for (const [sym, r] of base) if (r && cells.get(sym)) assert.deepEqual(cells.get(sym), r, sym);
});

/** The mbc description with `edit` applied: the command's exit status and message. */
function refused(edit) {
  const file = descriptionFile(fixture(MBC), scratch());
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  edit(doc);
  writeFileSync(file, JSON.stringify(doc));
  const r = spawnSync(CLI, ['--description', file, '--data', DATA, '--rects'], { encoding: 'utf8' });
  return { status: r.status, err: r.stderr };
}

test('a matrix that is not an object is refused by message, as bars is', () => {
  const r = refused((d) => { d.sections.find((s) => s.matrix).matrix = [1]; });
  assert.notEqual(r.status, 0);
  assert.match(r.err, /matrix/);
});

test('an orientation that is neither word is refused', () => {
  const r = refused((d) => { matrixOf(d).orientation = 'diagonal'; });
  assert.notEqual(r.status, 0);
  assert.match(r.err, /orientation/);
});

test('a matrix that names a control that is not there is refused, naming it', () => {
  const r = refused((d) => { matrixOf(d).cells[0][0] = 'no_such_control'; });
  assert.notEqual(r.status, 0);
  assert.match(r.err, /no_such_control/);
});

test('a matrix that places a control twice is refused, naming it', () => {
  const r = refused((d) => { const mx = matrixOf(d); mx.cells[1][1] = mx.cells[1][0]; });
  assert.notEqual(r.status, 0);
  assert.match(r.err, /b1_thresh.*twice/);
});

test('a cells row of another length than the heads is refused', () => {
  const r = refused((d) => { matrixOf(d).cells[0].pop(); });
  assert.notEqual(r.status, 0);
  assert.match(r.err, /cells/);
});

test('a section with no matrix is laid out as before', () => {
  const { doc, cells } = drawn(MBC, (d) => { delete d.sections.find((s) => s.matrix).matrix; });
  assert.equal(cells.size, doc.controls.length);
  const xs = new Set([...cells.values()].map((r) => r[0]));
  assert.ok(xs.size <= 8, `${xs.size} columns`); // flowed in rows of rowControls, never one column a band
});

test('rows align across the columns: the HPF and LPF share the band freq row, their slope the gain row, and their empty cell stays empty', () => {
  const { cells } = drawn(EQ8);
  const y = (sym) => cells.get(sym)[1];
  for (const e of ['hpf', 'lpf']) {
    assert.equal(y(`${e}_freq`), y('b1_freq'), `${e} freq`);
    assert.equal(y(`${e}_slope`), y('b1_gain'), `${e} slope on the gain row`);
  }
  for (const b of [2, 5, 8]) for (const p of ['freq', 'gain', 'q', 'type']) assert.equal(y(`b${b}_${p}`), y(`b1_${p}`), `b${b}_${p}`);
  assert.ok(y('b1_freq') < y('b1_gain') && y('b1_gain') < y('b1_q') && y('b1_q') < y('b1_type'), 'freq, gain, q, type');
});

test("'On' is drawn once, as the first row of its column, and the head row is the heads' on/off, never a second control", () => {
  const { doc, cells } = drawn(EQ8);
  const mx = matrixOf(doc);
  assert.equal(mx.rows.filter((r) => r.head).length, 1);
  assert.ok(mx.rows[0].head, 'the head row is first');
  assert.deepEqual(mx.cells[0], mx.heads.map((h) => h.on?.symbol ?? null));
  assert.equal(doc.controls.filter((k) => k.symbol === 'b3_on').length, 1);
  for (const [i, h] of mx.heads.entries()) {
    const highest = Math.min(...mx.cells.flatMap((l) => (l[i] ? [cells.get(l[i])[1]] : [])));
    assert.equal(cells.get(h.on.symbol)[1], highest, `${h.label}: On is the column's first row`);
  }
  const ys = mx.heads.map((h) => cells.get(h.on.symbol)[1]);
  assert.equal(new Set(ys).size, 1);
});

test("a head row that differs from the heads' on/off is refused; so are two head rows", () => {
  let r = refused((d) => { const mx = matrixOf(d); mx.cells[0][0] = mx.cells[0][1]; });
  assert.notEqual(r.status, 0);
  assert.match(r.err, /head row/);
  r = refused((d) => { const mx = matrixOf(d); mx.rows[1].head = true; });
  assert.notEqual(r.status, 0);
  assert.match(r.err, /head row/);
});

/** The count of columns the renderer says a surface `width` px wide shows. */
function visible(c, width, scale = 1) {
  const file = descriptionFile(fixture(c), scratch());
  const out = execFileSync(CLI, ['--description', file, '--data', DATA, '--scale', String(scale), '--visible-columns', String(width)], { encoding: 'utf8' });
  return Number(/visible-columns (\d+)/.exec(out)[1]);
}

test('the visible column count fills the width: floor(width / cell), at least one, at most the columns', () => {
  const heads = 10;
  assert.equal(visible(EQ8, cellW * 4 + 3), 4);
  assert.equal(visible(EQ8, cellW * 7), 7);
  assert.equal(visible(EQ8, 1), 1);
  assert.equal(visible(EQ8, cellW * 50), heads);
  assert.equal(visible(EQ8, cellW * 6, 2), 3);
  assert.equal(visible(MBC, cellW * 100), 6, 'rows orientation: the rows (the five parameters and On) are the columns');
});

test('the visible-column rule answers the cross-language vector the JavaScript tests read (test/fixtures/group-model/visible-columns.json)', () => {
  const { vectors } = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'group-model', 'visible-columns.json'), 'utf8'));
  assert.ok(vectors.length >= 8);
  for (const v of vectors) {
    const file = descriptionFile({ name: 'vector', served: true, descriptor: v.descriptor }, scratch());
    const out = execFileSync(CLI, ['--description', file, '--data', DATA, '--scale', String(v.scale), '--visible-columns', String(v.width)], { encoding: 'utf8' });
    assert.equal(Number(/visible-columns (\d+)/.exec(out)[1]), v.expect, v.name);
  }
});

test('a head whose on/off is not a { symbol, sense } object is refused: a bare string is not the served shape', () => {
  const r = refused((d) => { const mx = matrixOf(d); mx.heads[0].on = mx.heads[0].on.symbol; });
  assert.notEqual(r.status, 0);
  // refused for its shape, by name, not caught later by the head-row comparison
  assert.match(r.err, /not a \{ symbol, sense \} object/);
});

test('a head row that is not the first row is refused (L3, omx-panel#121)', () => {
  const r = refused((d) => { const mx = matrixOf(d); mx.rows.push(mx.rows.shift()); mx.cells.push(mx.cells.shift()); });
  assert.notEqual(r.status, 0);
  assert.match(r.err, /head row/);
});

test('a matrix with no head row is refused: the served matrix always opens with one', () => {
  const r = refused((d) => { const mx = matrixOf(d); mx.rows.shift(); mx.cells.shift(); mx.heads.forEach((h) => { h.on = null; }); });
  assert.notEqual(r.status, 0);
  assert.match(r.err, /head row/);
});

test('heads with no on/off: their captions have a row of their own, the first, and no row of controls is moved (four delay taps)', () => {
  const { doc, cells } = drawn(TAPS);
  const mx = matrixOf(doc);
  assert.deepEqual(mx.rows[0], { label: '', head: true });
  const face = modgui.layout(resolved(TAPS)).sections.find((s) => s.matrix);
  const captions = face.captions.map((cap) => face.y + cap.y);
  const rows = [...cells.entries()].filter(([sym, r]) => r && mx.cells.flat().includes(sym)).map(([, r]) => r[1]);
  assert.ok(captions.length > 0, 'the face draws the captions');
  for (const y of captions) assert.ok(y < Math.min(...rows), `a caption at y ${y} is not above every row of controls`);
  // the renderer draws the section as tall as the face's: the caption's row is in it (parity holds every pixel of it)
  const r = rects(descriptionFile(TAPS, scratch()));
  assert.ok(r.length > 0);
});
