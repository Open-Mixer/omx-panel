// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// What the face declares once (tools/look/geometry.json) and the generator reads, never types again: the uppercase label's tracking
// (`label.letterSpacing`), and the screw heads' size and place (`screw`, `screwInset`), which the stylesheet and the raster both draw.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GEOMETRY, LETTER_SPACING, generateModgui, layout, loadLook, renderFace, resolvePanel } from '../tools/modgui-gen.mjs';
import { inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The pixels of a PNG this tree writes (8-bit RGBA, filter None on every line). */
function decodePng(png) {
  const b = Buffer.from(png), w = b.readUInt32BE(16), h = b.readUInt32BE(20), idat = [];
  for (let o = 8; o < b.length; ) { const n = b.readUInt32BE(o); if (b.toString('latin1', o + 4, o + 8) === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + n)); o += 12 + n; }
  const raw = inflateSync(Buffer.concat(idat)), data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) data.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
  return { w, h, data };
}
const GEO = JSON.parse(readFileSync(join(ROOT, 'tools/look/geometry.json'), 'utf8'));
const FIX = join(ROOT, 'test/fixtures/omx-delay');
const read = (f) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));
const gen = (look) => new Map(generateModgui(read('omx-delay.descriptor.json'), { panel: read('omx-delay.panel.json'), stem: 'omx-delay', source: 't', look }));

test('the label tracking is declared once: geometry.json holds it and no rule, test or fit types it again', () => {
  assert.equal(typeof GEO.label.letterSpacing, 'number');
  assert.equal(LETTER_SPACING, GEO.label.letterSpacing);
  for (const f of ['tools/modgui-gen.mjs', 'test/modgui-label-fit.test.mjs']) {
    assert.doesNotMatch(readFileSync(join(ROOT, f), 'utf8'), /letter-spacing:\s*0\.05em|0\.05 \* size/, `${f} types the tracking`);
  }
  const css = gen('vintage').get('modgui/stylesheet-omx-delay.css').toString();
  assert.match(css, new RegExp(`\\.omx-control-title \\{[^}]*letter-spacing: ${GEO.label.letterSpacing}em`));
});

test('the screw heads are readable: a declared size of 12 px or more, in the foot\'s corners clear of the head plate, with a slot', () => {
  assert.ok(GEOMETRY.screw >= 12, `${GEOMETRY.screw} px`);
  const css = gen('vintage').get('modgui/stylesheet-omx-delay.css').toString();
  const rule = css.match(/::before, [^\n]*::after \{[^}]*\}/)[0];
  assert.match(rule, new RegExp(`width: ${GEOMETRY.screw}px; height: ${GEOMETRY.screw}px`));
  assert.match(rule, new RegExp(`bottom: ${GEOMETRY.screwInset}px`));
  assert.doesNotMatch(rule, /top:/, 'the head plate would cover a screw at the top');
  assert.match(rule, /linear-gradient\(135deg/, 'a screwdriver slot');
});

test('the raster draws the same two heads: a metal disc with a slot darker than the metal', () => {
  const p = resolvePanel(read('omx-delay.descriptor.json'), { panel: read('omx-delay.panel.json'), stem: 'omx-delay' });
  const lay = { ...layout(p), brand: p.brand, name: p.name ?? p.stem, stem: p.stem };
  const img = decodePng(renderFace(lay, loadLook('vintage'), 4));
  const r = GEOMETRY.screw / 2, cx = (GEOMETRY.screwInset + r) * 4, cy = (lay.h - GEOMETRY.screwInset - r) * 4;
  const at = (x, y) => { const i = (Math.round(y) * img.w + Math.round(x)) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
  const lum = ([a, b, c]) => a + b + c;
  const off = at(cx - r * 4 * 0.5, cy - r * 4 * 0.5), on = at(cx, cy);
  assert.ok(lum(off) - lum(on) > 60, `the slot (${on}) is not darker than the metal beside it (${off})`);
});

test('copy-data has no side effect on import: it copies only when called, into the directory it is given', async () => {
  const { spawnSync } = await import('node:child_process');
  const { existsSync, mkdtempSync, statSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const probe = join(ROOT, 'dist/tools/look/geometry.json');
  const before = existsSync(probe) ? statSync(probe).mtimeMs : null;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(join(ROOT, 'tools/copy-data.mjs'))});`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(probe) ? statSync(probe).mtimeMs : null, before, 'importing copy-data wrote into dist/');
  const { copyData, DATA, COMMANDS } = await import('../tools/copy-data.mjs');
  const out = mkdtempSync(join(tmpdir(), 'copy-data-'));
  copyData(out);
  for (const f of ['tools/look/fader-vintage.svg', ...COMMANDS]) assert.ok(existsSync(join(out, f)), `${f} not copied`);
  assert.ok(DATA.every((f) => existsSync(join(out, f))));
});

test('every drawing the look reads ships in dist: the copy step lists each SVG of tools/look (a fader film needs fader-vintage.svg)', async () => {
  const { DATA } = await import('../tools/copy-data.mjs');
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(join(ROOT, 'tools/look')).filter((n) => n.endsWith('.svg'))) assert.ok(DATA.includes(`tools/look/${f}`), `${f} is not copied into dist`);
});

test('the meter-surfaces proof wears the flat look in the template as in the stylesheet: the template names the look it is given', () => {
  // the template's class names the look (omx-look-<name>) and the stylesheet scopes its rules by it: a template left to the default look
  // (vintage) under the flat look's stylesheet hides the bar and measures Infinity (the CI run of meter-surfaces)
  const src = readFileSync(join(ROOT, 'renderer/test/meter-surfaces.mjs'), 'utf8');
  const calls = [...src.matchAll(/modgui\.emitTemplate\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(calls.length > 0);
  for (const c of calls) assert.match(c, /,\s*'console'\s*$/, `emitTemplate(${c}) names no look`);
});

test('docs/modgui.md "The labels of a face" prints the numbers the face declares: a moved declaration makes the spec red', async () => {
  const { LABEL_SIZES, MAX_SELECTOR_STEPS, MAX_COUNT_VALUES } = await import('../tools/modgui-gen.mjs');
  const doc = readFileSync(join(ROOT, 'docs/modgui.md'), 'utf8');
  const section = doc.slice(doc.indexOf('## The labels of a face'), doc.indexOf('## The look switch')).replace(/\s+/g, ' ');
  assert.ok(section.length > 200, 'the section is missing');
  const sizes = LABEL_SIZES.length > 1 ? `${LABEL_SIZES.slice(0, -1).join(', ')} and ${LABEL_SIZES.at(-1)} px` : `${LABEL_SIZES[0]} px`;
  for (const [what, want] of [['the size steps', `(${sizes})`], ['the tracking', `${GEO.label.letterSpacing} em`], ['the label gap', `(${GEOMETRY.labelGap} px)`], ['the line limit', 'four lines'], ['the selector steps', `(${MAX_SELECTOR_STEPS})`], ['the count values', `(${MAX_COUNT_VALUES})`]]) {
    assert.ok(section.includes(want), `the spec does not say ${what}: '${want}'`);
  }
  // the arm: the spec is red against a declaration that moved
  assert.ok(!section.includes(`(${GEOMETRY.labelGap + 1} px)`));
});
