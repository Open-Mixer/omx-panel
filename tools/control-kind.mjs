// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * control-kind.mjs — the kind of a scanned control (docs/control-kind.md): what a reader takes a control to be from
 * what the plugin states, one rule for every format and every reader. In order:
 *
 * 1. an enumeration (CLAP_PARAM_IS_ENUM, lv2:enumeration) is a `choice`, whatever its range;
 * 2. else a toggled control (lv2:toggled) is a `toggle`;
 * 3. else the scale is the stated word when there is one (`unknown` is none), else `stepped` when the control is
 *    flagged stepped (CLAP_PARAM_IS_STEPPED, lv2:integer), else `unknown`;
 * 4. a stepped control with exactly two positions, `min` exactly 0 and `max` exactly 1, is a `toggle`;
 * 5. else the control is a `travel` with that scale.
 *
 * A toggle's `default` is on when the stated default is not 0. Every reader is held to the vectors of
 * schema/control-kind-vectors.json. Exported as `@openmixer/omx-panel/control-kind`.
 */

/**
 * What the plugin states for one control, in the contract's words whatever its format.
 * @typedef {object} StatedControl
 * @property {boolean} [enumeration] CLAP_PARAM_IS_ENUM; LV2 lv2:enumeration.
 * @property {boolean} [toggled] LV2 lv2:toggled; CLAP has no such flag.
 * @property {boolean} [stepped] CLAP_PARAM_IS_STEPPED; LV2 lv2:integer.
 * @property {'linear' | 'log' | 'stepped' | 'unknown'} [scale] the parameter-contract entry's scale word, else the
 *   format's own (LV2 pprops:logarithmic is `log`); none when the plugin states none.
 * @property {number} min
 * @property {number} max
 * @property {number} [step] the contract entry's step; none, or 0, is one step per unit (CLAP's integer step).
 * @property {number} [default]
 */

/**
 * The kind the rule gives, with what it fixes: a toggle's come-up state when a default is stated, a travel's scale.
 * @typedef {{ kind: 'choice' } | { kind: 'toggle', default?: boolean } | { kind: 'travel', scale: 'linear' | 'log' | 'stepped' | 'unknown' }} ControlKind
 */

/** Exactly two positions over the travel: no step, a step of 0 (none) or a step of exactly 1 over 0..1. */
const twoPositions = (/** @type {StatedControl} */ c) => c.min === 0 && c.max === 1 && (c.step === undefined || c.step === 0 || c.step === 1);

/** @returns {ControlKind} */
const toggle = (/** @type {StatedControl} */ c) => (c.default === undefined ? { kind: 'toggle' } : { kind: 'toggle', default: c.default !== 0 });

/**
 * The kind of a control from what the plugin states (the rule above).
 * @param {StatedControl} c
 * @returns {ControlKind}
 */
export function controlKind(c) {
  if (c.enumeration === true) return { kind: 'choice' };
  if (c.toggled === true) return toggle(c);
  const scale = c.scale !== undefined && c.scale !== 'unknown' ? c.scale : c.stepped === true ? 'stepped' : 'unknown';
  if (scale === 'stepped' && twoPositions(c)) return toggle(c);
  return { kind: 'travel', scale };
}
