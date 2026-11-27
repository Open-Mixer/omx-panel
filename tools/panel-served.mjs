// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * panel-served.mjs — the panel a plugin SERVES, read as the declared panel tools/panel-description.mjs lays out (#43).
 *
 * `org.openmixer.panel-description/1` as omx-clap-scan --json prints it and plugin-hostd-probe panel copies it, byte
 * for byte (plugin-hostd docs/panel.md): `{ plugin, panel: { family, fingerprint, sections, controls, roles, displays,
 * placementDefaults } }`, or that `panel` object alone. plugin-hostd stays a host that copies bytes and interprets
 * nothing; the panel format is this package's, so the served form is read here and nowhere else. Its tables name a
 * parameter by id; the declared form names it by the descriptor's key (keyOf: a symbol, else p<id> for a CLAP
 * parameter), so the descriptor the panel is read against is what maps them.
 *
 *   sections     each a declared section `{ key, label, controls }`: the control rows of that section, in row order
 *   roles        `{ <role>: <key> }`; an indexed role (a band's) every index in order
 *   widgets      a row's widget word other than `auto`
 *   visibleWhen  a row with a visibleParamId: `{ param, values }`, the values the mask's set bits
 *   displays     a display of source `family` is the section's graph (transfer_curve: dynamics-curve, or transfer-curve
 *                for the drive family; eq_response: eq-curve; time_response: decay-envelope for the reverb family, else
 *                delay-taps); one of source `meters` is derived from the descriptor's
 *                meters as any describe does, and is not carried
 *   placementDefaults are the descriptor's own travel defaults, and are not carried; the fingerprint is the plugin's
 *                and is not read: describe computes its own over what it lays out
 *
 * A table the scan refused (`{ refused, count, max }`), a `panel` of null (a plugin that serves none) and a parameter id
 * no control of the descriptor has are refused by name. A display's kind and source are the numbers the scan prints,
 * the x-codes of PANEL_DISPLAY_KINDS and PANEL_DISPLAY_SOURCES (a word is read as it is).
 */

import { panelWords } from './vocabulary.mjs';

/** Whether `x` is a served panel: the probe's file, or the scan's `panel` object (a fingerprint and control rows by paramId). */
export function isServedPanel(x) {
  if (!x || typeof x !== 'object') return false;
  if ('plugin' in x && 'panel' in x) return x.panel === null || isServedPanel(x.panel);
  return 'fingerprint' in x && Array.isArray(x.controls) && x.controls.every((c) => c && typeof c === 'object' && 'paramId' in c);
}

/**
 * A served display's kind or source as this package's word: omx-clap-scan prints the number (omx-clap-core keeps no
 * panel words, the vocabulary sorting pass), which is the word's x-code in the panel domain's `item`; a scan that prints
 * the word is read as it is. A number the item has no word for is refused by name.
 */
function servedWord(item, value, where, what) {
  if (typeof value === 'string') return value;
  const word = Number.isInteger(value) ? panelWords(item)[value] : undefined;
  if (word === undefined) throw new Error(`${where}: a ${what} ${value}, which is no word of ${item}`);
  return word;
}

/** A family display's section graph, by the family the panel states. */
const GRAPH_OF_DISPLAY = {
  transfer_curve: (family) => (family === 'drive' ? 'transfer-curve' : 'dynamics-curve'), eq_response: () => 'eq-curve',
  time_response: (family) => (family === 'reverb' ? 'decay-envelope' : 'delay-taps'),
};

/**
 * The declared panel the served panel `x` states, over `descriptor` (its parameters, keyed by `keyOf`); `indexedRoles`
 * are the roles that repeat by index (role-table.mjs INDEXED_ROLES). Throws, naming the fault, for what the header lists.
 */
export function declaredFromServed(x, descriptor, { where = 'served panel', keyOf, indexedRoles = [] }) {
  const p = 'plugin' in x && 'panel' in x ? x.panel : x;
  if (p === null) throw new Error(`${where}: the plugin serves no panel (panel is null)`);
  const table = (name) => {
    const t = p[name];
    if (t && !Array.isArray(t) && typeof t === 'object' && t.refused) throw new Error(`${where}: the served ${name} table was refused by the scan (${t.refused}: ${t.count} entries, at most ${t.max})`);
    return Array.isArray(t) ? t : [];
  };
  const byId = new Map(descriptor.controls.map((c) => [c.id, keyOf(c)]));
  const key = (id, what) => {
    if (!byId.has(id)) throw new Error(`${where}: ${what} names parameter ${id}, which the descriptor does not have`);
    return byId.get(id);
  };
  const sections = table('sections'), controls = table('controls'), roles = table('roles'), displays = table('displays');
  const family = typeof p.family === 'string' ? p.family : undefined;
  for (const c of controls) {
    if (!(Number.isInteger(c.section) && c.section >= 0 && c.section < sections.length)) throw new Error(`${where}: a control row names section ${c.section}, which the served sections table does not have`);
  }
  const out = sections.map((s, i) => ({ key: s.key, label: s.label, controls: controls.filter((c) => c.section === i).map((c) => key(c.paramId, `a control row of section '${s.key}'`)) }));
  const widgets = {}, visibleWhen = {};
  for (const c of controls) {
    const k = key(c.paramId, 'a control row');
    if (typeof c.widget === 'string' && c.widget !== 'auto') widgets[k] = c.widget;
    if (c.visibleParamId !== null && c.visibleParamId !== undefined) {
      const mask = BigInt(`0x${c.visibleMask || '0'}`);
      const values = [];
      for (let v = 0n; v < 64n; v++) if (mask & (1n << v)) values.push(Number(v));
      visibleWhen[k] = { param: key(c.visibleParamId, `the visibility of '${k}'`), values };
    }
  }
  const bound = {};
  for (const r of roles) {
    const k = key(r.paramId, `the ${r.role} role`);
    if (indexedRoles.includes(r.role)) (bound[r.role] ??= [])[r.index] = k;
    else if (r.index === 0) bound[r.role] = k;
    else throw new Error(`${where}: the ${r.role} role is served at index ${r.index}, and only a band role repeats by index`);
  }
  for (const [role, syms] of Object.entries(bound)) {
    if (Array.isArray(syms) && syms.some((s) => s === undefined)) throw new Error(`${where}: the ${role} role's indices have a gap`);
  }
  for (const d of displays) {
    if (servedWord('PANEL_DISPLAY_SOURCES', d.source, where, 'display source') !== 'family') continue;
    const kind = servedWord('PANEL_DISPLAY_KINDS', d.kind, where, 'family display of kind');
    const graph = GRAPH_OF_DISPLAY[kind]?.(family);
    if (!graph) throw new Error(`${where}: a family display of kind ${kind} has no section graph here`);
    const s = out[d.section];
    if (!s) throw new Error(`${where}: a display names section ${d.section}, which the served sections table does not have`);
    s.graph = graph;
  }
  return { ...(family ? { family } : {}), sections: out, roles: bound, ...(Object.keys(widgets).length ? { widgets } : {}), ...(Object.keys(visibleWhen).length ? { visibleWhen } : {}) };
}
