#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * gesture-words.mjs — renderer/src/gesture_words.h, the gesture word names of schema/gestures.json in their declared
 * order, the table omx_panel_word_name (the C library) and the omx-panel-render command answer from (#23). The enum
 * omx_panel_word_t of renderer/include/omx_panel_render.h names the same words, OMX_PANEL_WORD_<WORD>, in the same order
 * after OMX_PANEL_WORD_NONE: --check holds both to the words the gestures domain declares (GESTURES_WORDS of
 * contract.d/gestures/gestures.json, which schema/gestures.json is rendered from).
 *
 *   node tools/gesture-words.mjs           write the header
 *   node tools/gesture-words.mjs --check   exit 1 when the header or the enum is not what the domain gives
 *   node tools/gesture-words.mjs [--check] --contract-dir <dir>   read <dir>/gestures/gestures.json instead of the tree's
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '@openmixer/omx-contract/entry';
import { CONTRACT_DIR, GesturesDomainError, declarationIn } from './gestures-render.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const WORDS_HEADER = join(ROOT, 'renderer', 'src', 'gesture_words.h');
const API_HEADER = join(ROOT, 'renderer', 'include', 'omx_panel_render.h');

/** The declared words, in their order: GESTURES_WORDS of the gestures domain in `dir`. */
export const declaredWords = (dir = CONTRACT_DIR) => Object.keys(declarationIn(dir).words);

/** gesture_words.h's text. */
export function emitWordsHeader(words) {
  return `/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * GENERATED — DO NOT EDIT BY HAND: the gesture word names of schema/gestures.json in their declared order, indexed by
 * omx_panel_word_t (OMX_PANEL_WORD_NONE, 0, names nothing). Regenerate: \`node tools/gesture-words.mjs\`, then commit.
 */
#ifndef OMX_PANEL_GESTURE_WORDS_H
#define OMX_PANEL_GESTURE_WORDS_H

#define OMX_PANEL_WORD_NAMES "", ${words.map((w) => JSON.stringify(w)).join(', ')}
#define OMX_PANEL_WORD_LAST ${words.length}

#endif
`;
}

/** The OMX_PANEL_WORD_* names of omx_panel_word_t, in order, NONE first. */
export function enumWords(text = readFileSync(API_HEADER, 'utf8')) {
  const body = text.match(/typedef enum\s*\w*\s*\{([^}]*)\}\s*omx_panel_word_t;/);
  return body ? [...body[1].matchAll(/\bOMX_PANEL_WORD_([A-Z0-9_]+)/g)].map((m) => m[1]) : [];
}

/** Every problem of the header and the enum against the gestures domain. */
export function problems(words, header, enumNames) {
  const out = [];
  if (header !== emitWordsHeader(words)) out.push('renderer/src/gesture_words.h is not what the gestures domain gives: run node tools/gesture-words.mjs');
  const want = ['NONE', ...words.map((w) => w.toUpperCase())];
  if (enumNames.join(' ') !== want.join(' '))
    out.push(`omx_panel_word_t names ${enumNames.join(' ')}; the gestures domain gives ${want.join(' ')}, in that order (GESTURES_WORDS: ${words.join(' ')})`);
  return out;
}

if (isMain(import.meta.url)) {
  const at = process.argv.indexOf('--contract-dir');
  let words;
  try { words = declaredWords(at >= 0 ? process.argv[at + 1] : CONTRACT_DIR); } catch (e) {
    if (!(e instanceof GesturesDomainError)) throw e;
    console.error(`gesture-words: ${e.message}`);
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    let header = '';
    try { header = readFileSync(WORDS_HEADER, 'utf8'); } catch { /* absent: a problem below */ }
    const bad = problems(words, header, enumWords());
    // the check sees what it guards: a reordered word list and a missing enum entry are each refused
    const swapped = [words[1], words[0], ...words.slice(2)];
    const sabotage = [problems(swapped, emitWordsHeader(words), ['NONE', ...words.map((w) => w.toUpperCase())]),
                      problems(words, emitWordsHeader(words), ['NONE', ...words.slice(1).map((w) => w.toUpperCase())])];
    if (sabotage.some((p) => p.length === 0)) { console.error('gesture-words --check: a planted fault was not refused'); process.exit(1); }
    for (const p of bad) console.error(`gesture-words: ${p}`);
    if (bad.length) process.exit(1);
    console.log(`gesture-words: ${words.length} words, the header and omx_panel_word_t as the gestures domain gives them (2 planted faults refused)`);
  } else {
    writeFileSync(WORDS_HEADER, emitWordsHeader(words));
    console.log(`gesture-words: wrote renderer/src/gesture_words.h (${words.length} words)`);
  }
}
