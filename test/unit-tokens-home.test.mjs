// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas
// The group model's unit tokens are the vocabulary's (#74): a control's unit, a descriptor's standard id ("Hz",
// "percent", "dBPerOct") or an LV2 term (units:hz, units:pc), is its standard id, PARAM_UNITS of omx-contract's param
// domain, an LV2 term read through plugin-db's lv2 domain (LV2_UNIT_IDS). The group model keeps no list of its own, so
// the two spellings of one unit never drift apart, and two units never share a token.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { unitToken } from '../dist/tools/group-model.mjs';
import { lv2UnitIds, noUnitId, standardUnits } from '../dist/tools/vocabulary.mjs';

const ROOT = join(import.meta.dirname, '..');
const LV2_UNITS = 'http://lv2plug.in/ns/extensions/units#';

test('a unit is one token in both spellings: its standard id and its LV2 term (units:<term>)', () => {
  const pairs = [...lv2UnitIds()].filter(([, id]) => standardUnits().has(id));
  assert.ok(pairs.some(([term, id]) => term === 'hz' && id === 'Hz') && pairs.length > 10, `positive control: the LV2 terms of the standard units are read (${pairs.length})`);
  const differ = pairs.filter(([term, id]) => unitToken(id) !== id || unitToken(`${LV2_UNITS}${term}`) !== id || unitToken(`units:${term}`) !== id)
    .map(([term, id]) => `${id} -> ${unitToken(id)}, units:${term} -> ${unitToken(`${LV2_UNITS}${term}`)}`);
  assert.deepEqual(differ, [], 'one unit, two tokens');
});

test('two standard units never share a token (dB/oct is not oct, dB/s is not s)', () => {
  const byToken = new Map();
  for (const id of standardUnits().keys()) byToken.set(unitToken(id), [...(byToken.get(unitToken(id)) ?? []), id]);
  assert.deepEqual([...byToken].filter(([, s]) => s.length > 1), [], 'one token, two units');
});

test('no unit is the empty unit; an LV2 label is read as a term; a unit no list holds keeps a token of its own', () => {
  assert.equal(unitToken(undefined), unitToken(''), 'a control with no unit and one whose unit is "" are one');
  assert.equal(unitToken(undefined), noUnitId(), 'and that one is the id of no unit');
  assert.equal(unitToken(noUnitId()), noUnitId());
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
