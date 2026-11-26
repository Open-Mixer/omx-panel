// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * base-build.mjs — `omx-panel base --in <inputs> --out <file>`: the descriptions store's base, built centrally
 * (docs/descriptions-store.md section 6, lane 5). Each input directory (in byte order of its name) holds `key.json`
 * ({ sha256, format, uri }: the reference set's binary), `descriptor.json`, and for an LV2 plugin `bundle/` (its manifest
 * and TTL). Each entry is the one derivation every producer makes (`deriveEntry`), its source the store's hash of the
 * input as installed; the entries go to `omx-panel-store build`, which writes the file. `built_from` is the BUILT_FROM.txt
 * beside the inputs when `git archive` substituted it, else the commit git says the inputs are at, else the build is
 * refused `built-from-unknown`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deriveEntry, madeBy, PluginRefusal, storeCommand } from './describe-plugin.mjs';
import { readInstalledBundle } from './lv2-complement.mjs';

const COMMIT = /^[0-9a-f]{40}$/;

/** The commit the inputs were built from: BUILT_FROM.txt (substituted by git archive), else git's HEAD, else a refusal. */
export function builtFrom(inDir, env = process.env) {
  const file = join(dirname(inDir), 'BUILT_FROM.txt');
  const stated = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  if (COMMIT.test(stated)) return stated;
  const git = spawnSync('git', ['-C', inDir, 'rev-parse', 'HEAD'], { encoding: 'utf8', env });
  const head = git.status === 0 ? git.stdout.trim() : '';
  if (COMMIT.test(head)) return head;
  throw new PluginRefusal(`built-from-unknown: ${file} holds no commit (${stated || 'absent'}) and ${inDir} is not in a git checkout`, 'built-from-unknown');
}

const byteOrder = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** The base from `inDir` into `out`. Throws a PluginRefusal for what the command reports. */
export function buildBase({ inDir, out, env = process.env }) {
  const commit = builtFrom(inDir, env);
  const rules = Number(storeCommand(['rules'], { env }).trim());
  const made = madeBy();
  const entries = readdirSync(inDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(byteOrder).map((name) => {
    const dir = join(inDir, name);
    const read = (f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch (e) {
        throw new PluginRefusal(`input ${name}: ${f} cannot be read: ${e.message}`);
      }
    };
    const key = read('key.json');
    const descriptorFile = join(dir, 'descriptor.json');
    const descriptor = read('descriptor.json');
    const bundle = key.format === 'lv2' ? readInstalledBundle(join(dir, 'bundle')) : null;
    if (key.format === 'lv2' && !bundle?.plugins.includes(key.uri)) throw new PluginRefusal(`input ${name}: bundle/ declares no ${key.uri}`);
    const input = bundle ? bundle.dir : descriptorFile;
    const source = storeCommand(['source', '--format', key.format, '--path', input], { env }).trim();
    const entry = deriveEntry({ descriptor, where: descriptorFile, bundle, uri: key.uri, source, rules, madeBy: made });
    return { sha256: key.sha256, format: key.format, uri: key.uri, entry };
  });
  storeCommand(['build', '--out', out, '--built-from', commit], { input: JSON.stringify(entries), env });
  return { entries: entries.length, builtFrom: commit };
}
