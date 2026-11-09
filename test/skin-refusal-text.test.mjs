// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * Every refusal code this package owns carries its own sentence, in en and ca (omx-contract spec 7.11): the owner's
 * words for what happened and what the person can do, in schema/codes.json, the one place they are written. The
 * console and the other surfaces read that file; no table in src/ or tools/ repeats a sentence. The shape and the
 * placeholder rule are omx-contract's (schema >= 3.11.0, `codes.codes.*.text`/`args`); this test holds every entry to
 * both, and holds the file to the codes the package actually emits: the skin package's, describe's, the bar rule's and
 * the easy list's.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import schema from '@openmixer/omx-contract/schema.json' with { type: 'json' };
import { validate } from '@openmixer/omx-contract/validate';
import { SKIN_REFUSAL_CODES } from '../dist/src/skin-package.js';
import { DESCRIBE_CODES } from '../dist/tools/describe.mjs';
import { BARS_CODES } from '../dist/tools/bars.mjs';
import { EasyRefused } from '../dist/tools/easy.mjs';

const CODES_FILE = new URL('../dist/schema/codes.json', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const [floor] = pkg.devDependencies['@openmixer/omx-contract'].match(/\d+\.\d+\.\d+/);
const gte = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] > pb[i]; }
  return true;
};

/** Every code the package puts in a refusal, read off the modules that emit them. */
const EMITTED = [...SKIN_REFUSAL_CODES, ...Object.values(DESCRIBE_CODES), ...Object.values(BARS_CODES), new EasyRefused('').code];

/** The file's entries by their code word; an absent file reads as no entries, so every code below is red by name. */
function declared() {
  let doc;
  try { doc = JSON.parse(readFileSync(CODES_FILE, 'utf8')); } catch { return new Map(); }
  return new Map(Object.values(doc.codes ?? {}).map((e) => [e.code, e]));
}

test('omx-contract is at least the schema version this declaration is written against', () => {
  assert.ok(gte(floor, '3.11.0'), `the floor is ${floor}; text and args on codes are 3.11.0`);
  assert.ok(gte(schema['x-omx-schema-version'], floor), `schema is ${schema['x-omx-schema-version']}, need >= ${floor}`);
});

/** One entry's `text`/`args`, exactly as omx-contract's own `codes.codes.*` shape; the code word is this package's. */
const itemShape = schema.$defs.codes.properties.codes.additionalProperties.properties;
const ENTRY_SHAPE = {
  $defs: schema.$defs,
  type: 'object',
  properties: { code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$' }, doc: itemShape.doc, text: itemShape.text, args: itemShape.args },
  required: ['code', 'text', 'args'],
  additionalProperties: false,
};

const placeholders = (s) => new Set([...s.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]));

test('the codes file is a codes document: kind, doc and lowerCamel names', () => {
  const doc = JSON.parse(readFileSync(CODES_FILE, 'utf8'));
  assert.equal(doc.kind, 'codes');
  assert.equal(typeof doc.doc, 'string');
  for (const name of Object.keys(doc.codes)) assert.match(name, /^[a-z][A-Za-z0-9]*$/);
});

for (const code of EMITTED) {
  test(`${code} carries en and ca text in omx-contract's codes shape`, () => {
    const entry = declared().get(code);
    assert.ok(entry, `${code} has no entry in schema/codes.json`);
    const { ok, errors } = validate(ENTRY_SHAPE, entry);
    assert.ok(ok, `${code}: ${JSON.stringify(errors)}`);
  });

  test(`${code}'s en and ca sentences use the same placeholders, all of them in args`, () => {
    const entry = declared().get(code);
    assert.ok(entry, `${code} has no entry in schema/codes.json`);
    const en = placeholders(entry.text.en);
    const ca = placeholders(entry.text.ca);
    assert.deepEqual([...en].sort(), [...ca].sort(), `${code}: en uses {${[...en].join('}, {')}}, ca uses {${[...ca].join('}, {')}}`);
    for (const name of new Set([...en, ...ca])) assert.ok(entry.args.includes(name), `${code}: {${name}} is not in args`);
  });
}

test('the codes file declares no code the package does not emit', () => {
  assert.deepEqual([...declared().keys()].filter((k) => !EMITTED.includes(k)), []);
});

test('no module under src/ or tools/ spells a sentence of the codes file', () => {
  const doc = JSON.parse(readFileSync(CODES_FILE, 'utf8'));
  const sentences = Object.values(doc.codes).flatMap((e) => [e.text.en, e.text.ca]);
  for (const f of ['src/skin-package.ts', 'tools/describe.mjs', 'tools/bars.mjs', 'tools/easy.mjs']) {
    const body = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    for (const s of sentences) assert.ok(!body.includes(s), `${f} repeats "${s}"`);
  }
});
