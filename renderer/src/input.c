/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * input.c — the one gesture vocabulary (one-panel spec 7.8) on the renderer's controls: a pointer, a wheel, an encoder detent or a
 * key becomes `drag`, `fine`, `step`, `second`, `reset`, `more`, `select`, `toggle` or `paint`, and each call answers the control,
 * its value and the gesture's begin and end. It is tools/gestures.mjs carried to C rule for rule (that module is the reference
 * this is held to, renderer/test/input.test.mjs). Every timing, threshold and table cell is read from schema/gestures.json; no
 * number of that kind is typed in this file. Positions are the layout's logical px.
 *
 * A TARGET is what takes a gesture whole: a single control, a bar group (a section's run of bar controls: a drag that leaves the
 * pressed bar's column paints) or a curve handle (a frequency, a gain and a Q the surface bound). A target belongs to the pointer
 * that pressed it, or to the stepper through the claim after a step.
 */
#include <cjson/cJSON.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "omx_panel_render.h"
#include "view.h"

typedef enum { T_SINGLE, T_BAR, T_HANDLE } tkind;
typedef enum { IN_TAP, IN_DOUBLE_TAP, IN_LONG_PRESS, IN_DRAG, IN_DRAG_FINE, IN_WHEEL, IN_WHEEL_COARSE, IN_DETENT, IN_DETENT_COARSE,
               IN_ENCODER3, IN_ARROW, IN_ARROW_COARSE, IN_ARROW_SECOND, IN_BACKSPACE, IN_PINCH, IN_SWEEP, IN_COUNT } input_name;
static const char *const INPUT_NAMES[IN_COUNT] = {"tap", "doubleTap", "longPress", "drag", "dragFine", "wheel", "wheelCoarse", "detent",
                                                  "detentCoarse", "encoder3", "arrow", "arrowCoarse", "arrowSecond", "backspace", "pinch", "sweep"};
static const char *const WORD_NAMES[] = {"", "drag", "fine", "step", "second", "reset", "more", "select", "toggle", "paint"};
#define NWORDS 10
#define NROWS 10
static const char *const ROW_NAMES[NROWS] = {"knob", "fader", "switch", "selector", "meter", "display", "curve", "xy", "bar", "handle"};
enum { ROW_BAR = 8, ROW_HANDLE = 9 };
static const widget ROW_WIDGET[8] = {W_KNOB, W_FADER, W_SWITCH, W_SELECTOR, W_METER, W_DISPLAY, W_CURVE, W_XY};

enum { TM_LONG_PRESS, TM_DOUBLE_TAP, TM_PALM_GUARD, TM_SAFETY_HOLD, TM_CLAIM, TM_COUNT };
static const char *const TIMING_NAMES[TM_COUNT] = {"longPressMs", "doubleTapMs", "palmGuardMs", "safetyHoldMs", "claimMs"};

typedef struct { char *section; int row, input, word; } exception;

typedef struct {
  double ms[TM_COUNT], floor[TM_COUNT];
  double drag_start_px, fine_ratio, step_fraction, coarse_steps, default_travel_px;
  signed char table[NROWS][IN_COUNT]; /* the word of a cell, 0 for none */
  exception *exceptions;
  size_t nexceptions;
} gestures_decl;

typedef struct {
  uint32_t id;
  int word, input, target;
  double begin, end, shown_until;
  int fine, closed;
  unsigned char *chg;
  double *val;
} gesture;

typedef struct {
  tkind kind;
  int row;       /* the table row */
  size_t n;      /* members: a bar's columns, a handle's freq, gain, q; a single's one */
  int *ctl;
  double rect[4];       /* single and handle: the target; a bar: unused (the columns carry it) */
  double *col;          /* a bar: 4 per column (x, y, w, h) */
  double travel_px;
  double plot[2];       /* a handle */
  int host_rect;        /* a handle's rect is the surface's */
  int visible;
  /* the interaction */
  int owner_n, owner_ptr[2], owner_type;
  double owner_t0;
  int pinch;
  double pinch_d0, pinch_q0;
  int pinch_g, pinch_a, pinch_b;
  int claim_on;
  char claim_source[16];
  double claim_until;
  int tap_on, tap_key, tap_type;
  double tap_t;
  int step_g;
  int selected; /* a bar member, -1 for none */
} target;

typedef struct {
  int used, id, target, dragging, fired, painting, second, key, col, type, g;
  double x0, y0, x, y, t0, px, py, in_x, in_y, prev_x, prev_y;
  double *acc;
} pointer;

typedef struct { int control; double fraction, value; } rec;

struct omx_input {
  gestures_decl *decl;
  int table_ok;
  uint32_t width, height;
  double scale;
  int surface;
  int paint_mouse, paint_touch;
  target *t;
  size_t nt;
  int dirty;
  double *handles; /* 3 control indexes + 4 rect + 2 plot, per handle */
  size_t nhandles;
  gesture *g;
  size_t ng, capg;
  uint32_t seq;
  pointer ptr[16];
  /* the call in flight */
  rec *rec;
  size_t nrec, caprec;
  int touched;
  omx_panel_refusal_t refusal;
  int cancelled, selected_ctl;
  double now;
};

/* ------------------------------------------------------------------------------------------------- the declaration */

static int index_of(const char *const *names, size_t n, const char *s) {
  for (size_t i = 0; s && i < n; i++)
    if (!strcmp(names[i], s)) return (int)i;
  return -1;
}

static gestures_decl *decl_read(const char *json) {
  cJSON *root = json ? cJSON_Parse(json) : NULL;
  gestures_decl *d = root ? calloc(1, sizeof *d) : NULL;
  if (!d) goto bad;
  cJSON *tm = cJSON_GetObjectItemCaseSensitive(root, "timings"), *th = cJSON_GetObjectItemCaseSensitive(root, "thresholds");
  cJSON *tab = cJSON_GetObjectItemCaseSensitive(root, "table"), *ex = cJSON_GetObjectItemCaseSensitive(root, "exceptions");
  for (int k = 0; k < TM_COUNT; k++) {
    cJSON *t = cJSON_GetObjectItemCaseSensitive(tm, TIMING_NAMES[k]);
    cJSON *def = cJSON_GetObjectItemCaseSensitive(t, "default"), *fl = cJSON_GetObjectItemCaseSensitive(t, "floor");
    if (!cJSON_IsNumber(def)) goto bad;
    d->ms[k] = def->valuedouble, d->floor[k] = cJSON_IsNumber(fl) ? fl->valuedouble : 0;
  }
  const char *thn[] = {"dragStartPx", "fineRatio", "stepFraction", "coarseSteps", "defaultTravelPx"};
  double *thv[] = {&d->drag_start_px, &d->fine_ratio, &d->step_fraction, &d->coarse_steps, &d->default_travel_px};
  for (int k = 0; k < 5; k++) {
    cJSON *n = cJSON_GetObjectItemCaseSensitive(th, thn[k]);
    if (!cJSON_IsNumber(n)) goto bad;
    *thv[k] = n->valuedouble;
  }
  if (!cJSON_IsObject(tab)) goto bad;
  for (int r = 0; r < NROWS; r++) {
    cJSON *row = cJSON_GetObjectItemCaseSensitive(tab, ROW_NAMES[r]), *c;
    cJSON_ArrayForEach(c, row) {
      int in = index_of(INPUT_NAMES, IN_COUNT, c->string), w = index_of(WORD_NAMES, NWORDS, cJSON_GetStringValue(c));
      if (in >= 0 && w > 0) d->table[r][in] = (signed char)w;
    }
  }
  cJSON *e;
  cJSON_ArrayForEach(e, ex) {
    const char *sec = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(e, "section"));
    int r = index_of(ROW_NAMES, NROWS, cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(e, "widget")));
    int in = index_of(INPUT_NAMES, IN_COUNT, cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(e, "input")));
    int w = index_of(WORD_NAMES, NWORDS, cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(e, "word")));
    if (!sec || r < 0 || in < 0 || w <= 0) goto bad;
    exception *ne = realloc(d->exceptions, (d->nexceptions + 1) * sizeof *ne);
    if (!ne) goto bad;
    d->exceptions = ne;
    ne[d->nexceptions].section = strdup(sec), ne[d->nexceptions].row = r, ne[d->nexceptions].input = in, ne[d->nexceptions].word = w;
    d->nexceptions++;
  }
  cJSON_Delete(root);
  return d;
bad:
  cJSON_Delete(root);
  if (d) {
    for (size_t i = 0; i < d->nexceptions; i++) free(d->exceptions[i].section);
    free(d->exceptions);
  }
  free(d);
  return NULL;
}

void omx_input_free(struct omx_input *in) {
  if (!in) return;
  if (in->decl) {
    for (size_t i = 0; i < in->decl->nexceptions; i++) free(in->decl->exceptions[i].section);
    free(in->decl->exceptions);
    free(in->decl);
  }
  for (size_t i = 0; i < in->nt; i++) free(in->t[i].ctl), free(in->t[i].col);
  free(in->t);
  for (size_t i = 0; i < in->ng; i++) free(in->g[i].chg), free(in->g[i].val);
  free(in->g);
  for (int i = 0; i < 16; i++) free(in->ptr[i].acc);
  free(in->handles);
  free(in->rec);
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
    v->in->decl = decl_read(v->gestures_json);
    v->in->table_ok = v->in->decl != NULL;
    v->in->paint_touch = 1;
    v->in->dirty = 1;
    v->in->selected_ctl = -1;
  }
  return v->in;
}

/* ------------------------------------------------------------------------------------------------- the travel */

typedef struct { double min, max, def, step; int has_def, log, integer; } trv;

static trv travel_of(const control *c) {
  if (c->travel.given) return (trv){c->travel.min, c->travel.max, c->travel.def, c->travel.step, c->travel.has_def, c->travel.log, c->travel.integer};
  /* none given: a selector is its options, anything else 0..1 */
  if (c->w == W_SELECTOR && c->count > 1) return (trv){0, (double)c->count - 1, 0, 0, 0, 0, 1};
  return (trv){0, 1, 0, 0, 0, 0, 0};
}
static double clamp01(double n) { return n < 0 ? 0 : n > 1 ? 1 : n; }
static double norm_of(const trv *m, double v) {
  double a = m->log ? log(m->min) : m->min, b = m->log ? log(m->max) : m->max;
  return clamp01(((m->log ? log(v) : v) - a) / (b - a));
}
static double value_of_norm(const trv *m, double n) {
  double k = clamp01(n);
  double v = m->log ? exp(log(m->min) + k * (log(m->max) - log(m->min))) : m->min + k * (m->max - m->min);
  return m->integer ? round(v) : v;
}
static double step_norm(const gestures_decl *d, const trv *m) {
  if (m->integer) return 1 / (m->max - m->min);
  if (m->step > 0 && !m->log) return m->step / (m->max - m->min);
  return d->step_fraction;
}

static double val_of(const control *c) {
  if (c->gv_ok && c->gv_frac == c->fraction) return c->gv;
  trv m = travel_of(c);
  return value_of_norm(&m, c->fraction);
}

/* ------------------------------------------------------------------------------------------------- targets */

static int shown_control(const omx_panel_view_t *v, size_t i) { return omx_panel_view_visible(v, (uint32_t)i); }

static int row_of_control(const control *c) {
  for (int r = 0; r < 8; r++)
    if (ROW_WIDGET[r] == c->w) return r;
  return 0;
}

static void build(omx_panel_view_t *v) {
  struct omx_input *in = v->in;
  for (size_t i = 0; i < in->nt; i++) free(in->t[i].ctl), free(in->t[i].col);
  free(in->t);
  for (int i = 0; i < 16; i++) free(in->ptr[i].acc), memset(&in->ptr[i], 0, sizeof in->ptr[i]);
  in->t = calloc(v->ncontrols + in->nhandles + 1, sizeof *in->t);
  in->nt = 0;
  unsigned char *taken = calloc(v->ncontrols + 1, 1);
  for (size_t h = 0; h < in->nhandles; h++) {
    const double *p = in->handles + 11 * h;
    target *t = &in->t[in->nt++];
    t->kind = T_HANDLE, t->row = ROW_HANDLE, t->n = 3, t->ctl = malloc(3 * sizeof(int));
    for (int k = 0; k < 3; k++) t->ctl[k] = (int)p[k], taken[(int)p[k]] = 1;
    memcpy(t->rect, p + 3, 4 * sizeof(double)), memcpy(t->plot, p + 7, 2 * sizeof(double));
    t->host_rect = 1, t->selected = -1, t->step_g = -1, t->pinch_g = -1;
    t->visible = 1;
  }
  for (size_t i = 0; i < v->ncontrols; i++) {
    if (taken[i] || !shown_control(v, i)) continue;
    const control *c = &v->controls[i];
    target *t = &in->t[in->nt++];
    t->selected = -1, t->step_g = -1, t->pinch_g = -1, t->visible = 1;
    if (c->bar) {
      size_t j = i;
      while (j < v->ncontrols && v->controls[j].bar && v->controls[j].section == c->section) j++;
      t->kind = T_BAR, t->row = ROW_BAR, t->n = 0, t->ctl = malloc((j - i) * sizeof(int));
      for (size_t k = i; k < j; k++)
        if (!taken[k] && shown_control(v, k)) t->ctl[t->n++] = (int)k, taken[k] = 1;
      t->col = calloc(t->n * 4 + 1, sizeof(double));
    } else {
      t->kind = T_SINGLE, t->row = row_of_control(c), t->n = 1, t->ctl = malloc(sizeof(int));
      t->ctl[0] = (int)i, taken[i] = 1;
    }
  }
  free(taken);
  in->dirty = 0;
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
        t->travel_px = in->decl->default_travel_px;
      }
    }
  }
  free(cells), free(sh);
  return 1;
}

static int inside(const double *r, double x, double y) { return x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]; }
static int column_of(const target *t, double x) {
  for (size_t j = 0; t->kind == T_BAR && j < t->n; j++)
    if (x >= t->col[4 * j] && x < t->col[4 * j] + t->col[4 * j + 2]) return (int)j;
  return -1;
}
static int hit(const target *t, double x, double y) {
  if (t->kind == T_BAR) {
    for (size_t j = 0; j < t->n; j++)
      if (inside(t->col + 4 * j, x, y)) return 1;
    return 0;
  }
  return inside(t->rect, x, y);
}

/* ------------------------------------------------------------------------------------------------- the table */

static int word_of(const omx_panel_view_t *v, const target *t, int input) {
  const gestures_decl *d = v->in->decl;
  const char *sec = NULL;
  if (t->n && t->ctl[0] >= 0) {
    int s = v->controls[t->ctl[0]].section;
    sec = s >= 0 && (size_t)s < v->nsections ? v->section_keys[s] : NULL;
  }
  for (size_t i = 0; sec && i < d->nexceptions; i++)
    if (d->exceptions[i].row == t->row && d->exceptions[i].input == input && !strcmp(d->exceptions[i].section, sec)) return d->exceptions[i].word;
  return d->table[t->row][input];
}

static int read_only(const omx_panel_view_t *v, const target *t) {
  for (size_t j = 0; j < t->n; j++)
    if (v->controls[t->ctl[j]].read_only) return 1;
  for (int in = 0; in < IN_COUNT; in++)
    if (v->in->decl->table[t->row][in]) return 0;
  return 1;
}

/* ------------------------------------------------------------------------------------------------- gestures */

static gesture *gest(struct omx_input *in, int at) { return at >= 0 && (size_t)at < in->ng ? &in->g[at] : NULL; }

static int open_g(struct omx_input *in, int target_at, int word, int input, double begin) {
  if (in->ng == in->capg) {
    size_t cap = in->capg ? in->capg * 2 : 16;
    gesture *ng = realloc(in->g, cap * sizeof *ng);
    if (!ng) return -1;
    in->g = ng, in->capg = cap;
  }
  const target *t = &in->t[target_at];
  gesture *g = &in->g[in->ng];
  memset(g, 0, sizeof *g);
  g->id = ++in->seq, g->word = word, g->input = input, g->target = target_at;
  g->begin = g->end = g->shown_until = begin;
  g->chg = calloc(t->n + 1, 1), g->val = calloc(t->n + 1, sizeof(double));
  in->touched = (int)in->ng;
  return (int)in->ng++;
}

static void close_g(struct omx_input *in, int at, double t, double tail) {
  gesture *g = gest(in, at);
  if (!g) return;
  g->end = t, g->shown_until = t + tail;
  in->touched = at;
}

/* Set member `m` of the gesture's target to `v` (its unit): the control follows, the call records it. */
static void set_member(omx_panel_view_t *view, int at, size_t m, double v) {
  struct omx_input *in = view->in;
  gesture *g = gest(in, at);
  target *t = &in->t[g->target];
  control *c = &view->controls[t->ctl[m]];
  trv tv = travel_of(c);
  double n = norm_of(&tv, v);
  c->gv = v, c->gv_ok = 1, c->fraction = n, c->gv_frac = n;
  if (c->w == W_SELECTOR && c->count > 0) c->at = (uint32_t)fmin(c->count - 1, fmax(0, round(v)));
  g->chg[m] = 1, g->val[m] = v;
  size_t k;
  for (k = 0; k < in->nrec; k++)
    if (in->rec[k].control == t->ctl[m]) break;
  if (k == in->nrec) {
    if (in->nrec == in->caprec) {
      size_t cap = in->caprec ? in->caprec * 2 : 16;
      rec *nr = realloc(in->rec, cap * sizeof *nr);
      if (!nr) return;
      in->rec = nr, in->caprec = cap;
    }
    in->nrec++;
  }
  in->rec[k] = (rec){t->ctl[m], n, v};
}

static double member_val(omx_panel_view_t *view, const target *t, size_t m) { return val_of(&view->controls[t->ctl[m]]); }
static trv member_trv(omx_panel_view_t *view, const target *t, size_t m) { return travel_of(&view->controls[t->ctl[m]]); }
static void refuse(struct omx_input *in, omx_panel_refusal_t r) { in->refusal = r; }

static void reset_member(omx_panel_view_t *view, int at, size_t key) {
  struct omx_input *in = view->in;
  gesture *g = gest(in, at);
  target *t = &in->t[g->target];
  /* a band's reset is its gain: frequency and Q keep */
  size_t m = t->kind == T_HANDLE ? 1 : key;
  trv tv = member_trv(view, t, m);
  if (!tv.has_def) {
    refuse(in, OMX_PANEL_REFUSED_NO_DEFAULT);
    g->closed = 2; /* dead */
    return;
  }
  set_member(view, at, m, tv.def);
}

static void drop_last(struct omx_input *in) {
  if (!in->ng) return;
  free(in->g[in->ng - 1].chg), free(in->g[in->ng - 1].val);
  in->ng--;
  in->seq--;
  in->touched = -1;
}

static int member_of_ctl(const target *t, int ctl) {
  for (size_t j = 0; j < t->n; j++)
    if (t->ctl[j] == ctl) return (int)j;
  return -1;
}

static pointer *ptr_of(struct omx_input *in, int id) {
  for (int i = 0; i < 16; i++)
    if (in->ptr[i].used && in->ptr[i].id == id) return &in->ptr[i];
  return NULL;
}
static pointer *ptr_new(struct omx_input *in, int id) {
  for (int i = 0; i < 16; i++)
    if (!in->ptr[i].used) {
      free(in->ptr[i].acc);
      memset(&in->ptr[i], 0, sizeof in->ptr[i]);
      in->ptr[i].used = 1, in->ptr[i].id = id;
      return &in->ptr[i];
    }
  return NULL;
}
static int owns(const target *t, int id) {
  for (int i = 0; i < t->owner_n; i++)
    if (t->owner_ptr[i] == id) return 1;
  return 0;
}

static void tick_to(omx_panel_view_t *view, double now) {
  struct omx_input *in = view->in;
  const gestures_decl *d = in->decl;
  for (int pi = 0; pi < 16; pi++) {
    pointer *p = &in->ptr[pi];
    if (!p->used) continue;
    target *t = &in->t[p->target];
    if (!owns(t, p->id) || p->dragging || p->fired || t->pinch || view->controls[t->ctl[0]].hold || now - p->t0 < d->ms[TM_LONG_PRESS]) continue;
    p->fired = 1;
    if (word_of(view, t, IN_LONG_PRESS) == OMX_PANEL_WORD_MORE) {
      int g = open_g(in, p->target, OMX_PANEL_WORD_MORE, IN_LONG_PRESS, p->t0 + d->ms[TM_LONG_PRESS]);
      close_g(in, g, p->t0 + d->ms[TM_LONG_PRESS], 0);
    }
  }
}

static double height_at(omx_panel_view_t *view, const target *t, size_t m, double y) {
  const double *r = t->col + 4 * m;
  trv tv = member_trv(view, t, m);
  return value_of_norm(&tv, clamp01((r[1] + r[3] - y) / r[3]));
}

static int paint_with(const struct omx_input *in, int type) { return type == OMX_PANEL_POINTER_MOUSE ? in->paint_mouse : 1; }

static void on_down(omx_panel_view_t *view, const omx_panel_event_t *e) {
  struct omx_input *in = view->in;
  const gestures_decl *d = in->decl;
  int ti = -1;
  for (size_t k = 0; k < in->nt && ti < 0; k++)
    if (hit(&in->t[k], e->x, e->y)) ti = (int)k;
  if (ti < 0) return;
  target *t = &in->t[ti];
  if (read_only(view, t)) return refuse(in, OMX_PANEL_REFUSED_READ_ONLY);
  if (t->claim_on && e->t_ms < t->claim_until) return refuse(in, OMX_PANEL_REFUSED_CONTROL_OWNED);
  if (t->owner_n) {
    pointer *first = ptr_of(in, t->owner_ptr[0]);
    int pinch_ok = t->owner_n == 1 && t->owner_type == (int)e->type && (int)e->pointer != t->owner_ptr[0] && word_of(view, t, IN_PINCH) == OMX_PANEL_WORD_SECOND &&
                   e->t_ms - t->owner_t0 <= d->ms[TM_PALM_GUARD] && first && hit(t, first->x0, first->y0);
    if (!pinch_ok) return refuse(in, OMX_PANEL_REFUSED_CONTROL_OWNED);
    double d0 = hypot(e->x - first->x, e->y - first->y);
    if (d0 == 0) d0 = 1;
    gesture *fg = gest(in, first->g);
    if (fg && !fg->closed) fg->closed = 1, close_g(in, first->g, e->t_ms, 0);
    t->owner_ptr[t->owner_n++] = (int)e->pointer;
    t->pinch = 1, t->pinch_d0 = d0, t->pinch_q0 = member_val(view, t, 2);
    t->pinch_g = open_g(in, ti, OMX_PANEL_WORD_SECOND, IN_PINCH, e->t_ms);
    t->pinch_a = first->id, t->pinch_b = (int)e->pointer;
    pointer *p = ptr_new(in, (int)e->pointer);
    if (p) p->target = ti, p->x0 = p->x = e->x, p->y0 = p->y = e->y, p->t0 = e->t_ms, p->type = (int)e->type, p->dragging = 1, p->g = -1;
    return;
  }
  int col = column_of(t, e->x);
  int key = t->kind == T_BAR ? col : 0;
  t->owner_n = 1, t->owner_ptr[0] = (int)e->pointer, t->owner_type = (int)e->type, t->owner_t0 = e->t_ms, t->pinch = 0;
  pointer *p = ptr_new(in, (int)e->pointer);
  if (!p) return;
  p->target = ti, p->x0 = p->x = e->x, p->y0 = p->y = e->y, p->t0 = e->t_ms, p->type = (int)e->type, p->key = key, p->col = col, p->g = -1;
  p->in_x = e->x, p->in_y = e->y;
  p->second = t->tap_on && t->tap_key == key && t->tap_type == (int)e->type && e->t_ms - t->tap_t <= d->ms[TM_DOUBLE_TAP];
}

static void on_move(omx_panel_view_t *view, const omx_panel_event_t *e) {
  struct omx_input *in = view->in;
  const gestures_decl *d = in->decl;
  pointer *p = ptr_of(in, (int)e->pointer);
  if (!p) return;
  target *t = &in->t[p->target];
  if (!owns(t, p->id)) return;
  p->x = e->x, p->y = e->y;
  if (t->pinch) {
    pointer *a = ptr_of(in, t->pinch_a), *b = ptr_of(in, t->pinch_b);
    if (!a || !b) return;
    trv q = member_trv(view, t, 2);
    double scaled = t->pinch_q0 * (hypot(a->x - b->x, a->y - b->y) / t->pinch_d0);
    scaled = fmin(q.max, fmax(q.min, scaled));
    set_member(view, t->pinch_g, 2, scaled);
    close_g(in, t->pinch_g, e->t_ms, 0);
    return;
  }
  int col = column_of(t, e->x);
  if (t->kind == T_BAR && !p->painting && col == p->col) p->in_x = e->x, p->in_y = e->y;
  if (!p->dragging) {
    if (hypot(e->x - p->x0, e->y - p->y0) <= d->drag_start_px) return;
    p->dragging = 1, p->fired = 1;
    p->acc = calloc(t->n + 1, sizeof(double));
    for (size_t m = 0; m < t->n; m++) {
      trv tv = member_trv(view, t, m);
      p->acc[m] = norm_of(&tv, member_val(view, t, m));
    }
    p->g = open_g(in, p->target, e->fine ? OMX_PANEL_WORD_FINE : OMX_PANEL_WORD_DRAG, e->fine ? IN_DRAG_FINE : IN_DRAG, p->t0);
    p->px = e->x, p->py = e->y;
  }
  gesture *g = gest(in, p->g);
  if (!g) return;
  if (t->kind == T_BAR && !p->painting && col != p->col && paint_with(in, p->type)) {
    p->painting = 1;
    g->word = OMX_PANEL_WORD_PAINT, g->input = IN_SWEEP;
    set_member(view, p->g, (size_t)p->key, height_at(view, t, (size_t)p->key, p->in_y));
    p->prev_x = p->in_x, p->prev_y = p->in_y;
  }
  if (p->painting) {
    int from = column_of(t, p->prev_x);
    if (col >= 0 && from >= 0) {
      int dir = col > from ? 1 : col < from ? -1 : 0;
      int count = dir == 0 ? 1 : abs(col - from);
      for (int k = 0; k < count; k++) {
        int c = dir == 0 ? col : from + dir * (k + 1);
        double cx = t->col[4 * c] + t->col[4 * c + 2] / 2;
        double dx = e->x - p->prev_x;
        double y = c == col ? e->y : p->prev_y + (e->y - p->prev_y) * ((cx - p->prev_x) / (dx == 0 ? 1 : dx));
        set_member(view, p->g, (size_t)c, height_at(view, t, (size_t)c, y));
      }
      p->prev_x = e->x, p->prev_y = e->y;
    }
    close_g(in, p->g, e->t_ms, 0);
    return;
  }
  double ratio = e->fine ? d->fine_ratio : 1;
  if (e->fine) g->fine = 1, g->word = OMX_PANEL_WORD_FINE, g->input = IN_DRAG_FINE;
  double dx = e->x - p->px, dy = e->y - p->py;
  p->px = e->x, p->py = e->y;
  if (t->kind == T_HANDLE) {
    p->acc[0] += (dx / t->plot[0]) * ratio;
    p->acc[1] += (-dy / t->plot[1]) * ratio;
    for (size_t m = 0; m < 2; m++) {
      trv tv = member_trv(view, t, m);
      set_member(view, p->g, m, value_of_norm(&tv, p->acc[m]));
    }
  } else {
    size_t m = t->kind == T_BAR ? (size_t)p->key : 0;
    double travel = t->kind == T_BAR ? t->col[4 * m + 3] : t->travel_px;
    p->acc[m] += (-dy / travel) * ratio;
    trv tv = member_trv(view, t, m);
    set_member(view, p->g, m, value_of_norm(&tv, p->acc[m]));
  }
  close_g(in, p->g, e->t_ms, 0);
}

static void on_up(omx_panel_view_t *view, const omx_panel_event_t *e) {
  struct omx_input *in = view->in;
  const gestures_decl *d = in->decl;
  pointer *p = ptr_of(in, (int)e->pointer);
  if (!p) return;
  int ti = p->target;
  target *t = &in->t[ti];
  if (!owns(t, p->id)) return;
  if (t->pinch) {
    close_g(in, t->pinch_g, e->t_ms, 0);
    if (gest(in, t->pinch_g)) in->g[t->pinch_g].closed = 1;
    int keep = 0;
    for (int i = 0; i < t->owner_n; i++)
      if (t->owner_ptr[i] != p->id) t->owner_ptr[keep++] = t->owner_ptr[i];
    t->owner_n = keep;
    p->used = 0;
    if (!t->owner_n) t->pinch = 0;
    return;
  }
  pointer pp = *p;
  p->acc = NULL;
  p->used = 0;
  t->owner_n = 0;
  if (pp.dragging) {
    close_g(in, pp.g, e->t_ms, 0);
    in->g[pp.g].closed = 1;
    free(pp.acc);
    return;
  }
  free(pp.acc);
  if (pp.fired) return;
  if (!hit(t, e->x, e->y) || (t->kind == T_BAR && column_of(t, e->x) != pp.col)) {
    in->cancelled = 1;
    return;
  }
  if (view->controls[t->ctl[0]].hold && e->t_ms - pp.t0 < d->ms[TM_SAFETY_HOLD]) return refuse(in, OMX_PANEL_REFUSED_HOLD_SHORT);
  if (pp.second && word_of(view, t, IN_DOUBLE_TAP) == OMX_PANEL_WORD_RESET) {
    int g = open_g(in, ti, OMX_PANEL_WORD_RESET, IN_DOUBLE_TAP, pp.t0);
    reset_member(view, g, (size_t)(pp.key < 0 ? 0 : pp.key));
    close_g(in, g, e->t_ms, 0);
    if (in->g[g].closed == 2) drop_last(in);
    t->tap_on = 0;
    return;
  }
  int word = word_of(view, t, IN_TAP);
  if (!word) return refuse(in, OMX_PANEL_REFUSED_NOT_IN_TABLE);
  int g = open_g(in, ti, word, IN_TAP, pp.t0);
  size_t key = (size_t)(pp.key < 0 ? 0 : pp.key);
  if (word == OMX_PANEL_WORD_TOGGLE) {
    trv tv = member_trv(view, t, key);
    set_member(view, g, key, member_val(view, t, key) == tv.max ? tv.min : tv.max);
  } else if (word == OMX_PANEL_WORD_SELECT) {
    /* a tap selects and never changes a value */
    t->selected = t->kind == T_BAR ? (int)key : -1;
    in->selected_ctl = t->kind == T_BAR ? t->ctl[key] : t->ctl[0];
  }
  close_g(in, g, e->t_ms, 0);
  t->tap_on = 1, t->tap_key = (int)key, t->tap_type = pp.type, t->tap_t = e->t_ms;
}

static void on_input(omx_panel_view_t *view, const omx_panel_event_t *e) {
  struct omx_input *in = view->in;
  const gestures_decl *d = in->decl;
  int ti = -1, member = -1;
  if (e->control >= 0) {
    for (size_t k = 0; k < in->nt && ti < 0; k++)
      if ((member = member_of_ctl(&in->t[k], e->control)) >= 0) ti = (int)k;
  } else if (e->kind == OMX_PANEL_EVENT_WHEEL) {
    for (size_t k = 0; k < in->nt && ti < 0; k++)
      if (hit(&in->t[k], e->x, e->y)) ti = (int)k, member = in->t[k].kind == T_BAR ? column_of(&in->t[k], e->x) : 0;
  } else {
    /* a key or a detent with no control named: the bar a tap last selected, else the only handle */
    for (size_t k = 0; k < in->nt && ti < 0; k++)
      if (in->t[k].selected >= 0 || in->t[k].kind == T_HANDLE) ti = (int)k;
  }
  if (ti < 0) return refuse(in, OMX_PANEL_REFUSED_NO_TARGET);
  target *t = &in->t[ti];
  int input;
  if (e->kind == OMX_PANEL_EVENT_WHEEL) input = e->coarse ? IN_WHEEL_COARSE : IN_WHEEL;
  else if (e->kind == OMX_PANEL_EVENT_DETENT) input = e->encoder == 3 ? IN_ENCODER3 : e->coarse ? IN_DETENT_COARSE : IN_DETENT;
  else if (e->key == OMX_PANEL_KEY_BACKSPACE) input = IN_BACKSPACE;
  else input = e->shift ? (t->kind == T_HANDLE ? IN_ARROW_SECOND : IN_ARROW_COARSE) : IN_ARROW;
  if (read_only(view, t)) return refuse(in, OMX_PANEL_REFUSED_READ_ONLY);
  char source[16];
  snprintf(source, sizeof source, "%d.%d", (int)e->kind, e->kind == OMX_PANEL_EVENT_DETENT ? e->encoder : 0);
  if (t->owner_n || (t->claim_on && e->t_ms < t->claim_until && strcmp(t->claim_source, source))) return refuse(in, OMX_PANEL_REFUSED_CONTROL_OWNED);
  int word = word_of(view, t, input);
  if (!word) return refuse(in, OMX_PANEL_REFUSED_NOT_IN_TABLE);
  int arrow_member = -1, arrow_dir = 0;
  if (e->kind == OMX_PANEL_EVENT_KEY) {
    switch (e->key) {
    case OMX_PANEL_KEY_UP: arrow_member = 1, arrow_dir = 1; break;
    case OMX_PANEL_KEY_DOWN: arrow_member = 1, arrow_dir = -1; break;
    case OMX_PANEL_KEY_RIGHT: arrow_member = 0, arrow_dir = 1; break;
    case OMX_PANEL_KEY_LEFT: arrow_member = 0, arrow_dir = -1; break;
    default: break;
    }
  }
  int dir = e->kind == OMX_PANEL_EVENT_KEY ? arrow_dir : (e->n > 0) - (e->n < 0);
  double count = (e->kind == OMX_PANEL_EVENT_KEY ? 1 : fabs((double)e->n)) *
                 (input == IN_WHEEL_COARSE || input == IN_DETENT_COARSE || input == IN_ARROW_COARSE ? d->coarse_steps : 1);
  int key;
  if (word == OMX_PANEL_WORD_SECOND) key = 2;
  else if (t->kind == T_HANDLE) key = arrow_member;
  else if (t->kind == T_BAR) key = member >= 0 ? member : t->selected;
  else key = 0;
  if (word == OMX_PANEL_WORD_RESET) {
    /* a bar with none selected has no default to reset */
    if (t->kind == T_BAR && key < 0) return refuse(in, OMX_PANEL_REFUSED_NO_DEFAULT);
    int g = open_g(in, ti, OMX_PANEL_WORD_RESET, input, e->t_ms);
    reset_member(view, g, (size_t)(t->kind == T_BAR ? key : 0));
    close_g(in, g, e->t_ms, 0);
    if (in->g[g].closed == 2) drop_last(in);
    return;
  }
  if (key < 0 || (size_t)key >= t->n) return refuse(in, OMX_PANEL_REFUSED_NO_TARGET);
  /* steps of one source within the claim are one gesture, one undo entry */
  gesture *sg = gest(in, t->step_g);
  if (!(sg && t->claim_on && !strcmp(t->claim_source, source) && e->t_ms < t->claim_until && sg->word == word)) t->step_g = open_g(in, ti, word, input, e->t_ms);
  trv tv = member_trv(view, t, (size_t)key);
  set_member(view, t->step_g, (size_t)key, value_of_norm(&tv, norm_of(&tv, member_val(view, t, (size_t)key)) + dir * count * step_norm(d, &tv)));
  t->claim_on = 1, t->claim_until = e->t_ms + d->ms[TM_CLAIM];
  snprintf(t->claim_source, sizeof t->claim_source, "%s", source);
  close_g(in, t->step_g, e->t_ms, d->ms[TM_CLAIM]);
}

/* ------------------------------------------------------------------------------------------------- the front door */

static int ready(omx_panel_view_t *v, omx_panel_answer_t *a) {
  if (a) memset(a, 0, sizeof *a), a->selected = -1;
  struct omx_input *in = input_of(v);
  if (!in) return 0;
  if (!in->table_ok) {
    if (a) a->refusal = OMX_PANEL_REFUSED_NO_TABLE;
    return 0;
  }
  if (in->dirty) build(v);
  if (!place_targets(v)) return 0;
  in->nrec = 0, in->touched = -1, in->refusal = OMX_PANEL_REFUSED_NONE, in->cancelled = 0;
  return 1;
}

static size_t finish(omx_panel_view_t *v, omx_panel_change_t *out, size_t cap, omx_panel_answer_t *a) {
  struct omx_input *in = v->in;
  for (size_t k = 0; out && k < in->nrec && k < cap; k++) out[k] = (omx_panel_change_t){(uint32_t)in->rec[k].control, in->rec[k].fraction, in->rec[k].value};
  if (a) {
    a->refusal = in->refusal, a->cancelled = in->cancelled != 0;
    gesture *g = gest(in, in->touched);
    if (g) {
      a->word = (omx_panel_word_t)g->word, a->gesture = g->id, a->begin_ms = g->begin, a->end_ms = g->end, a->shown_until_ms = g->shown_until;
      a->ended = g->closed == 1 || (g->word != OMX_PANEL_WORD_DRAG && g->word != OMX_PANEL_WORD_FINE && g->word != OMX_PANEL_WORD_PAINT && g->word != OMX_PANEL_WORD_SECOND);
      for (size_t m = 0; m <= in->t[g->target].n; m++)
        if (g->chg[m]) a->undo = true;
    }
    a->selected = in->selected_ctl;
  }
  size_t n = in->nrec;
  return n;
}

size_t omx_panel_view_input(omx_panel_view_t *v, const omx_panel_event_t *e, omx_panel_change_t *out, size_t cap, omx_panel_answer_t *a) {
  if (!e || !ready(v, a)) return 0;
  struct omx_input *in = v->in;
  in->selected_ctl = -1;
  tick_to(v, e->t_ms);
  switch (e->kind) {
  case OMX_PANEL_EVENT_DOWN: on_down(v, e); break;
  case OMX_PANEL_EVENT_MOVE: on_move(v, e); break;
  case OMX_PANEL_EVENT_UP: on_up(v, e); break;
  default: on_input(v, e); break;
  }
  return finish(v, out, cap, a);
}

size_t omx_panel_view_tick(omx_panel_view_t *v, double t_ms, omx_panel_change_t *out, size_t cap, omx_panel_answer_t *a) {
  if (!ready(v, a)) return 0;
  v->in->selected_ctl = -1;
  tick_to(v, t_ms);
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
  if (!in || !in->table_ok) return OMX_PANEL_REFUSED_NO_TABLE;
  int k = index_of(TIMING_NAMES, TM_COUNT, name);
  if (k < 0 || !(ms > 0)) return OMX_PANEL_REFUSED_BAD_SETTING;
  if (ms < in->decl->floor[k]) return OMX_PANEL_REFUSED_HOLD_BELOW_FLOOR;
  in->decl->ms[k] = ms;
  return OMX_PANEL_REFUSED_NONE;
}

omx_panel_refusal_t omx_panel_view_set_paint(omx_panel_view_t *v, bool touch, bool mouse) {
  struct omx_input *in = input_of(v);
  if (!in) return OMX_PANEL_REFUSED_NO_TABLE;
  if (!touch) return OMX_PANEL_REFUSED_PAINT_REQUIRED;
  in->paint_touch = 1, in->paint_mouse = mouse;
  return OMX_PANEL_REFUSED_NONE;
}

uint32_t omx_panel_view_gesture_count(const omx_panel_view_t *v) { return v && v->in ? (uint32_t)v->in->ng : 0; }

bool omx_panel_view_gesture(const omx_panel_view_t *v, uint32_t at, omx_panel_gesture_t *out, omx_panel_change_t *changes, size_t cap, size_t *nchanges) {
  if (!v || !v->in || at >= v->in->ng || !out) return false;
  const gesture *g = &v->in->g[at];
  const target *t = &v->in->t[g->target];
  *out = (omx_panel_gesture_t){g->id, (omx_panel_word_t)g->word, g->begin, g->end, g->shown_until, g->fine != 0};
  size_t n = 0;
  for (size_t m = 0; m < t->n; m++) {
    if (!g->chg[m]) continue;
    const control *c = &v->controls[t->ctl[m]];
    trv tv = travel_of(c);
    if (changes && n < cap) changes[n] = (omx_panel_change_t){(uint32_t)t->ctl[m], norm_of(&tv, g->val[m]), g->val[m]};
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
  if (!v || i >= v->ncontrols || !input_of(v) || !v->in->table_ok) return false;
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
