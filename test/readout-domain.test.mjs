// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Sorting pass row V22 (omx-panel#159): READOUT_RATE_HZ, the display redraw rate, is omx-panel's, in the domain named
// after its prefix (R-P): `readout`, contract.d/readout/readout.json. Call level: omx-contract's domain reader opens it
// (Domain.scalar, omx-contract >= 3.21.0: the reader of $OMX_CONTRACT_LIB, else the installed /usr/lib/omx-contract).
// (a) golden, frozen from omx-contract data/primitives.json at 8155b8d: 50 Hz; (b) equal to omx-contract's item while it
// still holds one; (c) a temporary contract directory with another value gives that value, and one without the item is
// refused by name.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = process.env.OMX_CONTRACT_LIB || '/usr/lib/omx-contract';
const { openDomainAt } = await import(pathToFileURL(join(LIB, 'lib/domain-reader.mjs')).href);

const GOLDEN = { value: 50, unit: 'Hz' };

test('(a) the readout domain opens and READOUT_RATE_HZ is 50 Hz', () => {
  const d = openDomainAt(join(ROOT, 'contract.d'), 'readout');
  assert.deepEqual({ ...d.scalar('READOUT_RATE_HZ') }, GOLDEN);
});

test('(a) the domain is omx-panel\'s, named after its item\'s prefix, and holds that one item', () => {
  const doc = JSON.parse(readFileSync(join(ROOT, 'contract.d/readout/readout.json'), 'utf8'));
  assert.equal(doc.$id, 'https://openmixer.org/contract/readout');
  assert.equal(doc.info['x-owner'], 'omx-panel');
  assert.deepEqual(Object.keys(doc.components.schemas), ['READOUT_RATE_HZ']);
});

test('(b) while omx-contract still holds READOUT_RATE_HZ, the value and unit are the same', (t) => {
  let resolved;
  try { resolved = createRequire(import.meta.url).resolve('@openmixer/omx-contract/resolved.json'); } catch { resolved = null; }
  if (!resolved || !existsSync(resolved)) return t.skip('omx-contract\'s resolved.json is not installed');
  const it = JSON.parse(readFileSync(resolved, 'utf8')).items.READOUT_RATE_HZ;
  if (!it) return t.skip('omx-contract no longer holds READOUT_RATE_HZ (row V22, last PR)');
  const d = openDomainAt(join(ROOT, 'contract.d'), 'readout');
  assert.deepEqual({ value: it.value, unit: it.unit }, { ...d.scalar('READOUT_RATE_HZ') });
});

test('(c) a temporary contract directory decides the answer: another value is read, no item is refused', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-v22-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(ROOT, 'contract.d/readout'), join(dir, 'readout'), { recursive: true });
  const f = join(dir, 'readout/readout.json');
  const doc = JSON.parse(readFileSync(f, 'utf8'));
  doc.components.schemas.READOUT_RATE_HZ['x-value'] = 25;
  writeFileSync(f, JSON.stringify(doc, null, 2));
  assert.equal(openDomainAt(dir, 'readout').scalar('READOUT_RATE_HZ').value, 25);
  delete doc.components.schemas.READOUT_RATE_HZ;
  doc.components.schemas.READOUT_OTHER = { description: 'x', 'x-since': '1.0.0', 'x-kind': 'scalar', 'x-unit': '', 'x-value': 1 };
  writeFileSync(f, JSON.stringify(doc, null, 2));
  assert.throws(() => openDomainAt(dir, 'readout').scalar('READOUT_RATE_HZ'), /READOUT_RATE_HZ/);
});
