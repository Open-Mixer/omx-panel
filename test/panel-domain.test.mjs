// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The panel domain (docs/contract-domains.md): contract.d/panel/panel.json is the words a panel description speaks, and
// include/omxdomain/panel_vocabulary.h is its render. The tools read the same words; the header is what the renderer of
// omx-contract writes from the document (OMX_CONTRACT_CLI names its omx-contract.mjs; the test skips without it).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DISPLAY_KINDS, FAMILIES, DISPLAY_SOURCES, PLACEMENTS, STANDARD_WIDGETS } from '../tools/panel-description.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = JSON.parse(readFileSync(join(ROOT, 'contract.d/panel/panel.json'), 'utf8'));
const words = (item) => doc.components.schemas[item].oneOf.map((e) => e.const);

test('the domain names itself, its owner and its own version', () => {
  assert.equal(doc.$id, 'https://openmixer.org/contract/panel');
  assert.equal(doc.info['x-owner'], 'omx-panel');
  assert.match(doc.info.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(doc.components.schemas), ['PANEL_FAMILIES', 'PANEL_STANDARD_WIDGETS', 'PANEL_WIDGETS', 'PANEL_DISPLAY_KINDS', 'PANEL_DISPLAY_SOURCES', 'PANEL_PLACEMENTS']);
});

test('a code is the place of its word, and no word is twice', () => {
  for (const [name, s] of Object.entries(doc.components.schemas)) {
    s.oneOf.forEach((e, i) => assert.equal(e['x-code'], i, `${name}.${e.const}`));
    assert.equal(new Set(s.oneOf.map((e) => e.const)).size, s.oneOf.length, name);
  }
});

test('the words the tools read are the domain\'s: display kinds, sources, placements, standard widgets', () => {
  assert.deepEqual(words('PANEL_DISPLAY_KINDS'), DISPLAY_KINDS);
  assert.deepEqual(words('PANEL_DISPLAY_SOURCES'), DISPLAY_SOURCES);
  assert.deepEqual(words('PANEL_PLACEMENTS'), PLACEMENTS);
  assert.deepEqual(words('PANEL_STANDARD_WIDGETS'), STANDARD_WIDGETS);
});

test('the same words and codes as omx-contract main @b2e9bba held them (the order of each item is its codes)', () => {
  assert.deepEqual(words('PANEL_DISPLAY_KINDS').indexOf('time_response'), 4, 'time_response is code 4');
  assert.deepEqual(words('PANEL_FAMILIES'), ['none', 'gate', 'dynamics', 'limiter', 'deesser', 'eq', 'filter', 'drive', 'modulation', 'delay', 'reverb', 'pitch', 'utility']);
  assert.deepEqual(words('PANEL_WIDGETS'), ['auto', 'knob', 'fader', 'switch', 'selector']);
});

test('the families a descriptor, a skin and the layout accept are the domain\'s: the schema validates the family word', () => {
  assert.deepEqual(words('PANEL_FAMILIES'), FAMILIES);
  assert.deepEqual(JSON.parse(readFileSync(join(ROOT, 'schema/skin-package.schema.json'), 'utf8')).$defs.family.enum, words('PANEL_FAMILIES'));
});

test('every word has its sentence in every language, nothing dropped: 6 catalogs, one entry per word', () => {
  const keys = Object.entries(doc.components.schemas).flatMap(([item, s]) => s.oneOf.map((e) => `${item}.${e.const}`)).sort();
  for (const lang of ['ca', 'de', 'es', 'fr', 'it', 'pt']) {
    const c = JSON.parse(readFileSync(join(ROOT, `contract.d/panel/catalogs/${lang}.json`), 'utf8'));
    assert.equal(c.kind, 'catalog');
    assert.equal(c.lang, lang);
    assert.deepEqual(Object.keys(c.messages).sort(), keys, lang);
  }
});

// In CI the render must run: a missing omx-contract renderer is red there, never a skip.
const CLI = process.env.OMX_CONTRACT_CLI;
test('the committed header is the render of the document', { skip: CLI || process.env.CI ? false : 'OMX_CONTRACT_CLI (omx-contract.mjs) is not set' }, () => {
  assert.ok(CLI, 'CI sets OMX_CONTRACT_CLI to the omx-contract renderer');
  const r = spawnSync('node', [process.env.OMX_CONTRACT_CLI, 'render', '--target', 'c', '--package', 'panel', '--contract-dir', join(ROOT, 'contract.d'), '--out', join(ROOT, 'include/omxdomain'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
