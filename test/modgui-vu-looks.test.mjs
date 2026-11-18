// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The MOD GUI's two live pieces (docs/modgui.md, "The look switch and the needle meters"):
//   1. the needle meters: an output port's value moves the meter's needle to the declared angle (a level rests left and rises right, the
//      gain reduction is reversed: it rests right and swings left), through the declared ballistic lag (VU, 300 ms);
//   2. the look switch: one template ships the three looks scoped by a class on the pedal root, the switch swaps the class and remembers it
//      in localStorage (guarded), the size and the ports do not change, and with storage throwing the pedal wears vintage.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { generateModgui, LOOKS, loadLook, VU, wornDepth } from '../tools/modgui-gen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'test/fixtures/omx-comp');
const read = (f) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));
const descriptor = read('omx-comp.descriptor.json');
const panel = read('omx-comp.panel.json');
const made = (look = 'vintage') => new Map(generateModgui(descriptor, { panel, stem: 'omx-comp', source: 't', look }));


/** The script, run as MOD runs it, over a stand-in page: a root with a class list, the dials and the switch keys the template names. */
function page({ storage, look = 'vintage' } = {}) {
  const template = made(look).get('modgui/icon-omx-comp.html').toString();
  const tags = (re) => [...template.matchAll(re)].map(([tag]) => tag);
  const attr = (tag, n) => tag.match(new RegExp(`${n}="([^"]*)"`))?.[1] ?? null;
  const classes = new Set(template.match(/^<div class="([^"]*)"/)[1].replace('{{{cns}}}', '').split(/\s+/).filter(Boolean));
  const root = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) }, get className() { return [...classes].join(' '); }, getAttribute: () => null };
  const dials = tags(/<div class="omx-vu"[^>]*>/g).map((tag) => ({ symbol: attr(tag, 'data-vu-symbol'), getAttribute: (n) => attr(tag, n), needle: { style: {} }, querySelector() { return this.needle; }, style: {} }));
  const keys = tags(/<[a-z]+ class="omx-look-key"[^>]*>/g).map((tag) => {
    const handlers = {};
    return { look: attr(tag, 'data-look'), getAttribute: (n) => attr(tag, n), addEventListener: (t, f) => { (handlers[t] ??= []).push(f); }, click() { const ev = { stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {} }; for (const f of handlers.click ?? []) f(ev); return ev; }, mousedown() { const ev = { stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {} }; for (const f of handlers.mousedown ?? []) f(ev); return ev; } };
  });
  const timers = [];
  let now = 0;
  const env = { setInterval: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearInterval() {}, Date: { now: () => now }, localStorage: storage };
  const script = made(look).get('modgui/script-omx-comp.js').toString().replace(/^\/\/.*\n/gm, '');
  const fn = new Function(...Object.keys(env), `return (${script});`)(...Object.values(env));
  const sets = { '[data-omx-pedal]': [root], '[data-vu]': dials, '[data-look]': keys };
  const icon = { find: (sel) => { const hit = sets[sel] ?? []; return Object.assign(hit.slice(), { each: (f) => hit.forEach((x) => f.call(x)) }); } };
  const fire = (event) => fn({ ...event, icon });
  return { root, dials, keys, fire, tick: (ms) => { now += ms; for (const t of timers) t.f(); }, classes, storage };
}
const angleOf = (dial) => Number(dial.needle.style.transform.match(/rotate\((-?[\d.]+)deg\)/)[1]);
const dialFor = (p, kind) => p.dials.find((d) => d.getAttribute('data-kind') === kind);

test('the declaration holds the sweep, the zone and the ballistics once', () => {
  assert.ok(VU, 'tools/look/geometry.json declares no vu');
  assert.equal(VU.tauMs.level, 300);
  assert.equal(VU.reversed['gain-reduction'], true);
  assert.ok(VU.angleMin < 0 && VU.angleMax > 0);
});

test('a level needle rests left and a port value moves it to the declared angle', () => {
  const p = page();
  const level = dialFor(p, 'level');
  assert.ok(level, 'no level dial in the template');
  const lo = Number(level.getAttribute('data-min')), hi = Number(level.getAttribute('data-max'));
  p.fire({ type: 'change', symbol: level.symbol, value: hi });
  for (let i = 0; i < 40; i++) p.tick(100);
  assert.ok(Math.abs(angleOf(level) - VU.angleMax) < 0.5, `at the maximum the needle is at ${angleOf(level)}, not ${VU.angleMax}`);
  p.fire({ type: 'change', symbol: level.symbol, value: lo });
  for (let i = 0; i < 40; i++) p.tick(100);
  assert.ok(Math.abs(angleOf(level) - VU.angleMin) < 0.5, `at the minimum the needle is at ${angleOf(level)}, not ${VU.angleMin}`);
});

test('the gain-reduction needle is reversed: it rests right and swings left as the gain is reduced', () => {
  const p = page();
  const gr = dialFor(p, 'gain-reduction');
  assert.ok(gr, 'no gain-reduction dial');
  assert.equal(gr.getAttribute('data-reversed'), '1');
  assert.equal(dialFor(p, 'level').getAttribute('data-reversed'), '0');
  const grBlock = made().get('modgui/icon-omx-comp.html').toString().split('data-kind="gain-reduction"')[1].split('omx-vu-pivot')[0];
  assert.ok(grBlock.includes(`transform:rotate(${VU.angleMax}deg)`), 'the gain-reduction needle does not rest at the right');
  const lo = Number(gr.getAttribute('data-min'));
  p.fire({ type: 'change', symbol: gr.symbol, value: 0 });
  for (let i = 0; i < 40; i++) p.tick(100);
  assert.ok(Math.abs(angleOf(gr) - VU.angleMax) < 0.5, 'no reduction rests at the right');
  p.fire({ type: 'change', symbol: gr.symbol, value: lo });
  for (let i = 0; i < 40; i++) p.tick(100);
  assert.ok(Math.abs(angleOf(gr) - VU.angleMin) < 0.5, 'full reduction swings to the left');
});

test('the gain-reduction needle rests right when the page opens: a start event carries the ports\' initial values, not a reading', () => {
  const p = page();
  const gr = dialFor(p, 'gain-reduction');
  // mod-ui opens a pedal with each output port at its minimum (-60 dB): that is no gain reduction of 60 dB, so no needle moves
  p.fire({ type: 'start', ports: p.dials.map((d) => ({ symbol: d.symbol, value: Number(d.getAttribute('data-min')) })) });
  for (let i = 0; i < 40; i++) p.tick(100);
  const rest = (d) => (d.getAttribute('data-reversed') === '1' ? VU.angleMax : VU.angleMin);
  for (const d of p.dials) if (d.needle.style.transform) assert.ok(Math.abs(angleOf(d) - rest(d)) < 0.5, `${d.getAttribute('data-kind')} left its rest on a start event: ${angleOf(d)}`);
  // and the first reading after it moves the needle from the rest
  p.fire({ type: 'change', symbol: gr.symbol, value: Number(gr.getAttribute('data-min')) });
  for (let i = 0; i < 40; i++) p.tick(100);
  assert.ok(Math.abs(angleOf(gr) - VU.angleMin) < 0.5, 'a reading of full reduction swings left');
});

test('the ballistic step: after one time constant the needle has covered 63.2% of the way', () => {
  const p = page();
  const level = dialFor(p, 'level');
  const hi = Number(level.getAttribute('data-max'));
  p.fire({ type: 'change', symbol: level.symbol, value: hi });
  p.tick(0);
  const from = angleOf(level);
  for (let i = 0; i < 10; i++) p.tick(30);
  const covered = (angleOf(level) - from) / (VU.angleMax - from);
  assert.ok(Math.abs(covered - (1 - Math.exp(-1))) < 0.03, `${covered.toFixed(3)} of the way after 300 ms`);
});

test('one template ships the three looks, scoped by a class on the pedal root: every token of every look is there', () => {
  const css = made('vintage').get('modgui/stylesheet-omx-comp.css').toString();
  for (const name of LOOKS) {
    const scope = `.omx-pedal{{{cns}}}.omx-look-${name}`;
    const mine = css.split('\n').filter((l) => l.startsWith(scope)).join('\n');
    assert.ok(mine.length > 0, `no rules for the ${name} look`);
    const depth = wornDepth(loadLook(name));
    assert.ok(mine.includes(depth['--body-shadow']), `${name}: its body shadow is not in its scope`);
    assert.ok(mine.includes(depth['--key-shadow']) || depth['--key-shadow'] === 'none', `${name}: its key shadow is not in its scope`);
  }
});

test('the look names only the class the pedal starts with: size, files and ports are the same for every look', () => {
  const a = made('vintage'), b = made('console');
  assert.deepEqual([...a.keys()].filter((k) => !k.includes('screenshot') && !k.includes('thumbnail')), [...b.keys()].filter((k) => !k.includes('screenshot') && !k.includes('thumbnail')));
  assert.equal(a.get('modgui/stylesheet-omx-comp.css').toString(), b.get('modgui/stylesheet-omx-comp.css').toString());
  const strip = (t) => t.toString().replace(/omx-look-(vintage|console|3d)(?! )/, 'omx-look-X').replace(/^<div class="[^"]*omx-look-X/, '<div class="omx-look-X');
  const ta = a.get('modgui/icon-omx-comp.html').toString(), tb = b.get('modgui/icon-omx-comp.html').toString();
  assert.match(ta, /^<div class="omx-pedal\{\{\{cns\}\}\}[^"]* omx-look-vintage/);
  assert.match(tb, /^<div class="omx-pedal\{\{\{cns\}\}\}[^"]* omx-look-console/);
  assert.equal(ta.replace('omx-look-vintage', 'omx-look-X'), tb.replace('omx-look-console', 'omx-look-X'));
  void strip;
  assert.equal([...ta.matchAll(/mod-port-symbol="([^"]+)"/g)].length, [...tb.matchAll(/mod-port-symbol="([^"]+)"/g)].length);
});

test('the switch has a key per look, and none is a plugin port', () => {
  const t = made().get('modgui/icon-omx-comp.html').toString();
  for (const name of LOOKS) assert.match(t, new RegExp(`class="omx-look-key"[^>]*data-look="${name}"`));
  assert.doesNotMatch(t.match(/<div class="omx-lookswitch"[\s\S]*?<\/div>/)[0], /mod-port-symbol|mod-role/);
});

test('a key swaps the look class and remembers it; the click does not start a drag', () => {
  const stored = {};
  const p = page({ storage: { getItem: (k) => stored[k] ?? null, setItem: (k, v) => { stored[k] = v; } } });
  p.fire({ type: 'start', ports: [] });
  assert.ok(p.classes.has('omx-look-vintage'));
  const key = p.keys.find((k) => k.look === 'console');
  assert.equal(key.mousedown().stopped, true, 'mousedown reaches mod-ui\'s drag');
  assert.equal(key.click().stopped, true);
  assert.ok(p.classes.has('omx-look-console') && !p.classes.has('omx-look-vintage'));
  assert.equal(stored['omx-look'], 'console');
});

test('the remembered look is worn at start; with storage throwing the pedal wears vintage', () => {
  const p = page({ storage: { getItem: () => 'console', setItem() {} } });
  p.fire({ type: 'start', ports: [] });
  assert.ok(p.classes.has('omx-look-console'));
  const t = page({ storage: { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } });
  t.fire({ type: 'start', ports: [] });
  assert.ok(t.classes.has('omx-look-vintage') && !t.classes.has('omx-look-console'));
  t.keys.find((k) => k.look === '3d').click();
  assert.ok(t.classes.has('omx-look-3d'), 'the switch still works with storage throwing');
  const n = page({ storage: undefined });
  n.fire({ type: 'start', ports: [] });
  assert.ok(n.classes.has('omx-look-vintage'));
});
