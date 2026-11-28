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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPluginPorts } from './group-infer.mjs';
import { describeStored } from './describe.mjs';
import { binaryOf, installedBundles, pluginTriples, readInstalledBundle, Refusal, verdictOf } from './lv2-complement.mjs';
import { entryOf, RULE_OF_WORD, withStoredGroups } from './store-entry.mjs';
import { installedDescriptorFiles } from './vocabulary.mjs';

/** plugin-hostd's LV2 search list, the one omx-modgui-sync and plugin-qualify read when LV2_PATH is unset. */
export const LV2_DEFAULT_PATH = '/usr/lib64/lv2:/usr/lib/lv2:/usr/local/lib/lv2';
/** How long `plugin-hostd-probe describe` may take, as omx-modgui-sync gives it. */
const PROBE_TIMEOUT_MS = 30000;

/** A failure the command reports and exits 1 on; `reason` is `no-descriptor` when nothing could be derived from. */
export class PluginRefusal extends Error {
  constructor(message, reason = 'store') {
    super(message);
    this.reason = reason;
  }
}

/** `omx-panel <version>`: the made_by of an entry this package derives (package.json beside tools/, or two up in dist). */
export function madeBy() {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = ['..', '../..'].map((up) => join(here, up, 'package.json')).find(existsSync);
  return `omx-panel ${file ? JSON.parse(readFileSync(file, 'utf8')).version : 'unknown'}`;
}

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
export function storeCommand(args, { input, env } = {}) {
  const r = spawnSync('omx-panel-store', args, { encoding: 'utf8', input, env, maxBuffer: 64 << 20 });
  if (r.error?.code === 'ENOENT') throw new PluginRefusal('omx-panel-store is not on PATH: install omx-panel-store');
  if (r.error) throw new PluginRefusal(`omx-panel-store ${args[0]}: ${r.error.message}`);
  if (r.status !== 0) throw new PluginRefusal(r.stderr.trim() || `omx-panel-store ${args[0]} exited ${r.status}`);
  return r.stdout;
}

/** The installed bundle declaring `uri`, the first on the search list. */
export function bundleOf(uri, lv2Path) {
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
  throw new PluginRefusal(`${target}: no descriptor: none given, none installed, none in ${descriptorDirs(env).join(':')}, and plugin-hostd-probe ${r.error?.code === 'ENOENT' ? 'is not on PATH' : 'made none'}`, 'no-descriptor');
}

/**
 * One plugin's entry, derived (docs/descriptions-store.md 3.4): an LV2 plugin's descriptor takes the complement's
 * verdict over its bundle as its controls' groups, then `describeStored`, then the store's codec. The one derivation of
 * every producer: `describe --plugin --store`, the pass and the base builder.
 */
export function deriveEntry({ descriptor, where, bundle, uri, source, rules, madeBy: made }) {
  const verdict = bundle ? verdictOf(bundle, uri) : null;
  const derived = describeStored(withStoredGroups(descriptor, verdict), { where });
  return entryOf({ derived, verdict, source, rules, madeBy: made });
}

/**
 * The call. Returns the `get` answer's text, as the store printed it: the entry any layer held, or the one this call
 * derived and wrote. Throws a PluginRefusal for what the command reports.
 * `bundle` is the installed bundle of an LV2 target when the caller has read it (the complement), else it is found;
 * `derive` false only reads (a PluginRefusal `no-entry` when no layer holds the key): a dry run writes no entry.
 * @param {{ target: string, descriptor?: string, sha256?: string, madeBy?: string, env?: NodeJS.ProcessEnv, bundle?: any }} o
 */
export function describePlugin({ target, descriptor: given, sha256, madeBy: made = madeBy(), env = process.env, bundle: read, derive = true }) {
  const t = parseTarget(target);
  if (!t) throw new PluginRefusal(`${target} is no plugin target: lv2:<uri> or clap:<path>#<id>`);
  if (sha256 !== undefined && !/^[0-9a-f]{64}$/.test(sha256)) throw new PluginRefusal(`--sha256 ${sha256} is not 64 lowercase hex digits`);
  let bundle, found;
  const scratch = [];
  try {
    if (t.format === 'lv2') {
      bundle = read ?? bundleOf(t.uri, env.LV2_PATH || LV2_DEFAULT_PATH);
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
    const source = storeCommand(['source', '--format', t.format, '--path', t.input], { env }).trim();
    const get = () => storeCommand(['get', ...key, '--source', source, '--json'], { env });
    const held = get();
    if (held.trim() !== 'null') return held;
    if (!derive) throw new PluginRefusal(`${target}: no layer holds an entry`, 'no-entry');

    found ??= findDescriptor(t, target, given, env);
    if (found.scratch && !scratch.includes(found.scratch)) scratch.push(found.scratch);
    const entry = deriveEntry({ descriptor: found.descriptor, where: found.file, bundle, uri: t.uri, source, rules: Number(storeCommand(['rules'], { env }).trim()), madeBy: made });
    storeCommand(['put', ...key], { input: JSON.stringify(entry), env });
    return get();
  } finally {
    for (const d of scratch) rmSync(d, { recursive: true, force: true });
  }
}

/**
 * The complement's verdicts from the store (docs/descriptions-store.md 6, lane 4): a function of an installed bundle and
 * a plugin's URI giving the verdict the store holds for it (derived and written first when no layer holds it), or null
 * when there is no store: no `omx-panel-store` on PATH, or no base (`panel-store.absent`). A plugin with no descriptor has
 * no entry: `onNoEntry(uri, message)` is told and the rules infer it. Any other refusal of the store is a Refusal
 * `store-refused` for the bundle.
 * `derive` false reads only (a dry run or a check), and a key no layer holds is inferred.
 * @param {{ env?: NodeJS.ProcessEnv, onNoEntry?: (uri: string, message: string) => void, derive?: boolean }} [o]
 */
export function storeVerdicts({ env = process.env, onNoEntry = () => {}, derive = true } = {}) {
  const r = spawnSync('omx-panel-store', ['check'], { encoding: 'utf8', env });
  if (r.error?.code === 'ENOENT' || (r.status !== 0 && r.stderr.startsWith('panel-store.absent'))) return null;
  const made = madeBy();
  return (bundle, uri) => {
    let answer;
    try {
      answer = JSON.parse(describePlugin({ target: `lv2:${uri}`, bundle, env, madeBy: made, derive }));
    } catch (e) {
      if (!(e instanceof PluginRefusal)) throw e;
      if (e.reason !== 'no-descriptor' && e.reason !== 'no-entry') throw new Refusal('store-refused', `${uri}: ${e.message}`);
      onNoEntry(uri, e.message);
      return verdictOf(bundle, uri);
    }
    return verdictOfEntry(answer, bundle, uri);
  };
}

/** The complement's form of a stored verdict: a declared group keeps the plugin's own node, the pg:group its ports state. */
export function verdictOfEntry(answer, bundle, uri) {
  if (!answer.group_outcome) throw new Refusal('store-refused', `${uri}: the stored entry holds no port-group verdict`);
  const ports = new Map(readPluginPorts(pluginTriples(bundle, uri), uri).ports.map((p) => [p.symbol, p]));
  const groups = answer.groups.map((g) => {
    const out = { symbol: g.symbol, name: g.name, displayPriority: g.display_priority, ports: [...g.ports], rule: RULE_OF_WORD.get(g.rule) };
    if (!g.declared) return out;
    const node = ports.get(g.ports[0])?.group;
    if (node === undefined) throw new Refusal('store-refused', `${uri}: the stored group ${g.symbol} is declared, but its port ${g.ports[0]} states no pg:group`);
    return { ...out, node };
  });
  return answer.group_outcome === 'grouped' ? { outcome: answer.group_outcome, groups } : { outcome: answer.group_outcome, reason: answer.group_reason };
}
