// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The drop-ins omx-panel ships for plugin-qualify-sync.service (systemd/plugin-qualify-sync.service.d/) queue an opt-in
// unit after each good sync. Each ExecStartPost command, run under a systemctl that answers as the machine would:
// with its unit disabled (the package's default) it exits 0 and starts nothing, so a good sync never reports a failed
// post step (plugin-qualify#56: "ExecStartPost exits 1" after every sync on a Raspberry Pi 5); with it enabled it
// queues the unit with --no-block and exits 0.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'systemd', 'plugin-qualify-sync.service.d');

/** The command of a drop-in's ExecStartPost: the shell's -c script, with the '-' prefix noted. */
function postOf(text) {
  const m = /^ExecStartPost=(-?)\/bin\/sh -c '([^']*)'$/m.exec(text);
  assert.ok(m, 'an ExecStartPost=/bin/sh -c \'...\' line');
  return { ignored: m[1] === '-', script: m[2] };
}

/** Runs the script with a systemctl on PATH that answers is-enabled with `enabled` and logs every call. */
function run(script, enabled) {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-sync-post-'));
  const log = join(dir, 'calls');
  writeFileSync(log, '');
  writeFileSync(join(dir, 'systemctl'), `#!/bin/sh\necho "$*" >> '${log}'\n[ "$1" = is-enabled ] && exit ${enabled ? 0 : 1}\nexit 0\n`);
  chmodSync(join(dir, 'systemctl'), 0o755);
  const r = spawnSync('/bin/sh', ['-c', script], { env: { PATH: `${dir}:/usr/bin:/bin` }, encoding: 'utf8' });
  return { status: r.status, calls: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
}

const dropIns = readdirSync(DIR).filter((f) => f.endsWith('.conf')).sort();

test('the drop-ins are there to hold: one per opt-in unit omx-panel ships', () => {
  assert.deepEqual(dropIns, ['omx-complement-sync.conf', 'omx-modgui-sync.conf']);
});

for (const f of dropIns) {
  const unit = f.replace(/\.conf$/, '.service');
  const { script } = postOf(readFileSync(join(DIR, f), 'utf8'));

  test(`${f}: with ${unit} disabled, the post step exits 0 and starts nothing`, () => {
    const r = run(script, false);
    assert.equal(r.status, 0, `exits ${r.status}: systemctl status would show the post step failed after a good sync`);
    assert.deepEqual(r.calls.filter((c) => c.startsWith('start')), []);
  });

  test(`${f}: with ${unit} enabled, the post step queues it without waiting and exits 0`, () => {
    const r = run(script, true);
    assert.equal(r.status, 0);
    assert.deepEqual(r.calls.filter((c) => c.startsWith('start')), [`start --no-block ${unit}`]);
  });
}
