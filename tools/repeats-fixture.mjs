// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * tools/repeats-fixture.mjs <descriptor> [<panel>] — a panel description as `omx-panel layout` writes it, with the sections of
 * the plugin's repeated group merged into one that carries `matrix` (the group model's matrixOf: docs/renderer.md). The test
 * fixtures test/fixtures/repeats/<name>.layout.json are its output, kept until the served description carries the field itself
 * (omx-panel#61); writing them here keeps the matrix the library's and no test's.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlsOfDescriptor, inferGroupModel, matrixOf, memberSymbols } from './group-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [descriptorFile, panelFile] = process.argv.slice(2);
if (!descriptorFile) { process.stderr.write('usage: repeats-fixture.mjs <descriptor> [<panel>]\n'); process.exit(2); }
const descriptor = JSON.parse(readFileSync(descriptorFile, 'utf8'));
const panel = panelFile ? JSON.parse(readFileSync(panelFile, 'utf8')) : undefined;
const layout = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'dist', 'bin', 'omx-panel.mjs'), 'layout', '--descriptor', descriptorFile, ...(panelFile ? ['--panel', panelFile] : [])], { encoding: 'utf8' }));

const { groups } = inferGroupModel(controlsOfDescriptor(descriptor, panel ? { panel } : {}));
const g = groups.find((x) => x.kind === 'repeated');
if (!g) throw new Error('no repeated group');
const members = new Set(memberSymbols(g));
const touched = [...new Set(layout.controls.filter((c) => members.has(c.symbol)).map((c) => c.section))].sort((a, b) => a - b);
const inTouched = layout.controls.filter((c) => touched.includes(c.section)).map((c) => c.symbol);
if (inTouched.some((s) => !members.has(s))) throw new Error('the group shares its sections with other controls');

const m = matrixOf(g);
const columns = m.orientation === 'columns';
const heads = (columns ? m.columns : m.rows).map((h) => ({ label: h.label, on: h.on ? h.on.symbol : null, edge: h.edge ?? null }));
const rows = (columns ? m.rows : m.columns).map((r) => ({ label: r.label }));
const cells = columns ? m.cells : rows.map((_, r) => heads.map((_, h) => m.cells[h][r]));

const host = touched[0];
const sectionAt = (i) => (touched.includes(i) ? host : i - touched.filter((t) => t < i && t !== host).length);
const old = layout.sections;
layout.sections = old.flatMap((s, i) => (i === host ? [{ ...s, label: g.label ?? s.label, matrix: { orientation: m.orientation, heads, rows, cells } }] : touched.includes(i) ? [] : [s]));
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
