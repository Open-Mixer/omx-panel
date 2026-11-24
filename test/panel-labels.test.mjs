// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The words a panel surface draws of its own (omx-panel#13, codes then catalogs, omx-contract#2): the meters band's title, an
 * unheld meter's word, a skin's last section and a gain-reduction bar's fallback label are the panel domain's PANEL_LABELS, each a
 * key with its English sentence, rendered into schema/codes.json and every catalog, and served in a layout's and a description's
 * `words`. No surface spells one: the last test reads the code of every surface that drew one and is red for a drawn word with no
 * key.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PANEL_LABELS, panelLayout } from '../tools/panel-description.mjs';
import { applySkinOverride } from '../dist/src/skin-package.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const json = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const DOMAIN = json('contract.d/panel/panel.json').components.schemas.PANEL_LABELS.oneOf;
const WORDS = { meters: 'panel.label.meters', more: 'panel.label.more', unheld: 'panel.label.unheld', gainReduction: 'panel.label.gain.reduction' };

test('each word is a key of PANEL_LABELS with its English sentence, in the codes sheet and in every catalog', () => {
  assert.deepEqual(Object.fromEntries(DOMAIN.map((w) => [w.title, w.const])), WORDS);
  const codes = json('schema/codes.json').codes;
  for (const w of DOMAIN) {
    assert.ok(w['x-text'], `${w.const} has its English sentence`);
    assert.deepEqual(codes[w.title], { code: w.const, text: { en: w['x-text'] }, args: [] }, `schema/codes.json has ${w.const}`);
    for (const lang of ['ca', 'de', 'es', 'fr', 'it', 'pt']) assert.ok(json(`catalogs/${lang}.json`).messages[w.const]?.text, `catalogs/${lang}.json has ${w.const}`);
  }
});

test('a layout serves the words: each the domain\'s key and its English sentence', () => {
  const want = Object.fromEntries(DOMAIN.map((w) => [w.title, { labelKey: w.const, label: w['x-text'] }]));
  assert.deepEqual(JSON.parse(JSON.stringify(PANEL_LABELS)), want);
  const x = panelLayout(json('test/fixtures/meters/meters.descriptor.json'), { panel: json('test/fixtures/meters/meters.panel.json') });
  assert.deepEqual(JSON.parse(JSON.stringify(x.words)), want);
});

test('a gain-reduction bar with no label of the descriptor\'s takes the word, by its key', () => {
  const x = panelLayout(json('test/fixtures/meters/meters.descriptor.json'), { panel: json('test/fixtures/meters/meters.panel.json') });
  const bar = x.displays.find((d) => d.kind === 'gain_reduction_bar');
  assert.ok(bar, 'the meters fixture is a compressor with a gain-reduction meter');
  assert.equal(bar.label, PANEL_LABELS.gainReduction.label);
  assert.ok(bar.labelKey === PANEL_LABELS.gainReduction.labelKey || /\.display\.gain_reduction_bar$/.test(bar.labelKey), `${bar.labelKey}: a key`);
});

test('a skin\'s last section takes the description\'s word more, by its key', () => {
  const param = (symbol) => ({ kind: 'number', symbol, name: symbol, unit: 'none', scale: 'linear', step: 0, min: 0, max: 1, default: 0 });
  const desc = {
    family: 'none', params: [param('a'), param('b')], sections: [{ key: 'main', labelKey: 'x.main', label: 'Main' }],
    controls: ['a', 'b'].map((symbol) => ({ symbol, section: 'main', widget: 'knob', labelKey: `x.${symbol}`, label: symbol, visibleWhen: null })),
    roles: [], displays: [], words: PANEL_LABELS,
  };
  const { description } = applySkinOverride(desc, { sections: [{ key: 'first', controls: ['a'] }] });
  assert.deepEqual(description.sections.at(-1), { key: 'more', labelKey: 'panel.label.more', label: PANEL_LABELS.more.label });
});

test('no surface spells a word it draws of its own: each is the description\'s, by its key', () => {
  // the literals each of these files drew before the words had keys (omx-panel#13), and the unheld word; a line that reads the
  // description's `words` names a word by its title, which is no text drawn
  const spelled = /(["'`])(?:Meters|METERS|More|Gain reduction|unheld)\1/;
  for (const f of ['renderer/src/view.c', 'tools/modgui-gen.mjs', 'src/skin-package.ts', 'tools/panel-description.mjs', 'renderer/test/meter_tk.py']) {
    const lines = readFileSync(join(ROOT, f), 'utf8').split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => !/^\s*(\/\/|\*|\/\*|#)/.test(l) && !/\bwords\b/.test(l) && spelled.test(l));
    assert.deepEqual(lines, [], `${f} spells a drawn word: ${lines.map(([n, l]) => `${n}: ${l.trim()}`).join('; ')}`);
  }
});
