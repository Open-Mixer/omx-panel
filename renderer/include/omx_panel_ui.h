/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 */
/**
 * @file omx_panel_ui.h
 * @brief A plugin's own panel as a host protocol needs it, with no CLAP or LV2 in it (docs/plugin-ui.md). A plugin
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

/** A plugin's panel bound to its parameters, made by omx_panel_ui_create and freed by omx_panel_ui_destroy. */
typedef struct omx_panel_ui omx_panel_ui_t;

/** One parameter of the plugin, in the order the host numbers them (`param` in the calls below is the index in this array). `symbol`
 * names the control of the layout it drives (a parameter no control names is not drawn). `min`, `max`, `def` and `step` are the
 * parameter's own unit, `step` 0 for none; `log` a logarithmic travel; `integer` a stepped one, whose `labels` (`nlabels` of
 * them, from `min`) name each step. `read_only` makes its control take no gesture. `unit` ends the value text ("dB", "Hz"), or "". */
typedef struct omx_panel_ui_param {
  const char *symbol;         /**< the layout's control this parameter drives */
  const char *unit;           /**< the unit the value text ends with ("dB", "Hz"), or "" */
  double min;                 /**< the low end of the travel, in the parameter's own unit */
  double max;                 /**< the high end of the travel, in the parameter's own unit */
  double def;                 /**< the default value, when `has_def` */
  double step;                /**< the step of the travel, 0 for none */
  bool has_def;               /**< whether `def` holds a default */
  bool log;                   /**< a logarithmic travel */
  bool integer;               /**< a stepped travel, each step named by `labels` */
  bool read_only;             /**< its control takes no gesture */
  const char *const *labels;  /**< the name of each step from `min`, or NULL */
  size_t nlabels;             /**< how many `labels` there are */
} omx_panel_ui_param_t;

/** What the host is told. `begin` and `end` bracket a gesture (a host's automation touch and release), `set` carries the value in
 * the parameter's own unit, as many times as the gesture moves it. Each may be NULL. */
typedef struct omx_panel_ui_host {
  void *user;                                              /**< handed back to every callback */
  void (*begin)(void *user, uint32_t param);               /**< a gesture on parameter `param` starts */
  void (*set)(void *user, uint32_t param, double value);   /**< parameter `param` moved to `value`, in its own unit */
  void (*end)(void *user, uint32_t param);                 /**< the gesture on parameter `param` ends */
} omx_panel_ui_host_t;

/** A ui for the panel `layout_json`, its look, geometry and font read from `data_dir`. The parameters and the host are copied.
 * @param layout_json the panel description, `omx-panel layout`'s output
 * @param data_dir omx-panel's tools directory, as omx_panel_view_create_from_data reads it; NULL is the installed one,
 *   `<datadir>/omx-panel/tools`
 * @param params the plugin's parameters, in the order the host numbers them
 * @param nparams how many `params` there are
 * @param host what the host is told, and its `user`
 * @param err where the reason is written when the ui cannot be made
 * @param err_size the size of `err`
 * @return the ui, or NULL with the reason in `err` */
omx_panel_ui_t *omx_panel_ui_create(const char *layout_json, const char *data_dir, const omx_panel_ui_param_t *params, size_t nparams,
                                    const omx_panel_ui_host_t *host, char *err, size_t err_size);
/** Close the ui's window, if one is open, and free the ui.
 * @param ui the ui, or NULL for nothing */
void omx_panel_ui_destroy(omx_panel_ui_t *ui);

/** The maker's and the plugin's name drawn in the head.
 * @param ui the ui
 * @param brand the maker's name
 * @param name the plugin's name */
void omx_panel_ui_set_title(omx_panel_ui_t *ui, const char *brand, const char *name);

/** The panel's natural size, in logical px.
 * @param ui the ui
 * @param width where the width is written
 * @param height where the height is written */
void omx_panel_ui_natural_size(const omx_panel_ui_t *ui, uint32_t *width, uint32_t *height);

/** The host's reading of parameter `param`, in its own unit (a port event, a parameter flush): the control shows it, with its text.
 * It is never echoed back through `set`.
 * @param ui the ui
 * @param param the parameter's index
 * @param value its value, in the parameter's own unit
 * @return false for a parameter no control draws, or one out of range */
bool omx_panel_ui_set_value(omx_panel_ui_t *ui, uint32_t param, double value);

/** What parameter `param`'s control shows: its place along its travel and its value in the parameter's own unit.
 * @param ui the ui
 * @param param the parameter's index
 * @param fraction where the place along the travel, 0 to 1, is written
 * @param value where the value, in the parameter's own unit, is written
 * @return false for a parameter no control draws */
bool omx_panel_ui_reading(const omx_panel_ui_t *ui, uint32_t param, double *fraction, double *value);

/** Where parameter `param`'s control takes a press, and the pixels a drag over its whole travel covers
 * (omx_panel_view_target_rect): for a test, and for a host that places its own overlay.
 * @param ui the ui
 * @param param the parameter's index
 * @param rect where the target is written, in logical px: x, y, width, height
 * @param travel_px where the pixels a drag over the whole travel covers are written
 * @return false for a hidden control */
bool omx_panel_ui_target_rect(const omx_panel_ui_t *ui, uint32_t param, double rect[4], double *travel_px);

/** A meter's reading (the marker's hold and fall follow it).
 * @param ui the ui
 * @param symbol the meter's symbol in the layout
 * @param value the level, in the meter's own unit
 * @param elapsed the time since the meter's last reading, in seconds
 * @return false when the layout has no meter of that symbol */
bool omx_panel_ui_set_meter(omx_panel_ui_t *ui, const char *symbol, double value, double elapsed);

/** One input event, in the panel's logical px (omx_panel_view_input). The values it changed are told to the host through `set`,
 * between `begin` and `end` of the gesture.
 * @param ui the ui
 * @param event the event
 * @return how many values changed */
size_t omx_panel_ui_event(omx_panel_ui_t *ui, const omx_panel_event_t *event);

/** Advance the clock without an event (a press held long enough becomes the "more" gesture); a window's idle does it.
 * @param ui the ui
 * @param now_ms the host's clock, in ms
 * @return how many values changed */
size_t omx_panel_ui_tick(omx_panel_ui_t *ui, double now_ms);

/** The panel drawn into `buffer` by the CPU rasteriser (omx_panel_view_draw): a screenshot, a test, a host with no window.
 * @param ui the ui
 * @param buffer the buffer drawn into
 * @return false when the panel could not be drawn into `buffer` */
bool omx_panel_ui_draw(omx_panel_ui_t *ui, const omx_panel_buffer_t *buffer);

/* ------------------------------------------------------------------------------------------------------- the window
 * Built with the window (WINDOW=1); a build without it answers false and says so in `err`. */

/** Open the panel's window, hidden. Pointer, wheel and key events reach `omx_panel_ui_event`.
 * @param ui the ui
 * @param parent the window to embed it in (an X11 Window, what CLAP's clap_window and LV2's ui:parent give), or 0 for a window
 *   of its own
 * @param scale device px a logical px
 * @param err where the reason is written when no window opens
 * @param err_size the size of `err`
 * @return false with the reason in `err` */
bool omx_panel_ui_open(omx_panel_ui_t *ui, uintptr_t parent, double scale, char *err, size_t err_size);
/** Close the ui's window; the ui stays, and can open another.
 * @param ui the ui */
void omx_panel_ui_close(omx_panel_ui_t *ui);
/** Show the ui's window.
 * @param ui the ui
 * @return false when no window is open */
bool omx_panel_ui_show(omx_panel_ui_t *ui);
/** Hide the ui's window.
 * @param ui the ui
 * @return false when no window is open */
bool omx_panel_ui_hide(omx_panel_ui_t *ui);
/** Handle the window's events and redraw what changed: a host's GUI timer, or LV2's idle interface.
 * @param ui the ui
 * @param now_ms the host's clock, in ms */
void omx_panel_ui_idle(omx_panel_ui_t *ui, double now_ms);
/** The window's size in device px.
 * @param ui the ui
 * @param width where the width is written, 0 when no window is open
 * @param height where the height is written, 0 when no window is open */
void omx_panel_ui_window_size(const omx_panel_ui_t *ui, uint32_t *width, uint32_t *height);
/** The window's native handle.
 * @param ui the ui
 * @return the X11 Window, 0 when no window is open */
uintptr_t omx_panel_ui_native(const omx_panel_ui_t *ui);
/** The window's next frame, read back (omx_panel_window_read): for a test of what a host would show.
 * @param ui the ui
 * @param buffer the buffer read into, the window's size
 * @return false when no window is open or no frame was drawn */
bool omx_panel_ui_window_read(omx_panel_ui_t *ui, const omx_panel_buffer_t *buffer);

#ifdef __cplusplus
}
#endif

#endif
