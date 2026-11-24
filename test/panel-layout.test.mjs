#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * panel-layout.test.mjs — tools/panel-description.mjs lays a panel out from a descriptor of any origin
 * (docs/panel-layout.md). Each rule is held by value, with an arm that breaks its input and reads the
 * result change:
 *
 *   1. the widget step: each standard widget from the descriptor, a meter's measurement, the widget a
 *      face serves;
 *   2. units come from the descriptor, served when omx-contract's PARAM_UNITS_CLAP_ENCODED holds them: a LUFS and a dBu level role are
 *      published with their unit, an `unknown` unit is a plain number and takes no role (#145);
 *   3. roles from meanings: each meaning plays its family's role, an indexed role takes every band, a
 *      second control of a plain role is named, not published;
 *   4. the family from meanings: inference in order, an instrument none, a declared family its
 *      meanings do not back refused (a transient designer is no compressor, #138);
 *   5. sections from groups, hidden controls left out, the ports carried;
 *   6. omx-contract's example descriptors (@openmixer/omx-contract/examples/descriptors/, read where the
 *      installed package holds them) each give a sensible panel.
 *
 * Part of `make test`. It reads the installed vocabulary (tools/vocabulary.mjs): omx-contract's schema,
 * its param domain (the standard units and the served set, PARAM_UNITS_CLAP_ENCODED). The rule over omx-plugins' own plugins (their authored
 * descriptors state no unknown, and the layout with no declared panel finds the declared family and roles) loads
 * their declarations, so it stays in omx-plugins.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyOf, NoControls, panelLayout, servedWidget, unitToken, widgetOf } from '../tools/panel-description.mjs';
import { servedUnit, standardUnits } from '../tools/vocabulary.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** omx-contract's example descriptor `name`, where the installed package holds it. */
const example = (name) => createRequire(import.meta.url).resolve(`@openmixer/omx-contract/examples/descriptors/${name}`);
const fixture = (name) => JSON.parse(readFileSync(example(`${name}.json`), 'utf8'));
const clone = (x) => structuredClone(x);

let bad = 0, n = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(what, got, want) {
  n++;
  const ok = same(got, want);
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'} panel-layout ${what}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

const travel = (unit, extra = {}) => ({ kind: 'travel', travel: { min: -60, max: 0, unit, default: -20, scale: 'linear' }, ...extra });
const descriptor = (controls, extra = {}) => ({
  origin: 'scanned', plugin: { id: 'urn:test:plugin', format: 'lv2', name: 'Test', features: ['audio-effect'] },
  controls: controls.map((c, i) => ({ id: i, name: `c${i}`, ...c })), ports: [], ...extra,
});
const rolesOf = (x) => x.roles.map((r) => [r.role, r.index, r.symbol, r.unit]);

// 1. the widget step
check('a travel is a knob', widgetOf(travel('dB')), { widget: 'knob' });
check('a toggle is a switch', widgetOf({ kind: 'toggle' }), { widget: 'switch' });
check('a trigger is a momentary switch', widgetOf({ kind: 'trigger' }), { widget: 'switch', momentary: true });
check('a choice is a selector', widgetOf({ kind: 'choice', ids: ['a', 'b'] }), { widget: 'selector' });
check('a read-only dB travel is a meter whose measurement is not stated', widgetOf(travel('dB', { readonly: true })), { widget: 'meter', measurement: null, held: false, clip: false });
check('a read-only LUFS travel is a foreign meter: measurement is never guessed from the unit', widgetOf(travel('LUFS', { readonly: true })), { widget: 'meter', measurement: null, held: false, clip: false });
check('arm: the same LUFS travel, not read-only, is a knob', widgetOf(travel('LUFS')), { widget: 'knob' });
check('arm: a read-only travel in no level unit is a display', widgetOf(travel('ms', { readonly: true })), { widget: 'display' });
check('a declared fader wins', widgetOf(travel('dB'), 'fader'), { widget: 'fader' });
check('a declared selector is a selector', widgetOf(travel(''), 'selector'), { widget: 'selector' });
check('a face serves knob, fader and switch as they are, every other widget as auto',
  ['knob', 'fader', 'switch', 'selector', 'meter', 'curve', 'xy', 'display'].map(servedWidget), ['knob', 'fader', 'switch', 'auto', 'auto', 'auto', 'auto', 'auto']);

// 2. units from the descriptor (#145)
const levels = { family: 'limiter', roles: { threshold: 'p0', ceiling: 'p1' }, sections: [{ key: 'main', label: 'Main', controls: ['p0', 'p1'] }] };
const loud = descriptor([travel('LUFS', { meaning: 'threshold' }), travel('dBu', { meaning: 'ceiling' })]);
check('a LUFS and a dBu level role are published with their units', rolesOf(panelLayout(loud, { panel: levels })), [['threshold', 0, 'p0', 'LUFS'], ['ceiling', 0, 'p1', 'dBu']]);
const lost = clone(loud);
lost.controls[0].travel.unit = 'unknown';
const lostX = panelLayout(lost, { panel: levels });
check('arm: an unknown unit takes no role, named', [rolesOf(lostX), lostX.unpublished], [[['ceiling', 0, 'p1', 'dBu']], [{ role: 'threshold', symbol: 'p0', why: 'the threshold role takes dB, dBFS, dBu, LUFS, not unknown' }]]);
check('an unknown unit is a plain number: a knob with no token', [lostX.controls[0].standard, lostX.controls[0].unit, unitToken('unknown')], [{ widget: 'knob' }, 'unknown', undefined]);
check('every unit the param-contract table serves has the standard id a role reads', [...standardUnits().keys()].filter((id) => servedUnit(id)).filter((u) => typeof unitToken(u) !== 'string'), []);

// 3. roles from meanings, with no declared panel
const comp = descriptor([travel('dB', { meaning: 'threshold' }), { kind: 'travel', meaning: 'ratio', travel: { min: 1, max: 20, unit: 'coef', default: 4, scale: 'log' } }, travel('dB', { meaning: 'makeup' })]);
check('each meaning plays its family role', rolesOf(panelLayout(comp)), [['threshold', 0, 'p0', 'dB'], ['ratio', 0, 'p1', 'coef'], ['makeup', 0, 'p2', 'dB']]);
const twice = clone(comp);
twice.controls[2].meaning = 'threshold';
const twiceX = panelLayout(twice);
check('arm: a second threshold is not published, and names the first', [rolesOf(twiceX), twiceX.unpublished], [[['threshold', 0, 'p0', 'dB'], ['ratio', 0, 'p1', 'coef']], [{ role: 'threshold', symbol: 'p2', why: 'the threshold role is played by p0' }]]);
const hz = (m) => ({ kind: 'travel', meaning: m, travel: { min: 20, max: 20000, unit: 'Hz', default: 1000, scale: 'log' } });
const gain = { kind: 'travel', meaning: 'gain', travel: { min: -18, max: 18, unit: 'dB', default: 0, scale: 'linear' } };
const q = { kind: 'travel', meaning: 'q', travel: { min: 0.1, max: 10, unit: 'none', default: 0.7, scale: 'log' } };
const eq = descriptor([hz('frequency'), gain, q, hz('frequency'), gain, q]);
const eqX = panelLayout(eq);
check('an indexed role takes every band, in order', [eqX.family, rolesOf(eqX).filter(([r]) => r === 'band_gain')], ['eq', [['band_gain', 0, 'p1', 'dB'], ['band_gain', 1, 'p4', 'dB']]]);

// a phaser's depth is a sweep in octaves (omx-plugins#232): the role is published with its unit
const sweep = (unit) => ({ kind: 'travel', meaning: 'depth', travel: { min: 0, max: 6, unit, default: 4, scale: 'linear' } });
const rate = { kind: 'travel', meaning: 'rate', travel: { min: 0.05, max: 5, unit: 'Hz', default: 0.5, scale: 'log' } };
const phaser = { family: 'modulation', roles: { rate: 'p0', depth: 'p1' }, sections: [{ key: 'phaser', label: 'Phaser', controls: ['p0', 'p1'] }] };
const phaserX = panelLayout(descriptor([rate, sweep('oct')]), { panel: phaser });
check('a modulation depth in octaves is published with its unit', [rolesOf(phaserX), phaserX.unpublished], [[['rate', 0, 'p0', 'Hz'], ['depth', 0, 'p1', 'oct']], []]);
const dB = panelLayout(descriptor([rate, sweep('dB')]), { panel: phaser });
check('arm: a depth in dB is still named, not published', [rolesOf(dB), dB.unpublished], [[['rate', 0, 'p0', 'Hz']], [{ role: 'depth', symbol: 'p1', why: 'the depth role takes none, percent, coef, oct, not dB' }]]);

// 4. the family from meanings
check('threshold and ratio make dynamics', panelLayout(comp).family, 'dynamics');
const gate = clone(comp);
gate.controls.push({ id: 9, name: 'p9', ...travel('dB', { meaning: 'range' }) });
check('arm: a range beside them makes a gate (tried first)', panelLayout(gate).family, 'gate');
const plain = clone(comp);
delete plain.controls[1].meaning;
check('arm: no ratio, no family', [panelLayout(plain).family, panelLayout(plain).roles], ['none', []]);

const declared = (family, roles) => ({ family, roles, sections: [{ key: 'main', label: 'Main', controls: ['p0', 'p1', 'p2'] }] });
const shaper = descriptor([travel('dB'), travel('dB'), { kind: 'travel', meaning: 'attack', travel: { min: 1, max: 100, unit: 'ms', default: 10, scale: 'log' } }]);
check('a declared family its meanings do not back is refused, naming what it needs (#138)', (() => {
  try { panelLayout(shaper, { panel: declared('dynamics', { attack: 'p2' }), where: 'shaper' }); return 'laid out'; } catch (e) { return e.message; }
})(), 'shaper: the dynamics family needs a control meaning threshold or ratio, and its meanings are attack: its family is none');
const backed = clone(shaper);
backed.controls[0].meaning = 'threshold';
check('arm: a threshold backs it', panelLayout(backed, { panel: declared('dynamics', { threshold: 'p0', attack: 'p2' }) }).family, 'dynamics');
check('a modulation family needs no meaning yet (a rotor has no word for its speeds)', panelLayout(shaper, { panel: declared('modulation', {}) }).family, 'modulation');

// 5 and 6. omx-contract's example descriptors
const lv2 = panelLayout(fixture('scanned-lv2-compressor'));
check('scanned LV2 compressor: family dynamics from its meanings', lv2.family, 'dynamics');
check('scanned LV2 compressor: sections from its groups, the ungrouped under controls', lv2.sections.map((s) => [s.key, s.label, s.labelKey]), [['detector', 'Detector', null], ['controls', 'Controls', null]]);
check('scanned LV2 compressor: the widgets, each control by its port symbol', lv2.controls.map((c) => [c.symbol, c.standard.widget, c.widget]), [
  ['threshold', 'knob', 'knob'], ['ratio', 'knob', 'knob'], ['release_beats', 'knob', 'knob'], ['makeup', 'knob', 'knob'], ['enable', 'switch', 'switch'], ['gr', 'meter', 'auto'],
]);
check('scanned LV2 compressor: the threshold role, by meaning', rolesOf(lv2), [['threshold', 0, 'threshold', 'dB']]);
check('scanned LV2 compressor: its ratio states no unit (LV2 has none for a ratio), so the role is named, not published', lv2.unpublished, [{ role: 'ratio', symbol: 'ratio', why: 'the ratio role takes ratio, coef, not no unit' }]);
check('scanned LV2 compressor: the gain-reduction meter states no measurement, held or clip', lv2.controls.find((c) => c.symbol === 'gr').standard, { widget: 'meter', measurement: null, held: false, clip: false });
check('scanned LV2 compressor: the ports, side-chain among them', lv2.ports, {
  inputs: [{ id: 'main_in', name: 'Input', role: 'main', channels: 2 }, { id: 'sidechain_in', name: 'Side-chain', role: 'sidechain', channels: 1 }],
  outputs: [{ id: 'main_out', name: 'Output', role: 'main', channels: 2 }], sidechain: true, notes: false,
});
const clap = panelLayout(fixture('scanned-clap-unknown'));
check('scanned CLAP, nothing stated: family none, a nested group a dotted key', [clap.family, clap.sections.map((s) => [s.key, s.label])], ['none', [['oscillator', 'Oscillator'], ['filter.envelope', 'Filter / Envelope']]]);
check('scanned CLAP, nothing stated: a selector and a plain-number knob', clap.controls.map((c) => [c.symbol, c.standard.widget, c.unit]), [['p3', 'selector', 'none'], ['p5', 'knob', 'unknown']]);
const synth = panelLayout(fixture('built-wrapped-synth'));
check('built instrument: no effect family, the hidden control left out, notes in', [synth.family, synth.controls.map((c) => [c.sectionKey, c.symbol, c.standard.widget]), synth.ports.notes], [
  'none', [['filter', 'p10', 'knob'], ['filter', 'p11', 'knob'], ['envelope', 'p20', 'knob'], ['controls', 'p21', 'knob'], ['controls', 'p40', 'switch'], ['oscillator', 'p30', 'selector'], ['oscillator', 'p31', 'knob']], true,
]);
const effect = fixture('built-wrapped-synth');
effect.plugin.features = ['audio-effect'];
effect.instrument = undefined;
check('arm: the same controls on an effect make a filter', panelLayout(effect).family, 'filter');
const delay = panelLayout(fixture('authored-omx-delay'));
check('authored omx delay descriptor, with no panel: family delay, roles by meaning', [delay.family, rolesOf(delay)], ['delay', [['time', 0, 'fxDelayTime', 'ms'], ['feedback', 0, 'fxDelayFeedback', 'none'], ['tone', 0, 'tone', 'none'], ['mix', 0, 'mix', 'none']]]);

// a CLAP control is keyed by its numeric id, p<id>: two parameters of one name are two controls (#27)
const dup = descriptor([{ ...travel('dB'), id: 3670762539, name: 'Filter mode' }, { ...travel('dB'), id: 1515688365, name: 'Filter mode' }]);
const dupX = panelLayout(dup);
check('a CLAP control is keyed p<id>: two controls of one name are two controls', [dupX.controls.map((c) => c.symbol), dupX.controls.map((c) => c.label)], [['p3670762539', 'p1515688365'], ['Filter mode', 'Filter mode']]);
check('arm: a symbol and an LV2 string id still key the control', [{ symbol: 'a', id: 1, name: 'x' }, { id: 'gain', name: 'y' }, { id: 7, name: 'z' }].map(keyOf), ['a', 'gain', 'p7']);

// a descriptor with no control to lay out is refused by code and says why, not laid out as nothing (#31)
// the code is the contract and the sentence around it is schema/codes.json's (test/skin-refusal-text.test.mjs): the facts the message carries are held, not its wording
const refusal = (d) => { try { panelLayout(d, { where: 'sq8l.json' }); return { code: 'laid out' }; } catch (e) { return e instanceof NoControls ? { code: e.code, message: e.message } : { code: 'other', message: e.message }; } };
const CODE = 'panel.describe.no-controls';
const sq8l = descriptor([], { programs: Array.from({ length: 512 }, (_, i) => ({ index: i, name: `Program ${i}` })) });
const withPrograms = refusal(sq8l);
check('a descriptor with programs and no controls is refused by code, naming the file and its 512 programs', [withPrograms.code, withPrograms.message.startsWith('sq8l.json: '), /\b512 programs\b/.test(withPrograms.message)], [CODE, true, true]);
const bare = refusal(descriptor([]));
check('arm: no controls and no programs is refused too, without naming programs', [bare.code, /program/.test(bare.message)], [CODE, false]);
const hidden = refusal(descriptor([{ ...travel('dB'), hidden: true }]));
check('arm: controls that are all hidden are refused by code, saying how many are hidden', [hidden.code, /\b1\b/.test(hidden.message), /hidden/.test(hidden.message)], [CODE, true, true]);
const dir = mkdtempSync(join(tmpdir(), 'pl31-'));
writeFileSync(join(dir, 'sq8l.json'), JSON.stringify(sq8l));
const cli = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '..', 'bin/omx-panel.mjs'), 'layout', '--descriptor', join(dir, 'sq8l.json'), '--pages'], { encoding: 'utf8' });
check('omx-panel layout --pages on it exits 1 with the code on one line and nothing on stdout', [cli.status, cli.stdout, cli.stderr.split('\n').length, cli.stderr.startsWith('omx-panel: panel.describe.no-controls: ')], [1, '', 2, true]);

console.log(`panel-layout: ${n - bad}/${n} pass`);
process.exit(bad ? 1 : 0);
