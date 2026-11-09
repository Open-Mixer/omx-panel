// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The MOD GUI draws a meter of the description as a static frame with its range (contract 7.9): a band below the sections,
 * a caption with the label, the range and the unit, no live meter (no port role) until the live MOD GUI spec. A meter that is a
 * control of a section is that control's own face and is not drawn twice.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { layout, meterCaption, emitTemplate, resolvePanel, GEOMETRY } from '../dist/tools/modgui-gen.mjs';

const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/meters/${f}`, import.meta.url), 'utf8'));
const resolved = (descriptor = load('meters.descriptor.json')) => resolvePanel(descriptor, { panel: load('meters.panel.json'), stem: 'meters' });

test('the panel resolves the descriptor\'s four meters, in order, with the description\'s range', () => {
  assert.deepEqual(resolved().meters.map((m) => [m.symbol, m.min, m.max, m.unit]), [['in_level', -60, 0, 'dBFS'], ['out_level', -60, 0, 'dBTP'], ['gr', -24, 0, 'dB'], ['lufs', -70, 0, 'LUFS']]);
});
test('the band sits below the last section and holds a row for each meter', () => {
  const lay = layout(resolved()), g = GEOMETRY, last = lay.sections.at(-1);
  assert.equal(lay.band.y, last.y + last.h + g.sectionGap);
  assert.equal(lay.band.h, g.sectionTitleH + 4 * (g.meterH + g.meterGap) + g.sectionPad / 2);
  assert.equal(lay.h, lay.band.y + lay.band.h + g.pad);
});
test('arm: a descriptor with no meters word has no band and the face is as it was', () => {
  const d = load('meters.descriptor.json'); delete d.meters;
  const lay = layout(resolved(d));
  assert.equal(lay.band, null);
  assert.equal(lay.h, lay.sections.at(-1).y + lay.sections.at(-1).h + GEOMETRY.pad);
});
test('the caption is the label, the range and the unit', () => {
  assert.equal(meterCaption({ label: 'Gain reduction', min: -24, max: 0, unit: 'dB' }), 'Gain reduction  -24 to 0 dB');
});
test('the template carries a static frame for each meter and no port role', () => {
  const html = emitTemplate(resolved(), layout(resolved()), "test");
  assert.equal((html.match(/omx-meter-frame"/g) ?? []).length, 4);
  assert.match(html, /Gain reduction  -24 to 0 dB/);
  assert.ok(!/mod-role="output-control-port"[^>]*omx-meter|omx-meter[^>]*mod-role/.test(html));
});
