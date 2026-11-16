// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The time_response display kind (the processing-view spec, amendment 2026-09-16h; the FX workspace §6: "delay, reverb |
 * time response (the tap train, the decay)"): a delay section drawing `delay-taps` and a reverb section drawing
 * `decay-envelope` are ONE display kind, `time_response`, x time in ms from 0, y level in dB with the floor at −60. Before
 * this kind the two graph words named no kind and describe DROPPED the display in silence: the owner lost the reverb's
 * picture (ruling 6). Held here: the two plugins' own declarations (test/fixtures/omx-delay, omx-reverb) yield the display;
 * a graph word that names no kind is refused by name, never dropped; a served panel carrying the kind reads back to the
 * family's graph word.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { describe, DESCRIBE_CODES } from '../dist/tools/describe.mjs';
import { DISPLAY_KINDS, DISPLAY_OF_GRAPH } from '../tools/panel-description.mjs';
import { declaredFromServed } from '../tools/panel-served.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (...p) => JSON.parse(readFileSync(join(FIXTURES, ...p), 'utf8'));
const family = (fx) => ({ descriptor: read(fx, `${fx}.descriptor.json`), panel: read(fx, `${fx}.panel.json`) });

test('the kind is declared, appended after the four that came before, and both graph words name it', () => {
  assert.deepEqual(DISPLAY_KINDS, ['gain_reduction_bar', 'transfer_curve', 'eq_response', 'meter', 'time_response']);
  assert.equal(DISPLAY_OF_GRAPH['delay-taps'], 'time_response');
  assert.equal(DISPLAY_OF_GRAPH['decay-envelope'], 'time_response');
});

test("omx-delay's declared panel: the delay section's delay-taps is a time_response display of source family", () => {
  const { descriptor, panel } = family('omx-delay');
  const { description, refusals } = describe(descriptor, { panel });
  assert.deepEqual(refusals, []);
  assert.equal(description.family, 'delay');
  assert.deepEqual(description.displays.map((d) => [d.kind, d.source, d.section]), [['time_response', 'family', 'delay']]);
  assert.equal(description.displays[0].basis, 'modelled', 'no declaration says exact');
});

test("omx-reverb's declared panel: the reverb section's decay-envelope is a time_response display of source family", () => {
  const { descriptor, panel } = family('omx-reverb');
  const { description, refusals } = describe(descriptor, { panel });
  assert.deepEqual(refusals, []);
  assert.equal(description.family, 'reverb');
  assert.deepEqual(description.displays.map((d) => [d.kind, d.source, d.section]), [['time_response', 'family', 'reverb']]);
});

test('a graph word that names no display kind is refused by name, never dropped in silence', () => {
  const { descriptor, panel } = family('omx-delay');
  const bad = { ...panel, sections: panel.sections.map((s) => ({ ...s, graph: 'tap-ladder' })) };
  const { description, refusals } = describe(descriptor, { panel: bad });
  assert.equal(description, null, 'no panel is served from a declaration that names no kind');
  assert.deepEqual(refusals.map((r) => r.code), [DESCRIBE_CODES.layoutInvalid]);
  assert.match(refusals[0].args.message, /section 'delay' draws tap-ladder, which names no display kind \(eq-curve, dynamics-curve, transfer-curve, delay-taps, decay-envelope\)/);
});

test('a served panel carrying a time_response display reads back to the family\'s graph word', () => {
  for (const [fx, graph] of [['omx-delay', 'delay-taps'], ['omx-reverb', 'decay-envelope']]) {
    const { descriptor, panel } = family(fx);
    const first = descriptor.controls.find((c) => c.id === panel.sections[0].controls[0] || c.symbol === panel.sections[0].controls[0] || c.name === panel.sections[0].controls[0]) ?? descriptor.controls[0];
    const served = {
      family: panel.family, fingerprint: 'x',
      sections: [{ key: panel.sections[0].key, labelKey: '', label: panel.sections[0].label }],
      controls: [{ paramId: first.id, section: 0 }], roles: [],
      displays: [{ kind: 'time_response', section: 0, source: 'family', meterIds: [null, null], curveIndex: null, floorParamId: null, floorDb: null, labelKey: '', label: panel.sections[0].label }],
      placementDefaults: {},
    };
    const declared = declaredFromServed(served, descriptor, { keyOf: (c) => c.symbol ?? `p${c.id}` });
    assert.equal(declared.sections[0].graph, graph, `${fx}: the served kind reads back as ${graph}`);
  }
});
