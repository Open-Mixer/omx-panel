/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * gesture.h — the gesture engine inside libomx_panel (internal: not installed, not exported). It is the one implementation of
 * the gesture vocabulary of docs/panel-gestures.md: a set of TARGETS (a single control, a bar group, a curve handle), each with
 * its members' travels, values and geometry in the surface's logical px, and the events that move them. gesture.c holds all of
 * the arithmetic (the drag threshold, fine, step, second, reset, paint, toggle, ownership and the claim); input.c maps a view's
 * controls onto targets and applies what the engine changed; the JSON door of omx_panel_gesture.h maps a control and a script
 * onto one target and answers as JSON. Nothing here reads the renderer's view, a file or a clock.
 *
 * The declaration (schema/gestures.json) is handed in as its JSON text; every timing, threshold and table cell is read from it.
 */
#ifndef OMX_PANEL_GESTURE_CORE_H
#define OMX_PANEL_GESTURE_CORE_H

#include <stddef.h>
#include <stdint.h>

#include "omx_panel_render.h"

typedef struct ge_engine ge_engine;

#define GE_AUTO (-1) /* a target or member the engine finds itself */
#define GE_NONE (-2) /* a target the host looked for and did not find */

typedef enum { GE_SINGLE, GE_BAR, GE_HANDLE } ge_kind_t;

/* The rows of the declared table, in the order the file's table names them. */
enum { GE_ROW_KNOB, GE_ROW_FADER, GE_ROW_SWITCH, GE_ROW_SELECTOR, GE_ROW_METER, GE_ROW_DISPLAY, GE_ROW_CURVE, GE_ROW_XY, GE_ROW_BAR, GE_ROW_HANDLE, GE_ROWS };

/* A member's travel in its own unit and its value now. `step` 0 declares none; `has_def` says `def` is declared. */
typedef struct {
  double min, max, def, step, value;
  int has_def, log, integer;
} ge_member_t;

/* What a target is, in logical px. A single and a handle take a press inside `rect`; a bar group inside one of its `n` columns
 * (`col`, 4 doubles each: x, y, w, h). A handle's members are its frequency, gain and Q, in that order. `tag` is the host's own
 * number for each member (a control index): it comes back with the changes and with every gesture. `horizontal` takes a drag along x. */
typedef struct {
  ge_kind_t kind;
  int row;             /* the table row of the widget; -1 for a widget the table does not know (read-only) */
  const char *widget;  /* the widget's name for the refusals' words, or NULL for the row's */
  const char *section; /* the section key a table exception is layered on, or NULL */
  size_t n;
  const ge_member_t *member;
  const int *tag;
  const char *const *name; /* each member's name for the refusals' words, or NULL: "value", or a handle's freq, gain, q */
  double rect[4];
  const double *col;
  double travel_px;    /* a single's drawn length; 0 takes the declared default */
  double plot[2];      /* a handle's plot size */
  int horizontal, read_only, hold;
} ge_target_t;

/* One gesture, as it stands. */
typedef struct {
  uint32_t id;
  omx_panel_word_t word;
  int input; /* the declared input's index (GE_INPUT_NAMES) */
  double begin, end, shown_until;
  int fine, closed, pointer;
  int target;
  size_t n;       /* the target's members when it opened */
  const int *tag; /* n tags */
  const unsigned char *changed;
  const double *value; /* n values, valid where `changed` */
} ge_gesture_t;

/* A member a call set, latest value. */
typedef struct {
  int target, member, tag;
  double value;
} ge_change_t;

/* A refusal, with the rule's words as the reference gives them. */
typedef struct {
  omx_panel_refusal_t code;
  double t;
  char why[200];
} ge_refusal_t;

/* The declared names, for the one that prints them. */
extern const char *const GE_INPUT_NAMES[];

/* The engine of a declaration; NULL for one that cannot be read. */
ge_engine *ge_open(const char *gestures_json);
void ge_close(ge_engine *e);
/* The row of a widget name ("knob", "bar", ...), -1 for none. */
int ge_row_of(const char *widget);
/* A surface's own timing; the safety hold is refused below the declared floor. OMX_PANEL_REFUSED_NONE when taken; otherwise the
 * rule's words go to `why` (when not NULL). */
omx_panel_refusal_t ge_set_timing(ge_engine *e, const char *name, double ms, char *why, size_t cap);
/* The names a pointer id is printed by in a refusal's words; the default prints the number. */
void ge_set_id_namer(ge_engine *e, const char *(*namer)(void *ctx, uint32_t id), void *ctx);
/* Painting: required on touch (`touch` 0 is refused), optional with a mouse. */
omx_panel_refusal_t ge_set_paint(ge_engine *e, int touch, int mouse);
/* The drawn length of a control that gives none. */
double ge_default_travel_px(const ge_engine *e);
/* The name a refusal code has in the reference (GESTURE_READ_ONLY ...), NULL for none. */
const char *ge_refusal_code(omx_panel_refusal_t r);

/* Targets. Adding copies. `ge_clear` forgets every target and every pointer (the gestures so far stay); `ge_update` takes the
 * same target's new geometry, flags and member values, with the same member count, and keeps its interaction state. */
void ge_clear(ge_engine *e);
int ge_add(ge_engine *e, const ge_target_t *t);
int ge_update(ge_engine *e, int at, const ge_target_t *t);
/* Mark member `member` of target `at` as the selected one (a bar's, what a key then steps); no gesture. */
void ge_select(ge_engine *e, int at, int member);
/* Keep the refusals and the cancellations of every call (the JSON door answers with them). */
void ge_keep_log(ge_engine *e, int on);

/* A member's travel: a value's place on it, 0..1 (a log travel is linear in its logarithm), and the value at a place, in the unit of
 * the control (an integer travel lands on an integer). */
double ge_norm_of(const ge_member_t *m, double v);
double ge_value_of_norm(const ge_member_t *m, double n);

/* A call: `ge_begin`, then one `ge_event` or `ge_tick`, then read the answer. `target` and `member` name what a wheel, detent or
 * key is for; GE_NONE says the host found none for the control it named (refused as no target); GE_AUTO (-1) takes the target at the event's x, y for a wheel and the selected bar, else the only handle, for a key or a
 * detent (a press always takes the target it lands on). */
void ge_begin(ge_engine *e);
void ge_event(ge_engine *e, const omx_panel_event_t *ev, int target, int member);
void ge_tick(ge_engine *e, double t_ms);

const ge_change_t *ge_changes(const ge_engine *e, size_t *n);
/* The gesture the call touched last, NULL for none. */
const ge_gesture_t *ge_touched(const ge_engine *e);
omx_panel_refusal_t ge_refusal(const ge_engine *e);
int ge_cancelled(const ge_engine *e);
/* What a tap selected in the call: target and member, -1 for none. */
void ge_selected(const ge_engine *e, int *target, int *member);
/* The member a target holds selected (a bar's; a tap on a handle or a single leaves -1), -1 for none. */
int ge_selected_member(const ge_engine *e, int at);
double ge_member_value(const ge_engine *e, int at, int member);

size_t ge_gesture_count(const ge_engine *e);
int ge_gesture_at(const ge_engine *e, size_t i, ge_gesture_t *out);
/* The log (ge_keep_log): refusals and cancellations of every call. */
const ge_refusal_t *ge_refusals(const ge_engine *e, size_t *n);
const double *ge_cancellations(const ge_engine *e, size_t *n);

#endif
