// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The C renderer's visibility rule answers the cross-language vector the JavaScript tests read (#76,
 * test/fixtures/rules/visible-when.json): a control of the zamcomp panel governed by the vector's mask, its come-up value the
 * case's, is drawn (a cell in --rects) exactly when the vector says it is shown.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { FIXTURES, ROOT, descriptionFile, rects, scratch } from './harness.mjs';

const { vectors } = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'rules', 'visible-when.json'), 'utf8'));
const fx = FIXTURES.find((f) => f.name === 'zamcomp-panel');
const base = JSON.parse(readFileSync(descriptionFile(fx, scratch()), 'utf8'));
const at = base.controls.findIndex((c) => c.symbol === 'rat');

/** Whether the C renderer draws `rat` with `mask`, its governing value `value`. */
function drawn(mask, value) {
  const file = join(scratch(), 'vector.layout.json');
  writeFileSync(file, JSON.stringify({ ...base, controls: base.controls.map((c, i) => (i === at ? { ...c, visible: 99, mask, visibleWhen: { symbol: 'mode', default: value } } : c)) }));
  const cell = rects(file)[at];
  return !(cell.length === 1 && Number.isNaN(cell[0]));
}

test('the fixture governs a drawn control', () => {
  assert.ok(at >= 0);
  assert.equal(drawn('ffffffffffffffff', 0), true, 'every bit set, the control is drawn: the seam reads the rule');
  assert.equal(drawn('0', 0), false, 'no bit set, the control is not drawn');
});

for (const v of vectors) {
  test(`visibility rule, ${v.name}: the C renderer draws the control exactly where the vector shows it`, () => {
    for (const c of v.cases) assert.equal(drawn(v.mask, c.value), c.shown, `value ${c.value}`);
  });
}
