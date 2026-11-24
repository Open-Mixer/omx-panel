// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * describe.mjs — the one derivation of a plugin's panel description (the one-panel spec §3.1): the descriptor, a user's
 * override layers and a skin in; the description every surface draws, and the refusals, out. It never throws: each
 * throw of the layout (no controls, a bad key, a family its meanings do not back, a bar group the rule refuses)
 * is a refusal by code.
 *
 *   describe(descriptor, { overrides, applyOverride, skin, panel, ns }) -> { description, refusals }
 *   describe(descriptor, { ..., withLayout: true }) -> { description, refusals, layout }: the derived layout the description was made
 *   from, what the renderer draws (renderer/include/omx_panel_render.h), so a host draws exactly what it describes
 *
 * - the override layers are omx-contract's `applyOverride` over the descriptor (the caller passes the function; omx-contract
 *   does not export it from its package entry), before the layout;
 * - the PARAMS are the effective descriptor's controls as contract facts: kind, unit and its token, scale, step, ends,
 *   default and the labels of a choice (`log` over a floor at or below zero is served linear, the same rule as omx-contract's
 *   `contract.override.scale-floor`; a default outside the ends is the floor; a choice is a stepped number, labelled only
 *   when every value is an integer; a gain the band inference reads as a linear factor, its unit unstated, is `coef`);
 * - every SYMBOL the description serves is the name a host sets the parameter by (`servedSymbolOf`): an LV2 control's symbol,
 *   a CLAP parameter's id in decimal. The layout's own key of a CLAP control, `p<id>`, stays inside the layout;
 * - the FAMILY is the one general rule of §3.1.1: a candidate from the plugin's own LV2 class or CLAP feature (a fixed
 *   table, no list of plugins), kept only when the controls back every required role of the family, from descriptor
 *   words or from the meaning inference (tools/meaning-infer.mjs, each role `inferred`); else `none`. A declared panel's
 *   family, or a user's override naming one, wins and is applied as the layout applies it;
 * - the DISPLAYS of a derived panel are the family's closed form on the section holding its required roles, each with its
 *   `basis`: `exact` only when an authored descriptor declares it, else `modelled`;
 * - every DISPLAY serves its `axis`, a PANEL_DISPLAY_AXES word (the layout's, by kind): data, so no surface picks an axis by the
 *   kind's name; a display whose axis is no word, a stored one or a skin's, is refused by name;
 * - the ROLES carry `unit` (the contract token), `inferred`, a band's `shape` and a band-type role's `shapes`;
 * - the SECTIONS carry `bars` (tools/bars.mjs), a view of the panel that stays out of the fingerprint, and the one that holds a
 *   repeated group its `matrix` (tools/group-model.mjs `matrixOf`, docs/group-model.md), another view; a matrix section has no bars;
 * - the skin applies last of the derivation, by `applySkinOverride` (its sections, its `easy`), and the PAGES are cut after it by
 *   `pagesOf`, the one cut (`perPage`, the surface's width, left out eight; `remote`, the host's declared remote-controls pages).
 */
import { applySkinOverride } from '../src/skin-package.js';
import { controlsOfDescriptor, inferGroupModel, matrixInstances, mergedSections, placeMatrix, servedMatrix } from './group-model.mjs';
import { inferBands } from './meaning-infer.mjs';
import { DISPLAY_AXES, FamilyNotBacked, NoControls, BarsRefused, FAMILIES, familyOf, GROUP, INSTANCE, keyOf, pagesOf, PLACE, ROW, panelFingerprint, panelLayout, requiredRolesMapped, unitToken } from './panel-description.mjs';
import { declaredFromServed, isServedPanel } from './panel-served.mjs';
import { INDEXED_ROLES } from './role-table.mjs';
import { panelCodes, unitSymbolOf } from './vocabulary.mjs';

/** The refusal codes of the derivation, beside the layout's and the bar rule's: the panel domain's PANEL_DESCRIBE_CODES. */
const CODE = panelCodes('PANEL_DESCRIBE_CODES');
export const DESCRIBE_CODES = Object.freeze({
  noControls: CODE.panelNoControls,
  familyNotBacked: CODE.panelFamilyNotBacked,
  familyUnknown: CODE.panelFamilyUnknown,
  layoutInvalid: CODE.panelLayoutInvalid,
  overrideUnavailable: CODE.panelOverrideUnavailable,
  overrideRefused: CODE.panelOverrideRefused,
  overrideDropped: CODE.panelOverrideDropped,
  roleDropped: CODE.panelRoleDropped,
  skinDropped: CODE.panelSkinDropped,
  meterRefused: CODE.panelMeterRefused,
  paramUnserved: CODE.panelParamUnserved,
});

/** The LV2 range of a patch parameter -> the kind it is served as: a file (atom:Path) or a text (atom:String). */
const TEXT_KIND_OF_RANGE = {
  Path: 'path', 'atom:Path': 'path', 'http://lv2plug.in/ns/ext/atom#Path': 'path',
  String: 'text', 'atom:String': 'text', 'http://lv2plug.in/ns/ext/atom#String': 'text',
};

/**
 * The path and text parameters a descriptor declares (#17): an LV2 plugin's patch:writable lv2:Parameters, as a scan
 * writes them under `extensions.lv2["patch:writable"]` ({ uri, label, range }, and a `symbol` where a host names it), served
 * as `{ kind: 'path' | 'text', symbol, name, default }`: the symbol is the one stated, else the parameter URI's fragment
 * (else its last segment), the name its label, the
 * default empty. One of another range is not served: it is listed apart (`unserved`, its symbol and range), for a refusal.
 */
export function textParamsOf(descriptor) {
  const writable = descriptor.extensions?.lv2?.['patch:writable'];
  const list = Array.isArray(writable) ? writable : writable ? [writable] : [];
  const served = [];
  const unserved = [];
  for (const p of list) {
    const uri = typeof p === 'string' ? p : p?.uri;
    if (typeof uri !== 'string' || uri === '') continue;
    // a symbol the entry states wins (a host's own name for it); else the URI's fragment, else its last segment
    const stated = typeof p === 'object' && typeof p.symbol === 'string' && p.symbol !== '' ? p.symbol : undefined;
    const symbol = stated ?? (uri.includes('#') ? uri.slice(uri.lastIndexOf('#') + 1) : uri.slice(uri.lastIndexOf('/') + 1));
    const range = typeof p === 'object' ? p.range : undefined;
    const kind = TEXT_KIND_OF_RANGE[range];
    if (kind) served.push({ kind, symbol, name: (typeof p.label === 'string' && p.label) || symbol, default: '' });
    else unserved.push({ symbol, range: range ?? null });
  }
  return { served, unserved };
}

/** What a plugin declares about itself (an LV2 class, a CLAP feature) -> the family whose closed form omx-panel knows. */
export const FAMILY_OF_DECLARED = {
  'lv2:EQPlugin': 'eq', 'lv2:ParaEQPlugin': 'eq', equalizer: 'eq',
  'lv2:CompressorPlugin': 'dynamics', compressor: 'dynamics',
  'lv2:GatePlugin': 'gate', 'lv2:ExpanderPlugin': 'gate', gate: 'gate',
  'lv2:DistortionPlugin': 'drive', distortion: 'drive',
};

const LV2_CORE = 'http://lv2plug.in/ns/lv2core#';

/**
 * The classes and features the descriptor carries as the plugin states them: its extension bag, `extensions.lv2` (a class
 * as a field, `lv2:CompressorPlugin`, or among `rdf:type`'s values) and `extensions.clap`
 * (`clap_plugin_descriptor.features`). A scan spells a CLAP feature by its macro (`CLAP_PLUGIN_FEATURE_EQUALIZER`, the format
 * table's term), a declaration by its string (`equalizer`): the macro is read as the string it stands for.
 */
export function declaredOf(descriptor) {
  const lv2 = descriptor.extensions?.lv2 ?? {};
  const clap = descriptor.extensions?.clap ?? {};
  const out = new Set(Object.keys(lv2).filter((k) => lv2[k] !== false && lv2[k] !== null));
  for (const t of [lv2['rdf:type']].flat()) if (typeof t === 'string') out.add(t.startsWith(LV2_CORE) ? `lv2:${t.slice(LV2_CORE.length)}` : t);
  for (const f of [clap['clap_plugin_descriptor.features']].flat()) if (typeof f === 'string') out.add(clapFeature(f));
  return [...out];
}

const CLAP_FEATURE_MACRO = 'CLAP_PLUGIN_FEATURE_';
/** A CLAP feature as the string the format defines: CLAP_PLUGIN_FEATURE_DE_ESSER is "de-esser". */
const clapFeature = (f) => (f.startsWith(CLAP_FEATURE_MACRO) ? f.slice(CLAP_FEATURE_MACRO.length).toLowerCase().replaceAll('_', '-') : f);

/** The candidate families of a descriptor's declarations, in the table's order and without repeats. */
export const candidatesOf = (descriptor) => [...new Set(declaredOf(descriptor).map((d) => FAMILY_OF_DECLARED[d]).filter(Boolean))];

// ---- the params: the effective descriptor's controls as contract facts ----

/** The numbers of a mask as the values that set its bits, 0..63. */
const valuesOfMask = (mask) => {
  const m = typeof mask === 'string' ? BigInt(`0x${mask}`) : BigInt(mask);
  return Array.from({ length: 64 }, (_, v) => v).filter((v) => ((m >> BigInt(v)) & 1n) === 1n);
};

/**
 * The name a host sets a control's parameter by, and the one every symbol of the description is: the control's symbol, else
 * its id as text (a CLAP parameter's id in decimal, the key the console's sessions and parameter doors hold it under).
 */
export const servedSymbolOf = (c) => c.symbol ?? (typeof c.id === 'string' || Number.isInteger(c.id) ? String(c.id) : keyOf(c));

/** The widest span of integers a choice is labelled over: one label each, a 16-bit index. */
const LABEL_SPAN = 1 << 16;

/**
 * One control as the contract facts the description serves (§3.1 `params`). `factor`: the band inference reads it as a gain
 * in a linear factor, so a unit the descriptor leaves unstated is `coef`.
 */
export function servedParamOf(c, { factor = false } = {}) {
  const symbol = servedSymbolOf(c);
  const name = c.label ?? c.name ?? symbol;
  if (c.kind === 'trigger') return { kind: 'trigger', symbol, name, min: 0, max: 1 };
  if (c.kind === 'toggle') return { kind: 'number', symbol, name, unit: 'none', scale: 'stepped', step: 1, min: 0, max: 1, default: c.default === true ? 1 : 0 };
  if (c.kind === 'choice') {
    const values = c.values ?? c.ids.map((_, i) => i);
    const min = Math.min(...values), max = Math.max(...values);
    const at = c.ids.indexOf(c.default);
    const labels = c.labels ?? c.ids;
    // one label per integer of the span, only when every value is one: a value between two integers has no slot of a
    // stepped number, so its label would be lost and another put in its place. A sparse choice (FFT sizes 128..16384) takes
    // a label per integer between, as the console's derivation served it; past a 16-bit span no list is made
    const enumLabels = values.every(Number.isInteger) && max - min < LABEL_SPAN ? Array.from({ length: max - min + 1 }, (_, k) => labels[values.indexOf(min + k)] ?? String(min + k)) : undefined;
    // a stepped number's default is an integer inside its ends, as a stepped travel's is
    const fallback = at >= 0 ? values[at] : min;
    return { kind: 'number', symbol, name, unit: 'none', scale: 'stepped', step: 1, min, max, default: Math.min(max, Math.max(min, Math.round(fallback))), ...(enumLabels ? { enumLabels } : {}) };
  }
  const t = c.travel;
  const stated = t.unit && t.unit !== 'unknown' && t.unit !== 'none';
  const token = factor && !stated ? 'coef' : unitToken(t.unit);
  const stepped = t.scale === 'stepped' || (t.step ?? 0) >= 1;
  // log over a floor at or below zero is served linear (contract.override.scale-floor)
  const scale = stepped ? 'stepped' : t.scale === 'log' && t.min > 0 ? 'log' : 'linear';
  // the default rides only inside the ends; one outside them (a TTL's typo, 440 on a 0..0.5 travel) is the floor
  const at = typeof t.default === 'number' && t.default >= t.min && t.default <= t.max ? t.default : t.min;
  return {
    kind: 'number', symbol, name, unit: token ?? 'none',
    ...(token === undefined && stated ? { unitText: unitSymbolOf(t.unit) } : {}),
    scale, step: stepped ? Math.max(1, t.step ?? 1) : 0, min: t.min, max: t.max,
    default: stepped ? Math.min(t.max, Math.max(t.min, Math.round(at))) : at,
  };
}

// ---- the layout of a candidate family, and the family rule ----

/** The layout of `descriptor` under `family`, with the bands the meanings leave unnamed inferred (family `eq` only). */
function layoutUnder(descriptor, family, options) {
  const inferred = family === 'eq' ? inferBands(descriptor.controls) : null;
  return panelLayout(descriptor, { ...options, family, derive: true, inferredRoles: inferred?.outcome === 'inferred' ? inferred.roles : undefined, completingRoles: completing(descriptor, family) });
}

/** The bands as the inference reads them with every stated meaning set aside: what completes a band the words name with
 * the Q, type and switch they leave unnamed (panelLayout's `completingRoles`). Family `eq` only. */
function completing(descriptor, family) {
  if (family !== 'eq') return undefined;
  const all = inferBands(descriptor.controls.map((c) => ({ ...c, meaning: undefined })));
  return all.outcome === 'inferred' ? all.roles : undefined;
}

/**
 * The family and layout of a plugin that declares no panel and has no override naming one (§3.1.1). One candidate from the
 * plugin's declarations, kept when the layout under it maps every required role; two or more candidates give a family only
 * when exactly one of them is kept; none, or no kept one, is `none`.
 */
export function familyRule(descriptor, options) {
  const kept = [];
  for (const family of candidatesOf(descriptor)) {
    const layout = layoutUnder(descriptor, family, options);
    if (requiredRolesMapped(family, layout.roles)) kept.push({ family, layout });
  }
  if (kept.length === 1) return kept[0];
  return { family: 'none', layout: layoutUnder(descriptor, 'none', options) };
}

const refuse = (code, args = {}) => ({ code, args });

/** The derivation up to the skin: the base description, the layout and what the store keeps (`stored`); `stored` is absent when no panel can be made. */
function derive(descriptor, { overrides = [], applyOverride, panel, ns, where } = {}) {
  const refusals = [];
  const plugin = descriptor.plugin?.id;
  let effective = descriptor, userFamily;
  if (overrides.length > 0) {
    if (typeof applyOverride !== 'function') refusals.push(refuse(DESCRIBE_CODES.overrideUnavailable, { plugin, layers: overrides.length }));
    else {
      const r = applyOverride(descriptor, overrides, {});
      effective = r.descriptor;
      userFamily = r.family;
      // a family that is no word of PANEL_FAMILIES is refused by name and the panel is `none` (#199): omx-contract's
      // override schema takes any identifier, the words are the panel domain's
      if (userFamily !== undefined && !FAMILIES.includes(userFamily)) {
        refusals.push(refuse(DESCRIBE_CODES.familyUnknown, { plugin, family: userFamily }));
        userFamily = 'none';
      }
      for (const x of r.refused ?? []) refusals.push(refuse(DESCRIBE_CODES.overrideRefused, { plugin, layer: x.layer, name: x.name, message: x.message }));
      for (const x of r.dropped ?? []) refusals.push(refuse(DESCRIBE_CODES.overrideDropped, { plugin, layer: x.layer, control: x.control, name: x.name, message: x.message }));
    }
  }
  // the panel a plugin serves (plugin-hostd-probe panel) is read as the declared form over this descriptor (#43), so a
  // user's family override applies to it as to any declared panel
  if (panel && isServedPanel(panel)) {
    try {
      panel = declaredFromServed(panel, effective, { where: where ?? `served panel of ${plugin}`, keyOf, indexedRoles: INDEXED_ROLES });
    } catch (e) {
      refusals.push(refuse(DESCRIBE_CODES.layoutInvalid, { plugin, message: e.message }));
      return { description: null, refusals };
    }
  }
  const options = { panel, ns, ...(where ? { where } : {}) };
  const texts = textParamsOf(effective);
  for (const u of texts.unserved) refusals.push(refuse(DESCRIBE_CODES.paramUnserved, { plugin, symbol: u.symbol, range: u.range }));
  let layout;
  // a declared family the controls do not back is refused by code and the panel is `none`: the plain sections
  const tryDeclared = (make) => {
    try {
      return make();
    } catch (e) {
      if (!(e instanceof FamilyNotBacked)) throw e;
      refusals.push(refuse(DESCRIBE_CODES.familyNotBacked, { plugin, message: e.message }));
      return panelLayout(effective, { ...options, panel: undefined, family: 'none', derive: true });
    }
  };
  try {
    if (panel) {
      // a declared panel's family, or a user's override over it, is applied as the layout applies it
      layout = tryDeclared(() => panelLayout(effective, { ...options, panel: userFamily === undefined ? panel : { ...panel, family: userFamily }, derive: true }));
    } else if (userFamily !== undefined) {
      const family = userFamily;
      const inferred = family === 'eq' ? inferBands(effective.controls) : null;
      const { needs } = familyOf(effective.controls, family);
      layout = tryDeclared(() => {
        if (needs) throw new FamilyNotBacked(`${plugin}: the ${family} family needs a control meaning ${needs.join(' or ')}`);
        return panelLayout(effective, { ...options, family, derive: true, inferredRoles: inferred?.outcome === 'inferred' ? inferred.roles : undefined, completingRoles: completing(effective, family) });
      });
    } else layout = familyRule(effective, options).layout;
  } catch (e) {
    // a plugin whose only parameters are paths or texts still has a panel: one section holding their controls
    if (e instanceof NoControls && texts.served.length > 0) layout = textOnlyLayout(effective);
    else {
      const code = e instanceof NoControls ? DESCRIBE_CODES.noControls : e instanceof BarsRefused ? e.code : DESCRIBE_CODES.layoutInvalid;
      refusals.push(refuse(code, { plugin, message: e.message }));
      return { description: null, refusals };
    }
  }
  // the layout keys a control by keyOf; the description serves the name a host sets it by
  const servedOf = new Map(effective.controls.map((c) => [keyOf(c), servedSymbolOf(c)]));
  const served = (key) => servedOf.get(key) ?? key;
  for (const u of layout.unpublished) refusals.push(refuse(DESCRIBE_CODES.roleDropped, { plugin, entry: u.role, symbol: served(u.symbol), reason: u.why }));

  for (const m of layout.meterRefusals ?? []) refusals.push(refuse(DESCRIBE_CODES.meterRefused, { plugin, symbol: m.symbol, reason: m.reason }));

  const factors = new Set(layout.roles.filter((r) => r.role === 'band_gain' && r.inferred && (r.token ?? r.unit) === 'coef').map((r) => r.symbol));
  // a path or text parameter is served after the controls' facts, and drawn as a control of the panel's last section
  const params = [...effective.controls.map((c) => servedParamOf(c, { factor: factors.has(keyOf(c)) })), ...texts.served];
  const textSection = layout.sections.at(-1)?.key;
  const textControls = texts.served.map((t) => ({ symbol: t.symbol, section: textSection, widget: 'auto', labelKey: '', label: t.name, visibleWhen: null }));
  const visibleWhen = (c) => (c.visibleWhen ? { param: served(c.visibleWhen.symbol), values: valuesOfMask(c.mask) } : null);
  const base = {
    family: layout.family,
    fingerprint: panelFingerprint(layout),
    // the Easy controls, a view of the panel (the descriptor's own list, else the roles', tools/easy.mjs)
    easy: layout.easy.map(served),
    params,
    sections: layout.sections.map((s) => ({ key: s.key, labelKey: s.labelKey ?? '', label: s.label, ...(s.bars ? { bars: s.bars } : {}) })),
    controls: [...layout.controls.map((c) => ({ symbol: served(c.symbol), section: c.sectionKey, widget: c.widget, labelKey: c.labelKey ?? '', label: c.label, visibleWhen: visibleWhen(c) })), ...textControls],
    // the meters (contract 7.9): a meter control each, in the descriptor's order. Facts of the view, never ballistics.
    // unitText is the unit as a person reads it, its x-symbol: the caption a renderer draws (the unit stays the id)
    meters: layout.meters.map((m) => ({ symbol: m.symbol, section: m.sectionKey, kind: m.kind, measurement: m.measurement, unit: m.unit, unitText: unitSymbolOf(m.unit), min: m.min, max: m.max, channels: m.channels, held: m.held, clip: m.clip, labelKey: m.labelKey ?? '', label: m.label })),
    roles: layout.roles.map((r) => {
      const { role, index } = r;
      return { role, index, symbol: served(r.symbol), unit: r.token ?? unitToken(r.unit) ?? 'none', ...(r.shape ? { shape: r.shape } : {}), ...(r.shapes ? { shapes: r.shapes } : {}), ...(r.inferred ? { inferred: true } : {}) };
    }),
    displays: layout.displays.map((d) => ({ kind: d.kind, axis: d.axis, section: d.sectionKey, source: d.source, meterIds: d.meters, curveIndex: d.curve, floor: d.floor, labelKey: d.labelKey ?? '', label: d.label, basis: d.basis ?? 'modelled' })),
  };
  // what the matrices and the pages read of the controls, and the repeated groups: kept beside the body (storedOf)
  const inLayout = new Set(layout.controls.map((c) => c.symbol));
  const { groups } = inferGroupModel(controlsOfDescriptor(effective, panel ? { panel } : {}).filter((c) => inLayout.has(c.symbol)));
  const governed = new Set(layout.controls.filter((c) => c.visible !== null && c.visible !== undefined).map((c) => c.symbol));
  const groupOf = new Map(layout.controls.map((c) => [c.symbol, c[GROUP]]));
  const controls = effective.controls.map((c, ordinal) => ({
    ordinal, symbol: servedSymbolOf(c), key: keyOf(c), id: c.id, group_key: groupOf.get(keyOf(c)) ?? null, governed: governed.has(keyOf(c)) ? 1 : 0,
  }));
  return { description: base, refusals, layout, stored: { plugin, body: base, controls, groups: groups.filter((g) => g.kind === 'repeated') } };
}

/**
 * The description of `descriptor` and the refusals, as the header says. `description` is null when no panel can be made
 * (no control, an invalid layout); a declared family the controls do not back is `none` with its refusal.
 */
export function describe(descriptor, { skin, perPage, remote, withLayout = false, ...options } = {}) {
  const derived = derive(descriptor, options);
  if (!derived.stored) return { description: null, refusals: derived.refusals };
  const done = finish(derived.stored, { skin, perPage, remote });
  const refusals = [...derived.refusals, ...done.refusals];
  if (!done.description) return { description: null, refusals };
  return withLayout ? { description: done.description, refusals, layout: layoutOf(derived.layout, done.steps) } : { description: done.description, refusals };
}

/**
 * What the descriptions store keeps of one derivation (docs/descriptions-store.md 3.4): `stored.body`, the description
 * before the skin, the matrices and the pages; `stored.controls`, per control what the matrices and the pages read (its
 * served symbol, its layout key, its id, its group key, whether a control governs it); `stored.groups`, the repeated
 * groups of the group model. Plain JSON. `stored` is null when no panel can be made (the refusals say why).
 */
export function describeStored(descriptor, options = {}) {
  const { stored, refusals } = derive(descriptor, options);
  return { stored: stored ?? null, refusals };
}

/**
 * The description the stored entry serves with the user's skin applied and the pages cut at the surface's width, byte
 * for byte what `describe` serves for the same inputs (`describe` is this function over its own derivation). Pure: it
 * reads the entry and nothing else, no descriptor and no file.
 */
export function describeFromStored(stored, { skin, perPage, remote } = {}) {
  const { description, refusals } = finish(stored, { skin, perPage, remote });
  return { description, refusals };
}

/** Why display `d` (the `i`th) has no axis a surface can draw on, or null: its `axis` is a PANEL_DISPLAY_AXES word. */
function axisFault(d, i) {
  if (d.axis === undefined || d.axis === null) return `display ${i} (${d.kind}) has no axis, one of PANEL_DISPLAY_AXES (${DISPLAY_AXES.join(', ')})`;
  if (!DISPLAY_AXES.includes(d.axis)) return `display ${i} (${d.kind}) has the axis '${d.axis}', none of PANEL_DISPLAY_AXES (${DISPLAY_AXES.join(', ')})`;
  return null;
}

/** The skin, then the matrices over the sections as the skin left them, then the pages: the one tail of a description. */
function finish(stored, { skin, perPage, remote }) {
  const refusals = [];
  let description = stored.body;
  // each display's axis is a PANEL_DISPLAY_AXES word (a stored body may be a person's edit): one that is not refuses the entry by
  // name, and none is inferred from the kind
  const badAxis = description.displays.map((d, i) => axisFault(d, i)).find(Boolean);
  if (badAxis) return { description: null, refusals: [refuse(DESCRIBE_CODES.layoutInvalid, { plugin: stored.plugin, message: badAxis })], steps: [] };
  if (skin) {
    const applied = applySkinOverride(description, skin);
    description = applied.description;
    for (const d of applied.dropped) refusals.push(refuse(DESCRIBE_CODES.skinDropped, { plugin: stored.plugin, field: d.field, entry: d.entry, reason: d.reason }));
    // a skin's display states its axis as the description's do; one that does not, or names no word, is dropped by name
    const kept = description.displays.filter((d) => {
      if (!axisFault(d, 0)) return true;
      refusals.push(refuse(DESCRIBE_CODES.skinDropped, { plugin: stored.plugin, field: 'displays', entry: `${d.kind}@${d.section}`, reason: 'axis' }));
      return false;
    });
    if (kept.length !== description.displays.length) description = { ...description, displays: kept };
  }
  const servedOf = new Map(stored.controls.map((c) => [c.key, c.symbol]));
  const grouped = withMatrices(description, stored, servedOf);
  description = { ...grouped.description, pages: pagesOfDescription(grouped.description, stored, { perPage, remote }) };
  return { description, refusals, steps: grouped.steps };
}

/**
 * The description with each repeated group's served matrix (group-model.mjs
 * `servedMatrix`, the one function of the shape) on the section that holds its instances, titled by it. The controls the
 * matrix places belong to that section: the other sections of the group are folded into it, and the sections the edges were
 * taken from keep the rest; a section the group emptied goes, unless a display or a meter stands on it. The layout is
 * merged the same way (each control's, display's and meter's `section` index and `sectionKey`), in its own symbols, so
 * `describe --layout` serves what the description serves. A group the description cannot place whole is left as it is.
 */
function withMatrices(description, stored, servedOf) {
  const { groups } = stored;
  const keyOf_ = new Map([...servedOf].map(([key, served]) => [served, key]));
  const served = (key) => servedOf.get(key) ?? key;
  const governed = new Set(stored.controls.filter((c) => c.governed).map((c) => c.key));
  let { sections, controls } = description;
  const steps = [];
  for (const g of groups) {
    if (g.kind !== 'repeated') continue;
    const placed = placeMatrix(g, sections.map((s) => ({ id: s.key, symbols: controls.filter((c) => c.section === s.key).map((c) => keyOf_.get(c.symbol) ?? c.symbol) })));
    if (!placed) continue;
    const home = sections.find((s) => s.key === placed.home);
    const countDefault = g.count ? description.params.find((x) => x.symbol === served(g.count.symbol))?.default : undefined;
    const options = { governs: (sym) => governed.has(sym), title: home.label, countDefault: countDefault ?? null };
    const matrix = servedMatrix(g, { ...options, symbolOf: served });
    const isCount = (sym) => g.count && sym === g.count.symbol;
    controls = controls.map((c) => {
      const key = keyOf_.get(c.symbol) ?? c.symbol;
      return placed.members.has(key) ? { ...c, section: placed.home, ...(isCount(key) ? { widget: 'auto' } : {}) } : c;
    });
    // a section the group emptied goes, unless a display or a meter stands on it
    const stood = new Set([...description.displays.map((d) => d.section), ...description.meters.map((x) => x.section)]);
    const titled = (s) => (s.label === matrix.title ? {} : { label: matrix.title, labelKey: s.labelKey === null ? null : '' });
    const holdsAfter = (s) => controls.some((c) => c.section === s.key) || stood.has(s.key);
    sections = mergedSections(placed, sections, { idOf: (s) => s.key, holdsAfter }).map(({ section: s, home: isHome }) => {
      if (!isHome) return s;
      const { bars: _bars, ...own } = s;
      return { ...own, ...titled(s), matrix };
    });
    steps.push({ placed, g, options, titled, keep: new Set(sections.map((s) => s.key)) });
  }
  return { description: { ...description, sections, controls }, steps };
}

/** The layout merged as the description was, one placed group after the other (`describe --layout`). */
function layoutOf(layout, steps) {
  return steps.reduce((lay, { placed, g, options, titled, keep }) => mergeLayout(lay, placed, keep, servedMatrix(g, options), titled), layout);
}

/** The layout with a placed group's sections merged as the description merged them: `keep` the section keys the description
 * kept, the home titled and carrying `matrix`, every index that named a section renumbered. */
function mergeLayout(layout, placed, keep, matrix, titled) {
  const old = layout.sections;
  const sections = mergedSections(placed, old, { idOf: (s) => s.key, holdsAfter: (s) => keep.has(s.key) }).map(({ section: s, home: isHome }) => {
    if (!isHome) return s;
    const { bars: _bars, ...own } = s;
    return { ...own, ...titled(s), matrix };
  });
  const index = new Map(sections.map((s, i) => [s.key, i]));
  const homeAt = index.get(placed.home);
  const moved = (key) => (index.has(key) ? key : placed.home);
  const at = (item, member) => {
    const key = member ? placed.home : moved(item.sectionKey ?? old[item.section]?.key);
    return { ...item, section: index.get(key) ?? homeAt, sectionKey: key };
  };
  return {
    ...layout,
    sections,
    controls: layout.controls.map((c) => at(c, placed.members.has(c.symbol))),
    displays: layout.displays.map((d) => (typeof d.section === 'number' ? at(d, false) : d)),
    meters: layout.meters.map((m) => (typeof m.section === 'number' ? at(m, false) : m)),
  };
}

/** The layout of a plugin with no control to lay out but path or text parameters: one plain section for them, family
 * `none`, nothing else (its fingerprint is that section's; the parameters themselves are facts of `params`). */
function textOnlyLayout(descriptor) {
  return {
    origin: descriptor.origin, family: 'none', sections: [{ key: 'controls', labelKey: 'section.controls', label: 'Controls' }],
    controls: [], roles: [], unpublished: [], displays: [], defaults: [], ports: { inputs: [], outputs: [], sidechain: false, notes: false }, easy: [], meters: [], meterRefusals: [],
  };
}

/** The page cut over a description (a skin's sections and order included): a surface slot drives a number, never a path or a text. */
function pagesOfDescription(description, stored, { perPage, remote }) {
  const idOf = new Map(stored.controls.map((c) => [c.symbol, c.id]));
  const groupOf = new Map(stored.controls.map((c) => [c.symbol, c.group_key]));
  const default_ = (symbol) => description.params.find((p) => p.symbol === symbol)?.default ?? 0;
  const numeric = (c) => description.params.find((p) => p.symbol === c.symbol)?.kind === 'number';
  const controls = description.controls.filter(numeric).map((c) => {
    const at = description.sections.findIndex((s) => s.key === c.section);
    const gov = c.visibleWhen;
    return {
      symbol: c.symbol, label: c.label || description.params.find((p) => p.symbol === c.symbol)?.name || c.symbol, section: at, param: idOf.get(c.symbol),
      ...(groupOf.get(c.symbol) ? { [GROUP]: groupOf.get(c.symbol) } : {}),
      ...(gov ? { visible: idOf.get(gov.param), mask: gov.values.reduce((m, v) => m | (1n << BigInt(v)), 0n), visibleWhen: { symbol: gov.param, default: default_(gov.param) } } : { visible: null, mask: 0n }),
    };
  });
  return pagesOf({ sections: description.sections, controls: byInstance(description.sections, controls), easy: description.easy }, { perPage, remote });
}

/**
 * The controls with each repeated group's instances marked and ordered for the page cut (docs/group-model.md, P1): in a
 * section that carries a `matrix`, each head is one instance (`GROUP`, `INSTANCE`) in `matrixInstances`'s order, HPF first
 * and LPF last, and holds its `slots`: a place the head has no control at is a blank slot (`param: null`), so slot `k` of
 * every instance's screen is the same parameter; each slot carries its place (`PLACE`) and the matrix row it is (`ROW`), so
 * the cut can put the places past a page on the matrix's row screens. The section's own controls (the count, an EQ's master on) come before the
 * instances. Sections apart, the order of the array is not read, so the controls are sorted by (section, rank).
 */
function byInstance(sections, controls) {
  const bySymbol = new Map(controls.map((c) => [c.symbol, c]));
  const placed = new Set();
  const instances = new Map();
  sections.forEach((s, at) => {
    if (!s.matrix) return;
    // the row each place is: the on/off's (the head row) where any head has one, then the matrix's rows from the top
    const headRow = s.matrix.rows.find((r) => r.head);
    const rowOf = [...(s.matrix.heads.some((h) => h.on) ? [headRow?.label || 'On'] : []), ...s.matrix.rows.filter((r) => !r.head).map((r) => r.label)];
    instances.set(at, matrixInstances(s.matrix).flatMap(({ head, slots }, j) => {
      const mark = { section: at, [GROUP]: `${s.key}#${j}`, [INSTANCE]: head.label };
      return slots.map((symbol, k) => {
        const place = { [PLACE]: k, [ROW]: rowOf[k] };
        const c = symbol !== null && !placed.has(symbol) ? bySymbol.get(symbol) : undefined;
        if (!c) return { symbol: null, label: '', param: null, visible: null, mask: 0n, ...mark, ...place };
        placed.add(symbol);
        return { ...c, ...mark, ...place };
      });
    }));
  });
  const own = controls.filter((c) => !placed.has(c.symbol));
  return sections.flatMap((_, at) => [...own.filter((c) => c.section === at), ...(instances.get(at) ?? [])]);
}
