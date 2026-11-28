// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * describe-served-display-code.test.mjs — a served display's kind is the number omx-clap-scan prints (omx-clap-core
 * keeps no panel words since the vocabulary sorting pass: the words are this package's PANEL_DISPLAY_KINDS, the number
 * their x-code). Measured on the Raspberry Pi with omx-plugins 0.21.1 and omx-clap-scan 0.35.1: every family display of
 * omx-comp's panel came as `"kind": 1`, which describe refused as `a family display of kind 1 has no section graph
 * here`, so the Pi drew no curve. The fixture is that scan, trimmed to the omx-plugins 0.21.1 CLAPs with a family
 * display (test/fixtures/panels/omx-plugins-0.21.1.served.json: each one's panel and its parameter ids), and omx-comp
 * 0.21.1's descriptor as the Pi's plugin-hostd-probe describe gives it (test/fixtures/descriptors/described-clap-omx-comp-0.21.1.json).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from '../dist/tools/describe.mjs';
import { DISPLAY_KINDS, keyOf } from '../dist/tools/panel-description.mjs';
import { declaredFromServed } from '../dist/tools/panel-served.mjs';
import { INDEXED_ROLES } from '../dist/tools/role-table.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (...p) => JSON.parse(readFileSync(join(FIXTURES, ...p), 'utf8'));
const scan = () => fixture('panels', 'omx-plugins-0.21.1.served.json');
const served = (id) => {
  const p = scan().plugins.find((x) => x.plugin.id === id);
  assert.ok(p, `the fixture holds ${id}`);
  return p;
};
const read = (p) => declaredFromServed({ plugin: p.plugin, panel: p.panel }, { controls: p.paramIds.map((id) => ({ id })) }, { where: p.plugin.id, keyOf, indexedRoles: INDEXED_ROLES });

/** The section graph each family display of the scan stands for: its kind's word, then the family's graph of it. */
const GRAPH = {
  'org.openmixer.comp': 'dynamics-curve', 'org.openmixer.keyed-gate': 'dynamics-curve', 'org.openmixer.drive': 'transfer-curve',
  'org.openmixer.delay': 'delay-taps', 'org.openmixer.reverb': 'decay-envelope', 'org.openmixer.eq8': 'eq-curve',
  'org.openmixer.eq16': 'eq-curve', 'org.openmixer.eq32': 'eq-curve', 'org.openmixer.dyneq': 'eq-curve',
};

test('the fixture is the scan as omx-clap-scan 0.35.1 prints it: every display kind a number, omx-plugins 0.21.1', () => {
  const s = scan();
  assert.equal(s.scanner, 'omx-clap-scan');
  assert.deepEqual(s.plugins.map((p) => p.plugin.id).sort(), Object.keys(GRAPH).sort());
  for (const p of s.plugins) {
    assert.equal(p.plugin.version, '0.21.1');
    assert.ok(p.panel.displays.every((d) => Number.isInteger(d.kind)), `${p.plugin.id}: its kinds are numbers`);
  }
});

test('every family display of the omx-plugins 0.21.1 scan becomes its section\'s graph, read by the kind\'s code', () => {
  for (const p of scan().plugins) {
    const declared = read(p);
    const graphs = declared.sections.filter((s) => s.graph).map((s) => s.graph);
    assert.ok(graphs.length > 0, `${p.plugin.id}: a family display draws a graph`);
    assert.ok(graphs.every((g) => g === GRAPH[p.plugin.id]), `${p.plugin.id}: ${graphs} is ${GRAPH[p.plugin.id]}`);
  }
});

test('omx-comp 0.21.1 as the Pi describes it, with its own served panel: the curve and the bar are drawn, no refusal', () => {
  const p = served('org.openmixer.comp');
  const { description, refusals } = describe(fixture('descriptors', 'described-clap-omx-comp-0.21.1.json'), { panel: { plugin: p.plugin, panel: p.panel } });
  assert.deepEqual(refusals, []);
  assert.equal(description.family, 'dynamics');
  assert.deepEqual(description.displays.map((x) => x.kind).sort(), ['gain_reduction_bar', 'transfer_curve']);
});

test('the code is the word\'s x-code: the word itself reads the same, and a code the domain lacks is refused by name', () => {
  const p = served('org.openmixer.comp');
  const coded = read(p);
  const worded = structuredClone(p);
  for (const d of worded.panel.displays) d.kind = DISPLAY_KINDS[d.kind];
  assert.deepEqual(read(worded), coded, 'a scan that prints the word is read the same');
  // arm: transfer_curve's code read as eq_response's is the eq graph, so the code, not its place in the row, decides
  const swapped = structuredClone(p);
  swapped.panel.displays.find((d) => d.source === 'family').kind = DISPLAY_KINDS.indexOf('eq_response');
  assert.equal(read(swapped).sections.find((s) => s.graph).graph, 'eq-curve');
  const unknown = structuredClone(p);
  unknown.panel.displays.find((d) => d.source === 'family').kind = DISPLAY_KINDS.length;
  assert.throws(() => read(unknown), new RegExp(`a family display of kind ${DISPLAY_KINDS.length}, which is no word of PANEL_DISPLAY_KINDS`));
});
