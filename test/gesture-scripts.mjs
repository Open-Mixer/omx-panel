// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The shipped scripted gestures (test/fixtures/gestures/scripts.json, exported as @openmixer/omx-panel/gestures/scripts.json)
 * and the control each script runs against, built from its fixture descriptor's own travels and the surface geometry the script
 * file gives. Shared by the JavaScript reference's test (test/gestures.test.mjs) and the C reference's
 * (renderer/test/gesture-c.test.mjs), so both run the very same controls.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memberOf } from '../dist/tools/gestures.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SCRIPTS = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/gestures/scripts.json'), 'utf8')).scripts;
const descriptor = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const travelOf = (dsc, symbol) => dsc.controls.find((c) => c.symbol === symbol).travel;

/** A fixture's control, built from its descriptor's own travels and the surface geometry the script file gives. */
export function controlOf(s) {
  const c = s.control, dsc = s.descriptor ? descriptor(s.descriptor) : null;
  if (c.widget === 'handle') {
    const one = (k) => memberOf({ travel: travelOf(dsc, c.members[k]) }, c.start[k] !== undefined ? { value: c.start[k] } : {});
    return { widget: 'handle', target: c.target, plot: c.plot, freq: one('freq'), gain: one('gain'), q: one('q') };
  }
  if (c.widget === 'bar' && c.members) return { widget: 'bar', bars: c.members.map((b) => ({ ...b, ...(c.start?.[b.symbol] !== undefined ? { value: c.start[b.symbol] } : {}) })) };
  if (c.widget === 'bar') {
    const { w, pitch, h } = c.geometry;
    return { widget: 'bar', bars: c.symbols.map((symbol, i) => memberOf({ travel: travelOf(dsc, symbol) }, { symbol, target: { x: i * pitch, y: 0, w, h }, ...(c.start[symbol] !== undefined ? { value: c.start[symbol] } : {}) })) };
  }
  return { widget: c.widget, ...memberOf({ travel: travelOf(dsc, c.member) }, { target: c.target, travelPx: c.travelPx, ...(c.start.value !== undefined ? { value: c.start.value } : {}) }) };
}
