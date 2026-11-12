// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * describe-text-params.test.mjs — a plugin's path and text parameters (#17): an LV2 plugin declares them as
 * patch:writable lv2:Parameters, an atom:Path or atom:String range each, and a scan writes them under
 * extensions.lv2["patch:writable"] as { uri, label, range }. describe serves each as a parameter of kind `path` or `text`
 * (its symbol the URI's fragment, its name the label), with a control in the panel's last section, never on a surface
 * page (a page drives a number); a plugin whose only parameter is one still has a panel; a patch parameter of another
 * range is not served and is refused by its own code. Everything else the plugin's description serves is unchanged.
 *
 * The proofs are scans of installed plugins (test/fixtures/descriptors/scanned-*.json): LSP Impulse Reverb's four
 * impulse files, LSP Matcher's reference and IR files beside its side-chain link name, and zeroconvolv's configurable
 * convolver's impulse response.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, DESCRIBE_CODES } from '../dist/tools/describe.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'descriptors');
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

/** The descriptor with its patch parameters taken away: what describe served before #17. */
const withoutPatch = (d) => {
  const lv2 = { ...d.extensions.lv2 };
  delete lv2['patch:writable'];
  return { ...d, extensions: { ...d.extensions, lv2 } };
};
const textKinds = (desc) => desc.params.filter((p) => p.kind === 'path' || p.kind === 'text');
const pageSlots = (desc) => desc.pages.flatMap((p) => p.ids).filter((id) => id !== null);

test('LSP Impulse Reverb: its four impulse files are path parameters, each a control, none on a page', () => {
  const { description: d, refusals } = describe(fixture('scanned-lv2-lsp-impulse-reverb-stereo.json'));
  assert.ok(d);
  assert.deepEqual(textKinds(d).map((p) => [p.kind, p.symbol, p.name, p.default]).sort(), [
    ['path', 'ifn0', 'Impulse file 0', ''],
    ['path', 'ifn1', 'Impulse file 1', ''],
    ['path', 'ifn2', 'Impulse file 2', ''],
    ['path', 'ifn3', 'Impulse file 3', ''],
  ]);
  const files = d.controls.filter((c) => c.symbol.startsWith('ifn'));
  assert.equal(files.length, 4);
  for (const c of files) assert.ok(d.sections.some((s) => s.key === c.section), `${c.symbol} sits in a served section`);
  assert.ok(!d.pages.some((p) => p.ids.some((id) => String(id).startsWith('ifn'))));
  assert.deepEqual(refusals.filter((r) => r.code === DESCRIBE_CODES.paramUnserved), []);
});

test('LSP Impulse Reverb: everything else the description serves is what it served without the files', () => {
  const d = fixture('scanned-lv2-lsp-impulse-reverb-stereo.json');
  const after = describe(d).description;
  const before = describe(withoutPatch(d)).description;
  assert.deepEqual(after.params.filter((p) => p.kind !== 'path' && p.kind !== 'text'), before.params);
  assert.deepEqual(after.controls.filter((c) => !c.symbol.startsWith('ifn')), before.controls);
  assert.deepEqual(after.sections, before.sections);
  assert.deepEqual(after.pages, before.pages);
  assert.deepEqual(after.roles, before.roles);
  assert.equal(after.family, before.family);
  assert.equal(after.fingerprint, before.fingerprint);
});

test('LSP Matcher: the reference and IR files are paths, the side-chain link name is a text', () => {
  const d = describe(fixture('scanned-lv2-lsp-matcher-mono.json')).description;
  assert.deepEqual(textKinds(d).map((p) => [p.symbol, p.kind]).sort(), [['file', 'path'], ['ir_file', 'path'], ['link', 'text']]);
  assert.deepEqual(d.controls.filter((c) => ['file', 'ir_file', 'link'].includes(c.symbol)).length, 3);
});

test('zeroconvolv (configurable): its impulse response is a path parameter beside its controls', () => {
  const d = describe(fixture('scanned-lv2-zeroconvolv-cfg-stereo.json')).description;
  assert.deepEqual(textKinds(d).map((p) => [p.kind, p.symbol, p.name]), [['path', 'ir', 'Impulse Response']]);
  assert.ok(d.controls.some((c) => c.symbol === 'ir'));
});

/** A plugin whose only parameter is a file: no control port at all. */
const fileOnly = (range = 'Path') => ({
  origin: 'scanned',
  plugin: { id: 'urn:test:file-only', format: 'lv2', name: 'File only' },
  controls: [],
  ports: [],
  extensions: { lv2: { 'patch:writable': [{ uri: 'urn:test:file-only#ir', label: 'Impulse response', range }] } },
});

test('a plugin whose only parameter is a path is described, not refused for having no controls', () => {
  const { description: d, refusals } = describe(fileOnly());
  assert.ok(d, `refused: ${JSON.stringify(refusals)}`);
  assert.deepEqual(d.params, [{ kind: 'path', symbol: 'ir', name: 'Impulse response', default: '' }]);
  assert.deepEqual(d.controls.map((c) => c.symbol), ['ir']);
  assert.equal(d.sections.length, 1);
  assert.equal(d.controls[0].section, d.sections[0].key);
  assert.deepEqual(pageSlots(d), []);
  assert.ok(!refusals.some((r) => r.code === DESCRIBE_CODES.noControls));
});

test('a symbol the entry states is the served symbol; else the URI fragment names it', () => {
  const stated = { ...fileOnly(), extensions: { lv2: { 'patch:writable': [{ uri: 'urn:test:param:impulse', symbol: 'impulse', label: 'Impulse response', range: 'Path' }] } } };
  assert.deepEqual(describe(stated).description.params.map((p) => p.symbol), ['impulse']);
  assert.deepEqual(describe(fileOnly()).description.params.map((p) => p.symbol), ['ir']);
});

test('control: a plugin with no control and no path or text parameter is still refused for having no controls', () => {
  const none = { ...fileOnly(), extensions: { lv2: {} } };
  const { description, refusals } = describe(none);
  assert.equal(description, null);
  assert.ok(refusals.some((r) => r.code === DESCRIBE_CODES.noControls));
});

test('a patch parameter of another range is not served and is refused by its own code, naming it', () => {
  const d = fixture('scanned-lv2-zeroconvolv-cfg-stereo.json');
  d.extensions.lv2['patch:writable'] = [...d.extensions.lv2['patch:writable'], { uri: 'urn:test#gain', label: 'Gain', range: 'Float' }];
  const { description, refusals } = describe(d);
  assert.ok(!description.params.some((p) => p.symbol === 'gain'));
  assert.equal(typeof DESCRIBE_CODES.paramUnserved, 'string');
  assert.deepEqual(refusals.filter((r) => r.code === DESCRIBE_CODES.paramUnserved).map((r) => r.args), [{ plugin: d.plugin.id, symbol: 'gain', range: 'Float' }]);
});

test('a file-only plugin whose patch parameter is of another range is refused for having no controls, and names it', () => {
  const { description, refusals } = describe(fileOnly('Float'));
  assert.equal(description, null);
  assert.ok(refusals.some((r) => r.code === DESCRIBE_CODES.noControls));
  assert.ok(refusals.some((r) => r.code === DESCRIBE_CODES.paramUnserved));
});
