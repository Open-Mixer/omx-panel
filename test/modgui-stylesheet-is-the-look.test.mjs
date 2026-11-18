// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The MOD GUI stylesheet is drawn in the look omx-panel installs (tools/look.json, the one public look source, vintage by default):
// every colour it names is a colour that file holds, and the vintage values themselves are in it. A palette typed into the
// generator, or a stylesheet still in the former look, is red here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { emitStylesheet, loadLook, resolvePanel } from '../tools/modgui-gen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'test/fixtures/omx-delay');
const read = (f) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));
const LOOK_TEXT = readFileSync(join(ROOT, 'tools/look.json'), 'utf8');
const LOOK = JSON.parse(LOOK_TEXT);
const HEX = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi;
const norm = (h) => (h.length === 4 ? `#${[...h.slice(1)].map((c) => c + c).join('')}` : h).toLowerCase();
const HELD = new Set((LOOK_TEXT.match(HEX) ?? []).map(norm));

const stylesheet = (look) => emitStylesheet(resolvePanel(read('omx-delay.descriptor.json'), { panel: read('omx-delay.panel.json'), stem: 'omx-delay' }), look, 'look test');

test('the default look is the vintage look, and its stylesheet names only colours tools/look.json holds', () => {
  const css = stylesheet(loadLook());
  assert.match(css, /omx-look-vintage|vintage/);
  const strays = [...new Set((css.match(HEX) ?? []).map(norm))].filter((h) => !HELD.has(h));
  assert.deepEqual(strays, [], 'a colour in the stylesheet that the installed look does not hold');
});

test('the vintage values of tools/look.json are in the stylesheet: the roles it paints, the enclosure, the keys, the screen', () => {
  const css = stylesheet(loadLook('vintage')).toLowerCase();
  const first = (v) => norm(String(v).match(HEX)?.[0] ?? '');
  for (const role of ['--accent', '--border-strong', '--curve-stroke']) {
    assert.ok(css.includes(LOOK.tokens[role].toLowerCase()), `${role} ${LOOK.tokens[role]} is not in the vintage stylesheet`);
  }
  for (const k of ['--key-bg', '--key-pressed-bg', '--key-held-bg']) {
    const want = first(LOOK.looks.vintage[k]);
    assert.ok(want && css.includes(want), `vintage ${k} ${want} is not in the stylesheet`);
  }
  const bodyBg = css.match(/background:\s*radial-gradient\([^;]*\)/)?.[0];
  assert.ok(bodyBg && bodyBg.includes(first(LOOK.looks.vintage['--enclosure'])), 'the body is not the vintage enclosure');
});

test('arm: a stylesheet in another look is told apart: the vintage enclosure is not in the console look\'s', () => {
  const want = norm(LOOK.looks.vintage['--enclosure']);
  assert.ok(!stylesheet(loadLook('console')).toLowerCase().includes(want));
  assert.ok(stylesheet(loadLook('vintage')).toLowerCase().includes(want));
});
