// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * vocabulary.mjs — the readers of the plugin vocabulary the layout judges a descriptor by, each over what its
 * owner installs, never a copy of it:
 *
 *   - the meanings: omx-contract's closed list of control meanings, `$defs.meaning` of its installed schema
 *     (`<datadir>/omx-contract.schema.json`, installed by omx-contract-data; `$OMX_CONTRACT_SCHEMA` stands in),
 *     `unknown` aside; and the meaning each panel role plays, `meaningOfRole`: the `roleMeanings` items the installed
 *     packages declare in their contract directories (omx-contract docs/contract-dir.md, "A package's role meanings";
 *     omx-plugins-contract installs omx-plugins'; `$OMX_ROLE_MEANINGS`, a `:` list of files holding such items, stands
 *     in), never a list of this package's own;
 *   - the units: a descriptor unit (its symbol, `%`, `dB/oct`, `""`) is read as its standard id, the word of omx-contract's
 *     PARAM_UNITS whose `x-symbol` it is, with its `x-dimension` (the param domain, `<contractdir>/param/param.json`,
 *     installed by omx-contract-data from 3.21.0; sorting pass rows P1, M4). A unit is served when the param-contract
 *     extension's unit table gives it a value (omx-contract's OMX_PARAM_CONTRACT_UNITS sheet,
 *     `<contractdir>/3/omx-contract/param-contract.json`, installed by omx-contract-data from 3.6.0), the sheet keyed by the
 *     unit's LV2 term: plugin-db's F1 word for the standard id (its lv2 domain, LV2_UNIT_IDS). omx-panel reads no
 *     plugin-hostd table;
 *   - the descriptors a package installs, `<contractdir>/3/<package>/plugins/<name>.json` (omx-plugins-contract
 *     installs omx-plugins').
 *
 * The contract directories are `$OMX_CONTRACT_PATH` (a `:` list, the first that holds a package wins), else
 * omx-contract's pkg-config variable `contractdir` where omx-contract.pc is installed (omx-contract-devel), else
 * /usr/share/omx-contract/contract.d, where omx-contract-data installs it. omx-contract's datadir is the pkg-config
 * variable `datadir`, else /usr/share/omx-contract. A runtime install reads its files with no pkg-config.
 *
 * A reader whose source is not installed throws, naming what to install; nothing is guessed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDomainAt } from '@openmixer/omx-contract/domain-reader';

const PKG_CONFIG = () => process.env.PKG_CONFIG || 'pkg-config';

/** A pkg-config variable of an installed package, or undefined. */
function pkgVariable(pkg, name) {
  try {
    return execFileSync(PKG_CONFIG(), [`--variable=${name}`, pkg], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Where omx-contract-data installs its files and the contract directory, for an install with no omx-contract.pc. */
export const DEFAULT_DATADIR = '/usr/share/omx-contract';
export const DEFAULT_CONTRACTDIR = '/usr/share/omx-contract/contract.d';

/** The contract directories, in the order they are read: `$OMX_CONTRACT_PATH`, else omx-contract's `contractdir`,
 * else the default. */
export function contractDirs() {
  const path = process.env.OMX_CONTRACT_PATH;
  if (path) return path.split(':').filter(Boolean);
  return [pkgVariable('omx-contract', 'contractdir') ?? DEFAULT_CONTRACTDIR];
}

/** The directory `<contractdir>/3/<package>` of the first contract directory that holds it, or undefined. */
export function packageDir(pkg) {
  return contractDirs().map((d) => join(d, '3', pkg)).find((d) => existsSync(d));
}

/** This tree's contract directory (the source tree's and dist/'s `contract.d`, when there is one). */
const TREE_CONTRACT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'contract.d');

/** The directories the panel domain is opened from: `$OMX_CONTRACT_PATH`, this tree's `contract.d`, then omx-contract's
 * `contractdir` (where omx-panel-contract installs it); the first that holds `panel/panel.json` wins. */
export function panelDomainDirs() {
  const env = (process.env.OMX_CONTRACT_PATH ?? '').split(':').filter(Boolean);
  return [...env, TREE_CONTRACT_DIR, pkgVariable('omx-contract', 'contractdir') ?? DEFAULT_CONTRACTDIR];
}

/** The words of a panel domain item (`PANEL_FAMILIES` ...), in code order, opened with omx-contract's domain loader. */
export const panelWords = (item) => openDomainAt(panelDomainDirs(), 'panel').words(item).map((w) => w.word);

/** omx-contract's own data directory: its pkg-config `datadir`, else the default. */
export function contractDataDir() {
  return pkgVariable('omx-contract', 'datadir') ?? DEFAULT_DATADIR;
}

const once = (read) => {
  let v;
  return () => (v ??= read());
};

/** The installed omx-contract schema, where the descriptor words are declared. */
export function contractSchemaFile() {
  return process.env.OMX_CONTRACT_SCHEMA || join(contractDataDir(), 'omx-contract.schema.json');
}

/** The descriptor's closed list of meanings, `unknown` aside: omx-contract's schema, `$defs.meaning`. */
export const meanings = once(() => {
  const file = contractSchemaFile();
  if (!existsSync(file)) throw new Error(`vocabulary: omx-contract's schema is not installed (${file}): install omx-contract-data, or name the file in $OMX_CONTRACT_SCHEMA`);
  const list = JSON.parse(readFileSync(file, 'utf8')).$defs?.meaning?.enum;
  if (!Array.isArray(list)) throw new Error(`vocabulary: ${file} declares no $defs.meaning`);
  return Object.freeze(list.filter((m) => m !== 'unknown'));
});

/** A `roleMeanings` item's rows into `into` (role -> { meaning, from }); a role a second item declares is refused, as
 * omx-contract refuses it (`contract.role.duplicate`): a role has one owner. */
function addRoleMeanings(into, file) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return;
  }
  for (const [name, item] of Object.entries(doc ?? {})) {
    if (item?.kind !== 'roleMeanings' || typeof item.roles !== 'object') continue;
    for (const row of Object.values(item.roles)) {
      if (typeof row?.role !== 'string' || typeof row.meaning !== 'string') continue;
      const had = into.get(row.role);
      if (had) throw new Error(`vocabulary: contract.role.duplicate: role '${row.role}' is declared by ${had.from} and by ${name} (${file}); a role has one owner`);
      into.set(row.role, { meaning: row.meaning, from: `${name} (${file})` });
    }
  }
}

/** Whether `path` is a directory, in place or reached through a link: a composed contract directory links the installed
 * packages beside a tree's own (omx-plugins' round trip and gen --check arms), and a Dirent's isDirectory is false for
 * a link, so every walk of a contract directory asks this. */
const isDir = (path) => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;

/** The JSON files of every package of every contract directory: where an installed package's items are. */
function contractFiles() {
  const files = [];
  for (const dir of contractDirs()) {
    const major = join(dir, '3');
    if (!existsSync(major)) continue;
    for (const pkg of readdirSync(major)) {
      const at = join(major, pkg);
      if (!isDir(at)) continue;
      for (const f of readdirSync(at)) if (f.endsWith('.json')) files.push(join(at, f));
    }
  }
  return files;
}

/** Every role the installed packages declare, with the meaning it plays: `$OMX_ROLE_MEANINGS`, else the contract
 * directories. No package declaring one leaves it empty, and every role then plays none. */
export const roleMeanings = once(() => {
  const table = new Map();
  const named = process.env.OMX_ROLE_MEANINGS;
  for (const file of named ? named.split(':').filter(Boolean) : contractFiles()) addRoleMeanings(table, file);
  return table;
});

/** The meaning role `role` plays, or undefined: a role no package declares, one declared `unknown`, or one whose meaning
 * the installed schema does not list plays none, whatever its name (a role is looked up, never read as a meaning). */
export function meaningOfRole(role) {
  const m = roleMeanings().get(role)?.meaning;
  return m !== undefined && meanings().includes(m) ? m : undefined;
}

/** omx-contract's param domain document, `<contractdir>/param/param.json`, from the first contract directory holding it. */
export function paramDomainFile() {
  return contractDirs().map((d) => join(d, 'param', 'param.json')).find((f) => existsSync(f));
}

/** The standard units, PARAM_UNITS of omx-contract's param domain: `Map<symbol, { id, dimension }>`. */
export const standardUnits = once(() => {
  const file = paramDomainFile();
  if (!file) throw new Error(`vocabulary: omx-contract's param domain (param/param.json) is not installed in ${contractDirs().join(':')}: install omx-contract-data (>= 3.21.0)`);
  const words = JSON.parse(readFileSync(file, 'utf8'))?.components?.schemas?.PARAM_UNITS?.oneOf;
  if (!Array.isArray(words)) throw new Error(`vocabulary: ${file} declares no PARAM_UNITS`);
  return new Map(words.map((w) => [w['x-symbol'], { id: w.const, dimension: w['x-dimension'] }]));
});

/** A descriptor unit's standard id (`%` -> `percent`, `""` -> `none`), or undefined for a unit the list does not hold. */
export const unitIdOf = (unit) => standardUnits().get(unit ?? '')?.id;

/** The symbols of the standard units of `dimensions` (`['gain', 'level', 'loudness']` -> dB, dBFS, LUFS, dBTP, dBu, LU). */
export const unitsOfDimensions = (dimensions) => [...standardUnits()].filter(([, u]) => dimensions.includes(u.dimension)).map(([symbol]) => symbol);

/** The sheet of the param-contract units is omx-contract's: OMX_PARAM_CONTRACT_UNITS, in its param-contract.json. */
export const PARAM_UNITS_ITEM = 'OMX_PARAM_CONTRACT_UNITS';

/** The file that declares it: the first JSON file of the merged contract directory that holds the item (omx-contract's
 * `3/omx-contract/param-contract.json`, from omx-contract-data 3.6.0), found like every other item. */
export function paramUnitsFile() {
  return contractFiles().find((file) => {
    try {
      return PARAM_UNITS_ITEM in (JSON.parse(readFileSync(file, 'utf8')) ?? {});
    } catch {
      return false;
    }
  });
}

/** The param-contract units' values, by name in capitals without underscores (SEMITONE12TET): `Map<name, value>`. */
export const paramUnits = once(() => {
  const file = paramUnitsFile();
  if (!file) throw new Error(`vocabulary: omx-contract's param-contract units (3/omx-contract/param-contract.json) are not installed in ${contractDirs().join(':')}: install omx-contract-data (>= 3.6.0)`);
  const value = JSON.parse(readFileSync(file, 'utf8'))[PARAM_UNITS_ITEM]?.value;
  if (!value || typeof value !== 'object') throw new Error(`vocabulary: ${file} declares no ${PARAM_UNITS_ITEM} value`);
  return new Map(Object.entries(value).map(([name, code]) => [name.replaceAll('_', '').toUpperCase(), code]));
});

/** plugin-db's F1 mapping of the LV2 units to the standard ids, read backwards (its lv2 domain, LV2_UNIT_IDS: the
 * term's key is the word's title, the standard id its word): `Map<id, term>`. */
export const lv2UnitTerms = once(() => new Map(openDomainAt(contractDirs(), 'lv2').words('LV2_UNIT_IDS').map((w) => [w.word, w.title])));

/** The first value of the extension's vendor block: the units of its own, past the LV2 ones. */
const VENDOR_BLOCK = 0x100;

/** A standard id the param-contract extension serves (`none` is): the sheet gives its LV2 term a value, or, as main read
 * a unit of the extension's own, the id by name (dBFS -> DBFS) is a unit of its vendor block. */
export function servedUnit(id) {
  if (id === 'none') return true;
  const term = lv2UnitTerms().get(id);
  if (term && paramUnits().get(term.replaceAll('_', '').toUpperCase())) return true;
  return (paramUnits().get(String(id).replace(/[^A-Za-z0-9]/g, '').toUpperCase()) ?? 0) >= VENDOR_BLOCK;
}

/** The descriptor file a package installed into omx-contract's contract directory, `<package>/<name>`:
 * `<contractdir>/3/<package>/plugins/<name>.json`. */
export function installedDescriptorFile(ref) {
  const m = /^([a-z0-9][a-z0-9.+-]*)\/([A-Za-z0-9._-]+)$/.exec(ref);
  if (!m) throw new Error(`vocabulary: '${ref}' is not <package>/<name>`);
  const file = contractDirs().map((d) => join(d, '3', m[1], 'plugins', `${m[2]}.json`)).find((f) => existsSync(f));
  if (!file) throw new Error(`vocabulary: no descriptor ${ref} is installed (in ${contractDirs().join(':')})`);
  return file;
}

/** Every descriptor file installed under the contract directories, sorted: `<contractdir>/<major>/<package>/plugins/*.json`,
 * whatever majors are installed. A `<package>/<name>` installed under several majors or directories is listed once,
 * from the highest major of the first contract directory that holds it. */
export function installedDescriptorFiles() {
  const names = (dir, keep) => {
    try {
      return readdirSync(dir).filter((name) => keep(name, join(dir, name)));
    } catch {
      return [];
    }
  };
  const seen = new Map();
  for (const d of contractDirs()) {
    const majors = names(d, (name, at) => isDir(at) && /^[0-9]+$/.test(name)).sort((a, b) => Number(b) - Number(a));
    for (const major of majors) {
      for (const pkg of names(join(d, major), (name, at) => isDir(at))) {
        for (const f of names(join(d, major, pkg, 'plugins'), (name, at) => !isDir(at) && name.endsWith('.json'))) {
          const ref = `${pkg}/${f}`;
          if (!seen.has(ref)) seen.set(ref, join(d, major, pkg, 'plugins', f));
        }
      }
    }
  }
  return [...seen.values()].sort();
}

/** A panel domain item's words by title (`PANEL_GROUP_REASONS` -> `{ noControls: 'no-controls', ... }`): the codes and
 * words the tools emit, read from the panel domain; a title the item lacks is refused by name, never undefined. */
export function panelCodes(item) {
  const words = Object.fromEntries(openDomainAt(panelDomainDirs(), 'panel').words(item).map((w) => [w.title, w.word]));
  return new Proxy(Object.freeze(words), {
    get(t, k) {
      if (typeof k === 'string' && !(k in t)) throw new Error(`vocabulary: the panel domain's ${item} has no word titled ${k}`);
      return t[k];
    },
  });
}

