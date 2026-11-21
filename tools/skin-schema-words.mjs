// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * skin-schema-words.mjs — the panel words schema/skin-package.schema.json validates (a skin's family, a display's kind
 * and source) written from the panel domain (tools/vocabulary.mjs panelWords: PANEL_FAMILIES, PANEL_DISPLAY_KINDS,
 * PANEL_DISPLAY_SOURCES), never typed by hand (sorting pass row V1).
 *
 *   node tools/skin-schema-words.mjs           write the three enums into schema/skin-package.schema.json
 *   node tools/skin-schema-words.mjs --check   exit 1 when the file is not what the domain gives
 *
 * The domain is opened where the tools open it ($OMX_CONTRACT_PATH, this tree's contract.d, the installed one).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '@openmixer/omx-contract/entry';
import { panelWords } from './vocabulary.mjs';

export const SCHEMA_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'skin-package.schema.json');

const list = (words) => `[${words.map((w) => JSON.stringify(w)).join(', ')}]`;

/** The schema's text with its family, display kind and display source enums the domain's words. */
export function skinSchemaText(text = readFileSync(SCHEMA_FILE, 'utf8')) {
  const slots = [
    [/("description": "A panel family[^"]*",\n\s*"enum": )\[[^\]]*\]/, 'PANEL_FAMILIES'],
    // a display's kind and source: the `displays` items, whose required members are kind, section and source
    [/("required": \["kind", "section", "source"\],\n\s*"properties": \{\n\s*"kind": \{ "enum": )\[[^\]]*\]/, 'PANEL_DISPLAY_KINDS'],
    [/("required": \["kind", "section", "source"\],\n(?:.*\n){3}\s*"source": \{ "enum": )\[[^\]]*\]/, 'PANEL_DISPLAY_SOURCES'],
  ];
  for (const [re, item] of slots) {
    if (!re.test(text)) throw new Error(`skin-schema-words: schema/skin-package.schema.json has no ${item} enum where it is written`);
    text = text.replace(re, (_, head) => head + list(panelWords(item)));
  }
  return text;
}

if (isMain(import.meta.url)) {
  const want = skinSchemaText();
  if (process.argv.includes('--check')) {
    if (readFileSync(SCHEMA_FILE, 'utf8') !== want) {
      console.error('skin-schema-words: schema/skin-package.schema.json is not what the panel domain gives: run node tools/skin-schema-words.mjs, then commit');
      process.exit(1);
    }
    console.log('skin-schema-words: schema/skin-package.schema.json is what the panel domain gives');
  } else {
    writeFileSync(SCHEMA_FILE, want);
    console.log('skin-schema-words: wrote schema/skin-package.schema.json');
  }
}
