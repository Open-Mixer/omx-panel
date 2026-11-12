#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * gesture-words.mjs — renderer/src/gesture_words.h, the gesture word names of schema/gestures.json in their declared
 * order, the table omx_panel_word_name (the C library) and the omx-panel-render command answer from (#23). The enum
 * omx_panel_word_t of renderer/include/omx_panel_render.h names the same words, OMX_PANEL_WORD_<WORD>, in the same order
 * after OMX_PANEL_WORD_NONE: --check holds both to gestures.json.
 *
 *   node tools/gesture-words.mjs           write the header
 *   node tools/gesture-words.mjs --check   exit 1 when the header or the enum is not what gestures.json gives
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GESTURES = join(ROOT, 'schema', 'gestures.json');
export const WORDS_HEADER = join(ROOT, 'renderer', 'src', 'gesture_words.h');
const API_HEADER = join(ROOT, 'renderer', 'include', 'omx_panel_render.h');

/** The declared words, in their order. */
export const declaredWords = (doc = JSON.parse(readFileSync(GESTURES, 'utf8'))) => Object.keys(doc.words);

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

/** Every problem of the header and the enum against gestures.json. */
export function problems(words, header, enumNames) {
  const out = [];
  if (header !== emitWordsHeader(words)) out.push('renderer/src/gesture_words.h is not what gestures.json gives: run node tools/gesture-words.mjs');
  const want = ['NONE', ...words.map((w) => w.toUpperCase())];
  if (enumNames.join(' ') !== want.join(' '))
    out.push(`omx_panel_word_t names ${enumNames.join(' ')}; gestures.json gives ${want.join(' ')}, in that order`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const words = declaredWords();
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
    console.log(`gesture-words: ${words.length} words, the header and omx_panel_word_t as gestures.json gives them (2 planted faults refused)`);
  } else {
    writeFileSync(WORDS_HEADER, emitWordsHeader(words));
    console.log(`gesture-words: wrote renderer/src/gesture_words.h (${words.length} words)`);
  }
}
