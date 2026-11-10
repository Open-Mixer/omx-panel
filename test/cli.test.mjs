// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The command as the packages ship it (dist/bin/omx-panel.mjs): validate exits 0 on a valid package, 1 on an invalid
// one with the fault named, 2 on a usage or read error; layout, modgui, import and look each do their tool's job.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'dist/bin/omx-panel.mjs'), ...args], { encoding: 'utf8' });
const FIX = join(ROOT, 'test/fixtures/omx-delay');

test('a valid package directory: exit 0', () => {
  const r = run('validate', join(ROOT, 'examples/skins/org.example.plate'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ok   .*skin\.json$/m);
});

test('an invalid file: exit 1, the fault named by file and path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-'));
  const file = join(dir, 'skin.json');
  writeFileSync(file, JSON.stringify({ schema: 1, plugin: 'x' }));
  const r = run('validate', file);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL .*skin\.json required \/ /);
});

test('usage and read errors: exit 2', () => {
  assert.equal(run().status, 2);
  assert.equal(run('validate').status, 2);
  assert.equal(run('validate', '/nonexistent/skin.json').status, 2);
  assert.equal(run('nonsense').status, 2);
  assert.equal(run('layout').status, 2);
});

test('layout: a descriptor under its declared panel, as JSON, canonical text and pages', () => {
  const args = ['layout', '--descriptor', join(FIX, 'omx-delay.descriptor.json'), '--panel', join(FIX, 'omx-delay.panel.json'), '--ns', 'fx.delay'];
  const json = run(...args);
  assert.equal(json.status, 0, json.stderr);
  const x = JSON.parse(json.stdout);
  assert.equal(x.family, 'delay');
  assert.deepEqual(x.controls.map((c) => c.symbol), ['pingpong', 'fxDelayTime', 'fxDelayFeedback', 'mix', 'tone']);
  const canonical = run(...args, '--canonical');
  assert.match(canonical.stdout, /^org\.openmixer\.panel-description\/1\nfamily\tdelay\nsection\t0\tdelay\tfx\.delay\.section\.delay\n/);
  const pages = JSON.parse(run(...args, '--pages').stdout);
  assert.deepEqual(pages.map((p) => [p.pageName, p.ids.filter((i) => i !== null).length]), [['Easy', 4], ['Delay', 1]]);
  assert.deepEqual(pages.flatMap((p) => p.ids).filter((i) => i !== null).length, 5, 'every control once');
});

test('modgui: --check over omx-plugins\' committed omx-delay MOD GUI is clean', () => {
  const r = run('modgui', '--check', '--no-films', '--descriptor', join(FIX, 'omx-delay.descriptor.json'), '--panel', join(FIX, 'omx-delay.panel.json'),
    '--out', join(FIX, 'omx-delay.lv2'), '--source', 'plugins/omx-delay/omx-delay.decl.json (its panel block) and tools/look.json');
  assert.equal(r.status, 0, r.stderr);
});

test('import: the fixture bundle becomes a package that validates; a refused licence exits 3 with nothing written', () => {
  const out = mkdtempSync(join(tmpdir(), 'omx-panel-skins-'));
  const r = run('import', join(ROOT, 'fixtures/modgui/omx-fixture-echo.lv2'), '--out', out);
  assert.equal(r.status, 0, r.stderr);
  const line = JSON.parse(r.stdout.split('\n').find((l) => l.startsWith('MODGUI-IMPORT-JSON ')).slice('MODGUI-IMPORT-JSON '.length));
  assert.equal(line.verdict, 'written');
  assert.equal(run('validate', line.dir).status, 0);
  assert.equal(JSON.parse(readFileSync(join(line.dir, 'skin.json'), 'utf8')).schema, 1);
  const none = join(mkdtempSync(join(tmpdir(), 'omx-panel-none-')), 'skins');
  const bad = run('import', '/nonexistent.lv2', '--out', none);
  assert.equal(bad.status, 3);
  assert.equal(existsSync(none), false);
});

test('look: --check finds look.json fresh', () => {
  const r = run('look', '--check');
  assert.equal(r.status, 0, r.stderr);
});

test('modgui: a descriptor with nothing to draw exits 3 with one line and no stack trace', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'omx-panel-')), 'hidden-only.lv2');
  const r = run('modgui', '--descriptor', join(ROOT, 'test/fixtures/descriptors/scanned-lv2-hidden-only.json'), '--out', out);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /^modgui-gen: 'hidden-only' has no control to draw\n$/);
  assert.equal(existsSync(out), false, 'nothing is written');
});

// Spec 7.11: a tool prints the owner's en sentence after the code, from schema/codes.json, its placeholders filled.
test('describe --pages with no panel: each refusal printed as its code and its en sentence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-'));
  const file = join(dir, 'empty.json');
  writeFileSync(file, JSON.stringify({ plugin: { id: 'urn:test:empty' }, controls: [] }));
  const r = run('describe', '--descriptor', file, '--pages');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const codes = JSON.parse(readFileSync(join(ROOT, 'dist/schema/codes.json'), 'utf8')).codes;
  const en = codes.panelNoControls.text.en.split('{plugin}')[1].split('(')[0];
  assert.match(r.stderr, /^omx-panel: panel.describe.no-controls: /m);
  assert.ok(r.stderr.includes(en), `the en sentence after the code: ${r.stderr}`);
  assert.ok(r.stderr.includes('urn:test:empty has no control'), `the plugin placeholder filled: ${r.stderr}`);
});

test('describe --layout: the derived layout the description was made from, its displays the description\'s, for the renderer', () => {
  const file = join(ROOT, 'test/fixtures/descriptors/scanned-lv2-lsp-para-equalizer-x16-mono.json');
  const r = run('describe', '--descriptor', file, '--layout');
  assert.equal(r.status, 0, r.stderr);
  const layout = JSON.parse(r.stdout);
  const { description } = JSON.parse(run('describe', '--descriptor', file).stdout);
  // the layout's shape (a section index, a standard widget), which `layout` alone gives without the derivation
  assert.ok(layout.controls.every((c) => Number.isInteger(c.section) && c.standard?.widget));
  assert.deepEqual(layout.displays.map((d) => [d.kind, d.sectionKey, d.basis]), description.displays.map((d) => [d.kind, d.section, d.basis]));
  assert.deepEqual(layout.displays.map((d) => d.kind), ['eq_response']);
  assert.deepEqual(layout.sections.map((s) => s.key), description.sections.map((s) => s.key));
  // with --pages or a skin it is a usage error: a skin reorders the description, never the layout
  assert.equal(run('describe', '--descriptor', file, '--layout', '--pages').status, 2);
  assert.equal(run('describe', '--descriptor', file, '--layout', '--skin', file).status, 2);
});
