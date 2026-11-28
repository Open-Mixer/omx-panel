// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * panel-picture.mjs — a picture of a plugin's panel drawn from its declaration alone: the descriptor and the declared
 * panel, laid out by the one derivation (`omx-panel describe --layout`, what every host draws), every control at its
 * declared default with the text the face writes for it, drawn by the panel renderer (`omx-panel-render`, docs/renderer.md)
 * into a PNG. No running host, no screenshot and no hand drawing: the same two files give the same picture, and a
 * declaration that changes what is drawn changes the picture (docs/renderer.md "A picture of a panel").
 *
 *   omx-panel picture --descriptor <file> [--panel <file>] --png <out.png> [--stem <name>] [--scale S] [--style <style>]
 *
 * The renderer is $OMX_PANEL_RENDER, else this tree's renderer/build/omx-panel-render, else `omx-panel-render` on PATH (the
 * omx-panel-render package). The look is this tree's tools/look.json, its default style unless --style names one of its
 * styles. Prints "<width> <height>" of the picture. Exit 0 drawn, 1 refused (the reason on stderr), 2 usage.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '@openmixer/omx-contract/entry';
import { describe } from './describe.mjs';
import { LEG_LETTER, ORIGIN_LETTER, resolvePanel, travelFraction, valueText } from './modgui-gen.mjs';

const TOOLS = dirname(fileURLToPath(import.meta.url));
const USAGE = 'usage: omx-panel picture --descriptor <file> [--panel <file>] --png <out.png> [--stem <name>] [--scale S] [--style <style>]\n';

/** The renderer command: $OMX_PANEL_RENDER, the tree's build (tools/ beside renderer/), else the one on PATH. */
export function rendererCommand() {
  if (process.env.OMX_PANEL_RENDER) return process.env.OMX_PANEL_RENDER;
  const built = resolve(TOOLS, '..', 'renderer', 'build', 'omx-panel-render');
  return existsSync(built) ? built : 'omx-panel-render';
}

/**
 * The host's side of a picture, as the renderer's state file reads it: the title, every control at its declared default
 * with the text the MOD GUI face writes for it (`readings` gives a control, a meter's level, a reading of its own), and
 * the static curves, stems and marks the face draws from the same declaration.
 */
export function defaultState(descriptor, { panel, stem, readings = {} } = {}) {
  const p = resolvePanel(descriptor, { panel, stem });
  const values = { ...readings };
  for (const k of p.sections.flatMap((s) => s.controls)) {
    if (k.widget === 'display' || k.symbol in values) continue;
    const text = valueText(k);
    if (k.widget === 'selector') values[k.symbol] = { at: Math.max(0, k.options.findIndex((o) => o.value === k.def)), count: k.options.length, text };
    else if (k.widget === 'switch') values[k.symbol] = { fraction: k.def >= 0.5 ? 1 : 0, text };
    else values[k.symbol] = { fraction: travelFraction(k, k.def), text };
  }
  const curves = {}, marks = {}, stems = {};
  let at = 0;
  for (const sec of p.sections) for (const dsp of sec.displays) {
    if (dsp.curve?.stems?.length) stems[at] = dsp.curve.stems.map((t) => ({ x: t.x, y: t.y, shade: t.shade, letter: LEG_LETTER[t.leg] ?? ' ' }));
    if (dsp.curve?.points?.length) curves[at] = { x: dsp.curve.points.map((q) => q.x), y: dsp.curve.points.map((q) => q.y) };
    if (dsp.curve?.marks?.length) marks[at] = dsp.curve.marks.map((m) => ({ freq: m.freq, depth: m.depthDb, letter: ORIGIN_LETTER[m.origin] }));
    at++;
  }
  return { brand: p.brand, name: p.name ?? p.stem, values, curves, marks, stems };
}

/** The layout a host draws: `describe --layout`'s, refused by its codes when the derivation gives no description. */
export function servedLayout(descriptor, { panel, where } = {}) {
  const out = describe(descriptor, { withLayout: true, panel, where });
  if (!out.description) {
    const err = new Error(`no panel description: ${out.refusals.map((r) => r.code).join(', ')}`);
    err.refusals = out.refusals;
    throw err;
  }
  return out.layout;
}

/** A tools directory whose look wears `style`: a copy, beside its schema/, so the renderer reads it as it reads this one. */
function styledData(dir, style) {
  const look = JSON.parse(readFileSync(join(TOOLS, 'look.json'), 'utf8'));
  if (!(style in (look.looks ?? {}))) throw new Error(`no style '${style}' in tools/look.json (it has ${Object.keys(look.looks ?? {}).join(', ')})`);
  const data = join(dir, 'tools');
  cpSync(TOOLS, data, { recursive: true });
  cpSync(join(TOOLS, '..', 'schema'), join(dir, 'schema'), { recursive: true });
  writeFileSync(join(data, 'look.json'), `${JSON.stringify({ ...look, style }, null, 2)}\n`);
  return data;
}

/** Draws the picture of `descriptor` under `panel` into `png`; `{ width, height }`. */
export function picture(descriptor, { panel, stem, png, scale = 1, style, where } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-picture-'));
  try {
    const layoutFile = join(dir, 'layout.json');
    writeFileSync(layoutFile, `${JSON.stringify(servedLayout(descriptor, { panel, where }), (_k, v) => (typeof v === 'bigint' ? v.toString(16) : v), 2)}\n`);
    const stateFile = join(dir, 'state.json');
    writeFileSync(stateFile, JSON.stringify(defaultState(descriptor, { panel, stem })));
    const data = style ? styledData(dir, style) : TOOLS;
    const out = execFileSync(rendererCommand(), ['--description', layoutFile, '--data', data, '--state', stateFile, '--scale', String(scale), '--alpha', 'straight', '--png', resolve(png)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const [width, height] = out.trim().split(' ').map(Number);
    return { width, height };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv) {
  const opt = (flag) => {
    const k = argv.indexOf(flag);
    return k >= 0 ? argv[k + 1] : undefined;
  };
  const file = opt('--descriptor'), png = opt('--png');
  const scale = opt('--scale') === undefined ? 1 : Number(opt('--scale'));
  if (!file || !png || !(scale > 0)) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  try {
    const json = (f) => JSON.parse(readFileSync(f, 'utf8'));
    const descriptor = json(file);
    const panel = opt('--panel') ? json(opt('--panel')) : undefined;
    const { width, height } = picture(descriptor, { panel, stem: opt('--stem'), png, scale, style: opt('--style'), where: file });
    process.stdout.write(`${width} ${height}\n`);
  } catch (err) {
    process.stderr.write(`omx-panel picture: ${err.stderr ? String(err.stderr).trim() : err.message}\n`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) main(process.argv.slice(2));
