#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# tools/install-under-test.sh <package.rpm | package.deb>: installs that file over whatever copy of the package is
# installed, weak dependencies off, and proves that what is installed is that file. A dependency may have brought the
# channel's copy first: apt refuses to go below it without --allow-downgrades, and at the same version apt and dnf keep it
# and answer 0, so a same-version copy is installed again. The proof is the RPM's header digest, or the DEB's version and
# every file it carries; another package left in place fails, so a check never judges the channel's copy for this one.
set -euo pipefail

PKG=${1:?usage: install-under-test.sh <package.rpm | package.deb>}
wrong() { echo "install-under-test: the installed $1 is not the package under test ($PKG): $2" >&2; exit 1; }
# the manager's output is shown when it fails, never lost
quiet() { local out; out=$("$@" 2>&1) || { local rc=$?; printf '%s\n' "$out" >&2; return "$rc"; }; }

case "$PKG" in
  *.rpm)
    name=$(rpm -qp --qf '%{NAME}\n' "$PKG" 2>/dev/null)
    digest() { rpm "$@" --qf '%{SHA256HEADER}\n' 2>/dev/null || true; }
    want=$(rpm -qp --qf '%{SHA256HEADER}\n' "$PKG" 2>/dev/null)
    quiet dnf install -y -q --setopt=install_weak_deps=False "$PKG"
    [ "$(digest -q "$name")" = "$want" ] || quiet dnf reinstall -y -q "$PKG"
    [ "$(digest -q "$name")" = "$want" ] || wrong "$name" "its header digest differs"
    ;;
  *.deb)
    name=$(dpkg-deb -f "$PKG" Package)
    quiet apt-get install -y -q --no-install-recommends --allow-downgrades --reinstall "$PKG"
    have=$(dpkg-query -W -f '${Version}' "$name")
    [ "$have" = "$(dpkg-deb -f "$PKG" Version)" ] || wrong "$name" "it is version $have"
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    dpkg-deb --fsys-tarfile "$PKG" | tar -x -C "$tmp"
    while IFS= read -r -d '' f; do
      rel=${f#"$tmp"}
      # what the image's dpkg is configured not to unpack (path-exclude: docs, man pages, translations) is not there to compare
      case "$rel" in /usr/share/doc/* | /usr/share/man/* | /usr/share/locale/*) continue ;; esac
      cmp -s "$f" "$rel" || wrong "$name" "$rel differs"
    done < <(find "$tmp" -type f -print0)
    ;;
  *) echo "install-under-test: $PKG is neither an RPM nor a DEB" >&2; exit 2 ;;
esac
