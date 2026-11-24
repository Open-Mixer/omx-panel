// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * A meter's caption shows its unit as a person reads it (C2): the description's unitText, the x-symbol of the unit's PARAM_UNITS id
 * (percent is %), never the id itself. Held by pixels: the meters fixture with one meter's unit made `percent` and its unitText `%`
 * draws exactly what the same description draws with `%` written as the unit; the arm reads `percent` drawn when unitText is gone,
 * so the equality is not vacuous.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { FIXTURES, descriptionFile, render, scratch, stateFile } from './harness.mjs';

const fx = FIXTURES.find((f) => f.name === 'meters');

/** The fixture's description with its first in-band meter rewritten by `edit`, in a file. */
function described(dir, name, edit) {
  const d = JSON.parse(readFileSync(descriptionFile(fx, dir), 'utf8'));
  const banded = d.meters.find((m) => !d.controls.some((c) => c.symbol === m.symbol));
  assert.ok(banded, 'the meters fixture has a meter in the band');
  edit(banded);
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(d));
  return file;
}

const same = (a, b) => a.w === b.w && a.h === b.h && Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) === 0;

test('a meter\'s caption draws unitText: unit percent with unitText % is the same pixels as % written as the unit', () => {
  const dir = scratch();
  const state = stateFile(fx, dir);
  const byId = render(described(dir, 'by-id', (m) => Object.assign(m, { unit: 'percent', unitText: '%' })), state);
  const bySymbol = render(described(dir, 'by-symbol', (m) => { m.unit = '%'; delete m.unitText; }), state);
  assert.ok(same(byId, bySymbol), 'the caption shows %, the x-symbol, not the id percent');
});

test('arm: with no unitText the caption draws the unit as written, so percent is not %', () => {
  const dir = scratch();
  const state = stateFile(fx, dir);
  const id = render(described(dir, 'id', (m) => { m.unit = 'percent'; delete m.unitText; }), state);
  const symbol = render(described(dir, 'symbol', (m) => { m.unit = '%'; delete m.unitText; }), state);
  assert.ok(!same(id, symbol), 'percent and % draw different captions');
});
