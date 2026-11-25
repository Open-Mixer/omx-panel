#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * omx-panel <verb> ...
 *
 *   validate <skin.json | skin package directory>...     a skin against the schema; exit 0 valid, 1 not, 2 usage or read
 *   layout --descriptor <file> [--panel <file>] [--ns <label-key namespace>] [--canonical | --pages [--per-page N] [--easy-first] [--value <symbol>=<n>]...]
 *                                                        the panel laid out from a descriptor, as JSON (or its canonical
 *                                                        serialisation, or its pages of eight, the Easy ones first)
 *   describe --descriptor <file> [--panel <file>] [--skin <skin.json>] [--ns <label-key namespace>] [--remote <file>] [--pages --per-page N | --layout]
 *                                                        the one derivation (tools/describe.mjs): { description, refusals } as JSON, or with
 *                                                        --pages just the pages, the Easy ones first, cut at N by the one cut;
 *                                                        with --layout the derived layout it was made from, what the renderer
 *                                                        draws (no skin: a skin reorders the description, not the layout)
 *   describe --stored <answer.json> --format <lv2|clap> [--skin <skin.json>] [--remote <file>] [--pages [--per-page N]]
 *                                                        the same output cut from a descriptions-store entry: the answer
 *                                                        omx-panel-store get --json printed, read by storedOf and cut by
 *                                                        describeFromStored; no descriptor, no layout (an entry holds none)
 *   describe --plugin <target> [--descriptor <file>] [--sha256 <hex>] --store
 *                                                        tools/describe-plugin.mjs: one plugin's entry in the descriptions
 *                                                        store, printed as the store's get answers it; derived, with the LV2
 *                                                        groups the complement infers, and written to the layer of the
 *                                                        effective uid only when no layer holds it
 *   sync [--lv2-path <list>]                             tools/panel-sync.mjs: the store half of omx-panel-sync, one pass:
 *                                                        each installed LV2 plugin's entry once, then the layer of the
 *                                                        effective uid pruned of plugins no longer installed
 *   base --in <inputs> --out <file>                      tools/base-build.mjs: the descriptions store's base from the inputs
 *                                                        directory (key.json, descriptor.json, an LV2 bundle/ each),
 *                                                        written by omx-panel-store build
 *   compare switch|copy --to <A..D>, compare undo|redo   tools/compare.mjs over stdin and stdout: { doc, ring, captures, values }
 *   compare describe                                       the document's format, its slots and the ring bound, as JSON (#23)
 *                                                        in, { doc, ring, moves, unknown } out
 *   modgui ...                                           tools/modgui-gen.mjs: a plugin's MOD GUI from its descriptor
 *   import <bundle.lv2> --out <skins dir> [--plugin <uri>]  tools/modgui-import.mjs: a MOD GUI bundle into a skin package
 *   gui-stage --set <file> --descriptors <dir> --package <name> --out <dir>   tools/gui-stage.mjs: a known set's GUI files, key-gated
 *   complement --out <dir> [--lv2-path <list>] [--state <dir>] [--only <bundle.lv2>]... [--dry-run | --check] [--verbose]
 *                                                        tools/lv2-complement.mjs: a replacing LV2 bundle with the inferred
 *                                                        port groups, for each installed bundle that needs one
 *   look [--check]                                       tools/look.mjs: tools/look.json from the colour roles
 *   copies <tree> | --self-test                          tools/copies-check.mjs: no tracked file copies what omx-panel renders or ships
 *   vocabulary [<package>/<name>]...                     where each installed source is read from, read: the contract
 *                                                        directories, the meanings, the standard units, the units the
 *                                                        param-contract extension serves and each descriptor named; exit 1
 *                                                        when one is missing
 *   descriptors --installed                              each installed plugin descriptor file, one path per line
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSkin } from '../lib/validate.mjs';

// A reader that stops early (head, grep -q) closes the pipe: stop writing and exit 0, as a filter does (#42).
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = join(HERE, '..', 'tools');
const USAGE = 'usage: omx-panel validate <skin.json | skin package directory>...\n'
  + '       omx-panel layout --descriptor <file> [--panel <file>] [--ns <namespace>] [--canonical | --pages [--per-page N] [--easy-first] [--value <symbol>=<n>]...]\n'
  + '       omx-panel describe --descriptor <file> [--panel <file>] [--skin <skin.json>] [--ns <namespace>] [--remote <file>] [--pages [--per-page N] | --layout]\n'
  + '       omx-panel describe --stored <answer.json> --format <lv2|clap> [--skin <skin.json>] [--remote <file>] [--pages [--per-page N]]\n'
  + '       omx-panel describe --plugin <target> [--descriptor <file>] [--sha256 <hex>] --store   (lv2:<uri> or clap:<path>#<id>)\n'
  + '       omx-panel sync [--lv2-path <list>]   (the store half of omx-panel-sync)\n'
  + '       omx-panel base --in <inputs> --out <file>   (the descriptions store\'s base)\n'
  + '       omx-panel compare (switch | copy) --to <A..D> | undo | redo   (JSON on stdin and stdout)\n'
  + '       omx-panel compare describe   (the format, the slots and the ring bound, as JSON)\n'
  + '       omx-panel modgui (--descriptor <file> | --installed <package>/<name>) [--panel <file>] --out <bundle.lv2> [--easy-first] [--check] [--no-films | --films-only]\n'
  + '       omx-panel import <bundle.lv2> --out <skins dir> [--plugin <uri>]\n'
  + '       omx-panel complement --out <dir> [--lv2-path <list>] [--state <dir>] [--only <bundle.lv2>]... [--dry-run | --check] [--verbose]\n'
  + '       omx-panel look [--check]\n'
  + '       omx-panel copies <tree> | --self-test\n'
  + '       omx-panel vocabulary [<package>/<name>]...\n'
  + '       omx-panel descriptors --installed\n'
  + '       omx-panel --version\n';

const [command, ...args] = process.argv.slice(2);

/** package.json sits beside bin/ in the tree and the installed package, and two up from dist/bin in the npm one. */
const packageVersion = () => JSON.parse(readFileSync(['..', '../..'].map((up) => join(HERE, up, 'package.json')).find(existsSync), 'utf8')).version;

/** The owner's sentences (schema/codes.json, spec 7.11), beside tools/ in the tree, dist and the installed package. */
const CODES = Object.values(JSON.parse(readFileSync(join(HERE, '..', 'schema', 'codes.json'), 'utf8')).codes);

/** `CODE: <en sentence>` for a code this package owns, its placeholders filled from `args`; `CODE:` otherwise. */
const said = (code, args = {}) => {
  const entry = CODES.find((e) => e.code === code);
  return entry ? `${code}: ${entry.text.en.replace(/\{([^{}]*)\}/g, (m, k) => (args[k] === undefined ? m : String(args[k])))}` : `${code}:`;
};

/** A verb that is a tool of its own: run it with the same node, its exit status this command's. */
const tool = (file) => process.exit(spawnSync(process.execPath, [join(TOOLS, file), ...args], { stdio: 'inherit' }).status ?? 1);

function validate(targets) {
  if (targets.length === 0) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  let failed = 0;
  for (const target of targets) {
    let file = target;
    try {
      if (statSync(target).isDirectory()) file = join(target, 'skin.json');
      const result = validateSkin(JSON.parse(readFileSync(file, 'utf8')));
      if (result.ok) {
        process.stdout.write(`ok   ${file}\n`);
      } else {
        failed++;
        for (const e of result.errors) process.stdout.write(`FAIL ${file} ${e.code} ${e.path} ${e.message}\n`);
      }
    } catch (err) {
      process.stderr.write(`omx-panel: ${file}: ${err.message}\n`);
      process.exit(2);
    }
  }
  process.exit(failed ? 1 : 0);
}

async function layout(argv) {
  const opt = (flag) => {
    const k = argv.indexOf(flag);
    return k >= 0 ? argv[k + 1] : undefined;
  };
  const file = opt('--descriptor');
  if (!file) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const { panelLayout, panelCanonical, pagesOf } = await import(join(TOOLS, 'panel-description.mjs'));
  let x;
  try {
    const descriptor = JSON.parse(readFileSync(file, 'utf8'));
    const panel = opt('--panel') ? JSON.parse(readFileSync(opt('--panel'), 'utf8')) : undefined;
    if (descriptor.easy === undefined && descriptor.origin === 'scanned' && argv.includes('--easy-first')) {
      const { easyFromInstalled } = await import(join(TOOLS, 'easy-installed.mjs'));
      const { installedDescriptorFiles } = await import(join(TOOLS, 'vocabulary.mjs'));
      const easy = easyFromInstalled(descriptor, installedDescriptorFiles().map((f) => JSON.parse(readFileSync(f, 'utf8'))));
      if (easy) descriptor.easy = easy;
    }
    x = panelLayout(descriptor, { panel, ns: opt('--ns'), where: file });
  } catch (err) {
    process.stderr.write(`omx-panel: ${err.code ? `${said(err.code, err.args)} ` : ''}${err.message}\n`);
    process.exit(1);
  }
  if (argv.includes('--canonical')) process.stdout.write(panelCanonical(x));
  else if (argv.includes('--pages')) {
    const raw = opt('--per-page');
    const perPage = raw === undefined ? undefined : /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
    try {
      // --value <symbol>=<integer>, repeated: the governing values the pages are cut at (left out, the come-up ones)
      const values = {};
      argv.forEach((a, k) => {
        if (a !== '--value') return;
        const m = /^([^=]+)=(-?[0-9]+)$/.exec(argv[k + 1] ?? '');
        if (!m) throw new Error(`--value takes <symbol>=<integer>, not ${argv[k + 1]}`);
        values[m[1]] = Number(m[2]);
      });
      process.stdout.write(`${JSON.stringify(pagesOf(x, { perPage, easyFirst: argv.includes('--easy-first'), values }), null, 2)}\n`);
    } catch (err) {
      process.stderr.write(`omx-panel: ${err.message}\n`);
      process.exit(2);
    }
  }
  else process.stdout.write(`${JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString(16) : v), 2)}\n`);
}

/**
 * The description of a descriptor, for a surface that is not node (spec 7.14): the one derivation, the skin applied, and with
 * `--pages` the pages cut by the one cut at `--per-page N` (eight when left out), `--remote <file>` the host's declared
 * remote-controls pages (`[{ name, ids }]`).
 */
async function describeCommand(argv) {
  const opt = (flag) => {
    const k = argv.indexOf(flag);
    return k >= 0 ? argv[k + 1] : undefined;
  };
  if (argv.includes('--stored')) return describeStoredCommand(argv, opt);
  if (argv.includes('--plugin')) return describePluginCommand(argv, opt);
  const file = opt('--descriptor');
  if (!file) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const { describe } = await import(join(TOOLS, 'describe.mjs'));
  const perPage = perPageOf(opt('--per-page'));
  const wantLayout = argv.includes('--layout');
  if (wantLayout && (argv.includes('--pages') || opt('--skin'))) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  try {
    const json = (f) => JSON.parse(readFileSync(f, 'utf8'));
    const out = describe(json(file), {
      withLayout: wantLayout,
      panel: opt('--panel') ? json(opt('--panel')) : undefined,
      skin: opt('--skin') ? json(opt('--skin')) : undefined,
      remote: opt('--remote') ? json(opt('--remote')) : undefined,
      ns: opt('--ns'), where: file, perPage,
    });
    if (wantLayout) {
      if (!out.description) refused(out.refusals);
      process.stdout.write(`${JSON.stringify(out.layout, (_k, v) => (typeof v === 'bigint' ? v.toString(16) : v), 2)}\n`);
    } else printDescribed(out, argv.includes('--pages'));
  } catch (err) {
    process.stderr.write(`omx-panel: ${err.code ? `${said(err.code, err.args)} ` : ''}${err.message}\n`);
    process.exit(1);
  }
}

/** `--per-page`'s value, a whole number of at least 1 (undefined when left out); anything else is a usage error. */
function perPageOf(raw) {
  const perPage = raw === undefined ? undefined : /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
  if (perPage !== undefined && !(Number.isInteger(perPage) && perPage >= 1)) {
    process.stderr.write(`omx-panel: --per-page must be a whole number of at least 1, not ${raw}\n`);
    process.exit(2);
  }
  return perPage;
}

/** Each refusal as its code and its en sentence, then exit 1: there is no description to print. */
function refused(refusals) {
  for (const r of refusals) process.stderr.write(`omx-panel: ${said(r.code, r.args)}\n`);
  process.exit(1);
}

/** describe's output, one tail for a descriptor and a stored entry: `{ description, refusals }`, or with `pages` the pages alone. */
function printDescribed(out, pages) {
  if (!pages) return process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  if (!out.description) refused(out.refusals);
  process.stdout.write(`${JSON.stringify(out.description.pages, null, 2)}\n`);
}

/**
 * The description cut from a descriptions-store entry (docs/descriptions-store.md section 11, zynthian-ui; #220), for a
 * client that is not node: `<answer.json>` is what `omx-panel-store get --json` printed for a key of `--format`, read by
 * `storedOf` and cut by `describeFromStored`, so the output is `describe`'s for the same inputs. It reads the answer, the
 * skin and the remote pages and nothing else: a descriptor, a panel, a namespace or a plugin beside it is a usage error,
 * and so is `--layout` (an entry holds no layout, so the drawn view stays derived). A refused entry prints its code and
 * exits 1; the plugin its sentence names is the answer's file, since the answer carries no key.
 */
async function describeStoredCommand(argv, opt) {
  const valued = new Set(['--stored', '--format', '--skin', '--remote', '--per-page']);
  const value = (i) => argv[i] !== undefined && !argv[i].startsWith('--') && valued.has(argv[i - 1]);
  const ok = argv.every((a, i) => a === '--pages' || (valued.has(a) && value(i + 1)) || value(i));
  const format = opt('--format');
  if (!ok || !['lv2', 'clap'].includes(format)) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const perPage = perPageOf(opt('--per-page'));
  const file = opt('--stored');
  const { describeFromStored } = await import(join(TOOLS, 'describe.mjs'));
  const { storedOf } = await import(join(TOOLS, 'store-entry.mjs'));
  try {
    const json = (f) => JSON.parse(readFileSync(f, 'utf8'));
    const answer = json(file);
    const stored = storedOf(answer, format, file);
    if (!stored) {
      if (typeof answer?.refused !== 'string') throw new Error(`${file} is not an omx-panel-store get --json answer: no body and no refused code`);
      refused([{ code: answer.refused, args: { plugin: file, message: 'the stored entry is a refusal' } }]);
    }
    const out = describeFromStored(stored, {
      skin: opt('--skin') ? json(opt('--skin')) : undefined,
      remote: opt('--remote') ? json(opt('--remote')) : undefined,
      perPage,
    });
    printDescribed(out, argv.includes('--pages'));
  } catch (err) {
    process.stderr.write(`omx-panel: ${err.code ? `${said(err.code, err.args)} ` : ''}${err.message}\n`);
    process.exit(1);
  }
}

/**
 * One plugin's entry in the descriptions store (docs/descriptions-store.md 6): `--plugin <target> --store`, with
 * `--descriptor` and `--sha256` and nothing else. Without `--store` it is a usage error: never a derivation that writes nothing.
 */
async function describePluginCommand(argv, opt) {
  const allowed = new Set(['--plugin', '--descriptor', '--sha256']);
  const ok = argv.includes('--store') && argv.every((a, i) => a === '--store' || (allowed.has(a) && argv[i + 1] !== undefined) || allowed.has(argv[i - 1]));
  if (!ok || !opt('--plugin')) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const { describePlugin, PluginRefusal } = await import(join(TOOLS, 'describe-plugin.mjs'));
  try {
    const answer = describePlugin({ target: opt('--plugin'), descriptor: opt('--descriptor'), sha256: opt('--sha256') });
    process.stdout.write(answer.endsWith('\n') ? answer : `${answer}\n`);
  } catch (err) {
    if (!(err instanceof PluginRefusal)) throw err;
    process.stderr.write(`omx-panel: ${err.message}\n`);
    process.exit(1);
  }
}

/** The store half of the one pass (docs/descriptions-store.md 6): exit 0, or 1 when the store refused a plugin or a prune. */
async function syncCommand(argv) {
  const k = argv.indexOf('--lv2-path');
  if (argv.length !== (k >= 0 ? 2 : 0) || (k >= 0 && argv[k + 1] === undefined)) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const { pass } = await import(join(TOOLS, 'panel-sync.mjs'));
  const { LV2_DEFAULT_PATH } = await import(join(TOOLS, 'describe-plugin.mjs'));
  const r = pass({ lv2Path: k >= 0 ? argv[k + 1] : process.env.LV2_PATH || LV2_DEFAULT_PATH, log: (line) => process.stdout.write(`omx-panel sync: ${line}\n`) });
  if (r.store) process.stdout.write(`omx-panel sync: ${r.described} stored or up to date, ${r.noDescriptor} with no descriptor, ${r.pruned} pruned, ${r.failed} failed\n`);
  process.exit(r.failed ? 1 : 0);
}

/** The descriptions store's base (docs/descriptions-store.md 6): exit 0, 1 with the refusal, 2 on usage. */
async function baseCommand(argv) {
  const opt = (flag) => {
    const k = argv.indexOf(flag);
    return k >= 0 ? argv[k + 1] : undefined;
  };
  if (argv.length !== 4 || !opt('--in') || !opt('--out')) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const { buildBase } = await import(join(TOOLS, 'base-build.mjs'));
  const { PluginRefusal } = await import(join(TOOLS, 'describe-plugin.mjs'));
  try {
    const r = buildBase({ inDir: opt('--in'), out: opt('--out') });
    process.stdout.write(`omx-panel base: ${r.entries} entries into ${opt('--out')}, built from ${r.builtFrom}\n`);
  } catch (err) {
    if (!(err instanceof PluginRefusal)) throw err;
    process.stderr.write(`omx-panel: ${err.message}\n`);
    process.exit(1);
  }
}

/** One step of Compare for a host that is not JavaScript (docs/compare.md): JSON in, JSON out, no state between runs. */
async function compare(argv) {
  const m = await import(join(TOOLS, 'compare.mjs'));
  const op = argv[0];
  if (op === 'describe') {
    // what a host that is not JavaScript needs to hold a compare document: tools/compare.mjs's own values (#23)
    process.stdout.write(`${JSON.stringify({ format: m.COMPARE_FORMAT, slots: m.COMPARE_SLOTS, ringBound: m.RING_BOUND })}\n`);
    return;
  }
  if (!['switch', 'copy', 'undo', 'redo'].includes(op)) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const k = argv.indexOf('--to');
  const to = k >= 0 ? argv[k + 1] : undefined;
  try {
    const { doc, ring, captures = [], values = {} } = JSON.parse(readFileSync(0, 'utf8'));
    const queued = captures.reduce(m.capture, ring ?? m.emptyRing());
    const out =
      op === 'switch' ? m.switchTo(doc ?? m.emptyCompare(), values, to)
      : op === 'copy' ? m.copyTo(doc ?? m.emptyCompare(), values, to)
      : m[op](queued, values);
    process.stdout.write(`${JSON.stringify({ ring: queued, ...out })}\n`);
  } catch (err) {
    process.stderr.write(`omx-panel: ${err.code ? `${said(err.code, err.args)} ` : ''}${err.message}\n`);
    process.exit(1);
  }
}

/** Each source the layout and the MOD GUI read, read where it is installed: one line each, `ok` or `FAIL`. */
async function vocabulary(refs) {
  const v = await import(join(TOOLS, 'vocabulary.mjs'));
  let failed = 0;
  const line = (what, read) => {
    try {
      process.stdout.write(`ok   ${what} ${read()}\n`);
    } catch (err) {
      failed++;
      process.stdout.write(`FAIL ${what} ${err.message}\n`);
    }
  };
  line('contractdir', () => v.contractDirs().join(':'));
  line('meanings', () => `${v.meanings().length} from ${v.contractSchemaFile()}`);
  line('role-meanings', () => `${v.roleMeanings().size} roles from ${process.env.OMX_ROLE_MEANINGS || 'the contract directories'}`);
  line('param-units', () => `${v.standardUnits().size} units from ${v.paramDomainFile()}`);
  line('clap-encoded', () => `${v.clapEncoded().size} units from ${v.paramDomainFile()}`);
  for (const ref of refs) {
    line(`descriptor ${ref}`, () => {
      const file = v.installedDescriptorFile(ref);
      const d = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(d.controls)) throw new Error(`${file} has no controls`);
      return `${d.controls.length} controls from ${file}`;
    });
  }
  process.exit(failed ? 1 : 0);
}

/** The installed descriptor files, one path per line: the contract directories read for whatever majors they hold. */
async function descriptors(argv) {
  if (argv.length !== 1 || argv[0] !== '--installed') {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const { installedDescriptorFiles } = await import(join(TOOLS, 'vocabulary.mjs'));
  for (const file of installedDescriptorFiles()) process.stdout.write(`${file}\n`);
}

if (command === 'validate') validate(args);
else if (command === 'layout') await layout(args);
else if (command === 'describe') await describeCommand(args);
else if (command === 'compare') await compare(args);
else if (command === 'sync') await syncCommand(args);
else if (command === 'base') await baseCommand(args);
else if (command === 'modgui') tool('modgui-gen.mjs');
else if (command === 'import') tool('modgui-import.mjs');
else if (command === 'gui-stage') tool('gui-stage.mjs');
else if (command === 'complement') tool('lv2-complement.mjs');
else if (command === 'look') tool('look.mjs');
else if (command === 'copies') tool('copies-check.mjs');
else if (command === 'vocabulary') await vocabulary(args);
else if (command === 'descriptors') await descriptors(args);
else if (command === '--version') process.stdout.write(`omx-panel ${packageVersion()}\n`);
else {
  process.stderr.write(USAGE);
  process.exit(2);
}
