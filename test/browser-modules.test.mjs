// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The modules a browser loads as they are (%4, #180): their import graph reaches no Node module (node:fs, the Node domain
// loader), so the console's browser entry (omx-panel-browser-entry) and a page load them unchanged. Their words come from
// data rendered from the domains at build time (tools/group-words.mjs, schema/codes.json), checked by test.
// The graph is read from the sources: every static and dynamic import specifier, followed within this tree.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The modules the browser loads: the console's browser-safe exports (role-table, bars) and group-infer, easy. */
export const BROWSER_MODULES = ['tools/group-infer.mjs', 'tools/role-table.mjs', 'tools/bars.mjs', 'tools/easy.mjs'];
const BUILTIN = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

/** Every Node module the import graph of `file` reaches: `[{ from, spec }]`. */
export function nodeImports(file, seen = new Set()) {
  if (seen.has(file)) return [];
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  const specs = [...src.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)].map((m) => m[1] ?? m[2] ?? m[3]);
  const out = [];
  for (const spec of specs) {
    if (spec.startsWith('node:') || BUILTIN.has(spec)) out.push({ from: file.slice(ROOT.length + 1), spec });
    else if (spec.startsWith('.') && spec.endsWith('.mjs')) out.push(...nodeImports(resolve(dirname(file), spec), seen));
  }
  return out;
}

for (const m of BROWSER_MODULES) {
  test(`${m} reaches no Node module`, () => {
    assert.deepEqual(nodeImports(join(ROOT, m)), []);
  });
}

test('arm: the check sees a node:fs import planted in group-infer', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-browser-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(ROOT, 'tools'), join(dir, 'tools'), { recursive: true });
  const f = join(dir, 'tools/group-infer.mjs');
  writeFileSync(f, `import { readFileSync } from 'node:fs';\n${readFileSync(f, 'utf8')}`);
  const saved = ROOT;
  assert.ok(nodeImports(f).some((i) => i.spec === 'node:fs'), 'the planted import is not seen');
  assert.equal(saved, ROOT);
});
