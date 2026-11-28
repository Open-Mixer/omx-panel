<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# The panel renderer

One C library draws a plugin's panel from its panel description, the document `omx-panel describe --layout` serves
([panel-layout.md](panel-layout.md)): the layout, the family's displays and a repeated group's served matrix. Every place a panel is shown draws through it:

- a plugin window in a DAW (CLAP `clap.gui`) or in omx-clap-host;
- a host-embedded inline view, at whatever size the host gives;
- a plain CPU pixel buffer (RGBA or BGRA, a width, a height, a stride and a scale): what a host that
  embeds a plugin's view hands the plugin to draw into.

Each of these draws the same description with the same layout and widget code. The renderer is omx-panel's own
toolkit, for a plugin's own GUI; the web console draws its panels with its own (Nuxt UI) and shows none of its pixels.
The source is in `renderer/`.

## What it draws

The renderer reads the description's sections and controls: each section's label, and each control's
symbol, label, section and standard widget (`knob`, `fader`, `switch`, `selector`, `meter`, `curve`, `xy`,
`display`, omx-contract's `PANEL_STANDARD_WIDGETS`). A widget name it does not know is refused by name,
and the build fails when omx-contract adds a widget the renderer does not draw yet.

The description says what is on the panel. The host says what each control reads now: its place along its
travel (0 to 1) and the text the plugin gives for that value (CLAP's `value_to_text`, or the host's own
formatting for an LV2 port). A selector gets its option and the number of options. The renderer formats no
value and reads no travel, so a third-party plugin's panel is drawn exactly as one of ours.

The face is the MOD GUI's face, drawn the same way to the bit: the head (maker and name), each section with
its label, each control in its cell with its label and value text. The look (colours, font) is
the colour roles of `schema/look-roles.json` as its host values them, `tools/look.json` (the vintage tokens, the
roles' defaults: [modgui.md](modgui.md) "The look") when it passes no other; a look short of any role is refused by
the role's name, with no other role drawn in its place. A knob's pointer is drawn in `--knob-pointer` and a curve's
stroke in `--curve-stroke`, neither in `--accent`. The geometry and text sizes are
`tools/look/geometry.json`, which `tools/modgui-gen.mjs` reads too. The renderer types no colour and no size.

A look that names a style (`style`, one of its `looks`) is worn whole, as the MOD GUI's face wears it (#123): the enclosure
(`--enclosure`, where `--body-bg` names it) with the body's radius, the head plate (`--head-bg`) inset by `--head-inset`,
the head's rule and lamp (`--head-rule`, `--led-on-bg`), the screws in the foot's corners (`--screws`, `--screws-slot`), a
plate under each section (`--section-bg`), the keys and the screens (`--key-bg`, `--key-pressed-bg`, `--screen-bg`), the
scribble strip, the curve's line and each text's ink (`--t-brand`, `--t-label`, `--t-section`, `--t-control`, `--t-value`,
`--t-key`, `--t-screen`, `--t-screen-dim`), and the knob the style names (`--knob`). A token is read by the face's rule: the
first `#rrggbb` its text names, a colour role in braces read from the roles, `none` for a thing not drawn; a gradient is
its first colour, as on the face. A style short of a token the face wears is refused by the token's name. The enclosure is
the first of the style's list: a description names no plugin to choose another by. A look that names no style is worn as
the roles give it. Under the vintage style the panel is the MOD GUI's vintage face, pixel for pixel
(`renderer/test/vintage-face.test.mjs`); a fader is drawn flat in every style, as the face draws it.

A meter fills along the foot of its frame to its reading. A display and an xy pad show a frame and their text
for now; an xy pad gets its own drawing when a description carries what it needs (a pair of controls).

A section's `bars` (a bar group, [panel-layout.md](panel-layout.md) "Bars") is a row of faders: each control of a run is drawn as a fader,
its label the bar's, in its own cell, so `omx_panel_view_control_rect` gives each bar's rectangle for hit-testing as for every control.

A section of a repeated group (an EQ's bands, a multiband compressor's bands: [group-model.md](group-model.md)) carries `matrix`,
the group model's served matrix (`servedMatrix`, "The served matrix") exactly as `omx-panel describe --layout` serves it:
`{ orientation, title, heads, rows, cells, count? }`. The renderer READS it and recomputes nothing: no group, no row order, no
head row, no caption place, no transposition. `heads` are the instances and edges in drawing order, each `{ label, on, edge }`
(`on` its on/off control as `{ symbol, sense }`, nothing else, or null; `edge` the EQ filter's name for a high-pass, shelf or
low-pass, else null); `rows` are the head row, always the first, `{ label: 'On' | '', head: true }`, then the parameters in the owner's
order (freq, gain with the high-pass's and low-pass's slope on that row, q, type, the rest), a row whose cell holds a
parameter other than the row's carrying `labels` (one per head, null where the row's label holds); `cells[row][head]` is a
control's symbol or null. The section is titled by `title`. It draws, in the section's box: the curve rows, then the section's
other controls (those no cell names) flowed in rows of `rowControls` as any section's, then the matrix. In `columns` each head
is a column, left to right, and each row a row; in `rows` each head is a row and each row a column. Every cell, the head row's
among them, is placed as a cell: the control of that row at that head, named by the row's label, or by the row's `labels` entry for that head where
it has one (a head-row control by its head's label), drawn ONCE, there. A head-row cell that is null is the head's caption: its label, in that cell's name place, in a
row of its own (a matrix whose heads have no on/off, omx-delay's taps, has a caption row, and no caption overprints a row of
controls). A head row whose cells differ from the heads' `on`, a second head row, a head row that is not the first, or a head
whose `on` is not a `{ symbol, sense }` object is refused. A null cell is empty and nothing moves into it. A matrix is as wide
as its drawn heads (its rows, in `rows`) and never narrower, whatever width a host gives: a smaller buffer scales the panel, it
does not wrap a matrix. `omx_panel_view_visible_columns(view, width, scale)` is the group model's `visibleColumns` (L7):
`min(across, max(1, floor(width / (cellW x scale))))`, `across` the drawn heads in `columns` and the served rows (the head row
among them) in `rows`, 0 with no matrix; the command's `--visible-columns <width>` prints it, and the test vector
`test/fixtures/group-model/visible-columns.json` holds it to the JavaScript answer. The EQ is `columns`, its high-pass the
first column and its low-pass the last: the order is of the drawing, the audio order is the plugin's.

`count: { symbol, default }` (`default` null when the control has none: every instance is drawn until the host gives a value)
names the control that says how many instances the plugin runs (an EQ's band count); the served matrix carries it only where no
`visibleWhen` rule already governs the instances. The heads drawn are the group model's `drawnHeads`: every head that has an
`edge`, and the first `count` of the others, closed up in order: a hidden head's controls take no cell, are not drawn and have
no rect (as a control `visibleWhen` hides). The value is the control's integer, `default` until the host gives one with
`omx_panel_view_set_integer`; the control itself is drawn as the selector it is, a control of the section. A hidden control of
a drawn head keeps its cell empty. A `matrix` that is not an object, names a control that is not there or not in its section,
places one twice, has a `cells` row of another length than `heads`, or whose `orientation` is neither word is refused by
message, as `bars` is. A section with no `matrix`, and a description with none, is laid out as before.

The tests draw each repeated-group fixture (omx-eq8, the eq-marks EQ, the multiband compressor) from `omx-panel describe
--layout`, as a host does: no fixture carries a matrix of its own making, and no tool grafts one onto a layout. The fixtures whose face draws a curve need omx-dsp's TypeScript twin (`@openmixer/omx-dsp`); without it those
tests FAIL, naming the twin, and never skip, and CI's renderer job installs it. The tests that read only rectangles (HPF first
and LPF last, the count's close-up, the head row first) need no twin and run everywhere.

The layout reads the role vocabulary ([panel-layout.md](panel-layout.md), "Meanings and roles"): with none, no role plays a
meaning, omx-eq8 derives no curve, and its goldens would be drawn without one. So the renderer's tests read the vocabulary as
the JavaScript suite does, with nothing of omx-plugins: `make renderer-check` points `$OMX_ROLE_MEANINGS` at this tree's
stand-in, `test/fixtures/role-meanings/panel-roles.json`, unless the caller names one, and a test run whose vocabulary
declares no role FAILS, naming `$OMX_ROLE_MEANINGS`, before it draws anything.

A display of the description that is a curve (`eq_response`, `transfer_curve`) has a row of its own at the top of its section, above the
controls: a frame, the basis word (`exact` or `modelled`) in its caption place, and the stroke once the host gives points
(`omx_panel_view_set_curve`). The renderer computes no point and picks no axis: the axis is the display's `axis` word, read from the
description (`PANEL_DISPLAY_AXES`, [panel-layout.md](panel-layout.md) "Displays and their axis"), and a display with none, or with
another word, refuses the description by name. The host's points are copied, ascending in x, and scaled to the frame, an
`eq_response` (`log-frequency`) on a log frequency axis with the dB symmetric about 0 to the next 6 dB, a `transfer_curve` (`linear`) on linear dB with input
and output on one span and the unity line. A `time_response` (`time`) (a delay's tap train, a reverb's decay envelope: the processing-view spec, amendment 2026-09-16h) is drawn on a
time axis in ms from 0 to the content's end and a level window from the floor, -60 dB, to 0 (raised to the next 6 dB when a level
exceeds 0), with the 0 dB line as the reference: its envelope is the display's curve (x in ms, y in dB) and its stems are
`omx_panel_view_set_stems`, one per tap from the floor to its level, dimmed by its shade and with its leg letter above; each array is
drawn when the host sets it. A display with no points draws the frame and the word alone. `omx_panel_view_set_marks` gives an `eq_response` its marks, one per band a planter owns (frequency, depth, the planter's letter): a disc on the curve and the letter above it; the renderer infers none. The state file's `"marks"` is `{"<display index>": [{"freq", "depth", "letter"}]}`.

`omx_panel_view_set_spectrum` gives an `eq_response` a measured spectrum in the console's tap modes
(`omx_panel_tap_mode_t`): the bands' centres; PRE's levels (what the processor is given) and POST's (what it gives) in dBFS,
each where the mode shows it (`-INFINITY` is silence, drawn as nothing; a tap the mode hides may be NULL); the filled tap's
peaks; the mode; the delta switch; and the level window the host declares, with a graticule line every `grid_db`. While one
is set the display is drawn on the console analyser's axes, as its line mode draws them: the log frequency axis the bands and
the curve share; ONE dB graticule, the level window's, labelled. PRE or POST alone is its trace's area to the foot in the
meter gradient (red at the top, amber at 0.18, green from 0.5 down) at 0.34 and the trace; BOTH fills POST so and draws PRE as
a dim reference line (the dim ink at 0.7, thinner); with the delta (BOTH only) the two are full-strength lines with no area,
PRE in the dim ink and POST in the accent, and over them each wedge of omx-dsp's `omx_rta_band_delta` (the deadband
`RTA_DELTA_DEADBAND_DB`, the sign, the strength against the EQ's gain limit) in the `--eq-delta-boost` or `--eq-delta-cut`
role at 45 % to 90 % with its strength. A clip tick stands over each band whose peak reaches the top of the window; then the
curve, a gain, parked with 0 dB at the window's middle, and its marks on the same axis. `n == 0` clears it and the display
returns to its own curve axis, exactly. The parity test (`renderer/test/spectrum.test.mjs`) holds the strokes and the
graticule within 1 px of the console's own scene for the same bands and curve, PRE's dim line on the console's, and a wedge
on each of the console's and nowhere else (`test/fixtures/rta/console-scene.json`, made by `tools/rta-console-reference.mjs`
from a console checkout). The state file's `"spectrum"` is `{"<display index>": {"hz", "pre", "post", "peak", "mode",
"delta", "dbMin", "dbMax", "gridDb"}}`, `"mode"` one of `"pre"`, `"post"` and `"both"`, a tap left out for none and a null
level for silence. This signature replaces one that took a single tap's levels, so the shared library's soname is
`libomx-panel-render.so.1` (it was `.so.0`).

The parity of a surface that draws with another rasteriser is held in `renderer/test/harness.mjs`: `strokeParity` (every stroke pixel of the curve layer within 1 px for the console, 2 px for Tk, of the other's, both ways), `barHeights` and `barParity` (heights within a pixel, count, order and labels equal as text). The state file of
`omx-panel-render` gives them as `"curves": {"<display index>": {"x": [...], "y": [...]}}`.

## The C API

`renderer/include/omx_panel_render.h`:

```c
omx_panel_view_t *omx_panel_view_create(const omx_panel_sources_t *sources, char *err, size_t err_size);
omx_panel_view_t *omx_panel_view_create_from_files(const char *description_path, const char *data_dir,
                                                   char *err, size_t err_size);
void omx_panel_view_destroy(omx_panel_view_t *view);

/* a gesture word's name as schema/gestures.json spells it, for a host that is not JavaScript (#23) */
const char *omx_panel_word_name(omx_panel_word_t word);

uint32_t omx_panel_view_count(const omx_panel_view_t *view);
int32_t omx_panel_view_find(const omx_panel_view_t *view, const char *symbol);
void omx_panel_view_set_title(omx_panel_view_t *view, const char *brand, const char *name);
void omx_panel_view_set_head(omx_panel_view_t *view, bool shown);
bool omx_panel_view_set_value(omx_panel_view_t *view, uint32_t index, double fraction, const char *text);
bool omx_panel_view_set_choice(omx_panel_view_t *view, uint32_t index, uint32_t at, uint32_t count,
                               const char *text);
bool omx_panel_view_set_integer(omx_panel_view_t *view, const char *symbol, int64_t value);
bool omx_panel_view_visible(const omx_panel_view_t *view, uint32_t index);
bool omx_panel_view_control_rect(const omx_panel_view_t *view, uint32_t width, uint32_t height, double scale,
                                 uint32_t index, double rect[4]);

void omx_panel_view_natural_size(const omx_panel_view_t *view, uint32_t *width, uint32_t *height);
bool omx_panel_view_draw(omx_panel_view_t *view, const omx_panel_buffer_t *buffer);
bool omx_panel_view_draw_dirty(omx_panel_view_t *view, const omx_panel_buffer_t *buffer,
                               omx_panel_rect_t *rects, size_t cap, size_t *count);
```

A view is made from four inputs held in memory: the description, the look, the geometry and the font
bytes. `create_from_data` reads the description from memory (a plugin's own, generated into its binary) and the rest the same way; `create_from_files` reads them from a description file and omx-panel's tools directory (the
installed `share/omx-panel/tools`, or the source tree's `tools/`). Nothing else is read from disk, so a
plugin can embed the four and draw with no file at all.

The library is built static (`libomx-panel-render.a`) and shared (`libomx-panel-render.so.1`), the shared one exporting
the functions of the header and nothing else (`renderer/src/exports.map`, held to the header by `renderer/test/shared.test.mjs`):
a surface that loads the renderer at run time, such as Zynthian's Tk panel through Python's ctypes, opens the shared one.

The description a host draws is `omx-panel describe --layout`: the layout the one derivation made the description from, the
family's displays included, a repeated group's sections merged into the one that carries its served `matrix`, in the shape
this library reads. `omx-panel layout` alone lays out the declared panel and derives
no display.

`omx_panel_view_draw` fills every pixel of the buffer, transparent where the panel does not reach. At the
natural size times the scale the panel is drawn as laid out. A smaller buffer gets the number of controls
a row that lets the panel be drawn largest, then the panel scaled down to fit; a larger one gets the panel
at its natural size in the top-left corner.

The buffer names its pixel format: RGBA or BGRA, each with its colours premultiplied by alpha (the default,
what a compositor blends) or straight. The panel is drawn with straight alpha and premultiplied at the end,
each channel times its alpha rounded to the nearest. A PNG holds straight alpha, so the command asks for
straight when it writes one: the conversion is at the edge, never inside the drawing.

A face has its head (the maker, the plugin's name, the accent rule and dot, `headH` of the geometry tall) unless the host
calls `omx_panel_view_set_head(view, false)`: then there is none, the sections start at `pad` from the top and the face is
`sectionTop - pad` shorter, so a host drawing one control per view (Zynthian's stock controller under the vintage look,
Open-Mixer/zynthian-ui#70) gets the control, its label and its value and no empty head (#94). The command's state file
says the same with `"head": false`. *Test: `renderer/test/headless.test.mjs`, held to a golden image.*

`omx_panel_view_control_rect` gives a control's cell in a buffer of a given size and scale: what a pointer
event will be hit-tested against.

A control a declared panel shows only for certain values of another (the description's `visibleWhen` and
`mask`, docs/panel-layout.md "Visibility") is shown while bit v of its mask is set, v the governing
control's integer value: its come-up value (`visibleWhen.default`) until the host gives one with
`omx_panel_view_set_integer`. A hidden control takes no cell, is not drawn and has no rect; a section it
leaves with none takes no space, so the panel is drawn exactly as one without them.

## Dirty rectangles

A drag moves one control, and redrawing the whole panel for it costs 14 to 25 ms at 1024 x 416 on a Raspberry Pi 5 (measured with
0.13.7), more than one display frame. `omx_panel_view_draw_dirty` draws into the buffer the last draw went into and repaints only
what changed, then names the rectangles it repainted, so the host converts and blits only those.

- **What marks a rectangle.** The view remembers, for every element of the panel (the head, each section, each control's cell, each
  display, the meters band, each meter in it), the box it filled and a signature of every value its drawing reads: a control's reading
  and text, a selector's option, a meter's bar and marker, a display's points, stems, marks and spectrum, the title. An element whose
  signature or box changed is repainted, and its old box too where it moved (a control a governing value hid, the one that took its
  place). One changed control reports its cell and nothing else; nothing changed reports none.
- **The bleed.** A rectangle is the element's box grown by what its pixels can reach beyond it (anti-aliased edges, a glyph's overhang,
  a mark's letter above its disc): 4 logical px, 8 for a display (`BLEED`, `BLEED_DISPLAY` in `view.c`). The same number decides which
  elements a repaint reaches, so a pixel an element drew is always repainted with it.
- **A repaint is a full draw of that rectangle.** Each rectangle is cleared to transparent and the panel drawn into it through a clip, the
  elements that cannot reach it skipped, the others cut by the clip, the colours premultiplied at the end as a full draw does. Every byte
  outside the rectangles is left as the last draw left it, and the buffer equals a full draw of the same state byte for byte
  (`renderer/test/dirty.test.mjs`).
- **A full draw stands** for the first frame, a buffer that is not the last draw's (another address, size, stride, scale or pixel format),
  a resize, and a panel whose overall size changed (a governing value that grew or shrank it): the whole buffer is drawn and reported as
  one rectangle. The look is read when the view is made, so it never changes under one. `omx_panel_view_draw` always draws the whole
  buffer, and a host that did not keep the last draw's bytes calls it.
- **A mark is held to the plot.** A mark whose frequency or depth is off the axes sits on the plot's edge, so a display draws at most the
  letter over a mark's disc above its frame and `BLEED_DISPLAY` covers it.
- **Short of memory** the view draws the whole buffer and reports it as one rectangle: the layout is the only allocation a dirty draw
  makes, and what the view keeps to compare is taken once, when a draw is remembered (`renderer/test/dirty_alloc.c` fails each in turn).
- **More changes than rectangles.** Up to `cap` rectangles are written; past that the pair whose covering rectangle adds the least area is
  merged until `cap` remain, so a change is never dropped. Rectangles that meet are merged first.

`omx-panel-render --steps <script.json> --steps-out <dir>` is the test's front door: the view is drawn in full, then each state object of
the script is applied and drawn dirty into the same buffer; per step it writes the buffer before, after, and a full draw of the same state
by a view made anew, and prints the step's rectangles.

### Frame budget

One drag frame at 1024 x 416 on the Raspberry Pi 5, covering the input, the draw, the conversion and the blit, has a p99 of at most
16.7 ms, one frame of a 60 Hz display. The figure is declared once, in `schema/frame-budget.json`, and a host's measurement reads it
from there instead of carrying its own (zynthian-ui's `tests/pi/blit_per_frame_on_the_pi.py`).

`make -C renderer bench DESC=<layout.json> [CONTROL=<symbol>]` (`renderer/bench/dirty_frame.c`) times the renderer's share of a drag frame: one
control moved 1000 times, each frame drawn in full and dirty into buffers of the same 1024 x 416 px, p50, p99 and max of each, and the end
buffers held equal. The budget's p99 also covers the host's conversion and blit, which this does not time.

| where | draw | p50 | p99 | max |
|---|---|---|---|---|
| x86_64, Fedora 44 container, `-O2`, the ZamComp panel, `thr` moved: 6720 of 425984 px | full | 3.52 ms | 3.57 ms | 4.91 ms |
| | dirty | 0.217 ms | 0.234 ms | 0.275 ms |
| Raspberry Pi 5 | | owed: the Pi's lock (`/root/pi-busy`) was held when this was written | | |

## Meters

The description's `meters` (docs/panel-layout.md, "Meters") that are no control of a section stand in a band below the
sections: a frame captioned with the label, the range and its unit, a bar along the foot and a marker over it.
`omx_panel_view_set_meter(view, index, value, elapsed)` gives a reading: the bar is the value over the description's range (a
level from the foot, a gain reduction from 0 dB), the marker holds the peak (the deepest reduction) and falls by `elapsed`
seconds at omx-dsp's rate (`fallDbPerSecond` of its `data/primitives/meter.json`, 18 dB/s), the same at any draw rate and on
silence. The marker is omx-dsp's own view law, `omx_meter_view_step` of `<omxdsp/mix/omx_meter_view.h>` (header-only, omx-dsp-devel
at or above 0.32.2, checked by the build), the meter's range standing for the scale; no number of the law is
copied into the source, and the tests hold the drawn marker to omx-dsp's golden fall vectors. Until a reading is given only
the frame stands, which is what the MOD GUI face draws.

A meter whose description says `clip: true` has a clip word, drawn as a lamp at its frame's top right (`meterLamp`, 8 px square
in `tools/look/geometry.json`, 6 px in from the right and 4 px down; the caption is kept clear of it): dark (the frame's body)
until a clip, lit in the meter red while the word is. The word is omx-dsp's view law, `omx_meter_view_clip` and
`omx_meter_view_clip_clear`: `omx_panel_view_set_clip(view, index, clip)` gives a draw tick's clip (whether the source saw one
since the last tick), the word stays lit across ticks until `omx_panel_view_clear_clip(view, index)` (the operator's gesture, or
a reset), and `omx_panel_view_meter_clip(view, index)` reads it. A meter whose description declares no clip word has no lamp
and its word is never lit, whatever its source says. The tests hold the lamp to omx-dsp's clip vector tick by tick
(`renderer/test/meter-clip.test.mjs`).

A meter whose description says `held: false` (its plugin holds nothing between reads) says so in its caption, after the range:
the description's word `words.unheld`. The band's title is `words.meters`. Both are the panel's own words (PANEL_LABELS,
docs/panel-layout.md "Words"), served by the description with their keys: the renderer spells neither, and a description that
draws one without serving it is refused by name.

`renderer/test/meter-surfaces.mjs` draws one recorded stream (`test/fixtures/meters/meters.stream.json`, 80 ticks at about
20 Hz) on three surfaces and measures each from its pixels: the renderer; the MOD GUI's own template and stylesheet in
Chromium, each frame given a bar and a marker through omx-dsp's TypeScript twin (the MOD GUI has no live meter yet); and a Tk
canvas through a Python copy of the law read against omx-dsp's vectors. Every bar end, marker and frame edge is held within
1 px of the renderer's in the browser and 2 px in Tk (`xvfb-run -a node renderer/test/meter-surfaces.mjs`; CI's
`meter-surfaces` job). The stream's ticks carry clips and clears too: each surface lights its lamps by the clip word (the
browser's lamp the MOD GUI template's own, its `omx-clip-lit` class set; Tk's through a Python copy read against omx-dsp's clip
vector), and at every tick each meter's lamp must be lit or dark exactly as the renderer's, its four edges within the same 1 and
2 px; the loudness meter, which has no clip word, reports clips and lights nothing on any surface. `--look vintage` runs the
same stream in the look every bundle wears by default (CI's second step): the MOD GUI there shows its needle dials, so the browser
leg holds each dial's clip lamp (docs/modgui.md, "The clip lamp on a dial") to the renderer's, lit or dark at every tick and its
edges within 1 px of its face's place, counts one lamp on each dial whose meter has a clip word and none on the others, and has no
bar, marker or frame to compare; the renderer and Tk draw their frames as in every look. The command's state takes
`"meters": {"<symbol>": [{"value", "elapsed", "clip", "clear"}, ...]}`, one entry for each draw tick: `clear` true clears the
clip word first, then `clip` true is a clip since the last tick; a `clip` or `clear` that is not true or false is refused.

## Input

The renderer answers input with the one gesture vocabulary (`docs/panel-gestures.md`, one-panel spec 7.8). An event
(`omx_panel_event_t`: a pointer press, move or release, a wheel notch, an encoder detent, a key) goes to
`omx_panel_view_input`, which writes the controls it changed (their fraction along the travel and their value in the
control's own unit) and answers the gesture it touched: its word (`drag`, `fine`, `step`, `second`, `reset`, `more`,
`select`, `toggle`, `paint`), its id (one id is one undo entry), where it began and ended, how long its value text stays
clear of the finger, and the refusal by name when the event was refused.

```c
omx_panel_view_set_surface(view, width, height, scale);          // the box the panel is laid out in
omx_panel_view_set_travel(view, i, &(omx_panel_travel_t){...});  // the control's unit; the layout carries none
omx_panel_view_set_handle(view, f, g, q, target, plot);          // a curve handle bound by roles
omx_panel_event_t e = { .t_ms = 0, .kind = OMX_PANEL_EVENT_DOWN, .pointer = 1, .x = 40, .y = 90 };
omx_panel_change_t changed[8];
omx_panel_answer_t a;
size_t n = omx_panel_view_input(view, &e, changed, 8, &a);       // n controls changed; a.word, a.gesture, a.begin_ms, a.end_ms
```

The renderer keeps no timing, threshold or table cell of its own: it reads `schema/gestures.json` (given in
`omx_panel_sources_t.gestures_json`; `omx_panel_view_create_from_files` finds it at `<data dir>/../schema/gestures.json`,
which is the source tree's, `dist/`'s and an install's layout, else `<data dir>/gestures.json`). A view with none draws
as before and refuses every input by name (`OMX_PANEL_REFUSED_NO_TABLE`). A surface's own timings go through
`omx_panel_view_set_timing`: the safety hold may be lengthened and is refused below the declared floor, and so is any
name or time the declaration does not have.

Positions are the layout's logical px. A control takes presses on its cell; a fader and the bars of a bar group on their
track (a bar's column is the cell's width), and a drag over a fader's whole travel is the cap's travel
(`omx_panel_view_target_rect` gives both). A section's bar group is one target: a drag that leaves the pressed bar's
column paints. The renderer draws no curve handle, so the surface places one (`omx_panel_view_set_handle`: the three
controls its roles bind, its target and the plot's size). A control that is read-only (a meter, a display, a curve, or one
the host marks) takes no gesture, and a control belongs to the pointer that pressed it, or to a stepper through the
claim after a step; a later press is refused. The host's read-back (`omx_panel_view_set_value`) replaces the value a
gesture drew.

`omx-panel-render --input <script.json>` runs a script of events through a view and prints what the renderer answered
(the header of `renderer/src/cli.c` has the script's words). `renderer/test/input.test.mjs` runs the scripted gestures
of the 7.5 fixtures (`fixtures/gestures/scripts.json`) through it, retargeted onto the renderer's own cells, and
holds the values within one declared step of `tools/gestures.mjs`, reset and tap exact, the words, the counts and the
begin and end equal; each guard has its sabotage arm there.

### The gesture unit

The arithmetic of every gesture is one C unit, `renderer/src/gesture.c`, built into `libomx-panel-render`: drag past 10 px
(dead travel), fine at 0.3, step (declared, else 1%; coarse is 5), second (a handle's Q), reset to the declared default,
more and select (never a value), toggle on release inside, painting across a bar group (columns jumped over are
interpolated, one gesture id per sweep), ownership and the claim, the safety hold. `input.c` keeps only the renderer's
mapping: which of the view's controls form a target, where each sits on the surface, and what a gesture changed in the
controls; it hands the engine (`src/gesture.h`, internal) the targets and the event on every call.

The same unit has a JSON door, `renderer/include/omx_panel_gesture.h`, three calls and no struct across them:
`omx_gesture_open(gestures_json, settings_json)`, `omx_gesture_run(ctx, control_json, events_json, answer, cap)` and
`omx_gesture_close(ctx)`. A run takes one control (the member the JavaScript reference's `runGesture` takes) and a
script of events, replays it through a fresh engine and answers as JSON what `runGesture` answers. The ABI of the three is
`renderer/abi/omx_panel_gesture.abi`, held to the header, the export map and the built library by
`renderer/test/shared.test.mjs`. `tools/gestures.mjs` stays the JavaScript reference until it becomes the loader of this
unit's WebAssembly build.

`renderer/test/gesture-c.test.mjs` runs the 20 shipped scripts (`fixtures/gestures/scripts.json`, the package's
`./gestures/scripts.json`) through the C unit, through `renderer/test/gesture_driver.c`, and holds every answer EQUAL to
`tools/gestures.mjs`'s: value, every gesture with its words and times, the undo ids, what was selected, every refusal with
its code and words. So do 117 rules of `docs/panel-gestures.md` and 4500 seeded random controls and scripts.
`renderer/test/gesture-c-sabotage.test.mjs` breaks 51 rules in a copy of the source and watches each go red.

Where the two references differ (each a finding of the first run, none reached by a shipped script; the first disappears when the JS loads this unit as wasm):

- A logarithmic travel's value agrees to a relative 1e-11, not bit for bit: `log` and `exp` are the platform's in C and V8's in
  JavaScript, and `exp(log(x))` doubles the last digit's difference. The shipped log-frequency scripts are exact.
- An integer travel rounds as JavaScript's `Math.round` does, exactly (`round()` then a negative half back up, and -0); the first C port used
  `round()`, which rounds a negative half away from zero, a behaviour fix with its test and arms.
- A wheel's or detent's notch count is a double in both (a fraction counts, 1e300 runs to the end), not an int32.
- Input neither reference can read is refused `GESTURE_BAD_INPUT` by both, in the same words (`tools/gestures.mjs` gained `validateInput` for it).
- A reset with no bar selected is refused `GESTURE_NO_DEFAULT` in both, in the same words (`null declares no default`); the refused gesture's id is spent in both.
- (A JS bug, for the wasm lane to retire with the JS: the reference throws on a move of the finger left of a pinch after the other lifted; the unit ignores that move.)

Still to come: redrawing only what changed.

`renderer/build/omx-panel-render` is the library's front door for tests and tools: it draws a description
with a state file (the title, each control's reading and the governing values, `integers`) into a raw buffer or a PNG.

## One layout, two rasterisers

Every buffer is drawn by one CPU rasteriser; a window is drawn by NanoVG on OpenGL through pugl. Both take
the layout, the widget code and where every line of text is cut from the same place (`renderer/src/view.c`):
the widgets draw through a table of four primitives (`renderer/src/draw.h`: a rounded rectangle, a disc, a
round-capped segment, a line of text), and each rasteriser fills that table once. What differs is only how
a shape becomes pixels.

The buffer needs its own rasteriser. NanoVG has no CPU backend, OpenGL output changes with the driver, and
a host-embedded inline view, the console's copy of a view and the image tests all need the same pixels on
every machine, with or without a GPU. The CPU rasteriser gives that: shapes are filled by coverage over
4 x 4 samples a pixel, coordinates snapped to 1/16 px, rounding half up, text from the TrueType outlines.
A full redraw of ZamComp's 552 x 382 panel takes about 3.5 ms at scale 1 and 11 ms at scale 2 on a laptop
core.

A window takes the GPU when there is one. NanoVG draws the same primitives antialiased on OpenGL 3.3; on a
machine with no GPU, Mesa's software OpenGL draws them.

The CPU rasteriser is the MOD GUI generator's, `tools/raster.mjs`, carried to C operation for operation
(and `tools/font.mjs` with it), built with `-ffp-contract=off`, since a fused multiply-add rounds
differently. So the buffer is the MOD GUI face pixel for pixel: `renderer/test/parity.test.mjs` holds it
equal to `modgui-gen.mjs`'s face at three scales and to the committed MOD GUI screenshot. The MOD GUI's
images can then come from the renderer, and `tools/raster.mjs`'s shapes and `modgui-gen.mjs`'s drawing go
away.

### The rules both languages apply

Helpers that exist in the JavaScript tools and again in the C renderer split in two (#76). A helper that encodes a RULE,
a number both sides must agree on, is held by a shared vector, one JSON file both suites read; pure mechanics stay per
language and are held by the drawing itself.

| Rule | JavaScript | C | Held by |
|---|---|---|---|
| The visible columns (docs/group-model.md L7) | `visibleColumns` (tools/group-model.mjs) | `omx_panel_view_visible_columns` | `test/fixtures/group-model/visible-columns.json` |
| The drawn heads under a count (L6: every edge, the first `count` instances) | `drawnHeads` | `visible_heads` (view.c) | the same vector, its `count` entries, set as a host sets it (the state's `integers`) |
| A governed control shown at a value (docs/panel-layout.md "Visibility": the mask's bit, 0..63) | `visibilityMask`, `isVisible` (tools/panel-description.mjs) | `shown` (view.c) | `test/fixtures/rules/visible-when.json` |
| Every gesture word, timing and refusal (docs/panel-gestures.md) | `runGesture` (tools/gestures.mjs) | `omx_gesture_run` (gesture.c) | `renderer/test/gesture-c.test.mjs`: the shipped scripts, the rules and a seeded fuzz, each answer equal |

Mechanics with no number of their own (a rectangle's arithmetic, the grid of a section, cutting a label to its cell) stay
per language: the C rasteriser is the MOD GUI generator's carried operation for operation, and `renderer/test/parity.test.mjs`
holds the two faces equal pixel for pixel, so a mechanic that drifts is red there. Each vector's readers are sabotage-checked:
a C `shown` that reads bit 64, a `visible_heads` or `drawnHeads` that keeps one instance past the count, a `visibilityMask`
that sets the bit after each value, each turns its vector red.

### The window

`renderer/include/omx_panel_window.h`, built with `WINDOW=1`:

```c
omx_panel_window_t *omx_panel_window_create(omx_panel_view_t *view, uintptr_t parent, double scale,
                                            char *err, size_t err_size);
bool omx_panel_window_show(omx_panel_window_t *window);
bool omx_panel_window_hide(omx_panel_window_t *window);
void omx_panel_window_redraw(omx_panel_window_t *window);
void omx_panel_window_idle(omx_panel_window_t *window);
bool omx_panel_window_read(omx_panel_window_t *window, const omx_panel_buffer_t *buffer);
void omx_panel_window_destroy(omx_panel_window_t *window);
```

A window is embedded in `parent` (an X11 window, as CLAP's `clap_window` and LV2's `ui:parent` give it) or
opens on its own when there is none. With no display (neither `DISPLAY` nor `WAYLAND_DISPLAY`), create
refuses by name instead of failing later. `read` reads the window's next frame back into a buffer, for a
test or a screenshot. A build without `WINDOW=1` links no window system: the buffer path, a plugin's inline
view and a headless worker pay for nothing they do not use.

A window is held to the buffer by structure, not by pixel (`renderer/test/window.test.mjs`, run under
Xvfb). Both must have the same size. In every control's cell, the accent (a fader's line,
a switch, a meter's fill) must be in the same place within 1 px and of about the same amount. The text in
the cell must cover the same extent within 2 px. Block by block, the image must have the same mean colour,
within 20 in a channel for 97 in 100 blocks.

A window takes the pointer, the wheel and the keys the gesture vocabulary reads: `omx_panel_window_set_input` hands each, in the panel's
logical px, to a function the caller gives (a left press, move and release; a scroll step; Backspace and the arrows), and the window
redraws after it. The binding of those events to a plugin's parameters is the ui library's (`docs/plugin-ui.md`).

Next: Wayland when there is a desktop to prove it on, and redrawing only what changed.

## A picture of a panel

`omx-panel picture --descriptor <file> [--panel <file>] --png <out.png> [--stem <name>] [--scale S] [--style <style>]`
(`tools/panel-picture.mjs`) draws a plugin's panel from its declaration alone, for a document that shows it: the layout
`omx-panel describe --layout` derives from the descriptor and the declared panel, the host's side every control at its
declared default with the text the MOD GUI face writes for it and the static curves the face draws (`defaultState`, the
same host side the golden images are drawn with), drawn by this renderer into a PNG. No host runs and nothing is
screenshotted or drawn by hand. The renderer is `$OMX_PANEL_RENDER`, else `omx-panel-render` on the path; the look is
`tools/look.json` in its default style unless `--style` names another of its `looks`. It prints `<width> <height>`; a
descriptor the derivation refuses draws nothing and exits 1, naming the refusal.

The same two files draw the same bytes, and a declaration that changes what is drawn (a section's label, a control taken
off the panel) draws another picture: `renderer/test/picture.test.mjs` holds both, and holds the picture of the served
omx-delay to the renderer's own drawing of the same layout and state, pixel for pixel. omx-plugins' `make panel-images`
draws every plugin's documentation picture this way.

## Dependencies

| What | Used for | Fedora 44 | Debian (bookworm, trixie) | Licence |
|---|---|---|---|---|
| cJSON | reading the description, the look and the geometry | `cjson-devel` | `libcjson-dev` | MIT |
| omx-contract's C headers | the standard widget names | `omx-contract-devel` | `libomx-contract-dev` | GPL-3.0-or-later |
| omx-dsp's meter view (>= 0.32.2) | the meter's marker, header-only | `omx-dsp-devel` | `libomxdsp-dev` | GPL-3.0-or-later |
| libm | | glibc | libc6 | |
| pugl (window) | the window and its events | `pugl-devel` | `libpugl-dev` | ISC |
| NanoVG (window) | drawing in the window | `nanovg-devel` | `libnanovg-dev` | Zlib |
| OpenGL (window) | NanoVG's backend | `mesa-libGL-devel` | `libgl-dev` | MIT |
| node (tests only) | laying out the fixtures, the golden images, the parity with the MOD GUI | `nodejs` | `nodejs` | MIT |

Neither Fedora nor Debian packages pugl or NanoVG. The OpenMixer channel builds both from pinned commits,
as RPM and DEB, for both architectures. The library itself needs only cJSON, omx-contract's headers, omx-dsp's
meter view header and libm. All of these licences can be combined with this repository's GPL-3.0-or-later. The font, Inter, is
under the SIL Open Font Licence, as the MOD GUI already ships it (`tools/fonts/Inter-LICENSE.txt`).

**Ruled 2026-11-24 (#185, #186, #187).** pugl and NanoVG are channel layers with floors, never `pinned-rpms`: each is
published by the channel from Open-Mixer/.github's packaging (`packaging/pugl`, `packaging/nanovg`), built inside-out before
omx-panel (the release chain's order gains the two rows ahead of omx-panel's), and read here by floor, `pugl-devel >=
0.5.9^20261102` and `nanovg-devel >= 0^20260219`, the versions those specs build. The `renderer-window` job installs them from
the channel the day the channel serves them, and its `pinned-rpms` step goes. `libomx-panel-ui` is a binary package of
omx-panel's own spec (`libomx-panel-ui` and `libomx-panel-ui-devel`, header `omx_panel_ui.h`), BuildRequires on those two
floors, its own floor the plugin adapters declare; it is packaged with the library it ships (PR #184).

## Building and testing

```
npm ci && make                 # the tree the tests read: dist/
make -C renderer               # renderer/build/: libomx-panel-render.a and .so.1, omx_panel_render.h, omx-panel-render.pc, omx-panel-render
make -C renderer check         # the golden images, the pixel formats and the parity with the MOD GUI face
make -C renderer WINDOW=1      # the window too: libomx-panel-window.a, omx_panel_window.h, omx-panel-window.pc
xvfb-run -a make -C renderer WINDOW=1 check   # and the window held to the buffer
make -C renderer install PREFIX=/usr DESTDIR=...
```

The tests lay out one of our plugins (omx-delay, a declared panel) and a third-party LV2 plugin (ZamComp,
from its scan alone and under a declared panel). `renderer/test/golden.test.mjs` draws each at its natural
size and at a compact 320 x 200 box, at scale 1 and 2, and holds them to `renderer/test/golden/`: a pixel
may move by 2 in a channel, and at most one in a thousand further. The parity test holds every pixel exactly.
After a change meant to move the pixels, `OMX_PANEL_RENDER_UPDATE=1 node --test test/golden.test.mjs` in
`renderer/` rewrites the golden images; look at each before committing them.
