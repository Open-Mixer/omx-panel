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
  omx-contract's contract directory (`<contractdir>/3/<package>/plugins/<name>.json`).
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

A bar group ([panel-layout.md](panel-layout.md) "Bars"; a declared section's `bars: true` or `false` wins over the rule) is a row of
faders: each control of a run is the fader widget, an ordinary `input-control-port` MOD moves live with its own fader film, its title
the bar's label (`16'`, `1`..`16`). A declared `bars: true` that fails the rule's checks is refused by its code. A section whose
display is a curve (`eq_response`, `transfer_curve`) has a row above its controls: a frame with the basis word (`exact` or
`modelled`) in its caption; the curve is omx-dsp's twin (`@openmixer/omx-dsp`, `curvePoints`) at the come-up values, a static SVG polyline in the template and the same
stroke in the screenshot, with the axis and the basis word; with no twin installed the frame stays alone (`curve: { code: 'no-twin' }`, and
`OMX_PANEL_DSP=required` makes that an error). A band a planter owns (a declared panel's `origins`, an authored descriptor's, from
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
value clears on the grounds it is drawn on, and one default. The values are each host's: the console sets every role
in every theme of its own `tokens.css`, Zynthian's theme maps its palette onto every role. The MOD GUI's host supplies
nothing, so it wears the defaults, the dark look the file names: `tools/look.mjs` writes them, with the font, into
`tools/look.json`, and the renderer's role list into `renderer/src/look_roles.h`; `omx-panel look --check` refuses
either when it is not what the role file gives. No surface spells a colour, and every token a surface reads is a
role (`test/look-roles.test.mjs`). The package exports the file as `@openmixer/omx-panel/look-roles.json`.

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
value into it and the template carries no value text; the unit (from the descriptor) is its `data-unit`. A selector's own value
element is bound the same way.

The knob film strips of `vintage` and `3d` are generated from one SVG each (`tools/look/knob-vintage.svg`, `knob-3d.svg`): 65
frames of 48 px, left to right, minimum to maximum, MOD's horizontal sprite. `tools/svg-knob.mjs` paints the SVG's small subset
with `tools/raster.mjs`, the generator's own byte-deterministic rasteriser, so the strips need no external tool. `node
tools/look-contrast.mjs` prints the contrast of every text pair of every look; `console` and `3d` never fall below the flat look's,
`vintage` clears 4.5:1 on every pair.

## The map: the console's vintage, element by element

The owner's rule: any vintage look goes into mod-ui, so the `vintage` look draws each console element in the console's own
tokens. `tools/look/console-map.json` is the MAP (the table below is it, printed); `test/modgui-console-map.test.mjs` holds
every row to it: each token a row lists is in the pin, is named as a placeholder (`{console:--x}` or `{finish:--x}`) in the look
token or the drawing the row names, and is worn as the pinned value in `tools/look.json`; and a value moved in a `tokens.css` goes
red in the drift check, token by token. A row marked "the owner's mock" is not a console element (the cream enclosure, the label
plate, the red LED) and reads no pinned token.

| Row | Console element | MOD GUI element | Pinned tokens |
|---|---|---|---|
| `knob-cap` | Encoder.vue .cap: a radial cap-hi to face gradient | knob film strip, the domed cap (tools/look/knob-vintage.svg) | `finish:--knob-cap-hi`, `finish:--knob-face` |
| `knob-rim` | Encoder.vue .cap stroke: the rim | knob film strip, the rim | `finish:--knob-edge` |
| `knob-knurl` | Encoder.vue .knurl: the knurled edge | knob film strip, the teeth ring | `finish:--knob-knurl` |
| `knob-pointer` | Encoder.vue .needle with its groove-shade and groove-lit walls | knob film strip, the carved pointer | `console:--knob-pointer`, `finish:--knob-knurl`, `finish:--knob-cap-hi` |
| `knob-silk` | Encoder.vue .silk: the 270-degree tick ring printed on the panel | knob film strip, the tick ring | `console:--legend` |
| `knob-shadow` | Encoder.vue .cap drop-shadow(--shadow-1) | knob film strip, the drop shadow | `console:--shade` |
| `fader-cap` | FaderCap.vue: ridges, groove, cream centre line, --shadow-2 | fader film strip (tools/look/fader-vintage.svg) | `finish:--fader-cap`, `finish:--fader-cap-ridge`, `finish:--fader-cap-groove`, `console:--fader-cap-line`, `console:--shade` |
| `screw` | --screw: the panel's screw heads | .omx-pedal::before and ::after | `finish:--screw`, `finish:--knob-cap-hi`, `console:--shadow-1` |
| `glass` | GLASS_WELL (utils/glass.ts): --glass under --glass-grid in the inset track, on every display | .omx-curve, .omx-meter-frame, .omx-display-image | `console:--glass`, `console:--glass-grid`, `console:--inset-track` |
| `scribble` | StripHead scribble strip: glass well, the accent lit | .omx-scribble | `console:--glass`, `console:--accent`, `console:--inset-track` |
| `curve` | EqCurve.vue and DynGraph.vue: the trace in the accent, the legend | .omx-curve-line and the curve's text | `console:--accent`, `console:--legend` |
| `button-cap` | lamp.ts off: a cap in the finish's metal (--btn-face) with its cream legend | .omx-selector-image and the look keys | `finish:--btn-face`, `console:--cap-legend`, `finish:--knob-cap-hi`, `console:--shadow-1` |
| `toggle` | ToggleSwitch.vue: a thumb in --toggle-face on a recessed track | .omx-switch-image and its thumb | `finish:--toggle-face`, `console:--glass`, `console:--inset-track` |
| `footswitch` | the finish's metal cap (knob cap-hi to face, knurl at the edge) | .omx-bypass, the footswitch | `finish:--knob-cap-hi`, `finish:--knob-face`, `finish:--knob-knurl`, `console:--shadow-1` |
| `section-relief` | a panel's --shadow-1 relief | .omx-section | `console:--shadow-1` |
| `vu-bezel` | Meter.vue: the meter sits in recessed glass | .omx-vu, the needle VU's bezel | `console:--glass` |
| `enclosure` | none: the owner's mock, a cream enamel enclosure with a light-to-dark body gradient | .omx-pedal body | none (the owner's mock) |
| `label-plate` | none: the owner's mock, the dark label plate and its serif title | .omx-head and .omx-label | none (the owner's mock) |
| `bypass-led` | none: the owner's mock, the red bypass LED | .omx-bypass-light | none (the owner's mock) |

**What the pin keeps** (`tools/look/console-vintage.json`, read from `tokens.css` at one commit with its sha-256, by
`node tools/look-pin.mjs --write <tokens.css> <commit>`, verified by `--check` and `$OPENMIXER_TOKENS_CSS` in the test): the glass, its
grid, the legend and the accent (`tokens`); the RELIEF the console draws depth with (`relief`: `--shade`, `--shadow-1`, `--shadow-2`,
`--inset-track`); the base control paint no finish changes (`base`: `--knob-pointer`, `--fader-cap-line`, `--cap-legend`); and the three
FINISH blocks (`finish`: aluminium, graphite, black; the metal a knob, a fader cap, a button cap, a toggle and a screw are made of),
aluminium being the default (`defaultFinish`, the console's default `data-finish`). `tools/look.mjs` writes them into `tools/look.json`
(`console`), and each look names its metal with the `--finish` token (`aluminium` for vintage, `none` for the others).

**The metal knob and fader.** The vintage knob and fader film strips are generated from `tools/look/knob-vintage.svg` and
`tools/look/fader-vintage.svg` through `tools/svg-knob.mjs`; every colour in them is a pinned placeholder, so a re-pin or another
finish re-draws them with no hand drawing and no binary in the tree. The knob is Encoder.vue's: a radial cap-hi to face cap, an edge
rim, a knurled ring, a pointer between a shaded and a lit groove wall, the silkscreened tick ring and the drop shadow.

**3d is its own look.** Four roles tell `3d` from the console's flat look, each held by a test: raised sections (a gradient plate under
an outer drop shadow with a lit top edge, `--section-bg` and `--section-shadow`), recessed glass with a highlight (`--screen-shadow`: an
inset sink with a lit lower lip), keycap switches with a pressed state (`--key-shadow` and `--switch-shadow` stand a cap on its own
thickness, `--key-pressed-shadow` sinks it), and a glowing accent bar (`--accent-bar-glow` on the head's rule).

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
A slope that is a choice (12 or 24) has no unit in a descriptor: the panel declares it, `choiceUnits` (symbol to unit, `dB/oct` or `dB` for a slope), the
panel description's own extras shape, and the MOD GUI passes it to the twin, so the choice is a valid slope term (`test/modgui-choice-units.test.mjs`).
