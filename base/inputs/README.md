<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# The base's inputs

`make base` derives the descriptions store's base (`/usr/share/omx/panel/panel.sqlite`, the package
`omx-panel-descriptions`) from the directories here, in byte order of their names (docs/descriptions-store.md section 6).
Each directory is one plugin of a reference set, in one format:

- `key.json`: `{ "sha256": "<the binary's SHA-256>", "format": "lv2" | "clap", "uri": "<the LV2 URI or CLAP id>" }`, the
  key of the reference set's binary;
- `descriptor.json`: its descriptor, the set's installed declaration byte for byte;
- `bundle/`, for an LV2 plugin: its `manifest.ttl` and TTL files, from which the port groups are inferred and the
  entry's source is hashed.

They are not written by hand. `omx-panel base-inputs` writes a set's inputs (`<set>-<format>-<name>/`), its list
`base/sets/<set>.json` and its package's domain files `base/contract.d/<package>/` from the set as installed; the base
workflow (`.github/workflows/base.yml`) runs it over the plugins the channel serves and is red when what it writes is
not what is committed. `make base` holds the built base to every set under `base/sets/`: each plugin a set lists, in
each format it lists, has a description with controls in it, or the build fails.

The one set today is `omx-plugins`, both formats. A key is the binary's hash, so a rebuilt plugin is read from the base
only once its inputs are written again; until then each host derives its entry, as for any plugin the base lacks.
