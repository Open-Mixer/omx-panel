// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The clip lamp on the vintage look's needle meter (omx-panel#218, after #13). The vintage look hides the meter frames and shows the
 * VU dials, so the frame's lamp is never seen there: a VU whose meter has a clip word wears its own lamp, a period peak lamp (a round
 * jewel in a dark bezel ring, set in the dial's top right corner), dark as the look's unlit lamp (--led-off) until a clip and lit the
 * meter red while the clip word is (the `omx-clip-lit` class, the frame lamp's). It stands where the frame's lamp stands in its frame,
 * measured inside the face's border: 5 px in from the right, 3 px down. A meter with no clip word wears none.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as gen from '../tools/modgui-gen.mjs';

const { emitStylesheet, emitTemplate, layout, loadLook, resolvePanel, GEOMETRY } = gen;
const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/meters/${f}`, import.meta.url), 'utf8'));
const resolved = (descriptor = load('meters.descriptor.json')) => resolvePanel(descriptor, { panel: load('meters.panel.json'), stem: 'meters' });
const vintage = loadLook('vintage');
const P = '.omx-pedal{{{cns}}}.omx-look-vintage';
/** The vintage stylesheet's rule for `selector`, its declarations as one string; '' when there is none. */
const rule = (css, selector) => css.split('\n').find((l) => l.startsWith(`${P} ${selector} {`))?.slice(`${P} ${selector} {`.length) ?? '';
/** Each VU dial of a template: its symbol and how many lamps it wears. */
const dials = (html) => html.split('<div class="omx-vu" ').slice(1).map((d) => ({ symbol: /data-vu-symbol="([^"]+)"/.exec(d)[1], clip: /data-clip="([01])"/.exec(d)?.[1] ?? null, lamps: (d.split('<div class="omx-vu" ')[0].split('omx-vu-pivot')[0].match(/class="omx-vu-clip"/g) ?? []).length }));

test('a vintage MOD GUI of the meters fixture: a lamp on in_level and out_level, none on gr and lufs', () => {
  const p = resolved(), html = emitTemplate(p, layout(p), 'test', 'vintage');
  assert.deepEqual(dials(html).map((d) => [d.symbol, d.lamps]), [['in_level', 1], ['out_level', 1], ['gr', 0], ['lufs', 0]]);
  assert.deepEqual(dials(html).map((d) => d.clip), ['1', '1', '0', '0'], 'each dial names its clip word, as the frame does');
});

test('arm: a descriptor whose meters say no clip word puts no lamp on any dial', () => {
  const d = load('meters.descriptor.json');
  for (const m of d.meters) delete m.clip;
  const p = resolved(d);
  assert.equal((emitTemplate(p, layout(p), 'test', 'vintage').match(/omx-vu-clip/g) ?? []).length, 0);
});

test('the vintage look shows the dial and hides the frame: the dial\'s lamp is the one seen', () => {
  const css = emitStylesheet(resolved(), vintage, 'test');
  assert.match(rule(css, '.omx-meter-frame'), /display: none/);
  assert.match(css, new RegExp(`^${P.replace(/[.{}]/g, '\\$&')} \\.omx-vu \\{ display: block; \\}`, 'm'));
});

test('the lamp stands where the frame\'s stands, inside the face\'s border: meterLamp(w, border)', () => {
  const s = GEOMETRY.meterLamp;
  assert.deepEqual(gen.meterLamp(100), { x: 100 - 6 - s, y: 4, size: s }, 'the frame\'s lamp (a 1 px rim) has not moved');
  assert.deepEqual(gen.meterLamp(68, 3), { x: 68 - 3 - 5 - s, y: 3 + 3, size: s });
  const lamp = rule(emitStylesheet(resolved(), vintage, 'test'), '.omx-vu-clip');
  assert.ok(lamp, 'the vintage stylesheet has no .omx-vu-clip rule');
  for (const want of ['position: absolute;', 'right: 5px;', 'top: 3px;', 'box-sizing: border-box;', `width: ${s}px;`, `height: ${s}px;`]) assert.ok(lamp.includes(want), `the lamp's rule does not say ${want}`);
});

test('a period jewel: round, in a dark ring, dark as the look\'s unlit lamp until a clip, the meter red while lit', () => {
  const css = emitStylesheet(resolved(), vintage, 'test'), lamp = rule(css, '.omx-vu-clip'), lit = rule(css, '.omx-vu-clip.omx-clip-lit');
  assert.match(lamp, /border-radius: 50%;/);
  assert.ok(lamp.includes(`border: 1px solid ${vintage.tokens['--border-strong']};`), 'the ring is not the look\'s strong border');
  assert.ok(lamp.includes(`background: ${vintage.depth['--led-off']};`), 'dark is not the vintage look\'s unlit lamp');
  assert.ok(!lamp.includes(vintage.tokens['--meter-red']), 'the unlit lamp carries the meter red: it would read lit without a clip');
  assert.ok(lit, 'no rule lights the lamp');
  assert.match(lit, new RegExp(`background: [^;]*${vintage.tokens['--meter-red']};`), 'lit is not the meter red');
});

test('the dial\'s caption keeps clear of the lamp, as the frame\'s does', () => {
  const cap = rule(emitStylesheet(resolved(), vintage, 'test'), '.omx-vu[data-clip="1"] .omx-vu-caption');
  assert.ok(cap.includes(`right: ${5 + GEOMETRY.meterLamp + 4}px;`), `the caption runs under the lamp: '${cap}'`);
  assert.ok(cap.includes('overflow: hidden;'));
});

test('vuFaces: the dials as the template places them, each with its border; the template and the measure read one function', () => {
  const p = resolved(), lay = layout(p), faces = gen.vuFaces(lay.band, vintage);
  const html = emitTemplate(p, lay, 'test', 'vintage');
  const styles = html.split('<div class="omx-vu" ').slice(1).map((d) => /style="left:(\d+)px;top:(\d+)px;width:(\d+)px;height:(\d+)px"/.exec(d).slice(1).map(Number));
  assert.deepEqual(faces.map((f) => [f.x, f.y, f.w, f.h]), styles);
  assert.deepEqual([...new Set(faces.map((f) => f.border))], [3], 'the vintage bezel is 3 px (--vu-bezel)');
});
