// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The renderer repaints only what changed, and says where (omx_panel_view_draw_dirty, docs/renderer.md "Dirty rectangles", #78). A host
 * that blits only those rectangles must end with the panel a full draw would give, so each check reads the buffer before a step, the
 * buffer after it, and a full draw of the same state made by a view made anew (`omx-panel-render --steps`):
 *  - a change of one control reports that control's cell, grown by the bleed the drawing declares, and no other rectangle;
 *  - a state that changed nothing reports no rectangle and leaves every byte;
 *  - every byte outside the reported rectangles is what the step started with, and the buffer equals the full draw, byte for byte, over
 *    random sequences of reads, meter ticks, curve points and visibility changes, in both pixel formats;
 *  - the first draw, and a draw into a buffer of another size, are a full draw reported as the whole buffer.
 * An arm makes the draw report the whole panel for every change (or no rectangle for one): the one-control check goes red, and the
 * equality check goes red for an arm that reports too little.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLI, DATA, FIXTURES, descriptionFile, rects, resolved, scratch, stateFile } from './harness.mjs';
import { firstDiff, outsideUntouched, prng, steps } from './dirty-harness.mjs';

/** How far a widget's pixels reach beyond its cell, in logical px (view.c BLEED), and a display's. */
const BLEED = 4;

/** A fixture's files, its panel size and its controls (symbol and widget, in the description's order). */
function open(name, { edit, state: editState } = {}) {
  const fx = FIXTURES.find((f) => f.name === name);
  const dir = scratch();
  let description = descriptionFile(fx, dir);
  let state = stateFile(fx, dir);
  if (edit) {
    const x = edit(JSON.parse(readFileSync(description, 'utf8')));
    description = join(dir, 'edited.layout.json');
    writeFileSync(description, JSON.stringify(x));
  }
  if (editState) {
    const x = editState(JSON.parse(readFileSync(state, 'utf8')));
    state = join(dir, 'edited.state.json');
    writeFileSync(state, JSON.stringify(x));
  }
  const p = resolved(fx);
  const controls = p.sections.flatMap((s) => s.controls).filter((k) => k.widget !== 'display');
  const cells = rects(description);
  return { fx, description, state, controls, cells, values: JSON.parse(readFileSync(state, 'utf8')).values, meters: p.meters ?? [] };
}

/** A step that moves control `symbol` to `fraction` with a text of its own. */
const move = (symbol, fraction, text) => ({ values: { [symbol]: { fraction, text } } });

test('the first draw is a full draw, reported as the whole buffer', () => {
  const f = open('omx-delay');
  const [first] = steps(f.description, f.state, []);
  assert.equal(first.rects.length, 1);
  assert.equal(first.rects[0][0] + first.rects[0][1], 0);
  assert.equal(first.rects[0][2], first.width);
  assert.equal(first.rects[0][3], first.height);
  assert.equal(firstDiff(first.after, first.full), -1, 'the first draw is the full draw');
});

test('one control changed reports that control\'s cell and nothing else, and the buffer is the full draw', () => {
  const f = open('omx-delay');
  const knobs = f.controls.filter((k) => ['knob', 'fader', 'switch', 'selector'].includes(k.widget));
  assert.ok(knobs.length >= 4, 'the fixture has controls to move');
  const order = f.controls.map((k) => k.symbol);
  const deltas = knobs.map((k, n) => move(k.symbol, n % 2 ? 0.93 : 0.07, `v${n}`));
  const out = steps(f.description, f.state, deltas);
  knobs.forEach((k, n) => {
    const s = out[n + 1], cell = f.cells[order.indexOf(k.symbol)];
    assert.equal(s.rects.length, 1, `${k.symbol}: ${JSON.stringify(s.rects)} is one rectangle`);
    const [x, y, rw, rh] = s.rects[0];
    assert.ok(x <= cell[0] && y <= cell[1] && x + rw >= cell[0] + cell[2] && y + rh >= cell[1] + cell[3], `${k.symbol}: ${s.rects[0]} covers its cell ${cell}`);
    const want = [Math.floor(cell[0] - BLEED), Math.floor(cell[1] - BLEED), Math.ceil(cell[0] + cell[2] + BLEED), Math.ceil(cell[1] + cell[3] + BLEED)].map((v) => Math.max(0, v));
    assert.deepEqual([x, y, x + rw, y + rh], want, `${k.symbol}: the rectangle is the cell ${cell} grown by exactly the bleed`);
    assert.notEqual(firstDiff(s.after, s.before), -1, `${k.symbol}: the step moved pixels`);
    assert.equal(outsideUntouched(s), null);
    assert.equal(firstDiff(s.after, s.full), -1, `${k.symbol}: the buffer is the full draw`);
  });
});

test('a state that changed nothing reports no rectangle and leaves every byte', () => {
  const f = open('omx-delay');
  const k = f.controls[0].symbol;
  const out = steps(f.description, f.state, [move(k, 0.5, 'a'), move(k, 0.5, 'a'), {}]);
  assert.equal(out[1].rects.length, 1);
  for (const n of [2, 3]) {
    assert.deepEqual(out[n].rects, [], `step ${n} reports none`);
    assert.equal(firstDiff(out[n].after, out[n].before), -1);
    assert.equal(firstDiff(out[n].after, out[n].full), -1);
  }
});

test('a meter tick reports the meter\'s frame inside the band, and a curve its display', () => {
  const m = open('meters');
  const sym = m.meters[0]?.symbol ?? 'in_level';
  const out = steps(m.description, m.state, [{ meters: { [sym]: [{ value: -12, elapsed: 0.01 }] } }, { meters: { [sym]: [{ value: -30, elapsed: 0.5 }] } }]);
  for (const s of out.slice(1)) {
    assert.equal(s.rects.length, 1, `a meter: ${JSON.stringify(s.rects)}`);
    assert.ok(s.rects[0][3] < 80, `the meter's own frame, not the panel: ${s.rects[0]}`);
    assert.equal(outsideUntouched(s), null);
    assert.equal(firstDiff(s.after, s.full), -1);
  }
  const r = open('omx-reverb');
  const env = steps(r.description, r.state, [{ curves: { 0: { x: [0, 50, 100, 200], y: [0, -10, -25, -50] } } }, { curves: { 0: { x: [0, 60, 120, 240], y: [0, -8, -20, -45] } } }]);
  for (const s of env.slice(1)) {
    assert.equal(s.rects.length, 1, `a curve: ${JSON.stringify(s.rects)}`);
    assert.equal(outsideUntouched(s), null);
    assert.equal(firstDiff(s.after, s.full), -1);
  }
});

for (const name of ['omx-delay', 'organ', 'meters', 'omx-reverb', 'zamcomp-panel'])
  for (const [format, alpha, scale] of [['rgba', 'premultiplied', 1], ['bgra', 'straight', 2], ['rgba', 'straight', 1.5], ['bgra', 'premultiplied', 1.25]])
    test(`${name} (${format} ${alpha} x${scale}): random changes, the buffer is the full draw after each and nothing outside the rectangles moves`, () => {
      const f = open(name);
      const rnd = prng(name.length * 7919 + scale);
      const hasCurve = name === 'omx-reverb';
      const deltas = [];
      for (let n = 0; n < 24; n++) {
        const d = {};
        const picks = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < picks; k++) {
          const c = f.controls[Math.floor(rnd() * f.controls.length)];
          const t = `${Math.floor(rnd() * 3)}`; // few texts: a reading often moves with the same text
          if (c.widget === 'selector') (d.values ??= {})[c.symbol] = { at: Math.floor(rnd() * 3), count: 3, text: `o${t}` };
          else if (c.widget === 'meter' || c.widget === 'display') continue;
          else (d.values ??= {})[c.symbol] = { fraction: Math.round(rnd() * 100) / 100, text: t };
        }
        if (f.meters.length && rnd() < 0.6) d.meters = { [f.meters[Math.floor(rnd() * f.meters.length)].symbol]: [{ value: -60 * rnd(), elapsed: 0.05 * rnd() }] };
        if (hasCurve && rnd() < 0.5) d.curves = { 0: { x: [0, 50, 100 + 100 * rnd()], y: [0, -10 * rnd(), -40 * rnd() - 10] } };
        if (rnd() < 0.15) d.name = `plugin ${Math.floor(rnd() * 100)}`;
        deltas.push(d);
      }
      const out = steps(f.description, f.state, deltas, { format, alpha, scale });
      let narrower = 0;
      for (const s of out) {
        assert.equal(firstDiff(s.after, s.full), -1, `step ${s.step}: the buffer is the full draw (${JSON.stringify(s.rects)})`);
        if (s.step) assert.equal(outsideUntouched(s), null, `step ${s.step}`);
        if (s.step && s.rects.length && s.rects.reduce((a, r) => a + r[2] * r[3], 0) < s.after.length / 4 / 2) narrower++;
      }
      assert.ok(narrower >= 12, `most steps repaint less than half the panel (${narrower} of ${out.length - 1})`);
    });

test('a control shown or hidden by a governing value: the cell that moved, as it was and as it is, and the buffer is the full draw', () => {
  const GOVERNED = ['rat', 'mak', 'gr', 'outlevel'];
  const ALL = (1n << 64n) - 1n;
  const atLeast = (n) => (ALL ^ ((1n << BigInt(n)) - 1n)).toString(16);
  const f = open('zamcomp-panel', {
    edit: (x) => ({ ...x, controls: x.controls.map((c) => (GOVERNED.includes(c.symbol) ? { ...c, visible: 99, mask: atLeast(1), visibleWhen: { symbol: 'mode', default: 0 } } : c)) }),
  });
  const out = steps(f.description, f.state, [{ integers: { mode: 1 } }, { integers: { mode: 0 } }, { integers: { mode: 1 } }, move('rat', 0.3, 'x')]);
  assert.ok(out[1].rects.length >= 1, 'showing the governed controls repaints');
  for (const s of out) assert.equal(firstDiff(s.after, s.full), -1, `step ${s.step}: the buffer is the full draw (${JSON.stringify(s.rects)})`);
});

test('a control moved aside by a hidden neighbour: its cell as it was and as it is, the panel the same size', () => {
  const ALL = (1n << 64n) - 1n;
  const f = open('zamcomp-panel', {
    // `gr` and `outlevel` share the last section: with `gr` hidden `outlevel` takes its place and nothing else moves
    edit: (x) => ({ ...x, controls: x.controls.map((c) => (c.symbol === 'gr' ? { ...c, visible: 99, mask: (ALL ^ 1n).toString(16), visibleWhen: { symbol: 'mode', default: 0 } } : c)) }),
  });
  const out = steps(f.description, f.state, [{ integers: { mode: 1 } }, { integers: { mode: 0 } }]);
  for (const s of out) assert.equal(firstDiff(s.after, s.full), -1, `step ${s.step}: the buffer is the full draw (${JSON.stringify(s.rects)})`);
  for (const s of out.slice(1)) {
    assert.ok(s.rects.length >= 1 && s.rects[0][2] < s.width / 2, `step ${s.step}: ${JSON.stringify(s.rects)} is the last section's cells, not the panel`);
    assert.equal(outsideUntouched(s), null);
  }
});

test('a buffer of another size is a full draw reported as the whole buffer', () => {
  const f = open('omx-delay');
  const out = steps(f.description, f.state, [move(f.controls[0].symbol, 0.2, 'q'), { size: [700, 500], ...move(f.controls[0].symbol, 0.4, 'r') }, move(f.controls[0].symbol, 0.6, 's')], { size: [600, 420] });
  assert.deepEqual([out[2].width, out[2].height], [700, 500]);
  assert.deepEqual(out[2].rects, [[0, 0, 700, 500]], 'the resized draw is the whole new buffer');
  assert.equal(out[3].rects.length, 1);
  assert.ok(out[3].rects[0][2] < 700, 'the draw after it is dirty again');
  for (const s of out) assert.equal(firstDiff(s.after, s.full), -1, `step ${s.step}: the buffer is the full draw`);
});
