// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * describe-display-axis.test.mjs — each display's AXIS is data of the description (docs/panel-layout.md "Displays and their
 * axis"): a word of the panel domain's PANEL_DISPLAY_AXES, served on every display, so no client (the C renderer, Zynthian's
 * panel) picks an axis by the display kind's name. Held by value over the corpus (the omx-plugins descriptors of the group
 * model, the scanned descriptors, and the declared panels that draw each curve kind): `describe` serves `axis` on every
 * display and on every display of the layout it was made from (what the renderer reads), the stored body carries it and
 * `describeFromStored` serves it. The axis each kind is drawn on today is the oracle below, read from what the surfaces draw:
 * renderer/src/view.c `draw_curve` and tools/modgui-gen.mjs `curveGeometry` (an eq_response on a log frequency axis, a
 * transfer_curve on linear dB, a time_response on a time axis in ms) and view.c's meter fill, a linear fraction of the range.
 * Sabotage: a stored display whose axis is no word of the item, or that has none, is refused by name.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as D from '../dist/tools/describe.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test', 'fixtures');
const doc = JSON.parse(readFileSync(join(ROOT, 'contract.d/panel/panel.json'), 'utf8'));
const AXES = doc.components.schemas.PANEL_DISPLAY_AXES?.oneOf.map((e) => e.const) ?? [];
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const DIRS = [[join(FIXTURES, 'group-model', 'omx-plugins'), '.descriptor.json'], [join(FIXTURES, 'descriptors'), '.json']];
const corpus = DIRS.flatMap(([dir, ext]) => readdirSync(dir).filter((f) => f.endsWith(ext)).sort().map((f) => ({ name: f, descriptor: JSON.parse(readFileSync(join(dir, f), 'utf8')), options: {} })));
// the declared panels the renderer's tests draw: a delay's and a reverb's time_response, a compressor's transfer_curve, an EQ's
// eq_response, a compressor's gain-reduction bar
for (const [name, descriptor, panel] of [
  ['omx-delay', 'test/fixtures/omx-delay/omx-delay.descriptor.json', 'test/fixtures/omx-delay/omx-delay.panel.json'],
  ['omx-reverb', 'test/fixtures/omx-reverb/omx-reverb.descriptor.json', 'test/fixtures/omx-reverb/omx-reverb.panel.json'],
  ['dyn-curve', 'test/fixtures/dyn-curve/dyn.descriptor.json', 'test/fixtures/dyn-curve/dyn.panel.json'],
  ['eq-marks', 'test/fixtures/eq-marks/eq.descriptor.json', 'test/fixtures/eq-marks/eq.panel.json'],
  ['meters', 'test/fixtures/meters/meters.descriptor.json', 'test/fixtures/meters/meters.panel.json'],
]) corpus.push({ name, descriptor: json(descriptor), options: { panel: json(panel) } });

/** The axis each display kind is drawn on today (the header): the oracle, not the code under test. */
const DRAWN = { eq_response: 'log-frequency', transfer_curve: 'linear', time_response: 'time', gain_reduction_bar: 'linear', meter: 'linear' };
const throughJson = (x) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

test('the panel domain carries PANEL_DISPLAY_AXES: the words the surfaces draw today, and no other', () => {
  assert.deepEqual([...AXES].sort(), [...new Set(Object.values(DRAWN))].sort());
});

test('the corpus has a display of every kind a panel derives or declares, so each axis is read', () => {
  const kinds = new Set(corpus.flatMap(({ descriptor, options }) => D.describe(descriptor, options).description?.displays.map((d) => d.kind) ?? []));
  for (const k of ['eq_response', 'transfer_curve', 'time_response', 'gain_reduction_bar']) assert.ok(kinds.has(k), `no corpus display of kind ${k}`);
});

for (const { name, descriptor, options } of corpus) {
  test(`${name}: every display, in the description and in its layout, serves its axis as a PANEL_DISPLAY_AXES word`, () => {
    const out = D.describe(descriptor, { ...options, withLayout: true });
    if (!out.description) return;
    for (const [where, displays] of [['description', out.description.displays], ['layout', out.layout.displays]]) {
      for (const d of displays) {
        assert.ok(AXES.includes(d.axis), `${name} ${where}: ${d.kind} has the axis ${JSON.stringify(d.axis)}, none of ${AXES.join(', ')}`);
        assert.equal(d.axis, DRAWN[d.kind], `${name} ${where}: ${d.kind} is drawn on ${DRAWN[d.kind]}`);
      }
    }
    const { stored } = D.describeStored(descriptor, options);
    const entry = throughJson(stored);
    assert.deepEqual(entry.body.displays.map((d) => d.axis), out.description.displays.map((d) => d.axis), `${name}: the stored body carries the axis`);
    const from = D.describeFromStored(entry, {});
    assert.deepEqual(from.description.displays.map((d) => d.axis), out.description.displays.map((d) => d.axis), `${name}: describeFromStored serves it`);
  });
}

// -- sabotage: a stored body is a person's to edit (docs/descriptions-store.md 3.4, `edited`); its axis is checked against the item
const withDisplay = corpus.find(({ descriptor, options }) => D.describe(descriptor, options).description?.displays.length);
const sabotaged = (edit) => {
  const entry = throughJson(D.describeStored(withDisplay.descriptor, withDisplay.options).stored);
  edit(entry.body.displays[0]);
  return D.describeFromStored(entry, {});
};

test('arm: a stored display whose axis is no PANEL_DISPLAY_AXES word is refused, naming the word', () => {
  const out = sabotaged((d) => { d.axis = 'logarithmic'; });
  assert.equal(out.description, null);
  assert.equal(out.refusals.length, 1);
  assert.equal(out.refusals[0].code, 'panel.describe.layout-invalid');
  assert.match(JSON.stringify(out.refusals[0].args), /'logarithmic'/);
  assert.match(JSON.stringify(out.refusals[0].args), /PANEL_DISPLAY_AXES/);
});

test('arm: a stored display with no axis is refused by name, no axis inferred from its kind', () => {
  const out = sabotaged((d) => { delete d.axis; });
  assert.equal(out.description, null);
  assert.equal(out.refusals[0].code, 'panel.describe.layout-invalid');
  assert.match(JSON.stringify(out.refusals[0].args), /no axis/);
});
