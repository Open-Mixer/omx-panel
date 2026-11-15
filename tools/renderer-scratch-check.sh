#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# tools/renderer-scratch-check.sh <command...> — runs the command (the renderer's `make check`) with TMPDIR set to a
# private directory, then counts the scratch directories the renderer's tests left there (omx-panel-render-*,
# omx-meter-tk-*). Then a test that FAILS, through the same harness, in a second private TMPDIR: a failure must not
# leave its scratch behind either. Prints one `scratch left:` line per run; exits with the command's status when it
# failed, else 1 when any scratch was left. OMX_PANEL_KEEP_SCRATCH=1 (keep the scratch to debug a failure) makes the
# counts meaningless, so it is refused here.
set -u
[ $# -ge 1 ] || { echo "usage: $0 <command...>" >&2; exit 2; }
[ "${OMX_PANEL_KEEP_SCRATCH:-}" = 1 ] && { echo "$0: OMX_PANEL_KEEP_SCRATCH=1 keeps the scratch; unset it to count" >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/omx-panel-scratch-check.XXXXXX") || exit 2
trap 'rm -rf "$WORK"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$WORK/run" "$WORK/fail"

left() { find "$1" -mindepth 1 -maxdepth 1 \( -name 'omx-panel-render-*' -o -name 'omx-meter-tk-*' \) | wc -l | tr -d ' '; }

TMPDIR="$WORK/run" "$@"
rc=$?
n=$(left "$WORK/run")
echo "scratch left: $n by: $*"

# a test that fails after taking scratch, as a renderer test does
cat > "$WORK/failing.test.mjs" <<JS
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scratch } from '$ROOT/renderer/test/harness.mjs';
test('fails holding scratch', () => { writeFileSync(join(scratch(), 'x'), 'x'); throw new Error('meant to fail'); });
JS
TMPDIR="$WORK/fail" node --test "$WORK/failing.test.mjs" >"$WORK/failing.log" 2>&1 && { echo "the failing test passed" >&2; cat "$WORK/failing.log" >&2; exit 2; }
f=$(left "$WORK/fail")
echo "scratch left: $f by a failing test"

[ "$rc" -eq 0 ] || exit "$rc"
[ "$n" -eq 0 ] && [ "$f" -eq 0 ] || exit 1
