// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// An item's x-since is the info.version of its domain document that first carried it (omx-contract docs/contract-dir.md):
// never a release of omx-contract or of this package. Every item of the panel domain came with its first version, 1.0.0, but the descriptions store's.
// An item the domain gains later says the version that adds it, and is added to LATER below.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = JSON.parse(readFileSync(join(ROOT, 'contract.d/panel/panel.json'), 'utf8'));
// the descriptions store (docs/descriptions-store.md) added these at 1.1.0; each display's axis as data (PANEL_DISPLAY_AXES) at 1.2.0
const LATER = { ...Object.fromEntries(['PANEL_STORE_CODES', 'PANEL_DESCRIBE_CODES', 'PANEL_GROUP_OUTCOMES', 'PANEL_GROUP_REASONS', 'PANEL_GROUP_RULES'].map((i) => [i, '1.1.0'])), PANEL_DISPLAY_AXES: '1.2.0' };
// the codes sheet (schema/codes.json) moved in at 1.2.0 (sorting pass row V3)
LATER.PANEL_SKIN_CODES = '1.2.0';
LATER.PANEL_MODGUI_CODES = '1.2.0';
// the words a surface draws of its own came at 1.3.0 (omx-panel#13)
LATER.PANEL_LABELS = '1.3.0';
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

test('every panel item says the domain version that added it', () => {
  for (const [item, schema] of Object.entries(doc.components.schemas)) {
    assert.equal(schema['x-since'], LATER[item] ?? '1.0.0', item);
  }
});
