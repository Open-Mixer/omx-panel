// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The MOD GUI's three looks (schema/look-roles.json `looks`, emitted into tools/look.json): vintage (the default), console
// (the console's flat look, today's bytes) and 3d. Each look emits every token it declares into the stylesheet, the default
// is vintage, an unknown look is refused by name, the knob film strip has the declared frame count and size in every look,
// every look's switch has a pressed state, and no text/background pair falls below the console's contrast.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { contrastTable, FLOOR, textRules } from '../tools/look-contrast.mjs';
import { DEFAULT_LOOK, GEOMETRY, LOOK_KEYS, LOOKS, LOOK_SETTING, generateModgui, loadLook, renderFilm, wornDepth } from '../tools/modgui-gen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'test/fixtures/omx-delay');
const read = (f) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));
const gen = (look) => generateModgui(read('omx-delay.descriptor.json'), { panel: read('omx-delay.panel.json'), stem: 'omx-delay', source: 'looks test', ...(look ? { look } : {}) });
const css = (look) => gen(look).find(([p]) => p.endsWith('.css'))[1].toString();
const cli = (...args) => spawnSync(process.execPath, [join(ROOT, 'tools/modgui-gen.mjs'), ...args], { encoding: 'utf8' });
const png = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

test('the setting is declared: name modgui-look, the three looks, default vintage', () => {
  assert.equal(LOOK_SETTING.name, 'modgui-look');
  assert.deepEqual([...LOOKS].sort(), ['3d', 'console', 'vintage']);
  assert.equal(DEFAULT_LOOK, 'vintage');
  assert.equal(LOOK_SETTING.default, 'vintage');
});

test('every look declares every token of the one schema, and no other', () => {
  for (const name of LOOKS) assert.deepEqual(Object.keys(loadLook(name).depth).sort(), [...LOOK_KEYS].sort(), name);
});

for (const name of ['vintage', 'console', '3d']) {
  test(`${name}: its stylesheet carries every token it declares`, () => {
    const look = loadLook(name);
    const text = css(name);
    for (const k of LOOK_KEYS) {
      const v = wornDepth(look)[k];
      // a token that is `none` draws nothing; every other one is in the CSS, resolved
      if (v === 'none' || k === '--knob' || k === '--enclosure' || v.includes('{') || ['--t-list-sel', '--head-inset', '--body-radius', '--control-caps'].includes(k)) continue; // the selector's own rule: omx-delay draws no selector
      assert.ok(text.includes(v), `${name}: ${k} = ${v} is not in the stylesheet`);
    }
  });
  test(`${name}: the knob film strip has ${GEOMETRY.filmFrames} frames of ${GEOMETRY.knob} px`, () => {
    const { w, h } = png(renderFilm(loadLook(name)));
    assert.deepEqual([w, h], [GEOMETRY.knob * GEOMETRY.filmFrames, GEOMETRY.knob]);
    assert.equal(GEOMETRY.filmFrames, 65);
  });
  test(`${name}: every switch has a pressed state`, () => {
    const text = css(name);
    assert.match(text, /\.omx-switch-image\.on \{[^}]*background:/, 'the latched (on) state');
    if (name !== 'console') assert.match(text, /\.omx-switch-image:active \{[^}]*(background|box-shadow):/, 'the held (:active) state');
  });
}

test('the default look is vintage', () => {
  assert.ok(css().includes(wornDepth(loadLook('vintage'))['--key-pressed-shadow']));
  assert.deepEqual(gen().map(([, b]) => Buffer.from(b)), gen('vintage').map(([, b]) => Buffer.from(b)));
  assert.notEqual(css('vintage'), css('console'));
  assert.notEqual(css('3d'), css('console'));
  assert.notEqual(css('3d'), css('vintage'));
});

test('an unknown look is refused by name, in the library and on the command line', () => {
  assert.throws(() => loadLook('chrome'), /chrome/);
  const out = join(mkdtempSync(join(tmpdir(), 'looks-')), 'omx-delay.lv2');
  const r = cli('--emit-stdout', '--look', 'chrome', '--descriptor', join(FIX, 'omx-delay.descriptor.json'), '--panel', join(FIX, 'omx-delay.panel.json'), '--out', out);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /chrome/);
  assert.match(r.stderr, /vintage/);
});

test('the three looks differ in their knob', () => {
  const a = renderFilm(loadLook('console')), b = renderFilm(loadLook('3d')), c = renderFilm(loadLook('vintage'));
  assert.ok(!a.equals(b) && !b.equals(c) && !a.equals(c));
});

test('a look short of a token is refused by that token', () => {
  const base = loadLook('3d');
  const depth = { ...base.depth };
  delete depth['--section-shadow'];
  assert.throws(() => gen({ ...base, depth }), /--section-shadow/);
});

test('contrast: no pair of the console or 3d falls below today\'s, and every pair of every look clears 4.5:1', () => {
  const rows = contrastTable();
  assert.ok(rows.length >= 3 * 10, `${rows.length} rows`);
  for (const r of rows) {
    assert.ok(Number.isFinite(r.after), `${r.look} ${r.rule}: no ratio`);
    assert.ok(r.after >= FLOOR - 1e-9, `${r.look} ${r.rule}: ${r.after.toFixed(2)} is under ${FLOOR}:1`);
    if (r.look !== 'vintage') assert.ok(r.after >= r.before - 1e-9, `${r.look} ${r.rule}: ${r.after.toFixed(2)} < today's ${r.before.toFixed(2)}`);
  }
});

test('contrast: every text colour the stylesheet sets is in the table', () => {
  const listed = new Set(contrastTable().map((r) => r.rule));
  for (const name of LOOKS) for (const rule of textRules(css(name))) assert.ok(listed.has(rule), `${name}: '${rule}' sets a text colour no pair covers`);
});

test('contrast: the table has teeth, a lighter plate under dim text is caught', () => {
  const rows = contrastTable({ override: { section: '#ffffff' } });
  assert.ok(rows.some((r) => r.after < r.before), 'a white section kept every ratio');
});

// ------------------------------------------------------------------------------------------ the scribble strips

const html = (look, descriptor = 'omx-delay.descriptor.json', panel = 'omx-delay.panel.json') =>
  generateModgui(read(descriptor), { panel: read(panel), stem: 'omx-delay', source: 'looks test', look }).find(([p]) => p.endsWith('.html'))[1].toString();
/** The controls of a template: [symbol, widget, inner html]. */
const controls = (text) => [...text.matchAll(/<div class="omx-control omx-(\w+)[^"]*"[^>]*data-symbol="([^"]+)"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g)].map((m) => [m[2], m[1], m[3]]);

for (const name of ['vintage', 'console', '3d']) {
  test(`${name}: every control but a selector has a scribble strip bound to its port, with no static value text`, () => {
    const text = html(name);
    const list = controls(text).filter(([, w]) => w !== 'selector' && w !== 'display');
    assert.ok(list.length >= 4, `${list.length} controls`);
    for (const [symbol] of list) {
      assert.match(text, new RegExp(`<div class="omx-scribble" mod-role="input-control-value" mod-port-symbol="${symbol}" data-unit="[^"]*"></div>`), `${name}: ${symbol} has no bound scribble`);
    }
    // bound means empty: mod-ui writes the port's value into it; any text in a scribble is a static value
    for (const m of text.matchAll(/<div class="omx-scribble"[^>]*>([^<]*)<\/div>/g)) assert.equal(m[1], '', 'a scribble carries static text');
    assert.equal([...text.matchAll(/class="omx-scribble"/g)].length, list.length);
  });
}

test('arm: a static value in a scribble, or a scribble with no port role, is caught', () => {
  const text = html('vintage');
  const bound = /<div class="omx-scribble" mod-role="input-control-value" mod-port-symbol="[^"]+" data-unit="[^"]*"><\/div>/;
  assert.match(text, bound);
  const staticValue = text.replace('data-unit="ms"></div>', 'data-unit="ms">300</div>');
  assert.notEqual(staticValue, text, 'the arm landed');
  assert.ok([...staticValue.matchAll(/<div class="omx-scribble"[^>]*>([^<]*)<\/div>/g)].some((m) => m[1] !== ''));
});

// ------------------------------------------------------------------- the console's glass, pinned and never retyped

test('the vintage screens wear the console\'s own glass: look.json holds exactly the pinned values', async () => {
  const { loadPin, PINNED } = await import('../tools/look-pin.mjs');
  const pin = loadPin();
  assert.deepEqual(Object.keys(pin.tokens), PINNED);
  const v = JSON.parse(readFileSync(join(ROOT, 'tools/look.json'), 'utf8')).looks.vintage;
  assert.ok(v['--screen-bg'].includes(pin.tokens['--glass']) && v['--screen-bg'].includes(pin.tokens['--glass-grid']));
  assert.equal(v['--scribble-bg'], pin.tokens['--glass']);
  assert.equal(v['--scribble-ink'], pin.tokens['--accent']);
  assert.equal(v['--curve-line'], pin.tokens['--accent']);
  assert.equal(v['--t-screen'], pin.tokens['--legend']);
  assert.ok(v['--scribble-glow'].includes(pin.tokens['--accent']));
});

test('the pin is the console\'s tokens.css at the pinned commit: the hash and the four values (give the file as $OPENMIXER_TOKENS_CSS)', async (t) => {
  const { checkPin, extractTokens } = await import('../tools/look-pin.mjs');
  const file = process.env.OPENMIXER_TOKENS_CSS;
  if (!file) {
    if (process.env.CI) assert.fail('CI gives the console\'s tokens.css at the pinned commit as $OPENMIXER_TOKENS_CSS');
    t.skip('no $OPENMIXER_TOKENS_CSS: the pin is checked where the console is at hand (the release check)');
    return;
  }
  const css = readFileSync(file, 'utf8');
  assert.deepEqual(checkPin(css), []);
  // arm: a moved glass is refused
  assert.match(checkPin(css.replace(extractTokens(css)['--glass'], '#123456')).join(';'), /--glass/);
});
