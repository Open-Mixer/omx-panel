// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * describe-served-panel.test.mjs — describe given a plugin's own panel over a scan's descriptor (#43, measured on the
 * Raspberry Pi 5 with omx-comp 0.19.3): the roles come from the panel's declaration in place of the scan's `unknown`
 * meanings, so the panel's family is backed and its displays drawn; a meaning the descriptor does state still has to
 * agree with the role. The panel is the one omx-comp serves, as omx-clap-scan --json prints it and plugin-hostd-probe
 * panel copies it (test/fixtures/panels/omx-comp.served.json, from omx-plugins' generated rows), read as the declared
 * form (tools/panel-served.mjs). Each rule is held by value, with an arm that breaks its input and reads the result change.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, DESCRIBE_CODES } from '../dist/tools/describe.mjs';
import { keyOf, panelLayout } from '../dist/tools/panel-description.mjs';
import { declaredFromServed, isServedPanel } from '../dist/tools/panel-served.mjs';
import { INDEXED_ROLES } from '../dist/tools/role-table.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (...p) => JSON.parse(readFileSync(join(FIXTURES, ...p), 'utf8'));
const scan = () => fixture('descriptors', 'scanned-clap-omx-comp.json');
const served = () => fixture('panels', 'omx-comp.served.json');
const ROLES = [['threshold', '0'], ['ratio', '1'], ['knee', '2'], ['attack', '3'], ['release', '4'], ['makeup', '5'], ['mix', '6']].sort();

// -- the Pi's measurement: a scan's descriptor (every meaning unknown) with the plugin's own panel
test('the scan writes every meaning unknown, and the panel declares the dynamics family with seven roles', () => {
  const d = scan();
  assert.ok(d.controls.every((c) => c.meaning === 'unknown' || c.meaning === 'bypass'), 'the fixture is scan-shaped');
  assert.ok(d.controls.every((c) => c.symbol === undefined), 'a CLAP scan carries no symbol');
  const p = served();
  assert.equal(p.panel.family, 'dynamics');
  assert.equal(p.panel.roles.length, 7);
  assert.ok(isServedPanel(p) && isServedPanel(p.panel) && !isServedPanel({ family: 'dynamics', sections: [] }));
});
test('given the served panel, describe backs the dynamics family from the roles: the curve and the bar are drawn, no refusal', () => {
  const { description, refusals } = describe(scan(), { panel: served() });
  assert.deepEqual(refusals, []);
  assert.equal(description.family, 'dynamics');
  assert.deepEqual(description.displays.map((x) => x.kind).sort(), ['gain_reduction_bar', 'transfer_curve']);
  assert.deepEqual(description.roles.map((r) => [r.role, r.symbol]).sort(), ROLES);
  assert.deepEqual(description.sections.map((s) => s.key), ['comp', 'key', 'duck']);
});
test('a control the panel binds to a role carries the role\'s meaning in the layout, in place of the scan\'s unknown; an unbound one stays unknown', () => {
  // the layout's controls carry the meaning a skin binds by; the served params stay the descriptor's facts (their fingerprint)
  const out = describe(scan(), { panel: served(), withLayout: true });
  const meaning = (key) => out.layout.controls.find((c) => c.symbol === key)?.meaning;
  assert.equal(meaning('p0'), 'threshold');
  assert.equal(meaning('p1'), 'ratio');
  assert.equal(meaning('p6'), 'wetDryRatio');
  assert.equal(meaning('p15'), 'unknown');
  assert.equal(scan().controls.find((c) => c.id === 0).meaning, 'unknown', 'the descriptor\'s own word is unknown: the layout\'s meaning is the panel\'s, not a rewrite of the input');
});
test('arm: the same panel with its roles dropped is the measurement of #43 again, family none and the refusal by code', () => {
  const p = served();
  p.panel.roles = [];
  const { description, refusals } = describe(scan(), { panel: p });
  assert.equal(description.family, 'none');
  assert.deepEqual(refusals.map((r) => r.code), [DESCRIBE_CODES.familyNotBacked]);
  assert.match(refusals[0].args.message, /the dynamics family needs a control meaning threshold or ratio/);
  assert.deepEqual(description.displays, []);
});
test('a meaning the descriptor states still has to agree with the role it is bound to: a disagreement is named, the role not bound', () => {
  const d = scan();
  d.controls.find((c) => c.id === 0).meaning = 'ratio';
  const { description, refusals } = describe(d, { panel: served() });
  assert.equal(description.family, 'dynamics', 'the other roles still back the family');
  const dropped = refusals.filter((r) => r.code === DESCRIBE_CODES.roleDropped);
  assert.deepEqual(dropped.map((r) => [r.args.entry, r.args.symbol]), [['threshold', '0']]);
  assert.match(dropped[0].args.reason, /says it means ratio, not threshold/);
  assert.ok(!description.roles.some((r) => r.role === 'threshold'));
  assert.equal(describe(d, { panel: served(), withLayout: true }).layout.controls.find((c) => c.symbol === 'p0').meaning, 'ratio', 'a stated meaning stays the descriptor\'s');
  // arm: the same meaning as the role's agrees, and is bound
  d.controls.find((c) => c.id === 0).meaning = 'threshold';
  assert.deepEqual(describe(d, { panel: served() }).refusals, []);
});

// -- the served form, read as the declared form over the descriptor's keys
test('the served tables become the declared panel: sections by row order, roles and widgets by the descriptor\'s key, the family display a graph', () => {
  const declared = declaredFromServed(served(), scan(), { keyOf, indexedRoles: INDEXED_ROLES });
  assert.equal(declared.family, 'dynamics');
  assert.deepEqual(declared.sections.map((s) => [s.key, s.label, s.graph ?? null]), [['comp', 'Comp', 'dynamics-curve'], ['key', 'Key', null], ['duck', 'Duck', null]]);
  assert.deepEqual(declared.sections[0].controls, ['p0', 'p1', 'p2', 'p3', 'p4', 'p15', 'p5', 'p6', 'p7', 'p8', 'p9']);
  assert.deepEqual(declared.roles, { threshold: 'p0', ratio: 'p1', attack: 'p3', release: 'p4', knee: 'p2', makeup: 'p5', mix: 'p6' });
  assert.deepEqual(declared.widgets, Object.fromEntries(['p0', 'p1', 'p2', 'p3', 'p4', 'p15', 'p5', 'p6', 'p11', 'p12', 'p13', 'p18'].map((k) => [k, 'knob']).concat([['p14', 'switch'], ['p17', 'switch']])));
  assert.equal(declared.visibleWhen, undefined);
  // the scan's object alone (without the probe's plugin wrapper) reads the same
  assert.deepEqual(declaredFromServed(served().panel, scan(), { keyOf, indexedRoles: INDEXED_ROLES }), declared);
  // and the layout over it is the layout over the served form
  assert.deepEqual(panelLayout(scan(), { panel: served() }).roles, panelLayout(scan(), { panel: declared }).roles);
});
test('a visibility row becomes a visibleWhen rule over the mask\'s set bits; an indexed role keeps every index', () => {
  const p = served().panel;
  p.controls.find((c) => c.paramId === 18).visibleParamId = 17;
  p.controls.find((c) => c.paramId === 18).visibleMask = '2';
  const declared = declaredFromServed(p, scan(), { keyOf, indexedRoles: INDEXED_ROLES });
  assert.deepEqual(declared.visibleWhen, { p18: { param: 'p17', values: [1] } });
  const shown = describe(scan(), { panel: p }).description.controls.find((c) => c.symbol === '18');
  assert.deepEqual(shown.visibleWhen, { param: '17', values: [1] });
  const eq = { fingerprint: 'x', family: 'eq', sections: [{ key: 's', label: 'S' }], controls: [{ paramId: 11, section: 0, widget: 'auto' }, { paramId: 12, section: 0, widget: 'auto' }], roles: [{ role: 'band_freq', index: 1, paramId: 12 }, { role: 'band_freq', index: 0, paramId: 11 }], displays: [] };
  assert.deepEqual(declaredFromServed(eq, scan(), { keyOf, indexedRoles: INDEXED_ROLES }).roles, { band_freq: ['p11', 'p12'] });
});
test('a served panel naming a parameter the descriptor does not have, a refused table, or no panel at all is refused by name', () => {
  const p = served();
  p.panel.roles[0].paramId = 99;
  const { description, refusals } = describe(scan(), { panel: p });
  assert.equal(description, null);
  assert.deepEqual(refusals.map((r) => r.code), [DESCRIBE_CODES.layoutInvalid]);
  assert.match(refusals[0].args.message, /the threshold role names parameter 99, which the descriptor does not have/);
  const refused = served();
  refused.panel.controls = { refused: 'too-many', count: 5000, max: 4096 };
  assert.throws(() => declaredFromServed(refused, scan(), { keyOf, indexedRoles: INDEXED_ROLES }), /the served controls table was refused by the scan \(too-many: 5000 entries, at most 4096\)/);
  assert.throws(() => declaredFromServed({ plugin: { format: 'clap', id: 'x' }, panel: null }, scan(), { keyOf, indexedRoles: INDEXED_ROLES }), /serves no panel/);
});
