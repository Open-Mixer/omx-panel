// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// omx-modgui-sync over a real lilv world: a tiny LV2 bundle, a scanned descriptor in DESCRIPTOR_DIRS, the installed
// omx-panel. A plugin gets a bundle (its brand the plugin name when the descriptor states no vendor), a second run finds
// it fresh, a plugin with nothing to draw is counted and fails nothing, a bundle that is not ours is left alone, and one
// of ours goes with its plugin.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** omx-contract's example descriptor `name`, where the installed package holds it. */
const example = (name) => createRequire(import.meta.url).resolve(`@openmixer/omx-contract/examples/descriptors/${name}`);
const SYNC = join(ROOT, 'bin/omx-modgui-sync');
// OMX_PANEL_LILV=required (CI) makes a python3-lilv that does not import a failure naming why, not a skip
const lilvProbe = spawnSync('python3', ['-I', '-c', 'import lilv'], { encoding: 'utf8' });
const lilv = lilvProbe.status === 0;
const skip = !lilv && process.env.OMX_PANEL_LILV !== 'required' && 'python3-lilv is not installed';

test('python3-lilv imports (OMX_PANEL_LILV=required)', { skip }, () => {
  assert.ok(lilv, `python3 -I -c 'import lilv': ${lilvProbe.stderr || lilvProbe.error?.message}`);
});

const bundle = (lv2, dir, uri, name) => {
  mkdirSync(join(lv2, `${dir}.lv2`), { recursive: true });
  writeFileSync(join(lv2, `${dir}.lv2`, 'manifest.ttl'), `@prefix lv2: <http://lv2plug.in/ns/lv2core#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
<${uri}> a lv2:Plugin ; lv2:binary <${dir}.so> ; rdfs:seeAlso <${dir}.ttl> .
`);
  writeFileSync(join(lv2, `${dir}.lv2`, `${dir}.ttl`), `@prefix lv2: <http://lv2plug.in/ns/lv2core#> .
@prefix doap: <http://usefulinc.com/ns/doap#> .
<${uri}> a lv2:Plugin ; doap:name "${name}" ;
  lv2:port [ a lv2:InputPort , lv2:ControlPort ; lv2:index 0 ; lv2:symbol "gain" ; lv2:name "Gain" ;
             lv2:default 0.0 ; lv2:minimum -40.0 ; lv2:maximum 20.0 ] .
`);
};

/** A descriptor file for `uri` from a fixture, its vendor removed: a plugin that states none. */
const descriptor = (desc, file, uri, fixture, mutate = () => {}) => {
  // a fixture of this tree's own (one omx-contract does not publish), else the published example
  const own = join(ROOT, 'test/fixtures/descriptors', fixture);
  const d = JSON.parse(readFileSync(existsSync(own) ? own : example(fixture), 'utf8'));
  d.plugin.id = uri;
  d.plugin.uri = uri;
  delete d.plugin.vendor;
  mutate(d);
  writeFileSync(join(desc, file), JSON.stringify(d));
};

function rig() {
  const dir = mkdtempSync(join(tmpdir(), 'omx-modgui-sync-'));
  const r = { dir, lv2: join(dir, 'lv2'), out: join(dir, 'modgui'), state: join(dir, 'state'), desc: join(dir, 'desc'), bin: join(dir, 'bin') };
  for (const d of [r.lv2, r.out, r.desc, r.bin]) mkdirSync(d, { recursive: true });
  symlinkSync(join(ROOT, 'dist/bin/omx-panel.mjs'), join(r.bin, 'omx-panel'));
  // wrap: a command the sync runs under (its arguments, then the sync's path and its own)
  r.run = (args = ['--no-scan'], lv2path = `${r.lv2}:${r.out}`, extra = {}, wrap = []) => {
    const env = { ...process.env, PATH: `${r.bin}:${process.env.PATH}`, LV2_PATH: lv2path, MODGUI_DIR: r.out, STATE_DIR: r.state, DESCRIPTOR_DIRS: r.desc, ...extra };
    if (lv2path === null) delete env.LV2_PATH; // null: the variable is not set
    return wrap.length ? spawnSync(wrap[0], [...wrap.slice(1), SYNC, ...args], { encoding: 'utf8', env })
      : spawnSync(SYNC, args, { encoding: 'utf8', env });
  };
  r.bundles = () => readdirSync(r.out).filter((n) => n.endsWith('.lv2'));
  return r;
}

test('a plugin that ships no MOD GUI gets a bundle, its brand the plugin name when the descriptor states no vendor', { skip }, () => {
  const r = rig();
  bundle(r.lv2, 'testgain', 'urn:test:gain', 'Test Gain');
  descriptor(r.desc, 'testgain.json', 'urn:test:gain', 'scanned-lv2-compressor.json', (d) => {
    d.controls = d.controls.filter((c) => c.id === 'makeup');
    d.plugin.name = 'Test Gain';
  });
  const first = r.run();
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /^omx-modgui-sync: wrote .*testgain\.lv2 for urn:test:gain$/m);
  assert.match(first.stdout, /1 written, 0 up to date/);
  const [name] = r.bundles();
  assert.equal(r.bundles().length, 1);
  for (const f of ['modgui.ttl', 'manifest.ttl', '.omx-modgui-sync']) assert.ok(existsSync(join(r.out, name, f)), f);
  assert.match(readFileSync(join(r.out, name, 'manifest.ttl'), 'utf8'), /modgui:brand "Test Gain"/);
  assert.equal(readFileSync(join(r.out, name, '.omx-modgui-sync'), 'utf8').split('\n')[0], 'urn:test:gain');
  const again = r.run();
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /0 written, 1 up to date/);
});

test('a plugin with nothing to draw is counted and fails nothing: exit 0, no bundle', { skip }, () => {
  const r = rig();
  bundle(r.lv2, 'testsynth', 'urn:test:synth', 'Test Synth');
  descriptor(r.desc, 'testsynth.json', 'urn:test:synth', 'scanned-lv2-hidden-only.json');
  const run = r.run();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /0 written, 0 up to date, 0 ship their own, 0 without a descriptor, 0 without controls, 1 with nothing to draw, 0 removed, 0 could not be drawn/);
  assert.deepEqual(r.bundles(), []);
});

test('a refusal other than nothing-to-draw is named in the summary and still exits 0', { skip }, () => {
  const r = rig();
  bundle(r.lv2, 'testtrig', 'urn:test:trig', 'Test Trigger');
  descriptor(r.desc, 'testtrig.json', 'urn:test:trig', 'scanned-lv2-compressor.json', (d) => {
    d.controls = [{ id: 'note', name: 'Note', kind: 'text', meaning: 'unknown' }];
  });
  const run = r.run();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /no MOD GUI for urn:test:trig: Error: modgui-gen: 'note' is not a declared control input with a travel/);
  assert.match(run.stdout, /1 could not be drawn/);
});

test('a trigger control beside a normal one is left off the face and named in the summary line', { skip }, () => {
  const r = rig();
  bundle(r.lv2, 'testzlfo', 'urn:test:zlfo', 'Test ZLFO');
  descriptor(r.desc, 'testzlfo.json', 'urn:test:zlfo', 'scanned-lv2-compressor.json', (d) => {
    d.controls = [...d.controls.filter((c) => c.id === 'makeup'), { id: 'cv_trigger', name: 'Trigger', kind: 'trigger', meaning: 'unknown' }];
  });
  const run = r.run();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /1 written/);
  assert.match(run.stdout, /0 could not be drawn, and left trigger controls off the face \(.*: cv_trigger\)/);
  assert.doesNotMatch(readFileSync(join(r.out, r.bundles()[0], 'manifest.ttl'), 'utf8'), /cv_trigger/);
});

test('a plugin whose only control is a trigger has nothing to draw', { skip }, () => {
  const r = rig();
  bundle(r.lv2, 'testtrig2', 'urn:test:trig2', 'Test Trigger Only');
  descriptor(r.desc, 'testtrig2.json', 'urn:test:trig2', 'scanned-lv2-compressor.json', (d) => {
    d.controls = [{ id: 'cv_trigger', name: 'Trigger', kind: 'trigger', meaning: 'unknown' }];
  });
  const run = r.run();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /1 with nothing to draw/);
  assert.deepEqual(r.bundles(), []);
});

test('a bundle without our marker is left alone, and one of ours goes with its plugin', { skip }, () => {
  const r = rig();
  bundle(r.lv2, 'testgain', 'urn:test:gain', 'Test Gain');
  descriptor(r.desc, 'testgain.json', 'urn:test:gain', 'scanned-lv2-compressor.json', (d) => {
    d.controls = d.controls.filter((c) => c.id === 'makeup');
  });
  mkdirSync(join(r.out, 'omx-modgui-testgain.lv2'));
  writeFileSync(join(r.out, 'omx-modgui-testgain.lv2', 'theirs.txt'), 'not ours');
  const blocked = r.run();
  assert.match(blocked.stdout, /skip urn:test:gain: .*omx-modgui-testgain\.lv2 is not ours/);
  assert.deepEqual(readdirSync(join(r.out, 'omx-modgui-testgain.lv2')), ['theirs.txt']);
  rmSync(join(r.out, 'omx-modgui-testgain.lv2'), { recursive: true });
  assert.equal(r.run().status, 0);
  assert.equal(r.bundles().length, 1);
  rmSync(join(r.lv2, 'testgain.lv2'), { recursive: true });
  const gone = r.run();
  assert.match(gone.stdout, /removed .*: urn:test:gain ships its own MOD GUI now or is gone/);
  assert.deepEqual(r.bundles(), []);
});

test('a bundle directory off LV2_PATH is noted, not refused', { skip }, () => {
  const r = rig();
  const run = r.run(['--no-scan'], r.lv2);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /note: .*modgui is not on LV2_PATH; MOD-UI shows these GUIs once it is/);
});

test('--dry-run writes nothing', { skip }, () => {
  const r = rig();
  bundle(r.lv2, 'testgain', 'urn:test:gain', 'Test Gain');
  descriptor(r.desc, 'testgain.json', 'urn:test:gain', 'scanned-lv2-compressor.json', (d) => {
    d.controls = d.controls.filter((c) => c.id === 'makeup');
  });
  const run = r.run(['--dry-run', '--no-scan']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /would write .*testgain\.lv2 for urn:test:gain/);
  assert.deepEqual(r.bundles(), []);
});

// omx-panel#293: python3-lilv opens liblilv-0.so, a name only the development package (liblilv-dev, lilv-devel)
// installs, so on a host with the runtime library alone `import lilv` failed and the sync refused to start. Here that
// name is hidden in a private mount namespace (unshare -rm) and the sync must still run. The name is a symlink a bind
// mount would follow onto the runtime library itself, so the library directory is replaced by a directory of links to
// each of its entries but that one.
const devSo = lilv ? spawnSync('python3', ['-I', '-c', `import ctypes, os
ctypes.CDLL("liblilv-0.so.0")
for line in open("/proc/self/maps"):
    path = line.split()[-1]
    if "/liblilv-0.so" in path:
        print(os.path.join(os.path.dirname(path), "liblilv-0.so"))
        break`], { encoding: 'utf8' }).stdout.trim() : '';
const hideDir = mkdtempSync(join(tmpdir(), 'omx-modgui-sync-nodev-'));
process.on('exit', () => rmSync(hideDir, { recursive: true, force: true }));
let hideRun = 0;
/** The command prefix that runs its arguments with liblilv-0.so hidden. */
const hide = () => {
  const d = join(hideDir, String(hideRun++));
  return ['unshare', '-rm', 'sh', '-c', `lib=\${0%/*} all=$1/all links=$1/links; shift
mkdir -p "$all" "$links" && mount --bind "$lib" "$all" || exit 1
for f in "$all"/* "$all"/.[!.]*; do if [ -e "$f" ] || [ -L "$f" ]; then ln -s "$f" "$links/" || exit 1; fi; done
rm "$links/\${0##*/}" && mount --bind "$links" "$lib" && exec "$@"`, devSo, d];
};
const hideSkip = skip || ((!devSo || !existsSync(devSo)) && 'no liblilv-0.so to hide')
  || (spawnSync(hide()[0], [...hide().slice(1), 'true']).status !== 0 && 'unshare -rm cannot replace the library directory here');

test('the sync imports lilv from the runtime library alone, liblilv-0.so hidden (#293)', { skip: hideSkip }, () => {
  // the hiding landed: python3-lilv's own import fails in that namespace
  const h = hide();
  const plain = spawnSync(h[0], [...h.slice(1), 'python3', '-I', '-c', 'import lilv'], { encoding: 'utf8' });
  assert.notEqual(plain.status, 0, 'import lilv still worked with liblilv-0.so hidden: the test hides nothing');
  assert.match(plain.stderr, /liblilv-0\.so: cannot open shared object file/);
  const r = rig();
  bundle(r.lv2, 'testgain', 'urn:test:gain', 'Test Gain');
  descriptor(r.desc, 'testgain.json', 'urn:test:gain', 'scanned-lv2-compressor.json', (d) => {
    d.controls = d.controls.filter((c) => c.id === 'makeup');
  });
  const run = r.run(['--dry-run', '--no-scan'], undefined, {}, hide());
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.doesNotMatch(run.stderr, /python3-lilv is not installed/);
  assert.match(run.stdout, /would write .*testgain\.lv2 for urn:test:gain/);
});

test('the bundles may share a folder with plugins: a plugin there still gets a GUI, under a name of its own', { skip }, () => {
  const r = rig();
  bundle(r.out, 'testgain', 'urn:test:gain', 'Test Gain'); // a hand-installed plugin in the folder the GUIs go to
  descriptor(r.desc, 'testgain.json', 'urn:test:gain', 'scanned-lv2-compressor.json', (d) => {
    d.controls = d.controls.filter((c) => c.id === 'makeup');
  });
  const run = r.run(['--no-scan'], r.out);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /wrote .*omx-modgui-testgain\.lv2 for urn:test:gain/);
  assert.deepEqual(readdirSync(join(r.out, 'testgain.lv2')).sort(), ['manifest.ttl', 'testgain.so'.replace('.so', '.ttl')].sort());
  const again = r.run(['--no-scan'], r.out);
  assert.match(again.stdout, /0 written, 1 up to date/, 'our own bundle is not mistaken for the plugin shipping a GUI');
  assert.equal(r.bundles().filter((n) => n.startsWith('omx-modgui-')).length, 1);
});

test('--check without LV2_PATH reads the search list plugin-hostd and plugin-qualify read, and says where the GUIs go', () => {
  const r = rig();
  const run = r.run(['--check'], null);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^LV2 search list \(from plugin-hostd's default\):$/m);
  assert.match(run.stdout, /^ {2}\/usr\/lib64\/lv2\n {2}\/usr\/lib\/lv2\n {2}\/usr\/local\/lib\/lv2$/m);
  assert.match(run.stdout, /modgui: it is NOT on that list/);
});

test('--check lists the CLAP search list, CLAP_PATH first, then the specification\'s', () => {
  const r = rig();
  const run = r.run(['--check'], '/x', { CLAP_PATH: '/opt/clap-a:/opt/clap-b', HOME: '/home/nobody' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /CLAP search list .*:\n {2}\/opt\/clap-a\n {2}\/opt\/clap-b\n {2}\/home\/nobody\/\.clap\n {2}\/usr\/lib\/clap$/m);
});

test('--check reads the LV2_PATH the units of the programs that show the GUIs run with, and names the one that lacks the folder', () => {
  const r = rig();
  const fake = (theirs) => {
    writeFileSync(join(r.bin, 'systemctl'), `#!/bin/sh
case "$1" in
  cat) [ "$2" = mod-ui.service ] ;;
  show) echo "HOME=/root LV2_PATH=${theirs}" ;;
esac
`, { mode: 0o755 });
  };
  fake('/usr/lib/lv2');
  const missing = r.run(['--check'], r.lv2);
  assert.match(missing.stdout, /^mod-ui: reads LV2_PATH and .*modgui is NOT on it; it will not show these GUIs until it is$/m);
  assert.doesNotMatch(missing.stdout, /^mod-host:/m, 'a unit that does not exist is not reported');
  fake(`/usr/lib/lv2:${r.out}`);
  assert.match(r.run(['--check'], r.lv2).stdout, /^mod-ui: reads LV2_PATH and .*modgui is on it$/m);
});

test('one unit for the one pass, enabled by default where systemd exists, the old two gone (descriptions-store 10)', () => {
  const units = readdirSync(join(ROOT, 'systemd')).filter((f) => f.endsWith('.service')).sort();
  assert.deepEqual(units, ['omx-panel-sync.service']);
  assert.deepEqual(readdirSync(join(ROOT, 'systemd', 'plugin-qualify-sync.service.d')).sort(), ['omx-panel-sync.conf']);
  assert.match(readFileSync(join(ROOT, 'systemd/80-omx-panel.preset'), 'utf8'), /^enable omx-panel-sync\.service$/m, 'the preset enables it');
  const spec = readFileSync(join(ROOT, 'packaging/omx-panel.spec'), 'utf8');
  assert.match(spec, /^%\{_presetdir\}\/80-omx-panel\.preset$/m, 'the rpm ships the preset');
  for (const step of ['post', 'preun', 'postun']) {
    assert.match(spec, new RegExp(`^%\\{\\?systemd_${step}:%systemd_${step} omx-panel-sync\\.service omx-panel-sync\\.path omx-panel-sync\\.timer\\}$`, 'm'), `the rpm's %${step} applies the preset to the unit and its two triggers`);
  }
  const rules = readFileSync(join(ROOT, 'debian/rules'), 'utf8');
  assert.match(rules, /^\tdh_installsystemd --no-start --no-stop-on-upgrade$/m, 'the DEB enables it and starts nothing');
  const make = readFileSync(join(ROOT, 'Makefile'), 'utf8');
  for (const f of ['bin/omx-panel-sync', 'man/omx-panel-sync.1', 'systemd/omx-panel-sync.service']) assert.ok(make.includes(f), `make install ships ${f}`);
});

test('the pass has triggers of its own, so a failed plugin-qualify sync leaves no host without its panels', () => {
  const path = readFileSync(join(ROOT, 'systemd/omx-panel-sync.path'), 'utf8');
  const watched = [...path.matchAll(/^PathChanged=(.*)$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(watched, ['/usr/lib/clap', '/usr/lib/lv2', '/usr/lib64/clap', '/usr/lib64/lv2', '/usr/local/lib/clap', '/usr/local/lib/lv2'], 'every system plugin directory, LV2 and CLAP');
  assert.match(path, /^Unit=omx-panel-sync\.service$/m);
  assert.match(path, /^WantedBy=paths\.target$/m);
  const timer = readFileSync(join(ROOT, 'systemd/omx-panel-sync.timer'), 'utf8');
  assert.match(timer, /^OnCalendar=daily$/m);
  assert.match(timer, /^Persistent=true$/m, 'a day missed while off runs at the next boot');
  assert.match(timer, /^Unit=omx-panel-sync\.service$/m);
  assert.match(timer, /^WantedBy=timers\.target$/m);
  for (const u of [path, timer]) assert.doesNotMatch(u, /^(After|Requires|BindsTo|Wants|PartOf|Requisite)=.*plugin-qualify/m, 'neither waits on plugin-qualify');
  const preset = readFileSync(join(ROOT, 'systemd/80-omx-panel.preset'), 'utf8');
  for (const u of ['service', 'path', 'timer']) assert.match(preset, new RegExp(`^enable omx-panel-sync\\.${u}$`, 'm'), `the preset enables the ${u}`);
  const spec = readFileSync(join(ROOT, 'packaging/omx-panel.spec'), 'utf8');
  const make = readFileSync(join(ROOT, 'Makefile'), 'utf8');
  for (const u of ['path', 'timer']) {
    assert.match(spec, new RegExp(`^%\\{_unitdir\\}/omx-panel-sync\\.${u}$`, 'm'), `the rpm ships the ${u}`);
    assert.ok(make.includes(`systemd/omx-panel-sync.${u}`), `make install ships the ${u}`);
  }
});

test('the one pass\'s unit runs after plugin-qualify-sync, under limits, and there is no apt hook', () => {
  const unit = readFileSync(join(ROOT, 'systemd/omx-panel-sync.service'), 'utf8');
  assert.match(unit, /^ExecStart=\/usr\/bin\/omx-panel-sync$/m, 'the unit runs the one pass');
  assert.match(unit, /^After=.*\bplugin-qualify-sync\.service\b/m, 'it waits for the sync that writes its descriptors');
  assert.doesNotMatch(unit, /^WantedBy=.*\bplugin-qualify-sync\.service\b/m, 'a Wants resolved at the sync\'s start loses the run when two scans overlap (#61)');
  assert.match(unit, /^WantedBy=multi-user\.target$/m);
  const dropin = readFileSync(join(ROOT, 'systemd/plugin-qualify-sync.service.d/omx-panel-sync.conf'), 'utf8');
  const post = dropin.match(/^ExecStartPost=-.*$/m)?.[0];
  assert.ok(post, 'the drop-in queues the pass after each scan, its failure ignored');
  assert.ok(post.indexOf('systemctl is-enabled -q omx-panel-sync.service') >= 0 && post.indexOf('is-enabled') < post.indexOf('systemctl start --no-block omx-panel-sync.service'), 'it asks is-enabled before it starts');
  assert.match(readFileSync(join(ROOT, 'Makefile'), 'utf8'), /plugin-qualify-sync\.service\.d\/omx-panel-sync\.conf/, 'make install ships the drop-in');
  assert.match(readFileSync(join(ROOT, 'packaging/omx-panel.spec'), 'utf8'), /plugin-qualify-sync\.service\.d\/omx-panel-sync\.conf/, 'the rpm lists it');
  for (const limit of ['CPUQuota=', 'MemoryMax=', 'TasksMax=', 'IOSchedulingClass=idle', 'RestrictRealtime=yes', 'Nice=19']) assert.ok(unit.includes(limit), limit);
  assert.doesNotMatch(unit, /^WantedBy=.*\bdefault\.target\b/m);
  assert.equal(existsSync(join(ROOT, 'etc/apt')), false, 'the Debian-only apt hook is gone: the sync follows the standard triggers');
  assert.doesNotMatch(readFileSync(join(ROOT, 'Makefile'), 'utf8'), /apt/);
});

// -- the look: /etc/omx/modgui-look (MODGUI_LOOK_FILE) names the look of the bundles the sync writes (docs/modgui.md)
const gainRig = () => {
  const r = rig();
  bundle(r.lv2, 'testgain', 'urn:test:gain', 'Test Gain');
  descriptor(r.desc, 'testgain.json', 'urn:test:gain', 'scanned-lv2-compressor.json', (d) => {
    d.controls = d.controls.filter((c) => c.id === 'makeup');
    d.plugin.name = 'Test Gain';
  });
  return r;
};
const faceOf = (r) => {
  const [name] = r.bundles();
  const dir = join(r.out, name, 'modgui');
  return readdirSync(dir).filter((f) => /\.(css|html)$/.test(f)).sort().map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
};

test('the look file names the look of the bundle: a changed look rewrites a fresh bundle, the unset look is the default', { skip }, () => {
  const r = gainRig();
  const file = join(r.dir, 'modgui-look');
  const first = r.run(['--no-scan'], `${r.lv2}:${r.out}`, { MODGUI_LOOK_FILE: file }); // no such file: the default look
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const vintage = faceOf(r);
  writeFileSync(file, 'console\n');
  const second = r.run(['--no-scan'], `${r.lv2}:${r.out}`, { MODGUI_LOOK_FILE: file });
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.match(second.stdout, /1 written, 0 up to date/, 'a bundle made under another look is not fresh');
  assert.notEqual(faceOf(r), vintage, 'the console look is not the vintage one');
  const third = r.run(['--no-scan'], `${r.lv2}:${r.out}`, { MODGUI_LOOK_FILE: file });
  assert.match(third.stdout, /0 written, 1 up to date/, 'the same look is fresh');
});

test('a look the file names that omx-panel does not know is named in the summary and fails nothing', { skip }, () => {
  const r = gainRig();
  const file = join(r.dir, 'modgui-look');
  writeFileSync(file, 'chrome\n');
  const run = r.run(['--no-scan'], `${r.lv2}:${r.out}`, { MODGUI_LOOK_FILE: file });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /no look 'chrome'/);
  assert.match(run.stdout, /1 could not be drawn/);
});
