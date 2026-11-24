// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The renderer wears the look's style whole (omx-panel#123): under the vintage style a panel is the MOD GUI's vintage face
 * (tools/modgui-gen.mjs renderFace over the vintage look), pixel for pixel: the cream enclosure with its radius, the dark head
 * plate inset in it, the screws in the foot's corners, no section plates, the dark keys and screens, the lamp, and each text in the
 * look's own ink, beside the knob that PR 2 drew. Every value is read from tools/look.json `looks.<style>`, as the face reads it:
 * a token's first colour, a colour role in braces, `none` for a thing not drawn. The console style is held by the parity tests,
 * which pin it; here a style the look does not carry whole is refused by the token's name.
 */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { modgui, CLI, FIXTURES, ROOT, TOOLS, compare, decodePng, descriptionFile, render, resolved, scratch, stateFile } from './harness.mjs';

const LOOK = JSON.parse(readFileSync(join(TOOLS, 'look.json'), 'utf8'));

/** A copy of the tools directory whose look names `style`, `mutate` applied to the look. */
function dataWith(style, mutate = () => {}) {
  const base = mkdtempSync(join(tmpdir(), 'omx-panel-face-'));
  const dir = join(base, 'tools');
  cpSync(TOOLS, dir, { recursive: true });
  cpSync(join(ROOT, 'schema'), join(base, 'schema'), { recursive: true });
  const look = structuredClone(LOOK);
  look.style = style;
  mutate(look);
  writeFileSync(join(dir, 'look.json'), JSON.stringify(look, null, 2));
  process.on('exit', () => rmSync(base, { recursive: true, force: true }));
  return dir;
}

/** The MOD GUI generator's face of the fixture in `look`, as pixels. */
function face(fx, look, scale) {
  const p = resolved(fx);
  return decodePng(modgui.renderFace({ ...modgui.layout(p), brand: p.brand, name: p.name ?? p.stem }, modgui.loadLook(look), scale));
}

// the 3d style's knob is an SVG file of the tree, not a scene of the look: the renderer refuses it by name (vintage-knob.test.mjs)
for (const style of ['vintage']) {
  const data = dataWith(style);
  for (const fx of FIXTURES) {
    for (const scale of [1, 2]) {
      test(`${fx.name} at ${scale}x under the ${style} style is the MOD GUI's ${style} face, pixel for pixel`, () => {
        const dir = scratch();
        const want = face(fx, style, scale);
        const drawn = render(descriptionFile(fx, dir), stateFile(fx, dir), { scale, data });
        const d = compare(drawn, want);
        assert.ok(d.sameSize, `size ${drawn.w}x${drawn.h}, the face is ${want.w}x${want.h}`);
        assert.ok(d.exact, `${d.off} pixels differ, by up to ${d.worst}`);
      });
    }
  }
}

test('a style whose look lacks a token the face wears is refused by the token\'s name, never drawn in another colour', () => {
  const fx = FIXTURES[0], dir = scratch();
  for (const token of ['--key-bg', '--t-control', '--body-bg', '--screws']) {
    const data = dataWith('vintage', (look) => { delete look.looks.vintage[token]; });
    assert.throws(() => execFileSync(CLI, ['--description', descriptionFile(fx, dir), '--data', data, '--state', stateFile(fx, dir), '--png', join(dir, 'x.png')], { stdio: 'pipe' }),
      (e) => e.stderr.toString().includes(token), token);
  }
});
