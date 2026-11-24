// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * sheet-codes.mjs — a refusal code by its key, for the modules a browser loads as they are (easy.mjs, bars.mjs): read
 * from schema/codes.json, the panel domain's rendering of its codes (tools/codes-render.mjs, sorting pass rows V3, V2),
 * imported as JSON, so no Node import and no file read. Node tools read the domain itself (tools/vocabulary.mjs).
 */
import SHEET from '../schema/codes.json' with { type: 'json' };

/** The code of the sheet's `key` (`panelEasyRefused` -> `panel.describe.easy-refused`); a key the sheet lacks is refused by name. */
export function codeOf(key) {
  const e = SHEET.codes[key];
  if (!e) throw new Error(`sheet-codes: schema/codes.json has no code ${key}`);
  return e.code;
}
