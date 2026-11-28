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
 * The clip lamp (omx-panel#13): a meter whose description says clip: true wears one at its frame's top right, lit by the clip word
 * (omx-dsp's omx_meter_view_clip: a tick's clear first, then its clip) from the stream's clips and clears. Every tick, each meter's
 * lamp is lit or not, read at its centre as the meter red, and must be the renderer's exactly (a lamp one surface lights and another
 * does not is past any tolerance); the lamp's four edges, at the first tick, within the leg's tolerance. A meter with no clip word
 * (lufs, whose source reports clips) lights none on any surface.
 * --look names the look the three surfaces wear (console by default). The renderer and Tk draw the description's meter frames in every
 * look (the look's style picks only the renderer's knob); the MOD GUI's vintage look hides the frames and shows its needle dials
 * (omx-panel#218), each dial of a meter with a clip word wearing its own lamp. There the browser's faces are the dials (modgui-gen's
 * vuFaces): no bar, no marker and no frame to compare, only the lamps, each dial's lamp lit or dark as the renderer's at every tick and
 * its edges where its face declares it (meterLamp, inside the face's border) as the renderer's are where its frame declares them, and
 * the dials of the meters with no clip word wearing none (counted in the page).
 * Prints one table and writes the numbers as JSON; exit 1 past a tolerance, 2 when a leg could not run.
 *
 *   node renderer/test/meter-surfaces.mjs [--look console|vintage|3d] [--browser <chromium>] [--no-tk] [--json <file>]
 *     [--sabotage browser-fall|tk-fall|browser-clip|tk-clip|browser-lamp-dropped|browser-lit-unclipped]
 *
 * Needs the built tree and renderer (make renderer), playwright-core and @openmixer/omx-dsp (>= 0.32.2) importable, a
 * Chromium, python3 with tkinter and Pillow, and an X display for Tk (xvfb-run).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { FIXTURES, RENDERER, ROOT, descriptionFile, pinnedData, render, scratch, stateFile } from './harness.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const sabotage = opt('--sabotage', '');
const TOL = { browser: 1, tk: 2 };

const modgui = await import(join(ROOT, 'dist', 'tools', 'modgui-gen.mjs'));
const dsp = await import('@openmixer/omx-dsp');
const dspVersion = JSON.parse(readFileSync(join(ROOT, 'node_modules', '@openmixer', 'omx-dsp', 'package.json'), 'utf8')).version;
const fx = FIXTURES.find((f) => f.name === 'meters');
const g = modgui.GEOMETRY;
/** The look the surfaces wear: its tokens colour every surface, the MOD GUI's template and stylesheet wear it, the renderer its style. */
const LOOK = modgui.loadLook(opt('--look', 'console'));
const look = LOOK.tokens;
const rgb = (t) => [1, 3, 5].map((i) => parseInt(look[t].slice(i, i + 2), 16));
const p = modgui.resolvePanel(JSON.parse(readFileSync(join(ROOT, fx.descriptor), 'utf8')), { panel: JSON.parse(readFileSync(join(ROOT, fx.panel), 'utf8')), stem: fx.stem });
const lay = modgui.layout(p);
const stream = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'meters', 'meters.stream.json'), 'utf8'));
const vectors = execFileSync('pkg-config', ['--variable=meterviewvectors', 'omxdsp'], { encoding: 'utf8' }).trim();
const law = JSON.parse(readFileSync(vectors, 'utf8')).law;

/** Each meter of the band: its frame in panel px at 1x, its range and kind, as the renderer and the MOD GUI lay it out. */
const meters = lay.band.meters.map((m, row) => ({
  symbol: m.symbol, min: m.min, max: m.max, gainReduction: m.kind === 'gain-reduction', clip: m.clip,
  x: lay.band.x + g.sectionPad, y: lay.band.y + g.sectionTitleH + row * (g.meterH + g.meterGap), w: lay.band.w - 2 * g.sectionPad, h: g.meterH, border: 1,
}));
/** Each meter's needle dial in panel px, as the MOD GUI's template places it (modgui-gen's vuFaces), with its bezel. */
const dials = modgui.vuFaces(lay.band, LOOK).map((f) => ({ ...f, x: lay.band.x + f.x, y: lay.band.y + f.y }));
const fraction = (m, v) => Math.min(1, Math.max(0, m.gainReduction ? (m.max - v) / (m.max - m.min) : (v - m.min) / (m.max - m.min)));

// ------------------------------------------------------------------------------------------------------------- reading the pixels
/** How far `px` lies along the line from `from` (the body colour) to `to` (1 is `to`), or -1 when it is off that line by 40 or more. */
const BODY = rgb('--surface-3');
function along(px, to, from = BODY) {
  const d = to.map((c, k) => c - from[k]), dd = d.reduce((s, v) => s + v * v, 0), q = px.map((v, k) => v - from[k]);
  const t = q.reduce((s, v, k) => s + v * d[k], 0) / dd;
  return Math.hypot(...q.map((v, k) => v - t * d[k])) < 40 ? t : -1;
}
const pixel = (img, x, y) => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 3));
const ACCENT = rgb('--accent'), INK = rgb('--ink'), RIM = rgb('--border-strong'), RED = rgb('--meter-red');
const near = (a, b, d) => a.every((v, k) => Math.abs(v - b[k]) <= d);

/** One meter in one image: the bar's last accent pixel (null for no bar) on the bar's row, the marker's first ink pixel on the row
 * under the bar, in panel px; `under` when the bar reaches the marker, which covers its end (that bar end is not compared). The rows are the renderer's: the bar 4 px tall 6 px above the frame's foot, the marker 6 px tall.
 * Both are drawn inside the frame's border, so only the inside is read: outside it is the section, which a look may paint in a
 * colour the measure reads as ink (the vintage enclosure, #e9dfc7, put the renderer's marker at the frame's left every tick). */
function measure(img, m, face = m) {
  const barRow = m.y + m.h - 4, markRow = m.y + m.h - 2, from = m.x + m.border, to = m.x + m.w - m.border;
  let bar = null, marker = null;
  for (let x = from; x < to; x++) if (along(pixel(img, x, barRow), ACCENT) >= 0.5) bar = x;
  for (let x = from; x < to && marker === null; x++) if (along(pixel(img, x, markRow), INK) >= 0.5) marker = x;
  // a bar that runs into the marker has no end of its own to see: the marker is drawn over it
  return { bar, marker, under: bar !== null && marker !== null && bar >= marker - 2, lit: lampLit(img, face) };
}
/** Where the lamp of a face (a meter's frame, or its dial) is (modgui-gen's meterLamp inside the face's border, the renderer's
 * draw_meter place for a frame), in panel px. */
const lampOf = (f) => { const l = modgui.meterLamp(f.w, f.border); return { x: f.x + l.x, y: f.y + l.y, size: l.size }; };
/** Whether the pixel at the centre of where a face's lamp stands is the meter red: lit. A meter with no lamp has none to light. */
const lampLit = (img, f) => { const l = lampOf(f); return near(pixel(img, Math.floor(l.x + l.size / 2), Math.floor(l.y + l.size / 2)), RED, 24); };
/** A lamp's four edges, found on the lamp's middle row and column coming in from 2 px outside it: the first pixel that is the rim
 * colour, or that is at least half the way from the face beside the lamp (the search's first pixel) to the rim, the edge of a round
 * lamp's antialiased ring (a dial's, omx-panel#218). Each as its distance in px from where the face declares it (0 is on its place);
 * null where no lamp is. */
function lampEdges(img, m) {
  const l = lampOf(m), row = Math.floor(l.y + l.size / 2), col = Math.floor(l.x + l.size / 2);
  const rimFrom = (x0, y0) => { const bg = pixel(img, x0, y0); return (x, y) => { const px = pixel(img, x, y); return near(px, RIM, 24) || along(px, RIM, bg) >= 0.5; }; };
  let left = null, right = null, top = null, foot = null;
  for (let x = l.x - 2, isRim = rimFrom(x, row); x < col && left === null; x++) if (isRim(x, row)) left = x;
  for (let x = l.x + l.size + 2, isRim = rimFrom(x, row); x > col && right === null; x--) if (isRim(x, row)) right = x;
  for (let y = l.y - 2, isRim = rimFrom(col, y); y < row && top === null; y++) if (isRim(col, y)) top = y;
  for (let y = l.y + l.size + 2, isRim = rimFrom(col, y); y > row && foot === null; y--) if (isRim(col, y)) foot = y;
  const off = (v, at) => (v === null ? null : v - at);
  return { left: off(left, l.x), right: off(right, l.x + l.size - 1), top: off(top, l.y), foot: off(foot, l.y + l.size - 1) };
}
/** The clip word of each meter at each tick of the stream: omx-dsp's view law (omx_meter_view_clip_clear, then omx_meter_view_clip),
 * none for a meter without a clip word. */
const clipTrack = () => { const lit = meters.map(() => false); return stream.ticks.map((t) => meters.map((m, i) => (lit[i] = m.clip && ((lit[i] && !(t.clear ?? []).includes(m.symbol)) || (t.clip ?? []).includes(m.symbol))))); };
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
  // the tools directory with the look's style: the renderer draws the knob that style names, and the meters as in every style
  const data = pinnedData(LOOK.name);
  const out = [];
  let edges = null, lamps = null;
  for (let k = 0; k < stream.ticks.length; k++) {
    const reading = (t, m) => ({ value: t.values[m.symbol], elapsed: t.elapsed, ...((t.clear ?? []).includes(m.symbol) ? { clear: true } : {}), ...((t.clip ?? []).includes(m.symbol) ? { clip: true } : {}) });
    const state = { ...base, meters: Object.fromEntries(meters.map((m) => [m.symbol, stream.ticks.slice(0, k + 1).map((t) => reading(t, m))])) };
    const st = join(dir, 'tick.state.json');
    writeFileSync(st, JSON.stringify(state));
    const img = render(desc, st, { data });
    if (k === 0) edges = meters.map((m) => frameEdges(img, m));
    if (lamps === null && meters.some((m) => m.clip)) lamps = meters.map((m) => (m.clip ? lampEdges(img, m) : null));
    out.push(meters.map((m) => measure(img, m)));
  }
  return { ticks: out, edges, lamps };
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
  // the template wears the look the stylesheet scopes its rules by (omx-look-<name>): one look, named once
  let body = strip(modgui.emitTemplate(p, lay, 'meter-surfaces', LOOK.name));
  // --sabotage browser-lamp-dropped: the dials wear no lamp
  if (sabotage === 'browser-lamp-dropped') body = body.replace(/<span class="omx-vu-clip"><\/span>/g, '');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:${look['--surface']}}
${strip(modgui.emitStylesheet(p, LOOK, 'meter-surfaces'))}</style></head><body>${body}</body></html>`;
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--force-device-scale-factor=1', '--font-render-hinting=none'] });
  const page = await browser.newPage({ viewport: { width: lay.w + 40, height: lay.h + 40 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  const domFrames = await page.evaluate(() => [...document.querySelectorAll('.omx-meter-frame')].map((e) => { const r = e.getBoundingClientRect(); return { symbol: e.dataset.symbol, x: r.x, y: r.y, w: r.width, h: r.height }; }));
  // which face the look shows, read from the page: the frames (console, 3d) or the needle dials (vintage), never both; and each dial's lamps
  const shown = await page.evaluate(() => ({
    frames: [...document.querySelectorAll('.omx-meter-frame')].filter((e) => getComputedStyle(e).display !== 'none').length,
    dials: [...document.querySelectorAll('.omx-vu')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => ({ symbol: e.dataset.vuSymbol, lamps: e.querySelectorAll('.omx-vu-clip').length })),
  }));
  const onDials = shown.dials.length > 0;
  if (onDials === (shown.frames > 0)) throw new Error(`the ${LOOK.name} look shows ${shown.frames} frames and ${shown.dials.length} dials: one face, never both or none`);
  if (onDials && shown.dials.map((d) => d.symbol).join() !== meters.map((m) => m.symbol).join()) throw new Error(`the dials are ${shown.dials.map((d) => d.symbol).join(', ')}, not the band's meters`);
  const faces = onDials ? dials : meters;
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
  // the clip word by the law; --sabotage browser-clip never clears it
  const clips = sabotage === 'browser-clip' ? (() => { const lit = meters.map(() => false); return stream.ticks.map((t) => meters.map((m, i) => (lit[i] = m.clip && (lit[i] || (t.clip ?? []).includes(m.symbol))))); })()
    // --sabotage browser-lit-unclipped: every lamp lit at every tick, a clip or none
    : sabotage === 'browser-lit-unclipped' ? stream.ticks.map(() => meters.map(() => true)) : clipTrack();
  const out = [];
  let edges = null, lamps = null;
  for (let k = 0; k < stream.ticks.length; k++) {
    await page.evaluate(({ tick, ms, lit }) => {
      document.querySelectorAll('.omx-meter-frame').forEach((fr, i) => {
        const m = ms[i], t = tick[i], inner = m.w - 4, bar = fr.querySelector('.probe-bar'), mark = fr.querySelector('.probe-mark');
        bar.style.cssText += `;display:${t.fill > 0 ? 'block' : 'none'};left:${2 - 1}px;top:${m.h - 6 - 1}px;width:${inner * t.fill}px;height:4px`;
        mark.style.cssText += `;display:block;left:${2 - 1 + Math.max(0, inner * t.marker - 2)}px;top:${m.h - 7 - 1}px;width:2px;height:6px`;
      });
      // the lamp of each meter, the frame's and the dial's alike: the omx-clip-lit class, set by the clip word
      document.querySelectorAll('.omx-meter-frame').forEach((fr, i) => fr.querySelector('.omx-meter-clip')?.classList.toggle('omx-clip-lit', lit[i]));
      document.querySelectorAll('.omx-vu').forEach((d, i) => d.querySelector('.omx-vu-clip')?.classList.toggle('omx-clip-lit', lit[i]));
    }, { tick: track[k], ms: meters, lit: clips[k] });
    const img = decodePngAny(await page.screenshot({ clip: { x: 0, y: 0, width: lay.w, height: lay.h }, type: 'png' }));
    if (k === 0) edges = onDials ? null : meters.map((m) => frameEdges(img, m));
    if (lamps === null && meters.some((m) => m.clip)) lamps = meters.map((m, i) => (m.clip ? lampEdges(img, faces[i]) : null));
    out.push(meters.map((m, i) => (onDials ? { bar: null, marker: null, under: false, lit: lampLit(img, faces[i]) } : measure(img, m))));
  }
  const version = browser.version();
  await browser.close();
  return { ticks: out, edges, lamps, domFrames, version, ...(onDials ? { dials: shown.dials } : {}) };
}

function tkLeg() {
  const dir = scratch('omx-meter-tk-');
  const job = {
    w: Math.round(lay.w), h: Math.round(lay.h), band: lay.band, meters, ticks: sabotage === 'tk-clip' ? stream.ticks.map(({ clear: _c, ...t }) => t) : stream.ticks, vectors, lamp: g.meterLamp,
    law: { ...law, fallDbPerSecond: sabotage === 'tk-fall' ? 2 * law.fallDbPerSecond : law.fallDbPerSecond },
    colours: { surface: look['--surface'], section: look['--surface-2'], body: look['--surface-3'], rim: look['--border-strong'], accent: look['--accent'], ink: look['--ink'], red: look['--meter-red'] },
  };
  writeFileSync(join(dir, 'job.json'), JSON.stringify(job));
  execFileSync('python3', ['-I', join(RENDERER, 'test', 'meter_tk.py'), join(dir, 'job.json'), dir], { stdio: ['ignore', 'inherit', 'inherit'] });
  const meta = JSON.parse(readFileSync(join(dir, 'tk.json'), 'utf8'));
  const out = [];
  let edges = null, lamps = null;
  for (let k = 0; k < meta.ticks; k++) {
    const img = { w: meta.w, h: meta.h, data: new Uint8Array(readFileSync(join(dir, `tk-${k}.rgba`))) };
    if (k === 0) edges = meters.map((m) => frameEdges(img, m));
    if (lamps === null && meters.some((m) => m.clip)) lamps = meters.map((m) => (m.clip ? lampEdges(img, m) : null));
    out.push(meters.map((m) => measure(img, m)));
  }
  const tkv = execFileSync('python3', ['-I', '-c', 'import tkinter, PIL; print(tkinter.TkVersion, PIL.__version__)'], { encoding: 'utf8' }).trim();
  return { ticks: out, edges, lamps, vectorsChecked: meta.vectorsChecked, version: `Tk ${tkv.split(' ')[0]}, Pillow ${tkv.split(' ')[1]}` };
}

// --------------------------------------------------------------------------------------------------------------- the comparison
/** The largest distance of a leg from the renderer, per measure; a bar or a marker one surface draws and the other does not counts as
 * Infinity. */
function against(ref, leg) {
  const worst = { bar: 0, marker: 0, frame: 0, lamp: 0, lit: 0 }, where = { bar: null, marker: null, frame: null, lamp: null, lit: null };
  const take = (key, a, b, at) => {
    const d = a === null && b === null ? 0 : a === null || b === null ? Infinity : Math.abs(a - b);
    if (d > worst[key]) { worst[key] = d; where[key] = at; }
  };
  let bars = 0;
  // a leg on the needle dials has no bar, marker or frame of the renderer's to hold: its lamps are what it shows of the meters' band
  const onDials = leg.dials !== undefined;
  if (onDials) leg.dials.forEach((d, i) => { if (d.lamps !== (meters[i].clip ? 1 : 0)) take('lamp', 0, null, `${d.symbol}'s dial wears ${d.lamps} lamps, its meter ${meters[i].clip ? 'has' : 'has no'} clip word`); });
  ref.ticks.forEach((row, k) => row.forEach((r, i) => {
    if (onDials) { if (r.lit !== leg.ticks[k][i].lit) take('lit', 0, null, `tick ${k} ${meters[i].symbol}: the renderer's lamp ${r.lit ? 'lit' : 'dark'}`); return; }
    if (!r.under && !leg.ticks[k][i].under) { bars++; take('bar', r.bar, leg.ticks[k][i].bar, `tick ${k} ${meters[i].symbol}`); }
    take('marker', r.marker, leg.ticks[k][i].marker, `tick ${k} ${meters[i].symbol}`);
    if (r.lit !== leg.ticks[k][i].lit) take('lit', 0, null, `tick ${k} ${meters[i].symbol}: the renderer's lamp ${r.lit ? 'lit' : 'dark'}`);
  }));
  (ref.lamps ?? []).forEach((e, i) => { if (e) for (const side of ['left', 'right', 'top', 'foot']) take('lamp', e[side], leg.lamps?.[i]?.[side] ?? null, `${meters[i].symbol} lamp ${side}`); });
  if (!onDials) ref.edges.forEach((e, i) => { for (const side of ['left', 'right', 'top', 'foot']) take('frame', e[side], leg.edges[i][side], `${meters[i].symbol} ${side}`); });
  return { worst, where, bars };
}

const report = { look: LOOK.name, stream: { ticks: stream.ticks.length, seconds: stream.ticks.reduce((s, t) => s + t.elapsed, 0), meters: meters.map((m) => m.symbol) }, omxDspTwin: dspVersion, sabotage: sabotage || null, legs: {} };
const ref = rendererLeg();
report.legs.renderer = { omxdsp: execFileSync('pkg-config', ['--modversion', 'omxdsp'], { encoding: 'utf8' }).trim(), edges: ref.edges, lamps: ref.lamps, ticks: ref.ticks };
const nonEmpty = ref.ticks.flat().filter((r) => r.bar !== null).length, markers = ref.ticks.flat().filter((r) => r.marker !== null).length;
// the renderer's lamps follow the law tick by tick, lit and dark both seen, and a meter with no clip word never lit
const law13 = clipTrack(), litSeen = ref.ticks.flat().filter((r) => r.lit).length;
const litWrong = ref.ticks.flatMap((row, k) => row.map((r, i) => (r.lit !== law13[k][i] ? `tick ${k} ${meters[i].symbol}` : null))).filter(Boolean);
if (litWrong.length) {
  console.error(`meter-surfaces: the renderer's lamp is not the clip word at ${litWrong.slice(0, 4).join(', ')}`);
  process.exit(1);
}
if (litSeen === 0 || litSeen === ref.ticks.flat().length || !(ref.lamps ?? []).some(Boolean)) {
  console.error('meter-surfaces: the stream lit no lamp, or every lamp always: the measure has nothing to compare');
  process.exit(2);
}
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
  report.legs[name] = { version: leg.version, tolerance: TOL[name], ok, worst: r.worst, barsCompared: r.bars, where: r.where, edges: leg.edges, lamps: leg.lamps, ticks: leg.ticks, ...(leg.domFrames ? { domFrames: leg.domFrames } : {}), ...(leg.dials ? { dials: leg.dials } : {}), ...(leg.vectorsChecked ? { vectorsChecked: leg.vectorsChecked } : {}) };
  const faces = leg.dials ? `the ${LOOK.name} dials: lamps ${leg.dials.map((d) => `${d.symbol} ${d.lamps}`).join(', ')}` : `bar end ${r.worst.bar} px (${r.bars} clear of the marker), marker ${r.worst.marker} px, frame edges ${r.worst.frame} px`;
  console.log(`${name.padEnd(8)} ${ok ? 'within' : 'PAST'} ${TOL[name]} px over ${stream.ticks.length} ticks x ${meters.length} meters (${LOOK.name}): ${faces}, lamp edges ${r.worst.lamp} px${r.worst.lamp > TOL[name] ? ` at ${r.where.lamp}` : ''}, lamps lit apart ${r.worst.lit === 0 ? 'never' : `at ${r.where.lit}`} (${leg.version})`);
}
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(report, null, 2) + '\n');
process.exit(failed ? 1 : unrun ? 2 : 0);
