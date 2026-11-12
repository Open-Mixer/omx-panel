#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# The catalogs through omx-contract's release gate (translate --check, 3.16.0): every listed language has its
# catalog, no key is missing and no entry is stale. The codes are a bare item file (schema/codes.json); the gate reads
# a vocabulary, so it is handed one holding that item alone.
#
#   tools/catalogs-gate.sh [translate options]   (default --check; e.g. --lang es --model <alias> to make a language)

set -eu
cd "$(dirname "$0")/.."
owner=$(python3 -c 'import json; print(json.load(open("package.json"))["name"].split("/")[-1])')
data=$(mktemp -d)
trap 'rm -r "$data"' EXIT
python3 - "$data/codes.json" "$owner" <<'EOF'
import json, sys
item = sys.argv[2].upper().replace("-", "_") + "_CODES"
json.dump({item: json.load(open("schema/codes.json"))}, open(sys.argv[1], "w"), ensure_ascii=False)
EOF
[ "$#" -gt 0 ] || set -- --check
exec omx-contract translate "$@" --data "$data" --catalogs catalogs --package "$owner"
