// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The vintage knob is DATA of look.json (omx-panel#123, PR 1): its scene, a list of shapes and gradients with the look's
// colour placeholders, is the one source. The film strips are rendered FROM it, and the hand-drawn SVG it was derived from
// is no longer a file anyone edits: no two copies. The bytes it draws are the bytes the SVG drew (the pins), for every finish
// and in the face; a scene the renderer's two backends cannot draw (a gradient of more than two stops, a shape outside the
// subset) is refused by name when the looks are generated.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkLooks, loadLooks } from '../tools/look.mjs';
import { generateModgui, loadLook, renderFilm } from '../tools/modgui-gen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOOK = JSON.parse(readFileSync(join(ROOT, 'tools/look.json'), 'utf8'));
const PINS = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/knob-vintage-pins.json'), 'utf8'));
const read = (f) => JSON.parse(readFileSync(join(ROOT, 'test/fixtures/omx-delay', f), 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** The vintage look with the finish `name`: its pinned metal, as loadLook sets it for the look's own finish. */
function vintage(finish) {
  const l = loadLook('vintage');
  l.depth = { ...l.depth, '--finish': finish };
  l.pinned = Object.fromEntries([...Object.entries(LOOK.console.tokens).map(([k, v]) => [`console:${k}`, v]), ...Object.entries(LOOK.console.finish[finish]).map(([k, v]) => [`finish:${k}`, v])]);
  return l;
}

test('look.json carries the vintage knob as a scene: shapes and one two-stop gradient, the colours as the look\'s placeholders', () => {
  const scene = LOOK.drawings?.['knob-vintage'];
  assert.ok(scene, 'look.json has no drawings["knob-vintage"]');
  assert.equal(scene.viewBox, 48);
  assert.deepEqual(Object.keys(scene.gradients), ['cap']);
  assert.equal(scene.gradients.cap.stops.length, 2);
  assert.equal(scene.shapes.length, 42);
  assert.ok(scene.shapes.some((s) => s.rotate.some((r) => r.angle === '{angle}')), 'the pointer turns by the frame\'s {angle}');
  assert.match(JSON.stringify(scene), /\{finish:--knob-cap-hi\}/);
});

test('the vintage look names the drawing, and no hand SVG of it is left to edit', () => {
  assert.equal(LOOK.looks.vintage['--knob'], 'knob-vintage');
  assert.equal(existsSync(join(ROOT, 'tools/look/knob-vintage.svg')), false, 'tools/look/knob-vintage.svg is a second copy of the drawing');
});

test('the film strip of each finish is the bytes the SVG drew', () => {
  for (const finish of Object.keys(LOOK.console.finish)) assert.equal(sha(renderFilm(vintage(finish))), PINS[`film-knob-vintage-${finish}`], finish);
});

test('the vintage face\'s screenshot, its knobs painted from the scene, is the bytes the SVG drew', () => {
  const files = new Map(generateModgui(read('omx-delay.descriptor.json'), { panel: read('omx-delay.panel.json'), stem: 'omx-delay', source: 'pins' }));
  assert.equal(sha(files.get('modgui/screenshot-omx-delay.png')), PINS['face-omx-delay-vintage-screenshot']);
});

test('the film is rendered FROM the scene of the look it is given: change a colour in it and the film changes', () => {
  const l = vintage('aluminium');
  assert.ok(l.drawings?.['knob-vintage'], 'loadLook hands the look\'s drawings on');
  const was = sha(renderFilm(l));
  assert.equal(was, PINS['film-knob-vintage-aluminium']);
  l.drawings = structuredClone(l.drawings);
  l.drawings['knob-vintage'].gradients.cap.stops[0].color = '{finish:--knob-edge}';
  assert.notEqual(sha(renderFilm(l)), was, 'the film ignored the scene it was given');
});

const faults = (mutate) => {
  const looks = structuredClone(loadLooks());
  mutate(looks);
  return checkLooks(looks);
};

test('a gradient of three stops is refused by name when the looks are generated: the renderer\'s backends take two', () => {
  const f = faults((l) => l.drawings['knob-vintage'].gradients.cap.stops.push({ offset: 0.5, color: '{finish:--knob-face}' }));
  assert.ok(f.some((x) => /knob-vintage.*gradient 'cap'.*3 stops/.test(x)), f.join('; '));
});

test('a shape outside the subset is refused by name', () => {
  const f = faults((l) => l.drawings['knob-vintage'].shapes.push({ tag: 'path', attrs: { d: 'M0 0' }, rotate: [] }));
  assert.ok(f.some((x) => /knob-vintage.*'path'/.test(x)), f.join('; '));
});

test('a look whose --knob names no drawing and no file is refused by name', () => {
  const f = faults((l) => { l.looks.vintage['--knob'] = 'knob-nothing'; });
  assert.ok(f.some((x) => /--knob.*knob-nothing/.test(x)), f.join('; '));
});

test('the scene\'s colours name only placeholders the look resolves: a typo is refused by name', () => {
  const f = faults((l) => { l.drawings['knob-vintage'].shapes[0].attrs.stroke = '{finish:--knob-nope}'; });
  assert.ok(f.some((x) => /knob-vintage.*--knob-nope/.test(x)), f.join('; '));
});
