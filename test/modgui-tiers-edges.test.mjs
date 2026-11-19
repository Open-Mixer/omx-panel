// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The MOD GUI's two declared choices beside the look: the tier of each control (`panel.tiers`, easy or advanced, a control that
// names none is advanced; the `modgui-tier` setting, `--tier`, default advanced) and a section's edge bands (an EQ draws the
// plugin's HPF as its first band and its LPF as its last; the curve carries their roll-off). MOD has no live switch: a tier is
// generated.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TIER, generateModgui, TIER_SETTING, TIERS } from '../tools/modgui-gen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'test/fixtures/omx-delay');
const read = (f) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));
const descriptor = read('omx-delay.descriptor.json');
const withPanel = (patch) => ({ ...read('omx-delay.panel.json'), ...patch });
const html = (panel, tier) => generateModgui(descriptor, { panel, stem: 'omx-delay', source: 'tier test', look: 'console', ...(tier ? { tier } : {}) }).find(([p]) => p.endsWith('.html'))[1].toString();
const symbols = (text) => [...text.matchAll(/class="omx-control [^"]*"[^>]*data-symbol="([^"]+)"/g)].map((m) => m[1]);
const ALL = ['pingpong', 'fxDelayTime', 'fxDelayFeedback', 'mix', 'tone'];
const cli = (...args) => spawnSync(process.execPath, [join(ROOT, 'tools/modgui-gen.mjs'), ...args], { encoding: 'utf8' });

test('the tier setting is declared: name modgui-tier, easy and advanced, default advanced', () => {
  assert.equal(TIER_SETTING.name, 'modgui-tier');
  assert.deepEqual([...TIERS], ['easy', 'advanced']);
  assert.equal(DEFAULT_TIER, 'advanced');
  assert.equal(TIER_SETTING.flag, '--tier');
});

test('--tier easy omits exactly the advanced controls; advanced draws every one', () => {
  const panel = withPanel({ tiers: { fxDelayTime: 'easy', mix: 'easy', tone: 'advanced' } });
  assert.deepEqual(symbols(html(panel, 'easy')).sort(), ['fxDelayTime', 'mix']);
  assert.deepEqual(symbols(html(panel, 'advanced')).sort(), [...ALL].sort());
});

test('a control with no tier is advanced: left out of easy, drawn in advanced, and advanced is the default', () => {
  const panel = withPanel({ tiers: { mix: 'easy' } });
  assert.deepEqual(symbols(html(panel, 'easy')), ['mix']);
  assert.deepEqual(symbols(html(panel)).sort(), [...ALL].sort(), 'no tier asked is advanced');
  assert.deepEqual(symbols(html(withPanel({ tiers: { mix: 'easy', tone: 'advanced' } }), 'easy')), ['mix']);
});

test('a plugin that declares no easy control draws everything in easy: nothing says easy, so nothing disappears', () => {
  assert.deepEqual(symbols(html(withPanel({}), 'easy')).sort(), [...ALL].sort());
  assert.deepEqual(symbols(html(withPanel({ tiers: { mix: 'advanced' } }), 'easy')).sort(), [...ALL].sort());
});

test('a tier that is neither easy nor advanced, or a tier for a control the panel does not draw, is refused by name', () => {
  assert.throws(() => html(withPanel({ tiers: { mix: 'expert' } })), /expert/);
  assert.throws(() => html(withPanel({ tiers: { nope: 'easy' } })), /nope/);
  assert.throws(() => html(withPanel({}), 'medium'), /medium/);
});

test('--tier on the command line: easy draws the declared easy controls, an unknown tier is refused by name (exit 2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tier-'));
  const panelFile = join(dir, 'p.json');
  writeFileSync(panelFile, JSON.stringify(withPanel({ tiers: { mix: 'easy' } })));
  const args = ['--emit-stdout', '--descriptor', join(FIX, 'omx-delay.descriptor.json'), '--panel', panelFile, '--out', join(dir, 'omx-delay.lv2'), '--look', 'console'];
  const easy = cli(...args, '--tier', 'easy');
  assert.equal(easy.status, 0, easy.stderr);
  assert.match(easy.stdout, /data-symbol="mix"/);
  assert.doesNotMatch(easy.stdout, /data-symbol="tone"/);
  const bad = cli(...args, '--tier', 'medium');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /medium/);
});

// ---------------------------------------------------------------------------------------------------- the edge bands

const edgePanel = (extra = {}) => ({
  family: 'delay',
  roles: { time: 'fxDelayTime', feedback: 'fxDelayFeedback', tone: 'tone', pingpong: 'pingpong', mix: 'mix' },
  sections: [
    { key: 'filt', label: 'Filters', controls: ['tone', 'mix'] },
    { key: 'delay', label: 'Delay', controls: ['pingpong', 'fxDelayTime', 'fxDelayFeedback'],
      edges: { first: { from: 'filt', label: 'HPF', controls: ['tone'] }, last: { from: 'filt', label: 'LPF', controls: ['mix'] } } },
  ],
  ...extra,
});

test('the filters are the EQ group\'s first and last band: [HPF] [bands] [LPF], each control tagged with its band', () => {
  const text = html(edgePanel());
  assert.deepEqual(symbols(text), ['tone', 'pingpong', 'fxDelayTime', 'fxDelayFeedback', 'mix']);
  assert.equal(text.match(/data-section="/g).length, 1, 'the Filters section gave its controls to the group and is gone');
  assert.match(text, /data-symbol="tone"[^>]*data-band="HPF"/);
  assert.match(text, /data-symbol="mix"[^>]*data-band="LPF"/);
  assert.doesNotMatch(text, /data-symbol="pingpong"[^>]*data-band=/);
});

test('an edge band names controls its section lists, and no control is drawn twice', () => {
  const bad = edgePanel();
  bad.sections[1].edges.first.controls = ['fxDelayTime'];
  assert.throws(() => html(bad), /fxDelayTime/);
  const twice = edgePanel();
  twice.sections[1].controls.push('tone');
  assert.throws(() => html(twice), /tone/);
});

test('an edge band keeps its place in the easy tier: only its easy controls are drawn', () => {
  const panel = edgePanel({ tiers: { tone: 'easy', mix: 'easy', pingpong: 'easy' } });
  assert.deepEqual(symbols(html(panel, 'easy')), ['tone', 'pingpong', 'mix']);
});

// ----------------------------------------------------------------- the curve carries the filters' roll-off

test('the EQ curve includes the HPF\'s roll-off when its roles are declared', () => {
  const d = read('../eq-marks/eq.descriptor.json');
  const panel = read('../eq-marks/eq.panel.json');
  const filt = (on) => ({
    controls: [...d.controls,
      { symbol: 'hf', id: 'hf', name: 'HPF Hz', kind: 'travel', travel: { min: 20, max: 2000, default: 400, unit: 'Hz' } },
      { symbol: 'hs', id: 'hs', name: 'HPF slope', kind: 'travel', travel: { min: 12, max: 24, default: 24, step: 12, unit: 'dB' } }],
    panel: { ...panel, sections: [{ ...panel.sections[0], controls: [...panel.sections[0].controls, 'hf', 'hs'] }], roles: on ? { ...panel.roles, hpf_freq: 'hf', hpf_slope: 'hs' } : panel.roles },
  });
  const poly = (on) => {
    const { controls, panel: p } = filt(on);
    const text = generateModgui({ ...d, controls }, { panel: p, stem: 'x', source: 't', look: 'console' }).find(([f]) => f.endsWith('.html'))[1].toString();
    return text.match(/<polyline class="omx-curve-line" fill="none" points="([^"]+)"/)[1];
  };
  assert.notEqual(poly(true), poly(false), 'a 400 Hz high-pass moved nothing on the curve');
});
