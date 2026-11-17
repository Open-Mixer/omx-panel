<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# The domains omx-panel owns

omx-panel owns the words a panel is described in. They are declared here and installed into the contract directory by
DOMAIN, not by package (omx-contract `docs/contract-dir.md`, "Domains"): `<contractdir>/<domain>/<domain>.json`, one
JSON Schema 2020-12 document with `$id`, `info{title,version,x-owner}` and `components.schemas`. omx-panel is the
domain's `x-owner` today; a domain that changes owner keeps its path, its header and its consumers' references.

Why: a change of a panel word is omx-panel's release alone. omx-contract holds the document kind, the loader check and the
renderers, no panel word, so it is never released for one and no chain of consumers is walked for it. A consumer
(omx-plugins, omx-clap-core) depends on the domain and floors omx-panel, the package that ships it, never omx-contract.

## One space per domain

| Domain | Document | Header | State |
|---|---|---|---|
| `panel` | `contract.d/panel/panel.json`: families, widgets, display kinds, display sources, placements | `<omxdomain/panel_vocabulary.h>` | shipped here |
| `gestures` | gesture words, rules, the scripted fixtures (today `schema/gestures.json`, `test/fixtures/gestures/`) | `<omxdomain/gestures_vocabulary.h>` | follow-up |
| `look` | look roles and tokens (today `schema/look-roles.json`, `tools/look.json`) | `<omxdomain/look_vocabulary.h>` | follow-up |

Each domain has its own document, its own version line and its own rendered header, so a consumer includes only the
domain it uses and a change in one domain touches no other domain's consumers.

## The panel domain

Its words and codes are those omx-contract 3.19.0 held in `data/panel.json` (`PANEL_FAMILIES`, `PANEL_WIDGETS`,
`PANEL_STANDARD_WIDGETS`, `PANEL_DISPLAY_KINDS`, `PANEL_DISPLAY_SOURCES`, `PANEL_PLACEMENTS`); a word is a `oneOf` entry
`{ const, title, description, x-code, x-text }`, its code its place in the order. The C names are unchanged,
`OMX_PANEL_FAMILIES_GATE` and `OMX_PANEL_PLACEMENTS(X)`, so a consumer changes its include and nothing else:

```c
#include <omxdomain/panel_vocabulary.h>   /* was <omxcontract/omx_vocabulary.h> */
```

`include/omxdomain/panel_vocabulary.h` is rendered by omx-contract's renderer, never written by hand and never by a
generator of omx-panel's, at omx-panel's build: `make contract-check` (`OMX_CONTRACT_CLI` names the omx-contract
command) runs `render --target c --package panel --contract-dir contract.d --out include/omxdomain --check`, and
`make contract` rewrites it. `make install` puts the document at `$(CONTRACTDIR)/panel/panel.json` and the header at
`$(INCLUDEDIR)/omxdomain/`.
