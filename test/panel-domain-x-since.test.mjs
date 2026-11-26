// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The panel domain's info.version is its vocabulary's own version: 0.1.0, raised only when the domain's own words
// change, never a release of omx-contract or of this package (owner, 2026-11-25). An item's x-since is the info.version
// of the document that first carried it (omx-contract docs/contract-dir.md): 0.1.0 for every item the domain holds at
// its first version. An item the domain gains later says the version that adds it, and is added to LATER below.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = JSON.parse(readFileSync(join(ROOT, 'contract.d/panel/panel.json'), 'utf8'));
/** The domain's first version. */
const FIRST = '0.1.0';
/** The items a later version added, each with that version: none yet. */
const LATER = {};
const semver = (v) => v.split('.').map(Number);
const above = (a, b) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

test('every panel item has an x-since no higher than the document version', () => {
  for (const [item, schema] of Object.entries(doc.components.schemas)) {
    assert.match(schema['x-since'] ?? '', /^[0-9]+\.[0-9]+\.[0-9]+$/, `${item} has no x-since version`);
    assert.equal(above(schema['x-since'], doc.info.version), false, `${item} x-since ${schema['x-since']} is above the document's ${doc.info.version}`);
  }
});

test('the domain is at its first version until its own words change', () => {
  if (Object.keys(LATER).length === 0) assert.equal(doc.info.version, FIRST);
});

test('every panel item says the domain version that added it', () => {
  for (const [item, schema] of Object.entries(doc.components.schemas)) {
    assert.equal(schema['x-since'], LATER[item] ?? FIRST, item);
  }
});
