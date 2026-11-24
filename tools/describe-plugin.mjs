// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * describe-plugin.mjs — `omx-panel describe --plugin <target> [--descriptor <file>] [--sha256 <hex>] --store`
 * (docs/descriptions-store.md section 6, lane 3): one plugin, inferred once, the layer by uid.
 *
 * The store first: the key (the binary's SHA-256, the format, the URI or CLAP id) and the plugin's source as installed
 * are asked of `omx-panel-store get`; an entry any layer holds is printed and nothing is written. Else the descriptor (the
 * one given, else omx-modgui-sync's order: the installed declaration, the newest in DESCRIPTOR_DIRS,
 * `plugin-hostd-probe describe`), the LV2 groups the complement infers (`verdictOf`), the description derived over them,
 * the entry `put` into the layer of the effective uid, and the key read back and printed. One plugin, never a scan. Node
 * has no SQLite at this package's floor, so the store is reached through its command, one call per step.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeStored } from './describe.mjs';
import { binaryOf, installedBundles, readInstalledBundle, verdictOf } from './lv2-complement.mjs';
import { entryOf, withStoredGroups } from './store-entry.mjs';
import { installedDescriptorFiles } from './vocabulary.mjs';

/** plugin-hostd's LV2 search list, the one omx-modgui-sync and plugin-qualify read when LV2_PATH is unset. */
export const LV2_DEFAULT_PATH = '/usr/lib64/lv2:/usr/lib/lv2:/usr/local/lib/lv2';
/** How long `plugin-hostd-probe describe` may take, as omx-modgui-sync gives it. */
const PROBE_TIMEOUT_MS = 30000;

/** A failure the command reports and exits 1 on. */
export class PluginRefusal extends Error {}

/** `lv2:<uri>` or `clap:<path>#<id>`, the form `plugin-hostd-probe describe` takes; null for anything else. */
export function parseTarget(target) {
  if (typeof target !== 'string') return null;
  if (target.startsWith('lv2:') && target.length > 4) return { format: 'lv2', uri: target.slice(4) };
  const m = /^clap:(.+)#([^#]+)$/.exec(target);
  return m ? { format: 'clap', path: m[1], uri: m[2] } : null;
}

const sha256Of = (file) => {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch (e) {
    throw new PluginRefusal(`the binary ${file} cannot be read to make its key: ${e.code ?? e.message}`);
  }
};

/** The store command, run once; its stdout, or a refusal carrying its own code and text. */
function store(args, { input, env } = {}) {
  const r = spawnSync('omx-panel-store', args, { encoding: 'utf8', input, env, maxBuffer: 64 << 20 });
  if (r.error?.code === 'ENOENT') throw new PluginRefusal('omx-panel-store is not on PATH: install omx-panel-store');
  if (r.error) throw new PluginRefusal(`omx-panel-store ${args[0]}: ${r.error.message}`);
  if (r.status !== 0) throw new PluginRefusal(r.stderr.trim() || `omx-panel-store ${args[0]} exited ${r.status}`);
  return r.stdout;
}

/** The installed bundle declaring `uri`, the first on the search list. */
function bundleOf(uri, lv2Path) {
  for (const dir of installedBundles(lv2Path)) {
    let b;
    try {
      b = readInstalledBundle(dir);
    } catch {
      continue; // a bundle the reader refuses is not this plugin's answer
    }
    if (b?.plugins.includes(uri)) return b;
  }
  throw new PluginRefusal(`lv2:${uri} is declared by no bundle on the LV2 search list ${lv2Path}`);
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
/** Whether descriptor `d` is of the plugin: an LV2 URI by any declaration naming it (omx-modgui-sync's rule), a CLAP id by a CLAP descriptor. */
const names = (d, t, { declaration = false } = {}) => {
  const p = d?.plugin;
  if (!p || !Array.isArray(d.controls)) return false;
  if (t.format === 'clap') return p.format === 'clap' && p.id === t.uri;
  return (declaration ? ['lv2', 'clap'] : ['lv2']).includes(p.format) && (p.uri ?? (p.format === 'lv2' ? p.id : undefined)) === t.uri;
};

/** The scanned descriptor directories: DESCRIPTOR_DIRS, else omx-modgui-sync's place for the effective uid. */
function descriptorDirs(env) {
  if (env.DESCRIPTOR_DIRS) return env.DESCRIPTOR_DIRS.split(':').filter(Boolean);
  if (process.geteuid?.() === 0) return ['/var/lib/omx/descriptors'];
  return [join(env.XDG_DATA_HOME || join(env.HOME ?? '', '.local', 'share'), 'omx', 'descriptors')];
}

/**
 * The plugin's descriptor and the file it was read from: the one given, else the installed declaration, else the newest
 * of DESCRIPTOR_DIRS, else one `plugin-hostd-probe describe` makes (kept in a file the caller removes).
 */
function findDescriptor(t, target, given, env) {
  if (given) {
    const d = readJson(given);
    if (!d) throw new PluginRefusal(`the descriptor ${given} cannot be read as JSON`);
    return { descriptor: d, file: given };
  }
  for (const file of installedDescriptorFiles()) {
    const d = readJson(file);
    if (names(d, t, { declaration: true })) return { descriptor: d, file };
  }
  let newest = null;
  for (const dir of descriptorDirs(env)) {
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f));
    } catch {
      continue;
    }
    for (const file of files) {
      const d = readJson(file);
      if (!names(d, t)) continue;
      const mtime = statSync(file).mtimeMs;
      if (!newest || mtime > newest.mtime) newest = { descriptor: d, file, mtime };
    }
  }
  if (newest) return { descriptor: newest.descriptor, file: newest.file };
  const r = spawnSync('plugin-hostd-probe', ['describe', target], { encoding: 'utf8', env, timeout: PROBE_TIMEOUT_MS, maxBuffer: 64 << 20 });
  const d = r.status === 0 ? (() => { try { return JSON.parse(r.stdout); } catch { return null; } })() : null;
  if (d && Array.isArray(d.controls)) {
    const dir = mkdtempSync(join(tmpdir(), 'omx-panel-describe-'));
    const file = join(dir, 'descriptor.json');
    writeFileSync(file, r.stdout);
    return { descriptor: d, file, scratch: dir };
  }
  throw new PluginRefusal(`${target}: no descriptor: none given, none installed, none in ${descriptorDirs(env).join(':')}, and plugin-hostd-probe ${r.error?.code === 'ENOENT' ? 'is not on PATH' : 'made none'}`);
}

/**
 * The call. Returns the `get` answer's text, as the store printed it: the entry any layer held, or the one this call
 * derived and wrote. Throws a PluginRefusal for what the command reports.
 * @param {{ target: string, descriptor?: string, sha256?: string, madeBy: string, env?: NodeJS.ProcessEnv }} o
 */
export function describePlugin({ target, descriptor: given, sha256, madeBy, env = process.env }) {
  const t = parseTarget(target);
  if (!t) throw new PluginRefusal(`${target} is no plugin target: lv2:<uri> or clap:<path>#<id>`);
  if (sha256 !== undefined && !/^[0-9a-f]{64}$/.test(sha256)) throw new PluginRefusal(`--sha256 ${sha256} is not 64 lowercase hex digits`);
  let bundle, found;
  const scratch = [];
  try {
    if (t.format === 'lv2') {
      bundle = bundleOf(t.uri, env.LV2_PATH || LV2_DEFAULT_PATH);
      t.binary = fileURLToPath(binaryOf(bundle, t.uri));
      t.input = bundle.dir;
    } else {
      // a CLAP entry's source is the descriptor it is derived from, so it is found before the store is asked
      found = findDescriptor(t, target, given, env);
      if (found.scratch) scratch.push(found.scratch);
      t.binary = t.path;
      t.input = found.file;
    }
    const key = ['--sha256', sha256 ?? sha256Of(t.binary), '--format', t.format, '--uri', t.uri];
    const source = store(['source', '--format', t.format, '--path', t.input], { env }).trim();
    const get = () => store(['get', ...key, '--source', source, '--json'], { env });
    const held = get();
    if (held.trim() !== 'null') return held;

    found ??= findDescriptor(t, target, given, env);
    if (found.scratch && !scratch.includes(found.scratch)) scratch.push(found.scratch);
    const verdict = bundle ? verdictOf(bundle, t.uri) : null;
    const derived = describeStored(withStoredGroups(found.descriptor, verdict), { where: found.file });
    const rules = Number(store(['rules'], { env }).trim());
    const entry = entryOf({ derived, verdict, source, rules, madeBy });
    store(['put', ...key], { input: JSON.stringify(entry), env });
    return get();
  } finally {
    for (const d of scratch) rmSync(d, { recursive: true, force: true });
  }
}
