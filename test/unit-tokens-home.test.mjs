// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas
// The group model's unit tokens are the vocabulary's (#74): a control's unit, a descriptor's symbol ("Hz", "%",
// "dB/oct") or an LV2 term (units:hz, units:pc), is its standard id, PARAM_UNITS of omx-contract's param domain, an LV2
// term read through plugin-db's lv2 domain (LV2_UNIT_IDS). The group model keeps no list of its own, so the two
// spellings of one unit never drift apart, and two units never share a token.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { unitToken } from '../dist/tools/group-model.mjs';
import { lv2UnitTerms, standardUnits } from '../dist/tools/vocabulary.mjs';

const ROOT = join(import.meta.dirname, '..');
const LV2_UNITS = 'http://lv2plug.in/ns/extensions/units#';

test('a unit is one token in both spellings: its descriptor symbol and its LV2 term (units:<term>)', () => {
  const ids = new Map([...standardUnits()].map(([symbol, u]) => [u.id, symbol]));
  const pairs = [...lv2UnitTerms()].filter(([id]) => ids.has(id));
  assert.ok(pairs.some(([id]) => id === 'Hz') && pairs.length > 10, `positive control: the LV2 terms of the standard units are read (${pairs.length})`);
  const differ = pairs.filter(([id, term]) => unitToken(ids.get(id)) !== unitToken(`${LV2_UNITS}${term}`))
    .map(([id, term]) => `${ids.get(id)} -> ${unitToken(ids.get(id))}, units:${term} -> ${unitToken(`${LV2_UNITS}${term}`)}`);
  assert.deepEqual(differ, [], 'one unit, two tokens');
});

test('two standard units never share a token (dB/oct is not oct, dB/s is not s)', () => {
  const byToken = new Map();
  for (const symbol of standardUnits().keys()) byToken.set(unitToken(symbol), [...(byToken.get(unitToken(symbol)) ?? []), symbol]);
  assert.deepEqual([...byToken].filter(([, s]) => s.length > 1), [], 'one token, two units');
});

test('no unit is the empty unit; an LV2 label is read as a term; a unit no list holds keeps a token of its own', () => {
  assert.equal(unitToken(undefined), unitToken(''), 'a control with no unit and one whose unit is "" are one');
  assert.equal(unitToken(`${LV2_UNITS}hz`), unitToken('Hz'));
  assert.equal(unitToken('hz'), unitToken('Hz'), 'a blank-node unit known by its label, the term spelled');
  assert.notEqual(unitToken('furlongs'), unitToken('Hz'));
  assert.notEqual(unitToken('furlongs'), unitToken(''));
});

test('tools/group-model.mjs keeps no unit list of its own: the vocabulary is the one list', () => {
  const src = readFileSync(join(ROOT, 'tools', 'group-model.mjs'), 'utf8');
  assert.doesNotMatch(src, /\bUNIT_TOKENS\b/);
  assert.doesNotMatch(src, /'%'\s*:|\bkhz\s*:|\bpercent\s*:\s*'/, 'a unit spelled as a key of a table');
  assert.doesNotMatch(src, /\bunit\s*[!=]==?\s*'[^']*'/, 'a unit compared with a spelled word');
});

test('tools/meaning-infer.mjs reads a unit as its standard id, never a spelled word (#251)', () => {
  const src = readFileSync(join(ROOT, 'tools', 'meaning-infer.mjs'), 'utf8');
  assert.match(src, /unitIdOf/, 'positive control: it reads the vocabulary');
  assert.doesNotMatch(src, /\bunit\w*\s*[!=]==?\s*'[^']*'|unitOf\([^)]*\)\s*[!=]==?\s*'[^']*'|toLowerCase\(\)[^\n]*unit|unit[^\n]*toLowerCase\(\)/, 'a unit compared with a spelled word');
});
