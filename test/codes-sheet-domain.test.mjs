// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Sorting pass row V3 (omx-panel#157): the `panel.*` codes sheet is the panel domain's. PANEL_SKIN_CODES,
// PANEL_MODGUI_CODES and PANEL_DESCRIBE_CODES hold the 34 codes with their English sentence (x-text), placeholders
// (x-args) and key (x-name); their translations are the domain's catalogs. schema/codes.json and catalogs/<lang>.json
// are rendered from it (tools/codes-render.mjs), never written by hand.
// (a) golden: the rendered sheet and catalogs are, as JSON, those of origin/main 3cace58 (sha256 of the parsed JSON),
// less the codes the domain gained after the move, each named in ADDED: a code is never reworded, so every code the move
// carried still hashes to its golden, and a code added without its line in ADDED breaks it too; the files on disk are the render; the readers (bin/omx-panel.mjs, the package exports) read those files.
// (c) a temporary contract directory decides the render: a changed sentence or a dropped code changes it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(ROOT, 'tools/codes-render.mjs');
const LANGS = ['ca', 'de', 'es', 'fr', 'it', 'pt'];
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** At origin/main 3cace58, before the move: the sheet, sha256 of JSON.stringify(JSON.parse(file)); each catalog, sha256 of
 * its kind, lang, owner and messages with the keys sorted (the five hand catalogs other than ca carried a dangling
 * "$schema", ../schema/omx-contract.schema.json, and their messages in alphabetical order: the render writes the sheet's
 * order and no $schema; every key and entry is the same). */
const GOLDEN = {
  'schema/codes.json': 'ce59aa0eefe7b8ef2b4ac5902b2489a3199a9d2910efac9f45d6ef52211b5654',
  'catalogs/ca.json': 'a2417bf755047187e892571d83443c29726929080598e84ab316cdffb94a7241',
  'catalogs/de.json': 'acf6b6dac3b87d82cf29419e0c023caab7b746f1b8affc16956d1f5c623f0ef1',
  'catalogs/es.json': '1f86f3ba2d3d62b346a7ab6c2f909f071bcfd0b23eefc3c30bcd72b007b43ce4',
  'catalogs/fr.json': '816d590088a7e66d6e2fcf1f1bfaefe7598679a383276ee7a9978d6a8750732a',
  'catalogs/it.json': 'd878a12812e110373249a0212cc7042101e9ce90909f59ffe5cd4fbc8ad75d6e',
  'catalogs/pt.json': 'c13d85c49d9d10d96582665c60848a408112306b6d4518a7140ebf6c520c0ae8',
};
/** The codes the domain gained after the move, by code word; a new code joins this list in the commit that adds it. */
const ADDED = new Set([
  'panel.skin.override-refused', // omx-panel#14, domain 1.3.0: override-invalid's facts with the reason word
  'panel.skin.entry-missing', // omx-panel#14, domain 1.3.0: a view or modgui entry not in the package
  'panel.describe.family-unknown', // omx-panel#199, domain 1.4.0: an override family that is no panel family
]);
const canonical = (f, j) => (f.startsWith('catalogs/')
  ? { kind: j.kind, lang: j.lang, owner: j.owner, messages: Object.fromEntries(Object.entries(j.messages).filter(([c]) => !ADDED.has(c)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) }
  : { ...j, codes: Object.fromEntries(Object.entries(j.codes).filter(([, c]) => !ADDED.has(c.code))) });

const render = (env = {}) => import(`${TOOL}?${Date.now()}`).then((m) => m.renderAll(env.dir));

test('(a) the domain holds the 35 codes: 7 skin (#14\'s two last), 11 MOD GUI (the skin\'s MOD GUI licence last), 17 describe (#199\'s last)', () => {
  const s = JSON.parse(readFileSync(join(ROOT, 'contract.d/panel/panel.json'), 'utf8')).components.schemas;
  assert.equal(s.PANEL_SKIN_CODES?.oneOf.length, 7);
  assert.deepEqual([...s.PANEL_SKIN_CODES.oneOf.slice(5), ...s.PANEL_DESCRIBE_CODES.oneOf.slice(16)].map((w) => w.const), [...ADDED]);
  assert.equal(s.PANEL_MODGUI_CODES?.oneOf.length, 11);
  assert.equal(s.PANEL_DESCRIBE_CODES?.oneOf.length, 17);
});

test('(a) the render from the domain is the sheet and the six catalogs\' messages before the move', async () => {
  const files = await render();
  for (const [f, h] of Object.entries(GOLDEN)) assert.equal(hash(canonical(f, JSON.parse(files[f]))), h, f);
});

test('(a) the files the readers open are the render, byte for byte (codes-render --check)', () => {
  const r = spawnSync(process.execPath, [TOOL, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const cli = spawnSync(process.execPath, [join(ROOT, 'bin/omx-panel.mjs'), '--version'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr); // bin/omx-panel.mjs loads schema/codes.json at start
});

test('(a) the skin package\'s refusal codes are the domain\'s skin and MOD GUI codes, in order', async () => {
  const { SKIN_REFUSAL_CODES } = await import(join(ROOT, 'dist/src/skin-package.js'));
  const s = JSON.parse(readFileSync(join(ROOT, 'contract.d/panel/panel.json'), 'utf8')).components.schemas;
  assert.deepEqual([...SKIN_REFUSAL_CODES], [...s.PANEL_SKIN_CODES.oneOf, ...s.PANEL_MODGUI_CODES.oneOf].map((w) => w.const));
});

test('(c) a temporary contract directory decides the render: a changed sentence and a dropped code change it', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-v3-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(ROOT, 'contract.d/panel'), join(dir, 'panel'), { recursive: true });
  const f = join(dir, 'panel/panel.json');
  const doc = JSON.parse(readFileSync(f, 'utf8'));
  const m = doc.components.schemas.PANEL_MODGUI_CODES;
  m.oneOf = m.oneOf.filter((w) => w.const !== 'panel.modgui.not-found');
  writeFileSync(f, JSON.stringify(doc, null, 2));
  const files = await render({ dir });
  assert.ok(!files['schema/codes.json'].includes('panel.modgui.not-found'), 'the dropped code is still rendered');
  const r = spawnSync(process.execPath, [TOOL, '--check', '--contract-dir', dir], { encoding: 'utf8' });
  assert.equal(r.status, 1, 'the files are still taken for the render of a domain without panel.modgui.not-found');
  for (const lang of LANGS) assert.ok(!files[`catalogs/${lang}.json`].includes('"panel.modgui.not-found"'), lang);
});
