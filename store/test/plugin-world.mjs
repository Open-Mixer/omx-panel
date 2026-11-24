// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * A world of installed LV2 plugins for the descriptions store's producer tests (docs/descriptions-store.md section 6):
 * two bundles on a search path (triplePara, which the complement groups, and delayorama), the descriptors a scan writes
 * for them, an empty base and the contract directories, and the environment that points the store command at them.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readPluginPorts } from '../../dist/tools/group-infer.mjs';
import { pluginTriples, readInstalledBundle } from '../../dist/tools/lv2-complement.mjs';
import { CMD, DatabaseSync, contractDir, mkStore, panelVersion, ROOT, run, tmp } from './helpers.mjs';

export const OMX_PANEL = join(ROOT, 'dist', 'bin', 'omx-panel.mjs');
export const LV2 = 'http://lv2plug.in/ns/lv2core#';
export const TRIPLE = 'http://plugin.org.uk/swh-plugins/triplePara';
export const DELAY = 'http://plugin.org.uk/swh-plugins/delayorama';
export const FIXTURES = join(ROOT, 'test', 'fixtures');

/** The contract directories the derivation reads (the installed ones), with the store's fixture panel and plugin-db over them. */
export function contract(dir) {
  const from = (process.env.OMX_CONTRACT_PATH || '/usr/share/omx-contract/contract.d').split(':').filter(Boolean).reverse();
  for (const d of from) if (existsSync(d)) cpSync(d, dir, { recursive: true });
  return contractDir(dir);
}

/** An installed bundle: the fixture's TTL, a manifest naming it and its binary, and the binary (bytes of its own). */
export function bundle(lv2, name, fixture, uri) {
  const dir = join(lv2, `${name}.lv2`);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(FIXTURES, 'lv2-groups', fixture, 'plugin.ttl'), join(dir, 'plugin.ttl'));
  writeFileSync(join(dir, `${name}.so`), `the ${name} binary\n`);
  writeFileSync(join(dir, 'manifest.ttl'), `@prefix lv2: <${LV2}> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n`
    + `<${uri}> a lv2:Plugin ; lv2:binary <${name}.so> ; rdfs:seeAlso <plugin.ttl> .\n`);
  return { dir, binary: join(dir, `${name}.so`), uri };
}

/** The descriptor a scan writes for an installed LV2 plugin, made from its ports (its id the port symbol, as a scan's): no control states a group. */
export function descriptorOf(b) {
  const ports = readPluginPorts(pluginTriples(readInstalledBundle(b.dir), b.uri), b.uri).ports.filter((p) => p.control && p.input);
  return {
    plugin: { format: 'lv2', id: b.uri, uri: b.uri, name: b.uri.split('/').at(-1), vendor: 'swh' },
    origin: 'scanned',
    controls: ports.map((p) => ({ id: p.symbol, name: p.name, kind: 'travel', travel: { min: p.min ?? 0, max: p.max ?? 1, default: p.min ?? 0, unit: '', scale: 'linear' } })),
  };
}

export const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
export const sourceOf = (format, path) => {
  const r = run(['source', '--format', format, '--path', path]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
export const keysOf = (path) => {
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db.prepare('SELECT sha256, format, uri FROM plugin ORDER BY uri').all().map((r) => ({ ...r }));
  db.close();
  return rows;
};

/** A world: two bundles on the search path, their descriptors where a scan writes them, an empty base, no layer yet. */
export function world(t, { descriptors = true } = {}) {
  const d = tmp(t, 'omx-panel-plugin-world-');
  const lv2 = join(d, 'lv2');
  const triple = bundle(lv2, 'triple_para-swh', 'swh-triplepara', TRIPLE);
  const delay = bundle(lv2, 'delayorama-swh', 'swh-delayorama', DELAY);
  const scans = join(d, 'descriptors');
  mkdirSync(scans, { recursive: true });
  if (descriptors) for (const b of [triple, delay]) writeFileSync(join(scans, `${b.uri.split('/').at(-1)}.json`), JSON.stringify(descriptorOf(b)));
  const places = { base: join(d, 'share', 'panel.sqlite'), system: join(d, 'var', 'panel.sqlite'), user: join(d, 'home', 'panel.sqlite'), contract: contract(join(d, 'contract.d')) };
  mkStore(places.base, { layer: 0, panel: panelVersion(places.contract) });
  return { d, lv2, triple, delay, scans, places };
}

/** The environment of a producer run in world `w`: the places by the command's variables, the search path, the scans. */
export const storeEnv = (w, extra = {}) => ({
  PATH: dirname(CMD), LV2_PATH: w.lv2, DESCRIPTOR_DIRS: w.scans, HOME: join(w.d, 'nohome'),
  OMX_PANEL_STORE_BASE: w.places.base, OMX_PANEL_STORE_SYSTEM: w.places.system, OMX_PANEL_STORE_USER: w.places.user, OMX_CONTRACT_PATH: w.places.contract,
  ...extra,
});
