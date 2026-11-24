// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The generators read the store, and `omx-panel-sync` is one pass with no systemd (docs/descriptions-store.md section 6
 * and lane 4). Through the real commands over a world of two installed LV2 plugins: a user-layer entry whose groups are
 * not what the rules infer makes the complement write the stored groups; with no store installed the complement infers
 * as before and says so; the pass derives each installed plugin once, prunes the entries of plugins no longer installed
 * from the layer it writes and touches no other, runs both generators and never runs systemctl (one on PATH records any
 * call and fails).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { readPluginPorts } from '../../dist/tools/group-infer.mjs';
import { pluginTriples, readInstalledBundle } from '../../dist/tools/lv2-complement.mjs';
import { CMD, entry, hex, mkStore, panelVersion, ROOT, run, snapshot } from './helpers.mjs';
import { DELAY, keysOf, sha256, sourceOf, storeEnv, TRIPLE, world } from './plugin-world.mjs';

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
  return dir;
}

/** The environment of a generator or the pass: the world's places, our folder first on the search list, the bin first on PATH. */
function env(w, { store = true } = {}) {
  const modgui = join(w.d, 'modgui');
  const path = [bin(w), '/usr/bin', '/bin'].join(':');
  const e = storeEnv(w, { PATH: path, MODGUI_DIR: modgui, STATE_DIR: join(w.d, 'state'), LV2_PATH: `${modgui}:${w.lv2}` });
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
  const panel = panelVersion(w.places.contract);
  // the user layer: a plugin gone, an old binary of delayorama, a CLAP key the pass does not enumerate
  const gone = entry({ uri: 'urn:test:gone', sha: hex('d') });
  const oldDelay = entry({ uri: DELAY, sha: hex('e') });
  const clap = entry({ uri: 'org.example.clap', format: 'clap', sha: hex('9') });
  mkStore(w.places.user, { layer: 2, panel, entries: [gone, oldDelay, clap] });
  mkStore(w.places.system, { layer: 1, panel, entries: [entry({ uri: 'urn:test:gone', sha: hex('d') })] });
  const system = snapshot(w.places.system);
  const base = snapshot(w.places.base);
  const e = env(w);
  const r = sh(join(e.PATH.split(':')[0], 'omx-panel-sync'), [], e);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(existsSync(join(w.d, 'systemctl.log')), false, `systemctl ran: ${existsSync(join(w.d, 'systemctl.log')) ? readFileSync(join(w.d, 'systemctl.log'), 'utf8') : ''}`);
  assert.deepEqual(keysOf(w.places.user), [
    { sha256: sha256(w.delay.binary), format: 'lv2', uri: DELAY },
    { sha256: sha256(w.triple.binary), format: 'lv2', uri: TRIPLE },
    { sha256: hex('9'), format: 'clap', uri: 'org.example.clap' },
  ].sort((a, b) => (a.uri < b.uri ? -1 : 1)), 'both installed plugins stored, the gone and the old pruned, the CLAP key kept');
  assert.deepEqual(snapshot(w.places.system), system, 'the system layer is not touched');
  assert.deepEqual(snapshot(w.places.base), base, 'the base is not touched');
  assert.equal(readFileSync(join(w.d, 'modgui.log'), 'utf8'), 'omx-modgui-sync \n', 'the MOD GUI generator ran once');
  assert.ok(Object.keys(writtenGroups(w, TRIPLE)).length > 0, 'the complement ran');
});

test('omx-panel-sync names a step that failed and exits 1', OPTS, (t) => {
  const w = world(t);
  const e = env(w);
  writeFileSync(join(dirname(e.PATH.split(':')[0]), 'bin', 'omx-modgui-sync'), '#!/bin/sh\nexit 4\n');
  const r = sh(join(e.PATH.split(':')[0], 'omx-panel-sync'), [], e);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /omx-modgui-sync/);
});
