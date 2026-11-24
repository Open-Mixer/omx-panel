// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * store-entry.mjs — the one codec between a derivation and the descriptions store (docs/descriptions-store.md 3.4 and
 * section 6, lane 3). `entryOf` makes the JSON `omx-panel-store put` takes from what `describeStored` keeps and the port
 * groups' verdict; `storedOf` turns an `omx-panel-store get` answer back into what `describeFromStored` reads. A control's
 * id is stored as text: a CLAP parameter id (an integer) as its decimal digits, read back as a number for a `clap` key; an
 * LV2 id is its symbol. `withStoredGroups` gives a descriptor's ungrouped controls the stored groups, so the sections a
 * surface draws and the groups a host sees are one grouping.
 */
import { keyOf } from './panel-description.mjs';
import { panelCodes } from './vocabulary.mjs';

/** The PANEL_GROUP_RULES word of each inference rule, by its number (tools/group-infer.mjs RULES; 0: a repeated instance's group). */
const RULE = panelCodes('PANEL_GROUP_RULES');
export const WORD_OF_RULE = Object.freeze([RULE.instance, RULE.own, RULE.designation, RULE.name, RULE.unit, RULE.index, RULE.modgui]);
/** Each PANEL_GROUP_RULES word back to its inference rule's number. */
export const RULE_OF_WORD = new Map(WORD_OF_RULE.map((w, n) => [w, n]));
/** The fingerprint of a refused derivation: no layout was made, and the column is NOT NULL. */
export const NO_LAYOUT = '0'.repeat(64);

/** The verdict as the store holds it; null for a plugin with none (a CLAP plugin states no port groups). */
export function verdictEntry(verdict) {
  if (!verdict) return null;
  const groups = verdict.outcome === 'grouped' ? verdict.groups : [];
  return {
    outcome: verdict.outcome,
    reason: verdict.reason ?? null,
    groups: groups.map((g) => {
      const rule = WORD_OF_RULE[g.rule];
      if (rule === undefined) throw new Error(`store-entry: group ${g.symbol} was made by rule ${g.rule}, which has no PANEL_GROUP_RULES word`);
      return { symbol: g.symbol, name: g.name, display_priority: g.displayPriority, rule, declared: g.rule === 1 ? 1 : 0, ports: [...g.ports] };
    }),
  };
}

/** A control id as the store's text column holds it: an integer (a CLAP id) as its decimal digits, a string as it is. */
function idText(c) {
  if (Number.isInteger(c.id) && c.id >= 0) return String(c.id);
  if (typeof c.id === 'string' && c.id !== '') return c.id;
  throw new Error(`store-entry: control ${c.symbol} has the id ${JSON.stringify(c.id)}, neither a CLAP parameter id nor an LV2 symbol`);
}

/**
 * The entry `omx-panel-store put` takes for one derivation. `derived` is `describeStored`'s answer: a stored derivation
 * is the body, the controls and the repeated groups; a refused one is stored as its refusing code.
 * @param {{ derived: { stored: any, refusals: { code: string }[] }, verdict?: any, source: string, rules: number, madeBy: string }} o
 */
export function entryOf({ derived, verdict = null, source, rules, madeBy }) {
  const common = { edited: 0, made_by: madeBy, rules, source, verdict: verdictEntry(verdict) };
  const { stored, refusals } = derived;
  if (!stored) {
    const refused = refusals.at(-1)?.code;
    if (!refused) throw new Error('store-entry: a derivation with no description and no refusal');
    return { ...common, family: 'none', fingerprint: NO_LAYOUT, body: null, groups: null, refused, controls: [] };
  }
  return {
    ...common,
    family: stored.body.family,
    fingerprint: stored.body.fingerprint,
    body: stored.body,
    groups: stored.groups,
    refused: null,
    controls: stored.controls.map((c) => ({ symbol: c.symbol, key: c.key, id: idText(c), group_key: c.group_key, governed: c.governed })),
  };
}

/**
 * What `describeFromStored` reads, from an `omx-panel-store get` answer of a key of `format`; null for a refused entry
 * (it has no description to serve).
 * @param {any} answer
 * @param {'clap' | 'lv2'} format
 * @param {string} [plugin] the plugin's id, named in a refusal
 */
export function storedOf(answer, format, plugin) {
  if (!answer || answer.body === null) return null;
  const id = format === 'clap' ? (t) => Number(t) : (t) => t;
  return {
    plugin,
    body: answer.body,
    groups: answer.groups_json,
    controls: answer.controls.map((c, ordinal) => ({ ordinal, symbol: c.symbol, key: c.key, id: id(c.id), group_key: c.group_key, governed: c.governed })),
  };
}

/**
 * `descriptor` with each control that states no group placed in its stored group (3.4): a grouped verdict's group, by
 * the control's port symbol. A control that states a group keeps it.
 */
export function withStoredGroups(descriptor, verdict) {
  if (verdict?.outcome !== 'grouped') return descriptor;
  const nameOf = new Map(verdict.groups.flatMap((g) => g.ports.map((p) => [p, g.name])));
  return {
    ...descriptor,
    controls: descriptor.controls.map((c) => (c.group?.length || !nameOf.has(keyOf(c)) ? c : { ...c, group: [nameOf.get(keyOf(c))] })),
  };
}
