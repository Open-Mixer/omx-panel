<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# The base's inputs

`make base` derives the descriptions store's base (`/usr/share/omx/panel/panel.sqlite`, the package
`omx-panel-descriptions`) from the directories here, in byte order of their names (docs/descriptions-store.md section 6).
Each directory is one reference plugin:

- `key.json`: `{ "sha256": "<the binary's SHA-256>", "format": "lv2" | "clap", "uri": "<the LV2 URI or CLAP id>" }`, the
  key of the reference set's binary;
- `descriptor.json`: its descriptor;
- `bundle/`, for an LV2 plugin: its `manifest.ttl` and TTL files, from which the port groups are inferred and the
  entry's source is hashed.

There is none yet: the reference sets' inputs arrive with their sets (descriptions store lanes 15 and 16). An empty
base is a base: the store opens, and its readers read the layers above it.
