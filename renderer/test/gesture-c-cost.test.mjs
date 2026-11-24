// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas
/*
 * The cost of omx_gesture_run grows with the script's length, not faster (#105). A caller that re-runs the script on each event
 * (typed-contracts 4.1) pays the whole script every time, so a quadratic step makes a long gesture session crawl: before the fix,
 * one knob and N wheel events 700 ms apart cost 0.11 s at 5000 events and 22.4 s at 40000 (a ratio of 200; the events were
 * read by indexing cJSON's list from its head, once per event). Eight times the events must cost about eight times the time;
 * the bound is 16, twice linear, so a busy box does not turn it red and a quadratic step (ratio 64) cannot pass it.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DECLARATION, DRIVER } from './gesture-c.mjs';

const SHORT = 5000;
const LONG = 8 * SHORT;
const BOUND = 16;

const knob = { widget: 'knob', min: 0, max: 100, def: 50, value: 20, travelPx: 200, target: { x: 0, y: 0, w: 40, h: 220 } };
/** One case of `n` wheel notches 700 ms apart, each its own gesture, alternating up and down so the value stays inside the travel. */
const wheels = (n) => [{ settings: '{}', control: JSON.stringify(knob), events: JSON.stringify(Array.from({ length: n }, (_x, i) => ({ t: 700 * i, type: 'wheel', n: i % 2 ? -1 : 1 }))) }];

/** The fastest of `runs` runs of the driver over `file`, in seconds, and the last answer. */
function timed(file, runs) {
  let best = Infinity;
  let answer;
  for (let r = 0; r < runs; r++) {
    const t0 = process.hrtime.bigint();
    answer = execFileSync(DRIVER, [DECLARATION, file], { encoding: 'utf8', maxBuffer: 1 << 28 });
    best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e9);
  }
  return { seconds: best, answer: JSON.parse(answer)[0] };
}

test(`omx_gesture_run: ${LONG} events cost at most ${BOUND} times ${SHORT} (linear is 8)`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gesture-cost-'));
  try {
    writeFileSync(join(dir, 'short.json'), JSON.stringify(wheels(SHORT)));
    writeFileSync(join(dir, 'long.json'), JSON.stringify(wheels(LONG)));
    const short = timed(join(dir, 'short.json'), 5);
    const long = timed(join(dir, 'long.json'), 2);
    // the runs did the work: every notch is a gesture of its own, so a driver that answered early cannot look fast
    assert.equal(short.answer.gestures.length, SHORT);
    assert.equal(long.answer.gestures.length, LONG);
    const ratio = long.seconds / short.seconds;
    assert.ok(ratio <= BOUND, `${LONG} events took ${long.seconds.toFixed(3)} s, ${SHORT} took ${short.seconds.toFixed(3)} s: a ratio of ${ratio.toFixed(1)}, above ${BOUND}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
