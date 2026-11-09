#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * look.mjs — the colour roles of a panel (schema/look-roles.json, the one-panel spec,
 * §7.10) and the two files derived from them:
 *
 *   · tools/look.json, the values the MOD GUI wears (tools/modgui-gen.mjs) and the renderer reads from its data
 *     directory: every role at its one default, and the font;
 *   · renderer/src/look_roles.h, the role list the renderer's read_look requires of every look a host passes.
 *
 * The roles are declared once; the values are each host's (the console's tokens.css, Zynthian's palette table). Nothing
 * here resolves a host's cascade: the hand copy of the console's tokens that lived in tools/look/tokens.css is gone.
 *
 * Usage: `node tools/look.mjs [--check]` — `--check` writes nothing and fails when a derived file is not what
 * schema/look-roles.json gives, or when the role file breaks a rule of checkRoles.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = dirname(fileURLToPath(import.meta.url));
export const ROLES_JSON = join(TOOLS, '..', 'schema', 'look-roles.json');
export const LOOK_JSON = join(TOOLS, 'look.json');
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

/** The role names, in the order the file declares them. */
export const roleNames = (doc = loadRoles()) => doc.roles.map((r) => r.name);

/** The tokens tools/look.json lists: every role, then the font. */
export const LOOK_TOKENS = Object.freeze([...roleNames(), ...NOT_COLOURS]);

function assertSound(doc) {
  const faults = checkRoles(doc);
  if (faults.length) throw new Error(`look: schema/look-roles.json: ${faults.join('; ')}`);
}

/** tools/look.json's text: the look the defaults are, every role at its default, and the font. */
export function emitLook(doc = loadRoles()) {
  assertSound(doc);
  const tokens = {};
  for (const r of doc.roles) tokens[r.name] = r.default;
  for (const f of NOT_COLOURS) tokens[f] = doc.font[f];
  const look = {
    $comment: 'GENERATED — DO NOT EDIT BY HAND. The look the MOD GUI wears (tools/modgui-gen.mjs) and the renderer reads: every colour role of schema/look-roles.json at its one default, and the font. Regenerate: `node tools/look.mjs`, then commit the result.',
    ...Object.fromEntries(LOOK_AXES.map((a) => [a, doc.look[a]])),
    tokens,
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
