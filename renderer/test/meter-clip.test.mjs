// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * A meter's clip lamp and its unheld caption (omx-panel#13, contract 7.9): a meter of the band whose description says clip: true
 * wears a lamp at its frame's top right, lit by omx-dsp's clip word (omx_meter_view_clip: lit by a clip, kept lit until
 * omx_panel_view_clear_clip) and held to omx-dsp's own clip vector tick by tick; a meter with no clip word draws none and lights
 * nothing whatever its source says; an unheld meter's caption says so in the panel's word (the description's words.unheld), and the
 * band's title is the description's words.meters. A drawn word the description does not serve is refused by name.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { FIXTURES, RENDERER, descriptionFile, render, scratch, stateFile } from './harness.mjs';

const modgui = await import(join(RENDERER, '..', 'dist', 'tools', 'modgui-gen.mjs'));
const fx = FIXTURES.find((f) => f.name === 'meters');
const g = modgui.GEOMETRY;
const look = modgui.loadLook('console').tokens;
const hex = (t) => [1, 3, 5].map((i) => parseInt(look[t].slice(i, i + 2), 16));
const RED = hex('--meter-red'), RIM = hex('--border-strong');
const p = modgui.resolvePanel(JSON.parse(readFileSync(join(RENDERER, '..', fx.descriptor), 'utf8')), { panel: JSON.parse(readFileSync(join(RENDERER, '..', fx.panel), 'utf8')), stem: fx.stem });
const lay = modgui.layout(p);
const row = (symbol) => lay.band.meters.findIndex((m) => m.symbol === symbol);
/** Where meter `symbol`'s lamp stands, in px at scale 1: the generator's place, which the renderer draws at too. */
function lamp(symbol) {
  const fw = lay.band.w - 2 * g.sectionPad, l = modgui.meterLamp(fw);
  return { x: lay.band.x + g.sectionPad + l.x, y: lay.band.y + g.sectionTitleH + row(symbol) * (g.meterH + g.meterGap) + l.y, size: l.size };
}
const at = (img, x, y) => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 3));
const near = (px, c) => px.every((v, k) => Math.abs(v - c[k]) <= 2);
/** Whether meter `symbol`'s lamp is lit (its centre the meter red), and whether a lamp stands there at all (its left edge the rim). */
const lit = (img, symbol) => { const l = lamp(symbol); return near(at(img, Math.floor(l.x + l.size / 2), Math.floor(l.y + l.size / 2)), RED); };
const stands = (img, symbol) => { const l = lamp(symbol); return near(at(img, Math.round(l.x), Math.floor(l.y + l.size / 2)), RIM); };
const same = (a, b) => a.w === b.w && a.h === b.h && Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) === 0;

/** The picture with `readings` (symbol to ticks) given to the meters, from the fixture's description or `desc`. */
function draw(readings, desc) {
  const dir = scratch();
  const d = desc ?? descriptionFile(fx, dir), state = JSON.parse(readFileSync(stateFile(fx, dir), 'utf8'));
  state.meters = readings;
  const st = join(dir, 'meters.state.json');
  writeFileSync(st, JSON.stringify(state));
  return render(d, st);
}
/** The fixture's description with `edit` applied to its parsed JSON, in a file. */
function described(edit) {
  const dir = scratch();
  const d = JSON.parse(readFileSync(descriptionFile(fx, dir), 'utf8'));
  edit(d);
  const file = join(dir, 'edited.layout.json');
  writeFileSync(file, JSON.stringify(d));
  return file;
}
const meterOf = (d, symbol) => d.meters.find((m) => m.symbol === symbol);

/** omx-dsp's clip vector (vectors/meter-view.json, pkg-config omxdsp's meterviewvectors): the clips, the clears and the word lit. */
const CLIP = JSON.parse(readFileSync(execFileSync('pkg-config', ['--variable=meterviewvectors', 'omxdsp'], { encoding: 'utf8' }).trim(), 'utf8')).cases.find((c) => c.set === 'clip');

test('the lamp is omx-dsp\'s clip word: every tick of its clip vector, lit by a clip, kept lit, cleared', () => {
  assert.ok(CLIP && CLIP.lit.length >= 8 && CLIP.lit.some((v) => v) && CLIP.lit.some((v) => !v), 'omx-dsp\'s clip vector lights and clears');
  const ticks = [];
  CLIP.lit.forEach((want, k) => {
    ticks.push({ value: -20, elapsed: 0.05, ...(CLIP.clear[k] ? { clear: true } : {}), ...(CLIP.clip[k] ? { clip: true } : {}) });
    assert.equal(lit(draw({ in_level: ticks }), 'in_level'), want === 1, `tick ${k}: clip ${CLIP.clip[k]}, clear ${CLIP.clear[k]}, the vector's word ${want}`);
  });
});

test('a lit lamp stays lit across ticks with no clip, and a clear darkens it', () => {
  const ticks = [{ value: -6, elapsed: 0, clip: true }];
  for (let k = 0; k < 20; k++) ticks.push({ value: -40, elapsed: 0.05 });
  assert.ok(lit(draw({ in_level: ticks }), 'in_level'), 'lit 1 s after its clip');
  ticks.push({ value: -40, elapsed: 0.05, clear: true });
  assert.ok(!lit(draw({ in_level: ticks }), 'in_level'), 'dark after the clear');
});

test('a meter with no clip word draws no lamp and lights none, whatever its source says', () => {
  const clipping = Array.from({ length: 5 }, () => ({ value: -10, elapsed: 0.05, clip: true }));
  const quiet = clipping.map(({ clip: _c, ...t }) => t);
  for (const symbol of ['lufs', 'gr']) {
    const img = draw({ [symbol]: clipping });
    assert.ok(!lit(img, symbol) && !stands(img, symbol), `${symbol}: no lamp`);
    assert.ok(same(img, draw({ [symbol]: quiet })), `${symbol}: its clips change no pixel`);
  }
});

test('the lamp stands dark on a meter with a clip word before any reading; a clip word the description takes away removes it', () => {
  const img = draw({});
  for (const symbol of ['in_level', 'out_level']) assert.ok(stands(img, symbol) && !lit(img, symbol), `${symbol}: a dark lamp`);
  const none = draw({}, described((d) => { meterOf(d, 'in_level').clip = false; }));
  assert.ok(!stands(none, 'in_level') && stands(none, 'out_level'), 'in_level without its clip word has no lamp');
});

test('a clip or a clear that is not true or false is refused by the command', () => {
  for (const bad of [{ value: -6, clip: 1 }, { value: -6, clear: 'yes' }]) assert.throws(() => draw({ in_level: [bad] }), /clip or a clear/);
});

test('an unheld meter\'s caption says the description\'s word after the range: the same pixels as the word written into the unit', () => {
  const word = (d) => d.words.unheld.label;
  const unheld = draw({}, described((d) => { meterOf(d, 'in_level').held = false; }));
  const spelled = draw({}, described((d) => { const m = meterOf(d, 'in_level'); m.unitText = `${m.unitText ?? m.unit}  ${word(d)}`; }));
  assert.ok(same(unheld, spelled), 'the caption ends with the unheld word');
  assert.ok(!same(unheld, draw({})), 'arm: the held caption has no word');
  const other = draw({}, described((d) => { meterOf(d, 'in_level').held = false; d.words.unheld.label = 'zz'; }));
  assert.ok(!same(unheld, other), 'arm: the word is the description\'s, read, not spelled in the renderer');
});

test('the band\'s title is the description\'s words.meters', () => {
  assert.ok(!same(draw({}), draw({}, described((d) => { d.words.meters.label = 'Zz'; }))), 'another word, other pixels');
});

test('a drawn word the description does not serve is refused by name', () => {
  assert.throws(() => draw({}, described((d) => { delete d.words.meters; })), /words\.meters/);
  assert.throws(() => draw({}, described((d) => { meterOf(d, 'lufs').held = false; delete d.words.unheld; })), /meter 'lufs' is unheld and words\.unheld/);
  assert.doesNotThrow(() => draw({}, described((d) => { delete d.words.unheld; })), 'every meter held: no unheld word is drawn');
});
