// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * panel-sync.mjs — the store half of `omx-panel-sync`, the one pass (docs/descriptions-store.md section 6): each
 * LV2 plugin on the LV2 search list and each CLAP plugin `omx-clap-scan` finds on the CLAP search list gets
 * its entry once (`describePlugin`: read, else derived and written to the layer of the effective uid), then that layer
 * loses the entries of plugins no longer installed: a key whose URI or CLAP id no installed plugin declares now, or whose
 * binary's SHA-256 is another. No other layer is opened for writing. With no `omx-clap-scan` on PATH the CLAP plugins
 * cannot be listed: none is described and no CLAP key is pruned, and the pass says so once. The generators run after
 * it, from bin/omx-panel-sync.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describePlugin, madeBy, PluginRefusal } from './describe-plugin.mjs';
import { binaryOf, installedBundles, readInstalledBundle } from './lv2-complement.mjs';

/** The store command once; { status, stdout, stderr }, status null when it is not on PATH. */
const store = (args, env) => {
  const r = spawnSync('omx-panel-store', args, { encoding: 'utf8', env, maxBuffer: 64 << 20 });
  return r.error?.code === 'ENOENT' ? { status: null, stdout: '', stderr: '' } : r;
};

const sha256Of = (file) => {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return null; // no binary to key it by: it is not installed as a plugin a host can load
  }
};

/** Each installed LV2 plugin, by the first bundle on the list declaring it, with its binary's SHA-256 (null: unreadable). */
function installed(lv2Path) {
  const out = new Map();
  for (const dir of installedBundles(lv2Path)) {
    let b;
    try {
      b = readInstalledBundle(dir);
    } catch {
      continue;
    }
    for (const uri of b?.plugins ?? []) {
      if (out.has(uri)) continue;
      let binary = null;
      try {
        binary = fileURLToPath(binaryOf(b, uri));
      } catch {
        // no binary to key it by: it is not installed as a plugin a host can load
      }
      out.set(uri, { bundle: b, sha: binary && sha256Of(binary) });
    }
  }
  return out;
}

/** The CLAP search list when CLAP_PATH is unset: ~/.clap, then the system places, as `omx-clap-scan` reads it. */
export function clapDefaultPath(env = process.env) {
  return [env.HOME ? join(env.HOME, '.clap') : null, '/usr/lib64/clap', '/usr/lib/clap'].filter(Boolean).join(':');
}

/**
 * Each installed CLAP plugin by its id, the first file on the list holding it, with that file's SHA-256 (null:
 * unreadable); null when `omx-clap-scan` is not on PATH or its answer cannot be read, so nothing can be said of what is
 * installed. A file the scanner cannot read holds no plugin; an empty list (no directory exists) is no plugin installed.
 */
export function installedClap(clapPath, { env = process.env, log = () => {} } = {}) {
  const dirs = clapPath.split(':').filter((d) => d && existsSync(d));
  const out = new Map();
  if (dirs.length === 0) return out;
  const r = spawnSync('omx-clap-scan', ['--json', ...dirs], { encoding: 'utf8', env, maxBuffer: 256 << 20 });
  if (r.error?.code === 'ENOENT') {
    log('no omx-clap-scan on PATH (omx-clap-host): the CLAP plugins are neither described nor pruned');
    return null;
  }
  let scan;
  try {
    scan = JSON.parse(r.stdout);
  } catch {
    log(`omx-clap-scan answered no JSON (exit ${r.status}): the CLAP plugins are neither described nor pruned: ${r.stderr.trim()}`);
    return null;
  }
  for (const file of scan.files ?? []) {
    if (!Array.isArray(file.plugins)) continue;
    const sha = sha256Of(file.path);
    for (const p of file.plugins) if (typeof p?.id === 'string' && p.id && !out.has(p.id)) out.set(p.id, { path: file.path, sha });
  }
  return out;
}

/** One plugin described into the store, counted into `result`. */
function describeOne(target, o, result, log) {
  try {
    describePlugin({ target, ...o });
    result.described++;
  } catch (e) {
    if (!(e instanceof PluginRefusal)) throw e;
    if (e.reason === 'no-descriptor') result.noDescriptor++;
    else result.failed++;
    log(`${target}: ${e.message}`);
  }
}

/**
 * The pass's store half. Returns { described, noDescriptor, pruned, failed } and logs each plugin it could not store and
 * each key it pruned; `failed` counts the store's refusals (a plugin with no descriptor is no failure: nothing to derive).
 * @param {{ lv2Path: string, clapPath?: string, env?: NodeJS.ProcessEnv, log?: (line: string) => void }} o
 */
export function pass({ lv2Path, env = process.env, clapPath = env.CLAP_PATH || clapDefaultPath(env), log = () => {} }) {
  const result = { described: 0, noDescriptor: 0, pruned: 0, failed: 0, store: true };
  const check = store(['check'], env);
  if (check.status === null || (check.status !== 0 && check.stderr.startsWith('panel-store.absent'))) {
    log('no descriptions store (no omx-panel-store, or no base): nothing to store or prune');
    return { ...result, store: false };
  }
  const plugins = installed(lv2Path);
  const made = madeBy();
  for (const [uri, { bundle, sha }] of plugins) {
    if (sha !== null) describeOne(`lv2:${uri}`, { bundle, sha256: sha, env, madeBy: made }, result, log);
  }
  const claps = installedClap(clapPath, { env, log });
  for (const [id, { path, sha }] of claps ?? []) {
    if (sha !== null) describeOne(`clap:${path}#${id}`, { sha256: sha, env, madeBy: made }, result, log);
  }
  const installedOf = { lv2: plugins, clap: claps };
  const list = store(['list'], env);
  if (list.status !== 0) {
    result.failed++;
    log(`the layer's keys cannot be listed: ${list.stderr.trim()}`);
    return result;
  }
  for (const line of list.stdout.split('\n').filter(Boolean)) {
    const [sha, format, uri] = line.split('\t');
    const now = installedOf[format];
    if (!now || now.get(uri)?.sha === sha) continue;
    const r = store(['remove', '--sha256', sha, '--format', format, '--uri', uri], env);
    if (r.status === 0) {
      result.pruned++;
      log(`pruned ${format}:${uri} (${sha.slice(0, 12)}): ${now.has(uri) ? 'another binary is installed' : 'no longer installed'}`);
    } else {
      result.failed++;
      log(`${format}:${uri}: cannot prune: ${r.stderr.trim()}`);
    }
  }
  return result;
}
