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
import { nameTokens, placeableControls, readPluginPorts, SECTION_WORDS } from './group-infer.mjs';

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
const UNIT_TOKENS = { '%': 'pc', percent: 'pc', db: 'db', hz: 'hz', khz: 'khz', ms: 'ms', s: 's', oct: 'oct', coef: 'coef', '': '' };
export function unitToken(unit) {
  if (unit == null) return '';
  const tail = String(unit).replace(/^.*[#/]/, '').toLowerCase();
  return UNIT_TOKENS[tail] ?? tail;
}

// ---------------------------------------------------------------------------------------------------------------
// The inputs: one control shape from either reader.

/**
 * @typedef {{ symbol: string, name: string, index: number, kind: 'toggle' | 'choice' | 'travel', unit: string,
 *   min?: number, max?: number, options?: number, path: string[] }} Control
 */

/**
 * The controls of an omx-contract descriptor. `panel`, a declared panel (`{ sections: [{ key, label, controls }] }`),
 * wins over the controls' own `group` paths: it is the plugin's later word on its layout.
 * @returns {Control[]}
 */
export function controlsOfDescriptor(descriptor, { panel } = {}) {
  const sectionOf = new Map();
  for (const s of panel?.sections ?? []) for (const sym of s.controls ?? []) sectionOf.set(typeof sym === 'string' ? sym : sym.symbol, s.label ?? s.key);
  return (descriptor.controls ?? [])
    .filter((c) => ['toggle', 'choice', 'travel'].includes(c.kind) && !c.hidden && c.symbol)
    .map((c, i) => ({
      symbol: c.symbol,
      name: c.name ?? c.symbol,
      index: Number.isInteger(c.id) ? c.id : i,
      kind: c.kind,
      unit: unitToken(c.travel?.unit),
      ...(c.kind === 'travel' ? { min: c.travel?.min, max: c.travel?.max } : {}),
      ...(c.kind === 'choice' ? { options: (c.ids ?? c.labels ?? []).length } : {}),
      path: panel ? (sectionOf.has(c.symbol) ? [sectionOf.get(c.symbol)] : []) : [c.group ?? []].flat(),
    }))
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
      path: g ? [g.name ?? g.symbol ?? p.group] : [],
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The words.

const runs = (symbol) => String(symbol).match(/\d+/g) ?? [];
/** A symbol's stem: its one number replaced by `#` (`b3_freq` -> `b#_freq`). */
const stemOf = (symbol) => String(symbol).replace(/\d+/g, '#');
const isNum = (t) => /^\d+$/.test(t);
/** The numbers a name prints as whole words ("EQ 3 Freq" -> [3]). */
const nameNumbers = (name) => nameTokens(name).filter(isNum).map(Number);

/** The canonical parameter roles of a repeated group, the EQ's rows in this order. */
export const ROLE_ORDER = ['type', 'slope', 'freq', 'gain', 'q'];
const ON_WORDS = new Set(['on', 'enable', 'enabled', 'active', 'power']);
const OFF_WORDS = new Set(['bypass', 'mute', 'off']);
const ROLE_WORDS = {
  type: ['type', 'shape'],
  slope: ['slope'],
  freq: ['frequency', 'freq', 'f', 'fc', 'cutoff'],
  gain: ['gain', 'g', 'level'],
  q: ['q', 'quality', 'bandwidth', 'bw', 'resonance', 'reso'],
};

/**
 * A parameter's role from its words (the name's words less the number and the words every parameter of the instance
 * shares) and its kind and unit: `on` / `off` (the instance's head toggle), one of ROLE_ORDER, or null.
 */
export function roleOf(words, kind, unit) {
  const w = words.map((x) => x.toLowerCase());
  if (kind === 'toggle') {
    if (w.length === 0 || w.every((x) => ON_WORDS.has(x) || SECTION_WORDS.has(x))) return 'on';
    if (w.every((x) => OFF_WORDS.has(x))) return 'off';
    return null;
  }
  if (unit === FREQUENCY_UNIT) return 'freq';
  for (const role of ROLE_ORDER) if (w.some((x) => ROLE_WORDS[role].includes(x))) return role;
  if (unit === 'db') return 'gain';
  return null;
}

/** An EQ: its parameters hold a frequency, a gain, and a Q or a type. */
const isEqRoles = (roles) => roles.has('freq') && roles.has('gain') && (roles.has('q') || roles.has('type'));

/** The EQ's edge columns: the filters outermost, the shelves inside them, the bands between. */
export const EDGES = [
  { edge: 'hpf', side: 'left', words: ['hpf', 'hp', 'highpass', 'high pass', 'lowcut', 'low cut', 'locut'] },
  { edge: 'lowshelf', side: 'left', words: ['lowshelf', 'low shelf', 'ls', 'loshelf'] },
  { edge: 'highshelf', side: 'right', words: ['highshelf', 'high shelf', 'hs', 'hishelf'] },
  { edge: 'lpf', side: 'right', words: ['lpf', 'lp', 'lowpass', 'low pass', 'highcut', 'high cut', 'hicut'] },
];

/** The edge a control's name opens with, and how many words that takes; null for none. */
function edgeOf(name) {
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
 *   parameters: string[], family?: 'eq' | null, rows?: Row[], instances?: Instance[], edges?: Edge[],
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
  const first = (g) => Math.min(...memberSymbols(g).map((s) => ordered.find((c) => c.symbol === s)?.index ?? Infinity));
  return { groups: groups.filter((g) => memberSymbols(g).length > 0).sort((a, b) => first(a) - first(b)) };
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
  const numbered = b.controls.filter((c) => runs(c.symbol).length >= 1);
  const two = numbered.filter((c) => runs(c.symbol).length >= 2);
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
    const r = runs(c.symbol);
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
  const r = runs(c.symbol);
  if (r.length >= 1) return stemOf(c.symbol);
  return nameTokens(c.name).filter((t) => !isNum(t)).join(' ').toLowerCase();
}

function indexedInstances(key, b) {
  const numbered = b.controls.filter((c) => runs(c.symbol).length >= 1);
  /** @type {Map<string, Map<number, Control>>} */
  const stems = new Map();
  for (const c of numbered) {
    if (runs(c.symbol).length !== 1) continue;
    const s = stemOf(c.symbol);
    if (!stems.has(s)) stems.set(s, new Map());
    stems.get(s).set(Number(runs(c.symbol)[0]), c);
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
  const roles = new Map(complete.map((k) => { const c = first.bySlot.get(k); return [k, roleOf(paramWords(c), c.kind, c.unit)]; }));
  const head = complete.find((k) => roles.get(k) === 'on') ?? complete.find((k) => roles.get(k) === 'off') ?? null;
  const roleSet = new Set(roles.values());
  const family = isEqRoles(roleSet) ? 'eq' : null;
  const rowKey = (k) => (family === 'eq' && roles.get(k) && roles.get(k) !== 'on' && roles.get(k) !== 'off' && [...roles.values()].filter((r) => r === roles.get(k)).length === 1 ? roles.get(k) : k);
  let rowSlots = complete.filter((k) => k !== head);
  if (family === 'eq') {
    const rank = (k) => { const i = ROLE_ORDER.indexOf(rowKey(k)); return i === -1 ? ROLE_ORDER.length : i; };
    rowSlots = rowSlots.map((k, i) => ({ k, i })).sort((x, y) => rank(x.k) - rank(y.k) || x.i - y.i).map((x) => x.k);
  }
  const rows = rowSlots.map((k) => ({ key: rowKey(k), label: paramWords(first.bySlot.get(k)).join(' ') || k, role: roles.get(k) ?? null }));

  const word = common.length > 0
    ? wordsOf(first.bySlot.get(complete[0])).filter((w) => common.includes(w.toLowerCase())).join(' ')
    : (complete.flatMap((k) => wordsOf(first.bySlot.get(k))).find((w) => SECTION_WORDS.has(w.toLowerCase())) ?? (family === 'eq' ? 'Band' : ''));
  const instances = slotted.map((s, i) => {
    const shown = [...printed[i]][0] ?? s.n;
    return {
      index: s.n,
      label: s.label ?? (word ? `${capital(word)} ${shown}` : `${shown}`),
      on: head ? { symbol: s.bySlot.get(head).symbol, sense: roles.get(head) } : null,
      parameters: Object.fromEntries(rowSlots.map((k) => [rowKey(k), s.bySlot.get(k).symbol])),
    };
  });
  const partialSyms = slotted.flatMap((s) => partial.filter((k) => s.bySlot.has(k)).map((k) => s.bySlot.get(k)));
  const params = [...loose, ...partialSyms].sort((x, y) => x.index - y.index).map((c) => c.symbol);
  return { key, label: b.label, source, kind: 'repeated', family, parameters: params, rows, instances, _controls: b.controls };
}

const capital = (w) => w.charAt(0).toUpperCase() + w.slice(1);

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
    const fromLoose = new Set(g.parameters.filter((s) => take(all.find((c) => c.symbol === s))));
    const eaten = new Set();
    for (const other of groups) {
      if (other === g || other.kind !== 'list' || other.source !== 'none' || !other.label) continue;
      const cs = other.parameters.map((s) => all.find((c) => c.symbol === s));
      const es = new Set(cs.map((c) => edgeOf(c.name)?.edge ?? null));
      if (es.size === 1 && !es.has(null)) { cs.forEach(take); eaten.add(other); }
    }
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
    g.parameters = g.parameters.filter((s) => !(fromLoose.has(s) && used.has(s)));
    for (const other of eaten) if (other.parameters.every((s) => used.has(s))) other.parameters = [];
    g.edges = edges;
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
 * instances as rows, else `rows` (the instances as rows, transposed). Each instance's header carries its on/off.
 * @param {Group} g a repeated group of inferGroupModel's
 */
export function matrixOf(g) {
  if (g.kind !== 'repeated') throw new Error(`group-model: '${g.key}' is a ${g.kind}, not a repeated group`);
  const left = (g.edges ?? []).filter((e) => EDGES.find((x) => x.edge === e.edge).side === 'left');
  const right = (g.edges ?? []).filter((e) => EDGES.find((x) => x.edge === e.edge).side === 'right');
  const heads = [
    ...left.map((e) => ({ key: e.edge, label: e.label, on: e.on, edge: e.edge, parameters: e.parameters })),
    ...[...g.instances].sort((a, b) => a.index - b.index).map((i) => ({ key: `${g.key}#${i.index}`, label: i.label, on: i.on, edge: null, parameters: i.parameters })),
    ...right.map((e) => ({ key: e.edge, label: e.label, on: e.on, edge: e.edge, parameters: e.parameters })),
  ];
  const orientation = g.family === 'eq' || heads.length >= g.rows.length ? 'columns' : 'rows';
  const grid = g.rows.map((r) => heads.map((h) => h.parameters[r.key] ?? null));
  const strip = (h) => ({ key: h.key, label: h.label, on: h.on, edge: h.edge });
  return orientation === 'columns'
    ? { orientation, columns: heads.map(strip), rows: g.rows, cells: grid }
    : { orientation, columns: g.rows, rows: heads.map(strip), cells: heads.map((_, c) => g.rows.map((_, r) => grid[r][c])) };
}
