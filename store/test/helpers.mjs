// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * Fixtures for the descriptions store's tests (docs/descriptions-store.md): a contract directory the loader opens
 * (this tree's panel domain and a fixture plugin-db domain), stores built straight from schema/panel.sql with node's
 * SQLite so a test can make a state the writer never would, and the command `omx-panel-store` run over them.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STORE = join(ROOT, 'store');
export const CMD = process.env.OMX_PANEL_STORE_TEST_CMD || join(STORE, 'build', 'omx-panel-store');
export const LIB = join(STORE, 'build', 'libomx-panel-store.so.0');
// a sabotage arm names a schema with one rule dropped
const SCHEMA = readFileSync(process.env.OMX_PANEL_STORE_TEST_SCHEMA || join(ROOT, 'schema', 'panel.sql'), 'utf8');

const { DatabaseSync } = await import('node:sqlite');
export { DatabaseSync };

export const hex = (c) => c.repeat(64);
export const tmp = (t, prefix = 'omx-panel-store-') => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};

const word = (code, i) => ({ const: code, title: code, description: code, 'x-code': i, 'x-text': code });
/** A contract directory: this tree's panel domain as it is, and a plugin-db domain holding the address formats `formats`. */
export function contractDir(dir, { formats = ['clap', 'lv2'] } = {}) {
  cpSync(join(ROOT, 'contract.d', 'panel'), join(dir, 'panel'), { recursive: true });
  mkdirSync(join(dir, 'plugin-db'), { recursive: true });
  writeFileSync(join(dir, 'plugin-db', 'plugin-db.json'), JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://openmixer.org/contract/plugin-db',
    info: { title: 'The plugin-db fixture', version: '1.0.0', 'x-owner': 'plugin-db', 'x-stability': 'experimental' },
    components: { schemas: { PLUGIN_DB_ADDRESS_FORMATS: { description: 'The address formats.', 'x-since': '1.0.0', oneOf: formats.map(word) } } },
  }, null, 2));
  return dir;
}
export const panelVersion = (dir) => JSON.parse(readFileSync(join(dir, 'panel', 'panel.json'), 'utf8')).info.version;

export const WORD_CHECKS = [
  ['plugin', 'format', 'plugin-db', 'PLUGIN_DB_ADDRESS_FORMATS'],
  ['description', 'family', 'panel', 'PANEL_FAMILIES'],
  ['description', 'refused', 'panel', 'PANEL_DESCRIBE_CODES'],
  ['port_group_verdict', 'outcome', 'panel', 'PANEL_GROUP_OUTCOMES'],
  ['port_group_verdict', 'reason', 'panel', 'PANEL_GROUP_REASONS'],
  ['port_group', 'rule', 'panel', 'PANEL_GROUP_RULES'],
];

/** One entry as a test states it; what a field leaves out is a plausible default. */
export function entry(o = {}) {
  const e = {
    sha: hex('a'), format: 'lv2', uri: 'urn:test:plugin', edited: 0, made_by: 'omx-panel test', rules: 1, source: hex('1'),
    family: 'eq', fingerprint: hex('f'), body: { family: 'eq', sections: [] }, groups: { repeated: [] }, refused: null,
    controls: [], verdict: null, ...o,
  };
  if (e.refused !== null) { e.body = null; e.groups = null; }
  return e;
}
export const grouped = (rule = 'name', extra = {}) => ({
  outcome: 'grouped', reason: null,
  groups: [{ symbol: 'band1', name: 'Band 1', display_priority: 1, rule, declared: 0, ports: ['gain1', 'freq1'], ...extra }],
});

/**
 * A store file built from schema/panel.sql. `layer` 0 base, 1 system, 2 user; `version` the user_version it is left at;
 * `info` false leaves store_info empty. Words are not checked here: a test may store a family the domain lacks.
 */
export function mkStore(path, { layer = 0, version = 1, entries = [], domains, info = true, builtFrom, panel = '1.0.0' } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE');
  db.exec(SCHEMA);
  if (info) db.prepare('INSERT INTO store_info VALUES (1, ?, ?, ?)').run(layer, 'omx-panel.panel-description/1', layer === 0 ? (builtFrom ?? 'b'.repeat(40)) : null);
  for (const [d, v] of Object.entries(domains ?? { panel, 'plugin-db': '1.0.0' })) db.prepare('INSERT INTO store_domain VALUES (?, ?)').run(d, v);
  for (const w of WORD_CHECKS) db.prepare('INSERT INTO word_check VALUES (?, ?, ?, ?)').run(...w);
  for (const e of entries) addEntry(db, e);
  db.exec(`PRAGMA user_version = ${version}`);
  db.close();
  return path;
}

export function addEntry(db, e) {
  const q = (sql, ...a) => db.prepare(sql).run(...a);
  const id = Number(q('INSERT INTO plugin (sha256, format, uri) VALUES (?, ?, ?)', e.sha, e.format, e.uri).lastInsertRowid);
  q('INSERT INTO description VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, e.edited, e.made_by, e.rules, e.source, e.family, e.fingerprint,
    e.body === null ? null : JSON.stringify(e.body), e.groups === null ? null : JSON.stringify(e.groups), e.refused);
  e.controls.forEach((c, i) => q('INSERT INTO description_control VALUES (?, ?, ?, ?, ?, ?, ?)', id, i, c.symbol, c.key ?? c.symbol, c.id ?? c.symbol, c.group_key ?? null, c.governed ?? 0));
  if (e.verdict) {
    q('INSERT INTO port_group_verdict VALUES (?, ?, ?)', id, e.verdict.outcome, e.verdict.reason);
    for (const g of e.verdict.groups ?? []) {
      q('INSERT INTO port_group VALUES (?, ?, ?, ?, ?, ?)', id, g.symbol, g.name, g.display_priority, g.rule, g.declared);
      for (const p of g.ports) q('INSERT INTO port_group_member VALUES (?, ?, ?)', id, g.symbol, p);
    }
  }
}

/** The command's place flags for a fixture: `places` is { base, system, user, contract }. */
export const flags = (p, scope = 'user') => ['--scope', scope, '--base', p.base, '--system', p.system, '--user', p.user, '--contract-dir', p.contract];

/** The command, run with no inherited OMX_PANEL_STORE_* variable. */
export function run(args, { input, env = {} } = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !(k.startsWith('OMX_PANEL_STORE_') && k !== 'OMX_PANEL_STORE_TEST_CMD') && k !== 'OMX_CONTRACT_PATH'));
  const r = spawnSync(CMD, args, { encoding: 'utf8', input, env: { ...clean, ...env }, timeout: 20000 });
  if (r.error) throw new Error(`${CMD} could not run: ${r.error.code}: build it with make store`);
  return r;
}
export const keyFlags = (e, source = e.source) => ['--sha256', e.sha, '--format', e.format, '--uri', e.uri, '--source', source, '--json'];
/** `get` of a key: { code } on a refusal, else the parsed answer (null for no entry). */
export function get(p, e, { source, scope = 'user', rules } = {}) {
  const r = run(['get', ...flags(p, scope), ...keyFlags(e, source), ...(rules ? ['--rules', String(rules)] : [])]);
  if (r.status === 0) return { status: 0, answer: JSON.parse(r.stdout) };
  return { status: r.status, code: r.stderr.split(/\s/)[0], stderr: r.stderr };
}

/** Fixture places in a fresh directory: the three layers' paths (none created) and a contract directory. */
export function places(t) {
  const d = tmp(t);
  return { dir: d, base: join(d, 'share', 'panel.sqlite'), system: join(d, 'var', 'panel.sqlite'), user: join(d, 'home', 'panel.sqlite'), contract: contractDir(join(d, 'contract.d')) };
}

export function snapshot(path) {
  const s = statSync(path);
  return { size: s.size, mtime: s.mtimeMs, bytes: readFileSync(path).toString('base64'), dir: readdirSync(dirname(path)).sort() };
}
