// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Sorting pass row V1 (omx-panel#155): the six panel word items (PANEL_FAMILIES, _STANDARD_WIDGETS, _WIDGETS,
// _DISPLAY_KINDS, _DISPLAY_SOURCES, _PLACEMENTS) are read from omx-panel's own panel domain, never from omx-contract's
// copy (data/panel.json, omx_vocabulary.h). Call level: the tools' real exports and the renderer's codes header.
// (a) golden, frozen from omx-contract data/panel.json at 8155b8d; (b) the domain equals omx-contract's copy while it
// exists; (c) a temporary contract directory whose panel domain lacks `knob` changes what the tools read.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as pd from '../tools/panel-description.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const GOLDEN = {
  PANEL_FAMILIES: ['none', 'gate', 'dynamics', 'limiter', 'deesser', 'eq', 'filter', 'drive', 'modulation', 'delay', 'reverb', 'pitch', 'utility'],
  PANEL_STANDARD_WIDGETS: ['knob', 'fader', 'switch', 'selector', 'meter', 'curve', 'xy', 'display'],
  PANEL_WIDGETS: ['auto', 'knob', 'fader', 'switch', 'selector'],
  PANEL_DISPLAY_KINDS: ['gain_reduction_bar', 'transfer_curve', 'eq_response', 'meter', 'time_response'],
  PANEL_DISPLAY_SOURCES: ['family', 'meters', 'gain_adjustment', 'curve'],
  PANEL_PLACEMENTS: ['insert', 'return', 'bus', 'master'],
};
const EXPORT = { PANEL_FAMILIES: 'FAMILIES', PANEL_STANDARD_WIDGETS: 'STANDARD_WIDGETS', PANEL_WIDGETS: 'WIDGETS', PANEL_DISPLAY_KINDS: 'DISPLAY_KINDS', PANEL_DISPLAY_SOURCES: 'DISPLAY_SOURCES', PANEL_PLACEMENTS: 'PLACEMENTS' };

test('(a) the tools\' exports are the golden words, 13/8/5/5/4/4, in code order', () => {
  for (const [item, name] of Object.entries(EXPORT)) assert.deepEqual([...pd[name]], GOLDEN[item], `${name} (${item})`);
});

test('(a) the renderer reads the widget codes from omx-panel\'s rendered header, omxdomain/panel_codes.h, and no omx-contract vocabulary', () => {
  const h = readFileSync(join(ROOT, 'include/omxdomain/panel_codes.h'), 'utf8');
  for (const [item, words] of Object.entries(GOLDEN)) {
    words.forEach((w, i) => assert.match(h, new RegExp(`#define OMX_${item}_${w.toUpperCase().replace(/[^A-Z0-9]/g, '_')} ${i}u\\b`), `${item} ${w}`));
    assert.match(h, new RegExp(`#define OMX_${item}_COUNT ${words.length}u?\\b`), `${item} count`);
    assert.match(h, new RegExp(`#define OMX_${item}\\(X\\)`), `${item} X-macro`);
  }
  for (const f of ['renderer/src/view.h', 'renderer/src/view.c']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /omxcontract\/omx_vocabulary\.h/, `${f} still includes omx-contract's vocabulary`);
  }
  assert.match(readFileSync(join(ROOT, 'renderer/src/view.h'), 'utf8'), /#include <omxdomain\/panel_codes\.h>/);
});

test('(b) while omx-contract still holds its copy, the panel domain\'s words are the same', (t) => {
  let resolved;
  try { resolved = createRequire(import.meta.url).resolve('@openmixer/omx-contract/resolved.json'); } catch { resolved = null; }
  if (!resolved || !existsSync(resolved)) return t.skip('omx-contract\'s resolved.json is not installed');
  const items = JSON.parse(readFileSync(resolved, 'utf8')).items;
  for (const item of Object.keys(GOLDEN)) {
    if (!items[item]) continue; // dropped from omx-contract (row V1 PR 5): nothing to compare
    assert.deepEqual(Object.values(items[item].value).map((v) => v.word), [...pd[EXPORT[item]]], item);
  }
});

test('(c) a contract directory whose panel domain lacks `knob` is what the tools read: knob is gone or the read is refused', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-v1-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(ROOT, 'contract.d/panel'), join(dir, 'panel'), { recursive: true });
  const f = join(dir, 'panel/panel.json');
  const doc = JSON.parse(readFileSync(f, 'utf8'));
  const sw = doc.components.schemas.PANEL_STANDARD_WIDGETS;
  sw.oneOf = sw.oneOf.filter((e) => e.const !== 'knob').map((e, i) => ({ ...e, 'x-code': i }));
  writeFileSync(f, JSON.stringify(doc, null, 2));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { STANDARD_WIDGETS } from ${JSON.stringify(join(ROOT, 'tools/panel-description.mjs'))}; console.log(JSON.stringify(STANDARD_WIDGETS));`],
  { encoding: 'utf8', env: { ...process.env, OMX_CONTRACT_PATH: dir } });
  if (r.status === 0) assert.ok(!JSON.parse(r.stdout).includes('knob'), `the tools still read knob: ${r.stdout}`);
  else assert.match(r.stderr, /panel|knob|STANDARD_WIDGETS/, r.stderr);
});
