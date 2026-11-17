// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * What the dirty-rectangle tests share: a script of states drawn dirty into one buffer by `omx-panel-render --steps`, with per step the
 * rectangles, the buffer before and after, and a full draw of the same state made by a view made anew.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLI, DATA, descriptionFile, scratch } from './harness.mjs';

/** `deltas` applied one after another to the fixture's view; per step the rectangles and the three buffers (RGBA, 4 bytes a pixel). */
export function steps(description, state, deltas, { scale = 1, format = 'rgba', alpha = 'premultiplied', size, cap } = {}) {
  const dir = scratch();
  const script = join(dir, 'steps.json');
  writeFileSync(script, JSON.stringify(deltas));
  const args = ['--description', description, '--data', DATA, '--state', state, '--scale', String(scale), '--format', format, '--alpha', alpha, '--steps', script, '--steps-out', dir];
  if (size) args.push('--width', String(size[0]), '--height', String(size[1]));
  if (cap) args.push('--cap', String(cap));
  const lines = execFileSync(CLI, args, { encoding: 'utf8' }).trim().split('\n').map((l) => JSON.parse(l));
  const read = (kind, k) => new Uint8Array(readFileSync(join(dir, `${kind}.${k}.raw`)));
  return lines.map(({ step, rects: r, width, height }) => ({ step, rects: r, width, height, before: step ? read('before', step) : null, after: read('after', step), full: read('full', step) }));
}

/** The first byte at which two buffers differ, or -1. */
export const firstDiff = (a, b) => {
  if (a.length !== b.length) return 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
};
const inside = (rs, w, i) => {
  const px = i >> 2, x = px % w, y = (px - x) / w;
  return rs.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh);
};
/** Every byte outside the step's rectangles is what the step started with. */
export function outsideUntouched(s) {
  const w = s.width;
  for (let i = 0; i < s.after.length; i++) if (s.after[i] !== s.before[i] && !inside(s.rects, w, i)) return `byte ${i} (pixel ${(i >> 2) % w},${Math.floor((i >> 2) / w)}) changed outside ${JSON.stringify(s.rects)}`;
  return null;
}


/** A fixture's description (`edit` applied to it) and a bare state: the title and no reading, for fixtures whose state needs omx-dsp's twin. */
export function bare(fx, edit = (x) => x) {
  const dir = scratch();
  const x = edit(JSON.parse(readFileSync(descriptionFile(fx, dir), 'utf8')));
  const description = join(dir, 'bare.layout.json');
  writeFileSync(description, JSON.stringify(x));
  const state = join(dir, 'bare.state.json');
  writeFileSync(state, JSON.stringify({ brand: 'brand', name: 'name', values: {} }));
  return { description, state, controls: x.controls };
}

export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
