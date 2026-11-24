// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The MOD GUI's static curve (the one-panel spec §7.4, Q6, §7.6): the polyline in the template and the screenshot, computed by omx-dsp's
// TypeScript twin at the come-up values, with its caption word; a mark at each band an authored descriptor declares a planter's, and
// none where no origin is declared. The twin is a plain dependency (`@openmixer/omx-dsp`, its async `loadCurve`): a tree without it fails here,
// never skips, and the generator refuses to load without it (the last test here).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { generateModgui, resolvePanel, curveGeometry, STATIC_CURVE } from '../tools/modgui-gen.mjs';
import { panelLayout } from '../tools/panel-description.mjs';

import { CURVE_WORDS, loadCurve } from '@openmixer/omx-dsp';
// the curve function as omx-dsp ships it: its WebAssembly module, loaded here on its own, so the expected points never come from the generator's own load
const curve = await loadCurve(readFileSync(new URL('wasm/omx-dsp.wasm', import.meta.resolve('@openmixer/omx-dsp/package.json'))));
const read = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const eq = () => [read('eq-marks/eq.descriptor.json'), read('eq-marks/eq.panel.json')];
const dyn = () => [read('dyn-curve/dyn.descriptor.json'), read('dyn-curve/dyn.panel.json')];
const html = (d, panel) => new Map(generateModgui(d, { panel, stem: 'x', source: 'test' })).get('modgui/icon-x.html').toString();
const polyline = (h) => h.match(/<polyline class="omx-curve-line" fill="none" points="([^"]+)"/)[1].split(' ').map((p) => p.split(',').map(Number));

test('a compressor\'s static curve is the twin\'s transfer curve at the come-up values, as a polyline of its points', () => {
  const [d, panel] = dyn();
  const sec = resolvePanel(d, { panel, stem: 'x' }).sections[0];
  const want = curve.curvePoints({
    kind: 'transfer_curve', family: 'dynamics', ...STATIC_CURVE,
    terms: [['threshold', 'dB', -18], ['ratio', 'ratio', 4]].map(([role, unit, value]) => ({ role, value, unit })),
  });
  assert.equal(sec.displays[0].curve.points.length, want.points.length);
  assert.deepEqual(sec.displays[0].curve.points, want.points);
  const line = polyline(html(d, panel));
  assert.equal(line.length, want.points.length);
  // below the knee the output is the input (the unity line), above it the 4:1 slope: the stroke bends where the threshold is
  const geo = curveGeometry(sec.displays[0].curve, 'transfer_curve', 360, 84, 1);
  assert.deepEqual(geo.poly.map((p) => p.map((v) => Math.round(v * 100) / 100)), line);
  const slope = (a, b) => (b[1] - a[1]) / (b[0] - a[0]);
  assert.ok(Math.abs(slope(line[2], line[3]) - slope(line[5], line[6])) < 0.02, 'a straight line below the knee');
  assert.ok(slope(line.at(-3), line.at(-2)) > slope(line[2], line[3]), 'flatter above it (screen y grows downward)');
});
test('arm: a different ratio is a different stroke', () => {
  const [d, panel] = dyn();
  const was = polyline(html(d, panel));
  d.controls.find((c) => c.symbol === 'ratio').travel.default = 10;
  assert.notDeepEqual(polyline(html(d, panel)), was);
});
test('the screenshot carries the stroke: it differs from the frame-only face', () => {
  const [d, panel] = dyn();
  const shot = (x) => new Map(generateModgui(x, { panel, stem: 'x', source: 't' })).get('modgui/screenshot-x.png');
  const with_ = shot(d);
  d.controls.find((c) => c.symbol === 'ratio').travel.default = 10;
  assert.ok(!with_.equals(shot(d)));
});

test('an EQ with two planted bands carries two marks, each at the band\'s own depth, the letter of its planter', () => {
  const [d, panel] = eq();
  const curve = resolvePanel(d, { panel, stem: 'x' }).sections[0].displays[0].curve;
  assert.deepEqual(curve.marks.map((m) => [m.freq, m.origin]), [[1000, 'fbs-fixed'], [3150, 'hrp']]);
  const h = html(d, panel);
  assert.equal(h.match(/<circle /g).length, 2);
  assert.deepEqual([...h.matchAll(/<text [^>]*>([A-Z])<\/text>/g)].map((m) => m[1]), ['F', 'H']);
  // the mark sits on the stroke: its x is the log position of its frequency
  const geo = curveGeometry(curve, 'eq_response', 360, 84, 1);
  assert.ok(geo.marks[0].at[0] < geo.marks[1].at[0]);
});
test('arm: with no origins declared there are no marks: nothing is inferred', () => {
  const [d, panel] = eq();
  delete panel.origins;
  const h = html(d, panel);
  assert.ok(!h.includes('<circle'));
  assert.ok(h.includes('omx-curve-line'));
});

test('an origin is declared by an authored descriptor, from the closed set, on a band_freq role', () => {
  const [d, panel] = eq();
  assert.throws(() => panelLayout({ ...d, origin: 'scanned' }, { panel }), /only an authored descriptor declares an origin/);
  assert.throws(() => panelLayout(d, { panel: { ...panel, origins: { f1: 'someone' } } }), /none of fbs-fixed, fbs-live, hrp, room-mode/);
  assert.throws(() => panelLayout(d, { panel: { ...panel, origins: { g1: 'hrp' } } }), /no band_freq role/);
  const layout = panelLayout(d, { panel });
  assert.deepEqual(layout.roles.filter((r) => r.origin).map((r) => [r.symbol, r.origin]), [['f1', 'fbs-fixed'], ['f2', 'hrp']]);
});
test('the origin words are the twin\'s', async () => {
  const { BAND_ORIGINS } = await import('../tools/panel-description.mjs');
  assert.deepEqual(['user', ...BAND_ORIGINS], CURVE_WORDS.origins);
});

// the generator's refusal (tools/modgui-gen.mjs): a MOD GUI drawn without its curves would be a false green, so a tree without omx-dsp
// does not load the generator. CI always has omx-dsp, so this arm makes it unresolvable for a child process and reads the child fail,
// naming the package and its floor.
test('with omx-dsp unresolvable, the generator refuses to load, naming @openmixer/omx-dsp and its floor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'no-twin-'));
  try {
    const hook = join(dir, 'hook.mjs');
    writeFileSync(hook, "export async function resolve(s, c, next) { if (s === '@openmixer/omx-dsp' || s === '@openmixer/omx-dsp/package.json') throw Object.assign(new Error(`Cannot find package '@openmixer/omx-dsp'`), { code: 'ERR_MODULE_NOT_FOUND' }); return next(s, c); }\n");
    const boot = join(dir, 'boot.mjs');
    writeFileSync(boot, `import { register } from 'node:module'; register(${JSON.stringify(pathToFileURL(hook).href)});\n`);
    const gen = fileURLToPath(new URL('../tools/modgui-gen.mjs', import.meta.url));
    // every path reaches the child as a file URL: a space or a # in a path is not part of a URL as written
    const env = { ...process.env };
    delete env.OMX_PANEL_DSP; // the switch is gone: the refusal never depends on it
    let stderr = '';
    assert.throws(() => {
      try { execFileSync(process.execPath, ['--import', pathToFileURL(boot).href, '-e', `import(${JSON.stringify(pathToFileURL(gen).href)})`], { env, stdio: 'pipe' }); } catch (e) { stderr = String(e.stderr); throw e; }
    }, 'no omx-dsp: the generator must not load');
    assert.match(stderr, /@openmixer\/omx-dsp/);
    assert.match(stderr, />=0\.33\.0/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the dependency is declared as a plain dependency at the omx-dsp release of this pass, no ceiling', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies['@openmixer/omx-dsp'], '>=0.33.0');
  assert.equal(pkg.peerDependencies?.['@openmixer/omx-dsp'], undefined, 'a plain dependency, not a peer');
  assert.equal(pkg.devDependencies?.['@openmixer/omx-dsp'], undefined, 'declared once');
});
