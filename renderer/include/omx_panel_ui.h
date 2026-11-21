/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * omx_panel_ui.h — a plugin's own panel as a host protocol needs it, with no CLAP or LV2 in it (docs/plugin-ui.md). A plugin
 * hands in its panel description (`omx-panel layout`'s output) and its parameters; the library binds each control to its
 * parameter (the travel, the value read-back, the gesture the control takes) and tells the host, through three callbacks, which
 * value moved. A CLAP `clap.gui` adapter and an LV2 `ui:X11UI` adapter are each a page of calls into this header, and no
 * plugin has drawing code of its own.
 *
 * The drawing, the gestures and the binding are here once, in C, so every toolkit and every host gets one behaviour (owner
 * ruling 2026-11-19). The window half needs the library built with the window (docs/renderer.md); the rest draws to a
 * buffer and answers events with no window system at all.
 *
 * One ui per panel; not thread-safe: every call from the thread that created it (a host's GUI thread).
 */
#ifndef OMX_PANEL_UI_H
#define OMX_PANEL_UI_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "omx_panel_render.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct omx_panel_ui omx_panel_ui_t;

/** One parameter of the plugin, in the order the host numbers them (`param` in the calls below is the index in this array). `symbol`
 * names the control of the layout it drives (a parameter no control names is not drawn). `min`, `max`, `def` and `step` are the
 * parameter's own unit, `step` 0 for none; `log` a logarithmic travel; `integer` a stepped one, whose `labels` (`nlabels` of
 * them, from `min`) name each step. `read_only` makes its control take no gesture. `unit` ends the value text ("dB", "Hz"), or "". */
typedef struct omx_panel_ui_param {
  const char *symbol;
  const char *unit;
  double min, max, def, step;
  bool has_def, log, integer, read_only;
  const char *const *labels;
  size_t nlabels;
} omx_panel_ui_param_t;

/** What the host is told. `begin` and `end` bracket a gesture (a host's automation touch and release), `set` carries the value in
 * the parameter's own unit, as many times as the gesture moves it. Each may be NULL. */
typedef struct omx_panel_ui_host {
  void *user;
  void (*begin)(void *user, uint32_t param);
  void (*set)(void *user, uint32_t param, double value);
  void (*end)(void *user, uint32_t param);
} omx_panel_ui_host_t;

/** A ui for the panel `layout_json`, its look, geometry and font read from `data_dir` (omx-panel's tools directory, as
 * omx_panel_view_create_from_data does; NULL is the installed one, <datadir>/omx-panel/tools). The parameters and the host are copied. NULL with the reason in `err`. */
omx_panel_ui_t *omx_panel_ui_create(const char *layout_json, const char *data_dir, const omx_panel_ui_param_t *params, size_t nparams,
                                    const omx_panel_ui_host_t *host, char *err, size_t err_size);
void omx_panel_ui_destroy(omx_panel_ui_t *ui);

/** The maker's and the plugin's name drawn in the head. */
void omx_panel_ui_set_title(omx_panel_ui_t *ui, const char *brand, const char *name);

/** The panel's natural size, in logical px. */
void omx_panel_ui_natural_size(const omx_panel_ui_t *ui, uint32_t *width, uint32_t *height);

/** The host's reading of parameter `param`, in its own unit (a port event, a parameter flush): the control shows it, with its text.
 * It is never echoed back through `set`. False for a parameter no control draws, or one out of range. */
bool omx_panel_ui_set_value(omx_panel_ui_t *ui, uint32_t param, double value);

/** What parameter `param`'s control shows: its place along its travel and its value in the parameter's own unit. False for a parameter
 * no control draws. */
bool omx_panel_ui_reading(const omx_panel_ui_t *ui, uint32_t param, double *fraction, double *value);

/** Where parameter `param`'s control takes a press, in logical px (x, y, width, height), and the pixels a drag over its whole travel
 * covers (omx_panel_view_target_rect): for a test, and for a host that places its own overlay. False for a hidden control. */
bool omx_panel_ui_target_rect(const omx_panel_ui_t *ui, uint32_t param, double rect[4], double *travel_px);

/** A meter's reading: the level in the meter's own unit and the time since the last reading, in seconds (the marker's hold and fall
 * follow it). False when the layout has no meter of that symbol. */
bool omx_panel_ui_set_meter(omx_panel_ui_t *ui, const char *symbol, double value, double elapsed);

/** One input event, in the panel's logical px (omx_panel_view_input). The values it changed are told to the host through `set`,
 * between `begin` and `end` of the gesture; the return is how many values changed. */
size_t omx_panel_ui_event(omx_panel_ui_t *ui, const omx_panel_event_t *event);

/** Advance the clock without an event (a press held long enough becomes the "more" gesture); a window's idle does it. */
size_t omx_panel_ui_tick(omx_panel_ui_t *ui, double now_ms);

/** The panel drawn into `buffer` by the CPU rasteriser (omx_panel_view_draw): a screenshot, a test, a host with no window. */
bool omx_panel_ui_draw(omx_panel_ui_t *ui, const omx_panel_buffer_t *buffer);

/* ------------------------------------------------------------------------------------------------------- the window
 * Built with the window (WINDOW=1); a build without it answers false and says so in `err`. */

/** Open the panel's window, hidden: embedded in `parent` (an X11 Window, what CLAP's clap_window and LV2's ui:parent give), or a
 * window of its own when `parent` is 0, at `scale` device px a logical px. Pointer, wheel and key events reach `omx_panel_ui_event`. */
bool omx_panel_ui_open(omx_panel_ui_t *ui, uintptr_t parent, double scale, char *err, size_t err_size);
void omx_panel_ui_close(omx_panel_ui_t *ui);
bool omx_panel_ui_show(omx_panel_ui_t *ui);
bool omx_panel_ui_hide(omx_panel_ui_t *ui);
/** Handle the window's events and redraw what changed: a host's GUI timer, or LV2's idle interface. `now_ms` is the host's clock. */
void omx_panel_ui_idle(omx_panel_ui_t *ui, double now_ms);
/** The window's size in device px and its native handle (an X11 Window); 0 when none is open. */
void omx_panel_ui_window_size(const omx_panel_ui_t *ui, uint32_t *width, uint32_t *height);
uintptr_t omx_panel_ui_native(const omx_panel_ui_t *ui);
/** The window's next frame, read back (omx_panel_window_read): for a test of what a host would show. */
bool omx_panel_ui_window_read(omx_panel_ui_t *ui, const omx_panel_buffer_t *buffer);

#ifdef __cplusplus
}
#endif

#endif
