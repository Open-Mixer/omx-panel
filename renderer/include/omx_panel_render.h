/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * omx_panel_render.h — the panel renderer: one C library that draws a panel description (what
 * `omx-panel layout` writes, tools/panel-description.mjs) in the omx look, into a plain CPU pixel
 * buffer. Every surface that shows a plugin's panel draws through it: a plugin window (the buffer is
 * blitted into it), a host-embedded inline view at the size the host gives, and a buffer another
 * process ships to the console. docs/renderer.md has the design.
 *
 * The description says what is on the panel; the host says what each control currently reads: its
 * position along its travel (0..1) and the text its plugin formats for that value. The renderer
 * formats no value and reads no travel, so the panel of any plugin, ours or a third party's, is drawn
 * the same way.
 *
 * Nothing here is thread-safe on one view; two views share nothing.
 */
#ifndef OMX_PANEL_RENDER_H
#define OMX_PANEL_RENDER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** A pixel in a buffer: four 8-bit channels in the order named, the colour premultiplied by its alpha (the default,
 * what a compositor blends) or straight (what a PNG holds). */
typedef enum omx_panel_pixel_format {
  OMX_PANEL_PIXEL_RGBA8_PREMULTIPLIED = 0,
  OMX_PANEL_PIXEL_BGRA8_PREMULTIPLIED = 1,
  OMX_PANEL_PIXEL_RGBA8_STRAIGHT = 2,
  OMX_PANEL_PIXEL_BGRA8_STRAIGHT = 3,
} omx_panel_pixel_format_t;

/** A buffer the caller owns: `height` rows of `stride` bytes, each row's first `width` pixels drawn.
 * `scale` is device pixels per logical pixel (1, 2, 1.5 ...): the panel's geometry is in logical px. */
typedef struct omx_panel_buffer {
  uint8_t *pixels;
  uint32_t width;
  uint32_t height;
  uint32_t stride;
  double scale;
  omx_panel_pixel_format_t format;
} omx_panel_buffer_t;

/** What a view is made from, as bytes in memory (nothing is read from disk):
 *  - `description_json`: the panel description, `omx-panel layout` output;
 *  - `look_json`: the look's resolved tokens, tools/look.json;
 *  - `geometry_json`: the face's geometry and text sizes, tools/look/geometry.json;
 *  - `font`, `font_size`: the TrueType file the look names (`--font-file`);
 *  - `gestures_json`: omx-panel's schema/gestures.json (optional: only input reads it).
 * Each is copied or parsed at create; the caller may free them afterwards. */
typedef struct omx_panel_sources {
  const char *description_json;
  const char *look_json;
  const char *geometry_json;
  const uint8_t *font;
  size_t font_size;
  /* `gestures_json`: schema/gestures.json, the one declaration of the gestures and their timings. NULL draws all the same;
   * input then refuses by name (OMX_PANEL_REFUSED_NO_TABLE). The renderer keeps no timing or threshold of its own. */
  const char *gestures_json;
} omx_panel_sources_t;

typedef struct omx_panel_view omx_panel_view_t;

/** A view of one panel, or NULL with the reason in `err` (NUL-terminated, cut to `err_size`). */
omx_panel_view_t *omx_panel_view_create(const omx_panel_sources_t *sources, char *err, size_t err_size);

/** The same, reading the description from `description_path` and the look, geometry and font from
 * `data_dir`: omx-panel's tools directory (the source tree's tools/, or the installed
 * share/omx-panel/tools). */
omx_panel_view_t *omx_panel_view_create_from_files(const char *description_path, const char *data_dir, char *err,
                                                   size_t err_size);

void omx_panel_view_destroy(omx_panel_view_t *view);

/** The controls, in the description's order: their count, and the index of the one named `symbol`
 * (-1 when there is none). */
uint32_t omx_panel_view_count(const omx_panel_view_t *view);
int32_t omx_panel_view_find(const omx_panel_view_t *view, const char *symbol);
/** The symbol of control `index` (owned by the view), or NULL. */
const char *omx_panel_view_symbol(const omx_panel_view_t *view, uint32_t index);

/** The head: the maker and the plugin's name, both UTF-8. NULL leaves one empty. */
void omx_panel_view_set_title(omx_panel_view_t *view, const char *brand, const char *name);

/** A control's current reading: `fraction` its place along its travel (0 the minimum, 1 the
 * maximum, clamped), `text` what its plugin shows for the value (NULL for none). A switch is on from
 * 0.5; a meter fills to the fraction. */
bool omx_panel_view_set_value(omx_panel_view_t *view, uint32_t index, double fraction, const char *text);

/** A selector's reading: option `at` of `count`, and its label. */
bool omx_panel_view_set_choice(omx_panel_view_t *view, uint32_t index, uint32_t at, uint32_t count, const char *text);

/** The points of display `display` (its index among the description's `displays`), ascending in x: for an `eq_response` x in Hz (above
 * zero, drawn on a log axis) and y in dB; for a `transfer_curve` input dB and output dB. They are what the host computed
 * (`omx_curve_points` or its twin): the renderer scales them to the frame and draws the stroke, computes nothing, and prints the
 * display's `basis` word (`exact` or `modelled`) in the caption place. Until points are set the frame and the caption stand. False,
 * changing nothing, for an index with no curve on the panel, fewer than two points, a value that is not finite, an x that does not
 * ascend. The points are copied. */
bool omx_panel_view_set_curve(omx_panel_view_t *view, uint32_t display, const double *x, const double *y, uint32_t n);

/** The marks of display `display`, an `eq_response`: one per band a planter owns (not the operator's), at its frequency in Hz (above zero) and
 * its own depth in dB, with the one letter of its planter (`letters`, one char each). Drawn as a disc on the curve's axes and the letter
 * above it, with the points' axes. The marks come from the host with the points; the renderer infers none and, with none set, draws none.
 * False, changing nothing, for an index with no curve or no log axis, or a frequency that is not above zero or a value not finite. */
bool omx_panel_view_set_marks(omx_panel_view_t *view, uint32_t display, const double *freq, const double *depth, const char *letters, uint32_t n);

/** A governing control's integer value. A control the description shows only for certain values of another (its
 * `visibleWhen` and `mask`, a declared panel's visibleWhen) is shown while bit `value` of its mask is set: a hidden
 * control takes no cell and is not drawn, and a section left with none takes no space. Until it is set, each reads the
 * governing control's come-up value (`visibleWhen.default`). False when no control of the panel is governed by `symbol`. */
bool omx_panel_view_set_integer(omx_panel_view_t *view, const char *symbol, int64_t value);

/** Whether control `index` is shown at the current governing values. */
bool omx_panel_view_visible(const omx_panel_view_t *view, uint32_t index);

/** The size, in logical px, the panel is laid out at with nothing to fit: what a window opens at. */
void omx_panel_view_natural_size(const omx_panel_view_t *view, uint32_t *width, uint32_t *height);

/** Where control `index` sits when the panel is drawn into a buffer of width x height device px at `scale`: its cell,
 * as x, y, width and height in device px. What a pointer event is hit-tested against. False for a hidden control. */
bool omx_panel_view_control_rect(const omx_panel_view_t *view, uint32_t width, uint32_t height, double scale, uint32_t index,
                                 double rect[4]);

/** Draw the panel into `buffer`, every pixel of it: what the panel does not cover is transparent.
 * A buffer smaller than the natural size (times its scale) gets the panel reflowed to fewer controls
 * a row and, if it still does not fit, drawn smaller; a larger one gets it at its natural size in
 * the top-left corner. False, drawing nothing, for a buffer that is not one (no pixels, a zero
 * size, a stride under four bytes a pixel, a scale that is not positive, a format that is not one). */
bool omx_panel_view_draw(omx_panel_view_t *view, const omx_panel_buffer_t *buffer);

/* ------------------------------------------------------------------------------------------------- input
 * One gesture vocabulary (one-panel spec 7.8, docs/panel-gestures.md, schema/gestures.json): the renderer maps a pointer, a wheel,
 * an encoder detent or a key onto it and answers each call with the control, its value, and the gesture's begin and end. It reads
 * every timing, threshold and table cell from gestures.json and keeps none; tools/gestures.mjs is the reference it is held to.
 *
 * Positions are in the panel's logical px, the layout's (the buffer's device px divided by the scale it was laid out at). A
 * control's value is its fraction along its travel (the layout's cell) and, once the host has given the control's travel, the value
 * in its own unit. The renderer does not format or send a value: the host does, and its read-back (`omx_panel_view_set_value`)
 * replaces what the gesture drew.
 */

typedef enum omx_panel_pointer {
  OMX_PANEL_POINTER_TOUCH = 0,
  OMX_PANEL_POINTER_MOUSE = 1,
  OMX_PANEL_POINTER_PEN = 2,
  OMX_PANEL_POINTER_FADER = 3, /* a touch-sensed hardware fader */
} omx_panel_pointer_t;

typedef enum omx_panel_event_kind {
  OMX_PANEL_EVENT_DOWN = 0,   /* a press of pointer `pointer` at x, y */
  OMX_PANEL_EVENT_MOVE = 1,   /* the pointer moved; `fine` marks a fine drag */
  OMX_PANEL_EVENT_UP = 2,
  OMX_PANEL_EVENT_WHEEL = 3,  /* n notches (a negative n the other way); at x, y when `control` is -1 */
  OMX_PANEL_EVENT_DETENT = 4, /* n encoder detents; `encoder` 3 is a handle's Q */
  OMX_PANEL_EVENT_KEY = 5,    /* `key`; `shift` takes the coarse step, a handle's second */
} omx_panel_event_kind_t;

typedef enum omx_panel_key {
  OMX_PANEL_KEY_BACKSPACE = 0,
  OMX_PANEL_KEY_UP = 1,
  OMX_PANEL_KEY_DOWN = 2,
  OMX_PANEL_KEY_LEFT = 3,
  OMX_PANEL_KEY_RIGHT = 4,
} omx_panel_key_t;

typedef struct omx_panel_event {
  double t_ms; /* the surface's clock; only differences are read */
  omx_panel_event_kind_t kind;
  uint32_t pointer; /* the pointer's id, for down, move and up */
  omx_panel_pointer_t type;
  double x, y;
  bool fine;       /* a move: a fine drag */
  int32_t n;       /* a wheel or a detent: the notches, signed */
  bool coarse;     /* a wheel or a detent: coarse */
  int32_t encoder; /* a detent: which encoder (3 is the second) */
  omx_panel_key_t key;
  bool shift;
  /* the control a wheel, a detent or a key is for (a handle's, any of its three; a bar's, that bar): -1 takes the control at x, y
   * for a wheel, and for a key or a detent the bar a tap last selected */
  int32_t control;
} omx_panel_event_t;

/** The words of docs/panel-gestures.md. */
typedef enum omx_panel_word {
  OMX_PANEL_WORD_NONE = 0,
  OMX_PANEL_WORD_DRAG,
  OMX_PANEL_WORD_FINE,
  OMX_PANEL_WORD_STEP,
  OMX_PANEL_WORD_SECOND,
  OMX_PANEL_WORD_RESET,
  OMX_PANEL_WORD_MORE,
  OMX_PANEL_WORD_SELECT,
  OMX_PANEL_WORD_TOGGLE,
  OMX_PANEL_WORD_PAINT,
} omx_panel_word_t;

/** Why an event was refused, by the rule that refused it (the reference's GESTURE_* codes). */
typedef enum omx_panel_refusal {
  OMX_PANEL_REFUSED_NONE = 0,
  OMX_PANEL_REFUSED_READ_ONLY,       /* a read-only control takes no gesture */
  OMX_PANEL_REFUSED_CONTROL_OWNED,   /* it belongs to the pointer, or the stepper's claim, that has it */
  OMX_PANEL_REFUSED_NO_DEFAULT,      /* reset, and the control declares no default */
  OMX_PANEL_REFUSED_NOT_IN_TABLE,    /* the widget has no such input */
  OMX_PANEL_REFUSED_HOLD_SHORT,      /* released before the safety hold */
  OMX_PANEL_REFUSED_NO_TARGET,       /* a step with no bar or handle member to take it */
  OMX_PANEL_REFUSED_NO_TABLE,        /* the view was given no (or an unreadable) gestures.json */
  OMX_PANEL_REFUSED_BAD_SETTING,     /* an unknown timing, or one not above zero */
  OMX_PANEL_REFUSED_HOLD_BELOW_FLOOR, /* a safety hold shorter than the declared floor */
  OMX_PANEL_REFUSED_PAINT_REQUIRED,  /* painting is required on touch */
} omx_panel_refusal_t;

/** A control's value after a call: its place along its travel and, in its own unit, what the host's travel makes of it. */
typedef struct omx_panel_change {
  uint32_t control;
  double fraction;
  double value;
} omx_panel_change_t;

/** What a call did. `gesture` is 0 when none was touched. A gesture's `begin_ms` is where it began (a drag, the press), `end_ms` the
 * last event that moved it (the release when `ended`); `shown_until_ms` how long its value text stays clear of the finger (the
 * release, or through the claim after a step). `undo` is set when the gesture has changed a value: one gesture id is one undo entry. */
typedef struct omx_panel_answer {
  omx_panel_word_t word;
  uint32_t gesture;
  double begin_ms, end_ms, shown_until_ms;
  bool ended;
  bool undo;
  bool cancelled;       /* a release outside the target: nothing happened */
  omx_panel_refusal_t refusal;
  int32_t selected;     /* the control a tap selected in this call (a bar; a handle's frequency control), else -1 */
} omx_panel_answer_t;

/** A control's travel in its own unit, which the host gives (the layout carries none): `min` and `max`, a `def` where `has_def`,
 * `log` for a logarithmic travel, a declared `step` (0 for none: a step is then 1% of the travel), `integer` for a stepped one. */
typedef struct omx_panel_travel {
  double min, max, def, step;
  bool has_def, log, integer;
} omx_panel_travel_t;

/** The box the panel is laid out in (the geometry every position is in) and the scale it is drawn at. Needed before input. */
bool omx_panel_view_set_surface(omx_panel_view_t *view, uint32_t width, uint32_t height, double scale);
bool omx_panel_view_set_travel(omx_panel_view_t *view, uint32_t index, const omx_panel_travel_t *travel);
/** A read-only control takes no gesture (a meter, a display and a curve never do). */
bool omx_panel_view_set_read_only(omx_panel_view_t *view, uint32_t index, bool read_only);
/** A control that acts only when held the safety hold (docs/panel-gestures.md). */
bool omx_panel_view_set_hold(omx_panel_view_t *view, uint32_t index, bool hold);
/** A curve handle bound by roles: the frequency, gain and Q controls, its target (x, y, w, h) and the plot's size (w, h), in logical px.
 * The renderer draws no handle, so the surface places it. False for an index out of range or a handle already bound to a control. */
bool omx_panel_view_set_handle(omx_panel_view_t *view, uint32_t freq, uint32_t gain, uint32_t q, const double target[4], const double plot[2]);
/** A surface's own timing over the declared default: `longPressMs`, `doubleTapMs`, `palmGuardMs`, `safetyHoldMs` (lengthened, never
 * shortened below the declared floor), `claimMs`. Anything else, or a time not above zero, is refused by name. */
omx_panel_refusal_t omx_panel_view_set_timing(omx_panel_view_t *view, const char *name, double ms);
/** Painting across a bar group: required on touch (`touch` false is refused), optional with a mouse. */
omx_panel_refusal_t omx_panel_view_set_paint(omx_panel_view_t *view, bool touch, bool mouse);

/** Answer one event. The controls whose value it changed are written to `changes` (up to `cap`); the return is how many changed. The
 * view's own readings follow (the drawn value follows the finger). `answer` may be NULL. */
size_t omx_panel_view_input(omx_panel_view_t *view, const omx_panel_event_t *event, omx_panel_change_t *changes, size_t cap,
                            omx_panel_answer_t *answer);
/** Advance the clock without an event: a press held the long-press time becomes `more`. A call with an event does it first. */
size_t omx_panel_view_tick(omx_panel_view_t *view, double t_ms, omx_panel_change_t *changes, size_t cap, omx_panel_answer_t *answer);

/** The gestures so far, oldest first, and one of them with the controls it changed. False for an index out of range. */
typedef struct omx_panel_gesture {
  uint32_t id;
  omx_panel_word_t word;
  double begin_ms, end_ms, shown_until_ms;
  bool fine;
} omx_panel_gesture_t;
uint32_t omx_panel_view_gesture_count(const omx_panel_view_t *view);
bool omx_panel_view_gesture(const omx_panel_view_t *view, uint32_t at, omx_panel_gesture_t *out, omx_panel_change_t *changes, size_t cap,
                            size_t *nchanges);
/** A control's current reading: the fraction and the value in its own unit. */
bool omx_panel_view_reading(const omx_panel_view_t *view, uint32_t index, double *fraction, double *value);
/** Where control `index` takes a press, in logical px (a fader or a bar: its track, a bar's column; any other: its cell), and the
 * pixels a drag over its whole travel covers. False for a hidden control or one with no surface set. */
bool omx_panel_view_target_rect(const omx_panel_view_t *view, uint32_t index, double rect[4], double *travel_px);

#ifdef __cplusplus
}
#endif

#endif
