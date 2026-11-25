#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# tools/runtime-install-check.sh <omx-panel.rpm | .deb> <omx-panel-contract.rpm | .deb>: the package as a runtime install
# takes it, in a
# clean Fedora or Debian container with the OpenMixer channel configured:
#
#   1. the package's own Requires/Recommends (Depends/Recommends) name no -devel (-dev) package;
#   2. installed with weak dependencies off (install_weak_deps=False, --no-install-recommends), the transaction adds no
#      -devel (-dev) package;
#   3. omx-plugins-contract, the one recommendation, installed after it, adds none either;
#   4. `omx-panel vocabulary` reads the meanings, the standard units and the served units (omx-contract's param domain) from
#      /usr/share/omx-contract, with no omx-contract.pc and no variable set;
#   5. omx-dsp's loadCurve answers one curve through the package's node_modules/@openmixer/omx-dsp link;
#   6. the installed tools load and run (tools/installed-tools-check.sh): @openmixer/omx-contract resolves.
#
# The check judges only what omx-panel itself ships. The panel domain is the omx-panel-contract package's: that package,
# the second argument, is installed with omx-panel (omx-panel requires it at its own version, which the channel holds
# only once this version is released, so that requirement is met by the package this build made), and every file of it under /usr/share/omx-contract/contract.d is
# listed by its own file list and must be installed; a contract package that lists none fails, and a panel domain file in
# omx-panel itself is a second copy and fails.
# No descriptor of another package is demanded here: a package that ships its own descriptors checks them itself.
#
# A contract package the channel does not publish yet is named in $NOT_YET_PUBLISHED (a space list). The package is then
# installed without that one dependency (rpm --nodeps, dpkg --force-depends), and its owner's contract directory is
# unpacked from the -devel (-dev) package's payload at the path the contract package installs: the read is proven, the
# dependency is not, and a warning says so. A name in $NOT_YET_PUBLISHED that the channel does publish is refused, so
# the stand-in ends with the publication. Any other dependency the channel cannot satisfy fails.
set -euo pipefail

PKG=${1:?usage: runtime-install-check.sh <omx-panel.rpm | .deb> <omx-panel-contract.rpm | .deb>}
CPKG=${2:?usage: runtime-install-check.sh <omx-panel.rpm | .deb> <omx-panel-contract.rpm | .deb>}
NOT_YET_PUBLISHED=${NOT_YET_PUBLISHED:-}
CONTRACTDIR=/usr/share/omx-contract/contract.d
fails=0
fail() { echo "FAIL $*"; fails=$((fails + 1)); }
pass() { echo "PASS $*"; }
unverified=()
listed() { [[ " $NOT_YET_PUBLISHED " == *" $1 "* ]]; }

case "$PKG" in
  *.rpm)
    FORMAT=rpm
    DEVEL='-devel$|-static$'
    installed() { rpm -qa --qf '%{NAME}\n' | sort; }
    published() { [ -n "$(dnf -q repoquery --latest-limit=1 --whatprovides "$1" 2>/dev/null)" ]; }
    stand_in_of() { echo "${1%-contract}-devel"; }
    unpack() { (cd "$2" && dnf -q download "$1" >/dev/null 2>&1) && (cd / && rpm2cpio "$2"/*.rpm | cpio -idm --quiet "./usr/share/omx-contract/contract.d/3/$3/*"); }
    dnf install -y -q --setopt=install_weak_deps=False cpio >/dev/null 2>&1
    dnf -q makecache >/dev/null 2>&1
    reqs=$(rpm -qp --requires "$PKG" | grep -v -e '^rpmlib(' -e '^/' -e '^config(' | sed 's/ *$//')
    weak=$(rpm -qp --recommends "$PKG")
    shipped() { rpm -qpl "$CPKG" | grep -E '^/usr/share/omx-contract/contract\.d/' || true; }
    in_panel() { rpm -qpl "$PKG" | grep -E '^/usr/share/omx-contract/contract\.d/panel/' || true; }
    ;;
  *.deb)
    FORMAT=deb
    DEVEL='-dev$'
    installed() { dpkg-query -W -f '${Package}\n' | sort; }
    published() {
      local name=${1%% *} cand op ver
      cand=$(apt-cache policy "$name" 2>/dev/null | sed -n 's/^ *Candidate: //p')
      [ -n "$cand" ] && [ "$cand" != "(none)" ] || return 1
      if [[ "$1" =~ \((..?)\ (.*)\) ]]; then
        case "${BASH_REMATCH[1]}" in '>=') op=ge ;; '>>') op=gt ;; '=') op=eq ;; '<=') op=le ;; '<<') op=lt ;; esac
        ver=${BASH_REMATCH[2]}
        dpkg --compare-versions "$cand" "$op" "$ver" || { echo "the channel's $name is $cand, not ${BASH_REMATCH[1]} $ver" >&2; return 1; }
      fi
    }
    stand_in_of() { echo "${1%-contract}-dev"; }
    unpack() { (cd "$2" && apt-get download -q "$1" >/dev/null 2>&1 && dpkg-deb --fsys-tarfile ./*.deb | tar -x -C / "./usr/share/omx-contract/contract.d/3/$3"); }
    reqs=$(dpkg-deb -f "$PKG" Depends | tr ',' '\n' | sed 's/^ *//; s/ *$//' | grep -v '^$')
    weak=$(dpkg-deb -f "$PKG" Recommends | tr ',' '\n' | sed 's/^ *//; s/ *$//' | grep -v '^$' || true)
    shipped() { dpkg-deb -c "$CPKG" | awk '{print $NF}' | sed 's|^\.||' | grep -E '^/usr/share/omx-contract/contract\.d/' | grep -v '/$' || true; }
    in_panel() { dpkg-deb -c "$PKG" | awk '{print $NF}' | sed 's|^\.||' | grep -E '^/usr/share/omx-contract/contract\.d/panel/' | grep -v '/$' || true; }
    ;;
  *) echo "runtime-install-check: $PKG is neither an RPM nor a DEB" >&2; exit 2 ;;
esac

shipped_files=$(shipped)
# the contract package this build made: omx-panel's requirement on it is met by this file, not asked of the channel
OWN=$(case "$FORMAT" in rpm) rpm -qp --qf '%{NAME}' "$CPKG" ;; deb) dpkg-deb -f "$CPKG" Package ;; esac)

# 1. what the package itself asks for
bad=$(printf '%s\n' "$reqs" "$weak" | awk '{print $1}' | grep -E -- "$DEVEL" || true)
[ -z "$bad" ] && pass "$FORMAT: its dependencies and recommendations name no development package" \
  || fail "$FORMAT: it asks for a development package: $(echo $bad)"

# which requirements the channel satisfies; the rest must be named in $NOT_YET_PUBLISHED
have=() missing=()
while IFS= read -r req; do
  [ -n "$req" ] || continue
  name=$(echo "$req" | awk '{print $1}')
  if [ "$name" = "$OWN" ]; then
    pass "$FORMAT: '$req' is met by $(basename "$CPKG"), made by this build"
  elif published "$req"; then
    listed "$name" && fail "$name is published: remove it from NOT_YET_PUBLISHED"
    have+=("$name")
  elif listed "$name"; then
    missing+=("$name")
  else
    fail "the channel satisfies no '$req'"
  fi
done <<< "$reqs"
[ "$fails" -eq 0 ] || { echo "runtime-install-check: $fails check(s) failed" >&2; exit 1; }

# 2. the install, weak dependencies off
before=$(installed)
if [ ${#missing[@]} -eq 0 ]; then
  if [ "$FORMAT" = rpm ]; then dnf install -y -q --setopt=install_weak_deps=False "$PKG" "$CPKG" >/dev/null 2>&1
  else apt-get install -y -q --no-install-recommends "$PKG" "$CPKG" >/dev/null; fi
  pass "$FORMAT: installed through the resolver with $(basename "$CPKG"), every other dependency from the channel"
else
  if [ "$FORMAT" = rpm ]; then
    dnf install -y -q --setopt=install_weak_deps=False "${have[@]}" >/dev/null 2>&1
    rpm -i --nodeps "$PKG" "$CPKG"
  else
    apt-get install -y -q --no-install-recommends "${have[@]}" >/dev/null
    dpkg -i --force-depends "$PKG" "$CPKG" >/dev/null
  fi
  unverified+=("the dependency on ${missing[*]}: not published, so the package was installed without it")
fi
added=$(comm -13 <(echo "$before") <(installed))
echo "added: $(echo $added)"
bad=$(echo "$added" | grep -E -- "$DEVEL" || true)
[ -z "$bad" ] && pass "$FORMAT: the install adds no development package" || fail "$FORMAT: the install adds $(echo $bad)"

# 2b. the panel domain is omx-panel-contract's, installed with omx-panel: the list is that package's own, so it cannot
# drift from what it installs; omx-panel itself ships no panel domain file (a second copy)
copy=$(in_panel)
[ -z "$copy" ] && pass "$FORMAT: omx-panel ships no panel domain file of its own" \
  || fail "$FORMAT: omx-panel ships a second copy of the panel domain: $(echo $copy)"
if [ "$FORMAT" = rpm ]; then dnf install -y -q --setopt=install_weak_deps=False "$CPKG" >/dev/null 2>&1
else apt-get install -y -q --no-install-recommends "$CPKG" >/dev/null; fi
pass "$FORMAT: $(basename "$CPKG") installed"
[ -n "$shipped_files" ] || fail "$FORMAT: $CPKG ships no contract file under $CONTRACTDIR"
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if [ -e "$f" ]; then pass "$FORMAT: $f is installed"; else fail "$FORMAT: $f is in the package and not installed"; fi
done <<< "$shipped_files"

# the contract directories of the dependencies not yet published, from their -devel payloads
stand_in() {
  local owner=${1%-contract} from tmp
  from=$(stand_in_of "$1")
  tmp=$(mktemp -d)
  unpack "$from" "$tmp" "$owner"
  rm -rf "$tmp"
  [ -d "$CONTRACTDIR/3/$owner" ] || { fail "no $CONTRACTDIR/3/$owner in $from"; return; }
  unverified+=("$1 delivering $CONTRACTDIR/3/$owner: unpacked from $from's payload")
}
for m in "${missing[@]}"; do stand_in "$m"; done

# 3. the recommendation, on its own
# a rich RPM recommendation, (name >= a with name < b), is read by its name
for r in $(echo "$weak" | awk '{print $1}' | sed 's/^(//'); do
  before=$(installed)
  if published "$r"; then
    listed "$r" && fail "$r is published: remove it from NOT_YET_PUBLISHED"
    if [ "$FORMAT" = rpm ]; then dnf install -y -q --setopt=install_weak_deps=False "$r" >/dev/null 2>&1
    else apt-get install -y -q --no-install-recommends "$r" >/dev/null; fi
    bad=$(comm -13 <(echo "$before") <(installed) | grep -E -- "$DEVEL" || true)
    [ -z "$bad" ] && pass "$FORMAT: $r adds no development package" || fail "$FORMAT: $r adds $(echo $bad)"
  elif listed "$r"; then
    stand_in "$r"
  else
    fail "the channel publishes no $r"
  fi
done

# 4. the installed command reads the installed contract data, nothing set and no omx-contract.pc
[ ! -e /usr/share/pkgconfig/omx-contract.pc ] && [ ! -e /usr/lib64/pkgconfig/omx-contract.pc ] \
  && pass "no omx-contract.pc is installed" || fail "omx-contract.pc is installed: the lookup without it is not exercised"
want=$(case "$FORMAT" in rpm) rpm -qp --qf '%{VERSION}' "$PKG" ;; deb) dpkg-deb -f "$PKG" Version | cut -d- -f1 ;; esac)
[ "$(omx-panel --version)" = "omx-panel $want" ] && pass "omx-panel --version says $want" || fail "omx-panel --version says $(omx-panel --version), the package is $want"

out=$(env -u OMX_CONTRACT_PATH -u OMX_CONTRACT_SCHEMA omx-panel vocabulary || true)
echo "$out"
expect() { grep -qE "$2" <<< "$out" && pass "omx-panel vocabulary: $1" || fail "omx-panel vocabulary: $1"; }
expect "the contract directory is $CONTRACTDIR" "^ok   contractdir $CONTRACTDIR\$"
expect "the meanings from omx-contract-data's schema" '^ok   meanings [1-9][0-9]* from /usr/share/omx-contract/omx-contract\.schema\.json$'
expect "the standard units from omx-contract's param domain" "^ok   param-units [1-9][0-9]* units from $CONTRACTDIR/param/param\\.json\$"
expect "the served units from omx-contract's param domain" "^ok   clap-encoded [1-9][0-9]* units from $CONTRACTDIR/param/param\\.json\$"

# 5. the curve function: node_modules/@openmixer/omx-dsp is a link to omx-dsp-wasm's files, and answers one curve
if listed omx-dsp-wasm; then
  unverified+=("omx-dsp-wasm's curve through node_modules/@openmixer/omx-dsp: not published, so not installed")
else
  out=$(node "$(dirname "$0")/omx-dsp-link-check.mjs" /usr/share/omx-panel || true)
  echo "$out"
  link="the package's node_modules/@openmixer/omx-dsp link"
  grep -q '^PASS omx-dsp curve' <<< "$out" && pass "omx-dsp's loadCurve answers a curve through $link" || fail "omx-dsp's loadCurve answers no curve through $link"
fi

# 6. the installed tools load and run: their @openmixer/omx-contract resolves through the package's own node_modules
# (0.15.0 linked none, and `node /usr/share/omx-panel/tools/modgui-gen.mjs` died with ERR_MODULE_NOT_FOUND)
out=$(bash "$(dirname "$0")/installed-tools-check.sh" /usr/share/omx-panel 2>&1) && rc=0 || rc=$?
echo "$out"
[ "$rc" -eq 0 ] && pass "the installed tools load and run (tools/installed-tools-check.sh)" || fail "the installed tools do not load or run (tools/installed-tools-check.sh)"

for u in "${unverified[@]}"; do echo "::warning::not verified: $u"; done
[ "$fails" -eq 0 ] || { echo "runtime-install-check: $fails check(s) failed" >&2; exit 1; }
echo "runtime-install-check: every check passed (${#unverified[@]} not verified)"
