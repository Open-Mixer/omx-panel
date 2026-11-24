// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * group-model.mjs — a plugin's controls as groups -> repeated instances -> parameters, and the matrix each surface draws
 * a repeated group with (docs/group-model.md; omx-panel#61). Pure: controls in, a model out. The one library the
 * console's processing view (through the served panel description), the Zynthian panel builder (through
 * `omx-panel describe` and the lv2-complement bundle) and modgui-gen read; none of them infers a repeat on its own.
 *
 * The sources, in order of trust:
 *   a  the plugin's own declaration: a declared panel's sections, a descriptor control's `group` path, an LV2 pg:group;
 *   b  the number in the control's symbol (`b3_freq`, `eq3Freq`, `f_3`, `freq3`): one instance per number;
 *   c  the units, kinds and ranges of a parameter, matched across the instances (b's candidates and a's alike).
 * An inference that does not hold is never drawn as a guessed matrix: the group is a plain list and carries a REASON code.
 */
import { controlKind } from './control-kind.mjs';
import { lv2Symbol, nameTokens, placeableControls, readPluginPorts, SECTION_WORDS } from './group-infer.mjs';
import { EQ_WORDS } from './meaning-infer.mjs';
import { keyOf } from './panel-description.mjs';
import { DYNAMICS_WORDS } from './role-table.mjs';

// ---------------------------------------------------------------------------------------------------------------
// The reason codes: the only ways a candidate repeated group falls back to a plain list (docs/group-model.md, "Uncertain").

export const REASONS = {
  'two-indices': 'more than half the numbered controls carry two numbers in their symbol: a grid of two indices, not one row of instances',
  'ragged-instances': 'more of the numbered controls sit in a parameter some instances lack than in parameters every instance has',
  'one-parameter': 'every instance holds one parameter: a row of one repeated control, not a matrix',
  'index-gap': 'the instance numbers are not consecutive',
  'kind-mismatch': 'one parameter is a toggle, a choice or a travel in one instance and another kind in another',
  'unit-mismatch': 'one parameter has a different unit in two instances',
  'range-mismatch': 'one parameter, not a frequency, spans a different range in two instances',
  'name-number-disagrees': "the numbers in the controls' names do not number the instances one to one",
  'declared-index-conflict': "a declared instance's controls carry a symbol number that is not the declared one, nor one less",
};

/** The frequency unit: the one parameter whose range may differ by instance (a low band and a high band). */
const FREQUENCY_UNIT = 'hz';

/** A unit as a short token: LV2's units:hz and a descriptor's "Hz" are both `hz`. */
const UNIT_TOKENS = { '%': 'pc', percent: 'pc', db: 'db', hz: 'hz', khz: 'khz', ms: 'ms', s: 's', oct: 'oct', coef: 'coef', none: '', '': '' };
export function unitToken(unit) {
  if (unit == null) return '';
  const tail = String(unit).replace(/^.*[#/]/, '').toLowerCase();
  return UNIT_TOKENS[tail] ?? tail;
}

// ---------------------------------------------------------------------------------------------------------------
// The inputs: one control shape from either reader.

/**
 * @typedef {{ symbol: string, name: string, numbered?: string, index: number, kind: 'toggle' | 'choice' | 'travel', unit: string,
 *   min?: number, max?: number, options?: number, integer?: boolean, path: string[] }} Control
 */

/**
 * The controls of an omx-contract descriptor, each under the key the layout names it by (`keyOf`: its symbol, else an LV2
 * control's id, else a CLAP parameter's id as `p<id>`), so a descriptor a scan wrote, which states no `symbol`, is read as
 * the authored one is. A control keyed by a CLAP id carries `numbered`, its name: the id's digits number no instance.
 * `panel`, a declared panel (`{ sections: [{ key, label, controls }] }`), wins over the controls' own `group` paths: it
 * is the plugin's later word on its layout.
 * @returns {Control[]}
 */
export function controlsOfDescriptor(descriptor, { panel } = {}) {
  const sectionOf = new Map();
  for (const s of panel?.sections ?? []) for (const sym of s.controls ?? []) sectionOf.set(typeof sym === 'string' ? sym : sym.symbol, s.label ?? s.key);
  return (descriptor.controls ?? [])
    .filter((c) => ['toggle', 'choice', 'travel'].includes(c.kind) && !c.hidden && keyOf(c))
    .map((c, i) => {
      const symbol = keyOf(c);
      const written = c.symbol ?? (typeof c.id === 'string' ? c.id : null);
      // a CLAP scan states no toggle: a stepped travel of the two positions 0 and 1 is one (a band's On, an edge's On), by
      // the one rule of docs/control-kind.md
      const kind = c.kind === 'travel' && c.travel
        ? controlKind({ scale: c.travel.scale, min: c.travel.min, max: c.travel.max, ...(c.travel.step !== undefined ? { step: c.travel.step } : {}) }).kind === 'toggle' ? 'toggle' : 'travel'
        : c.kind;
      return {
        symbol,
        name: c.name ?? symbol,
        ...(written === null ? { numbered: c.name ?? '' } : {}),
        index: Number.isInteger(c.id) ? c.id : i,
        kind,
        unit: unitToken(c.travel?.unit),
        ...(kind === 'travel' ? { min: c.travel?.min, max: c.travel?.max, ...(c.travel?.step === 1 ? { integer: true } : {}) } : {}),
        ...(c.kind === 'choice' ? { options: (c.ids ?? c.labels ?? []).length } : {}),
        path: panel ? (sectionOf.has(symbol) ? [sectionOf.get(symbol)] : []) : [c.group ?? []].flat(),
      };
    })
    .sort((a, b) => a.index - b.index);
}

/** The controls of LV2 plugin `uri` in parsed Turtle (tools/turtle-read.mjs): its placeable ports, a pg:group's name as the path. */
export function controlsOfLv2(triples, uri) {
  const plugin = readPluginPorts(triples, uri);
  return placeableControls(plugin.ports).map((p) => {
    const g = p.group ? plugin.groups?.[p.group] : null;
    return {
      symbol: p.symbol,
      name: p.name,
      index: p.index,
      kind: p.kind ?? 'travel',
      // a unit the plugin defines on a blank node is known by its label, the same text on every port that uses it
      unit: p.unit?.startsWith('_:') ? unitToken(p.unitLabel ?? '') : unitToken(p.unit),
      ...(p.min !== undefined ? { min: p.min } : {}),
      ...(p.max !== undefined ? { max: p.max } : {}),
      ...(p.options !== undefined ? { options: p.options } : {}),
      ...(p.integer ? { integer: true } : {}),
      path: g ? [g.name ?? g.symbol ?? p.group] : [],
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The words.

/** The text a control's instance number is read from: its symbol, or its name where its key is a CLAP id (`numbered`). */
const written = (c) => String(c.numbered ?? c.symbol);
/** The numbers a control's symbol carries (`b3_freq` -> ['3']). */
const runs = (c) => written(c).match(/\d+/g) ?? [];
/** A control's stem: its symbol with `#` for the number (`b3_freq` -> `b#_freq`). */
const stemOf = (c) => written(c).replace(/\d+/g, '#');
const isNum = (t) => /^\d+$/.test(t);
/** The numbers a name prints as whole words ("EQ 3 Freq" -> [3]). */
const nameNumbers = (name) => nameTokens(name).filter(isNum).map(Number);

/**
 * Each numbered control's instance number and its stem, over one bucket (#97). A control whose text carries one number has it.
 * Controls whose text carries more ("Band 3 Gain 2", a CLAP name with a "2nd" slope) are taken by their shape, the text with
 * every number written `#`: when exactly one position varies across the shape's controls, that position is the instance
 * number and the others are part of the parameter's name; when none or more than one does (a grid: "Send 1 Bus 2" over every
 * send and bus), none of them has a number, and the bucket's two-indices check sees them.
 * @returns {Map<Control, { stem: string, n: number }>}
 */
function instanceNumbers(controls) {
  const out = new Map();
  /** the text with the number at `p` written `#` and the others kept */
  const at = (c, p) => { let i = -1; return written(c).replace(/\d+/g, (m) => (++i === p ? '#' : m)); };
  const shapes = new Map();
  for (const c of controls) {
    const r = runs(c);
    if (r.length === 1) out.set(c, { stem: stemOf(c), n: Number(r[0]) });
    else if (r.length > 1) shapes.set(stemOf(c), [...(shapes.get(stemOf(c)) ?? []), c]);
  }
  for (const cs of shapes.values()) {
    const varying = runs(cs[0]).map((_x, p) => p).filter((p) => new Set(cs.map((c) => runs(c)[p])).size >= 2);
    if (varying.length === 1) for (const c of cs) out.set(c, { stem: at(c, varying[0]), n: Number(runs(c)[varying[0]]) });
  }
  return out;
}

/** The canonical parameter roles of a repeated group, the EQ's rows in this order. */
export const ROLE_ORDER = ['freq', 'gain', 'slope', 'q', 'type'];
const ON_WORDS = new Set(['on', 'enable', 'enabled', 'active', 'power']);
const OFF_WORDS = new Set(['bypass', 'mute', 'off']);
/** The role words: meaning-infer.mjs's EQ_WORDS, the one table (omx-panel#75). */
const ROLE_WORDS = EQ_WORDS.roles;

/**
 * A parameter's role from its words (the name's words less the number and the words every parameter of the instance
 * shares) and its kind and unit: `on` / `off` (the instance's head toggle), one of ROLE_ORDER, or null.
 */
export function roleOf(words, kind, unit) {
  return claimOf(words, kind, unit).role;
}

/**
 * A parameter's role and what claims it: `byWord` when its words name the role (S8: that wins), false when only its unit
 * does (a dB control is a gain, a hertz control a frequency, unless another control of the group is called that).
 */
function claimOf(words, kind, unit) {
  const w = words.map((x) => x.toLowerCase());
  if (kind === 'toggle') {
    if (w.length === 0 || w.every((x) => ON_WORDS.has(x) || SECTION_WORDS.has(x))) return { role: 'on', byWord: true };
    if (w.every((x) => OFF_WORDS.has(x))) return { role: 'off', byWord: true };
    return { role: null, byWord: false };
  }
  if (unit === FREQUENCY_UNIT) return { role: 'freq', byWord: w.some((x) => ROLE_WORDS.freq.includes(x)) };
  for (const role of ROLE_ORDER) if (w.some((x) => ROLE_WORDS[role].includes(x))) return { role, byWord: true };
  // a weaker word (the table's fallback: a bandwidth or a width for a Q, a mode for a type) claims as a unit does: a control
  // whose words name the role outright wins it, and the weaker one keeps a row of its own
  for (const role of ROLE_ORDER) if (w.some((x) => EQ_WORDS.fallback[role]?.includes(x))) return { role, byWord: false };
  if (unit === 'db') return { role: 'gain', byWord: false };
  return { role: null, byWord: false };
}

/** An EQ: its parameters hold a frequency, a gain, and a Q or a type. */
const isEqRoles = (roles) => roles.has('freq') && roles.has('gain') && (roles.has('q') || roles.has('type'));

/** The EQ's edge columns, the filters outermost, the shelves inside them, the bands between: meaning-infer.mjs's EQ_WORDS edges, the one table. */
export const EDGES = EQ_WORDS.edges;

/** The edge a control's name opens with, and how many words that takes; null for none. */
export function edgeOf(name) {
  const t = nameTokens(name).map((x) => x.toLowerCase());
  for (const e of EDGES) for (const w of e.words) {
    const ws = w.split(' ');
    if (ws.every((x, i) => t[i] === x)) return { edge: e.edge, take: ws.length };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// The model.

/**
 * @typedef {{ symbol: string, sense: 'on' | 'off' }} Head
 * @typedef {{ index: number, label: string, on: Head | null, parameters: Record<string, string> }} Instance
 * @typedef {{ edge: string, label: string, on: Head | null, parameters: Record<string, string> }} Edge
 * @typedef {{ key: string, label: string, role: string | null }} Row
 * @typedef {{ key: string, label: string | null, source: 'declared' | 'indexed' | 'none', kind: 'repeated' | 'list',
 *   parameters: string[], family?: 'eq' | null, rows?: Row[], instances?: Instance[], edges?: Edge[], count?: { symbol: string } | null,
 *   reason?: keyof typeof REASONS, detail?: string }} Group
 */

const labelNumber = (label) => /^(.*?)\s*(\d+)$/.exec(String(label));

/**
 * The model of a plugin's controls: its groups, in the order of their first control, each a plain list or a repeated
 * group of instances (low to high) holding the same parameters.
 * @param {Control[]} controls
 * @returns {{ groups: Group[] }}
 */
export function inferGroupModel(controls) {
  const ordered = [...controls].sort((a, b) => a.index - b.index);
  // the buckets: one per top-level declared group, one for the undeclared controls
  /** @type {Map<string, { label: string | null, declared: boolean, controls: Control[] }>} */
  const buckets = new Map();
  for (const c of ordered) {
    const key = c.path[0] ?? '';
    if (!buckets.has(key)) buckets.set(key, { label: key === '' ? null : key, declared: key !== '', controls: [] });
    buckets.get(key).controls.push(c);
  }
  // declared siblings numbered one series ("Output 1" ... "Output 8") are one declared group of instances
  const series = new Map();
  for (const [key, b] of buckets) {
    const m = b.declared && labelNumber(key);
    if (m && m[1]) series.set(m[1], [...(series.get(m[1]) ?? []), key]);
  }
  for (const [stem, keys] of series) {
    if (keys.length < 2 || buckets.has(stem)) continue;
    const merged = { label: stem, declared: true, controls: keys.flatMap((k) => buckets.get(k).controls.map((c) => ({ ...c, path: [stem, ...c.path] }))) };
    const at = [...buckets.keys()].indexOf(keys[0]);
    const entries = [...buckets.entries()].filter(([k]) => !keys.includes(k));
    entries.splice(at, 0, [stem, merged]);
    buckets.clear();
    for (const [k, v] of entries) buckets.set(k, v);
  }

  const groups = [...buckets.entries()].map(([key, b]) => bucketGroup(key, b));
  attachEdges(groups, buckets);
  const bySymbol = new Map(ordered.map((c) => [c.symbol, c]));
  for (const g of groups) if (g.kind === 'repeated') g.count = countOf(g, bySymbol);
  // a group sits where its first control does; the controls an EQ took as its edges from beside do not move it
  const first = (g) => Math.min(...memberSymbols({ ...g, edges: [] }).map((s) => bySymbol.get(s)?.index ?? Infinity));
  return { groups: groups.filter((g) => memberSymbols(g).length > 0).sort((a, b) => first(a) - first(b)) };
}

/**
 * The instances of a served matrix, one per head (an EQ's HPF and LPF included), left to right: the head and the symbols it
 * holds in the order a screen shows them, its on/off first, then its cells from the top row down (the head row and an empty
 * cell are none). The one order of an instance: the page cut (`describe`) and the port groups (`instanceGroups`) both read it.
 * `slots` is the same order with the places kept: the on/off's place (where any head has one), then one place per row, null
 * where this head has no control there, so place `k` is the same parameter in every instance; the nulls after an instance's
 * last control are left off.
 * @returns {{ head: { label: string, on: { symbol: string } | null, edge: string | null }, symbols: string[], slots: (string | null)[] }[]}
 */
export function matrixInstances(served) {
  const headed = served.heads.some((h) => h.on);
  return served.heads.map((head, j) => {
    const slots = [...(headed ? [head.on?.symbol ?? null] : []), ...served.cells.flatMap((row, i) => (served.rows[i].head ? [] : [row[j] ?? null]))];
    while (slots.length > 0 && slots.at(-1) === null) slots.pop();
    return { head, symbols: [...new Set(slots.filter((x) => typeof x === 'string'))], slots };
  });
}

/**
 * The instances of the repeated groups a plugin does not declare instance by instance (source `indexed`, no declared group
 * above them), each one a port group: docs/group-model.md, P2. `{ symbol, name, ports }`, the ports in `matrixInstances`'s
 * order; the name the instance's label (a bare number is "Section 3"), the symbol that name as an LV2 symbol. A group the
 * plugin declares is its own and gives none.
 * @param {{ groups: Group[] }} model
 * @returns {{ symbol: string, name: string, ports: string[] }[]}
 */
export function instanceGroups(model) {
  return model.groups.filter((g) => g.kind === 'repeated' && g.source === 'indexed' && g.key === '').flatMap((g) => matrixInstances(servedMatrix(g)).map(({ head, symbols }) => {
    const name = /^\d+$/.test(head.label) ? `Section ${head.label}` : head.label;
    return { symbol: lv2Symbol(name), name, ports: symbols };
  }));
}

/** Every symbol a group holds: its own parameters, its instances' and its edges'. */
export function memberSymbols(g) {
  return [
    ...g.parameters,
    ...(g.instances ?? []).flatMap((i) => [...(i.on ? [i.on.symbol] : []), ...Object.values(i.parameters)]),
    ...(g.edges ?? []).flatMap((e) => [...(e.on ? [e.on.symbol] : []), ...Object.values(e.parameters)]),
  ];
}

const list = (key, b, extra = {}) => ({ key, label: b.label, source: 'none', kind: 'list', parameters: b.controls.map((c) => c.symbol), ...extra });
const refuse = (key, b, source, reason, detail) => list(key, b, { source, reason, detail });

/** One bucket's group: the declared instances (a), else the symbols' numbers (b); either checked by (c). */
function bucketGroup(key, b) {
  const numbered = b.controls.filter((c) => runs(c).length >= 1);
  const resolved = instanceNumbers(b.controls);
  const two = numbered.filter((c) => runs(c).length >= 2 && !resolved.has(c));
  const declaredAny = b.controls.some((c) => c.path.length >= 1);
  if (numbered.length > 0 && two.length * 2 > numbered.length) {
    return refuse(key, b, declaredAny ? 'declared' : 'indexed', 'two-indices', `${two.length} of ${numbered.length} numbered controls carry two numbers (${two[0].symbol})`);
  }
  const declared = b.controls.some((c) => c.path.length >= 2 && labelNumber(c.path[1])?.[2] !== undefined);
  return declared ? declaredInstances(key, b) : indexedInstances(key, b);
}

function declaredInstances(key, b) {
  /** @type {Map<number, { label: string, controls: Control[] }>} */
  const byN = new Map();
  const loose = [];
  for (const c of b.controls) {
    const m = c.path.length >= 2 ? labelNumber(c.path[1]) : null;
    if (!m) { loose.push(c); continue; }
    const n = Number(m[2]);
    if (!byN.has(n)) byN.set(n, { label: c.path[1], controls: [] });
    byN.get(n).controls.push(c);
  }
  if (byN.size < 2) return list(key, b, { source: 'declared' });
  // a declared instance's symbols carry its number, or one less (a symbol counting from 0), the same offset throughout
  const offsets = new Set();
  for (const [n, inst] of byN) for (const c of inst.controls) {
    const r = runs(c);
    if (r.length === 1) offsets.add(n - Number(r[0]));
  }
  if (offsets.size > 1 || [...offsets].some((o) => o !== 0 && o !== 1)) {
    return refuse(key, b, 'declared', 'declared-index-conflict', `symbol numbers sit at ${[...offsets].sort().join(', ')} from the declared ones`);
  }
  const slotted = [...byN.entries()].map(([n, inst]) => ({ n, label: inst.label, bySlot: new Map(inst.controls.map((c) => [slotKey(c), c])) }));
  return instancesGroup(key, b, 'declared', slotted, loose);
}

/** A parameter's key across instances: its symbol's stem, else its name less numbers. */
function slotKey(c) {
  const r = runs(c);
  if (r.length >= 1) return stemOf(c);
  return nameTokens(c.name).filter((t) => !isNum(t)).join(' ').toLowerCase();
}

function indexedInstances(key, b) {
  /** @type {Map<string, Map<number, Control>>} */
  const stems = new Map();
  const numberOf = instanceNumbers(b.controls);
  for (const c of b.controls) {
    if (!numberOf.has(c)) continue;
    const { stem: s, n } = numberOf.get(c);
    if (!stems.has(s)) stems.set(s, new Map());
    stems.get(s).set(n, c);
  }
  const repeated = [...stems.entries()].filter(([, m]) => m.size >= 2);
  if (repeated.length === 0) return list(key, b);
  const ns = [...new Set(repeated.flatMap(([, m]) => [...m.keys()]))].sort((x, y) => x - y);
  const slotted = ns.map((n) => ({ n, label: null, bySlot: new Map(repeated.filter(([, m]) => m.has(n)).map(([s, m]) => [s, m.get(n)])) }));
  const inInstances = new Set(repeated.flatMap(([, m]) => [...m.values()]));
  return instancesGroup(key, b, 'indexed', slotted, b.controls.filter((c) => !inInstances.has(c)));
}

/**
 * The checks every candidate passes (c), then the instances, their head toggle and their rows.
 * @param {{ n: number, label: string | null, bySlot: Map<string, Control> }[]} slotted
 */
function instancesGroup(key, b, source, slotted, loose) {
  const ns = slotted.map((s) => s.n).sort((x, y) => x - y);
  const allSlots = [...new Set(slotted.flatMap((s) => [...s.bySlot.keys()]))];
  const complete = allSlots.filter((k) => slotted.every((s) => s.bySlot.has(k)));
  const partial = allSlots.filter((k) => !complete.includes(k));
  const count = (ks) => slotted.reduce((n, s) => n + ks.filter((k) => s.bySlot.has(k)).length, 0);
  if (count(partial) > count(complete)) {
    return refuse(key, b, source, 'ragged-instances', `${count(partial)} controls in parameters some of ${slotted.length} instances lack, ${count(complete)} in parameters all hold`);
  }
  if (complete.length < 2) return refuse(key, b, source, 'one-parameter', `${slotted.length} instances of ${complete[0] ?? 'nothing'}`);
  if (source === 'indexed' && ns.some((n, i) => i > 0 && n !== ns[i - 1] + 1)) return refuse(key, b, source, 'index-gap', `instances ${ns.join(', ')}`);
  for (const k of complete) {
    const cs = slotted.map((s) => s.bySlot.get(k));
    const kinds = new Set(cs.map((c) => c.kind));
    if (kinds.size > 1) return refuse(key, b, source, 'kind-mismatch', `${k}: ${[...kinds].join(', ')}`);
    const units = new Set(cs.map((c) => c.unit));
    if (units.size > 1) return refuse(key, b, source, 'unit-mismatch', `${k}: ${[...units].join(', ')}`);
    if (cs[0].unit !== FREQUENCY_UNIT && cs[0].kind !== 'toggle') {
      const spans = new Set(cs.map((c) => (c.kind === 'choice' ? `${c.options}` : `${c.min}..${c.max}`)));
      if (spans.size > 1) return refuse(key, b, source, 'range-mismatch', `${k}: ${[...spans].join(', ')}`);
    }
  }
  // each instance's names print one number, a different one per instance
  const printed = slotted.map((s) => new Set(complete.flatMap((k) => { const ns2 = nameNumbers(s.bySlot.get(k).name); return ns2.length === 1 ? ns2 : []; })));
  const flat = printed.flatMap((p) => [...p]);
  if (printed.some((p) => p.size > 1) || new Set(flat).size !== flat.length) {
    return refuse(key, b, source, 'name-number-disagrees', printed.map((p, i) => `${slotted[i].n}: ${[...p].join('/') || '-'}`).join('; '));
  }

  // the words every complete parameter of the first instance shares are the instance's own ("Band 1"), not the parameter's
  const first = slotted[0];
  const wordsOf = (c) => nameTokens(c.name).filter((t) => !isNum(t));
  const common = complete.map((k) => wordsOf(first.bySlot.get(k)).map((w) => w.toLowerCase())).reduce((a, w) => a.filter((x) => w.includes(x)));
  const paramWords = (c) => wordsOf(c).filter((w) => !common.includes(w.toLowerCase()));
  // S8: a role a control's words claim wins over one its unit claims
  const claims = new Map(complete.map((k) => { const c = first.bySlot.get(k); return [k, claimOf(paramWords(c), c.kind, c.unit)]; }));
  const wordRoles = new Set([...claims.values()].filter((x) => x.byWord && x.role).map((x) => x.role));
  const roles = new Map([...claims].map(([k, x]) => [k, x.byWord || !wordRoles.has(x.role) ? x.role : null]));
  const head = complete.find((k) => roles.get(k) === 'on') ?? complete.find((k) => roles.get(k) === 'off') ?? null;
  const roleSet = new Set(roles.values());
  // a band is an EQ's when a word claims its Q or type outright, or when words claim its frequency and gain and the Q or type
  // is a fallback word (fil4's Bandwidth); a mode or a width beside a frequency or a gain only a unit claims is not
  const byWord = (role) => [...claims.values()].some((x) => x.byWord && x.role === role);
  // ... unless a dynamics word sits beside the fallback Q or type: a frequency, gain, threshold, ratio and mode is a compressor band
  const dynamic = complete.some((k) => paramWords(first.bySlot.get(k)).some((w) => DYNAMICS_WORDS.includes(w.toLowerCase())));
  const named = byWord('q') || byWord('type') || (byWord('freq') && byWord('gain') && !dynamic);
  const family = isEqRoles(roleSet) && named ? 'eq' : null;
  const rowKey = (k) => (family === 'eq' && roles.get(k) && roles.get(k) !== 'on' && roles.get(k) !== 'off' && [...roles.values()].filter((r) => r === roles.get(k)).length === 1 ? roles.get(k) : k);
  let rowSlots = complete.filter((k) => k !== head);
  if (family === 'eq') {
    const rank = (k) => { const i = ROLE_ORDER.indexOf(rowKey(k)); return i === -1 ? ROLE_ORDER.length : i; };
    rowSlots = rowSlots.map((k, i) => ({ k, i })).sort((x, y) => rank(x.k) - rank(y.k) || x.i - y.i).map((x) => x.k);
  }
  const rows = rowSlots.map((k) => ({ key: rowKey(k), label: paramWords(first.bySlot.get(k)).join(' ') || k, role: roles.get(k) ?? null }));

  // S5: a stem held by all but one instance is a row with an empty cell, when each control it holds is that instance's own
  // (its name prints the one number the instance's other names print) and S4 holds over the instances that hold it
  const lone = partial.filter((k) => {
    const holders = slotted.map((s, i) => ({ s, i })).filter(({ s }) => s.bySlot.has(k));
    if (holders.length !== slotted.length - 1 || holders.length < 2) return false;
    const cs = holders.map(({ s }) => s.bySlot.get(k));
    if (!holders.every(({ i }, h) => { const ns2 = nameNumbers(cs[h].name); return ns2.length === printed[i].size && ns2.every((n) => printed[i].has(n)); })) return false;
    if (new Set(cs.map((c) => c.kind)).size > 1 || new Set(cs.map((c) => c.unit)).size > 1) return false;
    if (cs[0].unit === FREQUENCY_UNIT || cs[0].kind === 'toggle') return true;
    return new Set(cs.map((c) => (c.kind === 'choice' ? `${c.options}` : `${c.min}..${c.max}`))).size === 1;
  });
  for (const k of lone) {
    const c = slotted.find((s) => s.bySlot.has(k)).bySlot.get(k);
    rowSlots.push(k);
    rows.push({ key: k, label: paramWords(c).join(' ') || k, role: null });
  }

  const word = common.length > 0
    ? wordsOf(first.bySlot.get(complete[0])).filter((w) => common.includes(w.toLowerCase())).join(' ')
    : (complete.flatMap((k) => wordsOf(first.bySlot.get(k))).find((w) => SECTION_WORDS.has(w.toLowerCase())) ?? (family === 'eq' ? 'Band' : ''));
  const instances = slotted.map((s, i) => {
    const shown = [...printed[i]][0] ?? s.n;
    return {
      index: s.n,
      label: s.label ?? (word ? `${capital(word)} ${shown}` : `${shown}`),
      on: head ? { symbol: s.bySlot.get(head).symbol, sense: roles.get(head) } : null,
      parameters: Object.fromEntries(rowSlots.filter((k) => s.bySlot.has(k)).map((k) => [rowKey(k), s.bySlot.get(k).symbol])),
    };
  });
  const partialSyms = slotted.flatMap((s) => partial.filter((k) => !lone.includes(k) && s.bySlot.has(k)).map((k) => s.bySlot.get(k)));
  const params = [...loose, ...partialSyms].sort((x, y) => x.index - y.index).map((c) => c.symbol);
  return { key, label: b.label, source, kind: 'repeated', family, parameters: params, rows, instances, count: null, _controls: b.controls };
}

const capital = (w) => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * S10: the group's own whole-number travel from 0 or 1 up to the number of its instances, named by a word the group is
 * called by (singular or plural): the control that sets how many instances are live. `{ symbol }` or null.
 */
function countOf(g, bySymbol) {
  const stem = (w) => w.toLowerCase().replace(/s$/, '');
  const called = new Set([g.label ?? '', ...g.instances.map((i) => i.label)].flatMap((t) => nameTokens(t)).filter((t) => !isNum(t)).map(stem));
  for (const symbol of g.parameters) {
    const c = bySymbol.get(symbol);
    if (c?.kind !== 'travel' || !c.integer || ![0, 1].includes(c.min) || c.max !== g.instances.length) continue;
    if (nameTokens(c.name).some((t) => !isNum(t) && called.has(stem(t)))) return { symbol };
  }
  return null;
}

/**
 * The EQ's edges: a high-pass, a low shelf, a high shelf and a low-pass found beside an EQ's bands, each a column at its
 * side. An edge comes from the EQ's own loose parameters, or from a declared group that holds that edge alone.
 */
function attachEdges(groups, buckets) {
  for (const g of groups) {
    if (g.kind !== 'repeated' || g.family !== 'eq') continue;
    const all = [...buckets.values()].flatMap((b) => b.controls);
    const byEdge = new Map();
    const take = (c) => {
      const e = edgeOf(c.name);
      if (!e) return false;
      if (!byEdge.has(e.edge)) byEdge.set(e.edge, []);
      byEdge.get(e.edge).push({ c, words: nameTokens(c.name).slice(e.take).filter((t) => !isNum(t)) });
      return true;
    };
    // S9: every control whose name opens with an edge word, from the EQ's own parameters and from any list group
    const sources = [g, ...groups.filter((other) => other !== g && other.kind === 'list')];
    for (const src of sources) for (const s of src.parameters) take(all.find((c) => c.symbol === s));
    const edges = [];
    for (const { edge } of EDGES) {
      const members = byEdge.get(edge);
      if (!members) continue;
      const parameters = {};
      let on = null;
      for (const { c, words } of members) {
        const role = roleOf(words, c.kind, c.unit);
        if ((role === 'on' || role === 'off') && !on) on = { symbol: c.symbol, sense: role };
        else parameters[role && !(role in parameters) ? role : `${edge}:${words.join(' ').toLowerCase() || c.symbol}`] = c.symbol;
      }
      if (!('freq' in parameters)) continue; // an edge is a filter or a shelf: it has a frequency
      edges.push({ edge, label: edgeLabel(edge, members[0].c.name), on, parameters });
    }
    if (edges.length === 0) continue;
    const used = new Set(edges.flatMap((e) => [...(e.on ? [e.on.symbol] : []), ...Object.values(e.parameters)]));
    for (const src of sources) src.parameters = src.parameters.filter((s) => !used.has(s));
    g.edges = edges;
    // the owner's order puts an edge's slope on the gain row, one aligned row, when the bands hold no slope row of their own
    if (!g.rows.some((r) => r.key === 'slope')) {
      for (const e of edges) {
        if (!('slope' in e.parameters) || 'gain' in e.parameters) continue;
        e.parameters.gain = e.parameters.slope;
        delete e.parameters.slope;
        e.captions = { ...e.captions, gain: capital('slope') }; // the cell is the slope, and says so (omx-panel#122)
      }
    }
    // the rows an edge brings that no band holds go after the bands' rows
    for (const e of edges) for (const k of Object.keys(e.parameters)) if (!g.rows.some((r) => r.key === k)) g.rows.push({ key: k, label: capital(k.includes(':') ? k.split(':')[1] : k), role: ROLE_ORDER.includes(k) ? k : null });
    const rank = (r) => { const i = ROLE_ORDER.indexOf(r.key); return i === -1 ? ROLE_ORDER.length : i; };
    g.rows = g.rows.map((r, i) => ({ r, i })).sort((x, y) => rank(x.r) - rank(y.r) || x.i - y.i).map((x) => x.r);
  }
  for (const g of groups) delete g._controls;
}

/** An edge's header: the words its first control's name opens with ("HPF", "Highpass", "Lowshelf"). */
function edgeLabel(edge, name) {
  const e = EDGES.find((x) => x.edge === edge);
  const t = nameTokens(name);
  const n = e.words.map((w) => w.split(' ')).find((ws) => ws.every((x, i) => t[i]?.toLowerCase() === x))?.length ?? 1;
  return t.slice(0, n).join(' ');
}

// ---------------------------------------------------------------------------------------------------------------
// The layout every surface applies to a repeated group.

/**
 * A repeated group as the matrix a surface draws: `columns` and `rows` with `cells[row][column]` a control symbol or
 * null (that column has no such parameter), never flowed. An EQ is always `columns` (bands left to right low to high,
 * the high-pass leftmost, the low-pass rightmost); another repeated group is `columns` when it has at least as many
 * instances as rows, else `rows` (the instances as rows, transposed). Each instance's header carries its on/off and its
 * `ordinal` (its place among the instances, null for an edge). A group with a `count` draws its first `count` instances
 * only, at `values[count.symbol]` (L6): the others are left out and leave no gap; a value left out draws every instance.
 * @param {Group} g a repeated group of inferGroupModel's
 * @param {{ values?: Record<string, number> }} [options]
 */
export function matrixOf(g, { values = {} } = {}) {
  if (g.kind !== 'repeated') throw new Error(`group-model: '${g.key}' is a ${g.kind}, not a repeated group`);
  const left = (g.edges ?? []).filter((e) => EDGES.find((x) => x.edge === e.edge).side === 'left');
  const right = (g.edges ?? []).filter((e) => EDGES.find((x) => x.edge === e.edge).side === 'right');
  const live = Number(values[g.count?.symbol]);
  const instances = [...g.instances].sort((a, b) => a.index - b.index).map((i, ordinal) => ({ ...i, ordinal }))
    .filter((i) => !(Number.isFinite(live) && i.ordinal >= live));
  const heads = [
    ...left.map((e) => ({ key: e.edge, label: e.label, on: e.on, edge: e.edge, ordinal: null, parameters: e.parameters, captions: e.captions })),
    ...instances.map((i) => ({ key: `${g.key}#${i.index}`, label: i.label, on: i.on, edge: null, ordinal: i.ordinal, parameters: i.parameters })),
    ...right.map((e) => ({ key: e.edge, label: e.label, on: e.on, edge: e.edge, ordinal: null, parameters: e.parameters, captions: e.captions })),
  ];
  const orientation = g.family === 'eq' || heads.length >= g.rows.length ? 'columns' : 'rows';
  const grid = g.rows.map((r) => heads.map((h) => h.parameters[r.key] ?? null));
  const strip = (h) => ({ key: h.key, label: h.label, on: h.on, edge: h.edge, ordinal: h.ordinal, ...(h.captions ? { captions: h.captions } : {}) });
  return orientation === 'columns'
    ? { orientation, columns: heads.map(strip), rows: g.rows, cells: grid }
    : { orientation, columns: g.rows, rows: heads.map(strip), cells: heads.map((_, c) => g.rows.map((_, r) => grid[r][c])) };
}

/**
 * Where a repeated group's matrix goes among a surface's sections (`sections`: `{ id, symbols }` in drawing order). The
 * sections that hold the group's instances and own parameters are its home: they must hold nothing else, and the first is
 * where the matrix goes (the others are folded into it). The sections that hold only the group's edges, taken from
 * beside the EQ, are donors: they give their members to the matrix and keep the rest. Null when the group cannot be
 * placed whole: a member no section draws, or a home section that holds another control beside the group.
 * @returns {{ home: unknown, folded: unknown[], donors: unknown[], members: Set<string> } | null}
 */
export function placeMatrix(g, sections) {
  const members = new Set(memberSymbols(g));
  const edgeOnly = new Set((g.edges ?? []).flatMap((e) => [...(e.on ? [e.on.symbol] : []), ...Object.values(e.parameters)]));
  const drawn = new Set(sections.flatMap((s) => s.symbols));
  if ([...members].some((sym) => !drawn.has(sym))) return null;
  const holds = (s, set) => s.symbols.some((sym) => set.has(sym));
  const home = sections.filter((s) => s.symbols.some((sym) => members.has(sym) && !edgeOnly.has(sym)));
  if (home.length === 0 || home.some((s) => s.symbols.some((sym) => !members.has(sym)))) return null;
  const donors = sections.filter((s) => !home.includes(s) && holds(s, members));
  return { home: home[0].id, folded: home.slice(1).map((s) => s.id), donors: donors.map((s) => s.id), members };
}

/**
 * The served matrix (docs/group-model.md, "The served matrix"): the ONE shape `omx-panel describe` serves and every surface
 * (the console, modgui-gen, the C renderer, the Zynthian builder) reads and never recomputes. `heads` are every instance and
 * edge along one axis, `rows` the head row (always first, L3: `On` when any head has an on/off, else a caption row
 * labelled '') then the parameters in the owner's order, a row carrying `labels` where a cell's parameter is not the row's, `cells[row][head]` a symbol as `symbolOf` gives it, or null; `title` the
 * group's label (else `title`, the label of the section that holds it); `count` only where no visibleWhen rule governs the
 * instances (`governs(symbol)`): such a group keeps every instance's cell and its rules hide them live.
 * @param {Group} g a repeated group of inferGroupModel's
 * @param {{ symbolOf?: (s: string) => string, governs?: (s: string) => boolean, title?: string, countDefault?: number | null }} [options]
 */
export function servedMatrix(g, { symbolOf = (x) => x, governs = () => false, title, countDefault = null } = {}) {
  const m = matrixOf(g);
  const [heads, lines] = m.orientation === 'columns' ? [m.columns, m.rows] : [m.rows, m.columns];
  const at = (h, l) => (m.orientation === 'columns' ? m.cells[l][h] : m.cells[h][l]);
  const sym = (x) => (x === null ? null : symbolOf(x));
  const headed = heads.some((h) => h.on);
  const governed = g.count && g.instances.some((i) => Object.values(i.parameters).some((x) => governs(x)));
  return {
    orientation: m.orientation,
    title: g.label ?? title ?? null,
    heads: heads.map((h) => ({ label: h.label, on: h.on ? { symbol: symbolOf(h.on.symbol), sense: h.on.sense } : null, edge: h.edge })),
    rows: [{ label: headed ? 'On' : '', head: true }, ...lines.map((l) => {
      // a cell holding a parameter other than the row's (an EQ edge's slope in the gain row, L2) is captioned as itself
      const labels = heads.map((h) => h.captions?.[l.key] ?? null);
      return labels.some((x) => x !== null) ? { label: l.label, labels } : { label: l.label };
    })],
    cells: [heads.map((h) => (h.on ? symbolOf(h.on.symbol) : null)), ...lines.map((_, l) => heads.map((_h, h) => sym(at(h, l))))],
    ...(g.count && !governed ? { count: { symbol: symbolOf(g.count.symbol), default: countDefault ?? null } } : {}),
  };
}

/**
 * The ONE section merge after `placeMatrix` (docs/group-model.md, "The served matrix"): `sections` in drawing order, each
 * `{ section, home }` kept: the home is the matrix's section; a folded or donor section stays only while `holdsAfter(s)`
 * (it still holds something once the group's members have moved); every other section stays as it is. The description,
 * its `--layout` and the MOD GUI face all merge by it.
 */
export function mergedSections(placed, sections, { idOf, holdsAfter }) {
  return sections.flatMap((section) => {
    const id = idOf(section);
    if (id === placed.home) return [{ section, home: true }];
    if (placed.folded.includes(id) || placed.donors.includes(id)) return holdsAfter(section) ? [{ section, home: false }] : [];
    return [{ section, home: false }];
  });
}

/**
 * L6 on a served matrix: the indices of the heads a surface draws with the count at `value` (the served `count.default`
 * when left out): every edge, and the first `value` instances in order; every head when the matrix has no count or the
 * value is not a number.
 */
export function drawnHeads(served, value = served.count?.default) {
  const live = served.count ? Number(value ?? NaN) : NaN;
  let instance = 0;
  const out = [];
  served.heads.forEach((h, i) => {
    const keep = h.edge || !Number.isFinite(live) || instance < live;
    if (!h.edge) instance++;
    if (keep) out.push(i);
  });
  return out;
}

/**
 * L7, the visible-column rule, the one every language applies (the C renderer's omx_panel_view_visible_columns answers the
 * same vector, test/fixtures/group-model/visible-columns.json): of a SERVED matrix, how many columns a surface `width` wide
 * shows at `column` each: as many as fit, at least one, at most the columns it is drawn with (the drawn heads in `columns`;
 * the rows, the head row among them, in `rows`).
 */
export function visibleColumns(served, { width, column, count } = {}) {
  const across = served.orientation === 'columns' ? drawnHeads(served, count).length : served.rows.length;
  return Math.min(across, Math.max(1, Math.floor(width / column)));
}

/** L7: the drawn head `n` (clamped) an encoder surface edits: its head and its cells in row order (the head row first), an empty cell null. */
export function selectedColumn(served, n, { count } = {}) {
  const drawn = drawnHeads(served, count);
  const at = Math.min(drawn.length - 1, Math.max(0, Math.trunc(n)));
  const h = drawn[at];
  return { ...served.heads[h], index: at, cells: served.cells.map((r) => r[h]) };
}
