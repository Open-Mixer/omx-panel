// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The descriptions store's writer (docs/descriptions-store.md, section 5): the layer of the effective uid, created from
 * schema/panel.sql, one entry per transaction, every word and shape checked as an entry of the description schema.
 * The reader is the oracle: what a put wrote, a get reads.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CMD, DatabaseSync, entry, flags, get, grouped, hex, keyFlags, mkStore, panelVersion, places, run, snapshot } from './helpers.mjs';

/** The entry as `put` takes it on stdin: the key is in the flags. */
const doc = (e) => { const { sha, format, uri, ...rest } = e; return { ...rest, controls: rest.controls.map((c) => ({ key: c.symbol, id: c.symbol, ...c })) }; };
const put = (p, e, over = {}) => run(['put', ...flags(p), '--sha256', e.sha, '--format', e.format, '--uri', e.uri], { input: JSON.stringify({ ...doc(e), ...over }) });
const remove = (p, e) => run(['remove', ...flags(p), '--sha256', e.sha, '--format', e.format, '--uri', e.uri]);
const layerOfUid = (p) => (process.geteuid() === 0 ? p.system : p.user);
const count = (path, table) => { const db = new DatabaseSync(path, { readOnly: true }); const n = db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n; db.close(); return n; };

function ready(t) {
  const p = places(t);
  mkStore(p.base, { layer: 0, panel: panelVersion(p.contract), entries: [entry({ uri: 'urn:test:base-only' })] });
  return p;
}

test('a put creates the layer of the effective uid from schema/panel.sql, and no other', (t) => {
  const p = ready(t);
  const baseBefore = snapshot(p.base);
  const e = entry({ verdict: grouped() });
  const r = put(p, e);
  assert.equal(r.status, 0, r.stderr);
  const mine = layerOfUid(p);
  const other = process.geteuid() === 0 ? p.user : p.system;
  assert.equal(existsSync(mine), true);
  assert.equal(existsSync(other), false, 'never both');
  assert.deepEqual(snapshot(p.base), baseBefore, 'never the base');
  const db = new DatabaseSync(mine, { readOnly: true });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
  assert.equal(db.prepare('SELECT layer, built_from FROM store_info').get().layer, process.geteuid() === 0 ? 1 : 2);
  assert.equal(db.prepare('SELECT built_from FROM store_info').get().built_from, null);
  assert.deepEqual(db.prepare('SELECT domain, version FROM store_domain ORDER BY domain').all().map((x) => ({ ...x })),
    [{ domain: 'panel', version: panelVersion(p.contract) }, { domain: 'plugin-db', version: '1.0.0' }]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM word_check').get().n, 6);
  db.close();
  assert.equal(readFileSync(mine).subarray(0, 15).toString(), 'SQLite format 3');
});

test('what a put wrote, a get reads, from the layer it was written to', (t) => {
  const p = ready(t);
  const e = entry({ edited: 1, verdict: grouped(), controls: [{ symbol: 'gain1', key: 'k1', id: 'i1', group_key: 'band', governed: 1 }, { symbol: 'freq1' }] });
  assert.equal(put(p, e).status, 0);
  const a = get(p, e).answer;
  assert.equal(a.layer, process.geteuid() === 0 ? 'system' : 'user');
  assert.equal(a.edited, 1);
  assert.equal(a.family, 'eq');
  assert.deepEqual(a.body, e.body);
  assert.equal(a.group_outcome, 'grouped');
  assert.deepEqual(a.groups.map((g) => [g.symbol, g.ports]), [['band1', ['gain1', 'freq1']]]);
  assert.deepEqual(a.controls.map((c) => [c.symbol, c.key, c.id, c.group_key, c.governed]), [['gain1', 'k1', 'i1', 'band', 1], ['freq1', 'freq1', 'freq1', null, 0]]);
});

test('a put replaces the key\'s whole entry in the layer: nothing of the old one stays', (t) => {
  const p = ready(t);
  const e = entry({ verdict: grouped('name', { symbol: 'old', ports: ['a', 'b'] }), controls: [{ symbol: 'a' }, { symbol: 'b' }] });
  assert.equal(put(p, e).status, 0);
  const again = entry({ body: { second: true }, verdict: null, controls: [{ symbol: 'z' }] });
  assert.equal(put(p, again).status, 0);
  const mine = layerOfUid(p);
  assert.equal(count(mine, 'plugin'), 1);
  assert.equal(count(mine, 'description'), 1);
  assert.equal(count(mine, 'port_group'), 0);
  assert.equal(count(mine, 'port_group_member'), 0);
  assert.equal(count(mine, 'port_group_verdict'), 0);
  assert.equal(count(mine, 'description_control'), 1);
  const a = get(p, again).answer;
  assert.deepEqual(a.body, { second: true });
  assert.deepEqual(a.groups, []);
  assert.equal(a.group_outcome, null);
});

test('a refused derivation is put as an entry: no body, no groups, the refusing word', (t) => {
  const p = ready(t);
  const e = entry({ refused: 'panel.describe.family-not-backed', body: null, groups: null });
  assert.equal(put(p, e).status, 0, 'a refused entry is an entry');
  const a = get(p, e).answer;
  assert.equal(a.body, null);
  assert.equal(a.refused, 'panel.describe.family-not-backed');
});

test('an entry that is not an entry of the description schema is entry-invalid, and nothing is written', (t) => {
  const bad = {
    'a family that is not a PANEL_FAMILIES word': { family: 'toaster' },
    'a refusal that is not a describe code': { refused: 'panel.describe.nope', body: null, groups: null },
    'a rule that is not a PANEL_GROUP_RULES word': { verdict: grouped('guess') },
    'an outcome that is not a PANEL_GROUP_OUTCOMES word': { verdict: { ...grouped(), outcome: 'sure' } },
    'both a body and a refusal': { refused: 'panel.describe.no-controls' },
    'neither a body nor a refusal': { body: null, groups: null },
    'groups with no body': { body: null, refused: 'panel.describe.no-controls' },
    'a source that is not 64 hex digits': { source: 'abc' },
    'rules below 1': { rules: 0 },
    'edited not 0 or 1': { edited: 2 },
    'a group port named twice': { verdict: grouped('name', { ports: ['x', 'x'] }) },
    'a control under a refused entry': { refused: 'panel.describe.no-controls', body: null, groups: null, controls: [{ symbol: 'a', key: 'a', id: 'a' }] },
    'a control symbol twice': { controls: [{ symbol: 'a' }, { symbol: 'a' }] },
    'a verdict that is nothing-to-do but holds groups': { verdict: { ...grouped(), outcome: 'nothing-to-do', reason: 'fits-one-screen' } },
  };
  for (const [what, over] of Object.entries(bad)) {
    const p = ready(t);
    const e = entry();
    const r = run(['put', ...flags(p), '--sha256', e.sha, '--format', e.format, '--uri', e.uri], { input: JSON.stringify({ ...doc(e), ...over }) });
    assert.equal(r.status, 1, `${what}: ${r.stderr}`);
    assert.match(r.stderr, /^panel-store\.entry-invalid/, what);
    const mine = layerOfUid(p);
    if (existsSync(mine)) assert.equal(count(mine, 'plugin'), 0, `${what}: no row of a refused entry`);
  }
});

test('a key with a format plugin-db does not publish, or a sha256 that is not 64 hex digits, is entry-invalid', (t) => {
  const p = ready(t);
  const e = entry();
  const r1 = run(['put', ...flags(p), '--sha256', e.sha, '--format', 'vst3', '--uri', e.uri], { input: JSON.stringify(doc(e)) });
  assert.match(r1.stderr, /^panel-store\.(entry-invalid|word-unknown)/);
  const r2 = run(['put', ...flags(p), '--sha256', 'ABC', '--format', 'lv2', '--uri', e.uri], { input: JSON.stringify(doc(e)) });
  assert.match(r2.stderr, /^panel-store\.entry-invalid/);
  assert.equal(run(['put', ...flags(p), '--sha256', e.sha, '--format', 'lv2', '--uri', e.uri], { input: 'not json' }).status, 1);
});

test('remove deletes the layer\'s entry whole and brings the lower layer\'s back', (t) => {
  const p = ready(t);
  const low = entry({ uri: 'urn:test:base-only', body: { from: 'base' } });
  const mine = entry({ uri: 'urn:test:base-only', body: { from: 'mine' }, verdict: grouped() });
  assert.equal(put(p, mine).status, 0);
  assert.equal(get(p, low).answer.body.from, 'mine');
  assert.equal(remove(p, low).status, 0);
  assert.equal(get(p, low).answer.layer, 'base');
  assert.equal(count(layerOfUid(p), 'port_group'), 0, 'the cascade removed the groups');
  assert.equal(remove(p, low).status, 0, 'removing what is not there is not an error');
});

test('a put over a stale entry of its own layer replaces it', (t) => {
  const p = ready(t);
  const old = entry({ source: hex('1') });
  assert.equal(put(p, old).status, 0);
  assert.equal(get(p, old, { source: hex('2') }).answer, null);
  assert.equal(put(p, { ...old, source: hex('2'), body: { fresh: true } }).status, 0);
  assert.deepEqual(get(p, old, { source: hex('2') }).answer.body, { fresh: true });
  assert.equal(count(layerOfUid(p), 'plugin'), 1);
});

test('a layer at another version is schema-other to the writer: it is not written', (t) => {
  const p = ready(t);
  mkStore(layerOfUid(p), { layer: process.geteuid() === 0 ? 1 : 2, version: 2, panel: panelVersion(p.contract) });
  const before = snapshot(layerOfUid(p));
  const r = put(p, entry());
  assert.match(r.stderr, /^panel-store\.(schema-other|schema-mismatch)/);
  assert.deepEqual(snapshot(layerOfUid(p)), before);
});

test('a layer held locked by another writer is busy within the timeout, never a hang', async (t) => {
  const p = ready(t);
  mkStore(layerOfUid(p), { layer: process.geteuid() === 0 ? 1 : 2, panel: panelVersion(p.contract) });
  const db = new DatabaseSync(layerOfUid(p));
  db.exec('BEGIN EXCLUSIVE');
  t.after(() => { try { db.exec('ROLLBACK'); } catch { /* closed */ } db.close(); });
  const t0 = Date.now();
  const r = await new Promise((res) => {
    const c = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', 'process.exit(0)']);
    c.on('exit', () => res(get(p, entry())));
  });
  assert.equal(r.code, 'panel-store.busy');
  assert.ok(Date.now() - t0 < 3000, `refused in ${Date.now() - t0} ms`);
});

test('check opens every layer and prints ok; a usage error exits 2', (t) => {
  const p = ready(t);
  const r = run(['check', ...flags(p)]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'ok');
  assert.equal(run(['get', ...flags(p)]).status, 2, 'get with no key');
  assert.equal(run(['frobnicate']).status, 2);
  assert.equal(run(['get', ...flags(p), ...keyFlags(entry()).slice(0, 6)]).status, 2, 'no --source');
});

test('a reader waits out a short lock: the busy timeout is real, not zero', async (t) => {
  const p = ready(t);
  mkStore(layerOfUid(p), { layer: process.geteuid() === 0 ? 1 : 2, panel: panelVersion(p.contract) });
  const db = new DatabaseSync(layerOfUid(p));
  db.exec('BEGIN EXCLUSIVE');
  t.after(() => { try { db.exec('ROLLBACK'); } catch { /* released */ } db.close(); });
  setTimeout(() => db.exec('ROLLBACK'), 100);
  const e = entry();
  const c = spawn(CMD, ['get', ...flags(p), ...keyFlags(e), '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const status = await new Promise((res) => c.on('exit', res));
  assert.equal(status, 0);
});
