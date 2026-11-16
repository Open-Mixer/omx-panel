// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * svg-knob.mjs — a knob film strip from ONE SVG. The knob of a look is one file, tools/look/knob-<look>.svg, in a small
 * subset of SVG 1.1; this module reads it and paints a frame per step with tools/raster.mjs, so the strips are
 * generated, never drawn by hand and never a binary in the tree. The subset (anything else is refused by name):
 *
 *   <circle cx cy r>  <ellipse cx cy rx ry>  <rect x y width height rx>  <line x1 y1 x2 y2 stroke stroke-width>,
 *   fill / stroke as #rrggbb, or url(#id) of a <linearGradient x1 y1 x2 y2> or <radialGradient cx cy r> (each in
 *   objectBoundingBox fractions, <stop offset stop-color stop-opacity>), fill-opacity, and <g transform="rotate(a cx cy)">.
 *
 * A colour in the file is a role placeholder, `{--accent}`, resolved against the look's tokens before it is read, and the
 * pointer's group carries `rotate({angle} cx cy)`, the frame's angle in degrees from straight up: -135 at the first
 * frame, +135 at the last, MOD's 270-degree sweep. Pure: no clock, no host (sin and cos are rounded to 1e-9 first).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvas, encodePng, paint, rgbOf } from './raster.mjs';

const LOOK_DIR = join(dirname(fileURLToPath(import.meta.url)), 'look');
export const knobSvgFile = (name) => join(LOOK_DIR, name);

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const num = (a, k, d = 0) => (a[k] === undefined ? d : Number(a[k]));

/** `svg` text with every `{--role}` replaced by the look's token and `{angle}` by `angle`. */
export function resolveSvg(text, tokens, angle) {
  return text.replace(/\{(--[a-z0-9-]+|angle)\}/g, (_m, k) => {
    if (k === 'angle') return String(angle);
    if (typeof tokens[k] !== 'string') throw new Error(`svg-knob: the knob names ${k}, which the look does not set`);
    return tokens[k];
  });
}

/** The scene of an SVG text: gradients by id, and shapes in paint order with the rotations over them. */
export function parseSvg(text) {
  const grads = new Map();
  for (const m of text.matchAll(/<(linearGradient|radialGradient)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const a = attrs(m[2]);
    const stops = [...m[3].matchAll(/<stop\b([^>]*)\/?>/g)].map((s) => {
      const b = attrs(s[1]);
      return { at: num(b, 'offset'), rgb: rgbOf(b['stop-color']), a: num(b, 'stop-opacity', 1) };
    });
    grads.set(a.id, { kind: m[1], a, stops });
  }
  const shapes = [];
  const stack = [];
  const body = text.replace(/<defs>[\s\S]*?<\/defs>/, '');
  for (const m of body.matchAll(/<(\/?)(g|circle|ellipse|rect|line)\b([^>]*?)(\/?)>/g)) {
    if (m[2] === 'g') {
      if (m[1]) stack.pop();
      else {
        const r = /^rotate\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/.exec(attrs(m[3]).transform ?? '');
        if (!r) throw new Error(`svg-knob: a <g> carries '${attrs(m[3]).transform}', not rotate(a cx cy)`);
        stack.push({ a: Number(r[1]), cx: Number(r[2]), cy: Number(r[3]) });
        if (m[4]) stack.pop();
      }
    } else if (!m[1]) shapes.push({ tag: m[2], a: attrs(m[3]), rot: stack.slice() });
  }
  for (const t of text.match(/<\/?[a-zA-Z]+/g) ?? []) {
    if (!/^<\/?(svg|defs|linearGradient|radialGradient|stop|g|circle|ellipse|rect|line)$/.test(t)) throw new Error(`svg-knob: ${t}> is outside the subset`);
  }
  return { grads, shapes };
}

const round9 = (v) => Math.round(v * 1e9) / 1e9;
/** The point `(x, y)` taken back through a stack of rotations, the innermost last. */
function unrotate(rots, x, y) {
  for (const r of rots) {
    const th = (-r.a * Math.PI) / 180, co = round9(Math.cos(th)), si = round9(Math.sin(th));
    const dx = x - r.cx, dy = y - r.cy;
    x = r.cx + dx * co - dy * si;
    y = r.cy + dx * si + dy * co;
  }
  return [x, y];
}

function colourOf(paintSpec, opacity, scene, bbox) {
  const url = /^url\(#([^)]+)\)$/.exec(paintSpec);
  if (!url) {
    const rgb = rgbOf(paintSpec);
    return () => [rgb[0], rgb[1], rgb[2], opacity];
  }
  const g = scene.grads.get(url[1]);
  if (!g) throw new Error(`svg-knob: no gradient '${url[1]}'`);
  const [bx, by, bw, bh] = bbox;
  const at = (x, y) => {
    const u = (x - bx) / bw, v = (y - by) / bh;
    if (g.kind === 'linearGradient') {
      const x1 = num(g.a, 'x1'), y1 = num(g.a, 'y1'), x2 = num(g.a, 'x2', 1), y2 = num(g.a, 'y2');
      const dx = x2 - x1, dy = y2 - y1;
      return ((u - x1) * dx + (v - y1) * dy) / (dx * dx + dy * dy);
    }
    return Math.hypot(u - num(g.a, 'cx', 0.5), v - num(g.a, 'cy', 0.5)) / num(g.a, 'r', 0.5);
  };
  return (x, y) => {
    const t = Math.min(1, Math.max(0, at(x, y))), s = g.stops;
    let k = 0;
    while (k < s.length - 2 && t > s[k + 1].at) k++;
    const [p, q] = [s[k], s[k + 1] ?? s[k]];
    const w = q.at === p.at ? 0 : Math.min(1, Math.max(0, (t - p.at) / (q.at - p.at)));
    return [0, 1, 2].map((i) => p.rgb[i] + (q.rgb[i] - p.rgb[i]) * w).concat([(p.a + (q.a - p.a) * w) * opacity]);
  };
}

/** Paint the scene onto `c`, its origin at (ox, oy), `k` px per SVG unit. */
export function paintScene(c, scene, ox, oy, k) {
  for (const { tag, a, rot } of scene.shapes) {
    const opacity = num(a, 'fill-opacity', 1);
    const to = (x, y) => unrotate(rot, x, y);
    let box, inside, bbox;
    if (tag === 'circle' || tag === 'ellipse') {
      const cx = num(a, 'cx'), cy = num(a, 'cy'), rx = tag === 'circle' ? num(a, 'r') : num(a, 'rx'), ry = tag === 'circle' ? num(a, 'r') : num(a, 'ry');
      bbox = [cx - rx, cy - ry, 2 * rx, 2 * ry];
      inside = (sx, sy) => { const [x, y] = to((sx - ox) / k, (sy - oy) / k); return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1; };
    } else if (tag === 'rect') {
      const x0 = num(a, 'x'), y0 = num(a, 'y'), w = num(a, 'width'), h = num(a, 'height'), r = num(a, 'rx');
      bbox = [x0, y0, w, h];
      inside = (sx, sy) => {
        const [x, y] = to((sx - ox) / k, (sy - oy) / k);
        const qx = Math.max(x0 + r - x, 0, x - (x0 + w - r)), qy = Math.max(y0 + r - y, 0, y - (y0 + h - r));
        return x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h && qx * qx + qy * qy <= r * r;
      };
    } else {
      const x1 = num(a, 'x1'), y1 = num(a, 'y1'), x2 = num(a, 'x2'), y2 = num(a, 'y2'), hw = num(a, 'stroke-width', 1) / 2;
      const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
      bbox = [Math.min(x1, x2) - hw, Math.min(y1, y2) - hw, Math.abs(dx) + 2 * hw, Math.abs(dy) + 2 * hw];
      inside = (sx, sy) => {
        const [x, y] = to((sx - ox) / k, (sy - oy) / k);
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
        return (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2 <= hw * hw;
      };
    }
    box = [ox, oy, ox + 48 * k, oy + 48 * k]; // the frame: a rotated shape stays inside it
    const spec = tag === 'line' ? a.stroke : a.fill;
    if (!spec || spec === 'none') continue;
    // a gradient follows the shape's own box, rotated with it: sampled in the shape's frame
    const col = colourOf(spec, tag === 'line' ? num(a, 'stroke-opacity', 1) : opacity, scene, bbox);
    paint(c, box, inside, (sx, sy) => { const [x, y] = to((sx - ox) / k, (sy - oy) / k); return col(x, y); });
  }
}

/** A film strip: `frames` frames of `size` px, the knob of `svgText` from -135 to +135 degrees, as a PNG. */
export function renderSvgFilm(svgText, tokens, frames, size, viewBox = 48) {
  const c = canvas(size * frames, size);
  for (let i = 0; i < frames; i++) {
    const angle = round9(-135 + (270 * i) / (frames - 1));
    paintScene(c, parseSvg(resolveSvg(svgText, tokens, angle)), i * size, 0, size / viewBox);
  }
  return encodePng(c, size);
}

/** The SVG file `name` (tools/look/), read. */
export const readKnobSvg = (name) => readFileSync(knobSvgFile(name), 'utf8');
