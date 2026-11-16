// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Nothing the console already says is typed again in the vintage look, and a moved console is seen:
//   1. a colour literal in the vintage look is allowed only in the rows of the owner's mock (tools/look/console-map.json, ownerMock,
//      each row's `via`): the enclosure, the label plate, the LED; every other colour is a pinned placeholder;
//   2. the console's default finish is read from its tokens.css (the block that is the bare `:root` too), never named in the tree;
//   3. the drift check: the pin's values against the console's tokens.css at its CURRENT ref (CI hands it as $OPENMIXER_TOKENS_CSS),
//      and a token moved in a fixture tokens.css is red.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkPin, diffPin, extractDefaultFinish, extractPin, extractTokens, loadPin } from '../tools/look-pin.mjs';

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
  return [`:root {\n${decl(base.filter(([k]) => k !== '--accent'))}\n}`, `:root, :root[data-accent="orange"] { --accent: ${v('--accent', p.tokens['--accent'])}; }`, ...Object.keys(p.finish).map(finish)].join('\n');
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

test('the console\'s tokens.css at its current ref (CI: $OPENMIXER_TOKENS_CSS) still holds every pinned value', (t) => {
  const file = process.env.OPENMIXER_TOKENS_CSS;
  if (!file) {
    if (process.env.CI) assert.fail('CI gives the console\'s tokens.css at its current ref as $OPENMIXER_TOKENS_CSS');
    t.skip('no $OPENMIXER_TOKENS_CSS: the drift is checked where the console is at hand');
    return;
  }
  assert.deepEqual(diffPin(readFileSync(file, 'utf8')), [], 're-pin: node tools/look-pin.mjs --write <tokens.css> <commit>, then node tools/look.mjs');
});

test('the hash of the pinned commit\'s file is the release check\'s ($OPENMIXER_TOKENS_CSS_PINNED), apart from the drift', (t) => {
  const file = process.env.OPENMIXER_TOKENS_CSS_PINNED;
  if (!file) { t.skip('no $OPENMIXER_TOKENS_CSS_PINNED'); return; }
  const css = readFileSync(file, 'utf8');
  assert.deepEqual(checkPin(css), []);
});
