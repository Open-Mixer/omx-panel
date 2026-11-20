<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# The domains omx-panel owns

omx-panel owns the words a panel is described in. They are declared here and installed into the contract directory by
DOMAIN, not by package (omx-contract `docs/contract-dir.md`, "Domains"): `<contractdir>/<domain>/<domain>.json`, one
JSON Schema 2020-12 document with `$id`, `info{title,version,x-owner}` and `components.schemas`. omx-panel is the
domain's `x-owner` today; a domain that changes owner keeps its path and its consumers' references.

Why: a change of a panel word is omx-panel's release alone. omx-contract holds the document kind, the loader check and the
renderers, no panel word, so it is never released for one and no chain of consumers is walked for it. A consumer
(omx-plugins, omx-clap-core) depends on the domain and floors omx-panel, the package that ships it, never omx-contract.

## One space per domain

| Domain | Document | Package | State |
|---|---|---|---|
| `panel` | `contract.d/panel/panel.json`: families, widgets, display kinds, display sources, placements | `omx-panel-contract` | shipped here |
| `readout` | `contract.d/readout/readout.json`: `READOUT_RATE_HZ`, the display redraw rate (50 Hz), a scalar (sorting pass row V22: it left omx-contract; the domain is named after the item's prefix, R-P; omx-contract >= 3.21.0 reads a scalar) | `omx-panel-contract` | shipped here |
| `gestures` | gesture words, rules, the scripted fixtures (today `schema/gestures.json`, `test/fixtures/gestures/`) | | follow-up |
| `look` | look roles and tokens (today `schema/look-roles.json`, `tools/look.json`) | | follow-up |

Each domain has its own document and its own version line, so a consumer reads only the domain it uses and a change
in one domain touches no other domain's consumers. A consumer reads the words at start-up through omx-contract's
loader (`libomx-domain` in C; Ajv 2020 with `@openmixer/omx-contract/domain-schema` in TypeScript), never a rendered
copy (omx-contract `docs/consumer-move.md`). A domain gets a codes header only for the words C code switches on.

## The panel domain

Its words and codes are those omx-contract main held in `data/panel.json` at b2e9bba (the last commit before they left; no release carried them) (`PANEL_FAMILIES`, `PANEL_WIDGETS`,
`PANEL_STANDARD_WIDGETS`, `PANEL_DISPLAY_KINDS`, `PANEL_DISPLAY_SOURCES`, `PANEL_PLACEMENTS`); a word is a `oneOf` entry
`{ const, title, description, x-code, x-text }`, its code its place in the order. The document states
`info.x-stability` (`experimental`) and is in omx-contract's one formatting (`omx-contract fmt --check`). No C code
switches on a panel word, so the domain has no codes header and no rendered vocabulary: a consumer opens it through the
loader, `omx_domain_open("panel", "1.0.0", ...)`.

The translations of the words are `contract.d/panel/catalogs/<lang>.json` (six languages, one entry per word, moved from omx-contract's catalogs with nothing dropped). The family word is validated by `schema/skin-package.schema.json` `$defs.family` (a plain string in omx-contract's override schema), held equal to the domain's `PANEL_FAMILIES` by `test/panel-domain.test.mjs`. `make install` (its `install-contract` step)
installs the domain as it is with omx-contract's domain installer (`install-contract-dir.sh --domain`) at
`$(CONTRACTDIR)/panel/`, and the `omx-panel-contract` package ships it alone (noarch; a program that reads the panel
words requires it). `test/panel-domain-contract.test.mjs` holds the document, the formatting, the absence of a render,
the installed tree as the loader opens it, and the package.
