#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# tools/installed-tools-check.sh <pkgdir>: the tools as the package installs them run, from <pkgdir> (/usr/share/omx-panel
# on a host, %{buildroot}/usr/share/omx-panel in %check, debian/omx-panel/usr/share/omx-panel in debian/rules):
#
#   1. every installed tool that imports @openmixer/omx-contract loads: the bare name resolves through the package's
#      node_modules/@openmixer/omx-contract, a link to the omx-contract package's /usr/lib/omx-contract (0.15.0 shipped
#      none, and `node /usr/share/omx-panel/tools/modgui-gen.mjs` died with ERR_MODULE_NOT_FOUND);
#   2. the installed MOD GUI generator, run as a command, finds omx-plugins' committed MOD GUI of omx-delay
#      (test/fixtures/omx-delay, the film strip left out) fresh: exit 0 and "every generated file is fresh".
#
# The fixture is the source tree's, next to this script; the tools are the installed ones.
#
# tools/installed-tools-check.sh <pkgdir> <staged contract dir>: in a package build. The tools open the panel domain when
# they load, and a build host has no omx-panel-contract installed: the domain is the one the same build staged
# (%{buildroot}%{omx_contract_dir} in %check, debian/tmp/usr/share/omx-contract/contract.d in debian/rules). It
# goes first on the tools' OMX_CONTRACT_PATH, before the installed contract directory (omx-contract's, where the param
# domain and the packages' contract data are). v0.16.0's deb build ran without it, and every tool that opens the panel
# domain refused (#208). With no second argument the tools read the installed domain, as on a host.
set -uo pipefail

PKGDIR=${1:?usage: installed-tools-check.sh <pkgdir, e.g. /usr/share/omx-panel> [<staged contract dir>]}
STAGED=${2:-}
FIX=$(cd "$(dirname "$0")/../test/fixtures/omx-delay" && pwd)
fails=0
fail() { echo "FAIL $*"; fails=$((fails + 1)); }
pass() { echo "PASS $*"; }

[ -d "$PKGDIR/tools" ] || { echo "installed-tools-check: no $PKGDIR/tools" >&2; exit 2; }
if [ -n "$STAGED" ]; then
  [ -d "$STAGED" ] || { echo "installed-tools-check: no staged contract directory $STAGED" >&2; exit 2; }
  installed=$(pkg-config --variable=contractdir omx-contract 2>/dev/null)
  export OMX_CONTRACT_PATH="$STAGED:${installed:-/usr/share/omx-contract/contract.d}"
  echo "installed-tools-check: the panel domain from $STAGED (OMX_CONTRACT_PATH=$OMX_CONTRACT_PATH)"
fi

users=$(grep -l "@openmixer/omx-contract" "$PKGDIR"/tools/*.mjs)
[ -n "$users" ] || fail "no installed tool imports @openmixer/omx-contract: the check would prove nothing"
for t in $users; do
  # the path in the environment, not argv: argv[1] would make the tool's isMain true and run it
  if out=$(cd / && TOOL="$t" node --input-type=module -e 'await import(process.env.TOOL)' 2>&1); then
    pass "loads: $t"
  else
    fail "loads: $t: $(grep -m1 -E 'Error|Cannot' <<< "$out" || head -n1 <<< "$out")"
  fi
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp -R "$FIX/omx-delay.lv2" "$tmp/"
gen="$PKGDIR/tools/modgui-gen.mjs"
out=$(cd "$tmp" && node "$gen" --check --no-films --descriptor "$FIX/omx-delay.descriptor.json" --panel "$FIX/omx-delay.panel.json" \
  --out "$tmp/omx-delay.lv2" --source 'plugins/omx-delay/omx-delay.decl.json (its panel block) and tools/look.json' 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && grep -q 'every generated file is fresh' <<< "$out"; then
  pass "runs: $gen --check finds omx-delay's MOD GUI fresh"
else
  fail "runs: $gen --check exit $rc: $(grep -m1 -E 'Error|Cannot|stale|usage' <<< "$out" || head -n1 <<< "$out")"
fi

[ "$fails" -eq 0 ] || { echo "installed-tools-check: $fails failure(s) in $PKGDIR"; exit 1; }
echo "installed-tools-check: the installed tools load and run from $PKGDIR"
