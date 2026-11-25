<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# Shapes: the types of omx-panel's documents, rendered from one schema

A declaration says what a value may be; a **shape** says what a document looks like. omx-panel owns four documents that
other programs read or write, and each has one JSON Schema file under `shapes/`; the TypeScript interfaces and the Python
`TypedDict`s of it are renders of that file, never written by hand. The facility, its rules and its generators are
omx-contract's ([shapes.md](https://github.com/Open-Mixer/omx-contract/blob/main/docs/shapes.md); the typed-contracts spec,
§3): omx-panel adds no generator and no rule of its own.

| Shape (`shapes/<name>.schema.json`) | The document | What a consumer gets |
|---|---|---|
| `gestures` | `schema/gestures.json`, the one gesture vocabulary ([panel-gestures.md](panel-gestures.md)) | `Gestures`; the words, the inputs and the widgets as `Word`, `Input` and `Widget` |
| `gesture_io` | the call of the one gesture implementation: a control member and a script of events in, the answer out | `GestureIo`, `Control`, `Event`, `Settings`, `Answer`, `Refusal` (the nine refusal codes) |
| `look_role` | one entry of `schema/look-roles.json`'s `roles` | `LookRole` |
| `code` | one entry of `schema/codes.json`'s `codes` | `PanelCode` |

`gesture_io` and `look_role` are spelt with an underscore: a hyphen is no part of a Python module name, and each shape is
installed as `omx_panel.shapes.<name>`.

## Reading them

```ts
import type { Gestures, Word, Widget } from "@openmixer/omx-panel/shapes/gestures";
import type { Answer } from "@openmixer/omx-panel/shapes/gesture_io";
```

```python
import typing
from omx_panel.shapes.gestures import Word, Input, Widget   # python3-omx-panel (rpm and deb)
typing.get_args(Word)   # ('drag', 'fine', 'step', 'second', 'reset', 'more', 'select', 'toggle', 'paint'), in the declared order
```

A Python host that used to restate the gesture words as string literals imports `Word` instead; `test/host_reads.py`
holds the library's `omx_panel_word_name` to it. The schemas themselves ship under `dist/shapes/` (`@openmixer/omx-panel/shapes/<name>.schema.json`)
for a reader that validates.

## Where each file is

| What | Path |
|---|---|
| The source | `shapes/<name>.schema.json` |
| The TypeScript render, committed | `test/golden/ts/shapes/<name>.d.ts`, published as `dist/ts/shapes/<name>.d.ts` |
| The Python render, committed | `share/omx-panel/omx_contract_<name>_shape.py`, installed as `omx_panel.shapes.<name>` |

The renders are committed and a consumer runs no generator. `make shapes` writes them, `make shapes-check` holds them to a
fresh render byte for byte (`OMX_CONTRACT_TREE`, default `../omx-contract`, names an omx-contract tree with its `npm ci`
done, and `OMX_DATAMODEL_CODEGEN` the pinned `datamodel-codegen`, as in omx-contract's own page). CI builds both at
omx-contract's commit of the facility and runs the check, and `test/shapes.test.mjs` is the gate: the real documents
validate, the shape's words are the declaration's in its order, a hand-edited, stale or missing render is named by
`--check`, an absent generator is a refusal, the Python render imports with the standard library alone, and the TypeScript
render type-checks a document and refuses a made-up word.

## What a shape does not say, and why

- **The answer lists values as `member`/`value` entries**, not a map keyed by a bar's symbol: a shape is a closed object
  with every key named, and a C writer has no dynamic key. `tools/gestures.mjs` answers a map today; the entries are the
  form of the C implementation's answer (the spec, §4.1), and the JavaScript reference moves to them when it becomes that
  implementation's loader.
- **`look_role` and `code` are one entry, not the whole document.** `look-roles.json` has the keys `$comment`,
  `--font-ui` and `--font-file`, which are no C identifiers, and `codes.json`'s `codes` is a map of the codes' names; a
  closed shape cannot name either. The entry is the unit a console or a Zynthian palette table types against, and the
  test validates every entry of both files against it.
- **The words of a refusal code and of a gesture are C identifiers; a code word is not** (`panel.skin.api-mismatch`), so
  `PanelCode.code` is a pattern, not an enum.
