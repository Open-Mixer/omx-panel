// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The floor the packaging states on a package of ours: the spec's main-package `Requires:` (or `Recommends:`) line,
 * `<pkg> >= x.y.z`. A delivery raises it to the version it delivers (packaging/omx-panel.spec, debian/control) before
 * that version is on npm, so package.json's npm range is not this floor: it follows the npm publish, and the lockfile
 * with it, never above the packaging floor (contract-floor-agreement). The tests that hold the spec, debian/control
 * and the CI jobs to one floor read it here, never from a constant.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The main package's preamble of the spec under `root`: everything before its first %description. */
const preamble = (root) => {
  const spec = readFileSync(join(root, 'packaging/omx-panel.spec'), 'utf8');
  return spec.slice(0, spec.indexOf('\n%description'));
};

/** The floor the spec's main package states on `pkg` (Requires, else Recommends); throws when it states none. */
export function packagingFloor(pkg, root = ROOT) {
  const name = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^(?:Requires|Recommends): ${name} >= (\\d+\\.\\d+\\.\\d+)$`, 'm').exec(preamble(root));
  if (!m) throw new Error(`packaging/omx-panel.spec states no floor on ${pkg} (Requires or Recommends: ${pkg} >= x.y.z)`);
  return m[1];
}

/** `a` compared with `b`, both x.y.z: negative, zero or positive. */
export const compareVersions = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/** A version as the text of a regular expression. */
export const re = (v) => v.replace(/\./g, '\\.');
