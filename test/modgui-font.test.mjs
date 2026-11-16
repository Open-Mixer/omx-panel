// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The vintage look's serif is bundled and pinned: the generated stylesheet names the bundled face (then serif), the woff2 and its license are in
// every bundle, and the shipped file is the pinned one (a changed byte fails the check).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { generateModgui } from '../tools/modgui-gen.mjs';
import { fontPinFaults, loadFontPin } from '../tools/font-pin.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'test/fixtures/omx-delay');
const read = (f) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));
const made = () => new Map(generateModgui(read('omx-delay.descriptor.json'), { panel: read('omx-delay.panel.json'), stem: 'omx-delay', source: 't' }));

test('the generated stylesheet names the bundled face, then serif', () => {
  const css = made().get('modgui/stylesheet-omx-delay.css').toString();
  assert.match(css, /@font-face \{[^}]*font-family: 'Gelasio'[^}]*src: url\(\/resources\/fonts\/Gelasio\.woff2\{\{\{ns\}\}\}\) format\('woff2'\)/);
  assert.match(css, /font-family: Gelasio, Georgia, "Times New Roman", serif/);
});

test('the woff2 and its license are in the bundle, and the woff2 is the pinned one', () => {
  const files = made();
  const pin = loadFontPin();
  const woff = files.get('modgui/fonts/Gelasio.woff2');
  assert.ok(woff, 'no woff2 in the bundle');
  assert.equal(createHash('sha256').update(woff).digest('hex'), pin.sha256);
  assert.ok(files.get('modgui/fonts/Gelasio-OFL.txt')?.toString().includes('SIL OPEN FONT LICENSE'));
  assert.ok(pin.source.url.startsWith('https://') && pin.source.version && pin.source.commit);
});

test('the pin is checked: the shipped files match, and a drifted byte is named', () => {
  assert.deepEqual(fontPinFaults(), []);
  const root = mkdtempSync(join(tmpdir(), 'font-pin-'));
  const pin = loadFontPin();
  for (const f of [pin.file, pin.licenseFile]) {
    const to = join(root, f);
    import('node:fs').then(() => {});
    mkdirp(dirname(to));
    copyFileSync(join(ROOT, f), to);
  }
  writeFileSync(join(root, pin.file), Buffer.concat([readFileSync(join(root, pin.file)), Buffer.from([0])]));
  assert.match(fontPinFaults(pin, root).join('\n'), /is not the pinned file/);
});

import { mkdirSync } from 'node:fs';
function mkdirp(d) { mkdirSync(d, { recursive: true }); }
