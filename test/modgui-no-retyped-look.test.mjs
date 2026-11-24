// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Nothing the console already says is typed again in the vintage look, and a moved console is seen:
//   1. a colour literal in the vintage look is allowed only in the rows of the owner's mock (tools/look/console-map.json, ownerMock,
//      each row's `via`): the enclosure, the label plate, the LED; every other colour is a pinned placeholder;
//   2. the console's default finish is read from its tokens.css (the block that is the bare `:root` too), never named in the tree;
//   3. the pin is sealed: its values hash to the seal a re-pin wrote (CI needs no console), a value edited by hand is red, and a token
//      moved in a fixture tokens.css is red in the drift diff.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkPin, checkSelf, diffPin, extractDefaultFinish, extractPin, extractTokens, loadPin } from '../tools/look-pin.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const LOOKS = JSON.parse(read('schema/modgui-looks.json')).looks;
const MAP = JSON.parse(read('tools/look/console-map.json')).rows;
const pin = loadPin();

/** The tokens in which a colour is the paint of an effect (a shadow, a glow), not a colour of the look: rgba() there is a shade, not a retyped value. */
const SHADE = /(shadow|glow)$/;
const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(/i;
/** The vintage tokens that hold a colour literal, outside the mock rows. */
export const literalsOutsideMock = (vintage, map = MAP) => {
  const mock = new Set(map.filter((r) => r.ownerMock).flatMap((r) => r.via ?? []));
  return Object.entries(vintage).filter(([k, v]) => !mock.has(k) && !SHADE.test(k) && LITERAL.test(String(v))).map(([k]) => k);
};

test('the vintage look types no colour outside the owner\'s mock rows: every other colour is read from the pin', () => {
  assert.ok(MAP.filter((r) => r.ownerMock).every((r) => r.via?.length), 'each mock row names the tokens it owns');
  assert.deepEqual(literalsOutsideMock(LOOKS.vintage), []);
});

test('arm: a literal in a token outside the mock rows is refused, in a mock row it is not', () => {
  for (const k of ['--key-pressed-bg', '--key-held-bg', '--t-section', '--t-control', '--t-value', '--t-brand']) {
    assert.deepEqual(literalsOutsideMock({ ...LOOKS.vintage, [k]: '#e0952a' }), [k], k);
  }
  assert.deepEqual(literalsOutsideMock({ ...LOOKS.vintage, '--enclosure': '#e9dfc7' }), []);
});

/** A tokens.css text that holds the pin's values (the base block, the finish blocks), `moved` replacing values by id. */
function pinCss(p, { moved = {}, defaultFinish = p.defaultFinish } = {}) {
  const v = (id, value) => moved[id] ?? value;
  const base = [...Object.entries(p.tokens), ...Object.entries(p.relief), ...Object.entries(p.base)];
  const decl = (kvs, prefix = '') => kvs.map(([k, val]) => `  ${k}: ${v(prefix + k, val)};`).join('\n');
  const finish = (name) => `:root${name === defaultFinish ? ', :root' : ''}[data-finish="${name}"] {\n${decl(Object.entries(p.finish[name]), `${name}:`)}\n}`;
  return [`:root {\n${decl(base.filter(([k]) => k !== '--accent'))}\n}`, `:root, :root[data-accent="orange"] { --accent: ${v('--accent', p.tokens['--accent'])}; }`, ...Object.keys(p.finish).map(finish), `:root[data-theme="light"] {\n${decl(Object.entries(p.light), 'light:')}\n}`].join('\n');
}

test('the default finish is the console\'s: read from the block that is the bare :root, in the pin and in the looks', () => {
  assert.equal(extractDefaultFinish(pinCss(pin)), pin.defaultFinish);
  assert.equal(extractDefaultFinish(pinCss(pin, { defaultFinish: 'graphite' })), 'graphite', 'a console that changes its default moves the pin');
  assert.equal(extractPin(pinCss(pin, { defaultFinish: 'black' })).defaultFinish, 'black');
  assert.doesNotMatch(read('tools/look-pin.mjs'), /DEFAULT_FINISH\s*=\s*'/);
  assert.equal(LOOKS.vintage['--finish'], '{console:default-finish}');
  assert.equal(JSON.parse(read('tools/look.json')).looks.vintage['--finish'], pin.defaultFinish);
});

test('drift: a token moved in a tokens.css is red, naming it; the unmoved file is green whatever else it says', () => {
  assert.deepEqual(diffPin(pinCss(pin)), []);
  assert.deepEqual(diffPin(`/* a console that moved elsewhere */\n${pinCss(pin)}\n.other { color: red; }`), []);
  const moved = pinCss(pin, { moved: { '--accent': '#123456' } });
  assert.match(diffPin(moved).join(';'), /--accent/);
  assert.match(diffPin(pinCss(pin, { moved: { 'aluminium:--screw': '#123456' } })).join(';'), /aluminium:--screw/);
  assert.equal(extractTokens(moved)['--accent'], '#123456');
});

test('the pin is self-consistent: its values hash to the seal a re-pin wrote, and a value edited by hand is red (CI has no console)', () => {
  assert.deepEqual(checkSelf(pin), []);
  const edited = structuredClone(pin);
  edited.tokens['--accent'] = '#123456';
  assert.match(checkSelf(edited).join(';'), /edited without a re-pin/);
  const edited2 = structuredClone(pin);
  edited2.finish.aluminium['--screw'] = '#123456';
  assert.match(checkSelf(edited2).join(';'), /edited without a re-pin/);
  const unsealed = structuredClone(pin);
  delete unsealed.source.valuesSha256;
  assert.match(checkSelf(unsealed).join(';'), /no source.valuesSha256/);
});

test('the pin is the console\'s tokens.css at the pinned commit when that file is at hand: hash and values (by hand: look-pin.mjs --check)', () => {
  // the file lives in a private repository, so no test reads it; the by-hand check and the console's own check do. What a test can hold:
  // a tokens.css rendered from the pin hashes to nothing the pin claims (the seal is over the values, not the console's bytes), and the
  // values of that rendering are the pin's.
  assert.deepEqual(diffPin(pinCss(pin)), []);
  assert.notEqual(checkPin(pinCss(pin)).join(';'), '', 'a rendering is not the console\'s file: its hash is not the pinned one');
});

test('the vintage text on the light enclosure is set in the console\'s light-theme inks, not in glass or button metal', () => {
  for (const k of ['--t-section', '--t-control', '--t-value']) assert.match(LOOKS.vintage[k], /^\{console:--ink(-dim)?-light\}$/, k);
  const v = JSON.parse(read('tools/look.json')).looks.vintage;
  assert.equal(v['--t-control'], pin.light['--ink']);
  assert.equal(v['--t-section'], pin.light['--ink-dim']);
});
