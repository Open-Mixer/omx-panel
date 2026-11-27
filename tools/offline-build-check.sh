#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# tools/offline-build-check.sh <rpm | deb>: the package builds from the vendored tarball with no network. Run as root on
# a machine (a CI container) that already holds the build dependencies, installed from the channel the job reads with
# `dnf builddep packaging/omx-panel.spec` or `apt-get build-dep ./`, as ci.yml's offline jobs do: the vendored tarball is
# made with the network on, then each build runs in a network namespace of its own (unshare --net, which needs
# CAP_SYS_ADMIN: a container started with --cap-add=SYS_ADMIN). The plain archive is built the same way first and has to
# fail, which proves the network is off and that the vendored modules are what made the difference. The build checks its
# dependencies (no --nodeps, no -d): one the machine lacks is red here, never built around.
#
#   tools/offline-build-check.sh rpm
set -euo pipefail
kind=${1:?usage: offline-build-check.sh <rpm | deb>}
cd "$(dirname "$0")/.."
version=$(node -p "require('./package.json').version")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
tools/vendored-source.sh "$work" >/dev/null
git archive --format=tar.gz --prefix="omx-panel-$version/" -o "$work/omx-panel-$version-plain.tar.gz" HEAD

case "$kind" in
  rpm)
    build='rm -rf "$3/rpmbuild" && mkdir -p "$3/rpmbuild/SOURCES" && cp "$1" "$3/rpmbuild/SOURCES/omx-panel-$2.tar.gz" && tar -xzOf "$1" omx-panel-$2/packaging/omx-panel.spec >"$3/omx-panel.spec" && rpmbuild -bb --nocheck --define "_topdir $3/rpmbuild" "$3/omx-panel.spec"'
    ;;
  deb)
    build='rm -rf "$3/b" && mkdir -p "$3/b" && tar -xzf "$1" -C "$3/b" && cd "$3/b/omx-panel-$2" && DEB_BUILD_OPTIONS=nocheck dpkg-buildpackage -b -us -uc -P nocheck'
    ;;
  *) echo "usage: offline-build-check.sh <rpm | deb>" >&2; exit 2 ;;
esac

# the namespace is proved before it is trusted: inside it no interface but lo exists
unshare --net true 2>/dev/null || { echo "FAIL unshare --net is refused here: run as root with CAP_SYS_ADMIN (a container started with --cap-add=SYS_ADMIN)" >&2; exit 2; }
# (/proc/net/dev is the namespace's own; /sys/class/net is the mount's, the host's)
links=$(unshare --net sh -c "tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d ' '")
[ "$links" = lo ] || { echo "FAIL the network namespace holds more than lo: ${links//$'\n'/ }" >&2; exit 2; }
# an empty npm cache of its own: the one vendored-source.sh just filled on this machine would serve the plain archive's
# npm ci with no network, and the plain build would pass (it did, the first time this ran in the job's own container)
offline() { mkdir -p "$work/npm-cache-$1"; npm_config_cache="$work/npm-cache-$1" npm_config_fetch_retries=0 unshare --net bash -euc "$build" sh "$work/$1" "$version" "$work"; }

if offline "omx-panel-$version-plain.tar.gz" >"$work/plain.log" 2>&1; then
  echo "FAIL the plain archive built with no network: the check proves nothing" >&2
  exit 1
fi
echo "PASS the plain archive does not build with no network: $(grep -m1 -E 'npm (ERR!|error) (code|network)' "$work/plain.log" || tail -1 "$work/plain.log")"
offline "omx-panel-$version-vendored.tar.gz" >"$work/vendored.log" 2>&1 || { tail -20 "$work/vendored.log" >&2; echo "FAIL the vendored tarball did not build with no network" >&2; exit 1; }
echo "PASS $kind builds from the vendored tarball with no network"
