// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The vintage look is the console's vintage, element by element (tools/look/console-map.json, docs/modgui.md "The map"): every
// map row's tokens are read from the pin (never retyped), the stylesheet and the knob film wear the pinned values, a value that
// differs from tokens.css makes the drift check red, and the 3d look differs from the console's in each of its four roles.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { consoleTokens, diffPin, extractPin, finishTokens, loadPin, pinnedValues } from '../tools/look-pin.mjs';
import { readKnobSvg } from '../tools/svg-knob.mjs';
import { LOOKS_JSON } from '../tools/look.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAP = JSON.parse(readFileSync(join(ROOT, 'tools/look/console-map.json'), 'utf8')).rows;
const SCHEMA = JSON.parse(readFileSync(LOOKS_JSON, 'utf8')).looks;
const EMITTED = JSON.parse(readFileSync(join(ROOT, 'tools/look.json'), 'utf8')).looks;
const DOC = readFileSync(join(ROOT, 'docs/modgui.md'), 'utf8');
const pin = loadPin();
const valueOf = (ref) => {
  const [kind, name] = ref.split(':');
  const v = kind === 'console' ? consoleTokens(pin)[name] : kind === 'finish' ? finishTokens(pin.defaultFinish, pin)[name] : undefined;
  assert.ok(typeof v === 'string' && v, `the pin carries no ${ref}`);
  return v;
};

test('the map has the rows of the console\'s vintage elements, each named once, and docs/modgui.md prints every one', () => {
  assert.ok(MAP.length >= 18, `${MAP.length} rows`);
  assert.equal(new Set(MAP.map((r) => r.id)).size, MAP.length);
  for (const r of MAP) {
    assert.ok(r.console && r.modgui, r.id);
    assert.ok(DOC.includes(`\`${r.id}\``), `docs/modgui.md "The map" lacks the row ${r.id}`);
  }
});

test('every map row\'s tokens are read from the pin: the pin has each one, and the look wears the pinned value', () => {
  for (const r of MAP) {
    if (r.ownerMock) { assert.deepEqual(r.tokens, [], r.id); continue; }
    assert.ok(r.tokens.length > 0 && (r.via?.length || r.svg), `${r.id}: no tokens or no place they are worn`);
    for (const ref of r.tokens) {
      const value = valueOf(ref);
      const placeholder = `{${ref}}`;
      if (r.svg) assert.ok(readKnobSvg(r.svg).includes(placeholder), `${r.id}: ${r.svg} never names ${placeholder}`);
      // the token a row lists is carried by one of its look tokens, as a placeholder in the schema and as the pinned value in the emitted look
      if (r.via) {
        assert.ok(r.via.some((k) => String(SCHEMA.vintage[k]).includes(placeholder)), `${r.id}: none of ${r.via.join(', ')} names ${placeholder}`);
        assert.ok(r.via.some((k) => String(EMITTED.vintage[k]).includes(value)), `${r.id}: none of ${r.via.join(', ')} wears ${value} (${ref}) in tools/look.json`);
      }
    }
  }
});

test('a pinned value that differs from tokens.css goes red: every token of every row, moved in a tokens.css, is named', () => {
  const css = pinCss(pin);
  assert.deepEqual(diffPin(css), [], 'the pin renders to a tokens.css it matches');
  for (const r of MAP) for (const ref of r.tokens) {
    const [kind, name] = ref.split(':');
    // `--ink-light` is the pin's light theme ink (`light:--ink`), the rest are keyed by their own name
    const id = kind === 'console' ? name.replace(/^(--ink(?:-dim)?)-light$/, 'light:$1') : `${pin.defaultFinish}:${name}`;
    const want = pinnedValues(pin).find((e) => e.id === id);
    assert.ok(want, `${ref} is not in the pin's value list`);
    const moved = pinCss(pin, { [id]: '#123456' });
    assert.match(diffPin(moved).join(';'), new RegExp(id.replace(/[-:]/g, '\\$&')), `a moved ${ref} is not named`);
  }
});

test('the finish blocks and the relief are in the pin, aluminium the default', () => {
  assert.equal(pin.defaultFinish, 'aluminium');
  assert.deepEqual(Object.keys(pin.finish), ['aluminium', 'graphite', 'black']);
  for (const k of ['--shade', '--shadow-1', '--shadow-2', '--inset-track']) assert.ok(pin.relief[k], k);
  const { $comment, source, ...values } = pin;
  assert.deepEqual(extractPin(pinCss(pin)), values);
});

// ------------------------------------------------------------------------------------ 3d is not the console's flat look

const parts = (shadow) => shadow.split(/,(?![^(]*\))/).map((s) => s.trim());
test('3d is distinct from the console in each of its four roles: raised sections, recessed glass with a highlight, keycap switches with a pressed state, a glowing accent bar', () => {
  const c = EMITTED.console, d = EMITTED['3d'];
  // raised sections: an outer drop shadow under a lit top edge, where the console's section is flat
  assert.equal(c['--section-shadow'], 'none');
  assert.ok(parts(d['--section-shadow']).some((p) => !p.startsWith('inset')), 'a raised section casts an outer shadow');
  assert.ok(parts(d['--section-shadow']).some((p) => p.startsWith('inset 0 1px 0')), 'with its top edge lit');
  // recessed glass with a highlight
  assert.equal(c['--screen-shadow'], 'none');
  assert.ok(parts(d['--screen-shadow'])[0].startsWith('inset'), 'the glass is sunk');
  assert.ok(parts(d['--screen-shadow']).some((p) => /^0 1px 0 rgba\(255,255,255/.test(p)), 'its lower lip catches the light');
  // keycap switches with a pressed state
  assert.equal(c['--key-shadow'], 'none');
  assert.ok(/^0 2px 0 /.test(parts(d['--key-shadow'])[0]), 'a keycap stands on its own thickness');
  assert.ok(d['--key-pressed-shadow'].startsWith('inset') && d['--key-pressed-shadow'] !== c['--key-pressed-shadow'], 'pressed it sinks');
  assert.notEqual(d['--key-bg'], c['--key-bg']);
  // a glowing accent bar
  assert.equal(c['--accent-bar-glow'], 'none');
  assert.ok(d['--accent-bar-glow'].includes('{--accent}'), 'the bar glows in the accent role');
  // and it is not the vintage's either
  for (const k of ['--section-shadow', '--screen-shadow', '--key-shadow', '--accent-bar-glow']) assert.notEqual(d[k], EMITTED.vintage[k], k);
});

test('arm: the old recessed 3d section (inset shadows only) is no raised section', () => {
  const recessed = 'inset 0 3px 6px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(255,255,255,0.05)';
  assert.ok(!parts(recessed).some((p) => !p.startsWith('inset')));
});

/** A tokens.css text that holds the pin's values (the base block, the three finish blocks); `moved` replaces values by id. */
function pinCss(p, moved = {}) {
  const v = (id, value) => moved[id] ?? value;
  const base = [...Object.entries(p.tokens), ...Object.entries(p.relief), ...Object.entries(p.base)];
  const decl = (kvs, prefix = '') => kvs.map(([k, val]) => `  ${k}: ${v(prefix + k, val)};`).join('\n');
  const finish = (name) => `:root${name === p.defaultFinish ? ', :root' : ''}[data-finish="${name}"] {\n${decl(Object.entries(p.finish[name]), `${name}:`)}\n}`;
  return [`:root {\n${decl(base.filter(([k]) => k !== '--accent'))}\n}`, `:root, :root[data-accent="orange"] { --accent: ${v('--accent', p.tokens['--accent'])}; }`, ...Object.keys(p.finish).map(finish), `:root[data-theme="light"] {\n${decl(Object.entries(p.light), 'light:')}\n}`].join('\n');
}
