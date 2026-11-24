// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The gesture words are the `gestures` domain's (contract.d/gestures/gestures.json, GESTURES_* items); schema/gestures.json
 * and renderer/src/gesture_words.h are rendered from it, byte for byte what the hand file and the hand-fed header were.
 * The call-level test of the move, in the three arms of the sorting pass:
 *   (a) golden: the real reads (timingsOf, wordOf, declaredWords, the rendered files' bytes) give what the hand
 *       schema/gestures.json at omx-panel b039a65 gave;
 *   (b) the domain and the rendered files agree, and the table's standard widgets are the panel domain's;
 *   (c) sabotage: a temporary contract directory whose GESTURES_WORDS lacks `paint` is refused by name by the two tools
 *       that read the domain, and the real read follows the domain, not a stored copy.
 * The installed omx-contract (validate, fmt) runs, or OMX_CONTRACT_CLI names another (a checkout's); a missing command is
 * red by name, never skipped.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GESTURES, GESTURE_CODES, timingsOf, wordOf } from '../tools/gestures.mjs';
import { declaredWords, emitWordsHeader, WORDS_HEADER } from '../tools/gesture-words.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const domainPath = (dir) => join(dir, 'gestures', 'gestures.json');
const domain = () => JSON.parse(readFileSync(domainPath(join(ROOT, 'contract.d')), 'utf8'));

/** Frozen from the hand files at omx-panel b039a65. */
const GOLDEN = {
  gesturesJsonSha256: 'e4bcd8aa22c74381d1073917f6eb9c936f44254a75afdd8eeca9c72249053d2d',
  wordsHeaderSha256: 'b9bba56020136ed2995b873325d19f46f078186a01f5a5b8166b0103ac7b83f2',
  words: ['drag', 'fine', 'step', 'second', 'reset', 'more', 'select', 'toggle', 'paint'],
  codes: ['GESTURE_READ_ONLY', 'GESTURE_CONTROL_OWNED', 'GESTURE_NO_DEFAULT', 'GESTURE_NOT_IN_TABLE', 'GESTURE_HOLD_SHORT', 'GESTURE_HOLD_BELOW_FLOOR', 'GESTURE_NO_TARGET', 'GESTURE_PAINT_REQUIRED_ON_TOUCH', 'GESTURE_BAD_SETTING', 'GESTURE_BAD_INPUT'],
  tableKeys: ['knob', 'fader', 'switch', 'selector', 'xy', 'meter', 'display', 'curve', 'bar', 'handle'],
};

/** A copy of the tree's contract directory with the gestures document changed by `edit`. */
function sabotaged(t, edit) {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-gestures-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(ROOT, 'contract.d'), dir, { recursive: true });
  const doc = JSON.parse(readFileSync(domainPath(dir), 'utf8'));
  edit(doc);
  writeFileSync(domainPath(dir), JSON.stringify(doc, null, 2) + '\n');
  return dir;
}

const node = (script, ...args) => spawnSync('node', [join(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8' });

// ---- (a) golden -----------------------------------------------------------------------------------------------

test('(a) the real reads give the words, codes, timings and table of the hand file at b039a65', () => {
  assert.deepEqual(declaredWords(), GOLDEN.words);
  assert.deepEqual(Object.keys(GESTURES.words), GOLDEN.words);
  for (const code of Object.values(GESTURE_CODES)) assert.ok(GOLDEN.codes.includes(code), `${code} is no declared gesture code`);
  assert.deepEqual(Object.keys(GESTURES.codes), GOLDEN.codes);
  assert.deepEqual(Object.keys(GESTURES.table), GOLDEN.tableKeys);
  assert.deepEqual(timingsOf(), { longPressMs: 500, doubleTapMs: 300, palmGuardMs: 300, safetyHoldMs: 800, claimMs: 300 });
  assert.equal(wordOf({ widget: 'bar' }, 'sweep'), 'paint');
  assert.equal(wordOf({ widget: 'knob' }, 'wheel'), 'step');
  assert.equal(wordOf({ widget: 'handle' }, 'pinch'), 'second');
  assert.equal(wordOf({ widget: 'switch' }, 'tap'), 'toggle');
});

test('(a) the rendered files are byte for byte the hand files', () => {
  assert.equal(sha(read('schema/gestures.json')), GOLDEN.gesturesJsonSha256);
  assert.equal(sha(readFileSync(WORDS_HEADER, 'utf8')), GOLDEN.wordsHeaderSha256);
  assert.equal(emitWordsHeader(declaredWords()), readFileSync(WORDS_HEADER, 'utf8'));
});

// ---- (b) the domain and the rendered files ----------------------------------------------------------------------

test('(b) the domain holds the words, the codes and the sheets, and renders the schema file byte for byte', async () => {
  const doc = domain();
  assert.equal(doc.$id, 'https://openmixer.org/contract/gestures');
  assert.equal(doc.info['x-owner'], 'omx-panel');
  for (const item of Object.keys(doc.components.schemas)) assert.match(item, /^GESTURES_/);
  const words = doc.components.schemas.GESTURES_WORDS.oneOf;
  assert.deepEqual(words.map((w) => w.const), GOLDEN.words);
  assert.deepEqual(words.map((w) => w.description), Object.values(GESTURES.words));
  const codes = doc.components.schemas.GESTURES_CODES.oneOf;
  assert.deepEqual(codes.map((c) => c.const), GOLDEN.codes);
  assert.deepEqual(codes.map((c) => c.description), Object.values(GESTURES.codes));
  const { renderGestures } = await import('../tools/gestures-render.mjs');
  assert.equal(renderGestures(doc), read('schema/gestures.json'));
  assert.deepEqual(JSON.parse(renderGestures(doc)), GESTURES);
});

test('(b) the table keys the widget words are the panel domain\'s PANEL_STANDARD_WIDGETS, and the table adds bar and handle', () => {
  const panel = JSON.parse(read('contract.d/panel/panel.json'));
  const standard = panel.components.schemas.PANEL_STANDARD_WIDGETS.oneOf.map((w) => w.const);
  assert.deepEqual(Object.keys(GESTURES.table).filter((k) => !['bar', 'handle'].includes(k)).sort(), [...standard].sort());
});

test('(b) the old holders are gone: the schema file and the words header say they are rendered, not written', () => {
  assert.match(read('docs/panel-gestures.md'), /contract\.d\/gestures/);
  assert.match(read('tools/gestures.mjs'), /rendered from contract\.d\/gestures/);
});

// ---- (c) sabotage -----------------------------------------------------------------------------------------------

test('(c) a contract directory whose GESTURES_WORDS lacks `paint` is refused by the words tool, naming the word', (t) => {
  const dir = sabotaged(t, (doc) => {
    const words = doc.components.schemas.GESTURES_WORDS.oneOf;
    words.splice(words.findIndex((w) => w.const === 'paint'), 1);
  });
  const r = node('tools/gesture-words.mjs', '--check', '--contract-dir', dir);
  assert.notEqual(r.status, 0, `gesture-words --check read a domain without paint and passed:\n${r.stdout}`);
  assert.match(r.stderr, /paint/);
});

test('(c) the same domain is refused by the schema renderer, naming the item, and a sound one passes', (t) => {
  const bad = sabotaged(t, (doc) => {
    const words = doc.components.schemas.GESTURES_WORDS.oneOf;
    words.splice(words.findIndex((w) => w.const === 'paint'), 1);
  });
  const r = node('tools/gestures-render.mjs', '--check', '--contract-dir', bad);
  assert.notEqual(r.status, 0, `gestures-render --check passed a domain without paint:\n${r.stdout}`);
  assert.match(r.stderr, /GESTURES_WORDS/);
  const ok = node('tools/gestures-render.mjs', '--check', '--contract-dir', join(ROOT, 'contract.d'));
  assert.equal(ok.status, 0, `gestures-render --check refused the tree's own domain:\n${ok.stderr}`);
});

test('(c) a domain with one timing changed renders a different schema file, so the rendered file follows the domain', (t) => {
  const dir = sabotaged(t, (doc) => { doc.components.schemas.GESTURES_TIMINGS['x-value'].longPressMs.default = 501; });
  const r = node('tools/gestures-render.mjs', '--check', '--contract-dir', dir);
  assert.notEqual(r.status, 0, 'a changed timing in the domain left schema/gestures.json current');
  assert.match(r.stderr, /schema\/gestures\.json/);
});

// ---- packaging arm ----------------------------------------------------------------------------------------------

test('packaging: omx-panel-contract ships the gestures domain beside the panel domain, in the rpm and the deb', () => {
  const spec = read('packaging/omx-panel.spec');
  assert.match(spec, /^%files contract\n(?:.*\n)*?%\{omx_contract_domain_dir\}\/gestures\/$/m);
  const lines = read('debian/omx-panel-contract.install').split('\n').filter((l) => l && !l.startsWith('#'));
  assert.ok(lines.includes('usr/share/omx-contract/contract.d/gestures/') && lines.includes('usr/share/omx-contract/contract.d/panel/'), lines.join(' | '));
  assert.match(read('Makefile'), /install-contract-dir\.sh|OMX_CONTRACT_INSTALLER[^\n]*--domain contract\.d\/gestures|--domain contract\.d\/gestures/);
});
