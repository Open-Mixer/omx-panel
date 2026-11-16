// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * look-contrast.mjs — the contrast of every piece of MOD GUI text on the plate it is set on, in every look, measured
 * against what the console's flat look gives it (WCAG relative luminance, tools/look.mjs `contrast`). A look never
 * lowers a ratio: each plate that carries text is declared in schema/modgui-looks.json with colour roles only, and a
 * gradient is held to its worst stop. The table is the PAIRS below, one row per text rule of the stylesheet and look;
 * test/modgui-looks.test.mjs holds the stylesheet to it, so a text colour no row covers is refused.
 *
 * Usage: `node tools/look-contrast.mjs` prints the table and the lowest ratio of each look, before and after.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { contrast, LOOK_JSON, loadRoles } from './look.mjs';

/**
 * Every text rule: its selector (without the pedal's scope), the look token that sets its colour, the colour role it had in
 * the console's flat look, the plate it sits on and the role that plate was. A plate with no flat counterpart (the scribble
 * strip, new) is held to FLOOR, WCAG's AA for text.
 */
export const PAIRS = Object.freeze([
  { rule: '.omx-brand', fg: '--t-brand', fgWas: '--ink-dim', plate: 'head', was: '--surface' },
  { rule: '.omx-label', fg: '--t-label', fgWas: '--ink', plate: 'head', was: '--surface' },
  { rule: '.omx-section-title', fg: '--t-section', fgWas: '--ink-dim', plate: 'section', was: '--surface-2' },
  { rule: '.omx-control-title', fg: '--t-control', fgWas: '--ink-dim', plate: 'section', was: '--surface-2' },
  { rule: '(screenshot: a control\'s value)', fg: '--t-value', fgWas: '--ink', plate: 'section', was: '--surface-2' },
  { rule: '.omx-selector-value', fg: '--t-key', fgWas: '--ink', plate: 'key', was: '--surface-3' },
  { rule: '.omx-selector-option', fg: '--t-label', fgWas: '--ink', plate: 'list', was: '--surface-3' },
  { rule: '.omx-selector-option.selected', fg: '--t-list-sel', fgWas: '--accent', plate: 'list', was: '--surface-3' },
  { rule: '.omx-curve-plot text', fg: '--t-screen', fgWas: '--ink', plate: 'screen', was: '--surface-3' },
  { rule: '.omx-curve-caption', fg: '--t-screen-dim', fgWas: '--ink-dim', plate: 'screen', was: '--surface-3' },
  { rule: '.omx-meter-caption', fg: '--t-screen-dim', fgWas: '--ink-dim', plate: 'screen', was: '--surface-3' },
  { rule: '.omx-scribble', fg: '--scribble-ink', plate: 'scribble', floor: 4.5 },
]);
/** WCAG AA for normal text. */
export const FLOOR = 4.5;

/** The selectors of `css` that set a text colour (`color`, or `fill` of a text element), the pedal's own scope removed. */
export function textRules(css) {
  const out = [];
  for (const m of css.matchAll(/^(\.omx-pedal\{\{\{cns\}\}\}) ([^{]+?) \{([^}]*)\}/gm)) {
    const [, , sel, body] = m;
    for (const one of sel.split(/, \.omx-pedal\{\{\{cns\}\}\} /)) {
      if (/(^|[;\s])color:/.test(body) || (/(^|[;\s])fill:/.test(body) && /text$/.test(one))) out.push(one.trim());
    }
  }
  return out;
}

const PLATE_TOKENS = { head: ['--head-bg'], section: ['--section-bg'], key: ['--key-bg', '--key-held-bg'], screen: ['--screen-bg'], scribble: ['--scribble-bg'] };
const HEX = /#[0-9a-f]{6}/gi;

/** The colours a plate is drawn in, in `look`: every #rrggbb its tokens carry, the enclosure palette where it falls through to the body. */
function stopsOf(look, plate) {
  const own = PLATE_TOKENS[plate]?.filter((k) => look[k] !== 'none').flatMap((k) => look[k].match(HEX) ?? []) ?? [];
  if (own.length || plate === 'list') return own;
  // a head or a section that is no plate of its own: the text sits on the body, on every colour of its gradient and of the palette
  return [...(look['--body-bg'].match(HEX) ?? []), ...look['--enclosure'].split(',').filter((c) => HEX.test(c)).map((c) => c.trim())].map((c) => c.toLowerCase());
}

/**
 * The table: `{ look, rule, fg, plate, before, after }` per look and rule. `before` is the ratio in the console's flat look
 * (or the FLOOR for a strip that had none), `after` the lowest ratio of the look's text colour over every colour of its plate.
 * `override` ({plate: '#rrggbb'}) swaps a plate's colours, for a test. Colours are tools/look.json's, resolved.
 */
export function contrastTable({ override = {}, looks = JSON.parse(readFileSync(LOOK_JSON, 'utf8')).looks, roles = loadRoles() } = {}) {
  const value = Object.fromEntries(roles.roles.map((r) => [r.name, r.default]));
  const rows = [];
  for (const [name, raw] of Object.entries(looks)) {
    const look = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v).replace(/\{(--[a-z0-9-]+)\}/g, (m, r) => value[r] ?? m)]));
    for (const p of PAIRS) {
      const fg = (look[p.fg].match(HEX) ?? [look[p.fg]])[0];
      const colours = override[p.plate] ? [override[p.plate]] : p.plate === 'list' ? [value['--surface-3']] : stopsOf(look, p.plate);
      rows.push({ look: name, rule: p.rule, fg: p.fg, plate: p.plate, stops: colours, before: p.floor ?? contrast(value[p.fgWas], value[p.was]), after: Math.min(...colours.map((c) => contrast(fg, c))) });
    }
  }
  return rows;
}

function main() {
  const rows = contrastTable();
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('look', 8)}${pad('text rule', 34)}${pad('text', 15)}${pad('plate', 9)}${pad('before', 9)}after`);
  for (const r of rows) console.log(`${pad(r.look, 8)}${pad(r.rule, 34)}${pad(r.fg, 15)}${pad(r.plate, 9)}${pad(`${r.before.toFixed(2)}:1`, 9)}${r.after.toFixed(2)}:1`);
  for (const look of new Set(rows.map((r) => r.look))) {
    const mine = rows.filter((r) => r.look === look);
    console.log(`${look}: lowest ratio before ${Math.min(...mine.map((r) => r.before)).toFixed(2)}:1, after ${Math.min(...mine.map((r) => r.after)).toFixed(2)}:1; no pair under the floor of ${look === 'vintage' ? `${FLOOR}:1` : 'today\'s'}: ${mine.every((r) => r.after >= (look === 'vintage' ? FLOOR : r.before) - 1e-9)}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
