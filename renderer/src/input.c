/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * input.c — the renderer's side of the one gesture vocabulary (one-panel spec 7.8): which of the view's controls make up a target (a
 * single control, a bar group, a curve handle the surface bound), where each sits on the surface, and what a gesture changed in the
 * controls. The arithmetic — drag, fine, step, second, reset, paint, toggle, ownership and the claim — is gesture.c's, the one
 * implementation behind libomx_panel's omx_gesture_* calls; this file hands it the targets and the event and applies its answer.
 * Every timing, threshold and table cell is read from schema/gestures.json by the engine; no number of that kind is typed here.
 * Positions are the layout's logical px.
 *
 * A TARGET is what takes a gesture whole: a single control, a bar group (a section's run of bar controls: a drag that leaves the
 * pressed bar's column paints) or a curve handle (a frequency, a gain and a Q the surface bound). A target belongs to the pointer
 * that pressed it, or to the stepper through the claim after a step.
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "gesture.h"
#include "omx_panel_render.h"
#include "view.h"

typedef enum { T_SINGLE, T_BAR, T_HANDLE } tkind;
static const int ROW_OF_WIDGET[] = {[W_KNOB] = GE_ROW_KNOB, [W_FADER] = GE_ROW_FADER, [W_SWITCH] = GE_ROW_SWITCH, [W_SELECTOR] = GE_ROW_SELECTOR,
                                    [W_METER] = GE_ROW_METER, [W_DISPLAY] = GE_ROW_DISPLAY, [W_CURVE] = GE_ROW_CURVE, [W_XY] = GE_ROW_XY};

/* What the view keeps of a target: its controls and where it sits. Everything the gesture needs besides is the engine's. */
typedef struct {
  tkind kind;
  int row;       /* the table row */
  size_t n;      /* members: a bar's columns, a handle's freq, gain, q; a single's one */
  int *ctl;
  double rect[4];       /* single and handle: the target; a bar: unused (the columns carry it) */
  double *col;          /* a bar: 4 per column (x, y, w, h) */
  double travel_px;
  double plot[2];       /* a handle */
} target;

struct omx_input {
  ge_engine *ge; /* NULL when the view was given no readable gestures.json */
  uint32_t width, height;
  double scale;
  int surface;
  int paint_mouse;
  target *t;
  size_t nt;
  int dirty;
  double *handles; /* 3 control indexes + 4 rect + 2 plot, per handle */
  size_t nhandles;
  omx_panel_refusal_t refusal;
};

void omx_input_free(struct omx_input *in) {
  if (!in) return;
  ge_close(in->ge);
  for (size_t i = 0; i < in->nt; i++) free(in->t[i].ctl), free(in->t[i].col);
  free(in->t);
  free(in->handles);
  free(in);
}

void omx_input_dirty(omx_panel_view_t *v) {
  if (v && v->in) v->in->dirty = 1;
}

static struct omx_input *input_of(omx_panel_view_t *v) {
  if (!v) return NULL;
  if (!v->in) {
    v->in = calloc(1, sizeof *v->in);
    if (!v->in) return NULL;
    v->in->ge = ge_open(v->gestures_json);
    v->in->dirty = 1;
  }
  return v->in;
}

/* ------------------------------------------------------------------------------------------------- the travel */

static ge_member_t travel_of(const control *c) {
  if (c->travel.given)
    return (ge_member_t){.min = c->travel.min, .max = c->travel.max, .def = c->travel.def, .step = c->travel.step, .has_def = c->travel.has_def, .log = c->travel.log, .integer = c->travel.integer};
  /* none given: a selector is its options, anything else 0..1 */
  if (c->w == W_SELECTOR && c->count > 1) return (ge_member_t){.min = 0, .max = (double)c->count - 1, .integer = 1};
  return (ge_member_t){.min = 0, .max = 1};
}

static double val_of(const control *c) {
  if (c->gv_ok && c->gv_frac == c->fraction) return c->gv;
  ge_member_t m = travel_of(c);
  return ge_value_of_norm(&m, c->fraction);
}

/* ------------------------------------------------------------------------------------------------- targets */

static int shown_control(const omx_panel_view_t *v, size_t i) { return omx_panel_view_visible(v, (uint32_t)i); }

static void build(omx_panel_view_t *v) {
  struct omx_input *in = v->in;
  for (size_t i = 0; i < in->nt; i++) free(in->t[i].ctl), free(in->t[i].col);
  free(in->t);
  in->t = calloc(v->ncontrols + in->nhandles + 1, sizeof *in->t);
  in->nt = 0;
  unsigned char *taken = calloc(v->ncontrols + 1, 1);
  for (size_t h = 0; h < in->nhandles; h++) {
    const double *p = in->handles + 11 * h;
    target *t = &in->t[in->nt++];
    t->kind = T_HANDLE, t->row = GE_ROW_HANDLE, t->n = 3, t->ctl = malloc(3 * sizeof(int));
    for (int k = 0; k < 3; k++) t->ctl[k] = (int)p[k], taken[(int)p[k]] = 1;
    memcpy(t->rect, p + 3, 4 * sizeof(double)), memcpy(t->plot, p + 7, 2 * sizeof(double));
  }
  for (size_t i = 0; i < v->ncontrols; i++) {
    if (taken[i] || !shown_control(v, i)) continue;
    const control *c = &v->controls[i];
    target *t = &in->t[in->nt++];
    if (c->bar) {
      size_t j = i;
      while (j < v->ncontrols && v->controls[j].bar && v->controls[j].section == c->section) j++;
      t->kind = T_BAR, t->row = GE_ROW_BAR, t->n = 0, t->ctl = malloc((j - i) * sizeof(int));
      for (size_t k = i; k < j; k++)
        if (!taken[k] && shown_control(v, k)) t->ctl[t->n++] = (int)k, taken[k] = 1;
      t->col = calloc(t->n * 4 + 1, sizeof(double));
    } else {
      t->kind = T_SINGLE, t->row = ROW_OF_WIDGET[c->w], t->n = 1, t->ctl = malloc(sizeof(int));
      t->ctl[0] = (int)i, taken[i] = 1;
    }
  }
  free(taken);
  ge_clear(in->ge);
  in->dirty = 0;
  /* the engine's targets, as built: the geometry and the values follow on every call (push) */
  for (size_t k = 0; k < in->nt; k++) {
    target *t = &in->t[k];
    ge_member_t *m = calloc(t->n + 1, sizeof *m);
    double *col = t->kind == T_BAR ? calloc(t->n * 4 + 1, sizeof *col) : NULL;
    ge_target_t g = {.kind = t->kind == T_BAR ? GE_BAR : t->kind == T_HANDLE ? GE_HANDLE : GE_SINGLE, .row = t->row, .n = t->n, .member = m, .tag = t->ctl, .col = col};
    if (m) ge_add(in->ge, &g);
    free(m), free(col);
  }
}

/* The geometry of every target at the surface, logical px. */
static int place_targets(omx_panel_view_t *v) {
  struct omx_input *in = v->in;
  if (!in->surface) return 0;
  double *cells = calloc(4 * (v->ncontrols + 1), sizeof(double));
  unsigned char *sh = calloc(v->ncontrols + 1, 1);
  if (!cells || !sh || !omx_view_cells(v, in->width, in->height, in->scale, cells, sh)) {
    free(cells), free(sh);
    return 0;
  }
  const geometry *g = &v->g;
  for (size_t k = 0; k < in->nt; k++) {
    target *t = &in->t[k];
    if (t->kind == T_HANDLE) continue;
    if (t->kind == T_BAR) {
      for (size_t j = 0; j < t->n; j++) {
        const double *cell = cells + 4 * t->ctl[j];
        t->col[4 * j] = cell[0], t->col[4 * j + 1] = cell[1] + g->knobTop, t->col[4 * j + 2] = cell[2], t->col[4 * j + 3] = g->knob;
      }
      t->travel_px = g->knob;
    } else {
      const double *cell = cells + 4 * t->ctl[0];
      const control *c = &v->controls[t->ctl[0]];
      if (c->w == W_FADER) {
        t->rect[0] = cell[0], t->rect[1] = cell[1] + g->knobTop, t->rect[2] = cell[2], t->rect[3] = g->knob;
        t->travel_px = g->knob - g->faderCap;
      } else {
        memcpy(t->rect, cell, 4 * sizeof(double));
        t->travel_px = ge_default_travel_px(in->ge);
      }
    }
  }
  free(cells), free(sh);
  return 1;
}

/* Hand the engine every target's current geometry, flags and member values: what the view holds, which the host may have changed. */
static void push(omx_panel_view_t *v) {
  struct omx_input *in = v->in;
  for (size_t k = 0; k < in->nt; k++) {
    target *t = &in->t[k];
    ge_member_t *m = calloc(t->n + 1, sizeof *m);
    if (!m) continue;
    int read_only = 0;
    for (size_t j = 0; j < t->n; j++) {
      const control *c = &v->controls[t->ctl[j]];
      m[j] = travel_of(c), m[j].value = val_of(c);
      read_only |= c->read_only;
    }
    const control *c0 = &v->controls[t->ctl[0]];
    const char *sec = c0->section >= 0 && (size_t)c0->section < v->nsections ? v->section_keys[c0->section] : NULL;
    ge_target_t g = {.kind = t->kind == T_BAR ? GE_BAR : t->kind == T_HANDLE ? GE_HANDLE : GE_SINGLE, .row = t->row, .section = sec, .n = t->n, .member = m, .tag = t->ctl,
                     .col = t->col, .travel_px = t->travel_px, .plot = {t->plot[0], t->plot[1]}, .read_only = read_only, .hold = c0->hold};
    memcpy(g.rect, t->rect, sizeof g.rect);
    ge_update(in->ge, (int)k, &g);
    free(m);
  }
}

static int member_of_ctl(const target *t, int ctl) {
  for (size_t j = 0; j < t->n; j++)
    if (t->ctl[j] == ctl) return (int)j;
  return -1;
}

/* ------------------------------------------------------------------------------------------------- the front door */

static int ready(omx_panel_view_t *v, omx_panel_answer_t *a) {
  if (a) memset(a, 0, sizeof *a), a->selected = -1;
  struct omx_input *in = input_of(v);
  if (!in) return 0;
  if (!in->ge) {
    if (a) a->refusal = OMX_PANEL_REFUSED_NO_TABLE;
    return 0;
  }
  if (in->dirty) build(v);
  if (!place_targets(v)) return 0;
  push(v);
  ge_begin(in->ge);
  return 1;
}

/* What the call changed, written to the controls (the control follows the finger) and to `out`; the answer about the gesture it touched. */
static size_t finish(omx_panel_view_t *v, omx_panel_change_t *out, size_t cap, omx_panel_answer_t *a) {
  struct omx_input *in = v->in;
  size_t n;
  const ge_change_t *ch = ge_changes(in->ge, &n);
  for (size_t k = 0; k < n; k++) {
    control *c = &v->controls[ch[k].tag];
    ge_member_t tv = travel_of(c);
    double f = ge_norm_of(&tv, ch[k].value);
    c->gv = ch[k].value, c->gv_ok = 1, c->fraction = f, c->gv_frac = f;
    if (c->w == W_SELECTOR && c->count > 0) c->at = (uint32_t)fmin(c->count - 1, fmax(0, round(ch[k].value)));
    if (out && k < cap) out[k] = (omx_panel_change_t){(uint32_t)ch[k].tag, f, ch[k].value};
  }
  if (a) {
    a->refusal = ge_refusal(in->ge), a->cancelled = ge_cancelled(in->ge) != 0;
    const ge_gesture_t *g = ge_touched(in->ge);
    if (g) {
      a->word = g->word, a->gesture = g->id, a->begin_ms = g->begin, a->end_ms = g->end, a->shown_until_ms = g->shown_until;
      a->ended = g->closed == 1 || (g->word != OMX_PANEL_WORD_DRAG && g->word != OMX_PANEL_WORD_FINE && g->word != OMX_PANEL_WORD_PAINT && g->word != OMX_PANEL_WORD_SECOND);
      for (size_t m = 0; m < g->n; m++)
        if (g->changed[m]) a->undo = true;
    }
    int st, sm;
    ge_selected(in->ge, &st, &sm);
    if (st >= 0) a->selected = in->t[st].kind == T_BAR ? in->t[st].ctl[sm] : in->t[st].ctl[0];
  }
  return n;
}

size_t omx_panel_view_input(omx_panel_view_t *v, const omx_panel_event_t *e, omx_panel_change_t *out, size_t cap, omx_panel_answer_t *a) {
  if (!e || !ready(v, a)) return 0;
  struct omx_input *in = v->in;
  int target = GE_AUTO, member = GE_AUTO;
  if (e->kind >= OMX_PANEL_EVENT_WHEEL && e->control >= 0) {
    /* the control the event names is a member of one target; none is no target to step */
    target = GE_NONE;
    for (size_t k = 0; k < in->nt && target == GE_NONE; k++)
      if ((member = member_of_ctl(&in->t[k], e->control)) >= 0) target = (int)k;
  }
  ge_event(in->ge, e, target, member);
  return finish(v, out, cap, a);
}

size_t omx_panel_view_tick(omx_panel_view_t *v, double t_ms, omx_panel_change_t *out, size_t cap, omx_panel_answer_t *a) {
  if (!ready(v, a)) return 0;
  ge_tick(v->in->ge, t_ms);
  return finish(v, out, cap, a);
}

/* ------------------------------------------------------------------------------------------------- the surface and what it gives */

bool omx_panel_view_set_surface(omx_panel_view_t *v, uint32_t width, uint32_t height, double scale) {
  struct omx_input *in = input_of(v);
  if (!in || !width || !height || !(scale > 0)) return false;
  in->width = width, in->height = height, in->scale = scale, in->surface = 1;
  return true;
}

bool omx_panel_view_set_travel(omx_panel_view_t *v, uint32_t i, const omx_panel_travel_t *t) {
  if (!v || !t || i >= v->ncontrols || !(t->max > t->min) || (t->log && !(t->min > 0))) return false;
  control *c = &v->controls[i];
  c->travel.given = 1, c->travel.min = t->min, c->travel.max = t->max, c->travel.def = t->def, c->travel.step = t->step;
  c->travel.has_def = t->has_def, c->travel.log = t->log, c->travel.integer = t->integer;
  c->gv_ok = 0;
  return true;
}

bool omx_panel_view_set_read_only(omx_panel_view_t *v, uint32_t i, bool ro) {
  if (!v || i >= v->ncontrols) return false;
  v->controls[i].read_only = ro;
  return true;
}

bool omx_panel_view_set_hold(omx_panel_view_t *v, uint32_t i, bool hold) {
  if (!v || i >= v->ncontrols) return false;
  v->controls[i].hold = hold;
  return true;
}

bool omx_panel_view_set_handle(omx_panel_view_t *v, uint32_t f, uint32_t g, uint32_t q, const double target[4], const double plot[2]) {
  struct omx_input *in = input_of(v);
  if (!in || !target || !plot || f >= v->ncontrols || g >= v->ncontrols || q >= v->ncontrols || f == g || g == q || f == q) return false;
  for (size_t h = 0; h < in->nhandles; h++)
    for (int k = 0; k < 3; k++)
      if ((uint32_t)in->handles[11 * h + k] == f || (uint32_t)in->handles[11 * h + k] == g || (uint32_t)in->handles[11 * h + k] == q) return false;
  double *nh = realloc(in->handles, (in->nhandles + 1) * 11 * sizeof(double));
  if (!nh) return false;
  in->handles = nh;
  double *p = nh + 11 * in->nhandles++;
  p[0] = f, p[1] = g, p[2] = q;
  memcpy(p + 3, target, 4 * sizeof(double)), memcpy(p + 7, plot, 2 * sizeof(double));
  in->dirty = 1;
  return true;
}

omx_panel_refusal_t omx_panel_view_set_timing(omx_panel_view_t *v, const char *name, double ms) {
  struct omx_input *in = input_of(v);
  if (!in || !in->ge) return OMX_PANEL_REFUSED_NO_TABLE;
  return ge_set_timing(in->ge, name, ms, NULL, 0);
}

omx_panel_refusal_t omx_panel_view_set_paint(omx_panel_view_t *v, bool touch, bool mouse) {
  struct omx_input *in = input_of(v);
  if (!in) return OMX_PANEL_REFUSED_NO_TABLE;
  if (!touch) return OMX_PANEL_REFUSED_PAINT_REQUIRED;
  in->paint_mouse = mouse;
  if (in->ge) ge_set_paint(in->ge, 1, mouse);
  return OMX_PANEL_REFUSED_NONE;
}

uint32_t omx_panel_view_gesture_count(const omx_panel_view_t *v) { return v && v->in && v->in->ge ? (uint32_t)ge_gesture_count(v->in->ge) : 0; }

bool omx_panel_view_gesture(const omx_panel_view_t *v, uint32_t at, omx_panel_gesture_t *out, omx_panel_change_t *changes, size_t cap, size_t *nchanges) {
  ge_gesture_t g;
  if (!v || !v->in || !v->in->ge || !out || !ge_gesture_at(v->in->ge, at, &g)) return false;
  *out = (omx_panel_gesture_t){g.id, g.word, g.begin, g.end, g.shown_until, g.fine != 0};
  size_t n = 0;
  for (size_t m = 0; m < g.n; m++) {
    if (!g.changed[m]) continue;
    ge_member_t tv = travel_of(&v->controls[g.tag[m]]);
    if (changes && n < cap) changes[n] = (omx_panel_change_t){(uint32_t)g.tag[m], ge_norm_of(&tv, g.value[m]), g.value[m]};
    n++;
  }
  if (nchanges) *nchanges = n;
  return true;
}

bool omx_panel_view_reading(const omx_panel_view_t *v, uint32_t i, double *fraction, double *value) {
  if (!v || i >= v->ncontrols) return false;
  if (fraction) *fraction = v->controls[i].fraction;
  if (value) *value = val_of(&v->controls[i]);
  return true;
}

bool omx_panel_view_target_rect(const omx_panel_view_t *cv, uint32_t i, double rect[4], double *travel_px) {
  omx_panel_view_t *v = (omx_panel_view_t *)cv;
  if (!v || i >= v->ncontrols || !input_of(v) || !v->in->ge) return false;
  if (v->in->dirty) build(v);
  if (!place_targets(v)) return false;
  for (size_t k = 0; k < v->in->nt; k++) {
    const target *t = &v->in->t[k];
    int m = member_of_ctl(t, (int)i);
    if (m < 0) continue;
    memcpy(rect, t->kind == T_BAR ? t->col + 4 * m : t->rect, 4 * sizeof(double));
    if (travel_px) *travel_px = t->kind == T_HANDLE ? 0 : t->kind == T_BAR ? t->col[4 * m + 3] : t->travel_px;
    return true;
  }
  return false;
}

