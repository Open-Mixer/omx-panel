// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * role-table.mjs — each panel family's roles, the units each role accepts, the roles that repeat by
 * index, and the roles a family needs before a host may draw its family view. Data only: no import and
 * no file read, so a browser loads it as it is (`@openmixer/omx-panel/role-table`), and a host's D6 check,
 * a console's family view and this package's own layout read the one table.
 *
 *   import { ROLES, INDEXED_ROLES, REQUIRED_ROLES } from '@openmixer/omx-panel/role-table';
 */

/** @typedef {'none' | 'gate' | 'dynamics' | 'limiter' | 'deesser' | 'eq' | 'filter' | 'drive' | 'modulation' | 'delay' | 'reverb' | 'pitch'} PanelFamily */

// the standard unit ids (omx-contract's PARAM_UNITS, sorting pass M4): a role's units are named by id, never by a
// format's token; test/units-standard.test.mjs holds every id to the installed list
const T = ['ms', 's'], LVL = ['dB', 'dBFS', 'dBu', 'LUFS'], DB = ['dB'], FREQ = ['Hz', 'kHz'], PLAIN = ['none', 'percent', 'coef'], RATIO = ['ratio', 'coef'], CHOICE = ['none'];
const WET = { mix: ['percent', 'coef', 'none'], output: DB };

/**
 * Each family's roles and the standard unit ids each accepts (omx-contract's PARAM_UNITS).
 * @type {Readonly<Record<PanelFamily, Readonly<Record<string, readonly string[]>>>>}
 */
export const ROLES = {
  none: {},
  gate: { threshold: LVL, range: DB, attack: T, release: T, hold: T, knee_start: DB, knee_end: DB, hysteresis: DB, ratio: RATIO, key_listen: CHOICE },
  dynamics: { threshold: LVL, ratio: RATIO, attack: T, release: T, knee: DB, makeup: DB, lookahead: ['ms'], ...WET },
  limiter: { ceiling: LVL, release: T, lookahead: ['ms'], threshold: LVL, ...WET },
  deesser: { frequency: FREQ, threshold: LVL, range: DB, width: ['oct'], ratio: RATIO, attack: T, release: T, knee: DB, mode: CHOICE, listen: CHOICE, ...WET },
  eq: { band_type: CHOICE, band_freq: FREQ, band_gain: ['dB', 'coef'], band_q: ['none', 'coef', 'oct'], band_on: CHOICE, hpf_freq: FREQ, hpf_slope: ['none', 'dB', 'dBPerOct'], hpf_on: CHOICE, lpf_freq: FREQ, lpf_slope: ['none', 'dB', 'dBPerOct'], lpf_on: CHOICE, output: DB },
  filter: { cutoff: FREQ, resonance: PLAIN, filter_type: CHOICE, ...WET },
  drive: { drive: DB, tone: PLAIN, model: CHOICE, ...WET },
  modulation: { rate: ['Hz', 'bpm'], depth: [...PLAIN, 'oct'], feedback: PLAIN, voices: CHOICE, spread: PLAIN, shape: CHOICE, ...WET },
  delay: { time: T, feedback: PLAIN, tone: PLAIN, sync: CHOICE, division: CHOICE, pingpong: CHOICE, ...WET },
  reverb: { size: PLAIN, decay: T, algorithm: CHOICE, predelay: ['ms'], damping: PLAIN, width: PLAIN, low_cut: FREQ, high_cut: FREQ, ...WET },
  pitch: { shift: ['st', 'cents'], fine: ['cents'], ...WET },
  // omx-plugins' trim (gain), width (width, pseudo-stereo, bass mono), balancer (amount, range) and clipper (drive, ceiling,
  // softness, speed, slope): one role per control they declare whose unit a token serves. The balancer's speed is declared in
  // dB or dBPerS, its slope in dBPerOct (omx-contract's PARAM_UNITS ids).
  utility: { gain: DB, width: PLAIN, pseudo: CHOICE, pseudo_time: ['ms'], bass_mono: CHOICE, bass_mono_freq: FREQ, amount: PLAIN, range: DB, drive: DB, ceiling: LVL, softness: PLAIN, speed: ['dB', 'dBPerS'], slope: ['dBPerOct'] },
};

/**
 * The roles that repeat by index, one control per band: schema/panel.schema.json's `$defs.indexedRole`.
 * @type {readonly string[]}
 */
export const INDEXED_ROLES = ['band_type', 'band_freq', 'band_gain', 'band_q', 'band_on'];

/**
 * The roles each family needs mapped (at index 0) before a host draws its family view: a list of
 * alternatives, each met by any ONE of its roles. `none` draws no family view.
 * @type {Readonly<Record<PanelFamily, readonly (readonly string[])[]>>}
 */
export const REQUIRED_ROLES = {
  none: [],
  gate: [['threshold'], ['range'], ['attack'], ['release']],
  dynamics: [['threshold'], ['ratio'], ['attack'], ['release']],
  limiter: [['ceiling'], ['release']],
  deesser: [['frequency'], ['threshold'], ['range']],
  eq: [['band_freq'], ['band_gain']],
  filter: [['cutoff']],
  drive: [['drive']],
  modulation: [['rate'], ['depth']],
  delay: [['time'], ['feedback']],
  reverb: [['size', 'decay'], ['mix']],
  pitch: [['shift']],
  utility: [['gain', 'width', 'amount', 'drive']],
};

/** The dynamics family's roles, the words of a dynamics control (`threshold`, `ratio`, `attack`, `release`): from REQUIRED_ROLES, never typed twice. */
export const DYNAMICS_ROLES = Object.freeze(REQUIRED_ROLES.dynamics.flat());

/** The words a dynamics control is called by in a name: the roles, and the knee and the short forms (`thresh`, `comp`). The group model reads them. */
export const DYNAMICS_WORDS = Object.freeze([...DYNAMICS_ROLES, 'knee', 'thresh', 'comp']);
