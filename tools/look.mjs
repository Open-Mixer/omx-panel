#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * look.mjs — the colour roles of a panel (schema/look-roles.json, the one-panel spec,
 * §7.10) and the two files derived from them:
 *
 *   · tools/look.json, the one public source of the vintage tokens: every role at its one default, and the font. The
 *     MOD GUI wears it (tools/modgui-gen.mjs), the renderer reads it from its data directory, the Zynthian UI and its
 *     pixel test map their colours from it, and the console's tokens.css is held to it (docs/modgui.md "The look");
 *   · renderer/src/look_roles.h, the role list the renderer's read_look requires of every look a host passes.
 *
 * The roles are declared once; the values are each host's (the console's tokens.css, Zynthian's palette table). Nothing
 * here resolves a host's cascade: the hand copy of the console's tokens that lived in tools/look/tokens.css is gone.
 *
 * Usage: `node tools/look.mjs [--check]` — `--check` writes nothing and fails when a derived file is not what
 * schema/look-roles.json gives, or when the role file breaks a rule of checkRoles.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { consoleTokens, loadPin } from './look-pin.mjs';
import { isMain } from '@openmixer/omx-contract/entry';

const TOOLS = dirname(fileURLToPath(import.meta.url));
export const ROLES_JSON = join(TOOLS, '..', 'schema', 'look-roles.json');
export const LOOK_JSON = join(TOOLS, 'look.json');
export const LOOKS_JSON = join(TOOLS, '..', 'schema', 'modgui-looks.json');
export const ROLE_HEADER = join(TOOLS, '..', 'renderer', 'src', 'look_roles.h');

/** The families a role belongs to (omx look §2(i)); finish is a host's chrome, never a role's. */
export const FAMILIES = Object.freeze(['theme', 'accent', 'fixed', 'state']);
/** The keys a role carries: one value, `default`, and nothing that could hold a second. */
const ROLE_KEYS = Object.freeze(['name', 'family', 'draws', 'ground', 'floor', 'apart', 'default']);
const TOP_KEYS = Object.freeze(['$comment', 'look', 'font', 'roles']);
const LOOK_AXES = Object.freeze(['theme', 'accent', 'finish', 'style']);
/** The tokens that are not colours: the CSS font stack, and the font file (relative to tools/) the raster reads. */
export const NOT_COLOURS = Object.freeze(['--font-ui', '--font-file']);

/** The role file, parsed. */
export const loadRoles = (file = ROLES_JSON) => JSON.parse(readFileSync(file, 'utf8'));

const hex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v);

/** WCAG relative luminance of `#rrggbb`. */
export function luminance(h) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two `#rrggbb` colours. */
export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Every rule of the role file `doc` broken, as sentences, or none. The floors are measured on `values` (name ->
 * #rrggbb) when given, else on the defaults: a host's table is held to the same floors by the same function.
 */
export function checkRoles(doc, values) {
  const faults = [];
  for (const k of Object.keys(doc ?? {})) if (!TOP_KEYS.includes(k)) faults.push(`the role file carries '${k}': one value per role, under its role`);
  const roles = Array.isArray(doc?.roles) ? doc.roles : (faults.push('the role file has no roles list'), []);
  for (const a of LOOK_AXES) if (typeof doc?.look?.[a] !== 'string') faults.push(`look.${a} is not named: the defaults are one look's`);
  for (const f of NOT_COLOURS) if (typeof doc?.font?.[f] !== 'string') faults.push(`font sets no ${f}`);
  const byName = new Map();
  for (const r of roles) {
    if (typeof r?.name !== 'string' || !/^--[a-z][a-z0-9-]*$/.test(r.name)) {
      faults.push(`a role is named '${r?.name}', not a --token`);
      continue;
    }
    if (byName.has(r.name)) faults.push(`${r.name} is declared twice`);
    byName.set(r.name, r);
    for (const k of Object.keys(r)) if (!ROLE_KEYS.includes(k)) faults.push(`${r.name} carries '${k}': a role has one value, its default`);
    if (!FAMILIES.includes(r.family)) faults.push(`${r.name}'s family '${r.family}' is none of ${FAMILIES.join(', ')}`);
    if (typeof r.draws !== 'string' || !r.draws) faults.push(`${r.name} names nothing it draws`);
    if (!hex(r.default)) faults.push(`${r.name}'s default '${r.default}' is not one #rrggbb colour`);
    if (r.ground === true) {
      if (r.floor) faults.push(`${r.name} is a ground and has a floor`);
    } else if (!r.floor) faults.push(`${r.name} is no ground and has no floor`);
  }
  const value = (n) => (values ? values[n] : byName.get(n)?.default);
  for (const r of byName.values()) {
    const v = value(r.name);
    if (values && !hex(v)) {
      faults.push(`${r.name} has no #rrggbb value`);
      continue;
    }
    if (!hex(v)) continue;
    if (r.floor) {
      if (!(r.floor.ratio >= 1) || !Array.isArray(r.floor.on) || r.floor.on.length === 0) faults.push(`${r.name}'s floor is no ratio on a list of grounds`);
      for (const g of r.floor.on ?? []) {
        if (byName.get(g)?.ground !== true) {
          faults.push(`${r.name}'s floor is on ${g}, which is no ground role`);
          continue;
        }
        if (!hex(value(g))) continue;
        const c = contrast(v, value(g));
        if (c < r.floor.ratio) faults.push(`${r.name} ${v} measures ${c.toFixed(2)}:1 on ${g} ${value(g)}, under its ${r.floor.ratio}:1 floor`);
      }
    }
    for (const o of r.apart?.from ?? []) {
      if (!byName.has(o)) {
        faults.push(`${r.name} stands apart from ${o}, which is no role`);
        continue;
      }
      if (!hex(value(o))) continue;
      const c = contrast(v, value(o));
      if (c < r.apart.ratio) faults.push(`${r.name} ${v} and ${o} ${value(o)} are ${c.toFixed(2)}:1 apart in luminance, under ${r.apart.ratio}:1`);
    }
  }
  return faults;
}

/** The finish a look wears: its `--finish`, where `{console:default-finish}` is the console's own default (read from its tokens.css, pinned). */
export const finishOf = (look, pin = loadPin()) => String(look['--finish']).replace(/\{console:default-finish\}/g, pin.defaultFinish);

/** The MOD GUI's looks file, parsed. */
export const loadLooks = (file = LOOKS_JSON) => JSON.parse(readFileSync(file, 'utf8'));

/** The tokens every look sets, in the order the first look gives them: the one schema of the looks. */
export const lookKeys = (looks = loadLooks()) => Object.keys(Object.values(looks.looks)[0]);
/** The tokens whose backgrounds carry text: they may name colour roles, never the plugin's enclosure. */
export const TEXT_PLATES = Object.freeze(['--head-bg', '--section-bg', '--key-bg', '--key-held-bg', '--screen-bg']);

/** The shapes of the scene subset the film painter and the renderer's backends draw. */
export const SCENE_SHAPES = Object.freeze(['circle', 'ellipse', 'rect', 'line']);
/** A drawing's gradient takes two stops at most: NanoVG's gradients do, and the CPU raster is held to the same pictures. */
export const SCENE_MAX_STOPS = 2;

/** Every rule of the drawings `drawings` (the scenes of the looks file) broken, as sentences, or none. */
export function checkDrawings(drawings, roles = loadRoles()) {
  const faults = [];
  const names = new Set(roles.roles.map((r) => r.name));
  const pin = loadPin();
  const placeholder = (where, v) => {
    for (const m of String(v).matchAll(/\{([^{}]*)\}/g)) {
      const k = m[1];
      if (k === 'angle') continue;
      const c = /^console:(--[a-z0-9-]+)$/.exec(k), f = /^finish:(--[a-z0-9-]+)$/.exec(k), r = /^(--[a-z0-9-]+)$/.exec(k);
      if (c) { if (!(c[1] in consoleTokens(pin))) faults.push(`drawing ${where}: {${k}} is carried by no console token of the pin`); }
      else if (f) { for (const [fn, fin] of Object.entries(pin.finish)) if (!(f[1] in fin)) faults.push(`drawing ${where}: {${k}} is carried by no ${fn} finish of the pin`); }
      else if (r) { if (!names.has(r[1])) faults.push(`drawing ${where}: {${k}} is no colour role`); }
      else faults.push(`drawing ${where}: {${k}} is no placeholder (--role, console:--x, finish:--x or angle)`);
    }
  };
  for (const [n, d] of Object.entries(drawings ?? {})) {
    if (typeof d?.viewBox !== 'number' || !(d.viewBox > 0)) faults.push(`drawing '${n}' has no viewBox number`);
    for (const [id, g] of Object.entries(d?.gradients ?? {})) {
      if (g.kind !== 'linearGradient' && g.kind !== 'radialGradient') faults.push(`drawing '${n}': gradient '${id}' is '${g.kind}', not a linearGradient or a radialGradient`);
      if (!Array.isArray(g.stops) || g.stops.length < 2) faults.push(`drawing '${n}': gradient '${id}' has ${g.stops?.length ?? 0} stops; it needs two`);
      else if (g.stops.length > SCENE_MAX_STOPS) faults.push(`drawing '${n}': gradient '${id}' has ${g.stops.length} stops; the renderer's backends take ${SCENE_MAX_STOPS}`);
      for (const st of g.stops ?? []) placeholder(`'${n}' gradient '${id}'`, st.color);
    }
    (d?.shapes ?? []).forEach((sh, i) => {
      if (!SCENE_SHAPES.includes(sh.tag)) faults.push(`drawing '${n}': shape ${i} is '${sh.tag}', outside the subset (${SCENE_SHAPES.join(', ')})`);
      for (const v of Object.values(sh.attrs ?? {})) placeholder(`'${n}' shape ${i}`, v);
      for (const r of sh.rotate ?? []) if (typeof r.angle !== 'number' && r.angle !== '{angle}') faults.push(`drawing '${n}': shape ${i} rotates by '${r.angle}', not a number or {angle}`);
      for (const v of [sh.attrs?.fill, sh.attrs?.stroke]) {
        const u = /^url\(#([^)]+)\)$/.exec(String(v ?? ''));
        if (u && !(u[1] in (d.gradients ?? {}))) faults.push(`drawing '${n}': shape ${i} paints with url(#${u[1]}), which names no gradient`);
      }
    });
  }
  return faults;
}

/** Every rule of the looks file `looks` broken, as sentences, or none. */
export function checkLooks(looks, roles = loadRoles()) {
  const faults = [];
  const names = new Set(roles.roles.map((r) => r.name));
  const s = looks?.setting;
  const names3 = Object.keys(looks?.looks ?? {});
  if (!s || s.name !== 'modgui-look' || !Array.isArray(s.values) || typeof s.default !== 'string') faults.push('the setting is not { name: modgui-look, values, default }');
  else {
    if (!s.values.includes(s.default)) faults.push(`the setting's default '${s.default}' is none of its values`);
    if (JSON.stringify([...s.values].sort()) !== JSON.stringify([...names3].sort())) faults.push(`the setting's values (${s.values.join(', ')}) are not the looks declared (${names3.join(', ')})`);
  }
  faults.push(...checkDrawings(looks?.drawings, roles));
  const keys = names3.length ? lookKeys(looks) : [];
  for (const [n, look] of Object.entries(looks?.looks ?? {})) {
    const knob = look['--knob'];
    if (typeof knob === 'string' && knob !== 'flat' && !(knob in (looks?.drawings ?? {})) && !existsSync(join(TOOLS, 'look', knob))) faults.push(`look ${n} --knob '${knob}' names no drawing (drawings) and no file tools/look/${knob}`);
    for (const k of keys) if (typeof look[k] !== 'string' || !look[k]) faults.push(`look ${n} sets no ${k}`);
    for (const k of Object.keys(look)) if (!keys.includes(k)) faults.push(`look ${n} sets ${k}, which another look does not: one schema`);
    for (const [k, v] of Object.entries(look)) {
      for (const ref of String(v).matchAll(/\{console:(--[a-z0-9-]+)\}/g)) if (!(ref[1] in consoleTokens())) faults.push(`look ${n} ${k} names console:${ref[1]}, which the pin does not carry`);
      for (const ref of String(v).matchAll(/\{finish:(--[a-z0-9-]+)\}/g)) {
        const fin = loadPin().finish[finishOf(look)];
        if (!fin) faults.push(`look ${n} ${k} names finish:${ref[1]} and the look's --finish '${finishOf(look)}' is no console finish`);
        else if (!(ref[1] in fin)) faults.push(`look ${n} ${k} names finish:${ref[1]}, which the ${finishOf(look)} finish of the pin does not carry`);
      }
      for (const ref of String(v).matchAll(/\{(--[a-z0-9-]+)\}/g)) {
        if (ref[1] !== '--enclosure' && !names.has(ref[1])) faults.push(`look ${n} ${k} names ${ref[1]}, which is no colour role`);
        if (ref[1] === '--enclosure' && TEXT_PLATES.includes(k)) faults.push(`look ${n} ${k} carries text and names the enclosure: its contrast is not the roles' to hold`);
      }
    }
  }
  return faults;
}

/** The role names, in the order the file declares them. */
export const roleNames = (doc = loadRoles()) => doc.roles.map((r) => r.name);

/** The tokens tools/look.json lists: every role, then the font. */
export const LOOK_TOKENS = Object.freeze([...roleNames(), ...NOT_COLOURS]);

function assertSound(doc) {
  const faults = checkRoles(doc);
  if (faults.length) throw new Error(`look: schema/look-roles.json: ${faults.join('; ')}`);
}

/** tools/look.json's text: the look the defaults are, every role at its default, and the font. */
export function emitLook(doc = loadRoles(), looks = loadLooks()) {
  assertSound(doc);
  const lf = checkLooks(looks, doc);
  if (lf.length) throw new Error(`look: schema/modgui-looks.json: ${lf.join('; ')}`);
  const tokens = {};
  for (const r of doc.roles) tokens[r.name] = r.default;
  for (const f of NOT_COLOURS) tokens[f] = doc.font[f];
  const pin = loadPin();
  const look = {
    $comment: 'GENERATED — DO NOT EDIT BY HAND. The one public source of the vintage tokens: every colour role of schema/look-roles.json at its one default, and the font. The MOD GUI wears it (tools/modgui-gen.mjs), the renderer reads it, the Zynthian UI maps its colours from it and the console\'s tokens.css is held to it. Regenerate: `node tools/look.mjs`, then commit the result.',
    ...Object.fromEntries(LOOK_AXES.map((a) => [a, doc.look[a]])),
    tokens,
    setting: looks.setting,
    tierSetting: looks.tierSetting,
    // the console's pinned relief, base paint and metal, for the drawings (the knob and the fader SVGs name them) beside the looks
    console: { commit: pin.source.commit, defaultFinish: pin.defaultFinish, tokens: consoleTokens(pin), finish: pin.finish },
    // the scenes of the drawings the looks name (--knob): the one source, read by the film painter and the renderer
    drawings: looks.drawings ?? {},
    looks: Object.fromEntries(Object.entries(looks.looks).map(([n, l]) => [n, Object.fromEntries(Object.entries(l).map(([k, v]) => [k, String(v).replace(/\{console:default-finish\}/g, pin.defaultFinish).replace(/\{console:(--[a-z0-9-]+)\}/g, (_m, t) => consoleTokens(pin)[t]).replace(/\{finish:(--[a-z0-9-]+)\}/g, (_m, t) => pin.finish[finishOf(l, pin)][t])]))])),
  };
  return `${JSON.stringify(look, null, 2)}\n`;
}

/** renderer/src/look_roles.h's text: the role names read_look requires of every look. */
export function emitRoleHeader(doc = loadRoles()) {
  assertSound(doc);
  const names = doc.roles.map((r) => r.name);
  return `/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * GENERATED — DO NOT EDIT BY HAND: the colour roles of schema/look-roles.json, which read_look (view.c) requires of
 * every look its host passes, each a #rrggbb. Regenerate: \`node tools/look.mjs\`, then commit the result.
 */
#ifndef OMX_PANEL_LOOK_ROLES_H
#define OMX_PANEL_LOOK_ROLES_H

#define OMX_LOOK_ROLE_COUNT ${names.length}

static const char *const omx_look_roles[OMX_LOOK_ROLE_COUNT] = {
${names.map((n) => `    "${n}",`).join('\n')}
};

#endif
`;
}

function main(argv) {
  const doc = loadRoles();
  const outs = [[LOOK_JSON, emitLook(doc), 'tools/look.json']];
  // the renderer's sources are the tree's, not the package's: an installed omx-panel checks its look.json alone, and says so
  if (existsSync(dirname(ROLE_HEADER))) outs.push([ROLE_HEADER, emitRoleHeader(doc), 'renderer/src/look_roles.h']);
  else console.log('look: no renderer/src in this tree: its role header is the source tree\'s to check');
  if (argv.includes('--check')) {
    let stale = 0;
    for (const [file, want, name] of outs) {
      let have = '';
      try {
        have = readFileSync(file, 'utf8');
      } catch {
        // missing: stale below
      }
      if (have !== want) console.error(`look: STALE ${name} (run \`node tools/look.mjs\`)`), stale++;
    }
    if (stale) process.exit(1);
    console.log(`look: ${outs.map((o) => o[2]).join(' and ')} ${outs.length > 1 ? 'are' : 'is'} what schema/look-roles.json gives`);
    return;
  }
  for (const [file, want, name] of outs) writeFileSync(file, want), console.log(`look: wrote ${name}`);
}

if (isMain(import.meta.url)) main(process.argv.slice(2));
