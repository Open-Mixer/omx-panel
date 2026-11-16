// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// What a control's scribble strip and its label say, as mod-ui renders them (reviewed on the real mod-ui shots):
//   1. the unit is written ONCE: mod-ui's value binding renders the value with the port's unit (the plugin's units:render), so the
//      stylesheet adds none, for every unit kind (dB, ms, Hz, %, ratio);
//   2. a toggled port's scribble reads ON or OFF, set by the MOD GUI's script from the port's value;
//   3. a label wraps to two lines and keeps its full text in the control's title: it is never cut without the full text being there,
//      and never overlaps its neighbour's.
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateModgui, GEOMETRY } from '../tools/modgui-gen.mjs';

const UNITS = [['dB', -60, 12], ['ms', 1, 500], ['Hz', 20, 20000], ['%', 0, 100], ['ratio', 1, 20]];
const controls = [
  ...UNITS.map(([unit, min, max], i) => ({ id: i, symbol: `u${i}`, name: `Unit ${unit} with a very long name ${i}`, kind: 'travel', travel: { min, max, step: 0, unit, default: min, scale: 'linear' }, group: ['G'] })),
  { id: 9, symbol: 'sw', name: 'Switch', kind: 'toggle', default: false, group: ['G'] },
  { id: 10, symbol: 'sw2', name: 'Another switch', kind: 'toggle', default: true, group: ['G'] },
];
const descriptor = { plugin: { id: 'urn:example:s', format: 'lv2', name: 'S', vendor: 'V' }, origin: 'authored', controls };
const panel = { family: 'none', sections: [{ key: 'g', label: 'G', controls: controls.map((c) => c.symbol) }] };
const files = (look = 'console') => new Map(generateModgui(descriptor, { panel, stem: 's', source: 't', look }));
const css = () => files().get('modgui/stylesheet-s.css').toString();
const template = () => files().get('modgui/icon-s.html').toString();

test('the unit is written once: the stylesheet adds none to a scribble, for every unit kind', () => {
  assert.doesNotMatch(css(), /omx-scribble::after/, 'the stylesheet writes the unit after mod-ui\'s own');
  assert.doesNotMatch(css(), /attr\(data-unit\)/);
  for (const [unit] of UNITS) assert.doesNotMatch(template().match(/<div class="omx-scribble"[^>]*><\/div>/g).join(''), new RegExp(`>${unit}<`));
});

test('a toggled port\'s scribble reads ON or OFF, set by the script', () => {
  const t = template();
  const tags = [...t.matchAll(/<div class="omx-scribble"[^>]*mod-port-symbol="(sw2?)"[^>]*>/g)];
  assert.equal(tags.length, 2);
  for (const [tag] of tags) assert.match(tag, /data-onoff/, 'a toggle\'s scribble is not marked for the script');
  assert.match(files().get('modgui.ttl').toString(), /modgui:javascript/, 'a face with a toggle has a script');
  const script = files().get('modgui/script-s.js').toString().replace(/^\/\/.*\n/gm, '');
  const fn = new Function(`return (${script});`)();
  const nodes = tags.map(([tag]) => ({ symbol: tag.match(/mod-port-symbol="([^"]+)"/)[1], textContent: '1.00' }));
  const icon = { find: (sel) => {
    const m = sel.match(/mod-port-symbol="([^"]+)"/);
    const hit = nodes.filter((n) => sel.includes('data-onoff') && m && n.symbol === m[1]);
    return { each: (f) => hit.forEach((n) => f.call(n)), 0: undefined };
  } };
  fn({ type: 'start', icon, ports: [{ symbol: 'sw', value: 0 }, { symbol: 'sw2', value: 1 }] });
  assert.deepEqual(nodes.map((n) => n.textContent), ['OFF', 'ON']);
  fn({ type: 'change', icon, symbol: 'sw', value: 1 });
  assert.equal(nodes[0].textContent, 'ON');
});

test('a label wraps to two lines and keeps its full text in the control\'s title', () => {
  const rule = css().match(/\.omx-control-title \{[^}]*\}/)[0];
  assert.doesNotMatch(rule, /white-space:\s*nowrap/, 'a label that does not wrap is cut');
  assert.match(rule, /-webkit-line-clamp:\s*2/);
  assert.match(rule, /height:\s*20px/);
  const t = template();
  for (const c of controls) assert.match(t, new RegExp(`<div class="omx-control [^"]*"[^>]*title="${c.name}"`), `${c.symbol}: the full name is not the control's title`);
  const g = GEOMETRY;
  assert.ok(g.cellH >= g.knobTop + g.knob + 20 + g.scribbleH, 'the cell has no room for two lines of label and the scribble');
});
