#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
#   tools/store-package-check.sh <the store's packages>
#       RPM: omx-panel-store.rpm omx-panel-store-devel.rpm
#       DEB: libomx-panel-store0.deb libomx-panel-store-dev.deb omx-panel-store.deb
#   tools/store-package-check.sh --self-test <the same packages>
#
# The descriptions store's packages, together, carry libomx-panel-store.so.0 under the architecture's library directory
# as a shared object whose SONAME is libomx-panel-store.so.0 and which exports the C API (omx_panel_store_open,
# omx_panel_store_get, omx_panel_store_put); the command /usr/bin/omx-panel-store; and the development files: the
# libomx-panel-store.so link to it, <omx-panel/omx_panel_store.h>, omx-panel-store.pc and
# /usr/share/omx-panel-store/panel.sql with its user_version. Red when any is missing. --self-test also holds the check
# red with each package left out in turn: every package carries a part.
set -euo pipefail
SONAME=libomx-panel-store.so.0
SYMBOLS="omx_panel_store_open omx_panel_store_get omx_panel_store_put"

check() {
    local t pkg; t=$(mktemp -d); trap 'rm -rf "$t"' RETURN
    for pkg in "$@"; do
        case $pkg in
            *.rpm) (cd "$t" && rpm2cpio "$pkg" | cpio -idm --quiet) ;;
            *.deb) dpkg-deb -x "$pkg" "$t" ;;
            *) echo "FAIL $pkg: neither an .rpm nor a .deb"; return 1 ;;
        esac
    done
    local names; names=$(for pkg in "$@"; do basename "$pkg"; done | tr '\n' ' ')
    local so; so=$({ find "$t/usr/lib" "$t/usr/lib64" -name "$SONAME" \( -type f -o -type l \) 2>/dev/null || true; } | head -1)
    [ -n "$so" ] || { echo "FAIL $names: no $SONAME"; return 1; }
    local dir; dir=$(dirname "$so"); so=$(readlink -f "$so")
    local got; got=$(readelf -d "$so" | sed -n 's/.*(SONAME).*\[\(.*\)\]/\1/p')
    [ "$got" = "$SONAME" ] || { echo "FAIL ${so#$t}: SONAME '$got', not $SONAME"; return 1; }
    local s; for s in $SYMBOLS; do
        readelf --dyn-syms -W "$so" | awk '$7 != "UND" {print $8}' | sed 's/@.*//' | grep -qx "$s" \
            || { echo "FAIL ${so#$t} does not export $s"; return 1; }
    done
    [ -x "$t/usr/bin/omx-panel-store" ] && readelf -h "$t/usr/bin/omx-panel-store" > /dev/null 2>&1 \
        || { echo "FAIL $names: no command /usr/bin/omx-panel-store"; return 1; }
    [ "$(readlink "$dir/libomx-panel-store.so" 2>/dev/null)" = "$SONAME" ] || { echo "FAIL $names: no libomx-panel-store.so link to $SONAME"; return 1; }
    [ -f "$t/usr/include/omx-panel/omx_panel_store.h" ] || { echo "FAIL $names: no /usr/include/omx-panel/omx_panel_store.h"; return 1; }
    [ -f "$dir/pkgconfig/omx-panel-store.pc" ] || { echo "FAIL $names: no ${dir#$t}/pkgconfig/omx-panel-store.pc"; return 1; }
    grep -q '^PRAGMA user_version = [0-9][0-9]*;$' "$t/usr/share/omx-panel-store/panel.sql" 2>/dev/null \
        || { echo "FAIL $names: no /usr/share/omx-panel-store/panel.sql with its user_version"; return 1; }
    echo "ok   $names: ${so#$t} (SONAME $SONAME, exports $SYMBOLS), /usr/bin/omx-panel-store, the .so link, header, pkg-config file, panel.sql"
}

pkgs=()
if [ "${1:-}" = --self-test ]; then
    shift
    for p in "$@"; do pkgs+=("$(readlink -f "$p")"); done
    check "${pkgs[@]}"
    for i in "${!pkgs[@]}"; do
        rest=("${pkgs[@]:0:$i}" "${pkgs[@]:$((i + 1))}")
        if check "${rest[@]}" > /dev/null 2>&1; then echo "FAIL the check passed without $(basename "${pkgs[$i]}")"; exit 1; fi
        echo "ok   the check is red without $(basename "${pkgs[$i]}")"
    done
else
    [ $# -gt 0 ] || { echo "usage: store-package-check.sh [--self-test] <package>..." >&2; exit 2; }
    for p in "$@"; do pkgs+=("$(readlink -f "$p")"); done
    check "${pkgs[@]}"
fi
