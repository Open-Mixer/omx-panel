// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * Every file that declares an omx-contract floor declares the same one (D30: the newest, with its ceiling). omx-panel once
 * said 3.16.0 in one file, 3.13.0 in another and 3.12.0 in a third, so a build passed where another could not. This reads
 * every declared floor across the packaging, the CI jobs, the build scripts, the docs and package.json, and fails with the
 * list when they differ. Generation replaces it (issue 65).
 * package.json's npm range is the one exception: a delivery raises the packages' floor to the version it delivers before
 * that version is on npm (the sorting pass, 3.21.0, wave f45s), and `npm ci` refuses a range its lockfile does not satisfy,
 * so the npm floor and the lockfile follow the npm publish. It is held at or below the packages' floor, never above.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareVersions } from './packaging-floors.mjs';

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

/** The floors of `found` but package.json's agree on one version, and package.json's is at or below it; the errors. */
export function floorDisagreements(found) {
  const packages = found.filter(([f]) => f !== 'package.json');
  const versions = [...new Set(packages.map(([, v]) => v))];
  const lines = packages.map(([f, v]) => `  ${f}: ${v}`).join('\n');
  if (versions.length !== 1) return [`omx-contract floors disagree:\n${lines}`];
  return found.filter(([f, v]) => f === 'package.json' && compareVersions(v, versions[0]) > 0)
    .map(([, v]) => `package.json floors @openmixer/omx-contract at ${v}, above the packages' ${versions[0]}`);
}

test('every declared omx-contract floor is the same version', () => {
  const found = declaredFloors();
  assert.ok(found.length >= 8, `only ${found.length} floors found: the pattern or the file list went stale`);
  assert.ok(found.some(([f]) => f === 'package.json'), 'package.json declares no @openmixer/omx-contract floor');
  assert.deepEqual(floorDisagreements(found), []);
});

test('the sabotage arms: a packaging floor that differs, or an npm floor above the packages\', is red', () => {
  const found = declaredFloors();
  const [, v] = found.find(([f]) => f === 'packaging/omx-panel.spec');
  const [maj, min] = v.split('.').map(Number);
  const older = `${maj}.${min - 1}.0`;
  const newer = `${maj}.${min + 1}.0`;
  const swap = (file, to) => { let done = false; return found.map(([f, x]) => (!done && f === file && (done = true) ? [f, to] : [f, x])); };
  assert.match(floorDisagreements(swap('.github/workflows/ci.yml', older)).join(''), /floors disagree/);
  assert.match(floorDisagreements(swap('debian/control', newer)).join(''), /floors disagree/);
  assert.match(floorDisagreements(swap('package.json', newer)).join(''), /above the packages'/);
  assert.deepEqual(floorDisagreements(swap('package.json', v)), [], 'the npm floor at the packages\' floor is green');
});
