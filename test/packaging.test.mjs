// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareVersions, packagingFloor, re } from './packaging-floors.mjs';

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
const DEB_NAME = { 'omx-contract-devel': 'libomx-contract-dev', 'sqlite-devel': 'libsqlite3-dev', 'libomx-domain-devel': 'libomx-domain-dev', 'pkgconfig(omxdsp)': 'libomxdsp-dev' };

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

// zynthian-ui finds the omx-panel tree from the installed schema/gestures.json and reads the gesture parity scripts and
// the descriptors they name under test/fixtures (tests/test_bar_xy_gestures.py). `make install` copies dist/ whole to
// /usr/share/omx-panel, so what dist/ holds is what the RPM and the DEB ship (Pi 0.13.8: scripts.json absent).
test('the package carries the gesture parity scripts and every descriptor they name, at the paths zynthian-ui reads', () => {
  const rel = 'test/fixtures/gestures/scripts.json';
  const { scripts } = JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
  const named = [...new Set(scripts.map((s) => s.descriptor).filter(Boolean))];
  assert.ok(named.length > 0);
  for (const f of [rel, ...named]) assert.ok(existsSync(join(ROOT, 'dist', f)), `dist/${f} is not in the built package`);
});

// The console's gesture lane reads the same parity scripts from the npm package: npm packs them, and the package exports
// them by name, so a reader resolves `<package>/gestures/scripts.json` without a path into dist/.
test('the npm package exports the gesture parity scripts by name', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const rel = 'dist/test/fixtures/gestures/scripts.json';
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  assert.ok(JSON.parse(packed.stdout)[0].files.map((f) => f.path).includes(rel), `the packed file list has no ${rel}`);
  assert.equal(pkg.exports['./gestures/scripts.json'], `./${rel}`, "package.json exports no './gestures/scripts.json'");
  // resolved through the exports map, as a consumer resolves it
  const at = createRequire(join(ROOT, 'package.json')).resolve(`${pkg.name}/gestures/scripts.json`);
  assert.equal(at, join(ROOT, rel));
  assert.ok(Array.isArray(JSON.parse(readFileSync(at, 'utf8')).scripts), 'the exported file holds no scripts');
});

// tools/look.json is the one public source of the vintage tokens (docs/modgui.md "The look"): the package carries it
// where its readers take it from. The build copies it into dist/ (tools/copy-data.mjs), npm packs dist/, the package
// exports it by name, and `make install` copies dist/ whole to /usr/share/omx-panel, where the renderer's data
// directory is tools/.
test('the package carries look.json, the vintage tokens with the knob pointer and the curve stroke, where its readers take it', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  // the build's own list: what it does not name, a clean build does not carry
  assert.match(readFileSync(join(ROOT, 'tools/copy-data.mjs'), 'utf8'), /export const DATA = \[[^\n]*'tools\/look\.json'/, 'tools/copy-data.mjs DATA does not list tools/look.json');
  assert.ok(existsSync(join(ROOT, 'dist/tools/look.json')), 'dist/tools/look.json is not in the built package');
  assert.equal(readFileSync(join(ROOT, 'dist/tools/look.json'), 'utf8'), readFileSync(join(ROOT, 'tools/look.json'), 'utf8'), 'dist/tools/look.json is not tools/look.json');
  // what npm packs
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  const files = JSON.parse(packed.stdout)[0].files.map((f) => f.path);
  assert.ok(files.includes('dist/tools/look.json'), 'the packed file list has no dist/tools/look.json');
  // a reader that imports the package reaches it by name
  assert.equal(pkg.exports['./look.json'], './dist/tools/look.json', "package.json exports no './look.json'");
  // the installed tree: dist/ whole under the package directory, the renderer's data directory its tools/
  assert.match(readFileSync(join(ROOT, 'Makefile'), 'utf8'), /^\tcp -R dist\/\. \$\(DESTDIR\)\$\(PKGDIR\)\/$/m);
  assert.match(readFileSync(join(ROOT, 'renderer/Makefile'), 'utf8'), /-DOMX_PANEL_DATA_DIR='"\$\(DATADIR\)\/omx-panel\/tools"'/);
  // and what it carries is the vintage look, every role and the two of one drawing each
  const look = JSON.parse(readFileSync(join(ROOT, 'dist/tools/look.json'), 'utf8'));
  assert.deepEqual([look.theme, look.accent, look.finish, look.style], ['dark', 'orange', 'aluminium', 'vintage']);
  const roles = JSON.parse(readFileSync(join(ROOT, 'dist/schema/look-roles.json'), 'utf8')).roles.map((r) => r.name);
  for (const n of ['--knob-pointer', '--curve-stroke']) assert.ok(roles.includes(n), `${n} is no role of the shipped role file`);
  for (const n of [...roles, '--knob-pointer', '--curve-stroke']) assert.match(look.tokens[n] ?? '', /^#[0-9a-f]{6}$/, `the shipped look.json sets no ${n}`);
});

// The installed tools import @openmixer/omx-contract/entry (isMain): the installed package links
// node_modules/@openmixer/omx-contract to the omx-contract package's /usr/lib/omx-contract, requires that package at the
// floor the spec states (floor only; package.json's npm floor is never above it), and %check, debian/rules and debian/tests run an installed tool
// (tools/installed-tools-check.sh). 0.15.0 shipped none of it: `node /usr/share/omx-panel/tools/modgui-gen.mjs` died with
// ERR_MODULE_NOT_FOUND on a host.
test('the installed tools resolve @openmixer/omx-contract: linked, required by a floor, run by the package checks', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const npmFloor = /^>=(\d+\.\d+\.\d+)$/.exec(pkg.devDependencies['@openmixer/omx-contract'])?.[1];
  assert.ok(npmFloor, 'package.json floors @openmixer/omx-contract');
  // the packages' floor is the spec's (packaging-floors.mjs); the npm one follows the npm publish and is never above it
  const floor = packagingFloor('omx-contract');
  assert.ok(compareVersions(npmFloor, floor) <= 0, `package.json floors @openmixer/omx-contract at ${npmFloor}, above the packages' ${floor}`);
  const makefile = readFileSync(join(ROOT, 'Makefile'), 'utf8');
  assert.match(makefile, /^OMX_CONTRACT_LIB \?= \$\(PREFIX\)\/lib\/omx-contract$/m);
  assert.match(makefile, /^\tln -sfn \$\(OMX_CONTRACT_LIB\) \$\(DESTDIR\)\$\(PKGDIR\)\/node_modules\/@openmixer\/omx-contract$/m);
  const spec = readFileSync(join(ROOT, 'packaging/omx-panel.spec'), 'utf8');
  const main = spec.slice(0, spec.indexOf('%description'));
  assert.match(main, new RegExp(`^Requires: omx-contract >= ${re(floor)}$`, 'm'));
  const control = readFileSync(join(ROOT, 'debian/control'), 'utf8');
  const depends = /^Package: omx-panel\n(?:.*\n)*?Depends: (.*)$/m.exec(control)?.[1] ?? '';
  assert.ok(depends.split(/,\s*/).includes(`omx-contract (>= ${floor}~)`), `omx-panel Depends: ${depends}`);
  for (const dep of [main.match(/^Requires: omx-contract\b.*$/gm) ?? [], depends.split(/,\s*/).filter((d) => d.startsWith('omx-contract ('))].flat()) {
    assert.doesNotMatch(dep, /<|(?<!>)=\s*\d|Breaks|Conflicts/, `a floor only: ${dep}`);
  }
  assert.match(spec, /^%check\n(?:.*\n)*?tools\/installed-tools-check\.sh %\{buildroot\}%\{_datadir\}\/omx-panel$/m);
  assert.match(readFileSync(join(ROOT, 'debian/rules'), 'utf8'), /^\ttools\/installed-tools-check\.sh \$\(CURDIR\)\/debian\/omx-panel\/usr\/share\/omx-panel$/m);
  assert.match(readFileSync(join(ROOT, 'debian/tests/control'), 'utf8'), /^Test-Command: tools\/installed-tools-check\.sh \/usr\/share\/omx-panel$/m);
  assert.equal(spawnSync('bash', ['-n', join(ROOT, 'tools/installed-tools-check.sh')]).status, 0);
});
