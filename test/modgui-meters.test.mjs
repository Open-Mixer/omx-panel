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
import { layout, meterCaption, emitStylesheet, emitTemplate, loadLook, resolvePanel, GEOMETRY } from '../dist/tools/modgui-gen.mjs';

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
test('the stylesheet styles the meter frame whenever a meter stands, with or without a curve', () => {
  const d = load('meters.descriptor.json');
  const p = resolved(d);
  for (const sec of p.sections) sec.displays = [];
  const css = emitStylesheet(p, loadLook(), 'test');
  assert.match(css, /\.omx-meter-frame \{/);
  assert.match(css, /\.omx-meter-caption \{/);
  assert.ok(!/\.omx-curve \{/.test(css), 'no curve here, so no curve rule: the meter rule stands on its own');
});
test('arm: a panel with no meter carries no meter rule', () => {
  const d = load('meters.descriptor.json'); delete d.meters;
  assert.ok(!/omx-meter-frame/.test(emitStylesheet(resolved(d), loadLook(), 'test')));
});
test('the pedal\'s rim takes no layout: every box of the template sits where the raster face draws it', () => {
  const css = emitStylesheet(resolved(), loadLook(), 'test');
  const pedal = /^\.omx-pedal\{\{\{cns\}\}\} \{[^}]*\}/m.exec(css)[0];
  assert.match(pedal, /box-shadow: inset 0 0 0 1px #[0-9a-f]{6}/);
  assert.ok(!/\bborder:/.test(pedal), 'a border would set the sections, the meter frames and every control 1 px right and down of the raster');
});
