// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * `omx-panel picture` (tools/panel-picture.mjs, docs/renderer.md "A picture of a panel"): a plugin's panel drawn from its
 * descriptor and declared panel alone. Held here:
 *   - the picture IS the served layout drawn at the defaults: pixel for pixel what the renderer draws from
 *     `omx-panel describe --layout` and the harness's host side, for the served omx-delay under the console style;
 *   - the same declaration draws the same bytes twice;
 *   - a declaration that changes what is drawn (a section's label, a control taken off the panel) changes the picture
 *     (the sabotage the documentation pictures' check relies on);
 *   - a descriptor the derivation refuses draws nothing and exits 1; a missing --png is a usage error.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { CLI, FIXTURES, ROOT, compare, decodePng, descriptionFile, render, scratch, stateFile } from './harness.mjs';

const OMX_PANEL = join(ROOT, 'dist', 'bin', 'omx-panel.mjs');
const fx = FIXTURES.find((f) => f.name === 'omx-delay-served');
const env = { ...process.env, OMX_PANEL_RENDER: CLI };

function picture(descriptor, panel, png, ...more) {
  const args = [OMX_PANEL, 'picture', '--descriptor', descriptor, ...(panel ? ['--panel', panel] : []), '--png', png, '--stem', fx.stem, ...more];
  return spawnSync(process.execPath, args, { encoding: 'utf8', env });
}

test('the picture is the served layout drawn at the declared defaults, pixel for pixel', () => {
  const dir = scratch();
  const png = join(dir, 'p.png');
  const r = picture(resolve(ROOT, fx.descriptor), resolve(ROOT, fx.panel), png, '--style', 'console');
  assert.equal(r.status, 0, r.stderr);
  const drawn = decodePng(readFileSync(png));
  assert.equal(r.stdout.trim(), `${drawn.w} ${drawn.h}`);
  const want = render(descriptionFile(fx, dir), stateFile(fx, dir));
  const d = compare(drawn, want, 0);
  assert.ok(d.sameSize, `picture ${drawn.w}x${drawn.h}, the renderer's ${want.w}x${want.h}`);
  assert.equal(d.off, 0, `${d.off} pixels differ from the renderer's own drawing`);
});

test('the same declaration draws the same bytes; a changed declaration draws another picture', () => {
  const dir = scratch();
  const panel = JSON.parse(readFileSync(resolve(ROOT, fx.panel), 'utf8'));
  const draw = (name, p) => {
    const file = join(dir, `${name}.panel.json`);
    writeFileSync(file, JSON.stringify(p));
    const png = join(dir, `${name}.png`);
    const r = picture(resolve(ROOT, fx.descriptor), file, png);
    assert.equal(r.status, 0, r.stderr);
    return readFileSync(png);
  };
  const a = draw('a', panel), b = draw('b', panel);
  assert.ok(a.equals(b), 'two pictures of one declaration differ');
  const relabelled = structuredClone(panel);
  relabelled.sections[0].label = 'Echo';
  assert.ok(!a.equals(draw('relabelled', relabelled)), 'a section relabelled in the declaration drew the same picture');
  const fewer = structuredClone(panel);
  fewer.sections[0].controls = fewer.sections[0].controls.filter((c) => c !== 'tone');
  assert.ok(!a.equals(draw('fewer', fewer)), 'a control taken off the declared panel drew the same picture');
});

test('a refused descriptor draws nothing and exits 1; no --png is a usage error', () => {
  const dir = scratch();
  const descriptor = JSON.parse(readFileSync(resolve(ROOT, fx.descriptor), 'utf8'));
  const empty = join(dir, 'empty.descriptor.json');
  writeFileSync(empty, JSON.stringify({ ...descriptor, controls: [] }));
  const png = join(dir, 'none.png');
  const r = picture(empty, null, png);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^omx-panel picture: /);
  assert.ok(!existsSync(png), 'a refused picture was written');
  const u = spawnSync(process.execPath, [OMX_PANEL, 'picture', '--descriptor', resolve(ROOT, fx.descriptor)], { encoding: 'utf8', env });
  assert.equal(u.status, 2);
});
