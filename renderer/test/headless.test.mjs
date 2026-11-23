// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * A face without a head (#94): a host drawing one control per view (Zynthian's stock controller under the vintage look,
 * Open-Mixer/zynthian-ui#70) switches the head off with omx_panel_view_set_head(view, false) (the command's state file:
 * "head": false). The face is then the control, its label and its value: the sections start at `pad`, the face is
 * `sectionTop - pad` shorter, and nothing of the head (the accent rule, the dot, the maker and the name) is drawn. Held to
 * a golden image of a one-control description at 1x and 2x.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { RENDERER, ROOT, compare, decodePng, descriptionFile, encodePng, render, scratch } from './harness.mjs';

const UPDATE = process.env.OMX_PANEL_RENDER_UPDATE === '1';
const GOLDEN = join(RENDERER, 'test', 'golden');
const GEOMETRY = JSON.parse(readFileSync(join(ROOT, 'tools/look/geometry.json'), 'utf8'));
const G = GEOMETRY.geometry ?? GEOMETRY;
const ONE = { name: 'one-control', descriptor: 'test/fixtures/one-control/one.descriptor.json', stem: 'one' };

/** A state file: the head's text, the one control at its default, and `head` when given. */
function stateOf(dir, head) {
  const file = join(dir, `state-${head}.json`);
  writeFileSync(file, JSON.stringify({ brand: 'omx-panel tests', name: 'Test One Control', values: { gain: { fraction: 0.8, text: '-6.0 dB' } }, ...(head === undefined ? {} : { head }) }));
  return file;
}

/** How many pixels of rows [y0, y1) differ between two renderings of one width. */
function rowsDiffer(a, b, y0, y1) {
  let n = 0;
  for (let i = y0 * a.w * 4; i < y1 * a.w * 4; i++) if (a.data[i] !== b.data[i]) n++;
  return n;
}

test('a face without its head is sectionTop - pad shorter, and its sections are the headed face\'s, moved up', () => {
  const dir = scratch();
  const desc = descriptionFile(ONE, dir);
  const headed = render(desc, stateOf(dir));
  const shown = render(desc, stateOf(dir, true));
  const headless = render(desc, stateOf(dir, false));
  assert.deepEqual([shown.w, shown.h], [headed.w, headed.h], '"head": true is the default face');
  assert.ok(compare(shown, headed).exact, '"head": true draws the default face');
  const lift = G.sectionTop - G.pad;
  assert.ok(lift > 0, `the geometry's sectionTop ${G.sectionTop} is below its pad ${G.pad}`);
  assert.deepEqual([headless.w, headless.h], [headed.w, headed.h - lift], `the headless face is ${lift} px shorter`);
  // below the head, the headed face is the headless one moved down by `lift`: the same section, control, label and value
  const below = { w: headed.w, h: headless.h - G.pad, data: headed.data.slice((G.pad + lift) * headed.w * 4) };
  const moved = { w: headless.w, h: headless.h - G.pad, data: headless.data.slice(G.pad * headless.w * 4) };
  const d = compare(below, moved);
  assert.ok(d.exact, `${d.off} pixels of the sections differ from the headed face's`);
  // and the head is gone: the headed face's top `headH` rows differ from the headless face's
  assert.ok(rowsDiffer(headed, headless, 0, G.headH) > 0, 'the head is drawn in both');
});

for (const scale of [1, 2]) {
  test(`the one-control face without its head at ${scale}x: the golden image`, () => {
    const dir = scratch();
    const drawn = render(descriptionFile(ONE, dir), stateOf(dir, false), { scale });
    const file = join(GOLDEN, `one-control-headless@${scale}x.png`);
    if (UPDATE || !existsSync(file)) {
      assert.ok(UPDATE, `no golden image ${file}: write it with OMX_PANEL_RENDER_UPDATE=1`);
      mkdirSync(GOLDEN, { recursive: true });
      writeFileSync(file, encodePng(drawn));
      return;
    }
    const d = compare(drawn, decodePng(readFileSync(file)));
    assert.ok(d.sameSize, `the image is ${drawn.w}x${drawn.h}, not the golden size`);
    assert.ok(d.exact, `${d.off} pixels differ, by up to ${d.worst}`);
  });
}
