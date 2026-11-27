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
 *
 * `--set <file>` (repeated; `base/sets/<set>.json`, written by `omx-panel base-inputs`) holds the built base to its
 * reference sets: every plugin a set lists, in every format it lists, is answered from the base with a description that
 * has controls, or the build is refused `base-incomplete` naming each one that is not, and no file is left. An empty set
 * is refused: a set that names nothing would hold an empty base to nothing. `checkBase` is the same check over a
 * built file (a package's), from the inputs it was built from.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/** The input directories under `inDir`, in byte order of their names, each with its key. */
function inputDirs(inDir) {
  return readdirSync(inDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(byteOrder).map((name) => {
    const dir = join(inDir, name);
    try {
      return { name, dir, key: JSON.parse(readFileSync(join(dir, 'key.json'), 'utf8')) };
    } catch (e) {
      throw new PluginRefusal(`input ${name}: key.json cannot be read: ${e.message}`);
    }
  });
}

/** A set file's members as [format, uri] pairs; a set that names nothing is refused. */
function setKeys(file) {
  let set;
  try {
    set = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new PluginRefusal(`the set ${file} cannot be read: ${e.message}`);
  }
  const keys = (Array.isArray(set?.plugins) ? set.plugins : []).flatMap((p) => ['lv2', 'clap'].filter((f) => typeof p?.[f] === 'string').map((f) => [f, p[f]]));
  if (keys.length === 0) throw new PluginRefusal(`the set ${file} names no plugin: an empty set is no reference set`, 'base-incomplete');
  return keys;
}

/**
 * Holds the base file `base` to the sets `sets`: each member answered from the base alone with a description that has
 * controls. Throws a PluginRefusal `base-incomplete` naming every member that is not.
 */
export function checkBase({ base, inDir, sets, env = process.env }) {
  const inputs = inputDirs(inDir);
  const scratch = mkdtempSync(join(tmpdir(), 'omx-panel-base-check-'));
  // the base alone: no system or user layer the check could read an answer from
  const only = { ...env, OMX_PANEL_STORE_BASE: base, OMX_PANEL_STORE_SYSTEM: join(scratch, 'system.sqlite'), OMX_PANEL_STORE_USER: join(scratch, 'user.sqlite') };
  const missing = [];
  let held = 0;
  try {
    for (const file of sets) {
      for (const [format, uri] of setKeys(file)) {
        const input = inputs.find((i) => i.key.format === format && i.key.uri === uri);
        if (!input) {
          missing.push(`${format}:${uri} (no input)`);
          continue;
        }
        const at = format === 'lv2' ? join(input.dir, 'bundle') : join(input.dir, 'descriptor.json');
        const source = storeCommand(['source', '--format', format, '--path', at], { env: only }).trim();
        const answer = JSON.parse(storeCommand(['get', '--sha256', input.key.sha256, '--format', format, '--uri', uri, '--source', source, '--json'], { env: only }));
        if (answer === null) missing.push(`${format}:${uri} (not in the base)`);
        else if (answer.refused) missing.push(`${format}:${uri} (refused ${answer.refused})`);
        else if (!Array.isArray(answer.controls) || answer.controls.length === 0) missing.push(`${format}:${uri} (no controls)`);
        else held++;
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (missing.length) throw new PluginRefusal(`base-incomplete: ${missing.length} of the sets' keys have no description with controls in ${base}: ${missing.join(', ')}`, 'base-incomplete');
  return { held };
}

/** The base from `inDir` into `out`, held to `sets`. Throws a PluginRefusal for what the command reports. */
export function buildBase({ inDir, out, sets = [], env = process.env }) {
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
  if (sets.length === 0) return { entries: entries.length, builtFrom: commit };
  try {
    const { held } = checkBase({ base: out, inDir, sets, env });
    return { entries: entries.length, builtFrom: commit, held };
  } catch (e) {
    rmSync(out, { force: true });
    throw e;
  }
}
