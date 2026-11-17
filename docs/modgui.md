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

A repeated group ([group-model.md](group-model.md): an EQ's bands, a multiband compressor's bands) whose controls fill
some sections exactly is one section drawn as its matrix: each parameter on one row and each band in one column, never
flowed, an EQ always with its bands as columns, HPF leftmost and LPF rightmost, each band's on/off at its head.

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
value clears on the grounds it is drawn on, and one default. The defaults are the vintage look, the console's own
default: the dark theme, the orange accent, the aluminium finish, the vintage style, which the file names as its
`look`. Each default is the value the console's `tokens.css` resolves for that token at that look.

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

The knob is still drawn flat (rim, body, pointer): the metal face, rim and relief the vintage style names are not
drawn yet.

## The test

`tools/modgui-test.sh <bundle.lv2> <descriptor> [<panel>]` holds a written MOD GUI to its descriptor on values:
the files are the generation byte for byte; every control is drawn in the template with its symbol, travel and
default (a readout with its symbol and range, as a display with no port role), every meter that is no control of a section as a static frame with its symbol, range and unit and no port role, and nothing undeclared is; every choice is a selector with each of its values; `sord_validate` accepts
the bundle against the LV2 specifications, `tools/modgui-terms.ttl` (the closed modgui vocabulary) and
omx-contract's resource-hint terms, and refuses a property outside that vocabulary; and a descriptor with its
first control's default moved makes `--check` fail on the template.
