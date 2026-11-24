/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * view.h — what a view holds, shared by view.c (the layout and the drawing) and input.c (the gestures). Internal.
 */
#ifndef OMX_PANEL_VIEW_H
#define OMX_PANEL_VIEW_H

#include <omxdomain/panel_codes.h>
#include <omxdsp/mix/omx_meter_view.h>

#include "draw.h"

/* The standard widgets, omx-panel's panel domain (PANEL_STANDARD_WIDGETS, rendered into omxdomain/panel_codes.h): a
 * widget it adds is drawn here before the count below lets this file build. A widget's code is its domain code. */
typedef enum {
#define W_OF(code, WORD) W_##WORD = code,
  OMX_PANEL_STANDARD_WIDGETS(W_OF)
#undef W_OF
} widget;

/* a widget's word is its X-macro name, compared without case (view.c): the standard widget words are one lowercase word */
static const struct { const char *name; widget w; } WIDGET_NAMES[] = {
#define W_NAME(code, WORD) {#WORD, W_##WORD},
    OMX_PANEL_STANDARD_WIDGETS(W_NAME)
#undef W_NAME
};
_Static_assert(sizeof WIDGET_NAMES / sizeof *WIDGET_NAMES == OMX_PANEL_STANDARD_WIDGETS_COUNT,
               "every standard widget of the panel domain is drawn");

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
  /* a repeated group's matrix (the section's `matrix`): `placed` when the matrix names the control, `cut` while the matrix's
   * count closes its instance up (view.c apply_counts) */
  int placed, cut;
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
  /* the display's axis, the description's `axis` word (PANEL_DISPLAY_AXES), never its kind's name: */
  int log_x;     /* log-frequency: x in Hz on a log axis; linear: x on a linear span (a transfer curve's input dB) */
  int symmetric; /* log-frequency: y in dB about 0; linear: y on x's span (a transfer curve's output dB) */
  int time_x;    /* time: x in ms from 0 to the content's end, y in dB from the floor (-60) to 0 or the next 6 dB above a level */
  char *basis;   /* "exact" or "modelled", printed in the caption place */
  double *x, *y;
  size_t n;
  /* the stems a host hands a time_response (omx_panel_view_set_stems): one per tap, from the floor to its level, its paint dimmed
   * by its shade (0..1) and its leg letter above (' ' for none); none by default */
  double *stem_x, *stem_y, *stem_shade;
  char *stem_letter;
  size_t nstems;
  /* the marks a host hands with the points: one per band a planter owns, none by default */
  double *mark_freq, *mark_depth;
  char *mark_letter;
  size_t nmarks;
  /* the spectrum a host hands an eq_response (omx_panel_view_set_spectrum): its bands' centres, levels and peaks in dBFS
   * (-INFINITY for silence) on the level window [spec_min, spec_max] with a graticule line every spec_grid; none by default */
  double *spec_hz, *spec_db, *spec_peak;
  size_t nspec;
  double spec_min, spec_max, spec_grid;
} display;

/* One meter of the description's `meters` (contract 7.9): its range is the description's, its reading the host's. A meter whose
 * symbol is a control of a section is that control's reading and is not drawn again; the others stand in a band of their own. */
/* A section's `matrix` (docs/renderer.md): the group model's matrixOf as the description carries it, read and never re-derived.
 * `cell` is nrows x nheads control indices, -1 for an empty cell; `on` a head's on/off control, -1 for none. */
typedef struct {
  char *label;
  int on, edge;
} mhead;
typedef struct {
  int section, columns; /* columns: a head is a column; else a head is a row */
  size_t nheads, nrows;
  mhead *heads;
  char **row_label;
  int *cell;
  int count_ctl;        /* the control that says how many instances run, -1 for none */
  int64_t count;        /* its value: the description's default until the host gives one */
  int head_row;         /* the head row, always the first: its cells are the heads' on/off, a null cell the head's caption */
} matrix;

typedef struct {
  char *symbol, *label, *unit; /* unit: the caption's spelling, the description's unitText (its x-symbol), else its unit */
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
      switchTop, selectorW, selectorH, selectorTop, faderW, faderCap, radius, sectionRadius, curveH, curveGap, meterH, meterGap, scribbleW, scribbleH, screw, screwInset;
} geometry;

typedef struct {
  double brand, brandBase, title, titleBase, small, sectionBase, nameBase, nameBaseStrip, valueBase, readingBase;
} textsizes;

typedef struct {
  omx_rgb surface, section, body, rim, ink, inkDim, accent, pointer, curve, meterGreen, meterAmber, meterRed, scribbleBg, scribbleInk;
  /* what the look's style (looks[style] of look.json) sets over the roles, as the MOD GUI face wears it (tools/modgui-gen.mjs
   * faceColours): the enclosure, the head plate, the head's rule and lamp, the screens, a pressed key, the screws, and each text's ink */
  omx_rgb enclosure, head, rule, lamp, screen, pressed, screws, screwSlot, tBrand, tLabel, tSection, tControl, tValue, tKey, tScreen, tScreenDim;
} palette;

/* The plates of the look's style: which are drawn (a token that says `none` draws nothing), the body's corner radius (below 0: the
 * geometry's) and the head plate's inset from the body's top and sides. */
typedef struct {
  int head, rule, sections, screws;
  double radius, insetTop, insetSide;
} plates;

struct omx_panel_view {
  char **sections, **section_keys;
  size_t nsections;
  control *controls;
  size_t ncontrols;
  display *displays;
  size_t ndisplays;
  meter *meters;
  size_t nmeters, nband;
  matrix *matrices;
  size_t nmatrices;
  char *brand, *name;
  bool headless; /* omx_panel_view_set_head(view, false): no head, the sections start at `pad` */
  int row_controls;
  geometry g;
  textsizes t;
  palette col;
  plates plates;
  omx_scene *knob_scene; /* the knob the look's style names (`--knob` of looks[style]): a drawing of the look, or NULL for the flat knob */
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
