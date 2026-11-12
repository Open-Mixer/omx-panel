// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * Every refusal code this package owns carries its own source sentence in English (omx-contract#90, spec 7.11): the
 * owner's words for what happened and what the person can do, in schema/codes.json beside the code and its args. Each
 * other language is a catalog the package ships, catalogs/<lang>.json, keyed by the code; Catalan is complete. The
 * console and the other surfaces read both; no table in src/ or tools/ repeats a sentence. This test holds every entry
 * to the shape and the placeholder rule, holds the file to the codes the package actually emits (the skin package's,
 * describe's, the bar rule's and the easy list's), and holds the catalog to those codes and their args.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import schema from '@openmixer/omx-contract/schema.json' with { type: 'json' };
import { validate } from '@openmixer/omx-contract/validate';
import { SKIN_REFUSAL_CODES } from '../dist/src/skin-package.js';
import { DESCRIBE_CODES } from '../dist/tools/describe.mjs';
import { BARS_CODES } from '../dist/tools/bars.mjs';
import { EasyRefused } from '../dist/tools/easy.mjs';

const CODES_FILE = new URL('../dist/schema/codes.json', import.meta.url);
const CATALOG_FILE = (lang) => new URL(`../dist/catalogs/${lang}.json`, import.meta.url);
/** The languages this package ships a catalog for, each complete. */
// every catalog the tree carries, one per listed language (omx-contract's languages.json), each complete
const CATALOG_LANGS = readdirSync(new URL('../catalogs/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
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
/** A shipped catalog; an absent one reads as empty, so every code is red by name. */
function catalog(lang) {
  try { return JSON.parse(readFileSync(CATALOG_FILE(lang), 'utf8')); } catch { return {}; }
}

function declared() {
  let doc;
  try { doc = JSON.parse(readFileSync(CODES_FILE, 'utf8')); } catch { return new Map(); }
  return new Map(Object.values(doc.codes ?? {}).map((e) => [e.code, e]));
}

test('omx-contract is at least the schema version this declaration is written against', () => {
  assert.ok(gte(floor, '3.11.0'), `the floor is ${floor}; text and args on codes are 3.11.0`);
  assert.ok(gte(schema['x-omx-schema-version'], floor), `schema is ${schema['x-omx-schema-version']}, need >= ${floor}`);
});

/** One entry: the code word, its source sentence and its args (omx-contract#90: the source only, no other language). */
const itemShape = schema.$defs.codes.properties.codes.additionalProperties.properties;
const ENTRY_SHAPE = {
  $defs: schema.$defs,
  type: 'object',
  properties: {
    code: { type: 'string', pattern: '^panel(\\.[a-z0-9]+(-[a-z0-9]+)*){2,}$' },
    doc: itemShape.doc,
    text: { type: 'object', properties: { en: { type: 'string', minLength: 1 } }, required: ['en'], additionalProperties: false },
    args: itemShape.args,
  },
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
  test(`${code} carries its source sentence and args in the codes shape`, () => {
    const entry = declared().get(code);
    assert.ok(entry, `${code} has no entry in schema/codes.json`);
    const { ok, errors } = validate(ENTRY_SHAPE, entry);
    assert.ok(ok, `${code}: ${JSON.stringify(errors)}`);
  });

  test(`${code}'s source sentence uses only placeholders in args`, () => {
    const entry = declared().get(code);
    assert.ok(entry, `${code} has no entry in schema/codes.json`);
    for (const name of placeholders(entry.text.en)) assert.ok(entry.args.includes(name), `${code}: {${name}} is not in args`);
  });

  for (const lang of CATALOG_LANGS) {
    test(`${code} has a ${lang} sentence in catalogs/${lang}.json naming only its args`, () => {
      const entry = declared().get(code);
      // an entry is the sentence, or {text, by[, model, source]} with its provenance (omx-contract 3.16.0)
      const said = catalog(lang).messages?.[code];
      const sentence = typeof said === 'string' ? said : said?.text;
      assert.ok(typeof sentence === 'string' && sentence !== '', `${code} has no ${lang} sentence`);
      for (const name of placeholders(sentence)) assert.ok(entry?.args.includes(name), `${code} (${lang}): {${name}} is not in args`);
    });
  }
}

test('the codes file declares no code the package does not emit', () => {
  assert.deepEqual([...declared().keys()].filter((k) => !EMITTED.includes(k)), []);
});

for (const lang of CATALOG_LANGS) {
  test(`catalogs/${lang}.json is a ${lang} catalog of omx-panel holding no code the package does not emit`, () => {
    const cat = catalog(lang);
    assert.equal(cat.kind, 'catalog');
    assert.equal(cat.lang, lang);
    assert.equal(cat.owner, pkg.name.replace(/^@openmixer\//, ''));
    assert.deepEqual(Object.keys(cat.messages ?? {}).filter((k) => !EMITTED.includes(k)), []);
  });
}

test('no module under src/ or tools/ spells a sentence of the codes file or a catalog', () => {
  const doc = JSON.parse(readFileSync(CODES_FILE, 'utf8'));
  const sentences = [
    ...Object.values(doc.codes).map((e) => e.text.en),
    ...CATALOG_LANGS.flatMap((l) => Object.values(catalog(l).messages ?? {})),
  ];
  for (const f of ['src/skin-package.ts', 'tools/describe.mjs', 'tools/bars.mjs', 'tools/easy.mjs']) {
    const body = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    for (const s of sentences) assert.ok(!body.includes(s), `${f} repeats "${s}"`);
  }
});
