// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The colour roles (the one-panel spec, §7.10): declared once in
// schema/look-roles.json, each with its family, its floor and ONE default; tools/look.json and the renderer's role list
// derive from that file; the hand copy of the console's cascade (tools/look/tokens.css) is gone; no surface spells a
// colour, every token a surface reads is a role; and each role a surface reads moves what it draws. Every rule has a
// sabotage arm.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkRoles, contrast, emitLook, emitRoleHeader, loadRoles, LOOK_JSON, ROLE_HEADER, ROLES_JSON } from '../tools/look.mjs';
import { generateModgui, loadLook, renderFaderFilm, renderFilm } from '../tools/modgui-gen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = loadRoles();
const clone = () => structuredClone(doc);
const role = (d, n) => d.roles.find((r) => r.name === n);

/** The census of §7.10: surfaces and rim, ink, legend, glass, accent, the meter zones, the EQ delta pair, the state
 * lamps, the origin marks. */
const CENSUS = [
  '--surface', '--surface-2', '--surface-3', '--glass', '--border', '--border-strong',
  '--ink', '--ink-dim', '--ink-faint', '--legend', '--accent',
  '--meter-green', '--meter-amber', '--meter-red', '--eq-delta-boost', '--eq-delta-cut',
  '--state-engaged', '--state-reduction', '--state-bypass',
  '--origin-fbs', '--origin-hrp', '--origin-room-mode',
];
/** Console chrome, named by §7.10 as no role: finish metals, slot, fill, glass grid, focus ring, shade, selected. */
const CHROME = ['--knob-face', '--knob-edge', '--fader-cap', '--fader-slot', '--fader-fill', '--glass-grid', '--focus-ring', '--shade', '--selected-bg'];

test('the role file is the census: the roles §7.10 names, under the console token names, and no chrome', () => {
  assert.deepEqual(doc.roles.map((r) => r.name), CENSUS);
  for (const c of CHROME) assert.equal(role(doc, c), undefined, `${c} is chrome, not a role`);
  assert.deepEqual(doc.look, { theme: 'dark', accent: 'cyan', finish: 'aluminium', style: 'modern' });
});

test('each role once, its family one of four, a floor or a ground, one default: the file as committed breaks no rule', () => {
  assert.deepEqual(checkRoles(doc), []);
});

test('arm: a second value set in the role file is red, at the top and under a role', () => {
  const top = clone();
  top.themes = { light: { '--ink': '#11171d' } };
  assert.match(checkRoles(top).join('\n'), /carries 'themes'/);
  const under = clone();
  role(under, '--ink').light = '#11171d';
  assert.match(checkRoles(under).join('\n'), /--ink carries 'light'/);
});

test('arm: a role declared twice, a family that is finish, a default that is no colour, a floor on no ground: each red', () => {
  const twice = clone();
  twice.roles.push({ ...role(twice, '--accent') });
  assert.match(checkRoles(twice).join('\n'), /--accent is declared twice/);
  const finish = clone();
  role(finish, '--legend').family = 'finish';
  assert.match(checkRoles(finish).join('\n'), /--legend's family 'finish'/);
  const word = clone();
  role(word, '--meter-red').default = 'red';
  assert.match(checkRoles(word).join('\n'), /--meter-red's default 'red'/);
  const onInk = clone();
  role(onInk, '--accent').floor.on = ['--ink'];
  assert.match(checkRoles(onInk).join('\n'), /--accent's floor is on --ink, which is no ground/);
  const noFloor = clone();
  delete role(noFloor, '--ink-dim').floor;
  assert.match(checkRoles(noFloor).join('\n'), /--ink-dim is no ground and has no floor/);
});

test('every default clears its floor, and the origin marks clear 3:1 on the glass and stand apart in luminance', () => {
  const glass = role(doc, '--glass').default;
  const marks = ['--origin-fbs', '--origin-hrp', '--origin-room-mode'];
  for (const m of marks) assert.ok(contrast(role(doc, m).default, glass) >= 3, m);
  for (let i = 0; i < marks.length; i++)
    for (let j = i + 1; j < marks.length; j++) assert.ok(contrast(role(doc, marks[i]).default, role(doc, marks[j]).default) >= 1.3, `${marks[i]} / ${marks[j]}`);
});

test('arm: a default under its floor is red; two origin marks of one luminance are red', () => {
  const dim = clone();
  role(dim, '--ink-dim').default = role(dim, '--border-strong').default;
  assert.match(checkRoles(dim).join('\n'), /--ink-dim #3a444f measures [0-9.]+:1 on --surface/);
  const same = clone();
  role(same, '--origin-hrp').default = role(same, '--origin-fbs').default;
  assert.match(checkRoles(same).join('\n'), /--origin-hrp #ff7ad0 and --origin-fbs #ff7ad0 are 1\.00:1 apart/);
});

test('a host table is held to the same floors: every role valued, a missing one named', () => {
  const values = Object.fromEntries(doc.roles.map((r) => [r.name, r.default]));
  assert.deepEqual(checkRoles(doc, values), []);
  delete values['--origin-room-mode'];
  assert.match(checkRoles(doc, values).join('\n'), /--origin-room-mode has no #rrggbb value/);
});

test('tools/look.json is the role defaults and the font, and nothing else; a moved default moves it', () => {
  assert.equal(emitLook(doc), readFileSync(LOOK_JSON, 'utf8'));
  const tokens = JSON.parse(readFileSync(LOOK_JSON, 'utf8')).tokens;
  assert.deepEqual(Object.keys(tokens), [...CENSUS, '--font-ui', '--font-file']);
  for (const r of doc.roles) assert.equal(tokens[r.name], r.default);
  const moved = clone();
  role(moved, '--accent').default = '#40d0f0';
  assert.notEqual(emitLook(moved), emitLook(doc));
});

test('the hand copy of the console cascade is gone, and nothing ships or names it', () => {
  assert.equal(existsSync(join(ROOT, 'tools/look/tokens.css')), false);
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.exports['./tokens.css'], undefined);
  assert.equal(pkg.exports['./look-roles.json'], './dist/schema/look-roles.json');
  assert.doesNotMatch(readFileSync(join(ROOT, 'tools/copy-data.mjs'), 'utf8'), /tokens\.css/);
  assert.match(readFileSync(join(ROOT, 'tools/copy-data.mjs'), 'utf8'), /'schema\/look-roles\.json'/);
});

test("the renderer's role list is the role file's, and read_look walks it", () => {
  assert.equal(emitRoleHeader(doc), readFileSync(ROLE_HEADER, 'utf8'));
  const view = readFileSync(join(ROOT, 'renderer/src/view.c'), 'utf8');
  assert.match(view, /#include "look_roles\.h"/);
  assert.match(view, /for \(size_t i = 0; i < OMX_LOOK_ROLE_COUNT; i\+\+\)/);
  const fewer = clone();
  fewer.roles = fewer.roles.filter((r) => r.name !== '--eq-delta-cut');
  assert.doesNotMatch(emitRoleHeader(fewer), /--eq-delta-cut/);
});

/* ---------------------------------------------------------------------------------------------------- the ratchet */

/** The code that draws a panel on a surface: the MOD GUI generator and its raster, the C renderer. omx-panel has no CLAP
 * generator: a CLAP plugin's panel is drawn by the renderer. */
const SURFACES = [
  'tools/modgui-gen.mjs',
  'tools/raster.mjs',
  ...readdirSync(join(ROOT, 'renderer/src')).filter((f) => /\.[ch]$/.test(f)).map((f) => `renderer/src/${f}`),
];
const NAMED = /:\s*(white|black|red|green|blue|gr[ae]y|orange|yellow|cyan|magenta|silver)\b/;

/** What a surface's text spells that is a colour, and every --token it reads that is no role (or the font). */
export function surfaceFaults(file, text, roles) {
  const faults = [];
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\*).*$/gm, '');
  for (const m of code.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\b(?:rgba?|hsla?)\s*\(/g)) faults.push(`${file} spells the colour '${m[0]}'`);
  const named = code.match(NAMED);
  if (named) faults.push(`${file} spells the colour '${named[1]}'`);
  for (const n of reads(file, code)) if (!roles.includes(n) && n !== '--font-ui' && n !== '--font-file') faults.push(`${file} reads ${n}, which is no role`);
  return faults;
}

/** The --tokens a surface reads: `tok['--x']` in the generator, a `{"--x", &v->col...}` entry in the renderer. */
function reads(file, code) {
  const out = [];
  for (const m of code.matchAll(/\btok(?:ens)?\[['"](--[a-z0-9-]+)['"]\]/g)) out.push(m[1]);
  for (const m of code.matchAll(/\{\s*"(--[a-z0-9-]+)"\s*,\s*&v->col/g)) out.push(m[1]);
  return out;
}

const NAMES = doc.roles.map((r) => r.name);
const text = (f) => readFileSync(join(ROOT, f), 'utf8');

test('no surface spells a colour, and every token a surface reads is a role', () => {
  const faults = SURFACES.flatMap((f) => surfaceFaults(f, text(f), NAMES));
  assert.deepEqual(faults, []);
});

test('positive control: the ratchet sees the reads it judges (--accent in the generator and in the renderer)', () => {
  assert.ok(reads('tools/modgui-gen.mjs', text('tools/modgui-gen.mjs')).includes('--accent'));
  assert.ok(reads('renderer/src/view.c', text('renderer/src/view.c')).includes('--accent'));
});

test('arm: a hex colour, an rgb() and a named colour in the generator are red; so is a token that is no role', () => {
  const gen = text('tools/modgui-gen.mjs');
  assert.match(surfaceFaults('g', gen.replace("background: ${tok['--surface']}", 'background: #ff0000'), NAMES).join('\n'), /spells the colour '#ff0000'/);
  assert.match(surfaceFaults('g', gen.replace("background: ${tok['--surface']}", 'background: rgb(1, 2, 3)'), NAMES).join('\n'), /spells the colour 'rgb\('/);
  assert.match(surfaceFaults('g', gen.replace("background: ${tok['--surface']}", 'background: white'), NAMES).join('\n'), /spells the colour 'white'/);
  assert.match(surfaceFaults('g', gen.replace("tok['--accent']", "tok['--tab-line']"), NAMES).join('\n'), /reads --tab-line, which is no role/);
});

test('arm: the renderer reading chrome instead of a role is red', () => {
  const view = text('renderer/src/view.c');
  const broken = view.replace('{"--accent", &v->col.accent}', '{"--knob-face", &v->col.accent}');
  assert.notEqual(broken, view, 'the edit landed');
  assert.match(surfaceFaults('view.c', broken, NAMES).join('\n'), /reads --knob-face, which is no role/);
});

/* ------------------------------------------------------------------------------------------- a fixture per role */

const FIX = join(ROOT, 'test/fixtures/omx-delay');
const read = (f) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));

/** The MOD GUI of omx-delay, every file it writes, at `look`. */
function modguiAt(look) {
  const out = generateModgui(read('omx-delay.descriptor.json'), { panel: read('omx-delay.panel.json'), stem: 'omx-delay', source: 'look-roles test' }, look);
  return out.map(([, body]) => Buffer.from(body)).concat([renderFilm(look.tokens), renderFaderFilm(look.tokens)]);
}

test('a fixture per role: each role the MOD GUI reads, moved to a colour of its own, moves what it draws', () => {
  const base = loadLook();
  const drawn = [...new Set(reads('tools/modgui-gen.mjs', text('tools/modgui-gen.mjs')))].filter((n) => NAMES.includes(n));
  assert.ok(drawn.length >= 7, `the MOD GUI reads ${drawn.join(' ')}`);
  const was = modguiAt(base);
  for (const n of drawn) {
    const moved = { ...base, tokens: { ...base.tokens, [n]: '#010203' } };
    const now = modguiAt(moved);
    assert.ok(now.some((b, i) => !b.equals(was[i])), `${n} moved nothing the MOD GUI draws`);
  }
});

test('the MOD GUI refuses a look that lacks a role, naming it', () => {
  const base = loadLook();
  const tokens = { ...base.tokens };
  delete tokens['--origin-room-mode'];
  assert.throws(() => modguiAt({ ...base, tokens }), /--origin-room-mode/);
});

test('the role file ships where the package says', () => {
  assert.equal(existsSync(ROLES_JSON), true);
});
