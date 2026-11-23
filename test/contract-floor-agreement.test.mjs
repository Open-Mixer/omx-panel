// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * Every file that declares an omx-contract floor declares the same one (D30: the newest, with its ceiling). omx-panel once
 * said 3.16.0 in one file, 3.13.0 in another and 3.12.0 in a third, so a build passed where another could not. This reads
 * every declared floor across the packaging, the CI jobs, the build scripts, the docs and package.json, and fails with the
 * list when they differ. Generation replaces it (issue 65).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FLOOR_FILES = [
  'debian/control', 'packaging/omx-panel.spec', '.github/workflows/ci.yml', '.github/workflows/release.yml',
  'tools/offline-build-check.sh', 'renderer/Makefile', 'BUILDING.md', 'docs/renderer.md',
  'renderer/omx-panel-render.pc.in', 'renderer/omx-panel-window.pc.in', 'package.json',
];
// "omx-contract-devel >= 3.18.0", "libomx-contract-dev (>= 3.18.0~)", "@openmixer/omx-contract": ">=3.18.0 <4"
const FLOOR = /(?:@openmixer\/)?(?:lib)?omx-contract(?:-devel|-data|-dev)?["'`]?:?\s*["'`(]?\s*\(?\s*>=\s*(\d+\.\d+\.\d+)/g;

/** Every [file, floor] the tree declares; the spec's %changelog and the changelogs record history and are not read. */
export function declaredFloors() {
  const out = [];
  for (const f of FLOOR_FILES) {
    let text;
    try { text = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
    text = text.split('\n%changelog')[0];
    for (const m of text.matchAll(FLOOR)) out.push([f, m[1]]);
  }
  return out;
}

test('every declared omx-contract floor is the same version', () => {
  const found = declaredFloors();
  assert.ok(found.length >= 8, `only ${found.length} floors found: the pattern or the file list went stale`);
  const versions = [...new Set(found.map(([, v]) => v))];
  const lines = found.map(([f, v]) => `  ${f}: ${v}`).join('\n');
  assert.equal(versions.length, 1, `omx-contract floors disagree:\n${lines}`);
});
