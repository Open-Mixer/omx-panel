// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * meaning-infer.mjs — the EQ bands a plugin leaves unnamed, inferred from what it states (the one-panel spec Q9, §3.1):
 * the controls no descriptor word and no override gives a meaning, grouped into bands by their symbols, names and
 * units. Beside group-infer.mjs, with the same kind of verdict: an answer, or "cannot with confidence". Pure: a
 * descriptor's controls in, a verdict out. A heuristic over names is a derivation, never stored, so it is not an
 * override; every role it yields carries `inferred: true`, and a surface draws the mark.
 *
 * Only a control with no `meaning` is read; `unknown`, the word a scan writes for a control whose meaning neither format states,
 * is no meaning. A control the descriptor gives a meaning stands as the descriptor says.
 *
 * A Q control whose travel reaches zero and whose default is zero is no band's Q (a band's Q is above zero): it plays no role, so a width
 * beside it is the band's Q, as LSP's equalizers carry a `q_N` at 0 beside the `w_N` width in octaves the band runs on.
 *
 * The verdict is one of:
 *   { outcome: 'inferred', roles }                  the band roles, `{ role, index, symbol, unit, inferred: true,
 *                                                   shape? }`; `unit` is the contract token the inference reads the
 *                                                   control in (`hz`, `db` or `coef`, `oct` or `none`);
 *   { outcome: 'no-confident-inference', reason }   nothing is bound.
 *
 * A band shape no parameter selects is the `shape` of its `band_freq` role; a `band_type` role carries `shapes` where
 * the choice's labels are read (`shapesOf`): the curve function receives shapes, never a label to parse.
 */

/** The band shapes a curve function knows, and `-` for a choice value that is none of them. */
export const SHAPES = ['off', 'bell', 'lowshelf', 'highshelf', 'highpass', 'lowpass', 'notch'];

/**
 * The EQ's words, ONE table (omx-panel#75): each parameter role's name words and each edge's (the filters and shelves an
 * EQ's outer columns are). This file owns it; the band inference here and the group model's rows and edges
 * (tools/group-model.mjs, docs/group-model.md S8, S9) both read it, and neither keeps a list of its own. A word of two
 * letters is an abbreviation: in the band inference an edge's is read as a symbol prefix (`hp_freq`), its longer words in the names.
 */
export const EQ_WORDS = Object.freeze({
  roles: Object.freeze({
    type: Object.freeze(['filter type', 'filtertype', 'type', 'shape', 'ft', 'fm']),
    slope: Object.freeze(['slope']),
    freq: Object.freeze(['frequency', 'freq', 'cutoff', 'hz', 'fc', 'f']),
    gain: Object.freeze(['boost', 'gain', 'level', 'cut', 'g']),
    q: Object.freeze(['resonance', 'quality', 'q']),
  }),
  // the weaker words: a role the band inference reads when no word above claims it (a `mode` choice, a `width` in octaves), and
  // the group model does not (beside a `type` or a `q`, a mode or a width is a parameter of its own)
  // the role words name a Q outright (q, quality, resonance): a control called so is a band's Q before a bandwidth beside it
  fallback: Object.freeze({ type: Object.freeze(['mode']), q: Object.freeze(['bandwidth', 'reso', 'bw', 'width', 'w']) }),
  edges: Object.freeze([
    Object.freeze({ edge: 'hpf', shape: 'highpass', side: 'left', words: Object.freeze(['hpf', 'hp', 'highpass', 'high pass', 'hi pass', 'lowcut', 'low cut', 'locut']) }),
    Object.freeze({ edge: 'lowshelf', shape: 'lowshelf', side: 'left', words: Object.freeze(['lowshelf', 'low shelf', 'lo shelf', 'loshelf', 'ls']) }),
    Object.freeze({ edge: 'highshelf', shape: 'highshelf', side: 'right', words: Object.freeze(['highshelf', 'high shelf', 'hi shelf', 'hishelf', 'hs']) }),
    Object.freeze({ edge: 'lpf', shape: 'lowpass', side: 'right', words: Object.freeze(['lpf', 'lp', 'lowpass', 'low pass', 'lo pass', 'highcut', 'high cut', 'hicut']) }),
  ]),
});

/** A table word as a pattern: its spaces any run of spaces (`sep`). */
const wordPattern = (w, sep = '\\s*') => w.split(' ').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(sep);
/** Whether `h` holds one of `words` as a whole word. */
const holdsWord = (h, words) => new RegExp(`\\b(${words.map((w) => wordPattern(w)).join('|')})\\b`).test(h);
const edgeShape = (shape) => EQ_WORDS.edges.find((e) => e.shape === shape);
/** Whether `text` holds one of an edge's long words, anywhere (its abbreviations are not read in text). */
const holdsEdge = (text, e, sep) => new RegExp(e.words.filter((w) => w.length > 2).map((w) => wordPattern(w, sep)).join('|')).test(text);

/** The label of a control: its name, else its label, else its symbol. */
const nameOf = (c) => c.name ?? c.label ?? '';
const symbolOf = (c) => c.symbol ?? (typeof c.id === 'string' ? c.id : Number.isInteger(c.id) ? `p${c.id}` : nameOf(c));
const unitOf = (c) => (c.travel?.unit ?? '').toLowerCase();

/** What a band is keyed by: the symbol, or for a CLAP parameter, whose id is a number and says nothing of its band, its name
 * ("Band 1 Frequency" and "Band 1 Gain" are one band, p7 and p8 are not). */
const keyNameOf = (c) => (c.symbol === undefined && Number.isInteger(c.id) && nameOf(c) ? nameOf(c) : symbolOf(c));

/** Symbol + name, underscores flattened to spaces, lowercased: the match haystack. */
const hay = (c) => `${symbolOf(c)} ${nameOf(c)}`.replace(/_/g, ' ').toLowerCase();

/** A gain or level control that trims the whole plugin, not one band. */
const isGlobalGain = (h) => /(gain|level)/.test(h) && /\b(in|out|input|output|make ?up|master|global|dry|wet)\b/.test(h);

/** A meaning the descriptor states: `unknown` (a scan's word for none) is none. */
export const statesMeaning = (c) => typeof c.meaning === 'string' && c.meaning !== '' && c.meaning !== 'unknown';

/** A Q no band runs on: not in octaves, its travel reaching down to zero and coming up there. */
const degenerateQ = (c) => unitOf(c) !== 'oct' && typeof c.travel?.min === 'number' && c.travel.min <= 0 && typeof c.travel?.default === 'number' && c.travel.default <= 0;

/** The band role a control plays, from its metadata alone; null for a control that is not a band control. */
export function bandRoleOf(c) {
  if (c.hidden || c.readonly || statesMeaning(c)) return null;
  const h = hay(c);
  const sym = symbolOf(c).toLowerCase();
  const unit = unitOf(c);
  const choice = c.kind === 'choice';
  const R = EQ_WORDS.roles;
  if (isGlobalGain(h)) return null;
  if (c.kind === 'travel') {
    if (unit === 'hz' || holdsWord(h, R.freq) || /^f[ _]?\d+$/.test(sym) || /^f[lh]$/.test(sym)) return 'freq';
  }
  const F = EQ_WORDS.fallback;
  if (choice && holdsWord(h, [...R.type, ...F.type])) return 'type';
  if (c.kind === 'travel') {
    if (unit === 'db' || holdsWord(h, R.gain) || /^g[ _]?\d+$/.test(sym) || /^boost[lh]$/.test(sym)) return 'gain';
    if (holdsWord(h, [...R.q, ...F.q]) || /^q[ _]?\d+$|^bw\d*$/.test(h) || unit === 'oct') return degenerateQ(c) ? null : 'q';
  }
  if (c.kind === 'toggle' || choice || /\b(active|enable|on|section|sec|bypass)\b/.test(h) || holdsEdge(h, edgeShape('highpass'), '') || holdsEdge(h, edgeShape('lowpass'), '')) return 'enable';
  return null;
}

/** Role affix tokens stripped to derive a band's group key (longest first): the table's words of each role, run together. */
export const AFFIX = {
  ...Object.fromEntries(['freq', 'gain', 'q', 'type'].map((r) => [r, [...new Set([...EQ_WORDS.roles[r], ...(EQ_WORDS.fallback[r] ?? [])].map((w) => w.replace(/ /g, '')))].sort((a, b) => b.length - a.length)])),
  enable: ['active', 'section', 'sec', 'enable', 'on'],
};

/** A band's group key: the symbol with the role affix and the separators stripped. */
function bandKey(symbol, role) {
  let s = symbol.toLowerCase();
  for (const t of AFFIX[role]) {
    if (s.startsWith(t)) { s = s.slice(t.length); break; }
    if (s.endsWith(t)) { s = s.slice(0, s.length - t.length); break; }
  }
  return s.replace(/[_\-\s]+/g, '');
}

/** A band's shape from its key and the names of its controls: an edge's long words in the names, its abbreviation as the key's prefix. */
export function shapeOfNames(key, names) {
  const k = key.toLowerCase(), n = names.toLowerCase();
  for (const shape of ['lowshelf', 'highshelf', 'highpass', 'lowpass']) {
    const e = edgeShape(shape);
    if (holdsEdge(n, e) || e.words.some((w) => w.length === 2 && k.startsWith(w))) return shape;
  }
  if (/notch/.test(n)) return 'notch';
  return 'bell';
}

/** A shape word from a filter-type choice's label; undefined when the label is none of them. */
export function shapeOfLabel(label) {
  const l = label.trim().toLowerCase();
  if (/^off$|bypass|none/.test(l)) return 'off';
  for (const shape of ['lowshelf', 'highshelf', 'highpass', 'lowpass']) if (holdsEdge(l, edgeShape(shape), '[\\s-]*')) return shape;
  if (/notch/.test(l)) return 'notch';
  if (/bell|peak/.test(l)) return 'bell';
  return undefined;
}

/**
 * A choice control's `shapes`: one shape word per choice value from 0 (`-` for a value whose label is none of
 * them), or undefined when none of its labels is a shape. A choice's value is its entry in `values`, else its place.
 */
export function shapesOf(c) {
  const labels = c.labels ?? c.ids ?? [];
  const values = c.values ?? labels.map((_, i) => i);
  const top = Math.max(-1, ...values);
  if (!Number.isInteger(top) || top < 0 || top > 63) return undefined;
  const out = Array.from({ length: top + 1 }, () => '-');
  let any = false;
  values.forEach((v, i) => {
    if (!Number.isInteger(v) || v < 0) return;
    const s = shapeOfLabel(String(labels[i] ?? ''));
    if (s) { out[v] = s; any = true; }
  });
  return any ? out : undefined;
}

/** The standard unit id a gain is read in: dB, or a linear factor, the curve's coef (a range that stays above zero; a
 * curve term is a descriptor word, so its descriptor-scope id, %4). */
function gainToken(c) {
  if (unitOf(c) === 'db') return 'dB';
  return typeof c.travel?.min === 'number' && c.travel.min > 0 ? 'coef' : 'dB';
}

/** Infer `controls`' EQ bands. See the file's header for the verdict. */
export function inferBands(controls) {
  const groups = new Map();
  let order = 0;
  for (const c of controls) {
    const role = bandRoleOf(c);
    if (!role) continue;
    const key = bandKey(keyNameOf(c), role);
    if (!key) continue;
    const g = groups.get(key) ?? { order: order++ };
    const strongQ = (x) => holdsWord(hay(x), EQ_WORDS.roles.q);
    // first wins per role in descriptor order, but a real "q" beats a width fallback
    if (role === 'q' && g.q) { if (strongQ(c) && !strongQ(g.q)) g.q = c; }
    else if (!g[role]) g[role] = c;
    groups.set(key, g);
  }
  const bands = [];
  for (const [key, g] of [...groups.entries()].sort((a, b) => a[1].order - b[1].order)) {
    if (!g.freq) continue; // a band has a frequency
    if (!g.gain && !g.type && !g.q) continue; // a bare frequency is not a band
    const names = [g.freq, g.gain, g.q, g.type].filter(Boolean).map(nameOf).join(' ');
    bands.push({ ...g, key, shape: shapeOfNames(key, names) });
  }
  if (bands.length === 0) return { outcome: 'no-confident-inference', reason: 'no-band' };

  // a high-pass or low-pass band with no gain is the head filter; the others take the indices from 0, the
  // gain-carrying ones first
  const head = (kind, shape) => bands.filter((b) => b.shape === shape && !b.gain).slice(0, 1).map((b) => ({ kind, b }));
  const heads = [...head('hpf', 'highpass'), ...head('lpf', 'lowpass')];
  const isHead = new Set(heads.map((h) => h.b));
  const rest = bands.filter((b) => !isHead.has(b)).sort((x, y) => Number(Boolean(y.gain)) - Number(Boolean(x.gain)));
  const mark = { inferred: true };
  const roles = [];
  for (const { kind, b } of heads) {
    roles.push({ role: `${kind}_freq`, index: 0, symbol: symbolOf(b.freq), unit: 'Hz', ...mark });
    if (b.enable) roles.push({ role: `${kind}_on`, index: 0, symbol: symbolOf(b.enable), unit: 'none', ...mark });
  }
  rest.forEach((b, index) => {
    // a shape no parameter selects is the band_freq role's own
    roles.push({ role: 'band_freq', index, symbol: symbolOf(b.freq), unit: 'Hz', ...(b.type ? {} : { shape: b.shape }), ...mark });
    if (b.gain) roles.push({ role: 'band_gain', index, symbol: symbolOf(b.gain), unit: gainToken(b.gain), ...mark });
    if (b.q) roles.push({ role: 'band_q', index, symbol: symbolOf(b.q), unit: unitOf(b.q) === 'oct' ? 'oct' : 'none', ...mark });
    if (b.enable) roles.push({ role: 'band_on', index, symbol: symbolOf(b.enable), unit: 'none', ...mark });
    if (b.type) {
      const shapes = shapesOf(b.type);
      roles.push({ role: 'band_type', index, symbol: symbolOf(b.type), unit: 'none', ...(shapes ? { shapes } : {}), ...mark });
    }
  });
  return { outcome: 'inferred', roles };
}
