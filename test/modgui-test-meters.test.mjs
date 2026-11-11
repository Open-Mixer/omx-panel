// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * tools/modgui-test.sh over a MOD GUI with meters (test/fixtures/meters/): the generator draws each meter that is no control
 * of a section as a static frame (docs/panel-layout.md, Meters), and the test holds each frame to the description's symbol,
 * range and unit, and counts it among what the template may draw. A frame nothing declares, and a frame whose range is not
 * the description's, are each refused.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'test/fixtures/meters');
const DESC = join(FIX, 'meters.descriptor.json'), PANEL = join(FIX, 'meters.panel.json');
const SOURCE = 'test/fixtures/meters and tools/look.json';
const METERS = [['in_level', -60, 0, 'dBFS'], ['out_level', -60, 0, 'dBTP'], ['gr', -24, 0, 'dB'], ['lufs', -70, 0, 'LUFS']];

/** A bundle the generator wrote for the fixture, in a directory of its own. */
function written() {
  const bundle = join(mkdtempSync(join(tmpdir(), 'omx-panel-modgui-test-')), 'meters.lv2');
  const r = spawnSync(process.execPath, [join(ROOT, 'tools/modgui-gen.mjs'), '--descriptor', DESC, '--panel', PANEL, '--out', bundle, '--source', SOURCE], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return bundle;
}
/** The test's lines over a bundle: every PASS and FAIL it printed. */
function lines(bundle) {
  const r = spawnSync('sh', [join(ROOT, 'tools/modgui-test.sh'), bundle, DESC, PANEL], { encoding: 'utf8', env: { ...process.env, MODGUI_SOURCE: SOURCE } });
  return { status: r.status, out: r.stdout.split('\n').filter((l) => /^(PASS|FAIL) /.test(l)) };
}
const template = (bundle) => join(bundle, 'modgui/icon-meters.html');
// the checks this file is about: the generation, each control, each meter and the count (sord_validate's are the bundle's TTL)
const drawn = (out) => out.filter((l) => /^(PASS|FAIL) (modgui-gen --check|template draws)/.test(l));

test('a generated MOD GUI with meter frames passes: each frame is held to its range and unit, and counted', () => {
  const { out } = lines(written());
  assert.deepEqual(drawn(out), [
    'PASS modgui-gen --check meters',
    ...['threshold', 'ratio', 'attack', 'release'].map((s) => `PASS template draws ${s} with its declared travel and default`),
    ...METERS.map(([s]) => `PASS template draws meter ${s} as a frame with its declared range and unit`),
    'PASS template draws exactly the 8 declared parameters and meters',
  ]);
  assert.ok(out.includes('PASS a moved default makes modgui-gen --check fail'));
});
test('the fixture\'s template carries the four frames the test counted', () => {
  const html = readFileSync(template(written()), 'utf8');
  for (const [s, min, max, unit] of METERS) assert.ok(html.includes(`<div class="omx-meter-frame" data-symbol="${s}" data-min="${min}" data-max="${max}" data-unit="${unit}" `), s);
  assert.equal((html.match(/data-symbol="/g) ?? []).length, 8);
});
test('arm: a frame no meter declares is refused by the count', () => {
  const bundle = written();
  const html = readFileSync(template(bundle), 'utf8');
  const frame = html.split('\n').find((l) => l.includes('class="omx-meter-frame" data-symbol="gr"'));
  writeFileSync(template(bundle), html.replace(frame, `${frame}\n${frame.replace('data-symbol="gr"', 'data-symbol="invented"')}`));
  const { status, out } = lines(bundle);
  assert.equal(status, 1);
  assert.ok(out.includes('FAIL template draws exactly the declared parameters and meters (declared 8, drawn 9)'), out.join('\n'));
});
test('arm: a frame whose range is not the description\'s is refused by name', () => {
  const bundle = written();
  const html = readFileSync(template(bundle), 'utf8');
  writeFileSync(template(bundle), html.replace('data-symbol="gr" data-min="-24"', 'data-symbol="gr" data-min="-48"'));
  const { status, out } = lines(bundle);
  assert.equal(status, 1);
  assert.ok(out.includes('FAIL template draws meter gr as a frame with its declared range and unit (data-symbol="gr" data-min="-24" data-max="0" data-unit="dB")'), out.join('\n'));
  assert.ok(out.includes('PASS template draws exactly the 8 declared parameters and meters'));
});
test('arm: a frame given a port role is refused: a meter frame is static', () => {
  const bundle = written();
  const html = readFileSync(template(bundle), 'utf8');
  writeFileSync(template(bundle), html.replace('class="omx-meter-frame" data-symbol="lufs"', 'class="omx-meter-frame" mod-port-symbol="lufs" data-symbol="lufs"'));
  const { status, out } = lines(bundle);
  assert.equal(status, 1);
  assert.ok(out.some((l) => l.startsWith('FAIL template draws meter lufs as a frame')), out.join('\n'));
});
