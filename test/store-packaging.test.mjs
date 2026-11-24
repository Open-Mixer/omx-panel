// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The descriptions store is packaged (owner ruling, omx-panel 0.15.0): the library libomx-panel-store.so.0, its command
 * omx-panel-store, and its header, .so link, pkg-config file and the DDL schema/panel.sql for a build against it, named as
 * the renderer's pair is (docs/descriptions-store.md section 5; docs/renderer.md):
 *
 *   spec             omx-panel-store        libomx-panel-store.so.0, /usr/bin/omx-panel-store and its page
 *                    omx-panel-store-devel  the .so link, <omx-panel/omx_panel_store.h>, omx-panel-store.pc, panel.sql
 *   debian/control   libomx-panel-store0    libomx-panel-store.so.0 (Multi-Arch: same: no command beside it)
 *                    libomx-panel-store-dev the .so link, the header, the pkg-config file, panel.sql
 *                    omx-panel-store        /usr/bin/omx-panel-store and its page (Multi-Arch: foreign)
 *
 * Each is read from the packaging as written: the spec's %package and %files, debian/control's stanzas and each
 * package's debian/<name>.install, the build and install steps of the spec and debian/rules, the Makefile target they
 * call and store/Makefile's install, which carries every file named here; the release workflow publishes each package
 * and the CI build copies it out. SQLite's floor 3.38.0 (store/Makefile SQLITE_FLOOR) is a build dependency of both, the
 * same. tools/store-package-check.sh reads the built packages. Each sabotage arm drops one piece from a copy and is red.
 */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SQLITE_FLOOR = readFileSync(join(ROOT, 'store/Makefile'), 'utf8').match(/^SQLITE_FLOOR := (\S+)$/m)[1];

const SPEC_FILES = {
  'omx-panel-store': ['%{_libdir}/libomx-panel-store.so.0', '%{_bindir}/omx-panel-store', '%{_mandir}/man1/omx-panel-store.1*'],
  'omx-panel-store-devel': ['%{_libdir}/libomx-panel-store.so', '%{_includedir}/omx-panel/omx_panel_store.h',
    '%{_libdir}/pkgconfig/omx-panel-store.pc', '%{_datadir}/omx-panel-store/panel.sql'],
};
const DEB_FILES = {
  'libomx-panel-store0': ['usr/lib/*/libomx-panel-store.so.0'],
  'libomx-panel-store-dev': ['usr/lib/*/libomx-panel-store.so', 'usr/include/omx-panel/omx_panel_store.h',
    'usr/lib/*/pkgconfig/omx-panel-store.pc', 'usr/share/omx-panel-store/panel.sql'],
  'omx-panel-store': ['usr/bin/omx-panel-store', 'usr/share/man/man1/omx-panel-store.1'],
};
// store/Makefile's install: each file the packages carry, from the build or the tree
const STORE_INSTALLS = ['$(B)/$(SONAME)', 'libomx-panel-store.so', 'include/omx-panel/omx_panel_store.h', '$(B)/omx-panel-store.pc',
  '$(B)/omx-panel-store', '../schema/panel.sql', '../man/omx-panel-store.1'];

const SECTION = /^%(package|description|files|prep|build|install|check|changelog)\b/;

/** The lines of the spec section that starts with `head` exactly (to the next section), or null when there is none. */
function specSection(spec, head) {
  const lines = spec.split('\n');
  const i = lines.findIndex((l) => l.trim() === head);
  if (i < 0) return null;
  const out = [];
  for (const l of lines.slice(i + 1)) { if (SECTION.test(l)) break; out.push(l); }
  return out.map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

/** debian/control's binary stanzas, by package name, as their field text. */
function stanzas(control) {
  const out = {};
  for (const block of control.split(/\n\s*\n/)) {
    const m = /^Package:\s*(\S+)$/m.exec(block);
    if (m) out[m[1]] = block;
  }
  return out;
}

/** The body of a make target (its recipe lines) in `text`, or null. */
function target(text, name) {
  const m = new RegExp(`^${name.replace(/[-.]/g, '\\$&')}:.*\\n((?:\\t.*\\n?)*)`, 'm').exec(text);
  return m ? m[1] : null;
}

/** Every way `root`'s packaging fails to package the store; empty when it does. */
export function storePackagingErrors(root) {
  const read = (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : '');
  const errors = [];
  const spec = read('packaging/omx-panel.spec').split('\n%changelog')[0];

  // the spec: the two packages, their files, the build and the install
  for (const [pkg, files] of Object.entries(SPEC_FILES)) {
    if (!specSection(spec, `%package -n ${pkg}`)) errors.push(`spec: no %package -n ${pkg}`);
    const listed = specSection(spec, `%files -n ${pkg}`);
    if (!listed) { errors.push(`spec: no %files -n ${pkg}`); continue; }
    for (const f of files) if (!listed.includes(f)) errors.push(`spec: %files -n ${pkg} does not carry ${f}`);
  }
  if (!/^Requires: omx-panel-store%\{\?_isa\} = %\{version\}-%\{release\}$/m.test(specSection(spec, '%package -n omx-panel-store-devel')?.join('\n') ?? ''))
    errors.push('spec: omx-panel-store-devel does not require its library at the same version');
  if (!(specSection(spec, '%build') ?? []).some((l) => /make_build -C store\b/.test(l))) errors.push('spec: %build does not build store/');
  if (!(specSection(spec, '%install') ?? []).some((l) => /^make install-store\b/.test(l))) errors.push('spec: %install does not run make install-store');
  if (!new RegExp(`^BuildRequires: sqlite-devel >= ${SQLITE_FLOOR.replace(/\./g, '\\.')}$`, 'm').test(spec))
    errors.push(`spec: no BuildRequires: sqlite-devel >= ${SQLITE_FLOOR}`);

  // debian: the three packages, each install file, the build and the install
  const control = read('debian/control');
  const st = stanzas(control);
  for (const [pkg, files] of Object.entries(DEB_FILES)) {
    if (!st[pkg]) errors.push(`debian/control: no Package: ${pkg}`);
    const inst = read(`debian/${pkg}.install`).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (inst.length === 0) { errors.push(`debian/${pkg}.install: absent or empty`); continue; }
    for (const f of files) if (!inst.includes(f)) errors.push(`debian/${pkg}.install does not carry ${f}`);
  }
  if (st['libomx-panel-store0'] && !/^Multi-Arch: same$/m.test(st['libomx-panel-store0'])) errors.push('debian/control: libomx-panel-store0 is not Multi-Arch: same');
  if (st['libomx-panel-store-dev'] && !/libomx-panel-store0 \(= \$\{binary:Version\}\)/.test(st['libomx-panel-store-dev']))
    errors.push('debian/control: libomx-panel-store-dev does not depend on libomx-panel-store0 at the same version');
  // floors only between our packages (#113): the domain package is a floor of the same version, never an exact pin
  for (const pkg of ['libomx-panel-store0', 'omx-panel-store']) {
    if (st[pkg] && !/omx-panel-contract \(>= \$\{source:Version\}\)/.test(st[pkg])) errors.push(`debian/control: ${pkg} does not depend on omx-panel-contract (>= \${source:Version}) (a floor, not an exact pin)`);
    if (st[pkg] && /omx-panel-contract \(= /.test(st[pkg])) errors.push(`debian/control: ${pkg} pins omx-panel-contract exactly`);
  }
  if (!/^Requires: omx-panel-contract >= %\{version\}-%\{release\}$/m.test(specSection(spec, '%package -n omx-panel-store')?.join('\n') ?? ''))
    errors.push('spec: omx-panel-store does not require omx-panel-contract >= %{version}-%{release} (a floor, not an exact pin)');
  const bd = /^Build-Depends:([\s\S]*?)(?=^\S)/m.exec(control)?.[1] ?? '';
  if (!bd.includes(`libsqlite3-dev (>= ${SQLITE_FLOOR}~)`)) errors.push(`debian/control: no Build-Depends libsqlite3-dev (>= ${SQLITE_FLOOR}~)`);
  const rules = read('debian/rules');
  if (!/\$\(MAKE\) -C store\b/.test(target(rules, 'override_dh_auto_build') ?? '')) errors.push('debian/rules: the build does not build store/');
  if (!/\$\(MAKE\) install-store DESTDIR=\$\(CURDIR\)\/debian\/tmp\b/.test(target(rules, 'override_dh_auto_install') ?? ''))
    errors.push('debian/rules: the install does not run make install-store into debian/tmp');

  // the Makefiles: install-store installs store/'s install, which carries every file
  if (!/\$\(MAKE\) -C store install\b/.test(target(read('Makefile'), 'install-store') ?? '')) errors.push('Makefile: no install-store running make -C store install');
  const storeInstall = target(read('store/Makefile'), 'install') ?? '';
  for (const f of STORE_INSTALLS) if (!storeInstall.includes(f)) errors.push(`store/Makefile: install does not install ${f}`);
  if (!existsSync(join(root, 'man/omx-panel-store.1'))) errors.push('man/omx-panel-store.1: absent');

  // the release publishes each package; the CI build copies each out for the package check
  const release = read('.github/workflows/release.yml');
  const names = (re) => (re.exec(release)?.[1] ?? '').split(/\s+/);
  const rpmNames = names(/uses: \S*build-rpm\.yml[\s\S]*?binary-names: ([^\n]*)/);
  const debNames = names(/uses: \S*build-deb\.yml[\s\S]*?binary-names: ([^\n]*)/);
  for (const p of Object.keys(SPEC_FILES)) if (!rpmNames.includes(p)) errors.push(`release.yml: the RPM binary-names lack ${p}`);
  for (const p of Object.keys(DEB_FILES)) if (!debNames.includes(p)) errors.push(`release.yml: the DEB binary-names lack ${p}`);
  const ci = read('.github/workflows/ci.yml');
  for (const p of Object.keys(SPEC_FILES)) if (!ci.includes(`~/rpmbuild/RPMS/*/${p}-[0-9]*.rpm`)) errors.push(`ci.yml: the RPM build does not copy ${p} out`);
  for (const p of Object.keys(DEB_FILES)) if (!ci.includes(`/b/${p}_*.deb`)) errors.push(`ci.yml: the DEB build does not copy ${p} out`);
  if (!/tools\/store-package-check\.sh --self-test out\/\S*rpm/.test(ci) || !/tools\/store-package-check\.sh --self-test out\/\S*deb/.test(ci))
    errors.push('ci.yml: the built packages are not read by tools/store-package-check.sh (rpm and deb)');
  return errors;
}

test('the store is packaged: the library, its command and its development files, in the spec and in debian', () => {
  assert.deepEqual(storePackagingErrors(ROOT), []);
});

/** A copy of the packaging the check reads, with `edit(dir)` applied; the errors it gives. */
function sabotaged(edit) {
  const dir = mkdtempSync(join(tmpdir(), 'store-packaging-'));
  try {
    for (const d of ['packaging', 'debian', 'man', '.github']) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
    for (const f of ['Makefile', 'store/Makefile']) cpSync(join(ROOT, f), join(dir, f));
    edit(dir);
    return storePackagingErrors(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const rewrite = (dir, rel, fn) => writeFileSync(join(dir, rel), fn(readFileSync(join(dir, rel), 'utf8')));

test('sabotage: the store dropped from the spec is red', () => {
  const errs = sabotaged((d) => rewrite(d, 'packaging/omx-panel.spec', (s) =>
    s.replace(/^%package -n omx-panel-store\n[\s\S]*?(?=^%package -n omx-panel-store-devel)/m, '').replace(/^%files -n omx-panel-store\n[\s\S]*?(?=^%files -n omx-panel-store-devel)/m, '')));
  assert.ok(errs.includes('spec: no %package -n omx-panel-store'), errs.join('\n'));
  assert.ok(errs.includes('spec: no %files -n omx-panel-store'), errs.join('\n'));
});

test('sabotage: a file dropped from a spec %files is red', () => {
  const errs = sabotaged((d) => rewrite(d, 'packaging/omx-panel.spec', (s) => s.replace('%{_datadir}/omx-panel-store/panel.sql\n', '')));
  assert.deepEqual(errs, ['spec: %files -n omx-panel-store-devel does not carry %{_datadir}/omx-panel-store/panel.sql']);
});

test('sabotage: the store dropped from debian/control is red', () => {
  const errs = sabotaged((d) => rewrite(d, 'debian/control', (s) => s.replace(/^Package: libomx-panel-store0\n[\s\S]*?(?=\n\n)/m, '')));
  assert.ok(errs.includes('debian/control: no Package: libomx-panel-store0'), errs.join('\n'));
});

test('sabotage: an install file dropped is red', () => {
  const errs = sabotaged((d) => rmSync(join(d, 'debian/libomx-panel-store-dev.install')));
  assert.deepEqual(errs, ['debian/libomx-panel-store-dev.install: absent or empty']);
});

test('sabotage: the SQLite floor dropped from one side is red', () => {
  const errs = sabotaged((d) => rewrite(d, 'debian/control', (s) => s.replace(`libsqlite3-dev (>= ${SQLITE_FLOOR}~)`, 'libsqlite3-dev')));
  assert.deepEqual(errs, [`debian/control: no Build-Depends libsqlite3-dev (>= ${SQLITE_FLOOR}~)`]);
});

test('sabotage: panel.sql dropped from store/Makefile install, or a package from the release, is red', () => {
  assert.deepEqual(sabotaged((d) => rewrite(d, 'store/Makefile', (s) => s.replace(/^.*\.\.\/schema\/panel\.sql \$\(DESTDIR\).*\n/m, ''))),
    ['store/Makefile: install does not install ../schema/panel.sql']);
  assert.deepEqual(sabotaged((d) => rewrite(d, '.github/workflows/release.yml', (s) => s.replace(' libomx-panel-store-dev', ''))),
    ['release.yml: the DEB binary-names lack libomx-panel-store-dev']);
});
