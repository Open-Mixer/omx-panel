<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# Changelog

## Unreleased

- The renderer wears the look's style whole (#123): under the vintage style a panel is the MOD GUI's vintage face, pixel
  for pixel: the cream enclosure with its radius, the head plate, the screws, no section plates, the dark keys and
  screens, the lamp and each text in the look's own ink, beside the vintage knob. Every value is `looks[style]` of
  `look.json`, read by the face's rule (a token's first colour, a role in braces, `none` for a thing not drawn). A host
  that passes its own look with a `style` must set every token the face wears, or the renderer refuses it by the
  token's name; a look that names no style is drawn from the roles, as before. The console style's picture does not
  move. docs/renderer.md "What it draws"; `renderer/test/vintage-face.test.mjs`.

- `describe` refuses an override family that is no word of `PANEL_FAMILIES` (#199, ruling Z1 of omx-contract#161):
  `panel.describe.family-unknown`, naming the plugin and the family, and the panel is `none`, as for a family the
  controls do not back. omx-contract's override schema takes any identifier as a family; the words are the panel
  domain's, read from it. The panel domain is 1.3.0.

- The rules the JavaScript tools and the C renderer both apply are listed in docs/renderer.md ("The rules both languages
  apply", #76), each held by a vector both suites read: the visible columns, now with the drawn heads at a set count
  (`visible-columns.json` gains `count` entries), and the visibility rule (`test/fixtures/rules/visible-when.json`, new).

- The EQ band matrix (#97): a CLAP name that carries a second number beside its band's ("Band 3 Gain 2", "Band 3 2nd
  Order") joins its band, the band's number being the one position that varies across the controls of that shape; a grid
  where both vary is still `two-indices` (docs/group-model.md S3). A control only one band has ("Band 3 Drive") is paged
  after the matrix, never on a screen before the high-pass (P1). Edges named in another language are ruled to come from a
  descriptor word (S9), tracked by #205 and omx-contract#208.

- A choice's unit is the descriptor's (#68): `panelLayout` reads omx-contract's descriptor `choiceUnits` (a choice control's
  name to its unit), so the served description, the MOD GUI's curve and every host read the one unit the plugin declares.
  The panel block's `choiceUnits` is retired: `schema/panel.schema.json` drops its `$defs.choiceUnits`, and `panelLayout`
  refuses a `choiceUnits` option by name. A plugin that declared its slope's unit in its panel block declares it in its
  descriptor.

- The map table of `docs/modgui.md` ("The map: the console's vintage, element by element") is printed from
  `tools/look/console-map.json` by `tools/console-map-render.mjs` (#69), between two marker comments; `--check`,
  `make console-map` and `test/console-map-render.test.mjs` are red on a table that is not what the map gives. The first
  print found the `screw` row edited in the document and not in the map; the map now carries the document's cell.

- `omx_gesture_run` costs time in proportion to the script's length (#105): the events were read by indexing cJSON's
  list from its head once per event, so a script of 40000 wheel events cost 22.4 s where 5000 cost 0.11 s. They are now
  walked once: 0.26 s against 0.03 s, held by `renderer/test/gesture-c-cost.test.mjs` (eight times the events, at most
  sixteen times the time).

- The gesture refusal codes are in the one codes sheet (ruled omx-panel#106): each `GESTURE_*` name has its code word
  `panel.gesture.<kebab>`, declared once in the gestures domain (`const` the word, `x-name` the name), rendered into
  `schema/codes.json` and, from `contract.d/gestures/catalogs/<lang>.json`, into every `catalogs/<lang>.json`.
  `GESTURE_CODE_WORDS` (tools/gestures.mjs) maps a name to its word and a `GestureError` carries it as `word`; the
  reference and the C unit still answer the `GESTURE_*` name.

- The served matrix opens with its head row (docs/group-model.md L3, ruled omx-panel#121): a band's name and on/off head
  its column on the MOD GUI face and in the renderer, which refuses a head row that is not the first. A consumer that read
  the head row as the last (the console's processing view, Zynthian's builder) reads `rows[0]`. A parameter row whose cell
  holds another parameter carries `labels`, one per head (ruled omx-panel#122): an EQ edge's slope in the gain row is
  captioned Slope on every surface, never Gain.

- A face without a head (#94): `omx_panel_view_set_head(view, false)` (a new function of libomx-panel-render.so.0, a
  minor addition; the command's state file says `"head": false`) draws no head, the sections start at `pad` and the face
  is `sectionTop - pad` (36 px) shorter, so a host drawing one control per view gets the control, its label and its value.
  Held to a golden image of a one-control description at 1x and 2x.

- The kind of a scanned control is one rule, omx-panel's (`docs/control-kind.md`, #153): an enumeration is a choice,
  else lv2:toggled is a toggle, else a stepped control of exactly the two positions 0 and 1 is a toggle, else a travel
  with its scale. `tools/control-kind.mjs` (`@openmixer/omx-panel/control-kind`) is the rule and
  `schema/control-kind-vectors.json` with its schema the 28 vectors every reader is held to (both exported by name).
  The group inference's LV2 port reader and the group model over a descriptor apply it: an `lv2:integer` 0..1 port and
  a stepped 0..1 travel with no step were travels there and are toggles.

- The gesture parity scripts live in `fixtures/gestures/scripts.json`, the shipped fixtures, no longer under `test/`:
  the export `@openmixer/omx-panel/gestures/scripts.json` keeps its name and resolves to
  `dist/fixtures/gestures/scripts.json`, and a test refuses an export backed by a test path (#101). An installed reader
  finds them at `<datadir>/omx-panel/fixtures/gestures/scripts.json`.

- The page cut has no screen of zero visible items: a page whose every slot is blank (on the Easy pages, hidden by the
  values, empty cells, a declared page naming none) is not cut (#175). A repeated-group instance longer than the page
  keeps its first `perPage` places as its screen, and each place past them is a row of the aligned matrix, after the
  instances (`Bands: Type`, `Bands: Type 2`), never a continuation of one instance. At 4 slots omx-eq8 is 14 screens (was
  20 since 4f588e4, #96) and the Calf multiband compressor 6 (was 9, one empty). `OMX_PANEL_RULES_VERSION` is 3 (2 is #149's display axis).

- The `utility` panel family's content (omx-contract's `PANEL_FAMILIES`, 3.19), the family of a trim, a width control, a
  balancer or a clipper: the role table gives it `gain`, `width`, `pseudo`, `pseudo_time`, `bass_mono`, `bass_mono_freq`,
  `amount`, `range`, `drive`, `ceiling` and `softness` (one per control omx-trim, omx-width, omx-balancer and omx-clipper
  declare whose unit a token serves; the balancer's dB/s speed and dB/oct slope have none), `gain`, `width`, `amount` or
  `drive` as the one required role, and an Easy row. A utility is declared, never inferred. The packaging floors move to
  omx-contract 3.19.1, the release that carries the word, with no ceiling.

- Tiers and edge bands: a control's `tier` (`panel.tiers`, easy or advanced, default advanced; the `modgui-tier` setting, `--tier`, `$OMX_MODGUI_TIER`, default advanced; Easy draws only the easy controls) and a section's `edges` (an EQ's first band is the plugin's HPF, its last the LPF; the curve carries their roll-off). Declared in `schema/panel.schema.json`.

- The MOD GUI stylesheet is held to the installed look: `test/modgui-stylesheet-is-the-look.test.mjs` generates the default (vintage) stylesheet and requires every colour in it to be one `tools/look.json` holds, and the vintage values (accent, border, curve stroke, enclosure, keys) to be in it. The `console` and `3d` looks' curve line is the `--curve-stroke` role, as the renderer draws it. The matrix layout of the MOD GUI is the served group-model matrix, with a come-up-hidden column taking no room.

- The MOD GUI has three looks, the `modgui-look` setting (values `vintage`, `console`, `3d`; default `vintage`;
  `omx-panel modgui --look <name>`, else `$OMX_MODGUI_LOOK`; an unknown look is refused by name, exit 2). Declared once in
  `schema/modgui-looks.json` and emitted into `tools/look.json`. `vintage` is the owner's reference (cream enclosure, dark label
  plate, black knobs with a white pointer, red bypass LED, chrome footswitch, recessed screens in the console's own lit glass:
  its four tokens are the console's tokens.css at one pinned commit, `tools/look/console-vintage.json`, checked by
  `tools/look-pin.mjs --check`); `console` is the flat look; `3d` adds depth (gradient and bevel body, recessed sections, keycap
  switches with a pressed state). Every control but a selector gets a scribble strip bound to its port. The vintage and 3d knob
  film strips are one SVG each (`tools/look/knob-*.svg`), painted by `tools/svg-knob.mjs`. `tools/look-contrast.mjs` lists
  the contrast of every text pair. The console look is no longer byte for byte what it was (the scribble strip).

- The gesture reference is C. `renderer/src/gesture.c`, built into `libomx-panel-render`, is the one implementation of the
  gesture vocabulary of `docs/panel-gestures.md`; `renderer/include/omx_panel_gesture.h` (installed with the -devel
  package) exports `omx_gesture_open`, `omx_gesture_run` and `omx_gesture_close`: a control and a script of events in as JSON,
  the answer `tools/gestures.mjs` gives out as JSON, so one call shape serves every runtime. `input.c` now holds only the
  renderer's mapping of controls onto targets and calls the unit for the arithmetic. The 20 shipped scripts, 117 rules and
  4500 seeded random scripts give the same answers from C and from `tools/gestures.mjs`; the ABI is
  `renderer/abi/omx_panel_gesture.abi`. `tools/gestures.mjs` keeps its arithmetic and stays the
  JavaScript reference until its wasm loader lands; it gains `validateInput` only. `schema/gestures.json` now declares every
  refusal code with its sentence (`codes`), including `GESTURE_BAD_INPUT`, which both references answer, in the same words, to
  input neither can read. An integer travel now rounds as `Math.round` does, exactly, where the renderer rounded a negative half
  away from zero, and a wheel's notch count is a number, not an int32.
- The gesture parity scripts are exported by name: `@openmixer/omx-panel/gestures/scripts.json` resolves to
  `dist/test/fixtures/gestures/scripts.json`, the file the installed tree already carries, so the console reads the
  same scripts as the Zynthian UI without a path into `dist/`.
- The look is the vintage look, and `tools/look.json` is the one public source of its tokens. The role defaults of
  `schema/look-roles.json` move from the dark, cyan, modern look to the console's default: dark, orange accent
  (`--accent` `#e8732c`), aluminium, vintage (`--glass` `#05070a`). The package carries the file as
  `dist/tools/look.json`, now exported as `@openmixer/omx-panel/look.json`, and installs it as
  `/usr/share/omx-panel/tools/look.json`; its readers are the MOD GUI generator, the renderer, the Zynthian UI and its
  pixel test, and the console's check of its own `tokens.css`.
  Two new roles, each one drawing, neither drawn in `--accent` any more: `--knob-pointer` (a knob's pointer, the
  console's cream `#f4efe2`) and `--curve-stroke` (the line of an `eq_response`, a `transfer_curve` or a
  `time_response` display; the accent's value at this look). The renderer and the MOD GUI generator draw both from
  the roles. A look that lacks either is refused by the role's name, as for every role; nothing stands in for a
  missing role. A host that passes its own look (`look.json` in the renderer's data directory, a console theme, a
  Zynthian palette) must now value both, or the renderer refuses it.
  Every MOD GUI image, stylesheet and golden image moves with the look. The knob is still drawn flat: its metal face,
  rim and relief are not in this change. docs/modgui.md "The look"; `test/look-roles.test.mjs`,
  `renderer/test/look-roles.test.mjs`, `test/packaging.test.mjs`.

- An EQ's band matrix on every screen (the owner's rule: the high-pass the first band, the low-pass the last, the bands
  between in their number order, aligned; the audio order untouched). The group model reads a descriptor of any origin:
  one a scan wrote states no `symbol`, the model read none of its controls, and a host, which draws from a scan, got
  omx-eq8 as the sections HPF, LPF, Band 1 .. Band 8 with no matrix. Its controls are now keyed as the layout keys them;
  a CLAP scan's instance number is read from the parameter's name and its 0..1 whole-number travel is a toggle. The page
  cut keeps every instance's places: a place an instance has no control at (an empty cell, or a control the Easy pages
  took) is a blank slot, so slot k is the same parameter on every band's screen. A surface that pages an EQ sees one more
  screen for a band whose gain is an Easy control where the band no longer fits its width (omx-eq8 at 4 slots).
  docs/group-model.md, L7 and P1; `test/eq-band-matrix.test.mjs`.

- 0.16.0: the sorting pass (V1, V2, V3, V4, V22 and V23d), delivered with omx-contract 3.21.0, omx-dsp 0.34.0, plugin-db 0.5.0 and plugin-hostd 0.21.0, and floored at them (floors only, no ceiling): omx-contract, omx-contract-data, omx-contract-devel and libomx-domain-devel >= 3.21.0, omx-dsp-wasm and omx-dsp-devel >= 0.34.0, plugin-db-contract >= 0.5.0, plugin-hostd >= 0.21.0 (recommended). Units: dB/oct and dB/s are served, the vendor-block codes omx-contract 3.21.0's sheet gives dbPerOct and dbPerS (clap#163), beside dBTP and LU; the utility family gains the roles `speed` and `slope`, so omx-balancer's four controls all take a role. The npm range on `@openmixer/omx-contract` and `@openmixer/omx-dsp` stays at the published 3.20.2 and 0.33.0 until this delivery is on npm.

- 0.15.1: the installed tools resolve `@openmixer/omx-contract`: 0.15.0's tools import `@openmixer/omx-contract/entry` (isMain, #143) but the package linked only omx-dsp, so `node /usr/share/omx-panel/tools/modgui-gen.mjs` died with `ERR_MODULE_NOT_FOUND`. `node_modules/@openmixer/omx-contract` now links the omx-contract package's `/usr/lib/omx-contract`, omx-panel requires `omx-contract >= 3.20.2` (rpm Requires, deb Depends, a floor only), and `tools/installed-tools-check.sh` loads every installed tool and runs the installed modgui-gen in %check, debian/rules, debian/tests and the CI runtime install.

- 0.15.0: the first release with Debian trixie arm64 packages (0.14.0 was rpm-only) and Fedora 45 only (Fedora 44 is dropped, #148); built against omx-contract >= 3.20.2, floors unchanged otherwise. This release carries: the vintage knob drawn by the renderer from the look's `knob-vintage` scene, the scene reader and the C raster painting the bytes of the JS painter (#124, #125), with a static-layer cache (#132, 5 ms to 0.33 ms for a 64 px knob on a Pi 5); the panel domain at 1.1.0, whose x-since is the version of the domain that added each item (#134, omx-contract#123); the descriptions store core (#138: `libomx-panel-store` and its command, the three-layer panel.sqlite reader), packaged: `omx-panel-store` (libomx-panel-store.so.0, the command omx-panel-store and its page) and `omx-panel-store-devel` (the .so link, `<omx-panel/omx_panel_store.h>`, `omx-panel-store.pc`, the DDL as /usr/share/omx-panel-store/panel.sql) in the RPM; `libomx-panel-store0`, `libomx-panel-store-dev` and `omx-panel-store` (the command) in the DEB; built against SQLite >= 3.38.0; the base panel.sqlite (omx-panel-descriptions) and the Python door are not in this release; the generated GUIs shipped key-gated for a known plugin set (#141, spec); the tools decide run-not-imported with omx-contract's isMain, so a bin run through a symlink runs (#143); the README install for Fedora 45 and trixie arm64 (#142); and the docs (#133 #136 #137 #139).

- 0.14.0: built against omx-contract >= 3.20.0, omx-dsp >= 0.32.3, omx-dsp-wasm >= 0.33.0 and plugin-hostd-contract >= 0.20.7,
  floors only with no ceiling on our packages (#113). This release carries: the panel domain shipped alone in
  `omx-panel-contract` (#102, #119); the MOD GUI generator reading curves through omx-dsp-wasm's async `loadCurve`, linked,
  not copied (#128, #109); three MOD GUI looks (#58) and the vintage look roles (#98); the utility panel family (#107); the
  group model on every surface and its renderer matrix (#63, #64, #92, #96); the gesture C reference in
  libomx-panel-render and the exported gesture scripts (#104, #100, #88); schema addresses under openmixer.org (#110); a
  contract directory's links followed (#95); the packaging dependency checks and the release proof (#115, #117, #129).

- 0.13.8: built against omx-contract >= 3.18.0 and plugin-hostd >= 0.20.7, every floor its newest version, served or released before it in the same pass, with its ceiling (D30).
  This release also carries: the spectrum layer, drawn by the renderer on the console analyser's axes (built against
  omx-dsp >= 0.32.3 and below 0.33); the `time_response` display kind and describe reading a plugin's served panel as the
  declared form (both below); and fixes: the commit-msg hook takes the current stub from the checker's release line,
  artifact retention is explicit (30 days on a tag, 2 otherwise), the Makefile names the shared checks' checkout through
  OPENMIXER_DOTGITHUB, the renderer tests remove their scratch directories and read readelf in the C locale, debian/control
  floors libomx-contract-dev as the spec floors omx-contract-devel, and the omx-eq8 fixture matches the installed file
  apart from its version lines.
- The `time_response` display kind (ruling 6, the lost FX graphics; the processing-view spec, amendment 2026-09-16h): a delay
  section's `delay-taps` and a reverb section's `decay-envelope` are one display kind, x time in ms from 0 to the content's
  end, y level in dB with the floor at -60, drawn by the renderer from what the host sets: the envelope as the display's curve
  (`omx_panel_view_set_curve`) and the stems as `omx_panel_view_set_stems` (one per tap: time, level, shade, leg letter), each
  array when present. The closed forms of the delay and reverb families name it, the served panel reads it back to the family's
  graph word, the skin schema lists it. `describe` refuses a graph word that names no display kind by name: it used to drop the
  display in silence, which is how the reverb's picture went missing. omx-plugins' omx-reverb joins the fixtures.

- 0.13.8: describe given a plugin's own panel takes each parameter's role from the panel's declaration in place of a
  scan's `unknown` meaning (#43: on the Pi, omx-comp 0.19.3's panel over plugin-hostd's scan descriptor answered family
  `none`, `panel.describe.family-not-backed`, and the console drew knobs alone). A declared panel's roles back its
  family; a control the panel binds to a role serves the role's meaning where the descriptor states none; a meaning the
  descriptor does state still has to agree with the role, or the role is named and not bound
  (`panel.describe.role-dropped`). `--panel` also reads the panel a plugin serves, `org.openmixer.panel-description/1` as
  omx-clap-scan --json prints it and plugin-hostd-probe panel copies it (`tools/panel-served.mjs`): its tables name
  parameters by id, and are read as the declared form over the descriptor's keys; plugin-hostd stays a host that copies
  bytes.
- 0.13.7: the DEBs build again. 0.13.6's failed lintian --fail-on warning (script-not-executable): tools/gesture-words.mjs ships as a command now, executable, its declaration without the shebang, and the build refuses a shipped module with a shebang that is not a listed command.
- 0.13.6: a host that is not JavaScript reads the gesture word names through the library (`omx_panel_word_name`,
  generated from schema/gestures.json) and the compare format, slots and ring bound through `omx-panel compare describe`
  (#23); one language pack per listed language (ca, es, fr, de, it, pt), each owning its catalog.
- 0.13.4 was tagged without a version bump and never released: its tag is empty, and nothing was published under
  it.
- 0.13.5: describe serves a plugin's path and text parameters (#17): an LV2 patch:writable lv2:Parameter of range atom:Path or
  atom:String is a `params` entry of kind `path` or `text` and a control of the last section, never on a page; a plugin
  whose only parameters are paths or texts has a panel; a patch parameter of another range is refused by
  `panel.describe.param-unserved`. LSP Impulse Reverb's four impulse files, LSP Matcher's files and link name and
  zeroconvolv's impulse response are the proofs.
- 0.13.3: describe leaves a control meaning `bypass` to the header: a derived panel does not draw it as a control and its
  fingerprint does not count it; the param is still served. EQ10Q's `eq*qm` toggle `bypass`, which plugin-qualify's
  scan gives that meaning (plugin-qualify#27), was drawn a second time.
- 0.13.3: the meaning each panel role plays comes from the `roleMeanings` items the installed packages declare
  (omx-contract 3.13.0's kind; omx-plugins-contract 0.19.3 installs omx-plugins'), no list of omx-panel's own; a role no
  package declares plays none, one declared twice is refused. A level meter of the descriptor's `meters[]` is the
  transfer curve's operating point without a `measurement`, as plugin-hostd 0.20.3 describes `clap.meters/1` meters.
- 0.13.3: `tools/modgui-test.sh` and `tools/modgui-gen.mjs` fail with the reason when the panel layout cannot be read (plugin-hostd's
  LV2 table not installed): both read that as "no meters", so the generator wrote a MOD GUI without its meter frames and
  the test passed it (#11).
- 0.13.2: `tools/modgui-test.sh` holds each meter frame the generator draws to the description's symbol, range and unit,
  with no port role, and counts it; a MOD GUI with meters failed 0.13.1's test with more rows drawn than declared.
- 0.13.1: the package metadata names Open-Mixer/omx-panel (repository, homepage, bugs), so npm accepts the package
  its provenance names; 0.13.0 was refused for naming the old organisation.
- The renderer is also a shared library, `libomx-panel-render.so.0`, exporting only the header's functions, for a surface
  that loads it at run time (Zynthian's Tk panel).
- `omx-panel describe --layout` prints the layout the description was derived from, the family's displays included: what the
  renderer draws, so a host draws exactly what it describes.
- The family rule reads a CLAP feature a scan spells by its macro (`CLAP_PLUGIN_FEATURE_EQUALIZER`) as the feature it stands
  for (`equalizer`): a scanned CLAP EQ or compressor had no candidate family.
- An EQ band whose frequency and gain the descriptor's words name gets the Q, the type (with its shapes) and the switch the
  words leave unnamed from the band inference, at the words' index: an LV2 port states no Q, so a scanned LV2 EQ had a curve
  plugin-hostd could not draw.
- The band inference keys a CLAP parameter by its name: its id is a number and says nothing of its band, so a scanned CLAP
  EQ (`Band 1 Frequency`, `Band 1 Gain`) had no band.
- describe reads the descriptor's `meters` word: each meter is a meter control with its kind, measurement, unit, range,
  channels, symbol, held and clip. A dynamics family's gain reduction is its section's `gain_reduction_bar`; the transfer
  curve's operating point reads the input and output level meters. A foreign read-only level control stays a meter with no
  measurement. A meter whose name is phantom, pad or head-amp state is refused by code (`panel.describe.meter-refused`). The meters
  stay out of the canonical form and the fingerprint.
- `rms`, `vu` and `ppm` are no longer measurements.
- The renderer draws the meters: a bar and a peak marker over the description's range (`omx_panel_view_set_meter`); the marker
  is omx-dsp's view law (`omx_meter_view_step`), falling by elapsed time at 18 dB/s.
- The MOD GUI face draws each meter as a static frame with its range; there is no live meter. The meter frame's style is
  written whenever a meter stands, with or without a curve.
- The MOD GUI's pedal rim is an inset shadow: its border had set every box of the template 1 px right and down of the raster.
- The renderer build needs omx-dsp-devel >= 0.32.0 and < 0.33 (`pkg-config omxdsp`).
- `renderer/test/meter-surfaces.mjs` measures one recorded stream on the renderer, in Chromium and in Tk.
