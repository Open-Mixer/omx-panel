// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * describe-scanned.test.mjs — describe over descriptors as plugin-qualify's scan writes them (test/fixtures/descriptors/
 * scanned-*.json, each one plugin's file as a scan wrote it): what the console's own derivation served for the plugin,
 * describe serves, because the console takes describe's description at the switch and its sessions compare the params
 * (the one-panel spec §4.4: a params fact, a control, a role the old panel had, or a plugin that had a panel, are never
 * explained away). Each rule is held by value, with an arm that breaks its input and reads the result change.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidatesOf, describe, DESCRIBE_CODES, servedSymbolOf } from '../dist/tools/describe.mjs';
import { inferBands } from '../dist/tools/meaning-infer.mjs';
import { panelLayout } from '../dist/tools/panel-description.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'descriptors');
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

// -- a CLAP parameter is served under the name a host sets it by
test('a CLAP plugin\'s params, controls and Easy list are served under each parameter\'s id in decimal', () => {
  const d = fixture('scanned-clap-balancer.json');
  const ids = d.controls.map((c) => String(c.id));
  const { description, refusals } = describe(d);
  assert.deepEqual(refusals, []);
  assert.deepEqual(description.params.map((p) => p.symbol), ids);
  assert.deepEqual(description.controls.map((c) => c.symbol).sort(), [...ids].sort());
  assert.ok(description.easy.length > 0 && description.easy.every((s) => ids.includes(s)), JSON.stringify(description.easy));
  // the pages slot the parameter itself, as before
  assert.deepEqual(description.pages.flatMap((p) => p.ids).filter((v) => v !== null).sort((a, b) => a - b), d.controls.map((c) => c.id).sort((a, b) => a - b));
});
test('arm: the layout keeps its own key p<id> for a CLAP control; only the description serves the id', () => {
  const d = fixture('scanned-clap-balancer.json');
  assert.deepEqual(panelLayout(d).controls.map((c) => c.symbol).sort(), d.controls.map((c) => `p${c.id}`).sort());
  assert.equal(servedSymbolOf({ id: 7 }), '7');
  assert.equal(servedSymbolOf({ id: 'gain', symbol: 'gain' }), 'gain');
  assert.equal(servedSymbolOf({ id: 'g_0' }), 'g_0');
});
test('a CLAP plugin\'s roles and visibility name the served symbol too', () => {
  const t = (id, name, meaning, unit, extra = {}) => ({ id, name, kind: 'travel', meaning, travel: { min: 0, max: 10, unit, scale: 'linear', default: 1 }, ...extra });
  const d = {
    origin: 'scanned', plugin: { id: 'org.test.comp', format: 'clap', name: 'Comp', features: ['audio-effect'] },
    extensions: { clap: { 'clap_plugin_descriptor.features': ['audio-effect', 'compressor'] } },
    controls: [t(0, 'Threshold', 'threshold', 'dB'), t(1, 'Ratio', 'ratio', 'ratio'), t(2, 'Attack', 'attack', 'ms'), t(3, 'Release', 'release', 'ms'), { id: 4, name: 'Side', kind: 'toggle', default: false }], ports: [],
  };
  const { description } = describe(d);
  assert.equal(description.family, 'dynamics');
  assert.deepEqual(description.roles.map((r) => [r.role, r.symbol]), [['threshold', '0'], ['ratio', '1'], ['attack', '2'], ['release', '3']]);
  const panel = { sections: [{ key: 'main', label: 'Main', controls: ['p0', 'p1', 'p2', 'p3', 'p4'] }], visibleWhen: { p2: { param: 'p4', values: [1] } } };
  const shown = describe(d, { panel }).description.controls.find((c) => c.symbol === '2');
  assert.deepEqual(shown.visibleWhen, { param: '4', values: [1] });
});
test('an LV2 control is served under its symbol, as before', () => {
  const d = fixture('scanned-lv2-mda-leslie.json');
  assert.deepEqual(describe(d).description.params.map((p) => p.symbol), d.controls.map((c) => c.id));
});

// -- the band inference reads a scan's `unknown` as no meaning; the LSP equalizer is an eq again
test('the inference reads a scanned control whose meaning is `unknown` as one with no meaning', () => {
  const d = fixture('scanned-lv2-lsp-para-equalizer-x16-mono.json');
  assert.ok(d.controls.every((c) => c.meaning === 'unknown' || c.meaning === 'enabled'), 'the scan wrote unknown');
  const v = inferBands(d.controls);
  assert.equal(v.outcome, 'inferred');
  // arm: a control the descriptor names a real meaning is still not read
  assert.equal(inferBands(d.controls.map((c) => (/^[fgw]_\d+$/.test(c.id) ? { ...c, meaning: 'gain' } : c))).outcome, 'no-confident-inference');
});
test('LSP Para Equalizer x16 Mono: the declared ParaEQ class is kept, with every band role the console\'s derivation held', () => {
  const d = fixture('scanned-lv2-lsp-para-equalizer-x16-mono.json');
  assert.deepEqual(candidatesOf(d), ['eq']);
  const { description } = describe(d);
  assert.equal(description.family, 'eq');
  const role = (r, i) => description.roles.find((x) => x.role === r && x.index === i)?.symbol;
  for (let i = 0; i < 16; i++) {
    assert.deepEqual([role('band_freq', i), role('band_gain', i), role('band_q', i), role('band_type', i)], [`f_${i}`, `g_${i}`, `w_${i}`, `ft_${i}`], `band ${i}`);
  }
  assert.ok(description.roles.every((r) => r.inferred === true));
  assert.deepEqual(description.displays.map((x) => [x.kind, x.basis]), [['eq_response', 'modelled']]);
});
test('LSP: a band gain read as a linear factor, its unit unstated, is served `coef`; a gain beside it in no band stays none', () => {
  const d = fixture('scanned-lv2-lsp-para-equalizer-x16-mono.json');
  const unit = (s) => describe(d).description.params.find((p) => p.symbol === s).unit;
  assert.deepEqual(Array.from({ length: 16 }, (_, i) => unit(`g_${i}`)), Array(16).fill('coef'));
  assert.equal(unit('g_in'), 'none');
  // arm: the same controls with no declared class make no eq, so no band, so no factor
  const plain = { ...d, extensions: {} };
  assert.equal(describe(plain).description.params.find((p) => p.symbol === 'g_0').unit, 'none');
});
test('a Q whose default is zero is no band\'s Q: the width in octaves beside it is', () => {
  const band = (q) => [
    { id: 'f_0', name: 'Frequency 0', kind: 'travel', meaning: 'unknown', travel: { min: 10, max: 24000, unit: 'Hz', scale: 'log', default: 1000 } },
    { id: 'w_0', name: 'Filter Width 0', kind: 'travel', meaning: 'unknown', travel: { min: 0, max: 12, unit: 'oct', scale: 'linear', default: 4 } },
    { id: 'g_0', name: 'Gain 0', kind: 'travel', meaning: 'unknown', travel: { min: 0.0158, max: 63.1, unit: 'unknown', scale: 'log', default: 1 } },
    { id: 'q_0', name: 'Quality factor 0', kind: 'travel', meaning: 'unknown', travel: { min: q.min, max: 100, unit: 'unknown', scale: 'linear', default: q.default } },
  ];
  const qOf = (q) => inferBands(band(q)).roles.find((r) => r.role === 'band_q').symbol;
  assert.equal(qOf({ min: 0, default: 0 }), 'w_0');
  // arm: a Q that runs above zero is the band's Q, over the width
  assert.equal(qOf({ min: 0.1, default: 0.7 }), 'q_0');
});

// -- params facts: a choice and a default the console served
test('mda Leslie: a choice whose values lie between integers is served as the console served it, unlabelled, its default an integer', () => {
  const d = fixture('scanned-lv2-mda-leslie.json');
  const mode = describe(d).description.params.find((p) => p.symbol === 'mode');
  assert.deepEqual(d.controls.find((c) => c.id === 'mode').values, [0, 0.5, 1]);
  assert.deepEqual([mode.min, mode.max, mode.step, mode.scale, mode.default, mode.enumLabels], [0, 1, 1, 'stepped', 1, undefined]);
  // arm: the same choice on integer values is labelled, one label per value
  const whole = { ...d, controls: d.controls.map((c) => (c.id === 'mode' ? { ...c, values: [0, 1, 2] } : c)) };
  assert.deepEqual(describe(whole).description.params.find((p) => p.symbol === 'mode').enumLabels, ['Stop', 'Slow', 'Fast']);
});
test('a sparse choice is labelled once per integer of its span, as the console served it', () => {
  const sizes = [128, 256, 512, 1024];
  const c = { id: 'fftsize', name: 'FFT Size', kind: 'choice', ids: sizes.map(String), labels: sizes.map(String), values: sizes, default: '256', meaning: 'unknown' };
  const p = describe({ origin: 'scanned', plugin: { id: 'urn:test:fft', format: 'lv2', name: 'FFT', features: [] }, controls: [c], ports: [] }).description.params[0];
  assert.equal(p.enumLabels.length, 1024 - 128 + 1);
  assert.deepEqual([p.enumLabels[0], p.enumLabels[1], p.enumLabels[128], p.default], ['128', '129', '256', 256]);
});
test('a default outside the travel\'s ends is the floor, as the console served it', () => {
  const t = (def) => describe({ origin: 'scanned', plugin: { id: 'urn:test:sin', format: 'lv2', name: 'S', features: [] }, controls: [{ id: 'freq', name: 'Base frequency (Hz)', kind: 'travel', meaning: 'unknown', travel: { min: 0.000001, max: 0.5, unit: 'unknown', scale: 'log', default: def } }], ports: [] }).description.params[0].default;
  assert.equal(t(440), 0.000001);
  // arm: a default inside the ends rides
  assert.equal(t(0.25), 0.25);
});

// -- a refusal of a descriptor the console drew: the descriptor is invalid
test('eq10q stereo is refused by name: its TTL gives two ports one symbol (out_2_vu_ctl), which LV2 forbids', () => {
  const d = fixture('scanned-lv2-eq10q-eq1qs.json');
  assert.deepEqual(d.controls.filter((c) => c.id === 'out_2_vu_ctl').map((c) => c.name), ['Out 1 VU CTL', 'Out 2 VU CTL']);
  const { description, refusals } = describe(d);
  assert.equal(description, null);
  assert.deepEqual(refusals.map((r) => r.code), [DESCRIBE_CODES.layoutInvalid]);
  assert.match(refusals[0].args.message, /'out_2_vu_ctl' is a control twice/);
  // arm: the second port under its own symbol, as the mono build and the TTL's name say, lays out
  let seen = false;
  const fixed = { ...d, controls: d.controls.map((c) => (c.id === 'out_2_vu_ctl' && (seen = !seen) ? { ...c, id: 'out_1_vu_ctl' } : c)) };
  assert.notEqual(describe(fixed).description, null);
});

// -- a family the controls do not back is a listed loss (§3.1.1 step 2)
test('LSP Compressor Mono: the declared class names dynamics, but no control carries the meanings it stands on, so none', () => {
  const d = fixture('scanned-lv2-lsp-compressor-mono.json');
  assert.deepEqual(candidatesOf(d), ['dynamics']);
  assert.equal(describe(d).description.family, 'none');
  // arm: the same descriptor with the two meanings stated keeps the family
  const named = { ...d, controls: d.controls.map((c) => (c.id === 'al' ? { ...c, meaning: 'threshold', travel: { ...c.travel, unit: 'dB', min: -60, max: 0, default: -20 } } : c.id === 'cr' ? { ...c, meaning: 'ratio', travel: { ...c.travel, unit: 'ratio' } } : c.id === 'at' ? { ...c, meaning: 'attack' } : c.id === 'rt' ? { ...c, meaning: 'release' } : c)) };
  assert.equal(describe(named).description.family, 'dynamics');
});

// -- the words name a band's frequency and gain; the inference completes its Q, type and switch
test('omx-eq8 as LV2 scans it: each band the words name gets its Q, its type with shapes and its switch from the inference', () => {
  const d = fixture('scanned-lv2-omx-eq8.json');
  const { description } = describe(d);
  assert.equal(description.family, 'eq');
  const band0 = description.roles.filter((r) => r.index === 0 && r.role.startsWith('band_'));
  const by = Object.fromEntries(band0.map((r) => [r.role, r]));
  assert.equal(by.band_freq.symbol, 'b1_freq');
  assert.equal(by.band_freq.inferred, undefined, 'the words\' own');
  assert.equal(by.band_gain.symbol, 'b1_gain');
  assert.deepEqual([by.band_q.symbol, by.band_q.inferred], ['b1_q', true]);
  assert.deepEqual([by.band_on.symbol, by.band_on.inferred], ['b1_on', true]);
  assert.equal(by.band_type.symbol, 'b1_type');
  assert.deepEqual(by.band_type.shapes, ['bell', 'lowshelf', 'highshelf', 'notch', '-', '-']);
  // all eight bands, each at the words' index
  for (const role of ['band_q', 'band_type', 'band_on']) {
    assert.deepEqual(description.roles.filter((r) => r.role === role).map((r) => [r.index, r.symbol]),
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i, `b${i + 1}_${role.slice(5)}`]), role);
  }
  assert.deepEqual(description.displays.map((x) => x.kind), ['eq_response']);
});

// -- a CLAP parameter's id is a number: its band is read from its name
test('omx-eq8 as CLAP scans it (ids, no units, no meanings): the bands are read from the names, served by id', () => {
  const d = fixture('scanned-clap-omx-eq8.json');
  const { description } = describe(d);
  assert.equal(description.family, 'eq');
  const id = (name) => String(d.controls.find((c) => c.name === name).id);
  const band = (i) => Object.fromEntries(description.roles.filter((r) => r.index === i && r.role.startsWith('band_')).map((r) => [r.role, r.symbol]));
  // the scan gives the type no labels, so no shape can be read from it: the band is drawn as the shape of its names, a bell
  assert.deepEqual(band(0), { band_freq: id('Band 1 Frequency'), band_gain: id('Band 1 Gain'), band_q: id('Band 1 Q'), band_on: id('Band 1 On') });
  assert.equal(description.roles.find((r) => r.role === 'band_freq' && r.index === 0).shape, 'bell');
  assert.deepEqual(band(7).band_freq, id('Band 8 Frequency'));
  assert.deepEqual(description.displays.map((x) => x.kind), ['eq_response']);
});
