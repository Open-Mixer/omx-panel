// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The descriptions store's reader (docs/descriptions-store.md, lane 1): three layers merged whole, scopes, one schema
 * version, the words checked against their domains, stale entries skipped. Every test runs the command `omx-panel-store`
 * (the reader and the writer in C, behind it) over fixture stores in a scratch directory.
 */
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync, entry, flags, get, grouped, hex, mkStore, panelVersion, places, run, snapshot } from './helpers.mjs';

const PV = (p) => panelVersion(p.contract);

test('an absent base is panel-store.absent, naming the file', (t) => {
  const p = places(t);
  const r = get(p, entry());
  assert.equal(r.status, 1);
  assert.equal(r.code, 'panel-store.absent');
  assert.match(r.stderr, new RegExp(p.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('an absent system layer and user layer are empty layers: the base answers and nothing is created', (t) => {
  const p = places(t);
  const e = entry();
  mkStore(p.base, { layer: 0, entries: [e], panel: PV(p) });
  const r = get(p, e);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.answer.layer, 'base');
  assert.equal(existsSync(p.system), false);
  assert.equal(existsSync(p.user), false);
});

test('a key no layer holds has no entry: null, exit 0', (t) => {
  const p = places(t);
  mkStore(p.base, { layer: 0, entries: [entry()], panel: PV(p) });
  const r = get(p, entry({ uri: 'urn:test:other' }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.answer, null);
});

test('a user entry hides the system entry and the base entry whole: its description and its groups', (t) => {
  const p = places(t);
  const base = entry({ family: 'eq', body: { from: 'base' }, verdict: grouped('name', { symbol: 'from_base' }) });
  const system = entry({ family: 'dynamics', body: { from: 'system' }, verdict: grouped('name', { symbol: 'from_system' }) });
  const user = entry({ family: 'filter', edited: 1, body: { from: 'user' }, verdict: null });
  mkStore(p.base, { layer: 0, entries: [base], panel: PV(p) });
  mkStore(p.system, { layer: 1, entries: [system], panel: PV(p) });
  mkStore(p.user, { layer: 2, entries: [user], panel: PV(p) });
  const r = get(p, user);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.answer.layer, 'user');
  assert.deepEqual(r.answer.body, { from: 'user' });
  assert.equal(r.answer.family, 'filter');
  // a user description with no verdict has no groups: the base's and the system's are not taken beside it
  assert.equal(r.answer.group_outcome, null);
  assert.deepEqual(r.answer.groups, []);
});

test('the system entry answers when the user layer lacks the key, the base when both lack it', (t) => {
  const p = places(t);
  const base = entry({ body: { from: 'base' } });
  const system = entry({ body: { from: 'system' } });
  const other = entry({ uri: 'urn:test:user-only' });
  mkStore(p.base, { layer: 0, entries: [base, entry({ uri: 'urn:test:base-only', body: { from: 'base-only' } })], panel: PV(p) });
  mkStore(p.system, { layer: 1, entries: [system], panel: PV(p) });
  mkStore(p.user, { layer: 2, entries: [other], panel: PV(p) });
  assert.equal(get(p, base).answer.layer, 'system');
  assert.equal(get(p, entry({ uri: 'urn:test:base-only' })).answer.layer, 'base');
  assert.equal(get(p, other).answer.layer, 'user');
});

test('the system scope reads the system layer and the base, and never the home', (t) => {
  const p = places(t);
  const e = entry({ body: { from: 'base' } });
  mkStore(p.base, { layer: 0, entries: [e], panel: PV(p) });
  mkStore(p.user, { layer: 2, entries: [entry({ body: { from: 'user' } })], panel: PV(p) });
  assert.equal(get(p, e, { scope: 'user' }).answer.layer, 'user');
  const sys = get(p, e, { scope: 'system' });
  assert.equal(sys.answer.layer, 'base');
  // and a user layer that is broken is not even opened under the system scope
  mkStore(p.user, { layer: 2, version: 7, panel: PV(p) });
  assert.equal(get(p, e, { scope: 'system' }).status, 0);
  assert.equal(get(p, e, { scope: 'user' }).code, 'panel-store.schema-mismatch');
});

test('the production open resolves the home from the password database, and reads no environment variable', (t) => {
  const p = places(t);
  const fake = `${p.dir}/xdg`;
  mkStore(`${fake}/omx/panel/panel.sqlite`, { layer: 2, panel: PV(p) });
  const env = { XDG_DATA_HOME: fake, HOME: p.dir, OMX_PANEL_STORE_BASE: p.base, OMX_PANEL_STORE_USER: p.user, OMX_CONTRACT_PATH: p.contract };
  const r = run([], { env });
  assert.equal(r.status, 2, 'no subcommand is a usage error');
  const places_ = (scope) => JSON.parse(run(['places', '--production', scope], { env }).stdout);
  const u = places_('user');
  const s = places_('system');
  assert.equal(u.base, '/usr/share/omx/panel/panel.sqlite');
  assert.equal(s.base, '/usr/share/omx/panel/panel.sqlite');
  assert.equal(s.system, '/var/lib/omx/panel/panel.sqlite');
  assert.equal(u.system, '/var/lib/omx/panel/panel.sqlite');
  assert.equal(s.user, null, 'the system scope has no home');
  assert.match(u.user, /\/\.local\/share\/omx\/panel\/panel\.sqlite$/);
  assert.ok(!u.user.startsWith(fake) && !u.user.startsWith(p.dir), `the home is the password database's, not ${u.user}`);
});

test('the library imports no getenv', async () => {
  const { spawnSync } = await import('node:child_process');
  const { LIB } = await import('./helpers.mjs');
  const r = spawnSync('nm', ['-D', '--undefined-only', LIB], { encoding: 'utf8' });
  assert.equal(r.status, 0, `nm could not read ${LIB}: ${r.stderr}`);
  assert.doesNotMatch(r.stdout, /getenv/);
});

test('files at two versions are schema-mismatch, naming every file and its version, checked first', (t) => {
  const p = places(t);
  mkStore(p.base, { layer: 0, version: 1, panel: PV(p) });
  mkStore(p.system, { layer: 1, version: 2, panel: PV(p) });
  mkStore(p.user, { layer: 2, version: 3, panel: PV(p) });
  const r = get(p, entry());
  assert.equal(r.code, 'panel-store.schema-mismatch');
  for (const f of [p.base, p.system, p.user]) assert.ok(r.stderr.includes(f), `${f} is named`);
  for (const v of ['1', '2', '3']) assert.match(r.stderr, new RegExp(`\\b${v}\\b`));
});

test('files all at another version are schema-other; version 0, no store_info and a file of another layer are not-a-store', (t) => {
  const p = places(t);
  mkStore(p.base, { layer: 0, version: 2, panel: PV(p) });
  assert.equal(get(p, entry()).code, 'panel-store.schema-other');
  mkStore(p.base, { layer: 0, version: 0, panel: PV(p) });
  assert.equal(get(p, entry()).code, 'panel-store.not-a-store');
  mkStore(p.base, { layer: 0, info: false, panel: PV(p) });
  assert.equal(get(p, entry()).code, 'panel-store.not-a-store');
  mkStore(p.base, { layer: 2, panel: PV(p) });
  assert.equal(get(p, entry()).code, 'panel-store.not-a-store', 'a user layer opened as the base');
});

test('a file SQLite cannot read is unreadable', (t) => {
  const p = places(t);
  mkStore(p.base, { layer: 0, panel: PV(p) });
  mkStore(p.user, { layer: 2, panel: PV(p) });
  writeFileSync(p.user, 'this is not a database, and it is long enough to be taken for a header '.repeat(8));
  assert.equal(get(p, entry()).code, 'panel-store.unreadable');
});

test('a stored family that is not a PANEL_FAMILIES word is word-unknown at open, naming the column and the word', (t) => {
  const p = places(t);
  mkStore(p.base, { layer: 0, entries: [entry({ family: 'toaster' })], panel: PV(p) });
  const r = get(p, entry());
  assert.equal(r.code, 'panel-store.word-unknown');
  assert.match(r.stderr, /description\.family/);
  assert.match(r.stderr, /toaster/);
});

test('a plugin format that plugin-db does not publish is word-unknown: the formats are plugin-db\'s own item', (t) => {
  const p = places(t);
  mkStore(p.base, { layer: 0, entries: [entry({ format: 'vst3' })], panel: PV(p) });
  const r = get(p, entry({ format: 'vst3' }));
  assert.equal(r.code, 'panel-store.word-unknown');
  assert.match(r.stderr, /plugin\.format/);
});

test('a domain older than the store was checked against is domain-too-old', (t) => {
  const p = places(t);
  mkStore(p.base, { layer: 0, entries: [entry()], panel: '9.0.0' });
  assert.equal(get(p, entry()).code, 'panel-store.domain-too-old');
});

test('the files are unchanged by reads: the base byte for byte, its directory as it was, no journal beside any layer', (t) => {
  const p = places(t);
  mkStore(p.base, { layer: 0, entries: [entry()], panel: PV(p) });
  mkStore(p.system, { layer: 1, entries: [entry({ uri: 'urn:test:s' })], panel: PV(p) });
  mkStore(p.user, { layer: 2, entries: [entry({ uri: 'urn:test:u' })], panel: PV(p) });
  const before = [p.base, p.system, p.user].map(snapshot);
  for (const e of [entry(), entry({ uri: 'urn:test:s' }), entry({ uri: 'urn:test:u' }), entry({ uri: 'urn:test:none' })]) assert.equal(get(p, e).status, 0);
  assert.equal(run(['check', ...flags(p)]).stdout.trim(), 'ok');
  assert.deepEqual([p.base, p.system, p.user].map(snapshot), before);
});

test('the DDL: json_valid refuses a body and groups that are not JSON', (t) => {
  const p = places(t);
  mkStore(p.base, { layer: 0, panel: PV(p) });
  const db = new DatabaseSync(p.base);
  db.prepare('INSERT INTO plugin (sha256, format, uri) VALUES (?, ?, ?)').run(hex('c'), 'lv2', 'urn:x');
  const put = (body, groups, refused) => db.prepare("INSERT INTO description VALUES (1, 0, 'x', 1, ?, 'eq', ?, ?, ?, ?)").run(hex('1'), hex('f'), body, groups, refused);
  assert.throws(() => put('{not json', '{}', null), /CHECK constraint/);
  assert.throws(() => put('{}', 'nor this', null), /CHECK constraint/);
  put('{}', '{}', null);
  db.close();
});

test('the DDL: exactly one of body and refused, and groups NULL exactly when body is', (t) => {
  const p = places(t);
  mkStore(p.base, { layer: 0, panel: PV(p) });
  const db = new DatabaseSync(p.base);
  db.prepare('INSERT INTO plugin (sha256, format, uri) VALUES (?, ?, ?)').run(hex('c'), 'lv2', 'urn:x');
  const put = (body, groups, refused) => db.prepare("INSERT INTO description VALUES (1, 0, 'x', 1, ?, 'eq', ?, ?, ?, ?)").run(hex('1'), hex('f'), body, groups, refused);
  assert.throws(() => put('{}', '{}', 'panel.describe.no-controls'), /CHECK constraint/, 'both');
  assert.throws(() => put(null, null, null), /CHECK constraint/, 'neither');
  assert.throws(() => put(null, '{}', 'panel.describe.no-controls'), /CHECK constraint/, 'groups with no body');
  assert.throws(() => put('{}', null, null), /CHECK constraint/, 'a body with no groups');
  put(null, null, 'panel.describe.no-controls');
  db.close();
});

test('a refused derivation is an entry: no body, the refusing word, answered as refused', (t) => {
  const p = places(t);
  const e = entry({ refused: 'panel.describe.no-controls' });
  mkStore(p.base, { layer: 0, entries: [e], panel: PV(p) });
  const r = get(p, e);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.answer.body, null);
  assert.equal(r.answer.refused, 'panel.describe.no-controls');
});

test('an entry whose source differs from the caller\'s is skipped, and the next layer answers', (t) => {
  const p = places(t);
  const user = entry({ source: hex('2'), body: { from: 'user' } });
  const system = entry({ source: hex('1'), body: { from: 'system' } });
  mkStore(p.system, { layer: 1, entries: [system], panel: PV(p) });
  mkStore(p.user, { layer: 2, entries: [user], panel: PV(p) });
  mkStore(p.base, { layer: 0, entries: [entry({ source: hex('3'), body: { from: 'base' } })], panel: PV(p) });
  assert.equal(get(p, user, { source: hex('1') }).answer.layer, 'system');
  assert.equal(get(p, user, { source: hex('2') }).answer.layer, 'user');
  assert.equal(get(p, user, { source: hex('3') }).answer.layer, 'base');
  assert.equal(get(p, user, { source: hex('9') }).answer, null, 'a key whose every entry is stale is absent');
});

test('a derived entry below the reader\'s rules version is skipped; an edited one is not', (t) => {
  const p = places(t);
  const derived = entry({ edited: 0, rules: 1, body: { from: 'user-derived' } });
  const edited = entry({ uri: 'urn:test:edited', edited: 1, rules: 1, body: { from: 'user-edited' } });
  mkStore(p.user, { layer: 2, entries: [derived, edited], panel: PV(p) });
  mkStore(p.base, { layer: 0, entries: [entry({ rules: 5, body: { from: 'base' } }), entry({ uri: 'urn:test:edited', rules: 5, body: { from: 'base-edited' } })], panel: PV(p) });
  assert.equal(get(p, derived).answer.layer, 'user');
  assert.equal(get(p, derived, { rules: 5 }).answer.layer, 'base', 'rules 1 is below a reader at 5');
  assert.equal(get(p, edited, { rules: 5 }).answer.layer, 'user', 'a person\'s edit stands across omx-panel releases');
});

test('a stale edited entry is named and not deleted', (t) => {
  const p = places(t);
  const edited = entry({ edited: 1, source: hex('2'), body: { from: 'edit' } });
  mkStore(p.user, { layer: 2, entries: [edited], panel: PV(p) });
  mkStore(p.base, { layer: 0, entries: [entry({ source: hex('1'), body: { from: 'base' } })], panel: PV(p) });
  const before = snapshot(p.user);
  const r = get(p, edited, { source: hex('1') });
  assert.equal(r.answer.layer, 'base');
  assert.equal(r.answer.stale_edit_layer, 'user');
  assert.deepEqual(snapshot(p.user), before);
  const db = new DatabaseSync(p.user, { readOnly: true });
  assert.equal(db.prepare('SELECT count(*) AS n FROM description').get().n, 1);
  db.close();
  // an entry nobody stales names no stale layer
  assert.equal(get(p, edited, { source: hex('2') }).answer.stale_edit_layer, null);
});

test('the verdict and its groups come back whole, ports in order of the group', (t) => {
  const p = places(t);
  const e = entry({ verdict: { outcome: 'grouped', reason: null, groups: [
    { symbol: 'a', name: 'A', display_priority: 2, rule: 'name', declared: 0, ports: ['p1', 'p2'] },
    { symbol: 'b', name: 'B', display_priority: 1, rule: 'own', declared: 1, ports: ['p3'] }] } });
  mkStore(p.base, { layer: 0, entries: [e], panel: PV(p) });
  const r = get(p, e).answer;
  assert.equal(r.group_outcome, 'grouped');
  assert.deepEqual(r.groups.map((g) => [g.symbol, g.name, g.display_priority, g.rule, g.declared, g.ports]), [['b', 'B', 1, 'own', 1, ['p3']], ['a', 'A', 2, 'name', 0, ['p1', 'p2']]], 'by display priority, then symbol');
});
