<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# Looks: control styles, widget libraries and the skin

Status: PROPOSED, 2026-11-24. Design spec, not built. It designs within the owner's rulings of 2026-11-19 and
2026-11-24 (section 1) and re-opens neither. A fact checked against a file names the file (this repository at
`origin/devel`; openmixer at `main`; zynthian-ui PR #114 and zynthian-sys PR #40 at their heads). Anything else is
marked as an assumption. The decisions the rulings do not settle are in section 10, for the owner.

A look today is four unrelated things: the console's `style` axis (`vintage | modern`, openmixer
`packages/core/src/session.ts` `SURFACE_STYLES`), the MOD GUI's `modgui-look` setting (`vintage | console | 3d`,
`schema/modgui-looks.json`), Zynthian's `ZYNTHIAN_UI_LOOK` (`stock | vintage`, zynthian-ui PR #114) and the
`look` field of a plugin's skin package (`docs/skin-package.md`). Each client decides in code what "vintage" means.
This spec makes a look DATA: one shared vocabulary of control kinds and their styles, one skin notion (the skin package
this repository already has, widened), and one gate that refuses a skin a library cannot draw.

## 1. The rulings

**2026-11-24, the owner:**

> "Vintage look is just a skin."
>
> "Vintage look means we can have controls that are drawn using vintage widgets, i.e. a VU meter instead of a
> digital meter, or a different on/off switch or an LED."
>
> "We can choose which widget library we use, apart from skins."

**2026-11-19, the owner** (recorded in the thin-clients decisions; the line on tokens is the record's, not a verbatim
quote): drawing belongs to each toolkit; the toolkits "share NO drawing and NO look tokens". Below the drawing
everything is shared: the panel description, mappings, scale laws, units, gestures, value text, meters. And, in one
line: "every client READS omx-panel's panel descriptions (layout data) and draws them with its own toolkit's
libraries."

**Versioning** (omx-clap-core#123 and the house rule): a contract file is versioned WITH the package that ships it,
and packages follow `0.MAJOR.MINOR-X`. No word in a contract file names a `since` past its package's version.

Read together, and this is what the rest of the spec builds on:

- A **skin** chooses, per control kind, which **style** draws it, and carries the colours, fonts, images and
  metrics a library paints that style with. Vintage is one skin. Nothing else about vintage exists.
- A **widget library** is the drawing code of one toolkit. The client fixes the library; the user picks the skin.
- Because toolkits share no drawing and no look tokens (11-19), the ONLY things shared across libraries are the
  **style vocabulary** (kinds × style names) and **each skin's kind → style choice**. Colours, fonts, images and
  metrics live in **per-library skin files**, one per (skin, library), in the library's own form. This is decision 1
  in section 10, for the owner to confirm.

## 2. What is and is not a widget library

| Library | Toolkit | Draws | Owner of the drawing |
|---|---|---|---|
| `nuxt` | Nuxt UI / Vue | the console web UI | openmixer `packages/web-ui` |
| `tk` | Tk + PIL | Zynthian's UI (its own Tk widgets since 2026-11-19) | zynthian-ui |
| `native` | pugl + NanoVG | the omx-panel native window: every plugin's LV2 X11 UI and `clap.gui` | this repository, `renderer/` |
| `modgui` | HTML + CSS, generated | MOD GUI bundles (`omx-panel modgui`, `omx-modgui-sync`) | this repository, `tools/modgui-gen.mjs` |
| later `gtk`, `qt` | | | their adapters |

**The omx-panel C core and its wasm build are not a widget library.** The behaviour core (`docs/behaviour-core.md`)
holds gestures, scale laws, value text and mappings, and draws nothing. Every library calls it: `native` and the
control surfaces natively, `tk` through ctypes, `nuxt` and the MOD GUI pages through wasm. A style never restates
what the core answers (a position, a step, a value's text); it draws it.

## 3. Control kinds × styles: the `look` domain

The `look` domain is the follow-up `docs/contract-domains.md` already reserves. It is a contract domain of its own,
`contract.d/look/look.json`, owned and shipped by omx-panel (`omx-panel-contract`), versioned with omx-panel. It holds
the shared words, nothing a library paints with.

### 3.1 Kinds

A kind is what a control IS to the person, read from the served description. It is never chosen by a skin.

| Kind | Taken by (from `docs/panel-layout.md`, "The widget") | Its state, the same in every style |
|---|---|---|
| `knob` | a travel | the position the core gives (0..1), the value text, the default's position |
| `fader` | a travel the declared panel draws as a fader | the same as `knob` |
| `on-off` | a toggle (today `switch`) | on or off |
| `momentary` | a trigger (today `switch`) | pressed or released |
| `selector` | a choice | the index, the labels |
| `meter` | a read-only travel in a level unit | the reading and peak marker from omx-dsp's view law, its range and unit, its `held` |
| `lamp` | a meter's clip word (`clip: true`); a processor's engaged state | lit or dark |
| `display` | any other read-only control | the value text |
| `curve` | a section's graph | the points the host computes, the axis |

`xy` stays reserved, as in the panel domain. The split of `switch` into `on-off` and `momentary`, and `lamp` as a kind,
are changes to the panel words; whether they move into `PANEL_STANDARD_WIDGETS` or stay look-domain words over it is
decision 3.

**One state per kind.** A style draws the kind's state and nothing else. It never integrates, smooths or holds a value
the state does not carry, and it reads no control, parameter or meter the kind does not name. Two styles of one kind
fed the same state stream show the same thing.

### 3.2 Styles

A style is a name for a way of drawing one kind. The domain lists them per kind; each is an `oneOf` word
`{ const, title, description, since }` with `since` an omx-panel `0.MAJOR.MINOR`. The first list is what some library
draws today, so no word is invented:

| Kind | Styles | Drawn today by |
|---|---|---|
| `meter` | `bar`, `needle-vu` | `bar`: native, modgui, nuxt; `needle-vu`: modgui's vintage dials (`.omx-vu`) |
| `on-off` | `flat`, `toggle-switch`, `led` | `flat`: native, nuxt; `toggle-switch`: modgui 3d keycaps (assumption: the mapping is decision 6); `led`: modgui's bypass LED |
| `momentary` | `key` | modgui's look keys |
| `knob` | `flat`, `metal` | `flat`: native, modgui console; `metal`: modgui vintage film strip, tk PR #114 |
| `fader` | `flat`, `metal` | `metal`: modgui's `fader-vintage.svg` |
| `selector` | `segments` | tk PR #114, native |
| `lamp` | `dot`, `jewel` | `dot`: omx-panel PR #217's frame lamp; `jewel`: PR #219's period peak lamp |
| `display` | `glass` | every library |
| `curve` | `glass-trace` | every library |

A style is a word, never a drawing: the domain says what the style SHOWS (a needle on an arc over the meter's range; a
lever with two rest positions), and each library draws it its own way.

## 4. The skin

There is one skin notion: the skin package of `docs/skin-package.md`. Today it is scoped to one plugin (the
directory is the plugin id). This spec adds a second scope to the same format, the **house skin**, and moves the
look out of code into it.

### 4.1 The house skin package

```
<skin id>/                 a house skin: default, vintage, 3d, ...
  skin.json                scope "house", the shared part
  <library>/               one directory per library the skin is drawn by: nuxt/, tk/, native/, modgui/
    ...                    that library's own skin file(s), in its own form
  i18n/<lang>.json         the skin's name
```

`skin.json` (house scope) holds:

| Field | Meaning |
|---|---|
| `scope` | `house`; absent means a plugin skin, as today |
| `id` | the skin id, the directory's name |
| `contract` | the omx-panel `0.MAJOR.MINOR` whose `look` domain the file was written against |
| `licence` | the SPDX expression of everything in the package |
| `labelKey` | the skin's name, translated in `i18n/` |
| `styles` | kind → style, **every kind**: a skin missing a kind is refused by the kind's name; no default fills it |
| `libraries` | the libraries this package carries a file for |

The per-library files hold the colours, fonts, images and metrics. Their form is the library's: `nuxt` a token block
`tokens.css` reads, `tk` the `ZYNTHIAN_UI_*` file zynthian-sys installs, `native` the role values `read_look` takes
(`schema/look-roles.json` is that library's schema, no longer a cross-toolkit one), `modgui` a look of
`schema/modgui-looks.json`. Each file names the skin id and the `contract` it was written for, and the library's own
check validates it (every role it reads present, contrast floors, files under the package). omx-panel validates the
shared part only. Where a library's file lives (in the house package, or in the library's own repository keyed by
skin id) is decision 4.

### 4.2 The plugin skin

A plugin skin keeps every field it has. Its `look` field names a house skin id. Whether a plugin skin may also carry
`styles` (a plugin whose own panel wants a needle VU under any house skin) is decision 5.

### 4.3 Versioning

The `look` domain document and `schema/skin-package.schema.json` carry omx-panel's version: `info.version` is the
package's `0.MAJOR.MINOR`, every word's `since` an omx-panel release, and a check (as omx-clap-core#123 asks) refuses a
`since` past `VERSION`. A reader accepts a skin whose `contract` has its own `0.MAJOR` and a MINOR at or below its own;
any other is `look.skin.contract-mismatch`. A new style is a MINOR; a removed or renamed one a MAJOR. The house skins
are versioned with the package that ships them.

## 5. The widget-library contract

A library claims styles by a manifest, `library.json`, in its own repository, shipped with it:

```json
{ "library": "tk", "contract": "0.17", "styles": { "meter": ["bar"], "knob": ["metal"], "...": [] } }
```

To claim a style a library:

1. **draws every state of the kind** (section 3.1), including the lamp's lit and dark and a meter's unheld caption;
2. **reads only the kind's state and its own skin file**: no other library's tokens, no pinned copy of another
   toolkit's values;
3. **asks the behaviour core** for every position, step and value text, and draws it;
4. **passes the style's fixtures**: a state stream per kind (the shape of today's `meter-surfaces` streams) whose every
   tick it draws, measured by its own harness: what is lit, where the needle or fill stands, in the tolerance the
   style's fixture names. The fixtures are omx-panel's, in the `look` domain's test data; the pictures are each
   library's;
5. **refuses a skin naming a style it does not claim**, by name (`look.skin.style-unclaimed`, args `skin`, `library`,
   `kind`, `style`), and draws the client's default skin whole. It never substitutes one style for another, control by
   control.

## 6. The conformance gate

Two rules, checked by one tool, `omx-panel look check --skins <dir> --library <library.json>`:

- **A shipped skin naming a style a shipping library lacks is refused by name.** For every house skin a package ships
  and every library that package ships it to, every style in its `styles` must be in the library's claim.
- **Every library implements every style its shipped skins name**, and claims no style the domain does not list
  (`look.library.style-unknown`).

Where it runs: in each library's CI against the skins that library ships with (zynthian-ui against zynthian-sys's
skins, openmixer web-ui against the console's, omx-panel against its own for `native` and `modgui`), and in the CI of
any package that ships a skin. The refusal codes are the `look` domain's (`LOOK_SKIN_CODES`), each with its sentence in
`schema/codes.json` and the catalogs, never reworded. Like every guard, the gate lands with a sabotage arm: a skin with
one style its library lacks must turn it red.

The default skin is held to a stricter rule: every library claims every style it names, since it is what a refused
skin falls back to.

## 7. Selection

- **The library is fixed by the client.** The console draws with `nuxt`, Zynthian with `tk`, a plugin window with
  `native`, mod-ui with `modgui`. No client offers a choice of library at run time; "choose which widget library we
  use" is a build and packaging choice per client.
- **The skin is chosen by the user or the config**, by id, through the client's existing setting, which now carries a
  skin id: the console's `/surface/preferences` `style` row (`vintage | modern` becomes the skin id), Zynthian's
  `ZYNTHIAN_UI_LOOK`, the MOD GUI's `modgui-look` (`--look`, `OMX_MODGUI_LOOK`), a plugin window's instance config. A
  plugin skin's `look` is a default the client's own choice beats, as today.
- **The skins shipped:** `default` (the flat styles: today's console `modern` and MOD GUI `console` look) and `vintage`
  (`meter: needle-vu`, `on-off: toggle-switch`, `knob: metal`, `fader: metal`, `lamp: jewel`, ...). The MOD GUI's `3d`
  look becomes a third skin, `3d`; nothing developed is dropped. Which skin is SELECTED by default is decision 2
  (today it is vintage on the console, the MOD GUI and the Zynthian preset).
- Theme, accent and finish (openmixer `2026-10-04-omx-look.md` §2(a)) stay the user's axes; how they sit inside a
  skin is decision 7.

## 8. Migration of what exists

| Piece | Becomes |
|---|---|
| omx-panel #13 / PR #217, the clip lamp | the `lamp` kind's `dot` style in `native` and `modgui`; its state is the meter's clip word, unchanged. Lands as it is. |
| omx-panel PR #219, the vintage VU peak lamp | `meter: needle-vu` and `lamp: jewel` in `modgui`, worn because the vintage skin names them, not because the look is `vintage`. Its ruling "the renderer and Tk draw the description's frames in every look" is replaced by the gate: once `native` and `tk` ship the vintage skin they must claim `needle-vu` and `jewel`. |
| `schema/modgui-looks.json` (`vintage`, `console`, `3d`) | three house skins; each look's tokens become that skin's `modgui/` file, its knob and fader drawings that library's `metal` styles |
| `schema/look-roles.json`, `tools/look.json` | the `native` library's skin-file schema and its `default`/`vintage` files. The claim that the Zynthian UI and the console are held to them ends (11-19: no shared look tokens); whether the MOD GUI's pin of console tokens (`tools/look/console-vintage.json`) stays is decision 8 |
| zynthian-ui PR #114, the Tk vintage controller | re-scoped to `tk` style implementations: `knob: metal`, `on-off` (its pill and thumb, decision 6), `selector: segments`, `display: glass`, plus a `library.json`. The `ui_look == "vintage"` rebinding of the controller class goes: the controller picks each drawing from the skin's `styles`. The seven-token refusal stays, as the `tk` skin file's check. |
| zynthian-sys PR #40, `config/ui-looks/openmixer-vintage.sh` | the vintage skin's `tk` file. Its "hand-kept" header becomes true by design: it is that library's own file, validated by `tk`'s check, no longer described as generated from the console's tokens. `stock.sh` is the `tk` file of `default`, or Zynthian's own stock skin (decision 2). |
| the console's `SURFACE_STYLES`, the `data-style` stamp | the skin id; each `nuxt` atom draws the style its kind is mapped to |
| `PANEL_LABELS` (PR #217) | unchanged: a style's words (`unheld`, a VU's scale legend) are keys there; a skin repaints, it never speaks |

The order of work: (1) the `look` domain with kinds, styles and codes, and `omx-panel look check`; (2) the house-scope
skin schema and the `default`/`vintage`/`3d` packages with their `native` and `modgui` files; (3) each library's
`library.json` and its gate, red where it lacks a style its skins name; (4) the libraries close their reds; (5) the
clients' settings carry skin ids.

## 9. Ruled out

- **A look-specific screen, page, layout or control set.** A skin changes how a control is drawn, never which controls
  exist, their order, their pages or their words.
- **A code branch on a skin or look id** (`isVintage`, `ui_look == "vintage"`, `if (look == VINTAGE)`). Drawing code
  branches on the style its kind is mapped to, never on the skin's name; each library's test refuses a skin id
  literal in its drawing code, as `test/modgui-no-retyped-look.test.mjs` refuses a colour today.
- **A style with state of its own**: ballistics, hold or smoothing a style adds. A true VU measurement is a meter's
  `measurement` word in the description, never a style (decision 9).
- **A stand-in**: a library drawing another style, or a skin missing a kind filled by a default.
- **Shared drawing or shared look tokens between libraries** (11-19). Only the vocabulary and the kind → style map are
  shared.
- **Code in a house skin.** A plugin skin may carry a `view`; a house skin carries data only.

## 10. Open decisions, for the owner

Each question carries the coordinator's recommendation of 2026-11-24; none is ruled until the owner confirms it.

1. **Confirm the split:** libraries share only the style vocabulary and each skin's kind → style map; colours, fonts,
   images and metrics live in per-library skin files (11-19 "no shared look tokens" read with 11-24 "vintage is just a
   skin").
   *Coordinator recommendation (owner to confirm):* yes, the split as written.
2. **The default selection:** two skins `default` (flat) and `vintage` ship; which one a fresh install selects, per
   client (today vintage everywhere), and whether Zynthian's `stock` is a skin of its own.
   *Coordinator recommendation (owner to confirm):* a fresh install selects `vintage` on every client, as today; Zynthian's `stock` IS a skin.
3. **Where the new kinds live:** `on-off` / `momentary` (splitting `switch`) and `lamp` as panel-domain widgets
   (`PANEL_STANDARD_WIDGETS`, a served-description change) or as look-domain words over the panel's.
   *Coordinator recommendation (owner to confirm):* `on-off`, `momentary` and `lamp` are kinds and go into the panel domain's `PANEL_STANDARD_WIDGETS`; their looks (`dot`, `jewel`, `led`) are look-domain styles.
4. **Where per-library skin files live:** inside the house skin package (one directory per library), or in each
   library's repository keyed by skin id (closer to the 11-19 ownership, wider to gate).
   *Coordinator recommendation (owner to confirm):* each library's per-library skin files live in that library's repository, keyed by skin id.
5. **Per-plugin styles:** may a plugin skin carry its own `styles` (a plugin whose panel is a VU meter under any skin),
   or only name a house skin.
   *Coordinator recommendation (owner to confirm):* no: a plugin skin names a house skin and carries no kind -> style map of its own.
6. **Style names beyond the owner's examples:** Zynthian's pill-and-thumb switch is `flat` or `toggle-switch`; the
   MOD GUI 3d keycap is `toggle-switch` or a style of its own.
   *Coordinator recommendation (owner to confirm):* the pill-and-thumb is `toggle-switch`; the MOD GUI 3d keycap is a style of its own, `keycap`.
7. **Theme, accent, finish:** remain user axes inside every skin (each per-library file carries every axis value), or
   a skin may fix them (vintage = dark, aluminium).
   *Coordinator recommendation (owner to confirm):* theme, accent and finish are user axes in every skin; a skin only sets their defaults.
8. **The MOD GUI's pin of the console's vintage tokens** (`tools/look/console-vintage.json`, `docs/modgui.md` "The map"):
   kept as a deliberate likeness, or retired as shared look tokens under 11-19.
   *Coordinator recommendation (owner to confirm):* retire the pin; the MOD GUI gets its own vintage file.
9. **`needle-vu` and ballistics:** the needle draws the same reading as the bar (the 11-24 "same control state"), or a
   VU's 300 ms integration (`tools/look/geometry.json` `vu.tauMs`, today in the MOD GUI's dials) is allowed as part of
   the style.
   *Coordinator recommendation (owner to confirm):* `needle-vu` applies VU ballistics (300 ms), computed in the shared C core as a meter mode, so every library gets the same reading; the style only draws it.
10. **The panel domain's own version line** (`contract.d/panel/panel.json` `info.version` 1.3.0): moves to omx-panel's
    `0.MAJOR.MINOR` with the `look` domain, under the versioned-with-its-package rule, or keeps its line.
   *Coordinator recommendation (owner to confirm):* yes: the panel domain moves to omx-panel's `0.MAJOR.MINOR` (omx-clap-core#123).
