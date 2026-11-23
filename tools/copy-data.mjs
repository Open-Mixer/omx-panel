#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * copy-data.mjs — the second half of the build. tsc (allowJs) emits src/ as JavaScript and every module's
 * declarations; it also reprints the .mjs modules, so they are put back into dist/ as the tree holds them, byte for
 * byte. The files tsc does not emit go in beside the modules that read them, at the same relative paths (the
 * schemas, the look, the modgui terms, the test script, the fixture bundles), and the commands keep their execute bit. `npm run build`
 * runs it after tsc.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '@openmixer/omx-contract/entry';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/** The tree's own checks, which the package does not carry. */
const NOT_SHIPPED = ['tools/copy-data.mjs', 'tools/skin-schema-words.mjs', 'tools/codes-render.mjs'];
/** Every .mjs module the package carries, as the tree holds it. */
export const MODULES = ['bin', 'lib', 'tools'].flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith('.mjs')).map((f) => `${d}/${f}`)).filter((f) => !NOT_SHIPPED.includes(f));
/** The shipped fixture bundles (tools/fixtures.mjs), every file under fixtures/. */
const FIXTURES = readdirSync(join(ROOT, 'fixtures'), { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => relative(ROOT, join(e.parentPath, e.name)))
  .sort();
/** Every catalog the tree carries, catalogs/<lang>.json, one per listed language. */
const CATALOGS = readdirSync(join(ROOT, 'catalogs')).filter((f) => f.endsWith('.json')).sort().map((f) => `catalogs/${f}`);
/** What zynthian-ui reads from the installed tree (tests/test_bar_xy_gestures.py): the gesture parity scripts and the descriptors they name. */
const GESTURE_FIXTURES = ['test/fixtures/gestures/scripts.json', 'test/fixtures/dyn-curve/dyn.descriptor.json', 'test/fixtures/eq-marks/eq.descriptor.json', 'test/fixtures/organ/organ.descriptor.json'];
/** The panel domain, which the tools read their panel words from (tools/vocabulary.mjs panelWords): dist/ is a tree. */
const PANEL_DOMAIN = ['contract.d/panel/panel.json', ...readdirSync(join(ROOT, 'contract.d/panel/catalogs')).filter((f) => f.endsWith('.json')).sort().map((f) => `contract.d/panel/catalogs/${f}`)];
/** Every file dist/ carries that is not a module. */
export const DATA = [...FIXTURES, ...GESTURE_FIXTURES, ...PANEL_DOMAIN, 'schema/skin-package.schema.json', 'schema/codes.json', ...CATALOGS, 'schema/panel.schema.json', 'schema/gestures.json', 'schema/look-roles.json', 'tools/look.json', 'tools/look/geometry.json', 'tools/look/console-vintage.json', 'tools/look/knob-3d.svg', 'tools/look/fader-vintage.svg', 'schema/modgui-looks.json', 'tools/fonts/Inter-Regular.ttf', 'tools/fonts/Gelasio.woff2', 'tools/fonts/Gelasio-OFL.txt', 'tools/look/font-gelasio.json', 'tools/fonts/Inter-LICENSE.txt', 'tools/modgui-terms.ttl', 'tools/modgui-test.sh'];
/** The files dist/ runs as commands. */
export const COMMANDS = ['bin/omx-panel.mjs', 'tools/copies-check.mjs', 'tools/modgui-gen.mjs', 'tools/look.mjs', 'tools/lv2-complement.mjs', 'tools/gesture-words.mjs', 'tools/modgui-test.sh'];

/** Copy the modules and the data into `dist` (the build's second half): nothing happens on import, the command line calls this. */
export function copyData(dist = DIST) {
  // A shipped module that starts with a shebang is a command: it ships executable and its declaration carries no
  // shebang, or the release's lintian --fail-on warning refuses the DEB (script-not-executable; 0.13.6's
  // tools/gesture-words.mjs). Listing it is the one way it ships.
  const unlisted = MODULES.filter((f) => readFileSync(join(ROOT, f), 'utf8').startsWith('#!') && !COMMANDS.includes(f));
  if (unlisted.length > 0) throw new Error(`copy-data: ${unlisted.join(', ')} start with a shebang and are not in COMMANDS: list each, or drop its shebang`);
  for (const f of [...MODULES, ...DATA]) {
    mkdirSync(dirname(join(dist, f)), { recursive: true });
    copyFileSync(join(ROOT, f), join(dist, f));
  }
  for (const f of COMMANDS) chmodSync(join(dist, f), 0o755);
  // tsc copies a command's shebang into its declaration; a declaration never runs, so it carries none.
  for (const f of COMMANDS.filter((c) => c.endsWith('.mjs'))) {
    const d = join(dist, f.replace(/\.mjs$/, '.d.mts'));
    if (!existsSync(d)) continue;
    const text = readFileSync(d, 'utf8');
    if (text.startsWith('#!')) writeFileSync(d, text.slice(text.indexOf('\n') + 1));
  }
}

if (isMain(import.meta.url)) {
  try {
    copyData();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(`copy-data: ${MODULES.length} modules and ${DATA.length} data files into dist/ as the tree holds them, ${COMMANDS.length} commands executable`);
}
