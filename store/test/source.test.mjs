// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * omx_panel_store_source (docs/descriptions-store.md, 3.6): one function hashes the derivation's input, so every caller
 * hashes the same bytes the same way. The oracle here is node's own SHA-256 over the bytes the spec states.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { run, tmp } from './helpers.mjs';

const source = (format, path) => run(['source', '--format', format, '--path', path]);

test('an LV2 bundle: its .ttl files in byte order of their names, each a name, a NUL and its bytes; other files are not read', (t) => {
  const d = tmp(t);
  const files = { 'b.ttl': '@prefix a: <x> .\n', 'a.ttl': 'a', 'Z.ttl': 'é\n' };
  for (const [n, c] of Object.entries(files)) writeFileSync(join(d, n), c);
  writeFileSync(join(d, 'plugin.so'), 'binary');
  mkdirSync(join(d, 'sub.ttl'));
  const h = createHash('sha256');
  for (const n of ['Z.ttl', 'a.ttl', 'b.ttl']) { h.update(n); h.update(Buffer.from([0])); h.update(files[n]); }
  // sub.ttl is a directory and is no file of the bundle
  const r = source('lv2', d);
  assert.equal(r.status, 1, 'a directory named .ttl cannot be read: refused, not skipped');
  const d2 = tmp(t);
  for (const [n, c] of Object.entries(files)) writeFileSync(join(d2, n), c);
  writeFileSync(join(d2, 'plugin.so'), 'binary');
  const ok = source('lv2', d2);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout.trim(), h.digest('hex'));
  writeFileSync(join(d2, 'a.ttl'), 'changed');
  assert.notEqual(source('lv2', d2).stdout.trim(), ok.stdout.trim(), 'a changed TTL is another source');
});

test('a CLAP descriptor: canonical JSON, object keys in byte order and no white space, so key order and layout do not matter', (t) => {
  const d = tmp(t);
  writeFileSync(join(d, 'a.json'), '{"b": [1, 2, {"y":1,"x":"é"}], "a": true, "c": null}');
  writeFileSync(join(d, 'b.json'), '{"c":null,"a":true,\n "b":[1,2,{"x":"é","y":1}]}');
  const want = createHash('sha256').update('{"a":true,"b":[1,2,{"x":"é","y":1}],"c":null}').digest('hex');
  const a = source('clap', join(d, 'a.json'));
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout.trim(), want);
  assert.equal(source('clap', join(d, 'b.json')).stdout.trim(), want);
  writeFileSync(join(d, 'c.json'), '{"a":false,"b":[1,2,{"x":"é","y":1}],"c":null}');
  assert.notEqual(source('clap', join(d, 'c.json')).stdout.trim(), want);
});

test('a format that is not lv2 or clap, a missing path and a file that is not JSON are refused', (t) => {
  const d = tmp(t);
  writeFileSync(join(d, 'x.json'), 'nope');
  assert.equal(source('vst3', d).status, 1);
  assert.equal(source('lv2', join(d, 'absent')).status, 1);
  assert.equal(source('clap', join(d, 'x.json')).status, 1);
  assert.equal(run(['source', '--format', 'lv2']).status, 2);
});
