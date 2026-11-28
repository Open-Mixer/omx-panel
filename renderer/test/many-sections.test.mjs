// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * A panel of many sections is as tall as its sections, each one-knob section adding the same height. The layout's
 * per-section curve-row counts were allocated a byte per section and read as ints, so from the seventh section on
 * each read past the allocation: omx-reverb's seven sections drew 8404 px tall (27124 with no state), its last
 * section 21000 px below the one before, the height moving with whatever the heap held.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLI, DATA, scratch } from './harness.mjs';

/** A description of `n` sections, one knob in each, no display. */
function sections(n) {
  const knob = (i) => ({ symbol: `k${i}`, param: i, section: i, sectionKey: `s${i}`, widget: 'knob', standard: { widget: 'knob' }, labelKey: null, label: `Knob ${i}`, visible: null, mask: '0', unit: 'none', meaning: null });
  return { origin: 'authored', family: null, sections: Array.from({ length: n }, (_, i) => ({ key: `s${i}`, labelKey: null, label: `Section ${i}` })),
    controls: Array.from({ length: n }, (_, i) => knob(i)), roles: [], unpublished: [], displays: [], defaults: [], ports: { inputs: [], outputs: [], sidechain: false, notes: false },
    easy: [], meters: [], meterRefusals: [], words: {} };
}

/** The natural size of a description, and each control's cell (`--rects`). */
function natural(desc, dir, name) {
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(desc));
  const [size, ...rects] = execFileSync(CLI, ['--description', file, '--data', DATA, '--rects'], { encoding: 'utf8' }).trim().split('\n');
  return { h: Number(size.split(' ')[1]), tops: rects.map((r) => Number(r.split(' ')[1])) };
}

test('each section adds the same height, past the seventh as before it', () => {
  const dir = scratch();
  const heights = [];
  for (let n = 1; n <= 16; n++) heights.push(natural(sections(n), dir, `s${n}`).h);
  const step = heights[1] - heights[0];
  assert.ok(step > 0, `a second section added ${step} px`);
  for (let n = 2; n <= 16; n++) assert.equal(heights[n - 1] - heights[n - 2], step, `section ${n} added ${heights[n - 1] - heights[n - 2]} px, not ${step} (heights ${heights.join(', ')})`);
  const { tops } = natural(sections(16), dir, 'tops');
  for (let i = 1; i < 16; i++) assert.equal(tops[i] - tops[i - 1], step, `knob ${i} stands ${tops[i] - tops[i - 1]} px below knob ${i - 1}`);
});
