#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
#   tools/render-package-check.sh <omx-panel-render.rpm | libomx-panel-render0.deb>
#   tools/render-package-check.sh --self-test <the same package> <a package that is not it (omx-panel)>
#
# The renderer's library package carries libomx-panel-render.so.0 under the architecture's library directory, as a
# shared object whose SONAME is libomx-panel-render.so.0 and which exports the C API a surface loads
# (omx_panel_view_create_from_files, omx_panel_view_draw): Zynthian's panel view loads exactly that name. Red when the
# file is missing, is not that object, or exports none of it. --self-test also holds the check red on a package without it.
set -euo pipefail
SONAME=libomx-panel-render.so.0
SYMBOLS="omx_panel_view_create_from_files omx_panel_view_draw"

check() {
    local pkg=$1 t; t=$(mktemp -d); trap 'rm -rf "$t"' RETURN
    case $pkg in
        *.rpm) (cd "$t" && rpm2cpio "$pkg" | cpio -idm --quiet) ;;
        *.deb) dpkg-deb -x "$pkg" "$t" ;;
        *) echo "FAIL $pkg: neither an .rpm nor a .deb"; return 1 ;;
    esac
    local so; so=$({ find "$t/usr/lib" "$t/usr/lib64" -name "$SONAME" \( -type f -o -type l \) 2>/dev/null || true; } | head -1)
    [ -n "$so" ] || { echo "FAIL $(basename "$pkg") carries no $SONAME"; return 1; }
    so=$(readlink -f "$so")
    local got; got=$(readelf -d "$so" | sed -n 's/.*(SONAME).*\[\(.*\)\]/\1/p')
    [ "$got" = "$SONAME" ] || { echo "FAIL ${so#$t}: SONAME '$got', not $SONAME"; return 1; }
    local s; for s in $SYMBOLS; do
        readelf --dyn-syms -W "$so" | awk '$7 != "UND" {print $8}' | sed 's/@.*//' | grep -qx "$s" \
            || { echo "FAIL ${so#$t} does not export $s"; return 1; }
    done
    echo "ok   $(basename "$pkg"): ${so#$t}, SONAME $SONAME, exports $SYMBOLS"
}

if [ "${1:-}" = --self-test ]; then
    check "$(readlink -f "$2")"
    if check "$(readlink -f "$3")" >/dev/null 2>&1; then echo "FAIL the check passed $(basename "$3"), which carries no $SONAME"; exit 1; fi
    echo "ok   the check is red on $(basename "$3"), which carries no $SONAME"
else
    check "$(readlink -f "${1:?usage: render-package-check.sh <package>}")"
fi
