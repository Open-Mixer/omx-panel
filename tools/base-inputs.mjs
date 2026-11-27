// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * base-inputs.mjs — `omx-panel base-inputs --set <name> --declarations <dir> --base <dir> [--lv2-path <list>]
 * [--clap-path <list>]`: a reference set's inputs to the descriptions store's base, read from the set as installed
 * (docs/descriptions-store.md section 6, "The base is built centrally"). Each declaration under `<dir>` (a plugin
 * package's `<contractdir>/<package>/plugins/*.json`) names a plugin by its CLAP id (`plugin.id`) and its LV2 URI
 * (`plugin.uri`); each format installed gets one input, `<base>/inputs/<set>-<format>-<name>/`: `key.json` (the
 * installed binary's SHA-256, the format, the URI or id), `descriptor.json` (the declaration's own bytes, so the CLAP
 * entry's source is the one a host computes from the same installed file) and, for LV2, `bundle/` (the bundle's TTL
 * files, the groups' and the source's input). `<base>/sets/<set>.json` lists the set: what `omx-panel base --set`
 * holds the built base to. `<base>/contract.d/<package>/` keeps the package's own domain files beside the declarations
 * (the `*.json` of `<contractdir>/<package>/`: its role meanings among them), the vocabulary the set's descriptions are
 * derived against, so a build with none of the set installed derives what a host with it installed derives. The set's
 * earlier inputs are removed first, so a plugin gone from the set leaves the base.
 * A declared plugin installed in neither format is refused: the set would not be the set.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleOf, LV2_DEFAULT_PATH, PluginRefusal } from './describe-plugin.mjs';
import { binaryOf } from './lv2-complement.mjs';
import { clapDefaultPath, installedClap } from './panel-sync.mjs';

const byteOrder = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const NAME = /^[a-z0-9][a-z0-9._-]*$/;

/** The set's declarations, in byte order of their file names: { name, file, bytes, lv2, clap, version }. */
function declarations(dir) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(byteOrder);
  } catch (e) {
    throw new PluginRefusal(`the declarations directory ${dir} cannot be read: ${e.code ?? e.message}`);
  }
  return files.map((f) => {
    const file = join(dir, f);
    const bytes = readFileSync(file);
    let d;
    try {
      d = JSON.parse(bytes.toString('utf8'));
    } catch (e) {
      throw new PluginRefusal(`${file} is no JSON: ${e.message}`);
    }
    const p = d?.plugin ?? {};
    if (!Array.isArray(d?.controls)) throw new PluginRefusal(`${file} is no descriptor: it states no controls`);
    return { name: basename(f, '.json'), file, bytes, lv2: p.uri ?? (p.format === 'lv2' ? p.id : undefined), clap: p.format === 'clap' ? p.id : undefined, version: p.version };
  });
}

/**
 * The set's inputs written under `base`. Returns { set, inputs, plugins } (the set file's path, the inputs written, the
 * set's members). Throws a PluginRefusal for what the command reports.
 */
export function writeInputs({ set, declarationsDir, base, lv2Path = LV2_DEFAULT_PATH, clapPath = clapDefaultPath(), env = process.env }) {
  if (!NAME.test(set)) throw new PluginRefusal(`--set ${set} is no set name: lowercase letters, digits, '.', '_' and '-'`);
  const decls = declarations(declarationsDir);
  if (decls.length === 0) throw new PluginRefusal(`${declarationsDir} holds no declaration: an empty set is no reference set`);
  const claps = installedClap(clapPath, { env });
  if (claps === null) throw new PluginRefusal('omx-clap-scan is not on PATH, or answered no JSON: the CLAP plugins cannot be listed (install omx-clap-host)');
  const inputsDir = join(base, 'inputs');
  mkdirSync(inputsDir, { recursive: true });
  for (const d of readdirSync(inputsDir)) if (d.startsWith(`${set}-`)) rmSync(join(inputsDir, d), { recursive: true, force: true });
  const members = [];
  const written = [];
  const put = (dirName, key, decl) => {
    const dir = join(inputsDir, dirName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'key.json'), `${JSON.stringify(key, null, 2)}\n`);
    writeFileSync(join(dir, 'descriptor.json'), decl.bytes);
    written.push(dirName);
    return dir;
  };
  for (const decl of decls) {
    const member = { name: decl.name };
    if (decl.lv2) {
      let bundle = null;
      try {
        bundle = bundleOf(decl.lv2, lv2Path);
      } catch (e) {
        if (!(e instanceof PluginRefusal)) throw e;
      }
      if (bundle) {
        const binary = fileURLToPath(binaryOf(bundle, decl.lv2));
        const dir = put(`${set}-lv2-${decl.name}`, { sha256: sha256Of(binary), format: 'lv2', uri: decl.lv2 }, decl);
        mkdirSync(join(dir, 'bundle'));
        for (const f of readdirSync(bundle.dir).filter((n) => n.endsWith('.ttl')).sort(byteOrder)) copyFileSync(join(bundle.dir, f), join(dir, 'bundle', f));
        member.lv2 = decl.lv2;
      }
    }
    const clap = decl.clap && claps.get(decl.clap);
    if (clap?.sha) {
      put(`${set}-clap-${decl.name}`, { sha256: clap.sha, format: 'clap', uri: decl.clap }, decl);
      member.clap = decl.clap;
    }
    if (!member.lv2 && !member.clap) throw new PluginRefusal(`${decl.file}: ${decl.name} is installed in no format (LV2 search list ${lv2Path}, CLAP search list ${clapPath})`);
    members.push(member);
  }
  // the package's domain files, the vocabulary the derivation reads beside its declarations
  const pkgDir = dirname(resolve(declarationsDir));
  const contractDir = join(base, 'contract.d', basename(pkgDir));
  rmSync(contractDir, { recursive: true, force: true });
  mkdirSync(contractDir, { recursive: true });
  for (const f of readdirSync(pkgDir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name).sort(byteOrder)) copyFileSync(join(pkgDir, f), join(contractDir, f));
  const versions = [...new Set(decls.map((d) => d.version).filter(Boolean))].sort(byteOrder);
  const setFile = join(base, 'sets', `${set}.json`);
  mkdirSync(join(base, 'sets'), { recursive: true });
  writeFileSync(setFile, `${JSON.stringify({ set, versions, plugins: members }, null, 2)}\n`);
  return { set: setFile, inputs: written.length, plugins: members.length };
}
