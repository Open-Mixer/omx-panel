// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The panel domain as its owner ships it (omx-contract docs/consumer-move.md): a conforming document in the one
// formatting, one codes header (include/omxdomain/panel_codes.h, omx-contract render, for the renderer's widget table and
// the plugin ABI, row V1), no other render, installed by
// omx-contract's domain installer where the loader reads it, and packaged alone in omx-panel-contract.
// The installed omx-contract (validate, fmt) and omx-domain (the C loader) commands run, or OMX_CONTRACT_CLI and
// OMX_DOMAIN_CLI name others (a checkout's); a missing command is red by name, never skipped. The omx-contract CLI is the
// installed package's by its path, /usr/lib/omx-contract/bin/omx-contract.mjs, never a PATH lookup: under `npm test` the
// PATH starts with node_modules/.bin, whose omx-contract is the npm devDependency (3.20.2 on wave f45s), older than the
// packages' floor, and it refused the gestures domain's sheet items that 3.21.0 reads. The CLI that runs is held at or
// above the floor the spec states.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareVersions, packagingFloor } from './packaging-floors.mjs';
import { treeGrep } from './tree-grep.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOMAIN = join(ROOT, 'contract.d/panel');
const doc = JSON.parse(readFileSync(join(DOMAIN, 'panel.json'), 'utf8'));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** The command `name` names, split on spaces (`node /x/omx-contract.mjs`), else the installed `installed`. */
const command = (name, installed) => (process.env[name] || installed).split(' ');
/** The installed omx-contract CLI, where the omx-contract package puts it (%check and debian/rules name the same path). */
const INSTALLED_CONTRACT_CLI = '/usr/lib/omx-contract/bin/omx-contract.mjs';
const contractCli = () => command('OMX_CONTRACT_CLI', INSTALLED_CONTRACT_CLI);

function run(argv, opts = {}) {
  const [cmd, ...args] = argv;
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
  assert.equal(r.error, undefined, `${cmd} could not run (${r.error?.code}): install it or name it in the environment`);
  return r;
}

test('the omx-contract CLI this suite runs is the package at or above the floor the spec states', () => {
  const script = contractCli().find((a) => a.endsWith('.mjs'));
  assert.ok(script, `${contractCli().join(' ')} names no omx-contract.mjs: the version cannot be read`);
  const pkg = join(dirname(script), '..', 'package.json');
  assert.ok(existsSync(pkg), `${pkg} is absent: install omx-contract or name a checkout's CLI in OMX_CONTRACT_CLI`);
  const { name, version } = JSON.parse(readFileSync(pkg, 'utf8'));
  assert.equal(name, '@openmixer/omx-contract', `${pkg} is not omx-contract's`);
  const floor = packagingFloor('omx-contract');
  assert.ok(compareVersions(version, floor) >= 0, `${script} is omx-contract ${version}, below the packages' floor ${floor}`);
});

test('the document conforms: its $schema, $id, owner and stability, every item prefixed PANEL_', () => {
  assert.equal(doc.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(doc.$id, 'https://openmixer.org/contract/panel');
  assert.equal(doc.info['x-owner'], 'omx-panel');
  assert.equal(doc.info['x-stability'], 'experimental');
  for (const item of Object.keys(doc.components.schemas)) assert.match(item, /^PANEL_/);
  const r = run([...contractCli(), 'validate', '--contract-dir', 'contract.d']);
  assert.equal(r.status, 0, `omx-contract validate refused the domain:\n${r.stdout}${r.stderr}`);
});

test('the document is in the one formatting (omx-contract fmt --check)', () => {
  const r = run([...contractCli(), 'fmt', '--check', '--contract-dir', 'contract.d']);
  assert.equal(r.status, 0, `omx-contract fmt --check:\n${r.stdout}${r.stderr}`);
});

test('one render of the domain: omxdomain/panel_codes.h, what omx-contract render gives; the items C reads by code are marked x-c-codes, the six word items x-c-xmacro too, and no other', (t) => {
  const out = mkdtempSync(join(tmpdir(), 'omx-panel-codes-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const r = run([...contractCli(), 'render', '--target', 'c', '--out', out, '--contract-dir', 'contract.d', '--package', 'panel']);
  assert.equal(r.status, 0, `omx-contract render:\n${r.stdout}${r.stderr}`);
  assert.deepEqual(readdirSync(out), ['panel_codes.h']);
  assert.equal(read('include/omxdomain/panel_codes.h'), readFileSync(join(out, 'panel_codes.h'), 'utf8'), 'include/omxdomain/panel_codes.h is not what omx-contract render gives: re-render it');
  assert.deepEqual(readdirSync(join(ROOT, 'include/omxdomain')), ['panel_codes.h']);
  // read from the files: git grep, refused (no .git in a package build, a checkout another user owns in CI), printed
  // nothing on stdout and so passed whatever the tree named
  const named = treeGrep(ROOT, /panel_vocabulary/, ['.'], ['CHANGELOG.md', 'debian/changelog', 'test/panel-domain-contract.test.mjs']);
  assert.equal(named, '', `files still name a vocabulary render:\n${named}`);
  const WORDS = ['PANEL_FAMILIES', 'PANEL_STANDARD_WIDGETS', 'PANEL_WIDGETS', 'PANEL_DISPLAY_KINDS', 'PANEL_DISPLAY_SOURCES', 'PANEL_PLACEMENTS'];
  for (const [item, s] of Object.entries(doc.components.schemas)) {
    assert.equal(s['x-c-codes'], item === 'PANEL_STORE_CODES' || WORDS.includes(item) ? true : undefined, `${item}: x-c-codes`);
    assert.equal(s['x-c-xmacro'], WORDS.includes(item) ? true : undefined, `${item}: x-c-xmacro`);
  }
});

test('make install-contract installs the domain as it is, by omx-contract\'s domain installer, where the loader opens it', (t) => {
  const dest = mkdtempSync(join(tmpdir(), 'omx-panel-domain-'));
  t.after(() => rmSync(dest, { recursive: true, force: true }));
  const r = run(['make', '-s', 'install-contract', `DESTDIR=${dest}`, 'CONTRACTDIR=/contract.d']);
  assert.equal(r.status, 0, `make install-contract:\n${r.stdout}${r.stderr}`);
  const installed = join(dest, 'contract.d/panel');
  assert.deepEqual(readdirSync(installed).sort(), ['catalogs', 'panel.json']);
  assert.equal(readFileSync(join(installed, 'panel.json'), 'utf8'), readFileSync(join(DOMAIN, 'panel.json'), 'utf8'));
  for (const c of readdirSync(join(DOMAIN, 'catalogs'))) {
    assert.equal(readFileSync(join(installed, 'catalogs', c), 'utf8'), readFileSync(join(DOMAIN, 'catalogs', c), 'utf8'), c);
  }
  // the gestures domain is installed beside it, byte for byte, its catalogs with it (docs/contract-domains.md)
  assert.deepEqual(readdirSync(join(dest, 'contract.d/gestures')).sort(), ['catalogs', 'gestures.json']);
  assert.equal(readFileSync(join(dest, 'contract.d/gestures/gestures.json'), 'utf8'), readFileSync(join(ROOT, 'contract.d/gestures/gestures.json'), 'utf8'));
  for (const c of readdirSync(join(ROOT, 'contract.d/gestures/catalogs'))) {
    assert.equal(readFileSync(join(dest, 'contract.d/gestures/catalogs', c), 'utf8'), readFileSync(join(ROOT, 'contract.d/gestures/catalogs', c), 'utf8'), c);
  }
  const words = doc.components.schemas.PANEL_PLACEMENTS.oneOf.map((e) => e.const);
  const o = run([...command('OMX_DOMAIN_CLI', 'omx-domain'), 'panel', doc.info.version, 'PANEL_PLACEMENTS'], {
    env: { ...process.env, OMX_CONTRACT_PATH: join(dest, 'contract.d') },
  });
  assert.equal(o.status, 0, `omx-domain could not open the installed domain:\n${o.stdout}${o.stderr}`);
  for (const w of words) assert.match(o.stdout, new RegExp(`\\b${w}\\b`), `the loader did not list ${w}`);
});

test('the domain and its codes header ship alone in omx-panel-contract: noarch in the rpm, Architecture all in debian', () => {
  const spec = read('packaging/omx-panel.spec');
  assert.match(spec, /^%package contract$/m);
  const contractPkg = spec.slice(spec.indexOf('%package contract'));
  assert.match(contractPkg.slice(0, contractPkg.indexOf('%description contract')), /^BuildArch:\s+noarch$/m);
  assert.match(spec, /^%files contract\n(?:.*\n)*?%\{omx_contract_domain_dir\}\/panel\/$/m);
  const main = spec.indexOf('\n%files\n') + 1;
  const mainFiles = spec.slice(main, spec.indexOf('\n%files ', main));
  assert.doesNotMatch(mainFiles, /contract\.d|omx_contract_domain_dir/, 'the main package still lists the domain');
  const control = read('debian/control');
  assert.match(control, /^Package: omx-panel-contract\nArchitecture: all$/m);
  const lines = read('debian/omx-panel-contract.install').split('\n').filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(lines, ['usr/share/omx-contract/contract.d/gestures/', 'usr/share/omx-contract/contract.d/panel/', 'usr/include/omxdomain/panel_codes.h']);
  assert.match(spec, /^%files contract\n(?:.*\n)*?%\{_includedir\}\/omxdomain\/panel_codes\.h$/m);
  assert.doesNotMatch(mainFiles, /omxdomain/, 'the main package lists the codes header');
});
