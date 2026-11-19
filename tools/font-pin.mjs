// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * font-pin.mjs — the vintage look's serif face is bundled in every MOD GUI (no system font is relied on) and pinned like the
 * console's tokens: the sha-256 of the woff2 that ships and of its license file, with the upstream source (the release URL,
 * the commit, the version and the sha-256 of the TTF it was made from) in tools/look/font-gelasio.json.
 *
 * Usage: `node tools/font-pin.mjs --check` verifies the files against the pin (exit 1, naming each fault).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '@openmixer/omx-contract/entry';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FONT_PIN_JSON = join(ROOT, 'tools', 'look', 'font-gelasio.json');
export const loadFontPin = (file = FONT_PIN_JSON) => JSON.parse(readFileSync(file, 'utf8'));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** The faults of the bundled font against the pin, as sentences, or none. */
export function fontPinFaults(pin = loadFontPin(), root = ROOT) {
  const faults = [];
  const hash = (rel) => sha(readFileSync(join(root, rel)));
  if (hash(pin.file) !== pin.sha256) faults.push(`${pin.file} is not the pinned file (sha-256 ${hash(pin.file)}, the pin says ${pin.sha256})`);
  if (hash(pin.licenseFile) !== pin.licenseSha256) faults.push(`${pin.licenseFile} is not the pinned license`);
  for (const k of ['url', 'commit', 'version', 'ttfSha256']) if (!pin.source?.[k]) faults.push(`the pin names no source ${k}`);
  return faults;
}

if (isMain(import.meta.url)) {
  const faults = fontPinFaults();
  for (const f of faults) console.error(`font-pin: ${f}`);
  if (!faults.length) console.log(`font-pin: ${loadFontPin().family} ${loadFontPin().source.version} matches its pin`);
  process.exit(faults.length ? 1 : 0);
}
