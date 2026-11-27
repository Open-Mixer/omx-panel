// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The generators read the store, and `omx-panel-sync` is one pass with no systemd (docs/descriptions-store.md section 6
 * and lane 4). Through the real commands over a world of two installed LV2 plugins: a user-layer entry whose groups are
 * not what the rules infer makes the complement write the stored groups; with no store installed the complement infers
 * as before and says so; the pass derives each installed plugin once, LV2 and CLAP (the CLAP plugins as omx-clap-scan
 * lists them: a stand-in on PATH), prunes the entries of plugins no longer installed from the layer it writes and touches
 * no other, runs both generators and never runs systemctl (one on PATH records any call and fails). With no
 * omx-clap-scan the CLAP keys are neither described nor pruned.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { readPluginPorts } from '../../dist/tools/group-infer.mjs';
import { pluginTriples, readInstalledBundle } from '../../dist/tools/lv2-complement.mjs';
import { pass } from '../../dist/tools/panel-sync.mjs';
import { CMD, DatabaseSync, entry, hex, mkStore, panelVersion, ROOT, run, snapshot } from './helpers.mjs';
import { clapFile, DELAY, fakeClapScan, FIXTURES, keysOf, sha256, sourceOf, storeEnv, TRIPLE, world } from './plugin-world.mjs';

/** A CLAP id no installed declaration names, so its descriptor is the scan's in DESCRIPTOR_DIRS. */
const CLAP_ID = 'org.example.fixture-comp';

/** The world's CLAP plugin: a file on its CLAP search list, and the descriptor a scan wrote for it. */
function withClap(w) {
  const d = JSON.parse(readFileSync(join(FIXTURES, 'descriptors', 'scanned-clap-omx-comp.json'), 'utf8'));
  writeFileSync(join(w.scans, 'fixture-comp.json'), JSON.stringify({ ...d, plugin: { ...d.plugin, id: CLAP_ID } }));
  return clapFile(join(w.d, 'clap'), 'fixture-comp', CLAP_ID);
}

/** The number of controls the layer at `path` stores for a key. */
function controlsOf(path, { sha256: sha, format, uri }) {
  const db = new DatabaseSync(path, { readOnly: true });
  const n = db.prepare('SELECT count(*) AS n FROM description_control JOIN plugin USING (plugin_id) WHERE sha256 = ? AND format = ? AND uri = ?').get(sha, format, uri).n;
  db.close();
  return n;
}

const unprivileged = process.geteuid() !== 0;
if (!unprivileged) process.stderr.write('panel-sync.test.mjs: skipping: run as root, the writer writes the system layer\n');
const OPTS = { skip: !unprivileged };

/** Two groups no rule infers for triplePara: the left half and the right half of its ports. */
const HALVES = {
  outcome: 'grouped', reason: null,
  groups: [
    { symbol: 'lows', name: 'Lows', display_priority: 2, rule: 'name', declared: 0, ports: ['gain_L', 'fc_L', 'bw_L', 'gain_1', 'fc_1', 'bw_1'] },
    { symbol: 'highs', name: 'Highs', display_priority: 1, rule: 'name', declared: 0, ports: ['gain_2', 'fc_2', 'bw_2', 'gain_3', 'fc_3', 'bw_3', 'gain_H', 'fc_H', 'bw_H'] },
  ],
};

/** A bin directory: the commands the pass runs, a systemctl that records any call and fails, a recording omx-modgui-sync. */
function bin(w) {
  const dir = join(w.d, 'bin');
  mkdirSync(dir, { recursive: true });
  const script = (name, text) => { writeFileSync(join(dir, name), text); chmodSync(join(dir, name), 0o755); };
  script('omx-panel', `#!/bin/sh\nexec '${process.execPath}' '${join(ROOT, 'dist', 'bin', 'omx-panel.mjs')}' "$@"\n`);
  symlinkSync(CMD, join(dir, 'omx-panel-store'));
  symlinkSync(join(ROOT, 'bin', 'omx-complement-sync'), join(dir, 'omx-complement-sync'));
  symlinkSync(join(ROOT, 'bin', 'omx-panel-sync'), join(dir, 'omx-panel-sync'));
  script('systemctl', `#!/bin/sh\necho "systemctl $*" >> '${join(w.d, 'systemctl.log')}'\nexit 99\n`);
  script('omx-modgui-sync', `#!/bin/sh\necho "omx-modgui-sync $*" >> '${join(w.d, 'modgui.log')}'\n`);
  fakeClapScan(dir);
  return dir;
}

/** The environment of a generator or the pass: the world's places, our folder first on the search list, the bin first on PATH. */
function env(w, { store = true } = {}) {
  const modgui = join(w.d, 'modgui');
  const path = [bin(w), '/usr/bin', '/bin'].join(':');
  const e = storeEnv(w, { PATH: path, MODGUI_DIR: modgui, STATE_DIR: join(w.d, 'state'), LV2_PATH: `${modgui}:${w.lv2}`, CLAP_PATH: join(w.d, 'clap') });
  if (!store) e.PATH = path.split(':').map((d, i) => (i === 0 ? noStore(d) : d)).join(':');
  return e;
}
/** The same bin directory less omx-panel-store: no store installed. */
function noStore(dir) {
  const other = `${dir}-nostore`;
  mkdirSync(other, { recursive: true });
  for (const f of readdirSync(dir)) if (f !== 'omx-panel-store') symlinkSync(join(dir, f), join(other, f));
  return other;
}

/** The groups the complement wrote for `uri`: each port symbol to its group's lv2:symbol, from the bundle lilv loads. */
function writtenGroups(w, uri) {
  const out = join(w.d, 'modgui');
  const dir = readdirSync(out).find((f) => f.startsWith('omx-complement-') && readFileSync(join(out, f, 'manifest.ttl'), 'utf8').includes(uri));
  assert.ok(dir, `the complement wrote a bundle for ${uri}`);
  const b = readInstalledBundle(join(out, dir));
  const plugin = readPluginPorts(pluginTriples(b, uri), uri);
  return Object.fromEntries(plugin.ports.filter((p) => p.group).map((p) => [p.symbol, plugin.groups[p.group]?.symbol]).sort());
}
const halvesByPort = Object.fromEntries(HALVES.groups.flatMap((g) => g.ports.map((p) => [p, g.symbol])).sort());

const sh = (cmd, args, e) => spawnSync(cmd, args, { encoding: 'utf8', env: e, timeout: 120000 });

test('the complement writes the groups the store holds for a key, not what the rules infer', OPTS, (t) => {
  const w = world(t);
  const held = entry({ sha: sha256(w.triple.binary), format: 'lv2', uri: TRIPLE, source: sourceOf('lv2', w.triple.dir), verdict: HALVES });
  mkStore(w.places.user, { layer: 2, panel: panelVersion(w.places.contract), entries: [held] });
  const e = env(w);
  const r = sh(join(e.PATH.split(':')[0], 'omx-complement-sync'), [], e);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(writtenGroups(w, TRIPLE), halvesByPort, 'the stored halves, port by port');
});

test('a stored edit of the groups over the same TTL writes the bundle again on the next run', OPTS, (t) => {
  const w = world(t);
  const key = { sha: sha256(w.triple.binary), format: 'lv2', uri: TRIPLE, source: sourceOf('lv2', w.triple.dir) };
  mkStore(w.places.user, { layer: 2, panel: panelVersion(w.places.contract), entries: [entry({ ...key, verdict: HALVES })] });
  const e = env(w);
  const sync = join(e.PATH.split(':')[0], 'omx-complement-sync');
  assert.equal(sh(sync, [], e).status, 0);
  const moved = { ...HALVES, groups: [{ ...HALVES.groups[0], ports: [...HALVES.groups[0].ports, 'gain_2', 'fc_2', 'bw_2'] }, { ...HALVES.groups[1], ports: HALVES.groups[1].ports.slice(3) }] };
  mkStore(w.places.user, { layer: 2, panel: panelVersion(w.places.contract), entries: [entry({ ...key, verdict: moved })] });
  const r = sh(sync, [], e);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(writtenGroups(w, TRIPLE).gain_2, 'lows', 'band 2 moved to the lows, as the store now says');
});

test('no store installed: the complement infers as before, and says so', OPTS, (t) => {
  const w = world(t);
  const e = env(w, { store: false });
  const r = sh(join(e.PATH.split(':')[0], 'omx-complement-sync'), [], e);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stderr + r.stdout, /no descriptions store/);
  const groups = new Set(Object.values(writtenGroups(w, TRIPLE)));
  assert.deepEqual([...groups].sort(), ['band_1', 'band_2', 'band_3', 'high', 'low'], 'the rules\' groups');
  assert.equal(existsSync(w.places.user), false, 'nothing was stored');
});

test('omx-panel-store list prints the keys of the layer of the effective uid, one per line', OPTS, (t) => {
  const w = world(t);
  mkStore(w.places.user, { layer: 2, panel: panelVersion(w.places.contract), entries: [entry({ uri: 'urn:a' }), entry({ uri: 'urn:b', format: 'clap', sha: hex('b') })] });
  const r = run(['list', '--base', w.places.base, '--system', w.places.system, '--user', w.places.user, '--contract-dir', w.places.contract]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${hex('a')}\tlv2\turn:a\n${hex('b')}\tclap\turn:b\n`);
});

test('omx-panel-sync: one pass, each installed plugin derived once, stale entries pruned from its own layer only, no systemctl', OPTS, (t) => {
  const w = world(t);
  const clap = withClap(w);
  const panel = panelVersion(w.places.contract);
  // the user layer: a plugin gone, an old binary of delayorama, a CLAP plugin gone, an old binary of the installed CLAP one
  const gone = entry({ uri: 'urn:test:gone', sha: hex('d') });
  const oldDelay = entry({ uri: DELAY, sha: hex('e') });
  const goneClap = entry({ uri: 'org.example.clap', format: 'clap', sha: hex('9') });
  const oldClap = entry({ uri: CLAP_ID, format: 'clap', sha: hex('8') });
  mkStore(w.places.user, { layer: 2, panel, entries: [gone, oldDelay, goneClap, oldClap] });
  mkStore(w.places.system, { layer: 1, panel, entries: [entry({ uri: 'urn:test:gone', sha: hex('d') })] });
  const system = snapshot(w.places.system);
  const base = snapshot(w.places.base);
  const e = env(w);
  const r = sh(join(e.PATH.split(':')[0], 'omx-panel-sync'), [], e);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(existsSync(join(w.d, 'systemctl.log')), false, `systemctl ran: ${existsSync(join(w.d, 'systemctl.log')) ? readFileSync(join(w.d, 'systemctl.log'), 'utf8') : ''}`);
  const clapKey = { sha256: sha256(clap.path), format: 'clap', uri: CLAP_ID };
  assert.deepEqual(keysOf(w.places.user), [
    { sha256: sha256(w.delay.binary), format: 'lv2', uri: DELAY },
    { sha256: sha256(w.triple.binary), format: 'lv2', uri: TRIPLE },
    clapKey,
  ].sort((a, b) => (a.uri < b.uri ? -1 : 1)), 'every installed plugin stored, LV2 and CLAP; the gone and the old pruned, of both formats');
  assert.ok(controlsOf(w.places.user, clapKey) > 0, 'the CLAP entry is a description with controls');
  assert.deepEqual(snapshot(w.places.system), system, 'the system layer is not touched');
  assert.deepEqual(snapshot(w.places.base), base, 'the base is not touched');
  assert.equal(readFileSync(join(w.d, 'modgui.log'), 'utf8'), 'omx-modgui-sync \n', 'the MOD GUI generator ran once');
  assert.ok(Object.keys(writtenGroups(w, TRIPLE)).length > 0, 'the complement ran');
});

test('the pass with no omx-clap-scan: no CLAP plugin described and no CLAP key pruned, and it says so', OPTS, (t) => {
  const w = world(t);
  withClap(w);
  const panel = panelVersion(w.places.contract);
  const goneClap = entry({ uri: 'org.example.clap', format: 'clap', sha: hex('9') });
  mkStore(w.places.user, { layer: 2, panel, entries: [goneClap] });
  const lines = [];
  // PATH holds the store's command and nothing else: no scanner
  const r = pass({ lv2Path: w.lv2, clapPath: join(w.d, 'clap'), env: storeEnv(w), log: (l) => lines.push(l) });
  assert.equal(r.failed, 0, lines.join('\n'));
  assert.match(lines.join('\n'), /no omx-clap-scan on PATH/);
  assert.deepEqual(keysOf(w.places.user).filter((k) => k.format === 'clap'), [{ sha256: hex('9'), format: 'clap', uri: 'org.example.clap' }], 'the CLAP key is kept, none added');
  assert.equal(keysOf(w.places.user).filter((k) => k.format === 'lv2').length, 2, 'the LV2 plugins are still stored');
});

test('the pass sabotaged: a CLAP plugin the scan lists but no descriptor names is counted, never stored as a description', OPTS, (t) => {
  const w = world(t);
  clapFile(join(w.d, 'clap'), 'nameless', 'org.example.nameless');
  const lines = [];
  fakeClapScan(join(w.d, 'scanbin'));
  const e = { ...storeEnv(w), PATH: `${join(w.d, 'scanbin')}:${dirname(CMD)}` };
  const r = pass({ lv2Path: w.lv2, clapPath: join(w.d, 'clap'), env: e, log: (l) => lines.push(l) });
  assert.equal(r.noDescriptor, 1, lines.join('\n'));
  assert.equal(keysOf(w.places.user).some((k) => k.uri === 'org.example.nameless'), false);
});

test('omx-panel-sync names a step that failed and exits 1', OPTS, (t) => {
  const w = world(t);
  const e = env(w);
  writeFileSync(join(dirname(e.PATH.split(':')[0]), 'bin', 'omx-modgui-sync'), '#!/bin/sh\nexit 4\n');
  const r = sh(join(e.PATH.split(':')[0], 'omx-panel-sync'), [], e);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /omx-modgui-sync/);
});
