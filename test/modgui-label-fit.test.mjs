// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The face's labels and values, per look: a label wraps ONLY at word boundaries (a word that does not fit the cell makes the
// label's declared size step down, geometry.json `label.sizes`, never a break inside the word); the gap between a label and its
// value strip is ONE declared spacing (`labelGap`); and a count (an integer travel with no unit) or an enumeration is a selector,
// never a knob, derived from what the descriptor declares and no plugin's name.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GEOMETRY, LOOKS, generateModgui, loadLook, widgetOf, travelOf } from '../tools/modgui-gen.mjs';
import { textWidth } from '../tools/raster.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'test/fixtures/omx-delay');
const read = (f) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));
const GEO = JSON.parse(readFileSync(join(ROOT, 'tools/look/geometry.json'), 'utf8'));

const NAMES = ['Detector Oversampling', 'Comp Detector Oversampling', 'Gate Hysteresis', 'Comp Threshold', 'Gate Knee Start', 'Detector Topology', 'Comp Release', 'EQ 1 Freq', 'Gate Threshold', 'Oversampling', 'Sidechain Filter Frequency'];

/** The delay fixture with a knob for every long label, an EQ band count (unitless integer 1..32) and a few unit'd integers. */
function descriptor() {
  const d = read('omx-delay.descriptor.json');
  const base = d.controls.find((c) => c.kind === 'travel');
  let id = 100;
  const add = (symbol, name, travel) => { d.controls.push({ ...base, id: id++, symbol, name, travel: { scale: 'stepped', ...travel } }); return symbol; };
  const labels = NAMES.map((n, i) => add(`lab${i}`, n, { min: 0, max: 1, step: 0.01, unit: '', default: 0.5 }));
  const count = add('eqBands', 'EQ Bands', { min: 1, max: 32, step: 1, unit: '', default: 4 });
  const ms = add('wideMs', 'Time', { min: 0, max: 2000, step: 1, unit: 'ms', default: 100 });
  const few = add('fewDb', 'Range', { min: -12, max: 0, step: 1, unit: 'dB', default: -6 });
  const panel = read('omx-delay.panel.json');
  panel.sections.push({ key: 'more', label: 'More', controls: [...labels, count, ms, few] });
  return { d, panel, labels, count, ms, few };
}
const gen = () => { const { d, panel } = descriptor(); return generateModgui(d, { panel, stem: 'omx-delay', source: 'label-fit test' }); };
const file = (re) => gen().find(([p]) => re.test(p))[1].toString();

/** The words of `text` as the look sets them, in px at `size`. */
const wordW = (look, word, size) => {
  const caps = look.depth['--control-caps'] === 'uppercase';
  const t = caps ? word.toUpperCase() : word;
  return textWidth(look.font, t, size) + (caps ? GEO.label.letterSpacing * size * [...t].length : 0);
};
const sizeOf = (html, name) => {
  const m = new RegExp(`<div class="omx-control ([^"]*)"[^>]*title="${name}"`).exec(html);
  assert.ok(m, `no control titled ${name}`);
  return Number(/omx-lbl-(\d+)/.exec(m[1])?.[1] ?? GEO.label.sizes[0]);
};

for (const name of ['vintage', 'console', '3d']) {
  test(`${name}: no label breaks inside a word: every word fits the cell at its control's declared size, and the rule never breaks anywhere`, () => {
    const look = loadLook(name), html = file(/icon-.*\.html$/), css = file(/\.css$/);
    for (const n of NAMES) {
      const size = sizeOf(html, n);
      assert.ok(GEO.label.sizes.includes(size), `${n}: ${size}px is none of the declared sizes`);
      for (const w of n.split(' ')) assert.ok(wordW(look, w, size) <= GEOMETRY.cellW, `${name}: '${w}' of '${n}' is ${wordW(look, w, size).toFixed(1)} px at ${size} px, the cell is ${GEOMETRY.cellW}`);
    }
    const rule = css.match(/\.omx-control-title \{[^}]*\}/)[0];
    assert.doesNotMatch(rule, /overflow-wrap:\s*anywhere|word-break:\s*(break-all|break-word)/, 'a rule that may break inside a word');
    assert.match(rule, /overflow-wrap:\s*normal/);
  });

  test(`${name}: the label's gap to its value strip is the one declared spacing, ${GEOMETRY.labelGap} px`, () => {
    const css = file(/\.css$/);
    const scope = new RegExp(`omx-look-${name} \\.omx-control-title \\{[^}]*\\bbottom:\\s*(\\d+)px`);
    const m = scope.exec(css);
    assert.ok(m, 'the title is anchored to the value strip');
    const sc = new RegExp(`omx-look-${name} \\.omx-scribble \\{[^}]*\\btop:\\s*(\\d+)px`).exec(css);
    const scribbleTop = Number(sc[1]), titleBottomY = GEOMETRY.cellH - Number(m[1]);
    assert.equal(scribbleTop - titleBottomY, GEOMETRY.labelGap);
    assert.equal(typeof GEOMETRY.labelGap, 'number');
  });
}

test('a count or an enumeration is a selector, a wide or measured travel a knob: derived from the declaration, no plugin named', () => {
  const { d, panel, count, ms, few } = descriptor();
  const html = generateModgui(d, { panel, stem: 'omx-delay', source: 'x' }).find(([p]) => /icon-.*\.html$/.test(p))[1].toString();
  const kind = (sym) => new RegExp(`data-symbol="${sym}"`).test(html) && new RegExp(`<div class="omx-control omx-(\\w+)[^"]*"[^>]*data-symbol="${sym}"`).exec(html)[1];
  assert.equal(kind(count), 'selector', 'EQ Bands: a count of a few values');
  assert.equal(kind(few), 'selector');
  assert.equal(kind(ms), 'knob', 'a time in ms over 2000 steps is a knob');
  // every control the descriptor declares as an enumeration (labelled values) is a selector too
  for (const c of d.controls.filter((x) => x.kind === 'choice' && !x.readonly)) assert.equal(kind(c.symbol), 'selector', c.symbol);
  assert.equal(widgetOf({ kind: 'integer', min: 1, max: 32, unit: '' }), 'selector');
  assert.equal(widgetOf({ kind: 'integer', min: -100, max: 100, unit: '' }), 'knob');
  assert.equal(widgetOf({ kind: 'integer', min: 0, max: 100, unit: '%' }), 'knob');
  assert.equal(widgetOf(travelOf({ kind: 'travel', travel: { min: 1, max: 32, step: 1, unit: '', default: 4 } })), 'selector');
});
