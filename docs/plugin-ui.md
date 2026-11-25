<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# The plugin ui library

`libomx-panel-ui.so.0` (`renderer/include/omx_panel_ui.h`) is what a plugin's own GUI is made of, for every host protocol: CLAP's `clap.gui`
and LV2's `ui:X11UI` are each a page of calls into it (omx-plugins `docs/plugin-guis.md`). It has no CLAP or LV2 in it, and a plugin has
no drawing code of its own: the drawing, the layout, the gestures and the binding of a control to a value are written once, here, in C.

## What a plugin hands in

- its **layout**, the output of `omx-panel layout` for its descriptor and declared panel (`docs/panel-layout.md`), as text in memory;
- its **parameters**, in the order the host numbers them: the symbol of the control each drives, and its own unit, travel (`min`, `max`,
  `def`, `step`, `log`, `integer`, the labels of an integer's steps) and `read_only`;
- three callbacks, `begin`, `set` and `end`, to tell the host a gesture's start, each value, and its end.

The look, the geometry and the font are omx-panel's own, read from `<datadir>/omx-panel/tools` (or the directory the caller names).

## What it does

- `omx_panel_ui_set_value` shows the host's reading in the control (the fraction along the travel, the text in the parameter's unit, an integer's
  label) and never reports it back through `set`.
- `omx_panel_ui_event` and `omx_panel_ui_tick` take the renderer's input (`omx_panel_view_input`): the gesture moves the control, and the host is told
  `begin`, then each value in the parameter's own unit, then `end`. A control no parameter drives, and a `read_only` one, takes no gesture.
- `omx_panel_ui_draw` draws the panel into a CPU buffer, with no window system.
- Built with the window (`make WINDOW=1`): `omx_panel_ui_open` makes the window, embedded in a host's X11 window or of its own; `omx_panel_ui_idle` is the
  host's GUI timer. Without it these answer false by name and the rest works.

## Loaded at run time

A plugin's binary links nothing of this: its adapters `dlopen("libomx-panel-ui.so.0")` when a host first asks for a GUI. The library exports
`omx_panel_ui_*` and nothing else (`src/ui-exports.map`, held to the header by `renderer/test/ui.test.mjs`), and carries the renderer's objects inside.

## Tests

`renderer/test/ui.test.mjs` runs `ui_driver` (headless) over ZamComp's committed layout; `ui-sabotage.test.mjs` breaks one rule at a time in a copy of
`src/ui.c` and holds each arm red; `ui-window.test.mjs` opens the window under Xvfb in CI (`WINDOW=1`, `OMX_PANEL_WINDOW_REQUIRED=1`). Not covered: the
window's pointer, wheel and key events reaching the gesture (no synthetic X11 input yet).
