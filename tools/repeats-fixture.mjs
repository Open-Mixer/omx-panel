// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * tools/repeats-fixture.mjs <descriptor> [<panel>] — a panel description as `omx-panel layout` writes it, with the sections of
 * the plugin's repeated group merged into one that carries `matrix` (the matrix `omx-panel describe` serves: docs/renderer.md). The test
 * fixtures test/fixtures/repeats/<name>.layout.json are its output, kept until the served description carries the field itself
 * (omx-panel#61); writing them here keeps the matrix the library's and no test's.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [descriptorFile, panelFile] = process.argv.slice(2);
if (!descriptorFile) { process.stderr.write('usage: repeats-fixture.mjs <descriptor> [<panel>]\n'); process.exit(2); }
const descriptor = JSON.parse(readFileSync(descriptorFile, 'utf8'));
const panel = panelFile ? JSON.parse(readFileSync(panelFile, 'utf8')) : undefined;
const layout = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'dist', 'bin', 'omx-panel.mjs'), 'layout', '--descriptor', descriptorFile, ...(panelFile ? ['--panel', panelFile] : [])], { encoding: 'utf8' }));

// the matrix is the one `omx-panel describe` SERVES on the section that holds the group (docs/group-model.md): read, never derived here
const served = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'dist', 'bin', 'omx-panel.mjs'), 'describe', '--descriptor', descriptorFile, ...(panelFile ? ['--panel', panelFile] : [])], { encoding: 'utf8' })).description;
const matrix = served.sections.find((x) => x.matrix)?.matrix;
if (!matrix) throw new Error('the served description carries no matrix');
const members = new Set([...matrix.heads.flatMap((h) => (h.on ? [h.on.symbol] : [])), ...matrix.cells.flat().filter(Boolean), ...(matrix.count ? [matrix.count.symbol] : [])]);
const touched = [...new Set(layout.controls.filter((c) => members.has(c.symbol)).map((c) => c.section))].sort((a, b) => a - b);
const inTouched = layout.controls.filter((c) => touched.includes(c.section)).map((c) => c.symbol);
if (inTouched.some((sym) => !members.has(sym) && sym !== matrix.count?.symbol)) throw new Error('the group shares its sections with other controls');
// The served section keeps its first section's label ('Bands / Band 1'); the MOD GUI face titles the merged section by the
// group's ('Bands'). The face's title is used here until describe serves the group's (reported on the base's PR): the parity
// test holds the renderer to the face.
const modgui = await import(join(ROOT, 'dist', 'tools', 'modgui-gen.mjs'));
const face = modgui.layout(modgui.resolvePanel(descriptor, { panel, stem: 'x' })).sections.find((x) => x.matrix);
const g = { label: face?.label ?? served.sections.find((x) => x.matrix).label };

const host = touched[0];
const sectionAt = (i) => (touched.includes(i) ? host : i - touched.filter((t) => t < i && t !== host).length);
const old = layout.sections;
layout.sections = old.flatMap((s, i) => (i === host ? [{ ...s, label: g.label ?? s.label, matrix }] : touched.includes(i) ? [] : [s]));
const keyOf = (i) => layout.sections[sectionAt(i)].key;
for (const c of layout.controls) {
  c.sectionKey = keyOf(c.section);
  c.section = sectionAt(c.section);
}
for (const d of layout.displays ?? []) {
  if (typeof d.section === 'number') { d.sectionKey = keyOf(d.section); d.section = sectionAt(d.section); }
  else if (typeof d.section === 'string') d.section = keyOf(old.findIndex((s) => s.key === d.section));
}
process.stdout.write(`${JSON.stringify(layout, null, 1)}\n`);
