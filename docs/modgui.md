<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# The MOD GUI generator

`tools/modgui-gen.mjs` writes a MOD GUI (MOD Devices' modgui, the format MOD and Zynthian draw) for one plugin,
from its **descriptor** (omx-contract `docs/descriptors.md`) and, when the plugin declares one, its **panel**.

```
omx-panel modgui --descriptor <file> | --installed <package>/<name>
                 [--panel <file>] --out <bundle.lv2> [--stem <name>] [--source <text>] [--easy-first] [--check | --emit-stdout]
```

- `--descriptor` names a descriptor file; `--installed omx-plugins/omx-delay` reads the one a package installed into
  omx-contract's contract directory (`<contractdir>/<package>/plugins/<name>.json`).
- `--panel` names a JSON file holding the declared panel: `family`, `sections` (each `key`, `label`, `controls` by
  symbol) and, optionally, `widgets` (symbol to `knob`, `fader`, `switch` or `selector`, the list in
  `schema/panel.schema.json`) and `easy` (the controls of the Easy face); or the panel the plugin serves, as
  `plugin-hostd-probe panel` prints it (panel-layout.md, "Meanings and roles"). With none, the sections are the descriptor's groups, laid out by
  `tools/panel-description.mjs`, and the family the one their meanings make.
- `--out` is the LV2 bundle the files go into: `modgui.ttl` and `modgui/`. `--stem` names the files
  (`icon-<stem>.html`, `stylesheet-<stem>.css`, `screenshot-<stem>.png`, `thumbnail-<stem>.png`); it defaults to
  the bundle's name without `.lv2`.
- `--source` is the text the files' banner names as what they were made from; it defaults to the descriptor and
  the panel files.
- `--check` writes nothing and refuses a stale, missing or extra file byte for byte; `--emit-stdout` prints every
  text file and one digest line per image.

Every control's symbol, travel, default and label is the descriptor's. A toggle is a switch; a choice, or an
integer travel of at most 16 steps, a selector over its values; every other travel a knob. The template lays out
every section and every control; `modgui.ttl` lists the input controls of the first section as `modgui:port`. With `--easy-first` the Easy controls ([panel-layout.md](panel-layout.md)) are that first section, so a pedal's listed ports are them; a plugin's package turns it on when it regenerates its committed files, and `omx-modgui-sync` always does.

A repeated group ([group-model.md](group-model.md): an EQ's bands, a multiband compressor's bands) whose controls fill
some sections exactly is one section drawn as its matrix: each parameter on one row and each band in one column, never
flowed, an EQ always with its bands as columns, HPF leftmost and LPF rightmost, each band's on/off at its head.

A bar group ([panel-layout.md](panel-layout.md) "Bars"; a declared section's `bars: true` or `false` wins over the rule) is a row of
faders: each control of a run is the fader widget, an ordinary `input-control-port` MOD moves live with its own fader film, its title
the bar's label (`16'`, `1`..`16`). A declared `bars: true` that fails the rule's checks is refused by its code. A section whose
display is a curve (`eq_response`, `transfer_curve`) has a row above its controls: a frame with the basis word (`exact` or
`modelled`) in its caption; the curve is omx-dsp's (`@openmixer/omx-dsp` >= 0.33.0, a plain dependency: its WebAssembly module, loaded once by `loadCurve`, then `curvePoints`) at the come-up values, a static SVG polyline in the template and the same
stroke in the screenshot, with the axis and the basis word; a tree without omx-dsp does not load the generator, and says so by the package name
(a MOD GUI drawn without its curves would be a false green). A band a planter owns (a declared panel's `origins`, an authored descriptor's, from
fbs-fixed, fbs-live, hrp, room-mode) is a mark on the curve: a disc at the band's own depth and its planter's letter; no origin declared, no mark.

A readout (a `readonly` control: a gain reduction, a level) has no travel to turn and no default. It is drawn as a
display: a frame in its cell carrying its symbol and its range, never a knob, a fader, a switch or a selector, and
never looked up as a control input. MOD's template binds input control ports by role (`input-control-port`) and
has no role for an output control port, so the frame carries none; it is not a `modgui:port` either. Showing the
reading live needs the bundle's own `modgui:javascript`, which this generator does not write. A declared panel
that names a widget for a readout is refused.

The images (the screenshot, the thumbnail, the knob film and the fader's when a control is one) are rasterised by
`tools/raster.mjs` from the template's own layout, each control at its default. The screenshot and the thumbnail
carry the plugin title, the section labels (one band per section, so per group of a grouped descriptor), and each
control's name and its default with unit; the thumbnail is the screenshot at half size. The text is set from the font
file the look names (`--font-file`, `tools/fonts/Inter-Regular.ttf`, SIL OFL 1.1, licence beside it), whose
outlines `tools/font.mjs` reads and `tools/raster.mjs` fills at the shapes' own sampling: no host font is consulted.
A fixed-code deflate and no zlib, so their bytes depend only on the descriptor, the panel and the look.

## The look

`schema/look-roles.json` declares the colour roles of a panel once: every colour a panel description makes a surface
draw, under the console's token names, each with its family (theme, accent, fixed, state), the contrast floor its
value clears on the grounds it is drawn on, and one default. The defaults are the vintage look, the console's own
default: the dark theme, the orange accent, the aluminium finish, the vintage style, which the file names as its
`look`. Each default is the value the console's `tokens.css` resolves for that token at that look.

A ground is a ground role, or a key a finish sets (`--knob-face`). A role drawn on the hardware is read on the
hardware, so such a floor is measured on that key in every finish of the console's pin, not on the page around it.
`--knob-pointer`'s floor is 3:1 on `--knob-face`: the pointer is carved into the knob's face, and on a light page it
keeps its cream on the dark metal.

`tools/look.json` is the one public source of the vintage tokens. `tools/look.mjs` writes it from the role file,
every role at its default and the font, and the renderer's role list into `renderer/src/look_roles.h`;
`omx-panel look --check` refuses either when it is not what the role file gives. The package carries it as
`dist/tools/look.json`, exported as `@openmixer/omx-panel/look.json` and installed as
`/usr/share/omx-panel/tools/look.json`. Its readers:

- the MOD GUI generator, whose host supplies nothing, so the MOD GUI wears it as it is;
- the renderer, when its host passes no look of its own;
- the Zynthian UI, which maps its colours from it, and its pixel test, which reads the colours it expects from it:
  no copy of the console's sheet and no second list of colours on that side;
- the console, whose `tokens.css` is held to it token by token by the console's own check, at the look the file
  names. A value that moves moves here first, and reaches the console with the release that carries it.

A host may still value the roles itself (a console theme, a Zynthian palette); it then values every one of them.

Two roles belong to one drawing each, and no surface draws either in `--accent`:

- `--knob-pointer` colours a knob's pointer: the line from the knob's centre toward its rim that shows the value.
  Fixed family: it does not follow the accent.
- `--curve-stroke` colours a curve's stroke: the line through the points of an `eq_response`, a `transfer_curve`
  or a `time_response` display, over a bare frame and over a spectrum alike. Accent family: at the vintage look
  its value is the accent's. The spectrum's own trace, a time response's stems, a fill, a lit switch and the head
  line stay `--accent`.

A look that lacks any role is refused, and the refusal names the role: `tools/look.mjs` (`checkRoles` over a host's
values), the MOD GUI generator and the renderer's `read_look` each refuse it, whether or not the surface draws that
role. There is no stand-in: a look without `--knob-pointer` or `--curve-stroke` is not drawn with `--accent` in its
place. No surface spells a colour, and every token a surface reads is a role (`test/look-roles.test.mjs`). The
package also exports the role file, as `@openmixer/omx-panel/look-roles.json`.

The C renderer wears the look's style as this face does (docs/renderer.md "What it draws"): under the vintage style
its panel is this face, pixel for pixel.

## The test

`tools/modgui-test.sh <bundle.lv2> <descriptor> [<panel>]` holds a written MOD GUI to its descriptor on values:
the files are the generation byte for byte; every control is drawn in the template with its symbol, travel and
default (a readout with its symbol and range, as a display with no port role), every meter that is no control of a section as a static frame with its symbol, range and unit and no port role, and nothing undeclared is; every choice is a selector with each of its values; `sord_validate` accepts
the bundle against the LV2 specifications, `tools/modgui-terms.ttl` (the closed modgui vocabulary) and
omx-contract's resource-hint terms, and refuses a property outside that vocabulary; and a descriptor with its
first control's default moved makes `--check` fail on the template.

## Looks

The MOD GUI wears one of three looks, the `modgui-look` setting: `vintage` (the default; the owner's reference: a cream enclosure,
a dark label plate, black knobs with a white pointer, a red bypass LED, a chrome footswitch, recessed screens), `console` (the
console's flat look) and `3d` (depth: a gradient and bevel body, recessed sections and screens, raised keycap switches with a
pressed state, a lit LED). The setting is declared in `schema/modgui-looks.json` (name, values, default, the environment variable
`OMX_MODGUI_LOOK` and the flag `--look`); every look sets every token of one schema there and `node tools/look.mjs` emits them into
`tools/look.json`. Packages ship the default.

An installer regenerates a plugin's MOD GUI in the chosen look, in place, with:

    omx-panel modgui --look "$(cat /etc/omx/modgui-look 2>/dev/null || echo vintage)" \
        --installed omx-plugins/<name> --out /usr/lib/lv2/<name>.lv2

(the one-word file is the installer's to write; `--films-only` rewrites only the knob and fader strips.)

The vintage screens' glass, grid, legend and orange accent are the console's own: `tools/look/console-vintage.json` pins them at
one console commit with the hash of its `tokens.css`; a package build reads that copy and needs neither the console nor a
network, and the release check runs `node tools/look-pin.mjs --check <tokens.css>` over the file at the pinned commit
(re-pin with `--write`, then `node tools/look.mjs`).

The value of a control is shown in a scribble strip, `mod-role="input-control-value"` bound to the port: mod-ui writes the port's
value into it and the template carries no value text; the unit is its `data-unit`, spelled for a person: the `x-symbol` of the
descriptor's unit id in omx-contract's PARAM_UNITS (`percent` shows `%`, `none` shows nothing). A selector's own value
element is bound the same way.

The knob film strips of `vintage` and `3d` are generated from one drawing each: the vintage knob's is a scene in `tools/look.json` (`drawings`, written there from `schema/modgui-looks.json`, the only copy of that drawing), the 3d knob's `tools/look/knob-3d.svg`: 65
frames of 48 px, left to right, minimum to maximum, MOD's horizontal sprite. `tools/svg-knob.mjs` paints the SVG's small subset
with `tools/raster.mjs`, the generator's own byte-deterministic rasteriser, so the strips need no external tool. `node
tools/look-contrast.mjs` prints the contrast of every text pair of every look; `console` and `3d` never fall below the flat look's,
`vintage` clears 4.5:1 on every pair.

**Ruled 2026-11-24 (#70): one home for the shared resources and for the shots.** The resources every bundle wears (the
pinned serif in `tools/fonts/` with its licence, the look's script and stylesheet parts in `tools/look/`) have one home, this
repository's `tools/`; each generated bundle carries a copy made from it at generation time, because a MOD GUI bundle is
self-contained (MOD-UI serves a bundle's files from its own `modgui:resourcesDirectory`, and a bundle is copied to a device on
its own). A font update or a look change is one change here and a regeneration. The MOD GUI screenshots have one home,
`docs/shots/` here (its README says how each was taken); omx-plugins links to them and keeps no copy of its own.

## The map: the console's vintage, element by element

The owner's rule: any vintage look goes into mod-ui, so the `vintage` look draws each console element in the console's own
tokens. `tools/look/console-map.json` is the MAP (the table below is it, printed by `node tools/console-map-render.mjs`: an edit
to the table is made in the map, and `make console-map` and `test/console-map-render.test.mjs` are red on a table that is not
what the map gives); `test/modgui-console-map.test.mjs` holds
every row to it: each token a row lists is in the pin, is named as a placeholder (`{console:--x}` or `{finish:--x}`) in the look
token or the drawing the row names, and is worn as the pinned value in `tools/look.json`; and a value moved in a `tokens.css` goes
red in the drift check, token by token. A row marked "the owner's mock" is not a console element (the cream enclosure, the label
plate, the red LED) and reads no pinned token. Those rows are the ONLY place a vintage token may hold a colour literal: the rows' `via` lists name them, and `test/modgui-no-retyped-look.test.mjs` refuses a `#rrggbb` anywhere else.

<!-- the map table: printed from tools/look/console-map.json by tools/console-map-render.mjs, do not edit by hand -->
| Row | Console element | MOD GUI element | Pinned tokens |
|---|---|---|---|
| `knob-cap` | the console's Encoder .cap: a radial cap-hi to face gradient | knob film strip, the domed cap (the knob-vintage drawing of tools/look.json) | `finish:--knob-cap-hi`, `finish:--knob-face` |
| `knob-rim` | the console's Encoder .cap stroke: the rim | knob film strip, the rim | `finish:--knob-edge` |
| `knob-knurl` | the console's Encoder .knurl: the knurled edge | knob film strip, the teeth ring | `finish:--knob-knurl` |
| `knob-pointer` | the console's Encoder .needle with its groove-shade and groove-lit walls | knob film strip, the carved pointer | `console:--knob-pointer`, `finish:--knob-knurl`, `finish:--knob-cap-hi` |
| `knob-silk` | the console's Encoder .silk: the 270-degree tick ring printed on the panel | knob film strip, the tick ring | `console:--legend` |
| `knob-shadow` | the console's Encoder .cap drop-shadow(--shadow-1) | knob film strip, the drop shadow | `console:--shade` |
| `fader-cap` | the console's FaderCap: ridges, groove, cream centre line, --shadow-2 | fader film strip (tools/look/fader-vintage.svg) | `finish:--fader-cap`, `finish:--fader-cap-ridge`, `finish:--fader-cap-groove`, `console:--fader-cap-line`, `console:--shade` |
| `screw` | --screw: the panel's screw heads | .omx-pedal::before and ::after: 12 px heads in the foot's corners, with a slot | `finish:--screw`, `finish:--knob-cap-hi`, `console:--shadow-1`, `console:--shade` |
| `glass` | GLASS_WELL (utils/glass.ts): --glass under --glass-grid in the inset track, on every display | .omx-curve, .omx-meter-frame, .omx-display-image | `console:--glass`, `console:--glass-grid`, `console:--inset-track` |
| `scribble` | StripHead scribble strip: glass well, the accent lit | .omx-scribble | `console:--glass`, `console:--accent`, `console:--inset-track` |
| `curve` | the console's EqCurve and the console's DynGraph: the trace in the accent, the legend | .omx-curve-line and the curve's text | `console:--accent`, `console:--legend` |
| `button-cap` | lamp.ts off: a cap in the finish's metal (--btn-face) with its cream legend | .omx-selector-image and the look keys | `finish:--btn-face`, `console:--cap-legend`, `finish:--knob-cap-hi`, `console:--shadow-1` |
| `toggle` | the console's ToggleSwitch: a thumb in --toggle-face on a recessed track | .omx-switch-image and its thumb | `finish:--toggle-face`, `console:--glass`, `console:--inset-track` |
| `footswitch` | the finish's metal cap (knob cap-hi to face, knurl at the edge) | .omx-bypass, the footswitch | `finish:--knob-cap-hi`, `finish:--knob-face`, `finish:--knob-knurl`, `console:--shadow-1` |
| `section-relief` | a panel's --shadow-1 relief | .omx-section | `console:--shadow-1` |
| `vu-bezel` | the console's Meter: the meter sits in recessed glass | .omx-vu, the needle VU's bezel | `console:--glass` |
| `legend-ink` | the console's light theme ink and ink-dim: the text it sets on a light plate | the section title, a control's label and its value on the cream enclosure | `console:--ink-light`, `console:--ink-dim-light` |
| `brand-ink` | --cap-legend: the cream legend printed on a cap | .omx-brand on the label plate | `console:--cap-legend` |
| `key-state` | the accent a lit key wears, the glass a held key sinks to | a pressed and a held key (--key-pressed-bg, --key-held-bg) | `console:--accent`, `console:--glass` |
| `enclosure` | none: the owner's mock, a cream enamel enclosure with a light-to-dark body gradient | .omx-pedal body | none (the owner's mock) |
| `label-plate` | none: the owner's mock, the dark label plate and its serif title | .omx-head and .omx-label | none (the owner's mock) |
| `bypass-led` | none: the owner's mock, the red bypass LED | .omx-bypass-light | none (the owner's mock) |
<!-- end of the map table -->

**What the pin keeps** (`tools/look/console-vintage.json`, read from `tokens.css` at one commit with its sha-256, by
`node tools/look-pin.mjs --write <tokens.css> <commit>`, verified by `--check` and `$OPENMIXER_TOKENS_CSS` in the test): the glass, its
grid, the legend and the accent (`tokens`); the light theme's two text inks (`light`: `--ink`, `--ink-dim`, the text on a light plate such as the cream enclosure); the RELIEF the console draws depth with (`relief`: `--shade`, `--shadow-1`, `--shadow-2`,
`--inset-track`); the base control paint no finish changes (`base`: `--knob-pointer`, `--fader-cap-line`, `--cap-legend`); and the three
FINISH blocks (`finish`: aluminium, graphite, black; the metal a knob, a fader cap, a button cap, a toggle and a screw are made of),
aluminium being the default (`defaultFinish`, the console's default `data-finish`). `tools/look.mjs` writes them into `tools/look.json`
(`console`), and each look names its metal with the `--finish` token (the console's default finish, read from its `tokens.css`, for vintage; `none` for the others).

**The metal knob and fader.** The vintage knob and fader film strips are generated from the `knob-vintage` drawing of `tools/look.json` and
`tools/look/fader-vintage.svg` through `tools/svg-knob.mjs`; every colour in them is a pinned placeholder, so a re-pin or another
finish re-draws them with no hand drawing and no binary in the tree. The knob is the console's Encoder's: a radial cap-hi to face cap, an edge
rim, a knurled ring, a pointer between a shaded and a lit groove wall, the silkscreened tick ring and the drop shadow.

**3d is its own look.** Four roles tell `3d` from the console's flat look, each held by a test: raised sections (a gradient plate under
an outer drop shadow with a lit top edge, `--section-bg` and `--section-shadow`), recessed glass with a highlight (`--screen-shadow`: an
inset sink with a lit lower lip), keycap switches with a pressed state (`--key-shadow` and `--switch-shadow` stand a cap on its own
thickness, `--key-pressed-shadow` sinks it), and a glowing accent bar (`--accent-bar-glow` on the head's rule).

## The labels of a face

A control's label is set by rules declared once, in `tools/look/geometry.json`, and read by the stylesheet, the raster and the tests; the
numbers below are that file's (`label`, `geometry.labelGap`, `geometry.cellH`, `geometry.scribbleH`).

**A label breaks only between words.** It wraps at spaces, never inside a word (`overflow-wrap: normal`, `word-break: keep-all`), and
never in more than four lines (`line-clamp: 4`, ten px a line). A word that does not fit the cell makes the label's SIZE step down; it
never makes the word break.

**The declared size steps.** `label.sizes` lists the sizes a label steps through, largest first (10, 9 and 8 px). A control's label takes
the largest size at which EVERY word of its name fits the control's width (`span` cells of `cellW`) in EVERY look, the look's capitals
and its tracking included: an uppercase label counts `label.letterSpacing` em for each letter (the one declaration of the tracking, 0.05
em; the stylesheet's `letter-spacing` and the fit both read it). A word that fits at no step takes the smallest step. The size is a class
on the control, `omx-lbl-<size>`, and the largest step carries none.

**The gap to the value strip, `labelGap`.** A knob, a switch or a fader has a scribble strip (`scribbleW` by `scribbleH`) on the foot of
its cell, and its label sits on the strip, its last line `labelGap` px above the strip's top (3 px), the label growing upward. One
number sets the gap in every look; no look types its own. A selector and a display have no strip: their label stands directly under the
control, its first line at the control's foot. The raster draws the same: the label's baseline is `text.nameBaseStrip` over a strip and
`text.nameBase` under a selector or a display, and the strip's value is at `text.valueBase`, in the strip's well.

**The selector rule.** A control is drawn as a selector, never as a knob, when the descriptor says its values can be listed, and no
plugin's name is read: a toggle is a switch; a parameter with labelled values (a choice, an enumeration port) is a selector; an integer
travel is a selector when it has at most `MAX_SELECTOR_STEPS` steps (16), or has no unit and at most `MAX_COUNT_VALUES` values (32), a
count such as an EQ's band count; every other travel, a time in milliseconds over thousands of steps included, is a knob. A selector's
width is one cell, or as many cells as its longest option needs (never an ellipsis); a panel's `widgets` entry overrides the rule for one
control.

## The look switch and the needle meters

**One template, three looks.** The package ships the `vintage`, `console` and `3d` looks in ONE stylesheet: each look's rules are scoped by a
class on the pedal root, `omx-look-<name>`, so the pedal wears the look its root names and a look swaps every token (colour, depth,
font, knob film) with no other change. Geometry is shared, so every look has the same size and the same ports. `--look` (and
`modgui-look`) only picks the class the pedal starts with, the shipped default; the default of the setting stays `vintage`. The header carries a
small look switch (three keys, one per look). Clicking one swaps the root's look class and remembers the choice in the browser
(`localStorage`, the key `omx-look`); every storage access is inside `try`/`catch`, so with storage absent or throwing the pedal is correct and
wears the shipped default, vintage. The switch is never a plugin port: nothing about it is addressable or automatable, and a click on it
stops propagation so mod-ui's own drag does not start. The knob and fader film strips are one per look (`knobs/omx-knob-<look>.png`).

**Needle meters.** The meters of a plugin (input and output level, gain reduction, key level) are its OUTPUT control ports. The MOD GUI's
script receives each as a `change` event (MOD's modgui javascript port-value callback) and moves the meter it names. A meter is drawn twice, in
the same box: as a bar (the `console` and `3d` looks) and as an analog needle (the `vintage` look: a cream dial, a black needle, an
orange zone), the look class showing one of them. The needle's angle is a function of the port's value, declared once in
`tools/look/geometry.json`, `vu`: the sweep (`angleMin` to `angleMax`, degrees from vertical), the fraction of the sweep that is the orange zone,
and the ballistics, `tauMs` per meter kind: a level needle rises and falls like a VU, a first-order lag of 300 ms
(`value += (target - value) * (1 - exp(-dt / tau))`, stepped by the script on a timer), and the gain-reduction needle is REVERSED: it rests at
the right (0 dB) and swings left as the gain is reduced. The needle is a DOM transform; no port is written.

**The clip lamp on a dial** (omx-panel#218). The vintage look hides the frames, so a frame's clip lamp is never seen there: a dial whose
meter has a clip word (`clip: true` in the description) wears its own, a period peak lamp. It is a round jewel of `meterLamp` px in a ring
of the strong border, set in the dial's top right corner where a VU meter's peak lamp sits, at the frame lamp's place measured inside
the face's border: 5 px in from the right and 3 px down inside the bezel (`meterLamp(w, border)`, the dials' places and bezels
`vuFaces`). Dark, it is the look's unlit lamp (`--led-off`, the unlit lens the bypass lamp wears); lit, it is the meter red, the
frame lamp's colour, glowing. The lamp follows the clip word as the frame's does: the same `omx-clip-lit` class, set
while omx-dsp's clip word is (lit by a clip, kept lit until cleared), and a dial whose meter has no clip word wears none. The
caption keeps clear of it, as the frame's does. Ruling (#218): the renderer and Tk draw the description's frames in every look (the
description carries no dial and the renderer's style picks only its knob), so the vintage leg of `meter-surfaces` holds the dial's
lamp to the renderer's frame lamp by what they share: lit or dark at every tick, and each lamp's edges against its own face's
declared place.

## Tiers and edge bands

A plugin declares each control's tier in its panel block, `tiers` (symbol to `easy` or `advanced`; a control that names none is
advanced). MOD has no live switch, so the MOD GUI is generated for one tier: the `modgui-tier` setting (values `easy`, `advanced`,
default `advanced`), `omx-panel modgui --tier <name>`, else `$OMX_MODGUI_TIER`, beside `--look`. Easy draws the easy controls and
leaves the advanced ones out; Advanced draws every control. A plugin that names no easy control draws everything in Easy (nothing
says easy, so nothing disappears). An unknown tier is refused by name (exit 2).

A section may declare `edges`: its first and last band, borrowed from another section's controls. An EQ draws the plugin's high-pass
as its first band and its low-pass as its last, `[HPF] [Band 1..N] [LPF]`, each edge band on a row of its own with `data-band` on its
controls. Only the drawing moves: the audio order is the plugin's, and an `Order` control the plugin declares (set advanced) shows
it. The section's curve carries the filters' roll-off when the panel's `roles` bind `hpf_freq`/`hpf_slope` and `lpf_freq`/`lpf_slope`
(omx-dsp's twin draws them in the response).
A slope that is a choice (12 or 24) takes its unit from the descriptor's `choiceUnits` (omx-contract: a choice control's name to
its unit, `dBPerOct` or `dB` for a slope), declared once by the plugin, so the panel description, the MOD GUI and every host read the
one unit and the twin takes the choice as a slope term (`test/modgui-choice-units.test.mjs`). A panel block declares no unit
(#68): the schema has no `choiceUnits` word, and `panelLayout` refuses an option of that name.
