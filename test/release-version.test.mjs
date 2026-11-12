// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * release-version.test.mjs — every file that states the release's version states the same one: package.json (what
 * npm publishes and what the release workflow holds the tag to), package-lock.json (its own and the root package's),
 * the spec's Version and its newest %changelog entry, debian/changelog's newest entry, and a CHANGELOG.md line of that
 * version. A tag on a tree where one of them lags is refused at release, after the merge, with nothing published:
 * v0.13.4 was tagged on a tree whose package.json still said 0.13.3. A lone bump of one file is red here, before.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

/** Each file's stated version, by where it states it. */
export function statedVersions(files) {
  const lock = JSON.parse(files['package-lock.json']);
  const spec = files['packaging/omx-panel.spec'];
  return {
    'package.json': JSON.parse(files['package.json']).version,
    'package-lock.json': lock.version,
    'package-lock.json packages[""]': lock.packages?.['']?.version,
    'spec Version': /^Version:\s*(\S+)/m.exec(spec)?.[1],
    'spec %changelog': /^%changelog\s*\n\*[^\n]* - ([^\s-]+)-\d+/m.exec(spec)?.[1],
    'debian/changelog': /^omx-panel \(([^)-]+)(?:-[^)]*)?\)/.exec(files['debian/changelog'])?.[1],
  };
}

const FILES = ['package.json', 'package-lock.json', 'packaging/omx-panel.spec', 'debian/changelog', 'CHANGELOG.md'];
const tree = () => Object.fromEntries(FILES.map((f) => [f, read(f)]));

test('every version file states the version package.json states, and CHANGELOG.md has a line of it', () => {
  const files = tree();
  const stated = statedVersions(files);
  const version = stated['package.json'];
  assert.match(version, /^\d+\.\d+\.\d+$/);
  for (const [where, v] of Object.entries(stated)) assert.equal(v, version, `${where} states ${v}, package.json ${version}`);
  assert.ok(files['CHANGELOG.md'].split('\n').some((l) => l.startsWith(`- ${version}: `)), `CHANGELOG.md has no "- ${version}: " line`);
});

test('a lone bump of any one file is refused (the check reads each file, it does not copy one)', () => {
  const files = tree();
  const version = statedVersions(files)['package.json'];
  const next = version.replace(/\d+$/, (n) => String(Number(n) + 1));
  const bumps = {
    'package.json': (t) => t.replace(`"version": "${version}"`, `"version": "${next}"`),
    'packaging/omx-panel.spec': (t) => t.replace(/^Version:\s*\S+/m, `Version: ${next}`),
    'debian/changelog': (t) => t.replace(`omx-panel (${version}`, `omx-panel (${next}`),
  };
  for (const [f, bump] of Object.entries(bumps)) {
    const lone = { ...files, [f]: bump(files[f]) };
    assert.notEqual(lone[f], files[f], `${f}: the bump changed nothing`);
    const stated = Object.values(statedVersions(lone));
    assert.ok(new Set(stated).size > 1, `a lone bump of ${f} leaves every file agreeing`);
  }
});
