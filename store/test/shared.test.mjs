// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The shared library (build/libomx-panel-store.so.0) exports every function its header declares and nothing else, under
 * its soname, and abi/omx_panel_store.abi, src/exports.map and the header agree both ways.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { LIB, STORE } from './helpers.mjs';

const declared = [...new Set([...readFileSync(join(STORE, 'include/omx-panel/omx_panel_store.h'), 'utf8').matchAll(/\b(omx_panel_store_[a-z_]+)\s*\(/g)].map((m) => m[1]))].sort();
const nm = execFileSync('nm', ['-D', '--defined-only', LIB], { encoding: 'utf8' }).split('\n').map((l) => l.trim().split(/\s+/)).filter((f) => f.length === 3 && f[1] === 'T').map((f) => f[2].replace(/@.*$/, '')).sort();
const mapped = [...readFileSync(join(STORE, 'src/exports.map'), 'utf8').matchAll(/^\s+(omx_panel_store_[a-z_]+);/gm)].map((m) => m[1]).sort();
const abi = readFileSync(join(STORE, 'abi/omx_panel_store.abi'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('@@')[0]).sort();

test('every function the header declares is exported, and nothing else is', () => assert.deepEqual(nm, declared));
test('the export map and the ABI file list the same functions as the header', () => { assert.deepEqual(mapped, declared); assert.deepEqual(abi, declared); });
test('the soname is libomx-panel-store.so.0', () => assert.match(execFileSync('objdump', ['-p', LIB], { encoding: 'utf8' }), /SONAME\s+libomx-panel-store\.so\.0/));
