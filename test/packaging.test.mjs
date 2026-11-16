// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

for (const bin of ['bin/omx-panel.mjs', 'dist/bin/omx-panel.mjs']) {
  test(`${bin} --version prints the package version and nothing on stderr (#74)`, () => {
    const r = spawnSync(process.execPath, [join(ROOT, bin), '--version'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, `omx-panel ${version}\n`);
    assert.equal(r.stderr, '');
  });
}

test('the DEB reloads systemd after install, for the drop-ins on another package\'s unit (#74)', () => {
  const postinst = readFileSync(join(ROOT, 'debian/omx-panel.postinst'), 'utf8');
  assert.match(postinst, /^#DEBHELPER#$/m);
  assert.match(postinst, /^\s*systemctl daemon-reload\b/m);
  assert.equal(spawnSync('sh', ['-n', join(ROOT, 'debian/omx-panel.postinst')]).status, 0);
});

test('an upgrade does not stop the sync units: they are never started by the package (#74)', () => {
  assert.match(readFileSync(join(ROOT, 'debian/rules'), 'utf8'), /dh_installsystemd --no-enable --no-start --no-stop-on-upgrade/);
});

// The spec and debian/control build against the same library versions: every floor the spec's BuildRequires states is
// debian/control's Build-Depends floor for that library, and so is the ceiling where both state one (dependency audit
// 2026-11-16: libomx-contract-dev floored at 3.13.0 against the spec's omx-contract-devel 3.16.0).
const DEB_NAME = { 'omx-contract-devel': 'libomx-contract-dev', 'pkgconfig(omxdsp)': 'libomxdsp-dev' };

export function buildFloorsApart(spec, control) {
  const field = /^Build-Depends(?:-Arch|-Indep)?:(.*(?:\n[ \t].*)*)/m.exec(control)?.[1] ?? '';
  const out = [];
  for (const line of spec.match(/^BuildRequires:.*>=.*$/gm) ?? []) {
    const m = /^BuildRequires:\s*\(?(\S+)\s*>=\s*([\d.]+)(?:\s+with\s+\S+\s*<\s*([\d.]+)\))?/.exec(line);
    if (!m) continue;
    const [, name, floor, ceiling] = m;
    const deb = DEB_NAME[name] ?? name;
    const esc = deb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const df = new RegExp(`(?:^|[\\s,])${esc} \\(>= ([\\d.]+)~?\\)`).exec(field)?.[1];
    const dc = new RegExp(`(?:^|[\\s,])${esc} \\(<< ([\\d.]+)~?\\)`).exec(field)?.[1];
    if (df === undefined) out.push(`${name}: the spec floors it at ${floor}, debian/control states no floor for ${deb}`);
    else if (df !== floor) out.push(`${name}: the spec floors it at ${floor}, debian/control floors ${deb} at ${df}`);
    if (ceiling && dc !== undefined && dc !== ceiling) out.push(`${name}: the spec's ceiling is ${ceiling}, debian/control's for ${deb} is ${dc}`);
  }
  return out;
}

test('the spec and debian/control floor (and ceil) every build library the same', () => {
  const spec = readFileSync(join(ROOT, 'packaging', 'omx-panel.spec'), 'utf8');
  const control = readFileSync(join(ROOT, 'debian', 'control'), 'utf8');
  assert.deepEqual(buildFloorsApart(spec, control), []);
});

test('sabotage: a floor or ceiling moved on one side, or missing, is named', () => {
  const spec = 'BuildRequires: (omx-contract-devel >= 3.16.0 with omx-contract-devel < 4)\nBuildRequires: (pkgconfig(omxdsp) >= 0.32.2 with pkgconfig(omxdsp) < 0.33)\n';
  const control = 'Source: x\nBuild-Depends: libomx-contract-dev (>= 3.13.0~), libomx-contract-dev (<< 4~),\n               libomxdsp-dev (>= 0.32.2~), libomxdsp-dev (<< 0.34~)\n';
  assert.deepEqual(buildFloorsApart(spec, control), [
    'omx-contract-devel: the spec floors it at 3.16.0, debian/control floors libomx-contract-dev at 3.13.0',
    "pkgconfig(omxdsp): the spec's ceiling is 0.33, debian/control's for libomxdsp-dev is 0.34",
  ]);
  assert.deepEqual(buildFloorsApart(spec, 'Source: x\nBuild-Depends: libomxdsp-dev (>= 0.32.2~)\n')[0], 'omx-contract-devel: the spec floors it at 3.16.0, debian/control states no floor for libomx-contract-dev');
});
