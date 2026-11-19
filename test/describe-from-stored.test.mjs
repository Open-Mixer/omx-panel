// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * describe-from-stored.test.mjs — the skin, the matrices and the pages from a STORED entry alone (docs/descriptions-store.md
 * 3.4, lane 2). `describeStored(descriptor)` is what the store keeps of a derivation: the description before the skin and
 * the matrices, what the matrices and the pages read of each control, and the repeated groups. `describeFromStored(stored,
 * { skin, perPage, remote })` is pure: no descriptor, no file. Held by value: over the corpus (the omx-plugins descriptors
 * of the group model and the scanned descriptors), for each plugin, with no skin and with a skin, at three surface widths,
 * it is byte-equal to `describe` from the descriptor, the stored entry having been through JSON as the store holds it.
 * Each arm drops one thing the store keeps and reads a result change.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as D from '../dist/tools/describe.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const DIRS = [[join(FIXTURES, 'group-model', 'omx-plugins'), '.descriptor.json'], [join(FIXTURES, 'descriptors'), '.json']];
const corpus = DIRS.flatMap(([dir, ext]) => readdirSync(dir).filter((f) => f.endsWith(ext)).sort().map((f) => ({ name: f, descriptor: JSON.parse(readFileSync(join(dir, f), 'utf8')) })));
const WIDTHS = [{}, { perPage: 4 }, { perPage: 6, remote: true }];

// a skin that keeps every control and reverses the first section's order: a skin the matrices and the pages must follow
function skinOf(description) {
  const first = description.sections[0];
  return { schema: 1, plugin: 'urn:test:plugin', licence: 'CC0-1.0',
    sections: [{ key: first.key, controls: description.controls.filter((c) => c.section === first.key).map((c) => c.symbol).reverse() }] };
}
const throughJson = (x) => JSON.parse(JSON.stringify(x));

test('the corpus has plugins with a matrix and plugins without, so the arms below have something to move', () => {
  const withMatrix = corpus.filter(({ descriptor }) => D.describe(descriptor).description?.sections.some((s) => s.matrix));
  assert.ok(withMatrix.length >= 4, `${withMatrix.length} corpus plugins serve a matrix`);
});

test('describeStored and describeFromStored exist, and the stored entry is plain JSON', () => {
  assert.equal(typeof D.describeStored, 'function');
  assert.equal(typeof D.describeFromStored, 'function');
});

for (const { name, descriptor } of corpus) {
  test(`${name}: describeFromStored is byte-equal to describe, with and without a skin, at every width`, () => {
    const base = D.describe(descriptor).description;
    if (!base) return; // a refused derivation is stored as a refusal, not an entry of this function
    const { stored } = D.describeStored(descriptor);
    const entry = throughJson(stored);
    for (const skin of [undefined, skinOf(base)]) {
      for (const width of WIDTHS) {
        const want = D.describe(descriptor, { skin, ...width });
        const got = D.describeFromStored(entry, { skin, ...width });
        assert.deepEqual(got.description, want.description, `${name} skin=${skin ? 'reversed' : 'none'} ${JSON.stringify(width)}`);
        assert.deepEqual(got.refusals, want.refusals);
      }
    }
  });
}

// -- sabotage: drop one thing the store keeps, and the result moves (each arm names the plugins it moved)
const moved = (sabotage, expectAtLeast = 1) => {
  const names = [];
  for (const { name, descriptor } of corpus) {
    if (!D.describe(descriptor).description) continue;
    const entry = throughJson(D.describeStored(descriptor).stored);
    sabotage(entry);
    const want = D.describe(descriptor).description;
    let got;
    try { got = D.describeFromStored(entry, {}).description; } catch { names.push(name); continue; }
    if (JSON.stringify(got) !== JSON.stringify(want)) names.push(name);
  }
  assert.ok(names.length >= expectAtLeast, `the arm moved ${names.length} plugins: ${names.join(', ')}`);
  return names;
};
test('arm: a stored entry with no group keys serves other pages', () => {
  moved((e) => e.controls.forEach((c) => { c.group_key = null; }));
});
test('arm: a stored entry with no groups serves no matrix', () => {
  moved((e) => { e.groups = []; });
});
test('arm: a stored entry with no governed marks serves another matrix count', () => {
  moved((e) => e.controls.forEach((c) => { c.governed = 0; }));
});
test('arm: a stored entry with no control ids serves other pages', () => {
  moved((e) => e.controls.forEach((c) => { c.id = ''; }));
});
