// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * Sabotage rows for the store: each arm breaks one rule of docs/descriptions-store.md in a copy of src/store.c, builds the
 * command from the copy and runs the reader's tests against it; the arm holds when they go red. An arm first proves its
 * injection landed: the text it replaces is in the source exactly once. The untouched source is the first test.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { STORE, tmp } from './helpers.mjs';

const SOURCE = readFileSync(join(STORE, 'src', 'store.c'), 'utf8');
const pkg = execFileSync('pkg-config', ['--cflags', '--libs', 'sqlite3', 'libcjson', 'libomx-domain'], { encoding: 'utf8' }).trim().split(/\s+/);

/** The reader's tests (the reader's and the writer's files, not this one) run against a command built from `source`: their exit status. */
function against(t, source) {
  const dir = tmp(t, 'omx-panel-store-sab-');
  writeFileSync(join(dir, 'store.c'), source);
  const cmd = join(dir, 'omx-panel-store');
  execFileSync('cc', ['-std=c11', '-O1', '-Wall', '-Wno-unused-function', `-I${join(STORE, 'include')}`, `-I${join(STORE, 'src')}`, `-I${join(STORE, 'build')}`,
    '-o', cmd, join(dir, 'store.c'), join(STORE, 'src', 'cli.c'), ...pkg], { stdio: ['ignore', 'pipe', 'pipe'] });
  return spawnSync(process.execPath, ['--no-warnings', '--test', '--test-concurrency=2', join(STORE, 'test', 'store.test.mjs'), join(STORE, 'test', 'writer.test.mjs')], { encoding: 'utf8', env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), OMX_PANEL_STORE_TEST_CMD: cmd } }).status;
}

test('the untouched store.c passes the reader\'s tests, so a red arm is the arm\'s doing', (t) => assert.equal(against(t, SOURCE), 0));

/** [what the arm breaks, the text it replaces (once in store.c), what it puts there] */
const ARMS = [
  ['groups of the base are taken under a user description', 'int r = fill_children(s, f, id, e);', 'int r = fill_children(s, &s->f[s->nf - 1], id, e);'],
  ['a source that differs is not stale', 'int stale = strcmp((const char *)sqlite3_column_text(st, 4), source) != 0;', 'int stale = 0;'],
  ['a derived entry below the reader\'s rules is served', 'if (!stale && !edited && rules < s->rules) stale = 1;', 'if (0) stale = 1;'],
  ['an edited entry is staled by rules too', 'if (!stale && !edited && rules < s->rules) stale = 1;', 'if (!stale && rules < s->rules) stale = 1;'],
  ['a stale edited entry is not named', 'if (edited && !e->stale_edit_layer) e->stale_edit_layer = LAYER_NAME[f->layer];', ';'],
  ['the system scope has a home', 'if (scope == OMX_PANEL_STORE_SCOPE_USER) {', 'if (1) {'],
  ['files at two versions are not compared first', 'if (differ) {', 'if (0) {'],
  ['a hot journal is not named', 'case SQLITE_READONLY: return OMX_PANEL_STORE_HOT_JOURNAL;', 'case SQLITE_READONLY: return OMX_PANEL_STORE_UNREADABLE;'],
  ['no busy timeout', '#define READER_BUSY_MS 250', '#define READER_BUSY_MS 0'],
];
for (const [what, from, to] of ARMS) {
  test(`sabotage: ${what}`, (t) => {
    assert.equal(SOURCE.split(from).length - 1, 1, 'the injection lands once');
    assert.notEqual(against(t, SOURCE.replace(from, to)), 0, 'the reader\'s tests catch it');
  });
}
