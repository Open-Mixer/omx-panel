// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Sorting pass row V2 (omx-panel#156): the tools' refusal codes (PANEL_DESCRIBE_CODES) and the port-group verdict's
// words (PANEL_GROUP_OUTCOMES, PANEL_GROUP_REASONS) are read from the panel domain, not typed in each tool (pure move:
// the words the tools emit do not change). Call level: the tools' exports and inferGroups' verdict.
// (a) golden, frozen from the tools at origin/main 3cace582; (c) a temporary contract directory whose words differ is
// what the tools emit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DESCRIBE_CODES } from '../dist/tools/describe.mjs';
import { BARS_CODES } from '../dist/tools/bars.mjs';
import { EasyRefused } from '../dist/tools/easy.mjs';
import { FamilyNotBacked, NoControls } from '../dist/tools/panel-description.mjs';
import { inferGroups } from '../dist/tools/group-infer.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = 'panel.describe.';

test('(a) the describe codes the tools raise are the golden ones', () => {
  assert.deepEqual({ ...DESCRIBE_CODES }, {
    noControls: `${D}no-controls`, familyNotBacked: `${D}family-not-backed`, familyUnknown: `${D}family-unknown`, layoutInvalid: `${D}layout-invalid`,
    overrideUnavailable: `${D}override-unavailable`, overrideRefused: `${D}override-refused`, overrideDropped: `${D}override-dropped`,
    roleDropped: `${D}role-dropped`, skinDropped: `${D}skin-dropped`, meterRefused: `${D}meter-refused`, paramUnserved: `${D}param-unserved`,
  });
  assert.deepEqual({ ...BARS_CODES }, { few: `${D}bars-too-few`, kind: `${D}bars-not-travel`, facts: `${D}bars-facts-differ`, series: `${D}bars-labels-not-series`, unknown: `${D}bars-unknown-control` });
  assert.equal(new EasyRefused('x').code, `${D}easy-refused`);
  assert.equal(new NoControls('x').code, `${D}no-controls`);
  assert.equal(new FamilyNotBacked('x').code, `${D}family-not-backed`);
});

test('(a) the port-group verdict speaks the golden outcome and reason', () => {
  assert.deepEqual(inferGroups({ ports: [] }), { outcome: 'nothing-to-do', reason: 'no-controls' });
});

test('(c) a contract directory whose words differ is what the tools emit', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-v2-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(ROOT, 'contract.d/panel'), join(dir, 'panel'), { recursive: true });
  const f = join(dir, 'panel/panel.json');
  const doc = JSON.parse(readFileSync(f, 'utf8'));
  const s = doc.components.schemas;
  s.PANEL_GROUP_REASONS.oneOf.find((w) => w.const === 'no-controls').const = 'no-controls-sabotaged';
  s.PANEL_DESCRIBE_CODES.oneOf.find((w) => w.const === `${D}no-controls`).const = `${D}no-controls-sabotaged`;
  writeFileSync(f, JSON.stringify(doc, null, 2));
  // group-infer, which a browser loads, reads tools/group-words.mjs: rendered from this directory into a copy of the tools
  const { groupWordsText } = await import(join(ROOT, 'dist/tools/group-words-render.mjs'));
  const tools = join(dir, 'tools');
  cpSync(join(ROOT, 'dist/tools'), tools, { recursive: true });
  writeFileSync(join(tools, 'group-words.mjs'), groupWordsText([dir]));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { inferGroups } = await import(${JSON.stringify(join(tools, 'group-infer.mjs'))});
    const { NoControls } = await import(${JSON.stringify(join(ROOT, 'dist/tools/panel-description.mjs'))});
    console.log(JSON.stringify([inferGroups({ ports: [] }).reason, new NoControls('x').code]));`],
  { encoding: 'utf8', env: { ...process.env, OMX_CONTRACT_PATH: dir } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), ['no-controls-sabotaged', `${D}no-controls-sabotaged`], 'the tools still emit their own typed words');
});

test('(a) the modules a browser loads (easy.mjs, bars.mjs) read their codes from the rendered sheet, the domain\'s render', () => {
  const sheet = JSON.parse(readFileSync(join(ROOT, 'schema/codes.json'), 'utf8')).codes;
  assert.equal(new EasyRefused('x').code, sheet.panelEasyRefused.code);
  assert.equal(BARS_CODES.few, sheet.panelBarsTooFew.code);
  for (const f of ['tools/easy.mjs', 'tools/bars.mjs']) assert.doesNotMatch(readFileSync(join(ROOT, f), 'utf8'), /'panel\.describe\./, `${f} types a code`);
});
