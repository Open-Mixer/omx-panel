// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The lv2-complement bundle writes one pg:group per instance of a repeated group (docs/group-model.md, P2;
 * Open-Mixer/zynthian-ui#54), so lilv hands a band over as a group of its own. Over the Calf multiband compressor's own
 * TTL (the flat inference refuses it, `unplaced-controls`), and omx-eq8, which declares its bands already.
 */
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pluginUris } from '../dist/tools/group-infer.mjs';
import { outName, planBundle, readInstalledBundle, sync } from '../dist/tools/lv2-complement.mjs';
import { parseTurtle } from '../dist/tools/turtle-read.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CALF = join(ROOT, 'test/fixtures/group-model/lv2/calf-multiband-compressor');
const EQ8 = join(ROOT, 'test/fixtures/lv2-groups/omx-eq8');
const LV2 = 'http://lv2plug.in/ns/lv2core#';
const PG = 'http://lv2plug.in/ns/ext/port-groups#';

/** An installed-shaped bundle of a fixture directory's TTL, under a fresh scratch tree. */
function installed(fixture, name) {
  const root = mkdtempSync(join(tmpdir(), 'omx-lv2-instances-'));
  const dir = join(root, 'lv2', `${name}.lv2`);
  mkdirSync(dir, { recursive: true });
  const files = readdirSync(fixture).filter((f) => f.endsWith('.ttl'));
  for (const f of files) cpSync(join(fixture, f), join(dir, f));
  const uris = files.flatMap((f) => pluginUris(parseTurtle(readFileSync(join(dir, f), 'utf8'), pathToFileURL(join(dir, f)).href)));
  writeFileSync(join(dir, `${name}.so`), '');
  writeFileSync(join(dir, 'manifest.ttl'), `@prefix lv2: <${LV2}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
${uris.map((u) => `<${u}> a lv2:Plugin ; lv2:binary <${name}.so> ; rdfs:seeAlso ${files.map((f) => `<${f}>`).join(' , ')} .`).join('\n')}
`);
  return { root, dir, files };
}
const planOf = (dir) => planBundle(/** @type {any} */ (readInstalledBundle(dir)));

describe('P2: one pg:group per instance', () => {
  it('the Calf multiband compressor: its four bands are four groups, each holding exactly its band\'s ports', () => {
    const { root, dir } = installed(CALF, 'calf');
    const plan = planOf(dir);
    const verdict = plan.plugins[0].verdict;
    assert.equal(verdict.outcome, 'grouped');
    const instances = verdict.groups.filter((g) => /\d$/.test(g.symbol));
    assert.equal(instances.length, 4);
    for (const [n, g] of instances.entries()) {
      assert.ok(g.ports.length >= 9, `band ${n + 1} holds its on/off and its rows`);
      assert.ok(g.ports.every((p) => p.endsWith(String(n))), `band ${n + 1}: ${g.ports}`);
      assert.ok(g.ports.includes(`bypass${n}`), 'its on/off is in it');
    }
    assert.deepEqual(instances.map((g) => g.displayPriority), [...instances.map((g) => g.displayPriority)].sort((a, b) => b - a), 'the order of the bands');
    // and as written: lilv's view, one pg:group per port of a band, four nodes
    const out = join(root, 'out');
    const r = sync({ lv2Path: `${out}:${join(root, 'lv2')}`, outDir: out, stateDir: join(root, 'state'), log: () => {} });
    assert.equal(r.counts.written, 1);
    const file = join(out, outName(dir), 'MultibandCompressor.ttl');
    const t = parseTurtle(readFileSync(file, 'utf8'), pathToFileURL(file).href);
    const symbolOf = new Map(t.filter((x) => x.p.v === `${LV2}symbol`).map((x) => [x.s.v ?? `_:${x.s.v}`, x.o.v]));
    const nodeOf = (symbol) => t.filter((x) => x.p.v === `${PG}group` && symbolOf.get(x.s.v) === symbol).map((x) => x.o.v);
    const groupOfBand = [0, 1, 2, 3].map((n) => new Set(['bypass', 'threshold', 'ratio', 'solo'].flatMap((s) => nodeOf(`${s}${n}`))));
    for (const s of groupOfBand) assert.equal(s.size, 1, 'one group for the band');
    assert.equal(new Set(groupOfBand.map((s) => [...s][0])).size, 4, 'four bands, four groups');
  });

  it('a plugin that declares its instances already (omx-eq8) gets nothing added', () => {
    const { dir } = installed(EQ8, 'eq8');
    const plan = planOf(dir);
    assert.equal(plan.write, false);
    assert.equal(plan.plugins[0].verdict.outcome, 'nothing-to-do');
  });
});
