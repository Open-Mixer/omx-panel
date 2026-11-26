// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The visibility rule answers the cross-language vector (#76): test/fixtures/rules/visible-when.json, which the C renderer's
// tests read too (renderer/test/visible-when-vector.test.mjs). A rule is its mask, and a governed control is shown at a value
// exactly when the value is an integer 0..63 whose bit is set.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isVisible, visibilityMask } from '../dist/tools/panel-description.mjs';

const { vectors } = JSON.parse(readFileSync(new URL('./fixtures/rules/visible-when.json', import.meta.url), 'utf8'));

test('the vector is not empty, and reaches both ends of the range and past them', () => {
  assert.ok(vectors.length >= 5);
  const values = vectors.flatMap((v) => v.cases.map((c) => c.value));
  for (const v of [-1, 0, 63, 64]) assert.ok(values.includes(v), `no case at ${v}`);
});

for (const v of vectors) {
  test(`visibility rule, ${v.name}: the mask and every case`, () => {
    assert.equal(visibilityMask(v.rule).toString(16), v.mask);
    const control = { visible: 1, mask: v.mask, visibleWhen: { symbol: 'mode', default: 0 } };
    for (const c of v.cases) assert.equal(isVisible(control, { mode: c.value }), c.shown, `value ${c.value}`);
  });
}
