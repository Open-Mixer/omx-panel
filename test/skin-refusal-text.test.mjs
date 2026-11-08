// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * Every refusal code this package owns carries its own sentence, in en and ca (omx-contract spec 7.11): the owner's
 * words for what happened and what the person can do. The shape and the placeholder rule are omx-contract's
 * (schema >= 3.11.0, `codes.codes.*.text`/`args`); this test holds this package's declaration to both.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import schema from '@openmixer/omx-contract/schema.json' with { type: 'json' };
import { validate } from '@openmixer/omx-contract/validate';
import { SKIN_REFUSAL_CODES, SKIN_REFUSAL_TEXT } from '../dist/src/skin-package.js';

const [floor] = '>=3.11.0 <4'.match(/\d+\.\d+\.\d+/);
const gte = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] > pb[i]; }
  return true;
};

test('omx-contract is at least the schema version this declaration is written against', () => {
  assert.ok(gte(schema['x-omx-schema-version'], floor), `schema is ${schema['x-omx-schema-version']}, need >= ${floor}`);
});

/** One codes-item entry's `text`/`args`, exactly as omx-contract's own `codes.codes.*` shape (schema/omx-contract.schema.json). */
const CODE_TEXT_SHAPE = {
  $defs: schema.$defs,
  type: 'object',
  properties: {
    text: {
      type: 'object',
      properties: { en: { $ref: '#/$defs/text' }, ca: { $ref: '#/$defs/text' } },
      required: ['en', 'ca'],
      additionalProperties: false,
    },
    args: { type: 'array', items: { type: 'string', pattern: '^[a-z][A-Za-z0-9]*$' }, uniqueItems: true },
  },
  required: ['text', 'args'],
  additionalProperties: false,
};

const placeholders = (s) => new Set([...s.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]));

for (const code of SKIN_REFUSAL_CODES) {
  test(`${code} carries en and ca text that validates against omx-contract's codes shape`, () => {
    const entry = SKIN_REFUSAL_TEXT[code];
    assert.ok(entry, `${code} has no entry in SKIN_REFUSAL_TEXT`);
    const { ok, errors } = validate(CODE_TEXT_SHAPE, entry);
    assert.ok(ok, `${code}: ${JSON.stringify(errors)}`);
  });

  test(`${code}'s en and ca sentences use the same placeholders, all of them in args`, () => {
    const entry = SKIN_REFUSAL_TEXT[code];
    const en = placeholders(entry.text.en);
    const ca = placeholders(entry.text.ca);
    assert.deepEqual([...en].sort(), [...ca].sort(), `${code}: en uses {${[...en].join('}, {')}}, ca uses {${[...ca].join('}, {')}}`);
    for (const name of new Set([...en, ...ca])) assert.ok(entry.args.includes(name), `${code}: {${name}} is not in args`);
  });
}

test('SKIN_REFUSAL_TEXT declares no code outside SKIN_REFUSAL_CODES', () => {
  const extra = Object.keys(SKIN_REFUSAL_TEXT).filter((k) => !SKIN_REFUSAL_CODES.includes(k));
  assert.deepEqual(extra, []);
});
