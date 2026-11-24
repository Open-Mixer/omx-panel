// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// A tool started through a symlink (a node_modules/.bin link, a linked checkout) must answer as it does by its own
// path: a refusal exits non-zero, never 0 with nothing done.
const scratch = mkdtempSync(join(tmpdir(), 'omx-panel-entry-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (path) => spawnSync(process.execPath, [path], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });

// the tools that refuse a run with no argument in main(), after loading: a load failure would refuse either way
for (const tool of ['tools/look-pin.mjs', 'tools/lv2-complement.mjs']) {
  test(`${tool} run through a symlink refuses as it does by its own path`, () => {
    const link = join(scratch, tool.replaceAll('/', '-'));
    symlinkSync(join(ROOT, tool), link);
    const direct = run(join(ROOT, tool));
    assert.notEqual(direct.status, 0, `${tool} with no argument is expected to refuse`);
    const linked = run(link);
    assert.equal(linked.status, direct.status);
    assert.equal(linked.stderr, direct.stderr);
  });
}

// Every entry point decides that it was run, not imported, with omx-contract's isMain (real paths on both sides):
// comparing process.argv[1] with import.meta.url by hand misses a symlinked path.
test('no entry point compares process.argv[1] with import.meta.url by hand', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|mts|ts)$/.test(e.name)) files.push(p);
    }
  };
  for (const d of ['bin', 'tools', 'src']) walk(join(ROOT, d));
  const code = (f) => readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  const hand = files.filter((f) => code(f).some((l) => /process\.argv\[1\].*import\.meta\.url/.test(l)))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(hand, [], `compare by hand instead of isMain: ${hand.join(', ')}`);
});
