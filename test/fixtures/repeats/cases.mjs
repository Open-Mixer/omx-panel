// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The repeated-group fixtures the renderer's tests draw. Each `<name>.layout.json` is the panel description `omx-panel layout`
// writes for the fixture, with the sections of its repeated group merged into one that carries `matrix`: the shape the served
// description takes (omx-panel#61; docs/renderer.md), filled from the group model's matrixOf by tools/repeats-fixture.mjs. It is
// the one matrix both the MOD GUI face and the renderer are held to; neither derives it again.
export const CASES = [
  { name: 'omx-eq8', descriptor: 'test/fixtures/group-model/omx-plugins/omx-eq8.descriptor.json', orientation: 'columns', stem: 'omx-eq8', needsTwin: true },
  { name: 'eq-marks', descriptor: 'test/fixtures/eq-marks/eq.descriptor.json', panel: 'test/fixtures/eq-marks/eq.panel.json', orientation: 'columns', stem: 'eq', needsTwin: true },
  { name: 'mbc', descriptor: 'test/fixtures/repeats/mbc.descriptor.json', orientation: 'rows', stem: 'mbc' },
];
