// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Sorting pass row V3 (omx-panel#157): the `panel.*` codes sheet is the panel domain's. PANEL_SKIN_CODES,
// PANEL_MODGUI_CODES and PANEL_DESCRIBE_CODES hold the 32 codes with their English sentence (x-text), placeholders
// (x-args) and key (x-name); their translations are the domain's catalogs. schema/codes.json and catalogs/<lang>.json
// are rendered from it (tools/codes-render.mjs), never written by hand.
// (a) golden: the rendered sheet and catalogs are, as JSON, those of origin/main 3cace58 (sha256 of the parsed JSON);
// the files on disk are the render; the readers (bin/omx-panel.mjs, the package exports) read those files.
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

/** sha256 of JSON.stringify(JSON.parse(file)) at origin/main 3cace58, before the move. */
const GOLDEN = {
  'schema/codes.json': 'ce59aa0eefe7b8ef2b4ac5902b2489a3199a9d2910efac9f45d6ef52211b5654',
  'catalogs/ca.json': '5f5ee5a725934cae53ee65d47fab6b15f393af30c7b7549f5ad1b5c9836cae93',
  'catalogs/de.json': '3ec914fd0a118d0584786fef6df92b88cba5e0b96c30716fb9ee84f2528f3163',
  'catalogs/es.json': '0b849732886043160da62e728f8b25b2a591092dd51183e962ba5d2cb5d094f6',
  'catalogs/fr.json': '83053998eecb52d7278295c67d4be2ed33b53028c49320c63c4066e2f03aac53',
  'catalogs/it.json': 'a4be404fa5401e2d7466ce2fba35dfe4f089d09e0c1edd0d5b5ce59ebcd23c5b',
  'catalogs/pt.json': '36ad804a404297def9dffa41ea086514f4a0f7b674609fa994992c4673c9aefa',
};

const render = (env = {}) => import(`${TOOL}?${Date.now()}`).then((m) => m.renderAll(env.dir));

test('(a) the domain holds the 32 codes: 5 skin, 11 MOD GUI (the skin\'s MOD GUI licence last), 16 describe', () => {
  const s = JSON.parse(readFileSync(join(ROOT, 'contract.d/panel/panel.json'), 'utf8')).components.schemas;
  assert.equal(s.PANEL_SKIN_CODES?.oneOf.length, 5);
  assert.equal(s.PANEL_MODGUI_CODES?.oneOf.length, 11);
  assert.equal(s.PANEL_DESCRIBE_CODES?.oneOf.length, 16);
});

test('(a) the render from the domain is, as JSON, the sheet and the six catalogs before the move', async () => {
  const files = await render();
  for (const [f, h] of Object.entries(GOLDEN)) assert.equal(hash(JSON.parse(files[f])), h, f);
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
