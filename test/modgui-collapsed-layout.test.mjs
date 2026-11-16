// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// A control the come-up values hide (a band past the band count) takes no room: the face is laid out for the controls it
// shows, and the script lays it out again when a value shows more.
import assert from 'node:assert/strict';
import test from 'node:test';
import { emitScript, layout } from '../tools/modgui-gen.mjs';

const knob = (symbol, shown = true) => ({ symbol, name: symbol, widget: 'knob', min: 0, max: 1, def: 0, unit: '', shown });
const bands = (n, shownCount) => Array.from({ length: n }, (_v, i) => knob(`b${i + 1}`, i < shownCount));
const panelOf = (controls) => ({ stem: 'x', sections: [{ key: 'eq', label: 'EQ', displays: [], controls }, { key: 'comp', label: 'Comp', displays: [], controls: [knob('c1')] }] });

test('with 4 bands shown, 28 hidden bands leave no gap: the face is the size of the 4-band face', () => {
  const four = layout(panelOf(bands(4, 4)));
  const all = layout(panelOf(bands(32, 4)));
  assert.equal(all.h, four.h, 'the hidden bands 5-32 took room');
  assert.equal(all.w, four.w);
  assert.equal(all.sections[1].y, four.sections[1].y, 'the next section starts below the hidden bands');
});

test('with every band shown the face holds them all (the layout the script restores)', () => {
  const eight = layout(panelOf(bands(20, 20)));
  assert.ok(eight.h > layout(panelOf(bands(4, 4))).h);
});

test('the script lays the sections out again when a control is shown or hidden', () => {
  assert.match(emitScript('t'), /relayout/);
});
