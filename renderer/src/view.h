/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * view.h — what a view holds, shared by view.c (the layout and the drawing) and input.c (the gestures). Internal.
 */
#ifndef OMX_PANEL_VIEW_H
#define OMX_PANEL_VIEW_H

#include <omxcontract/omx_vocabulary.h>
#include <omxdsp/mix/omx_meter_view.h>

#include "draw.h"

typedef enum { W_KNOB, W_FADER, W_SWITCH, W_SELECTOR, W_METER, W_CURVE, W_XY, W_DISPLAY } widget;

/* The standard widgets by omx-contract's names (PANEL_STANDARD_WIDGETS): a widget it adds is drawn
 * here before the count below lets this file build. */
static const struct { const char *name; widget w; } WIDGET_NAMES[] = {
    {OMX_PANEL_STANDARD_WIDGETS_KNOB, W_KNOB},       {OMX_PANEL_STANDARD_WIDGETS_FADER, W_FADER},
    {OMX_PANEL_STANDARD_WIDGETS_SWITCH, W_SWITCH},   {OMX_PANEL_STANDARD_WIDGETS_SELECTOR, W_SELECTOR},
    {OMX_PANEL_STANDARD_WIDGETS_METER, W_METER},     {OMX_PANEL_STANDARD_WIDGETS_CURVE, W_CURVE},
    {OMX_PANEL_STANDARD_WIDGETS_XY, W_XY},           {OMX_PANEL_STANDARD_WIDGETS_DISPLAY, W_DISPLAY},
};
_Static_assert(sizeof WIDGET_NAMES / sizeof *WIDGET_NAMES == OMX_PANEL_STANDARD_WIDGETS_COUNT,
               "every standard widget of omx-contract is drawn");

typedef struct {
  char *symbol, *label;
  int section;
  widget w;
  double fraction;
  char *text;
  uint32_t at, count;
  /* visibility (the description's visibleWhen and mask): shown while bit `value` of `mask` is set, `value` the
   * governing control's current integer; `gov` NULL for a control always shown */
  char *gov;
  uint64_t mask;
  int64_t value;
  /* the bar group (the section's `bars`): the bar's label, NULL for a control in no bar. A bar is drawn as a fader, labelled by the bar. */
  char *bar;
  /* the travel the host gave (input.c): the control's own unit; none given is 0..1, linear, no default */
  struct { double min, max, def, step; int given, has_def, log, integer; } travel;
  int read_only, hold;
  /* the value in the control's own unit as the last gesture left it, good while `fraction` is what it was left at (so a reset
   * reads the declared default exactly and a host's read-back replaces it) */
  double gv, gv_frac;
  int gv_ok;
} control;

/* A display of the description (`displays`): a curve drawn from points the host gives, never computed here. */
typedef struct {
  int section;
  int log_x;     /* eq_response: x in Hz on a log axis; transfer_curve: input dB on a linear one */
  int symmetric; /* eq_response: y in dB about 0; transfer_curve: output dB on the input's span */
  char *basis;   /* "exact" or "modelled", printed in the caption place */
  double *x, *y;
  size_t n;
  /* the marks a host hands with the points: one per band a planter owns, none by default */
  double *mark_freq, *mark_depth;
  char *mark_letter;
  size_t nmarks;
} display;

/* One meter of the description's `meters` (contract 7.9): its range is the description's, its reading the host's. A meter whose
 * symbol is a control of a section is that control's reading and is not drawn again; the others stand in a band of their own. */
typedef struct {
  char *symbol, *label, *unit;
  double min, max;
  int gain_reduction; /* the bar grows from the top of the range toward its foot */
  int in_band;        /* drawn in the meters band */
  int has;            /* a reading was given; until then the frame stands */
  double fill;        /* the last reading's fraction of the range, 0..1 */
  double marker;      /* the marker's fraction, omx_meter_view_step()'s */
  struct omx_meter_view view; /* omx-dsp's view state: the peak the marker took and the time since */
} meter;

typedef struct {
  double pad, headH, sectionTop, sectionGap, sectionPad, sectionTitleH, cellW, cellH, knob, knobTop, switchW, switchH,
      switchTop, selectorW, selectorH, selectorTop, faderW, faderCap, radius, sectionRadius, curveH, curveGap, meterH, meterGap;
} geometry;

typedef struct {
  double brand, brandBase, title, titleBase, small, sectionBase, nameBase, valueBase;
} textsizes;

typedef struct {
  omx_rgb surface, section, body, rim, ink, inkDim, accent;
} palette;

struct omx_panel_view {
  char **sections, **section_keys;
  size_t nsections;
  control *controls;
  size_t ncontrols;
  display *displays;
  size_t ndisplays;
  meter *meters;
  size_t nmeters, nband;
  char *brand, *name;
  int row_controls;
  geometry g;
  textsizes t;
  palette col;
  omx_font *font;
  struct omx_input *in; /* input.c: the gesture declaration and the interaction state; NULL until a surface is set */
  char *gestures_json;  /* schema/gestures.json as given, parsed when the first surface is set */
};


/* view.c: every shown control's cell in logical px (x, y, w, h; 4 per control), the layout a box of width x height at `scale` makes. */
bool omx_view_cells(const omx_panel_view_t *v, uint32_t width, uint32_t height, double scale, double *cells, unsigned char *shown);
/* input.c */
void omx_input_free(struct omx_input *in);
void omx_input_dirty(omx_panel_view_t *v);

#endif
