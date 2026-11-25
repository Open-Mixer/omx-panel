// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// tools/install-under-test.sh installs the package file it is given over whatever copy is installed: a higher one (apt
// refuses a downgrade without --allow-downgrades, #248) and one of the same version (apt and dnf keep the installed copy
// and answer 0), and it fails when the installed package is not the file. The package managers are stand-ins on PATH that
// behave as apt 3.0 (trixie) and dnf5 (fedora 45) were measured to; the last arms take the proof away.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(ROOT, 'tools/install-under-test.sh');

// a package file is "<version> <contents>"; the installed one is $STATE, the same text
const FAKES = {
  'apt-get': `f="\${@: -1}"; read -r v c < "$f"; read -r iv ic < "$STATE" || iv=0
if [ "$iv" -gt "$v" ]; then case " $* " in *" --allow-downgrades "*) ;; *) echo "E: Packages were downgraded and -y was used without --allow-downgrades." >&2; exit 100;; esac; fi
if [ "$iv" = "$v" ]; then case " $* " in *" --reinstall "*) ;; *) exit 0;; esac; fi
[ -n "\${BREAK:-}" ] || cp "$f" "$STATE"`,
  'dpkg-deb': `case "$1" in -f) case "$3" in Package) echo zz;; Version) cut -d' ' -f1 "$2";; esac;; --fsys-tarfile) d=$(mktemp -d); mkdir -p "$d$(dirname "$SHARED")"; cut -d' ' -f2 "$2" > "$d$SHARED"; tar -C "$d" -cf - ".$SHARED";; esac`,
  'dpkg-query': `cut -d' ' -f1 "$STATE"`,
  dnf: `f="\${@: -1}"; read -r v c < "$f"; read -r iv ic < "$STATE" || iv=0
case "$1" in install) [ "$iv" = "$v" ] || [ -n "\${BREAK:-}" ] || cp "$f" "$STATE";; reinstall) [ "$iv" = "$v" ] || { echo "not installed" >&2; exit 1; }; [ -n "\${BREAK:-}" ] || cp "$f" "$STATE";; esac`,
  rpm: `case " $* " in *" -qp "*) f="\${@: -1}"; case "$*" in *SHA256HEADER*) cat "$f";; *) echo zz;; esac;; *) cat "$STATE";; esac`,
};

/** The tool run on a package of `version`/`contents` with `installed` in place: [status, what is installed, the output]. */
function run(format, installed, pkg, { broken = false, script = TOOL } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'under-test-'));
  try {
    for (const [name, body] of Object.entries(FAKES)) {
      // after each fake the shared file holds what the installed package holds
      writeFileSync(join(dir, name), `#!/bin/bash\n${body}\nrc=$?\n[ -s "$STATE" ] && cut -d' ' -f2 "$STATE" > "$SHARED"\nexit $rc\n`);
      chmodSync(join(dir, name), 0o755);
    }
    const state = join(dir, 'state');
    const file = join(dir, `zz.${format}`);
    writeFileSync(state, installed ? `${installed}\n` : '');
    writeFileSync(file, `${pkg}\n`);
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, STATE: state, SHARED: join(dir, 'shared'), ...(broken ? { BREAK: '1' } : {}) };
    const r = spawnSync('bash', [script, file], { encoding: 'utf8', env });
    return [r.status, readFileSync(state, 'utf8').trim(), r.stdout + r.stderr];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const format of ['deb', 'rpm']) {
  for (const [what, installed] of [['a higher copy', '2 channel'], ['a lower copy', '0 channel'], ['the same version with other contents', '1 channel'], ['no copy', '']])
    test(`${format}: the file is installed over ${what}`, () => {
      const [status, now, out] = run(format, installed, '1 local');
      assert.equal(status, 0, out);
      assert.equal(now, '1 local', out);
    });
  test(`${format}: an install that leaves another package in place fails, named`, () => {
    const [status, , out] = run(format, '1 channel', '1 local', { broken: true });
    assert.notEqual(status, 0, out);
    assert.match(out, /is not the package under test/);
  });
}

test('the runtime install check installs the contract package through it', () => {
  const s = readFileSync(join(ROOT, 'tools/runtime-install-check.sh'), 'utf8');
  assert.match(s, /install-under-test\.sh" "\$CPKG"/);
  // the one direct install that names it is omx-panel's own transaction (omx-panel requires it at its own version, which
  // the channel holds only once released, #257); the proof above runs after it all the same
  assert.doesNotMatch(s, /(?:dnf|apt-get) install[^\n]*(?<!"\$PKG" )"\$CPKG"/, 'the contract package is installed without the proof');
  const pkg = s.indexOf('"$PKG" "$CPKG"');
  assert.ok(pkg > 0 && pkg < s.indexOf('install-under-test.sh" "$CPKG"'), 'the proof does not run after omx-panel\'s own install');
});

test('sabotage: the tool without --allow-downgrades, --reinstall or dnf reinstall is red', () => {
  const src = readFileSync(TOOL, 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'under-test-arm-'));
  try {
    for (const [cut, format, installed] of [[' --allow-downgrades', 'deb', '2 channel'], [' --reinstall', 'deb', '1 channel'], ['dnf reinstall', 'rpm', '1 channel']]) {
      assert.ok(src.includes(cut), `the tool no longer has: ${cut}`);
      const script = join(dir, 'tool.sh');
      writeFileSync(script, src.replaceAll(cut, cut === 'dnf reinstall' ? 'true reinstall' : ''));
      assert.notEqual(run(format, installed, '1 local', { script })[0], 0, cut);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
