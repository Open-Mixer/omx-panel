#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * meter-surfaces.mjs — one recorded meter stream (test/fixtures/meters/meters.stream.json) drawn by three surfaces and measured
 * from their pixels (contract 7.9's proof, the parity check of the one-panel spec §7.5):
 *
 *   renderer  omx-panel-render, the marker omx-dsp's omx_meter_view_step (C), at 1x;
 *   browser   the MOD GUI's own template and stylesheet in Chromium (playwright-core), each meter frame given a bar and a marker
 *             as the renderer places them, the marker omx-dsp's TypeScript twin (meterMarker); the MOD GUI itself has no live
 *             meter yet (a static frame until the live MOD GUI spec), so this is that frame driven by the twin;
 *   tk        a Tk canvas (renderer/test/meter_tk.py), the marker a Python copy of the law read against omx-dsp's vectors.
 *
 * Every tick of every meter: the bar's end and the marker's left edge, in panel px, found on fixed rows of the image by colour (the
 * accent, the ink); every frame's four edges at the first tick. Each is held to the renderer's: within 1 px (browser) and 2 px (Tk).
 * Prints one table and writes the numbers as JSON; exit 1 past a tolerance, 2 when a leg could not run.
 *
 *   node renderer/test/meter-surfaces.mjs [--browser <chromium>] [--no-tk] [--json <file>] [--sabotage browser-fall|tk-fall]
 *
 * Needs the built tree and renderer (make renderer), playwright-core and @openmixer/omx-dsp (>= 0.32.0 < 0.33) importable, a
 * Chromium, python3 with tkinter and Pillow, and an X display for Tk (xvfb-run).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { FIXTURES, RENDERER, ROOT, descriptionFile, render, scratch, stateFile } from './harness.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const sabotage = opt('--sabotage', '');
const TOL = { browser: 1, tk: 2 };

const modgui = await import(join(ROOT, 'dist', 'tools', 'modgui-gen.mjs'));
const dsp = await import('@openmixer/omx-dsp');
const dspVersion = JSON.parse(readFileSync(join(ROOT, 'node_modules', '@openmixer', 'omx-dsp', 'package.json'), 'utf8')).version;
const fx = FIXTURES.find((f) => f.name === 'meters');
const g = modgui.GEOMETRY;
const look = modgui.loadLook().tokens;
const rgb = (t) => [1, 3, 5].map((i) => parseInt(look[t].slice(i, i + 2), 16));
const p = modgui.resolvePanel(JSON.parse(readFileSync(join(ROOT, fx.descriptor), 'utf8')), { panel: JSON.parse(readFileSync(join(ROOT, fx.panel), 'utf8')), stem: fx.stem });
const lay = modgui.layout(p);
const stream = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'meters', 'meters.stream.json'), 'utf8'));
const vectors = execFileSync('pkg-config', ['--variable=meterviewvectors', 'omxdsp'], { encoding: 'utf8' }).trim();
const law = JSON.parse(readFileSync(vectors, 'utf8')).law;

/** Each meter of the band: its frame in panel px at 1x, its range and kind, as the renderer and the MOD GUI lay it out. */
const meters = lay.band.meters.map((m, row) => ({
  symbol: m.symbol, min: m.min, max: m.max, gainReduction: m.kind === 'gain-reduction',
  x: lay.band.x + g.sectionPad, y: lay.band.y + g.sectionTitleH + row * (g.meterH + g.meterGap), w: lay.band.w - 2 * g.sectionPad, h: g.meterH,
}));
const fraction = (m, v) => Math.min(1, Math.max(0, m.gainReduction ? (m.max - v) / (m.max - m.min) : (v - m.min) / (m.max - m.min)));

// ------------------------------------------------------------------------------------------------------------- reading the pixels
/** How far `px` lies along the line from the body colour to `to` (1 is `to`), or -1 when it is off that line by 40 or more. */
const BODY = rgb('--surface-3');
function along(px, to) {
  const d = to.map((c, k) => c - BODY[k]), dd = d.reduce((s, v) => s + v * v, 0), q = px.map((v, k) => v - BODY[k]);
  const t = q.reduce((s, v, k) => s + v * d[k], 0) / dd;
  return Math.hypot(...q.map((v, k) => v - t * d[k])) < 40 ? t : -1;
}
const pixel = (img, x, y) => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 3));
const ACCENT = rgb('--accent'), INK = rgb('--ink'), RIM = rgb('--border-strong');
const near = (a, b, d) => a.every((v, k) => Math.abs(v - b[k]) <= d);

/** One meter in one image: the bar's last accent pixel (null for no bar) on the bar's row, the marker's first ink pixel on the row
 * under the bar, in panel px; `under` when the bar reaches the marker, which covers its end (that bar end is not compared). The rows are the renderer's: the bar 4 px tall 6 px above the frame's foot, the marker 6 px tall. */
function measure(img, m) {
  const barRow = m.y + m.h - 4, markRow = m.y + m.h - 2;
  let bar = null, marker = null;
  for (let x = m.x - 2; x < m.x + m.w + 2; x++) if (along(pixel(img, x, barRow), ACCENT) >= 0.5) bar = x;
  for (let x = m.x - 2; x < m.x + m.w + 2 && marker === null; x++) if (along(pixel(img, x, markRow), INK) >= 0.5) marker = x;
  // a bar that runs into the marker has no end of its own to see: the marker is drawn over it
  return { bar, marker, under: bar !== null && marker !== null && bar >= marker - 2 };
}
/** A frame's four edges, found as the rim colour: the left on a row 8 px down (left of the caption), the right on the same row, the
 * top and the foot on a column 20 px in from the right (clear of the caption and the corners). */
function frameEdges(img, m) {
  const row = m.y + 8, col = m.x + m.w - 20;
  const isRim = (x, y) => near(pixel(img, x, y), RIM, 24);
  let left = null, right = null, top = null, foot = null;
  for (let x = m.x - 4; x < m.x + 8 && left === null; x++) if (isRim(x, row)) left = x;
  for (let x = m.x + m.w + 4; x > m.x + m.w - 8 && right === null; x--) if (isRim(x, row)) right = x;
  for (let y = m.y - 4; y < m.y + 8 && top === null; y++) if (isRim(col, y)) top = y;
  for (let y = m.y + m.h + 4; y > m.y + m.h - 8 && foot === null; y--) if (isRim(col, y)) foot = y;
  return { left, right, top, foot };
}

/** A PNG's pixels as RGBA: 8-bit RGB or RGBA, not interlaced, any scanline filter (what Chromium writes). */
function decodePngAny(bytes) {
  const b = Buffer.from(bytes);
  let at = 8, w = 0, h = 0, ch = 4;
  const idat = [];
  while (at < b.length) {
    const n = b.readUInt32BE(at), type = b.toString('latin1', at + 4, at + 8), body = b.subarray(at + 8, at + 8 + n);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      if (body[8] !== 8 || ![2, 6].includes(body[9]) || body[12] !== 0) throw new Error('decodePngAny: not 8-bit RGB(A), or interlaced');
      ch = body[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(body);
    at += 12 + n;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, up = prev[i], c = i >= ch ? prev[i - ch] : 0;
      const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      cur[i] = (line[i] + pred) & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) data[(y * w + x) * 4 + k] = k < ch ? cur[x * ch + k] : 255;
    prev.set(cur);
  }
  return { w, h, data };
}

// ------------------------------------------------------------------------------------------------------------------- the legs
function rendererLeg() {
  const dir = scratch();
  const desc = descriptionFile(fx, dir), base = JSON.parse(readFileSync(stateFile(fx, dir), 'utf8'));
  const out = [];
  let edges = null;
  for (let k = 0; k < stream.ticks.length; k++) {
    const state = { ...base, meters: Object.fromEntries(meters.map((m) => [m.symbol, stream.ticks.slice(0, k + 1).map((t) => ({ value: t.values[m.symbol], elapsed: t.elapsed }))])) };
    const st = join(dir, 'tick.state.json');
    writeFileSync(st, JSON.stringify(state));
    const img = render(desc, st);
    if (k === 0) edges = meters.map((m) => frameEdges(img, m));
    out.push(meters.map((m) => measure(img, m)));
  }
  return { ticks: out, edges };
}

/** Each meter's bar fraction and marker fraction at each tick through omx-dsp's twin, `fall` dB per second. */
function twinTrack(fall) {
  const state = meters.map(() => undefined);
  return stream.ticks.map((t) => meters.map((m, i) => {
    const f = fraction(m, t.values[m.symbol]);
    state[i] = dsp.meterMarker(state[i], f, t.elapsed, fall, -(m.max - m.min));
    return { fill: f, marker: state[i].marker };
  }));
}

async function browserLeg(executablePath) {
  const { chromium } = await import('playwright-core');
  const strip = (s) => s.replace(/\{\{\{c?ns\}\}\}/g, '').replace(/\{\{#([^}]+)\}\}[\s\S]*?\{\{\/\1\}\}/g, '').replace(/\{\{[^}]*\}\}/g, '');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:${look['--surface']}}
${strip(modgui.emitStylesheet(p, modgui.loadLook(), 'meter-surfaces'))}</style></head><body>${strip(modgui.emitTemplate(p, lay, 'meter-surfaces'))}</body></html>`;
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--force-device-scale-factor=1', '--font-render-hinting=none'] });
  const page = await browser.newPage({ viewport: { width: lay.w + 40, height: lay.h + 40 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  const domFrames = await page.evaluate(() => [...document.querySelectorAll('.omx-meter-frame')].map((e) => { const r = e.getBoundingClientRect(); return { symbol: e.dataset.symbol, x: r.x, y: r.y, w: r.width, h: r.height }; }));
  // the bar and the marker as the renderer places them inside the frame (its border is 1 px, the children sit inside it)
  await page.evaluate(({ accent, ink }) => {
    for (const fr of document.querySelectorAll('.omx-meter-frame')) {
      for (const [cls, colour] of [['bar', accent], ['mark', ink]]) {
        const d = document.createElement('div');
        d.className = `probe-${cls}`;
        d.style.cssText = `position:absolute;background:${colour};display:none`;
        fr.appendChild(d);
      }
    }
  }, { accent: look['--accent'], ink: look['--ink'] });
  const track = twinTrack(sabotage === 'browser-fall' ? 2 * law.fallDbPerSecond : law.fallDbPerSecond);
  const out = [];
  let edges = null;
  for (let k = 0; k < stream.ticks.length; k++) {
    await page.evaluate(({ tick, ms }) => {
      document.querySelectorAll('.omx-meter-frame').forEach((fr, i) => {
        const m = ms[i], t = tick[i], inner = m.w - 4, bar = fr.querySelector('.probe-bar'), mark = fr.querySelector('.probe-mark');
        bar.style.cssText += `;display:${t.fill > 0 ? 'block' : 'none'};left:${2 - 1}px;top:${m.h - 6 - 1}px;width:${inner * t.fill}px;height:4px`;
        mark.style.cssText += `;display:block;left:${2 - 1 + Math.max(0, inner * t.marker - 2)}px;top:${m.h - 7 - 1}px;width:2px;height:6px`;
      });
    }, { tick: track[k], ms: meters });
    const img = decodePngAny(await page.screenshot({ clip: { x: 0, y: 0, width: lay.w, height: lay.h }, type: 'png' }));
    if (k === 0) edges = meters.map((m) => frameEdges(img, m));
    out.push(meters.map((m) => measure(img, m)));
  }
  const version = browser.version();
  await browser.close();
  return { ticks: out, edges, domFrames, version };
}

function tkLeg() {
  const dir = mkdtempSync(join(tmpdir(), 'omx-meter-tk-'));
  const job = {
    w: Math.round(lay.w), h: Math.round(lay.h), band: lay.band, meters, ticks: stream.ticks, vectors,
    law: { ...law, fallDbPerSecond: sabotage === 'tk-fall' ? 2 * law.fallDbPerSecond : law.fallDbPerSecond },
    colours: { surface: look['--surface'], section: look['--surface-2'], body: look['--surface-3'], rim: look['--border-strong'], accent: look['--accent'], ink: look['--ink'] },
  };
  writeFileSync(join(dir, 'job.json'), JSON.stringify(job));
  execFileSync('python3', ['-I', join(RENDERER, 'test', 'meter_tk.py'), join(dir, 'job.json'), dir], { stdio: ['ignore', 'inherit', 'inherit'] });
  const meta = JSON.parse(readFileSync(join(dir, 'tk.json'), 'utf8'));
  const out = [];
  let edges = null;
  for (let k = 0; k < meta.ticks; k++) {
    const img = { w: meta.w, h: meta.h, data: new Uint8Array(readFileSync(join(dir, `tk-${k}.rgba`))) };
    if (k === 0) edges = meters.map((m) => frameEdges(img, m));
    out.push(meters.map((m) => measure(img, m)));
  }
  const tkv = execFileSync('python3', ['-I', '-c', 'import tkinter, PIL; print(tkinter.TkVersion, PIL.__version__)'], { encoding: 'utf8' }).trim();
  return { ticks: out, edges, vectorsChecked: meta.vectorsChecked, version: `Tk ${tkv.split(' ')[0]}, Pillow ${tkv.split(' ')[1]}` };
}

// --------------------------------------------------------------------------------------------------------------- the comparison
/** The largest distance of a leg from the renderer, per measure; a bar or a marker one surface draws and the other does not counts as
 * Infinity. */
function against(ref, leg) {
  const worst = { bar: 0, marker: 0, frame: 0 }, where = { bar: null, marker: null, frame: null };
  const take = (key, a, b, at) => {
    const d = a === null && b === null ? 0 : a === null || b === null ? Infinity : Math.abs(a - b);
    if (d > worst[key]) { worst[key] = d; where[key] = at; }
  };
  let bars = 0;
  ref.ticks.forEach((row, k) => row.forEach((r, i) => {
    if (!r.under && !leg.ticks[k][i].under) { bars++; take('bar', r.bar, leg.ticks[k][i].bar, `tick ${k} ${meters[i].symbol}`); }
    take('marker', r.marker, leg.ticks[k][i].marker, `tick ${k} ${meters[i].symbol}`);
  }));
  ref.edges.forEach((e, i) => { for (const side of ['left', 'right', 'top', 'foot']) take('frame', e[side], leg.edges[i][side], `${meters[i].symbol} ${side}`); });
  return { worst, where, bars };
}

const report = { stream: { ticks: stream.ticks.length, seconds: stream.ticks.reduce((s, t) => s + t.elapsed, 0), meters: meters.map((m) => m.symbol) }, omxDspTwin: dspVersion, sabotage: sabotage || null, legs: {} };
const ref = rendererLeg();
report.legs.renderer = { omxdsp: execFileSync('pkg-config', ['--modversion', 'omxdsp'], { encoding: 'utf8' }).trim(), edges: ref.edges, ticks: ref.ticks };
const nonEmpty = ref.ticks.flat().filter((r) => r.bar !== null).length, markers = ref.ticks.flat().filter((r) => r.marker !== null).length;
if (nonEmpty < stream.ticks.length || markers < stream.ticks.length * meters.length) {
  console.error(`meter-surfaces: the renderer drew ${nonEmpty} bars and ${markers} markers; the measure found too little to compare`);
  process.exit(2);
}
let failed = false, unrun = false;
for (const [name, run] of [['browser', () => browserLeg(opt('--browser', '/usr/bin/chromium-browser'))], ['tk', () => tkLeg()]]) {
  if (name === 'tk' && args.includes('--no-tk')) continue;
  let leg;
  try { leg = await run(); } catch (e) { console.error(`meter-surfaces: the ${name} leg did not run: ${e.message}`); unrun = true; continue; }
  const r = against(ref, leg);
  const ok = Object.values(r.worst).every((d) => d <= TOL[name]);
  failed ||= !ok;
  report.legs[name] = { version: leg.version, tolerance: TOL[name], ok, worst: r.worst, barsCompared: r.bars, where: r.where, edges: leg.edges, ticks: leg.ticks, ...(leg.domFrames ? { domFrames: leg.domFrames } : {}), ...(leg.vectorsChecked ? { vectorsChecked: leg.vectorsChecked } : {}) };
  console.log(`${name.padEnd(8)} ${ok ? 'within' : 'PAST'} ${TOL[name]} px over ${stream.ticks.length} ticks x ${meters.length} meters: bar end ${r.worst.bar} px (${r.bars} clear of the marker), marker ${r.worst.marker} px, frame edges ${r.worst.frame} px (${leg.version})`);
}
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(report, null, 2) + '\n');
process.exit(failed ? 1 : unrun ? 2 : 0);
