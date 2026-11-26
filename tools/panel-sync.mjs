// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * panel-sync.mjs — the store half of `omx-panel-sync`, the one pass (docs/descriptions-store.md section 6, lane 4):
 * each LV2 plugin on the search list gets its entry once (`describePlugin`: read, else derived and written to the layer
 * of the effective uid), then that layer loses the entries of plugins no longer installed: an `lv2` key whose URI no
 * bundle declares now, or whose binary's SHA-256 is another. No other layer is opened for writing, and CLAP keys are kept
 * (the pass does not enumerate CLAP plugins). The generators run after it, from bin/omx-panel-sync.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describePlugin, madeBy, PluginRefusal } from './describe-plugin.mjs';
import { binaryOf, installedBundles, readInstalledBundle } from './lv2-complement.mjs';

/** The store command once; { status, stdout, stderr }, status null when it is not on PATH. */
const store = (args, env) => {
  const r = spawnSync('omx-panel-store', args, { encoding: 'utf8', env, maxBuffer: 64 << 20 });
  return r.error?.code === 'ENOENT' ? { status: null, stdout: '', stderr: '' } : r;
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
      let sha = null;
      try {
        sha = createHash('sha256').update(readFileSync(fileURLToPath(binaryOf(b, uri)))).digest('hex');
      } catch {
        // no binary to key it by: it is not installed as a plugin a host can load
      }
      out.set(uri, { bundle: b, sha });
    }
  }
  return out;
}

/**
 * The pass's store half. Returns { described, noDescriptor, pruned, failed } and logs each plugin it could not store and
 * each key it pruned; `failed` counts the store's refusals (a plugin with no descriptor is no failure: nothing to derive).
 * @param {{ lv2Path: string, env?: NodeJS.ProcessEnv, log?: (line: string) => void }} o
 */
export function pass({ lv2Path, env = process.env, log = () => {} }) {
  const result = { described: 0, noDescriptor: 0, pruned: 0, failed: 0, store: true };
  const check = store(['check'], env);
  if (check.status === null || (check.status !== 0 && check.stderr.startsWith('panel-store.absent'))) {
    log('no descriptions store (no omx-panel-store, or no base): nothing to store or prune');
    return { ...result, store: false };
  }
  const plugins = installed(lv2Path);
  const made = madeBy();
  for (const [uri, { bundle, sha }] of plugins) {
    if (sha === null) continue;
    try {
      describePlugin({ target: `lv2:${uri}`, bundle, sha256: sha, env, madeBy: made });
      result.described++;
    } catch (e) {
      if (!(e instanceof PluginRefusal)) throw e;
      if (e.reason === 'no-descriptor') result.noDescriptor++;
      else result.failed++;
      log(`${uri}: ${e.message}`);
    }
  }
  const list = store(['list'], env);
  if (list.status !== 0) {
    result.failed++;
    log(`the layer's keys cannot be listed: ${list.stderr.trim()}`);
    return result;
  }
  for (const line of list.stdout.split('\n').filter(Boolean)) {
    const [sha, format, uri] = line.split('\t');
    if (format !== 'lv2' || plugins.get(uri)?.sha === sha) continue;
    const r = store(['remove', '--sha256', sha, '--format', format, '--uri', uri], env);
    if (r.status === 0) {
      result.pruned++;
      log(`pruned ${format}:${uri} (${sha.slice(0, 12)}): ${plugins.has(uri) ? 'another binary is installed' : 'no longer installed'}`);
    } else {
      result.failed++;
      log(`${format}:${uri}: cannot prune: ${r.stderr.trim()}`);
    }
  }
  return result;
}
