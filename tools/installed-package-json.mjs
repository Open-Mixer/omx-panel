// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
//
// tools/installed-package-json.mjs <package.json> <out>: the package.json `make install` writes beside the installed tree.
// The install copies dist/ whole to the package directory (its tools/ is the renderer's data directory, a public path), so
// every file the npm package names under ./dist/ is installed one level up: the exports targets and the bin name that tree,
// and `files` (what npm packs) is dropped, as it names no installed path. A consumer that links
// node_modules/@openmixer/omx-panel to the installed tree then resolves every export name the npm tarball resolves.
import { readFileSync, writeFileSync } from 'node:fs';

const [from, out] = process.argv.slice(2);
if (!from || !out) {
  console.error('usage: installed-package-json.mjs <package.json> <out>');
  process.exit(2);
}

/** `target` with its dist/ prefix removed; a target outside dist/ is refused, as the install carries no such file. */
function installed(target) {
  const m = /^(\.\/)?dist\/(.+)$/.exec(target);
  if (m) return `${m[1] ?? ''}${m[2]}`;
  if (target === './package.json') return target;
  throw new Error(`installed-package-json: ${target} is outside dist/, which the install carries`);
}

/** An exports entry (a target, a conditions object, nested) with every target rewritten. */
function rewrite(entry) {
  if (typeof entry === 'string') return installed(entry);
  if (entry && typeof entry === 'object') return Object.fromEntries(Object.entries(entry).map(([k, v]) => [k, rewrite(v)]));
  return entry;
}

const pkg = JSON.parse(readFileSync(from, 'utf8'));
pkg.exports = rewrite(pkg.exports);
if (typeof pkg.bin === 'string') pkg.bin = installed(pkg.bin);
else if (pkg.bin) pkg.bin = rewrite(pkg.bin);
for (const k of ['main', 'types', 'module']) if (typeof pkg[k] === 'string') pkg[k] = installed(pkg[k]);
delete pkg.files;
writeFileSync(out, JSON.stringify(pkg, null, 2) + '\n');
