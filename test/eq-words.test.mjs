// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The EQ's role words and edge words are ONE table, meaning-infer.mjs's EQ_WORDS (docs/group-model.md; omx-panel#75): the
 * band inference and the group model both read it, and the group model keeps no list of its own. A word added to one
 * reader only goes red here: every word of the table is recognised by both, and the group model's source holds no word list.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as infer from '../dist/tools/meaning-infer.mjs';
import * as model from '../dist/tools/group-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('meaning-infer owns the table: EQ_WORDS with the roles and the edges', () => {
  assert.ok(infer.EQ_WORDS, 'meaning-infer exports EQ_WORDS');
  for (const role of ['freq', 'gain', 'q', 'type', 'slope']) assert.ok(infer.EQ_WORDS.roles[role]?.length > 0, role);
  assert.deepEqual(infer.EQ_WORDS.edges.map((e) => e.edge), ['hpf', 'lowshelf', 'highshelf', 'lpf']);
});

test('the group model reads the table and keeps none of its own', () => {
  assert.equal(model.EDGES, infer.EQ_WORDS.edges, 'the group model\'s edges are the table\'s');
  const src = readFileSync(join(ROOT, 'tools', 'group-model.mjs'), 'utf8');
  for (const word of ['highpass', 'lowshelf', 'quality', 'resonance', 'cutoff']) assert.doesNotMatch(src, new RegExp(`'${word}'`), `group-model.mjs lists '${word}' itself`);
});

test('every role word of the table is that role for the group model and for the band inference', () => {
  for (const [role, words] of Object.entries(infer.EQ_WORDS.roles)) {
    for (const w of words) {
      assert.equal(model.roleOf([w], role === 'type' ? 'choice' : 'travel', ''), role, `group model: '${w}'`);
      if (role === 'slope') continue; // the band inference has no slope role
      const c = { symbol: `x_${w}_1`, name: `Band 1 ${w}`, kind: role === 'type' ? 'choice' : 'travel', travel: { min: 0, max: 10, unit: '' }, ids: ['a', 'b'] };
      assert.equal(infer.bandRoleOf(c), role, `band inference: '${w}'`);
    }
  }
});

test('every edge word of the table is that edge for the group model and that shape for the band inference', () => {
  for (const e of infer.EQ_WORDS.edges) {
    for (const w of e.words) {
      assert.equal(model.edgeOf(`${w} Freq`)?.edge, e.edge, `group model: '${w}'`);
      assert.equal(infer.shapeOfNames(w.replace(/\s+/g, ''), `${w} Freq`), e.shape, `band inference: '${w}'`);
    }
  }
});
