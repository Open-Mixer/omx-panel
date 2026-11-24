// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The renderer draws the vintage knob (omx-panel#123, PR 2): in a panel it renders, one knob at the middle of its travel, the metal
 * the scene names is where the scene puts it: the cap's highlight (--knob-cap-hi) at the gradient's centre, the rim (--knob-edge)
 * between two knurl notches, the pointer (--knob-pointer) a third of the way out, straight up. The same panel under the console
 * style draws the flat knob, which the goldens and the parity checks hold, and a look that names no drawing draws it too. Coordinates
 * are derived from the cell and the geometry, never typed.
 */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DATA, ROOT, TOOLS, render, rects, scratch } from './harness.mjs';

const LOOK = JSON.parse(readFileSync(join(TOOLS, 'look.json'), 'utf8'));
const GEOMETRY = JSON.parse(readFileSync(join(TOOLS, 'look/geometry.json'), 'utf8')).geometry;
const FINISH = LOOK.console.finish[LOOK.console.defaultFinish];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** A panel of one knob (a section, a control, the renderer's own grammar) at the middle of its travel, and its state. */
function panel() {
  const dir = scratch();
  const description = join(dir, 'panel.json');
  const state = join(dir, 'state.json');
  writeFileSync(description, JSON.stringify({ sections: [{ key: 's', label: '' }], controls: [{ symbol: 'x', label: 'X', section: 0, standard: { widget: 'knob' } }] }));
  writeFileSync(state, JSON.stringify({ brand: '', name: 'one', values: { x: { fraction: 0.5, text: '0.5' } } }));
  return { description, state };
}

/** The data directory with the style `style` (a copy of the tree's tools, the look's style set). */
function dataWith(style, mutate = () => {}) {
  const base = mkdtempSync(join(tmpdir(), 'omx-panel-style-'));
  const dir = join(base, 'tools');
  cpSync(TOOLS, dir, { recursive: true });
  cpSync(join(ROOT, 'schema'), join(base, 'schema'), { recursive: true }); // the gesture declaration sits beside the tools directory
  const look = structuredClone(LOOK);
  look.style = style;
  mutate(look);
  writeFileSync(join(dir, 'look.json'), JSON.stringify(look, null, 2));
  return dir;
}

/** The knob's centre and radius in device px, from its cell and the geometry (the renderer's own placement). */
function knob(p, data, scale = 1) {
  const [x, y, w] = rects(p.description, { data, scale })[0];
  return { cx: x + w / 2, cy: y + (GEOMETRY.knobTop + GEOMETRY.knob / 2) * scale, r: (GEOMETRY.knob / 2) * scale };
}

const pixel = (img, x, y) => [...img.data.slice((Math.round(y) * img.w + Math.round(x)) * 4, (Math.round(y) * img.w + Math.round(x)) * 4 + 3)];

function drawn(style, mutate, scale = 1) {
  const p = panel();
  const data = style === undefined ? DATA : dataWith(style, mutate);
  return { img: render(p.description, p.state, { data, scale }), at: knob(p, data, scale) };
}

for (const scale of [1, 2, 3]) test(`under the vintage style, at ${scale}x, the cap's highlight, the rim and the pointer are where the scene puts them`, () => {
  const { img, at } = drawn('vintage', undefined, scale);
  const k = (2 * at.r) / GEOMETRY.knob;
  const cap = LOOK.drawings['knob-vintage'].gradients.cap.attrs;
  // the cap is a circle of radius 16.9 about (24, 24): the gradient's centre is a fraction of its bounding box
  const gx = 24 - 16.9 + cap.cx * 33.8, gy = 24 - 16.9 + cap.cy * 33.8;
  // the gradient's own centre falls between pixel centres: the colour there is the first stop's within a few levels of the 255 (the
  // gradient's whole span from cap-hi to face is far more), where the rim and the pointer, solid fills, are exact
  const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  const hi = pixel(img, at.cx + (gx - 24) * k, at.cy + (gy - 24) * k);
  assert.ok(near(hi, hex(FINISH['--knob-cap-hi']), 3), `the cap's highlight: ${hi} is not within 3 of ${hex(FINISH['--knob-cap-hi'])}`);
  assert.ok(!near(hi, hex(FINISH['--knob-face']), 12), 'the highlight is not the cap\'s base colour');
  // the rim: the ring between the knurl circle (17.6) and the edge circle (19.4), seven and a half degrees from a notch
  const th = (7.5 * Math.PI) / 180;
  assert.deepEqual(pixel(img, at.cx + Math.sin(th) * 18.5 * k, at.cy + Math.cos(th) * 18.5 * k), hex(FINISH['--knob-edge']), 'the rim');
  // the pointer at the middle of the travel stands straight up: its line runs from 9 to 19 about the centre's 24
  assert.deepEqual(pixel(img, at.cx, at.cy - 10 * k), hex(LOOK.console.tokens['--knob-pointer']), 'the pointer');
});

test('under the console style the same panel draws the flat knob: none of the metal is there', () => {
  const { img, at } = drawn();
  const k = (2 * at.r) / GEOMETRY.knob;
  const cap = LOOK.drawings['knob-vintage'].gradients.cap.attrs;
  const gx = 24 - 16.9 + cap.cx * 33.8, gy = 24 - 16.9 + cap.cy * 33.8;
  assert.notDeepEqual(pixel(img, at.cx + (gx - 24) * k, at.cy + (gy - 24) * k), hex(FINISH['--knob-cap-hi']));
  assert.notDeepEqual(pixel(img, at.cx + Math.sin(0.13) * 18.5 * k, at.cy + Math.cos(0.13) * 18.5 * k), hex(FINISH['--knob-edge']));
});

test('a style whose --knob is flat draws the flat knob: the vintage panel with it differs from the vintage one only in the knob', () => {
  const vintage = drawn('vintage').img, flat = drawn(undefined).img, other = drawn('console').img;
  assert.deepEqual(other.data, flat.data, 'the console style is the pinned data');
  // a look that names no style is worn as the roles give it: the console style's picture
  assert.deepEqual(drawn('console', (look) => { delete look.style; }).img.data, flat.data, 'no style is the roles');
  // the rest of the vintage style (the enclosure, the plates, the inks) is held to the MOD GUI's face by vintage-face.test.mjs
  const flatKnob = drawn('vintage', (look) => { look.looks.vintage['--knob'] = 'flat'; }).img;
  let off = 0, inKnob = 0;
  const at = drawn('vintage').at;
  for (let y = 0; y < vintage.h; y++) for (let x = 0; x < vintage.w; x++) {
    const i = (y * vintage.w + x) * 4;
    const inside = Math.abs(x - at.cx) <= at.r * 1.3 && Math.abs(y - at.cy) <= at.r * 1.3;
    const differs = vintage.data[i] !== flatKnob.data[i] || vintage.data[i + 1] !== flatKnob.data[i + 1] || vintage.data[i + 2] !== flatKnob.data[i + 2] || vintage.data[i + 3] !== flatKnob.data[i + 3];
    if (differs && inside) inKnob++;
    if (differs && !inside) off++;
  }
  assert.equal(off, 0, `${off} pixels outside the knob differ between the vintage style and the same style with a flat knob`);
  assert.ok(inKnob > 100, `the knob itself differs (${inKnob} pixels)`);
});

test('a look whose style names a drawing it does not carry is refused by name, not drawn flat', () => {
  const p = panel();
  const data = dataWith('vintage', (look) => { delete look.drawings; });
  assert.throws(() => render(p.description, p.state, { data }), /knob-vintage/);
});
