// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Where tools/vocabulary.mjs finds the contract directory: $OMX_CONTRACT_PATH (a `:` list, the first holding a package
// wins), else omx-contract's pkg-config `contractdir`, else /usr/share/omx-contract/contract.d, the directory
// omx-contract-data installs with no omx-contract.pc. Each case runs in its own process, its environment set, and
// `omx-panel vocabulary` reads each source from where the lookup puts it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VOCABULARY = join(ROOT, 'dist/tools/vocabulary.mjs');
const NO_PKG_CONFIG = '/nonexistent/pkg-config';

/** The environment of a case: none of the lookup's variables but those given. */
function envOf(set) {
  const env = { ...process.env };
  for (const k of ['OMX_CONTRACT_PATH', 'OMX_CONTRACT_SCHEMA', 'PKG_CONFIG']) delete env[k];
  return { ...env, ...set };
}

/** The value of `expr` over the module's exports `v`, evaluated in a process with `set` as its lookup environment. */
function lookup(expr, set) {
  const code = `const v = await import(${JSON.stringify(VOCABULARY)}); process.stdout.write(JSON.stringify(${expr}));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: envOf(set) });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

/** A directory under the system's temporary directory, removed when this file's tests end. */
const made = [];
function scratch(prefix) {
  const dir = mkdtempSync(prefix);
  made.push(dir);
  return dir;
}
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const command = (args, set) => spawnSync(process.execPath, [join(ROOT, 'dist/bin/omx-panel.mjs'), 'vocabulary', ...args], { encoding: 'utf8', env: envOf(set) });

/** A contract directory holding `pkgs`: { <package>: { <relative file>: <json> } }. */
function contractDir(pkgs) {
  const dir = scratch(join(tmpdir(), 'omx-panel-contract-'));
  for (const [pkg, files] of Object.entries(pkgs)) {
    for (const [rel, body] of Object.entries(files)) {
      const file = join(dir, '3', pkg, rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(body));
    }
  }
  return dir;
}

/** omx-contract's param domain with `units` ([id, symbol, dimension]) and, when given, the served set `served` (the ids of
 * PARAM_UNITS_CLAP_ENCODED), written into contract directory `dir`. */
function paramDomain(dir, units, served) {
  mkdirSync(join(dir, 'param'), { recursive: true });
  const oneOf = units.map(([id, symbol, dimension]) => ({ const: id, title: id, 'x-symbol': symbol, 'x-dimension': dimension }));
  const schemas = { PARAM_UNITS: { oneOf } };
  if (served) schemas.PARAM_UNITS_CLAP_ENCODED = { 'x-kind': 'words', oneOf: served.map((id, i) => ({ const: id, title: id, 'x-code': i })) };
  writeFileSync(join(dir, 'param', 'param.json'), JSON.stringify({ components: { schemas } }));
  return dir;
}
const DESCRIPTOR = { controls: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };

test('no $OMX_CONTRACT_PATH and no pkg-config: the directory omx-contract-data installs', () => {
  assert.deepEqual(lookup('v.contractDirs()', { PKG_CONFIG: NO_PKG_CONFIG }), ['/usr/share/omx-contract/contract.d']);
  assert.equal(lookup('v.contractDataDir()', { PKG_CONFIG: NO_PKG_CONFIG }), '/usr/share/omx-contract');
  assert.equal(lookup('v.contractSchemaFile()', { PKG_CONFIG: NO_PKG_CONFIG }), '/usr/share/omx-contract/omx-contract.schema.json');
});

test('pkg-config, where omx-contract.pc is installed, names the directories', () => {
  const bin = scratch(join(tmpdir(), 'omx-panel-pc-'));
  const fake = join(bin, 'pkg-config');
  writeFileSync(fake, '#!/bin/sh\ncase "$1 $2" in\n  "--variable=contractdir omx-contract") echo /pc/contract.d ;;\n  "--variable=datadir omx-contract") echo /pc/data ;;\n  *) exit 1 ;;\nesac\n');
  chmodSync(fake, 0o755);
  assert.deepEqual(lookup('v.contractDirs()', { PKG_CONFIG: fake }), ['/pc/contract.d']);
  assert.equal(lookup('v.contractDataDir()', { PKG_CONFIG: fake }), '/pc/data');
  assert.deepEqual(lookup('v.contractDirs()', { PKG_CONFIG: fake, OMX_CONTRACT_PATH: '/env/a:/env/b' }), ['/env/a', '/env/b'], '$OMX_CONTRACT_PATH comes before pkg-config');
});

test('$OMX_CONTRACT_PATH: the first directory that holds a package is the one read', () => {
  const a = contractDir({ 'omx-plugins': { 'plugins/omx-delay.json': DESCRIPTOR } });
  const b = paramDomain(contractDir({ 'omx-plugins': { 'plugins/omx-delay.json': DESCRIPTOR, 'plugins/omx-comp.json': DESCRIPTOR } }), [['dB', 'dB', 'gain'], ['Hz', 'Hz', 'frequency']]);
  const set = { OMX_CONTRACT_PATH: `${a}:${b}`, PKG_CONFIG: NO_PKG_CONFIG };
  assert.equal(lookup('v.paramDomainFile()', set), join(b, 'param/param.json'));
  assert.equal(lookup(`v.installedDescriptorFile('omx-plugins/omx-delay')`, set), join(a, '3/omx-plugins/plugins/omx-delay.json'));
  assert.equal(lookup(`v.installedDescriptorFile('omx-plugins/omx-comp')`, set), join(b, '3/omx-plugins/plugins/omx-comp.json'));
  assert.deepEqual(lookup('[...v.standardUnits()]', set), [['dB', { symbol: 'dB', dimension: 'gain' }], ['Hz', { symbol: 'Hz', dimension: 'frequency' }]]);
});

test('omx-panel vocabulary reads each source where the lookup puts it, and fails on one that is missing', () => {
  const dir = paramDomain(contractDir({ 'omx-plugins': { 'plugins/omx-delay.json': DESCRIPTOR } }), [['none', '', 'none'], ['dB', 'dB', 'gain'], ['dBu', 'dBu', 'level']], ['none', 'dB', 'dBu']);
  const schema = join(dir, 'omx-contract.schema.json');
  writeFileSync(schema, JSON.stringify({ $defs: { meaning: { enum: ['gain', 'delay', 'unknown'] } } }));
  const set = { OMX_CONTRACT_PATH: dir, OMX_CONTRACT_SCHEMA: schema, PKG_CONFIG: NO_PKG_CONFIG };
  const r = command(['omx-plugins/omx-delay'], set);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`^ok   contractdir ${dir}$`, 'm'));
  assert.match(r.stdout, /^ok   meanings 2 from /m);
  assert.match(r.stdout, new RegExp(`^ok   param-units 3 units from ${join(dir, 'param/param.json')}$`, 'm'));
  assert.match(r.stdout, new RegExp(`^ok   clap-encoded 3 units from ${join(dir, 'param/param.json')}$`, 'm'));
  assert.match(r.stdout, new RegExp(`^ok   descriptor omx-plugins/omx-delay 3 controls from ${join(dir, '3/omx-plugins/plugins/omx-delay.json')}$`, 'm'));
  const missing = command(['omx-plugins/omx-nothing'], set);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /^FAIL descriptor omx-plugins\/omx-nothing vocabulary: no descriptor omx-plugins\/omx-nothing is installed/m);
});

test('the standard units are omx-contract\'s param domain: ids, symbols and dimensions', () => {
  const dir = paramDomain(contractDir({ 'omx-plugins': { 'plugins/omx-delay.json': DESCRIPTOR } }), [['none', '', 'none'], ['dB', 'dB', 'gain'], ['percent', '%', 'none'], ['dBu', 'dBu', 'level']]);
  const set = { OMX_CONTRACT_PATH: dir, PKG_CONFIG: NO_PKG_CONFIG };
  assert.equal(lookup('v.paramDomainFile()', set), join(dir, 'param/param.json'));
  assert.deepEqual(lookup(`['none', 'dB', 'percent', 'dBu', 'furlong'].map((u) => v.unitIdOf(u) ?? null)`, set), ['none', 'dB', 'percent', 'dBu', null]);
  // C2: the descriptor's word is the id; a symbol is no word (`%`, `""`), and the symbol is what a face shows a person
  assert.deepEqual(lookup(`['%', ''].map((u) => v.unitIdOf(u) ?? null)`, set), [null, null]);
  assert.deepEqual(lookup(`['percent', 'none', 'dB', 'furlong'].map((u) => v.unitSymbolOf(u))`, set), ['%', '', 'dB', 'furlong']);
  assert.deepEqual(lookup(`v.unitsOfDimensions(['gain', 'level'])`, set), ['dB', 'dBu']);
  // a directory with no param domain has no units: the read refuses and names the fix
  const none = contractDir({ 'omx-plugins': { 'plugins/omx-delay.json': DESCRIPTOR } });
  const r = command([], { OMX_CONTRACT_PATH: none, PKG_CONFIG: NO_PKG_CONFIG });
  assert.match(r.stdout, /^FAIL param-units .*install omx-contract-data$/m);
});

test('a unit is served when omx-contract\'s PARAM_UNITS_CLAP_ENCODED holds its id, and nothing else serves it', () => {
  const units = [['none', '', 'none'], ['dB', 'dB', 'gain'], ['dBu', 'dBu', 'level'], ['dBFS', 'dBFS', 'level']];
  const dir = paramDomain(contractDir({ 'omx-plugins': { 'plugins/omx-delay.json': DESCRIPTOR } }), units, ['none', 'dB', 'dBFS']);
  const set = { OMX_CONTRACT_PATH: dir, PKG_CONFIG: NO_PKG_CONFIG };
  assert.deepEqual(lookup(`['none', 'dB', 'dBFS', 'dBu', 'furlong'].map((id) => v.servedUnit(id))`, set), [true, true, true, false, false]);
  assert.deepEqual(lookup('[...v.clapEncoded()]', set), ['none', 'dB', 'dBFS']);
  // a param domain with no served set serves nothing: the read refuses and names the fix
  const none = paramDomain(contractDir({ 'omx-plugins': { 'plugins/omx-delay.json': DESCRIPTOR } }), units);
  const r = command([], { OMX_CONTRACT_PATH: none, PKG_CONFIG: NO_PKG_CONFIG });
  assert.match(r.stdout, /^FAIL clap-encoded .*install omx-contract-data$/m);
});

test('a package reached through a symlink is read like one installed in place', () => {
  // a composed contract directory links the installed packages beside a tree's own (omx-plugins' round trip and its
  // gen --check arms, Open-Mixer/omx-plugins#98): its items are the installed ones, found through the link
  const roles = { OMX_PLUGINS_ROLE_MEANINGS: { kind: 'roleMeanings', roles: { threshold: { role: 'threshold', meaning: 'threshold' } } } };
  const installed = contractDir({ 'omx-plugins': { 'role-meanings.json': roles, 'plugins/omx-delay.json': DESCRIPTOR } });
  const composed = scratch(join(tmpdir(), 'omx-panel-composed-'));
  mkdirSync(join(composed, '3'));
  for (const pkg of ['omx-plugins']) symlinkSync(join(installed, '3', pkg), join(composed, '3', pkg));
  // the role meanings read through the composed directory, not from a file $OMX_ROLE_MEANINGS names (CI sets it)
  const set = { OMX_CONTRACT_PATH: composed, PKG_CONFIG: NO_PKG_CONFIG, OMX_ROLE_MEANINGS: '' };
  assert.deepEqual(lookup('[...v.roleMeanings().keys()]', set), ['threshold']);
  assert.deepEqual(lookup('v.installedDescriptorFiles()', set), [join(composed, '3/omx-plugins/plugins/omx-delay.json')]);
});

test('an install with omx-contract-data and no omx-contract.pc reads its schema from the default directory', { skip: !existsSync('/usr/share/omx-contract/omx-contract.schema.json') && 'omx-contract-data is not installed' }, () => {
  const r = command([], { PKG_CONFIG: NO_PKG_CONFIG });
  assert.match(r.stdout, /^ok   contractdir \/usr\/share\/omx-contract\/contract\.d$/m);
  assert.match(r.stdout, /^ok   meanings \d+ from \/usr\/share\/omx-contract\/omx-contract\.schema\.json$/m);
});

test('omx-panel descriptors --installed lists each installed descriptor, whatever the contract major', () => {
  const dir = scratch(join(tmpdir(), 'omx-panel-contract-'));
  const put = (rel) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), JSON.stringify(DESCRIPTOR));
    return join(dir, rel);
  };
  const a = put('7/omx-plugins/plugins/omx-delay.json');
  const b = put('7/omx-dsp/plugins/omx-eq.json');
  put('7/omx-dsp/formats/lv2.json');
  const old = put('3/omx-plugins/plugins/omx-delay.json');
  const r = spawnSync(process.execPath, [join(ROOT, 'dist/bin/omx-panel.mjs'), 'descriptors', '--installed'], { encoding: 'utf8', env: envOf({ OMX_CONTRACT_PATH: dir }) });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.split('\n').filter(Boolean), [b, a].sort());
  assert.ok(!r.stdout.includes(old));
  assert.equal(spawnSync(process.execPath, [join(ROOT, 'dist/bin/omx-panel.mjs'), 'descriptors'], { encoding: 'utf8' }).status, 2);
});

test('a reader that stops early ends the listing quietly: exit 0, no stack trace (#42)', () => {
  const dir = scratch(join(tmpdir(), 'omx-panel-contract-'));
  for (let i = 0; i < 3000; i++) {
    const rel = `7/omx-plugins/plugins/omx-plugin-with-a-long-name-${i}.json`;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), JSON.stringify(DESCRIPTOR));
  }
  const r = spawnSync('bash', ['-c', 'set -o pipefail; "$0" "$1" descriptors --installed | head -n1', process.execPath, join(ROOT, 'dist/bin/omx-panel.mjs')], { encoding: 'utf8', env: envOf({ OMX_CONTRACT_PATH: dir }) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout.split('\n').filter(Boolean).length, 1);
});
