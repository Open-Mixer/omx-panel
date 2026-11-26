// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The frame budget of a drawn panel is declared once, in schema/frame-budget.json (docs/renderer.md, Frame budget): the p99 of one
 * drag frame at the declared size on the declared device, and the document says the same figures. A host reads the file and carries
 * none of its own.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ROOT = new URL('..', import.meta.url).pathname;
const budget = JSON.parse(readFileSync(`${ROOT}schema/frame-budget.json`, 'utf8')).dragFrame;
const doc = readFileSync(`${ROOT}docs/renderer.md`, 'utf8');
const section = doc.slice(doc.indexOf('### Frame budget'), doc.indexOf('## Meters'));

test('the budget is one display frame at 60 Hz, at the size and on the device the document names', () => {
  assert.ok(budget.p99Ms <= 1000 / 60 + 0.05, `${budget.p99Ms} ms fits a 60 Hz frame`);
  assert.ok(section.includes(`${budget.p99Ms} ms`), 'the document names the figure');
  assert.ok(section.includes(`${budget.width} x ${budget.height}`), 'the document names the size');
  assert.ok(section.includes(budget.device), 'the document names the device');
  for (const part of budget.covers) assert.ok(section.includes(part), `the document says the budget covers the ${part}`);
});

test('the budget file is shipped in the built tree', () => {
  assert.deepEqual(JSON.parse(readFileSync(`${ROOT}dist/schema/frame-budget.json`, 'utf8')).dragFrame, budget);
});
