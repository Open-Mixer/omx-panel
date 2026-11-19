#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
//
// tools/omx-dsp-link-check.mjs [omx-panel root]: one curve answered by the omx-dsp that node_modules/@openmixer/omx-dsp
// links to (the omx-dsp-wasm package's dist/ and wasm/), loaded from the installed path. PASS or FAIL by name; exit 1 on FAIL.
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.argv[2] ?? '/usr/share/omx-panel';
const link = join(root, 'node_modules/@openmixer/omx-dsp');
const fail = (why) => {
  console.log(`FAIL omx-dsp curve: ${why}`);
  process.exit(1);
};

let dir;
try {
  dir = await realpath(link);
} catch (err) {
  fail(`${link} reaches nothing (${err.code})`);
}
try {
  const { loadCurve } = await import(pathToFileURL(join(dir, 'dist/index.js')).href);
  const curve = await loadCurve(await readFile(join(dir, 'wasm/omx-dsp.wasm')));
  const { points } = curve.curvePoints({
    kind: 'transfer_curve', family: 'dynamics', sampleRate: 48000, points: 128,
    terms: [{ role: 'threshold', value: -18, unit: 'db' }, { role: 'ratio', value: 4, unit: 'ratio' }],
  });
  const top = points.at(-1);
  if (!(Math.abs(top.x) < 1e-6 && Math.abs(top.y + 13.5) < 1e-6)) fail(`${link} answers (${top.x}, ${top.y}) at the top, not (0, -13.5)`);
  console.log(`PASS omx-dsp curve: 0 dB in is -13.5 dB out through ${link} -> ${dir}`);
} catch (err) {
  fail(`${link} -> ${dir}: ${err instanceof Error ? err.message : err}`);
}
