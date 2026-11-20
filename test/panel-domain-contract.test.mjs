// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The panel domain as its owner ships it (omx-contract docs/consumer-move.md): a conforming document in the one
// formatting, no vocabulary render and no codes header (no C code switches on a panel word), installed by
// omx-contract's domain installer where the loader reads it, and packaged alone in omx-panel-contract.
// The installed omx-contract (validate, fmt) and omx-domain (the C loader) commands run, or OMX_CONTRACT_CLI and
// OMX_DOMAIN_CLI name others (a checkout's); a missing command is red by name, never skipped.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOMAIN = join(ROOT, 'contract.d/panel');
const doc = JSON.parse(readFileSync(join(DOMAIN, 'panel.json'), 'utf8'));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** The command `name` names, split on spaces (`node /x/omx-contract.mjs`), else the installed `installed`. */
const command = (name, installed) => (process.env[name] || installed).split(' ');

function run(argv, opts = {}) {
  const [cmd, ...args] = argv;
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
  assert.equal(r.error, undefined, `${cmd} could not run (${r.error?.code}): install it or name it in the environment`);
  return r;
}

test('the document conforms: its $schema, $id, owner and stability, every item prefixed PANEL_', () => {
  assert.equal(doc.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(doc.$id, 'https://openmixer.org/contract/panel');
  assert.equal(doc.info['x-owner'], 'omx-panel');
  assert.equal(doc.info['x-stability'], 'experimental');
  for (const item of Object.keys(doc.components.schemas)) assert.match(item, /^PANEL_/);
  const r = run([...command('OMX_CONTRACT_CLI', 'omx-contract'), 'validate', '--contract-dir', 'contract.d']);
  assert.equal(r.status, 0, `omx-contract validate refused the domain:\n${r.stdout}${r.stderr}`);
});

test('the document is in the one formatting (omx-contract fmt --check)', () => {
  const r = run([...command('OMX_CONTRACT_CLI', 'omx-contract'), 'fmt', '--check', '--contract-dir', 'contract.d']);
  assert.equal(r.status, 0, `omx-contract fmt --check:\n${r.stdout}${r.stderr}`);
});

test('no vocabulary render of the domain exists or is named; the one item C reads by code is marked x-c-codes, and no other', () => {
  assert.equal(existsSync(join(ROOT, 'include/omxdomain')), false, 'include/omxdomain/ still holds a render');
  const named = run(['git', 'grep', '-l', '-e', 'panel_vocabulary', '-e', 'omxdomain/', '--', '.', ':!CHANGELOG.md', ':!debian/changelog', ':!test/panel-domain-contract.test.mjs']);
  assert.equal(named.stdout, '', `files still name the vocabulary render:\n${named.stdout}`);
  // the store's refusals are codes (docs/descriptions-store.md, section 5); no C code switches on another panel word
  for (const [item, s] of Object.entries(doc.components.schemas)) {
    assert.equal(s['x-c-codes'], item === 'PANEL_STORE_CODES' ? true : undefined, `${item}: x-c-codes`);
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
  const words = doc.components.schemas.PANEL_PLACEMENTS.oneOf.map((e) => e.const);
  const o = run([...command('OMX_DOMAIN_CLI', 'omx-domain'), 'panel', doc.info.version, 'PANEL_PLACEMENTS'], {
    env: { ...process.env, OMX_CONTRACT_PATH: join(dest, 'contract.d') },
  });
  assert.equal(o.status, 0, `omx-domain could not open the installed domain:\n${o.stdout}${o.stderr}`);
  for (const w of words) assert.match(o.stdout, new RegExp(`\\b${w}\\b`), `the loader did not list ${w}`);
});

test('the domain ships alone in omx-panel-contract: noarch in the rpm, Architecture all in debian', () => {
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
  assert.deepEqual(lines, ['usr/share/omx-contract/contract.d/panel/', 'usr/share/omx-contract/contract.d/readout/']);
});
