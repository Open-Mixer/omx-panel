// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The document shapes (docs/shapes.md): shapes/<name>.schema.json is the one source of the TypeScript and Python types of
 * omx-panel's documents, and the renders are COMMITTED, held to a fresh render by omx-contract's own `render --shapes
 * --check` with its two pinned generators (the same facility omx-contract's own shapes use: no generator of our own).
 * Each rule has its arm, a test that goes red when what it protects is broken:
 *   a real document breaking its shape, a shape's words drifting from the declaration, a hand-edited render, a render
 *   that is stale against its schema, a render nobody committed, a missing generator, an unusable Python module.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { GESTURE_CODES } from '../dist/tools/gestures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const SHAPES = readdirSync(join(ROOT, 'shapes')).filter((f) => f.endsWith('.schema.json')).sort().map((f) => f.replace('.schema.json', ''));
const gestures = read('schema/gestures.json');

const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const n of SHAPES) ajv.addSchema(read(`shapes/${n}.schema.json`));
const idOf = (n, def) => `https://openmixer.org/schema/omx-panel/shapes/${n}.schema.json${def ? `#/$defs/${def}` : ''}`;
const verdict = (n, doc, def) => {
  const v = ajv.getSchema(idOf(n, def));
  return { ok: v(doc), errors: JSON.stringify(v.errors) };
};
const valid = (n, doc, def) => { const r = verdict(n, doc, def); assert.ok(r.ok, `${n}${def ? `#${def}` : ''}: ${r.errors}`); };
const invalid = (n, doc, def) => assert.equal(verdict(n, doc, def).ok, false, `${n}${def ? `#${def}` : ''} accepted a document it must refuse`);

test('the shapes are the four omx-panel owns, each a valid 2020-12 schema under strict ajv', () => {
  assert.deepEqual(SHAPES, ['code', 'gesture_io', 'gestures', 'look_role']);
});

// ---- the real documents are held to their shapes ---------------------------------------------------------------

test('schema/gestures.json is a Gestures document, and a stray key, a missing key and an unknown word are each refused', () => {
  valid('gestures', gestures);
  invalid('gestures', { ...structuredClone(gestures), extra: 1 });
  const noTable = structuredClone(gestures); delete noTable.table;
  invalid('gestures', noTable);
  const badWord = structuredClone(gestures); badWord.table.knob.drag = 'wiggle';
  invalid('gestures', badWord);
  const badInput = structuredClone(gestures); badInput.table.knob.shake = 'drag';
  invalid('gestures', badInput);
});

test('the words, the inputs and the widgets of the shape are the declaration\'s, in its order', () => {
  const defs = read('shapes/gestures.schema.json').$defs;
  assert.deepEqual(defs.Word.enum, Object.keys(gestures.words));
  assert.deepEqual(defs.Input.enum, gestures.inputs);
  assert.deepEqual(defs.Widget.enum, Object.keys(gestures.table));
  assert.deepEqual(Object.keys(defs.Words.properties), Object.keys(gestures.words));
  assert.deepEqual(Object.keys(defs.Timings.properties), Object.keys(gestures.timings));
  assert.deepEqual(Object.keys(defs.Thresholds.properties), Object.keys(gestures.thresholds));
  // the widget list is the panel schema's plus the bar and the handle of a group (the table's own keys)
  assert.deepEqual(defs.Widget.enum, [...read('schema/panel.schema.json').$defs.widget.enum, 'bar', 'handle'].sort((a, b) => defs.Widget.enum.indexOf(a) - defs.Widget.enum.indexOf(b)));
});

test('every role of schema/look-roles.json is a LookRole, and a role with a stray key or a bad family is refused', () => {
  const roles = read('schema/look-roles.json').roles;
  assert.ok(roles.length >= 20, 'the roles were read');
  for (const r of roles) valid('look_role', r);
  invalid('look_role', { ...roles[0], extra: 1 });
  invalid('look_role', { ...roles[0], family: 'finish' });
  invalid('look_role', { ...roles[0], default: 'red' });
});

test('every code of schema/codes.json is a PanelCode, and a code with another language\'s key or no args is refused', () => {
  const codes = Object.values(read('schema/codes.json').codes);
  assert.ok(codes.length >= 30, 'the codes were read');
  for (const c of codes) valid('code', c);
  invalid('code', { ...codes[0], text: { en: 'x', ca: 'y' } });
  const noArgs = { ...codes[0] }; delete noArgs.args;
  invalid('code', noArgs);
});

test('the gesture run\'s refusal codes, words and inputs are the reference\'s; its events are the parity scripts\'', () => {
  const defs = read('shapes/gesture_io.schema.json').$defs;
  assert.deepEqual(defs.Refusal.properties.code.enum, Object.values(GESTURE_CODES));
  assert.deepEqual(defs.Gesture.properties.word.enum, Object.keys(gestures.words));
  assert.deepEqual(defs.Gesture.properties.input.enum, gestures.inputs);
  assert.deepEqual(defs.Control.properties.widget.enum, Object.keys(gestures.table));
  const scripts = read('fixtures/gestures/scripts.json').scripts;
  assert.ok(scripts.length >= 20, `${scripts.length} scripts`);
  for (const s of scripts) for (const e of s.script) valid('gesture_io', e, 'Event');
  invalid('gesture_io', { t: 0, type: 'hover' }, 'Event');
  invalid('gesture_io', { t: 0, type: 'down', speed: 1 }, 'Event');
});

test('a control, a call and an answer of the gesture run are accepted, and an answer with a map for its value is refused', () => {
  const control = { widget: 'knob', min: 0, max: 100, def: 50, value: 20, travelPx: 200, target: { x: 0, y: 0, w: 40, h: 220 } };
  const gesture = { id: 'g1', word: 'drag', input: 'drag', begin: 0, end: 80, fine: false, changes: [{ member: 'value', value: 55 }], shown: { from: 0, until: 80, clearOfFinger: true, drawnFollowsFinger: true, readBackReplaces: true } };
  const answer = { value: [{ member: 'value', value: 55 }], begin: 0, end: 80, gesture, gestures: [gesture], undo: ['g1'], selected: null, refused: [{ code: 'GESTURE_READ_ONLY', t: 90, why: 'read-only' }], cancelled: [] };
  valid('gesture_io', control, 'Control');
  valid('gesture_io', { control, events: [{ t: 0, type: 'down', id: 'p', ptype: 'touch', x: 5, y: 5 }], answer });
  invalid('gesture_io', { ...answer, value: { value: 55 } }, 'Answer');
  invalid('gesture_io', { control, events: [], answer: { ...answer, refused: [{ code: 'GESTURE_MADE_UP', t: 0, why: 'x' }] } });
});

// ---- the renders: committed, held by omx-contract's --check, usable ------------------------------------------------

const TS = join(ROOT, 'test/golden/ts');
const PY = join(ROOT, 'share/omx-panel');
const CONTRACT = process.env.OMX_CONTRACT_TREE || join(ROOT, '..', 'omx-contract');
const hasTool = existsSync(join(CONTRACT, 'bin/omx-contract.mjs')) && existsSync(join(CONTRACT, 'node_modules/json-schema-to-typescript'))
  && spawnSync(process.env.OMX_DATAMODEL_CODEGEN || 'datamodel-codegen', ['--version']).status === 0;
// no generator here is a skip on a developer's desk and a RED in CI: a render nothing checks is the drift this holds.
// A package build (%check, dh_auto_test) says OMX_PANEL_SHAPES=packaged: it has no generator tree, and ci.yml and the
// release proof run these against the pinned generators before any package is built.
const packaged = process.env.OMX_PANEL_SHAPES === 'packaged';
const arm = (name, fn) => test(name, { skip: !hasTool && (!process.env.CI || packaged) && 'no omx-contract tree with its generators (OMX_CONTRACT_TREE, OMX_DATAMODEL_CODEGEN)' }, fn);
const render = (target, out, shapesDir, extra = []) => spawnSync('node', [join(CONTRACT, 'bin/omx-contract.mjs'), 'render', '--shapes', '--shapes-dir', shapesDir, '--target', target, '--out', out, ...extra], { encoding: 'utf8' });
const scratch = () => mkdtempSync(join(tmpdir(), 'omx-panel-shapes-'));

test('the committed renders are one file per shape, both languages', () => {
  assert.deepEqual(readdirSync(join(TS, 'shapes')).sort(), SHAPES.map((n) => `${n}.d.ts`));
  assert.deepEqual(readdirSync(PY).sort(), SHAPES.map((n) => `omx_contract_${n}_shape.py`));
  for (const f of readdirSync(PY)) assert.match(readFileSync(join(PY, f), 'utf8'), /GENERATED by `omx-contract render --target py --shapes`/);
});

for (const target of ['ts', 'py']) {
  arm(`the committed ${target} renders are the render of the shapes, byte for byte`, () => {
    const r = render(target, target === 'ts' ? TS : PY, join(ROOT, 'shapes'), ['--check']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /4 files byte-identical/);
  });

  arm(`a hand-edited ${target} render is named by --check (sabotage)`, () => {
    const dir = scratch();
    try {
      const out = join(dir, 'out'); cpSync(target === 'ts' ? TS : PY, out, { recursive: true });
      const file = target === 'ts' ? join(out, 'shapes/gestures.d.ts') : join(out, 'omx_contract_gestures_shape.py');
      writeFileSync(file, readFileSync(file, 'utf8').replace(/drag/, 'dragg'));
      const r = render(target, out, join(ROOT, 'shapes'), ['--check']);
      assert.notEqual(r.status, 0, 'a hand-edited render passed --check');
      assert.match(r.stdout + r.stderr, /gestures/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  arm(`a ${target} render stale against its schema is named by --check (sabotage: a word added to the schema)`, () => {
    const dir = scratch();
    try {
      const shapes = join(dir, 'shapes'); cpSync(join(ROOT, 'shapes'), shapes, { recursive: true });
      const f = join(shapes, 'gestures.schema.json');
      writeFileSync(f, readFileSync(f, 'utf8').replace('"paint"\n      ]', '"paint",\n        "wiggle"\n      ]'));
      assert.notEqual(readFileSync(f, 'utf8'), readFileSync(join(ROOT, 'shapes/gestures.schema.json'), 'utf8'), 'the sabotage did not land');
      const r = render(target, target === 'ts' ? TS : PY, shapes, ['--check']);
      assert.notEqual(r.status, 0, 'a stale render passed --check');
      assert.match(r.stdout + r.stderr, /gestures/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  arm(`a shape nobody rendered is named by --check as missing (${target})`, () => {
    const dir = scratch();
    try {
      const shapes = join(dir, 'shapes'); cpSync(join(ROOT, 'shapes'), shapes, { recursive: true });
      const s = read('shapes/code.schema.json'); s.$id = idOf('lamp'); s.title = 'Lamp'; s.properties.code.description += ' (a copy)';
      s.properties.text.title = 'LampText';
      writeFileSync(join(shapes, 'lamp.schema.json'), JSON.stringify(s, null, 2));
      const r = render(target, target === 'ts' ? TS : PY, shapes, ['--check']);
      assert.notEqual(r.status, 0, 'an unrendered shape passed --check');
      assert.match(r.stdout + r.stderr, /lamp/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

arm('an absent Python generator is a refusal naming it, never a pass', () => {
  const r = spawnSync('node', [join(CONTRACT, 'bin/omx-contract.mjs'), 'render', '--shapes', '--shapes-dir', join(ROOT, 'shapes'), '--target', 'py', '--out', PY, '--check'],
    { encoding: 'utf8', env: { ...process.env, OMX_DATAMODEL_CODEGEN: '/nonexistent/datamodel-codegen' } });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /datamodel-codegen/);
});

test('the Python render imports with the standard library alone, and its words are the declaration\'s, in order', () => {
  const code = `
import importlib.util, json, sys, typing
def load(name):
    spec = importlib.util.spec_from_file_location('m_' + name, '${PY}/omx_contract_' + name + '_shape.py')
    m = importlib.util.module_from_spec(spec); sys.modules[spec.name] = m; spec.loader.exec_module(m); return m
g = load('gestures'); io = load('gesture_io'); load('look_role'); load('code')
print(json.dumps({'words': list(typing.get_args(g.Word)), 'inputs': list(typing.get_args(g.Input)), 'widgets': list(typing.get_args(g.Widget)),
  'timings': list(g.Timings.__annotations__), 'io': sorted(io.Answer.__annotations__)}))`;
  const r = spawnSync('python3', ['-I', '-B', '-c', code], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.deepEqual(got.words, Object.keys(gestures.words));
  assert.deepEqual(got.inputs, gestures.inputs);
  assert.deepEqual(got.widgets, Object.keys(gestures.table));
  assert.deepEqual(got.timings, Object.keys(gestures.timings));
  assert.deepEqual(got.io, ['begin', 'cancelled', 'end', 'gesture', 'gestures', 'refused', 'selected', 'undo', 'value']);
});

test('the TypeScript render types a document: a Gestures value compiles, a made-up word does not', () => {
  const dir = scratch();
  try {
    const tsc = join(ROOT, 'node_modules/.bin/tsc');
    const use = (body) => {
      writeFileSync(join(dir, 'use.ts'), `import type { Word, Widget, Gestures } from '${join(TS, 'shapes/gestures')}';\nimport type { Answer, Control } from '${join(TS, 'shapes/gesture_io')}';\n${body}\n`);
      return spawnSync(tsc, ['--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022', '--types', 'node', '--typeRoots', join(ROOT, 'node_modules/@types'), join(dir, 'use.ts')], { encoding: 'utf8' });
    };
    const ok = use(`const w: Word = 'drag'; const k: Widget = 'handle'; declare const g: Gestures; const t: number = g.timings.safetyHoldMs.default;\ndeclare const a: Answer; const v: string = a.value[0].member; declare const c: Control; const wd: string = c.widget; void [w, k, t, v, wd];`);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const bad = use(`const w: Word = 'wiggle'; void w;`);
    assert.notEqual(bad.status, 0, 'a word the declaration does not have type-checked');
    assert.match(bad.stdout, /wiggle/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- shipped: the Python package, the schemas and the types of the npm package, the two distributions' packages -------

test('make install-python installs omx_panel.shapes.<name>, importable from the install alone (the #52 module)', () => {
  const dir = scratch();
  try {
    const inst = spawnSync('make', ['-s', 'install-python', `DESTDIR=${dir}`, 'PREFIX=/usr', 'PYTHONDIR=/py'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(inst.status, 0, inst.stderr);
    const code = `
import sys, typing
sys.path.insert(0, '${join(dir, 'py')}')
from omx_panel.shapes.gestures import Word, Input, Widget
from omx_panel.shapes.gesture_io import Control, Event, Answer
from omx_panel.shapes.look_role import LookRole
from omx_panel.shapes.code import PanelCode
print(list(typing.get_args(Word)))`;
    const r = spawnSync('python3', ['-I', '-B', '-c', code], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout.replace(/'/g, '"')), Object.keys(gestures.words));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the npm package ships the schemas and the types its exports name', () => {
  const pkg = read('package.json');
  assert.equal(pkg.exports['./shapes/*.schema.json'], './dist/shapes/*.schema.json');
  assert.deepEqual(pkg.exports['./shapes/*'], { types: './dist/ts/shapes/*.d.ts' });
  for (const n of SHAPES) {
    assert.ok(existsSync(join(ROOT, 'dist/shapes', `${n}.schema.json`)), `dist/shapes/${n}.schema.json`);
    assert.equal(readFileSync(join(ROOT, 'dist/ts/shapes', `${n}.d.ts`), 'utf8'), readFileSync(join(TS, 'shapes', `${n}.d.ts`), 'utf8'), `${n}.d.ts is the committed render`);
  }
});

test('both distributions build python3-omx-panel from the one Makefile target, and the build runs the drift check', () => {
  const spec = readFileSync(join(ROOT, 'packaging/omx-panel.spec'), 'utf8');
  assert.match(spec, /^%package -n python3-omx-panel$/m);
  assert.match(spec, /make install-python DESTDIR=%\{buildroot\} PYTHONDIR=%\{python3_sitelib\}/);
  assert.match(spec, /^%files -n python3-omx-panel\n(%license LICENSE\n)?%\{python3_sitelib\}\/omx_panel\/$/m);
  const control = readFileSync(join(ROOT, 'debian/control'), 'utf8');
  assert.match(control, /^Package: python3-omx-panel$/m);
  assert.match(readFileSync(join(ROOT, 'debian/rules'), 'utf8'), /install-python DESTDIR=\$\(CURDIR\)\/debian\/python3-omx-panel .*PYTHONDIR=\/usr\/lib\/python3\/dist-packages/);
  assert.match(readFileSync(join(ROOT, 'Makefile'), 'utf8'), /^check: .*\bshapes-check\b/m);
  assert.match(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'), /make shapes-check/);
});

test('the release proof runs the shape generators at ci.yml\'s pin: the two OMX_CONTRACT_SHAPES_REF move together', () => {
  const pin = (f) => readFileSync(join(ROOT, '.github/workflows', f), 'utf8').match(/OMX_CONTRACT_SHAPES_REF: ([0-9a-f]{40})/)?.[1];
  assert.ok(pin('ci.yml'), 'ci.yml names no OMX_CONTRACT_SHAPES_REF');
  assert.equal(pin('release.yml'), pin('ci.yml'));
});

test('a package build skips the shape renders by name, and the release proof still runs them', () => {
  const spec = readFileSync(join(ROOT, 'packaging/omx-panel.spec'), 'utf8');
  const rules = readFileSync(join(ROOT, 'debian/rules'), 'utf8');
  assert.match(spec, /^OMX_PANEL_SHAPES=packaged .*make test$/m);
  assert.match(rules, /^\tOMX_PANEL_SHAPES=packaged .*make test$/m);
  const proof = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
  assert.doesNotMatch(proof, /OMX_PANEL_SHAPES/, 'the release proof must run the shape renders, not skip them');
});
