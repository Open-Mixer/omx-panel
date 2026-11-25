// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * gui-stage.mjs — `omx-panel gui-stage --set <file> --descriptors <dir> --package <name> --out <dir> [--look <look>]`
 * (docs/descriptions-store.md 6; owner decision 2026-11-19: generated GUI files of a KNOWN plugin set are shipped, KEY-GATED).
 *
 * `--set` lists the installed bundles of the set, one path per line (an LV2 bundle directory; blank lines and lines starting
 * with # are ignored); a path that is no installed bundle is a named error and nothing is staged. Per plugin it stages, under
 * <out>/<package>/<sha256 of the plugin's binary>/modgui/, the MOD GUI omx-panel makes from the plugin's descriptor (the one
 * of --descriptors that names the plugin's uri), and writes ONE <out>/<package>/keys.json: per plugin its binary's sha256,
 * format, uri and the hash of every staged file, and the look the files were made under. A host activates a staged file only
 * when the key matches the installed plugin's binary; otherwise it generates locally. The bytes are deterministic: two builds
 * give the same tree. omx-panel never builds third-party binaries: the caller names the installed bundles of its set.
 * Only the MOD GUI is staged here; the LV2 complement and the LV2 desktop UI are the next formats of the same keys.json.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '@openmixer/omx-contract/entry';
import { LOOK_SETTING } from './modgui-gen.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PANEL = join(HERE, '..', 'bin', 'omx-panel.mjs');
const USAGE = 'usage: omx-panel gui-stage --set <file> --descriptors <dir> --package <name> --out <dir> [--look <vintage|console|3d>]\n';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The installed LV2 bundle at `dir`: its plugin uri, binary file and binary's sha256. Throws a named error when it is none. */
function readBundle(dir) {
  const manifest = join(dir, 'manifest.ttl');
  if (!existsSync(dir) || !statSync(dir).isDirectory() || !existsSync(manifest)) throw new Error(`${dir}: not an installed LV2 bundle (no manifest.ttl)`);
  const ttl = readFileSync(manifest, 'utf8');
  const uri = /<([^>]+)>\s+a\s+lv2:Plugin\b/.exec(ttl)?.[1];
  const binary = /lv2:binary\s+<([^>]+)>/.exec(ttl)?.[1];
  if (!uri || !binary) throw new Error(`${dir}: manifest.ttl names no lv2:Plugin with an lv2:binary`);
  const file = join(dir, binary);
  if (!existsSync(file)) throw new Error(`${dir}: its binary ${binary} is not there`);
  return { dir, uri, binary: file, sha256: sha256(readFileSync(file)) };
}

/** The descriptor file of `uri` in `dir`, or null. */
function descriptorOf(dir, uri) {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    try {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (d?.plugin?.uri === uri || d?.plugin?.id === uri) return join(dir, f);
    } catch { /* not a descriptor */ }
  }
  return null;
}

/** Every file under `root`: relative path -> sha256, in sorted order. */
function hashTree(root) {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(root, p)] = sha256(readFileSync(p));
    }
  };
  walk(root);
  return out;
}

function main(argv) {
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const [setFile, descDir, pkg, outDir] = [opt('--set'), opt('--descriptors'), opt('--package'), opt('--out')];
  const look = opt('--look');
  if (!setFile || !descDir || !pkg || !outDir) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const lines = readFileSync(setFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const bundles = [];
  const refused = [];
  for (const l of lines) {
    try {
      bundles.push(readBundle(resolve(l)));
    } catch (e) {
      refused.push(e.message);
    }
  }
  if (refused.length) {
    for (const r of refused) process.stderr.write(`gui-stage: ${r}\n`);
    process.exit(1);
  }
  const tmp = mkdtempSync(join(tmpdir(), 'omx-gui-stage-'));
  const stage = join(tmp, pkg);
  mkdirSync(stage, { recursive: true });
  const plugins = [];
  try {
    for (const b of bundles.sort((x, y) => (x.uri < y.uri ? -1 : x.uri > y.uri ? 1 : 0))) {
      const desc = descriptorOf(descDir, b.uri);
      if (!desc) {
        process.stdout.write(`gui-stage: ${b.uri}: no descriptor in ${descDir}, not staged\n`);
        continue;
      }
      const made = join(tmp, 'made', `${plugins.length}.lv2`);
      const run = spawnSync(process.execPath, [PANEL, 'modgui', '--descriptor', desc, '--out', made, ...(look ? ['--look', look] : [])], { encoding: 'utf8' });
      if (run.status !== 0) {
        process.stdout.write(`gui-stage: ${b.uri}: omx-panel modgui refused (${(run.stderr || run.stdout).trim().split('\n').pop()}), not staged\n`);
        continue;
      }
      const dest = join(stage, b.sha256, 'modgui');
      mkdirSync(dest, { recursive: true });
      cpSync(join(made, 'modgui.ttl'), join(dest, 'modgui.ttl'));
      cpSync(join(made, 'modgui'), join(dest, 'modgui'), { recursive: true });
      plugins.push({ sha256: b.sha256, format: 'lv2', uri: b.uri, formats: { modgui: { files: hashTree(dest) } } });
    }
    const keys = { schema: 1, package: pkg, look: look ?? LOOK_SETTING.default, plugins };
    writeFileSync(join(stage, 'keys.json'), `${JSON.stringify(keys, null, 2)}\n`);
    mkdirSync(outDir, { recursive: true });
    const final = join(outDir, pkg);
    rmSync(final, { recursive: true, force: true });
    cpSync(stage, final, { recursive: true });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  process.stdout.write(`gui-stage: ${plugins.length} plugin(s) staged in ${join(outDir, pkg)}\n`);
}

if (isMain(import.meta.url)) main(process.argv.slice(2));
export { main as guiStage };
