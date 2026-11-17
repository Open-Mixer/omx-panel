/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * gesture.c — the one implementation of the gesture vocabulary (docs/panel-gestures.md, schema/gestures.json): drag past 10 px,
 * fine at 0.3, step (the declared step, else 1% of the travel; coarse is 5), second (a handle's Q: pinch, encoder 3, wheel,
 * Shift+arrows), reset to the declared default, more and select (never a value), toggle on release inside, painting across a bar
 * group with interpolated columns and one gesture id per sweep, ownership and the claim, the safety hold. Each value is in the
 * control's own unit. Every timing, threshold and table cell is read from the declaration; no number of that kind is typed here.
 *
 * Two doors lead in. The engine (gesture.h) is stateful and incremental: input.c holds one over a view's controls. The JSON door
 * (omx_panel_gesture.h: omx_gesture_open, omx_gesture_run, omx_gesture_close) takes one control and a whole script and answers
 * as JSON, the answer tools/gestures.mjs's runGesture gives, by replaying the script through a fresh engine.
 */
#include <cjson/cJSON.h>
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "gesture.h"
#include "gesture_words.h"
#include "omx_panel_gesture.h"

/* ------------------------------------------------------------------------------------------------- the vocabulary */

typedef enum { IN_TAP, IN_DOUBLE_TAP, IN_LONG_PRESS, IN_DRAG, IN_DRAG_FINE, IN_WHEEL, IN_WHEEL_COARSE, IN_DETENT, IN_DETENT_COARSE,
               IN_ENCODER3, IN_ARROW, IN_ARROW_COARSE, IN_ARROW_SECOND, IN_BACKSPACE, IN_PINCH, IN_SWEEP, IN_COUNT } input_name;
const char *const GE_INPUT_NAMES[IN_COUNT + 1] = {"tap", "doubleTap", "longPress", "drag", "dragFine", "wheel", "wheelCoarse", "detent",
                                                  "detentCoarse", "encoder3", "arrow", "arrowCoarse", "arrowSecond", "backspace", "pinch", "sweep", NULL};
static const char *const WORD_NAMES[] = {OMX_PANEL_WORD_NAMES};
#define NWORDS (OMX_PANEL_WORD_LAST + 1)
static const char *const ROW_NAMES[GE_ROWS] = {"knob", "fader", "switch", "selector", "meter", "display", "curve", "xy", "bar", "handle"};

enum { TM_LONG_PRESS, TM_DOUBLE_TAP, TM_PALM_GUARD, TM_SAFETY_HOLD, TM_CLAIM, TM_COUNT };
static const char *const TIMING_NAMES[TM_COUNT] = {"longPressMs", "doubleTapMs", "palmGuardMs", "safetyHoldMs", "claimMs"};

typedef struct { char *section; int row, input, word; } exception;

typedef struct {
  double ms[TM_COUNT], floor[TM_COUNT];
  double drag_start_px, fine_ratio, step_fraction, coarse_steps, default_travel_px;
  signed char table[GE_ROWS][IN_COUNT]; /* the word of a cell, 0 for none */
  exception *exceptions;
  size_t nexceptions;
} decl;

typedef struct {
  uint32_t id;
  int word, input, target;
  double begin, end, shown_until;
  int fine, closed, pointer;
  size_t n;
  int *tag;
  unsigned char *chg;
  double *val;
} gest;

typedef struct {
  ge_kind_t kind;
  int row;
  char *widget, *section;
  size_t n;
  ge_member_t *m;
  int *tag;
  char **name;
  double rect[4];
  double *col; /* a bar: 4 per column */
  double travel_px, plot[2];
  int horizontal, read_only, hold;
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
  int selected; /* a bar's member, -1 for none */
} tgt;

typedef struct {
  int used, target, dragging, fired, painting, second, key, col, type, g;
  uint32_t id;
  double x0, y0, x, y, t0, px, py, in_x, in_y, prev_x, prev_y;
  double *acc;
} pointer;

struct ge_engine {
  decl *d;
  int paint_mouse;
  tgt *t;
  size_t nt;
  gest *g;
  size_t ng, capg;
  uint32_t seq;
  pointer ptr[16];
  /* the call in flight */
  ge_change_t *chg;
  size_t nchg, capchg;
  int touched;
  omx_panel_refusal_t refusal;
  int cancelled, sel_target, sel_member;
  /* the log of every call */
  int keep;
  ge_refusal_t *rlog;
  size_t nrlog;
  double *clog;
  size_t nclog;
  const char *(*namer)(void *, uint32_t);
  void *namer_ctx;
  ge_gesture_t view; /* what ge_touched and ge_gesture_at hand out */
};

/* ------------------------------------------------------------------------------------------------- the declaration */

static int index_of(const char *const *names, size_t n, const char *s) {
  for (size_t i = 0; s && i < n; i++)
    if (!strcmp(names[i], s)) return (int)i;
  return -1;
}

int ge_row_of(const char *widget) { return index_of(ROW_NAMES, GE_ROWS, widget); }

static void decl_free(decl *d) {
  if (!d) return;
  for (size_t i = 0; i < d->nexceptions; i++) free(d->exceptions[i].section);
  free(d->exceptions);
  free(d);
}

static decl *decl_read(const char *json) {
  cJSON *root = json ? cJSON_Parse(json) : NULL;
  decl *d = root ? calloc(1, sizeof *d) : NULL;
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
  for (int r = 0; r < GE_ROWS; r++) {
    cJSON *row = cJSON_GetObjectItemCaseSensitive(tab, ROW_NAMES[r]), *c;
    cJSON_ArrayForEach(c, row) {
      int in = index_of(GE_INPUT_NAMES, IN_COUNT, c->string), w = index_of(WORD_NAMES, NWORDS, cJSON_GetStringValue(c));
      if (in >= 0 && w > 0) d->table[r][in] = (signed char)w;
    }
  }
  cJSON *e;
  cJSON_ArrayForEach(e, ex) {
    const char *sec = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(e, "section"));
    int r = index_of(ROW_NAMES, GE_ROWS, cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(e, "widget")));
    int in = index_of(GE_INPUT_NAMES, IN_COUNT, cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(e, "input")));
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
  decl_free(d);
  return NULL;
}

/* A number as the reference prints it in a refusal's words: the shortest plain decimal that reads back as the same double. */
static const char *num(char buf[32], double v) {
  for (int p = 0; p <= 20; p++) {
    snprintf(buf, 32, "%.*f", p, v);
    if (strtod(buf, NULL) == v) break;
  }
  return buf;
}

static void say(char *out, size_t cap, const char *fmt, ...) {
  if (!out || !cap) return;
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(out, cap, fmt, ap);
  va_end(ap);
}

ge_engine *ge_open(const char *gestures_json) {
  ge_engine *e = calloc(1, sizeof *e);
  if (!e) return NULL;
  e->d = decl_read(gestures_json);
  if (!e->d) {
    free(e);
    return NULL;
  }
  e->touched = -1, e->sel_target = e->sel_member = -1;
  return e;
}

static void tgt_free(tgt *t) {
  free(t->widget), free(t->section), free(t->m), free(t->tag), free(t->col);
  for (size_t j = 0; t->name && j < t->n; j++) free(t->name[j]);
  free(t->name);
}

static void gest_free(gest *g) { free(g->tag), free(g->chg), free(g->val); }

void ge_close(ge_engine *e) {
  if (!e) return;
  decl_free(e->d);
  for (size_t i = 0; i < e->nt; i++) tgt_free(&e->t[i]);
  free(e->t);
  for (size_t i = 0; i < e->ng; i++) gest_free(&e->g[i]);
  free(e->g);
  for (int i = 0; i < 16; i++) free(e->ptr[i].acc);
  free(e->chg), free(e->rlog), free(e->clog);
  free(e);
}

omx_panel_refusal_t ge_set_timing(ge_engine *e, const char *name, double ms, char *why, size_t cap) {
  char a[32], b[32], list[160] = "";
  int k = index_of(TIMING_NAMES, TM_COUNT, name);
  if (k < 0) {
    for (int i = 0; i < TM_COUNT; i++) snprintf(list + strlen(list), sizeof list - strlen(list), "%s%s", i ? ", " : "", TIMING_NAMES[i]);
    say(why, cap, "'%s' is no timing; the timings are %s", name ? name : "", list);
    return OMX_PANEL_REFUSED_BAD_SETTING;
  }
  if (!(ms > 0)) {
    say(why, cap, "%s is %s: a time in ms above zero", name, num(a, ms));
    return OMX_PANEL_REFUSED_BAD_SETTING;
  }
  if (ms < e->d->floor[k]) {
    say(why, cap, "%s %s ms is below the declared floor %s ms", name, num(a, ms), num(b, e->d->floor[k]));
    return OMX_PANEL_REFUSED_HOLD_BELOW_FLOOR;
  }
  e->d->ms[k] = ms;
  return OMX_PANEL_REFUSED_NONE;
}

omx_panel_refusal_t ge_set_paint(ge_engine *e, int touch, int mouse) {
  if (!touch) return OMX_PANEL_REFUSED_PAINT_REQUIRED;
  e->paint_mouse = mouse;
  return OMX_PANEL_REFUSED_NONE;
}

double ge_default_travel_px(const ge_engine *e) { return e->d->default_travel_px; }

void ge_set_id_namer(ge_engine *e, const char *(*namer)(void *, uint32_t), void *ctx) { e->namer = namer, e->namer_ctx = ctx; }

void ge_keep_log(ge_engine *e, int on) { e->keep = on; }

const char *ge_refusal_code(omx_panel_refusal_t r) {
  switch (r) {
  case OMX_PANEL_REFUSED_READ_ONLY: return "GESTURE_READ_ONLY";
  case OMX_PANEL_REFUSED_CONTROL_OWNED: return "GESTURE_CONTROL_OWNED";
  case OMX_PANEL_REFUSED_NO_DEFAULT: return "GESTURE_NO_DEFAULT";
  case OMX_PANEL_REFUSED_NOT_IN_TABLE: return "GESTURE_NOT_IN_TABLE";
  case OMX_PANEL_REFUSED_HOLD_SHORT: return "GESTURE_HOLD_SHORT";
  case OMX_PANEL_REFUSED_NO_TARGET: return "GESTURE_NO_TARGET";
  case OMX_PANEL_REFUSED_HOLD_BELOW_FLOOR: return "GESTURE_HOLD_BELOW_FLOOR";
  case OMX_PANEL_REFUSED_PAINT_REQUIRED: return "GESTURE_PAINT_REQUIRED_ON_TOUCH";
  case OMX_PANEL_REFUSED_BAD_SETTING: return "GESTURE_BAD_SETTING";
  default: return NULL;
  }
}

/* ------------------------------------------------------------------------------------------------- the travel */

static double clamp01(double n) { return n < 0 ? 0 : n > 1 ? 1 : n; }
/* A value's place on its travel, 0..1 (a log travel is linear in its logarithm). */
double ge_norm_of(const ge_member_t *m, double v) {
  double a = m->log ? log(m->min) : m->min, b = m->log ? log(m->max) : m->max;
  return clamp01(((m->log ? log(v) : v) - a) / (b - a));
}
/* JavaScript's Math.round: halves go up, and a negative that rounds to zero is -0. */
static double round_half_up(double v) {
  double r = floor(v + 0.5);
  return r == 0 && signbit(v) ? -0.0 : r;
}
/* The value at a place on the travel, in the control's unit; an integer travel lands on an integer. */
double ge_value_of_norm(const ge_member_t *m, double n) {
  double k = clamp01(n);
  double v = m->log ? exp(log(m->min) + k * (log(m->max) - log(m->min))) : m->min + k * (m->max - m->min);
  return m->integer ? round_half_up(v) : v;
}
/* One step on the 0..1 travel: an integer travel's one, the declared step (linear travels), else the declared fraction. */
static double step_norm(const decl *d, const ge_member_t *m) {
  if (m->integer) return 1 / (m->max - m->min);
  if (m->step > 0 && !m->log) return m->step / (m->max - m->min);
  return d->step_fraction;
}

/* ------------------------------------------------------------------------------------------------- targets */

static char *dup_or_null(const char *s) { return s ? strdup(s) : NULL; }

static int tgt_fill(tgt *t, const ge_target_t *s, int fresh) {
  if (fresh) {
    t->kind = s->kind, t->row = s->row, t->n = s->n;
    t->widget = strdup(s->widget ? s->widget : s->row >= 0 ? ROW_NAMES[s->row] : s->kind == GE_BAR ? "bar" : s->kind == GE_HANDLE ? "handle" : "");
    t->tag = malloc((s->n + 1) * sizeof(int)), t->m = malloc((s->n + 1) * sizeof(ge_member_t));
    t->col = s->kind == GE_BAR ? calloc(s->n * 4 + 1, sizeof(double)) : NULL;
    t->name = calloc(s->n + 1, sizeof(char *));
    if (!t->widget || !t->tag || !t->m || !t->name || (s->kind == GE_BAR && !t->col)) return 0;
    t->step_g = t->pinch_g = -1, t->selected = -1;
    for (size_t j = 0; j < s->n; j++) {
      static const char *const handle_names[3] = {"freq", "gain", "q"};
      const char *nm = s->name && s->name[j] ? s->name[j] : s->kind == GE_HANDLE && j < 3 ? handle_names[j] : "value";
      t->name[j] = strdup(nm);
      if (!t->name[j]) return 0;
    }
  }
  free(t->section);
  t->section = dup_or_null(s->section);
  memcpy(t->m, s->member, s->n * sizeof(ge_member_t));
  for (size_t j = 0; j < s->n; j++) t->tag[j] = s->tag ? s->tag[j] : (int)j;
  memcpy(t->rect, s->rect, sizeof t->rect), memcpy(t->plot, s->plot, sizeof t->plot);
  if (t->col) memcpy(t->col, s->col, s->n * 4 * sizeof(double));
  t->travel_px = s->travel_px > 0 ? s->travel_px : 0;
  t->horizontal = s->horizontal, t->read_only = s->read_only, t->hold = s->hold;
  return 1;
}

void ge_clear(ge_engine *e) {
  for (size_t i = 0; i < e->nt; i++) tgt_free(&e->t[i]);
  free(e->t);
  e->t = NULL, e->nt = 0;
  for (int i = 0; i < 16; i++) free(e->ptr[i].acc), memset(&e->ptr[i], 0, sizeof e->ptr[i]);
}

int ge_add(ge_engine *e, const ge_target_t *s) {
  if (!s || !s->member || (s->kind == GE_HANDLE && s->n != 3) || (s->kind == GE_SINGLE && s->n != 1) || (s->kind == GE_BAR && (!s->col || !s->n))) return -1;
  tgt *nt = realloc(e->t, (e->nt + 1) * sizeof *nt);
  if (!nt) return -1;
  e->t = nt;
  tgt *t = &e->t[e->nt];
  memset(t, 0, sizeof *t);
  if (!tgt_fill(t, s, 1)) {
    tgt_free(t);
    return -1;
  }
  return (int)e->nt++;
}

int ge_update(ge_engine *e, int at, const ge_target_t *s) {
  if (at < 0 || (size_t)at >= e->nt || !s || s->n != e->t[at].n) return 0;
  return tgt_fill(&e->t[at], s, 0);
}

void ge_select(ge_engine *e, int at, int member) {
  if (at >= 0 && (size_t)at < e->nt && member >= 0 && (size_t)member < e->t[at].n) e->t[at].selected = member;
}

static int inside(const double *r, double x, double y) { return x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]; }
static int column_of(const tgt *t, double x) {
  for (size_t j = 0; t->kind == GE_BAR && j < t->n; j++)
    if (x >= t->col[4 * j] && x < t->col[4 * j] + t->col[4 * j + 2]) return (int)j;
  return -1;
}
static int hit(const tgt *t, double x, double y) {
  if (t->kind == GE_BAR) {
    for (size_t j = 0; j < t->n; j++)
      if (inside(t->col + 4 * j, x, y)) return 1;
    return 0;
  }
  return inside(t->rect, x, y);
}

/* ------------------------------------------------------------------------------------------------- the table */

static int word_of(const ge_engine *e, const tgt *t, int input) {
  const decl *d = e->d;
  for (size_t i = 0; t->section && i < d->nexceptions; i++)
    if (d->exceptions[i].row == t->row && d->exceptions[i].input == input && !strcmp(d->exceptions[i].section, t->section)) return d->exceptions[i].word;
  return t->row < 0 ? 0 : d->table[t->row][input];
}

/* A widget that has no gesture in the table (a meter, a display, a curve, or one the table does not know) takes none. */
static int read_only(const ge_engine *e, const tgt *t) {
  if (t->read_only || t->row < 0) return 1;
  for (int in = 0; in < IN_COUNT; in++)
    if (e->d->table[t->row][in]) return 0;
  return 1;
}

/* ------------------------------------------------------------------------------------------------- the call's record */

static void refuse(ge_engine *e, omx_panel_refusal_t r, double t, const char *fmt, ...) {
  e->refusal = r;
  if (!e->keep) return;
  ge_refusal_t *nr = realloc(e->rlog, (e->nrlog + 1) * sizeof *nr);
  if (!nr) return;
  e->rlog = nr;
  ge_refusal_t *x = &nr[e->nrlog++];
  x->code = r, x->t = t;
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(x->why, sizeof x->why, fmt, ap);
  va_end(ap);
}

static const char *id_name(const ge_engine *e, uint32_t id, char buf[16]) {
  if (e->namer) return e->namer(e->namer_ctx, id);
  snprintf(buf, 16, "%u", id);
  return buf;
}

static gest *gest_at(ge_engine *e, int at) { return at >= 0 && (size_t)at < e->ng ? &e->g[at] : NULL; }

static int open_g(ge_engine *e, int target_at, int word, int input, double begin, int pointer) {
  if (e->ng == e->capg) {
    size_t cap = e->capg ? e->capg * 2 : 16;
    gest *ng = realloc(e->g, cap * sizeof *ng);
    if (!ng) return -1;
    e->g = ng, e->capg = cap;
  }
  const tgt *t = &e->t[target_at];
  gest *g = &e->g[e->ng];
  memset(g, 0, sizeof *g);
  g->id = ++e->seq, g->word = word, g->input = input, g->target = target_at, g->pointer = pointer, g->n = t->n;
  g->begin = g->end = g->shown_until = begin;
  g->tag = malloc((t->n + 1) * sizeof(int)), g->chg = calloc(t->n + 1, 1), g->val = calloc(t->n + 1, sizeof(double));
  if (!g->tag || !g->chg || !g->val) {
    gest_free(g);
    return -1;
  }
  memcpy(g->tag, t->tag, t->n * sizeof(int));
  e->touched = (int)e->ng;
  return (int)e->ng++;
}

static void close_g(ge_engine *e, int at, double t, double tail) {
  gest *g = gest_at(e, at);
  if (!g) return;
  g->end = t, g->shown_until = t + tail;
  e->touched = at;
}

/* Set member `m` of the gesture's target to `v` in its own unit: the call records it, latest value kept. */
static void set_member(ge_engine *e, int at, size_t m, double v) {
  gest *g = gest_at(e, at);
  if (!g) return;
  tgt *t = &e->t[g->target];
  t->m[m].value = v;
  g->chg[m] = 1, g->val[m] = v;
  size_t k;
  for (k = 0; k < e->nchg; k++)
    if (e->chg[k].target == g->target && e->chg[k].member == (int)m) break;
  if (k == e->nchg) {
    if (e->nchg == e->capchg) {
      size_t cap = e->capchg ? e->capchg * 2 : 16;
      ge_change_t *nc = realloc(e->chg, cap * sizeof *nc);
      if (!nc) return;
      e->chg = nc, e->capchg = cap;
    }
    e->nchg++;
  }
  e->chg[k] = (ge_change_t){g->target, (int)m, t->tag[m], v};
}

/* A dead gesture (a reset with nothing to reset to) is dropped from the list; its id is not reused. */
static void drop_last(ge_engine *e) {
  if (!e->ng) return;
  gest_free(&e->g[e->ng - 1]);
  e->ng--;
  e->touched = -1;
}

static void reset_member(ge_engine *e, int at, size_t key, double now) {
  gest *g = gest_at(e, at);
  tgt *t = &e->t[g->target];
  /* a band's reset is its gain: frequency and Q keep */
  size_t m = t->kind == GE_HANDLE ? 1 : key;
  if (!t->m[m].has_def) {
    refuse(e, OMX_PANEL_REFUSED_NO_DEFAULT, now, "%s declares no default", t->name[m]);
    g->closed = 2; /* dead */
    return;
  }
  set_member(e, at, m, t->m[m].def);
}

static pointer *ptr_of(ge_engine *e, uint32_t id) {
  for (int i = 0; i < 16; i++)
    if (e->ptr[i].used && e->ptr[i].id == id) return &e->ptr[i];
  return NULL;
}
static pointer *ptr_new(ge_engine *e, uint32_t id) {
  for (int i = 0; i < 16; i++)
    if (!e->ptr[i].used) {
      free(e->ptr[i].acc);
      memset(&e->ptr[i], 0, sizeof e->ptr[i]);
      e->ptr[i].used = 1, e->ptr[i].id = id;
      return &e->ptr[i];
    }
  return NULL;
}
static int owns(const tgt *t, uint32_t id) {
  for (int i = 0; i < t->owner_n; i++)
    if ((uint32_t)t->owner_ptr[i] == id) return 1;
  return 0;
}

/* ------------------------------------------------------------------------------------------------- the clock */

static void tick_to(ge_engine *e, double now) {
  const decl *d = e->d;
  for (int pi = 0; pi < 16; pi++) {
    pointer *p = &e->ptr[pi];
    if (!p->used) continue;
    tgt *t = &e->t[p->target];
    if (!owns(t, p->id) || p->dragging || p->fired || t->pinch || t->hold || now - p->t0 < d->ms[TM_LONG_PRESS]) continue;
    p->fired = 1;
    if (word_of(e, t, IN_LONG_PRESS) == OMX_PANEL_WORD_MORE) {
      int g = open_g(e, p->target, OMX_PANEL_WORD_MORE, IN_LONG_PRESS, p->t0 + d->ms[TM_LONG_PRESS], 1);
      close_g(e, g, p->t0 + d->ms[TM_LONG_PRESS], 0);
    }
  }
}

/* ------------------------------------------------------------------------------------------------- pointers */

static double height_at(const tgt *t, size_t m, double y) {
  const double *r = t->col + 4 * m;
  return ge_value_of_norm(&t->m[m], clamp01((r[1] + r[3] - y) / r[3]));
}

static int paint_with(const ge_engine *e, int type) { return type == OMX_PANEL_POINTER_MOUSE ? e->paint_mouse : 1; }

static void on_down(ge_engine *e, const omx_panel_event_t *ev, int target) {
  const decl *d = e->d;
  int ti = -1;
  if (target >= 0 && (size_t)target < e->nt) ti = hit(&e->t[target], ev->x, ev->y) ? target : -1;
  else
    for (size_t k = 0; k < e->nt && ti < 0; k++)
      if (hit(&e->t[k], ev->x, ev->y)) ti = (int)k;
  if (ti < 0) return;
  tgt *t = &e->t[ti];
  if (read_only(e, t)) return refuse(e, OMX_PANEL_REFUSED_READ_ONLY, ev->t_ms, "a %s that is read-only takes no gesture", t->widget);
  if (t->claim_on && ev->t_ms < t->claim_until)
    return refuse(e, OMX_PANEL_REFUSED_CONTROL_OWNED, ev->t_ms, "the control is the %s's through the claim", t->claim_source);
  if (t->owner_n) {
    pointer *first = ptr_of(e, (uint32_t)t->owner_ptr[0]);
    int pinch_ok = t->owner_n == 1 && t->owner_type == (int)ev->type && ev->pointer != (uint32_t)t->owner_ptr[0] && word_of(e, t, IN_PINCH) == OMX_PANEL_WORD_SECOND &&
                   ev->t_ms - t->owner_t0 <= d->ms[TM_PALM_GUARD] && first && hit(t, first->x0, first->y0);
    if (!pinch_ok) {
      char a[16], b[16];
      return refuse(e, OMX_PANEL_REFUSED_CONTROL_OWNED, ev->t_ms, "the control belongs to %s%s%s; a later press is refused", id_name(e, (uint32_t)t->owner_ptr[0], a),
                    t->owner_n > 1 ? ", " : "", t->owner_n > 1 ? id_name(e, (uint32_t)t->owner_ptr[1], b) : "");
    }
    double d0 = hypot(ev->x - first->x, ev->y - first->y);
    if (d0 == 0) d0 = 1;
    gest *fg = gest_at(e, first->g);
    if (fg && !fg->closed) fg->closed = 1, close_g(e, first->g, ev->t_ms, 0);
    t->owner_ptr[t->owner_n++] = (int)ev->pointer;
    t->pinch = 1, t->pinch_d0 = d0, t->pinch_q0 = t->m[2].value;
    t->pinch_g = open_g(e, ti, OMX_PANEL_WORD_SECOND, IN_PINCH, ev->t_ms, 1);
    t->pinch_a = (int)first->id, t->pinch_b = (int)ev->pointer;
    pointer *p = ptr_new(e, ev->pointer);
    if (p) p->target = ti, p->x0 = p->x = ev->x, p->y0 = p->y = ev->y, p->t0 = ev->t_ms, p->type = (int)ev->type, p->dragging = 1, p->g = -1;
    return;
  }
  int col = column_of(t, ev->x);
  int key = t->kind == GE_BAR ? col : 0;
  pointer *p = ptr_new(e, ev->pointer);
  if (!p) return;
  t->owner_n = 1, t->owner_ptr[0] = (int)ev->pointer, t->owner_type = (int)ev->type, t->owner_t0 = ev->t_ms, t->pinch = 0;
  p->target = ti, p->x0 = p->x = ev->x, p->y0 = p->y = ev->y, p->t0 = ev->t_ms, p->type = (int)ev->type, p->key = key, p->col = col, p->g = -1;
  p->in_x = ev->x, p->in_y = ev->y;
  p->second = t->tap_on && t->tap_key == key && t->tap_type == (int)ev->type && ev->t_ms - t->tap_t <= d->ms[TM_DOUBLE_TAP];
}

static void on_move(ge_engine *e, const omx_panel_event_t *ev) {
  const decl *d = e->d;
  pointer *p = ptr_of(e, ev->pointer);
  if (!p) return;
  tgt *t = &e->t[p->target];
  if (!owns(t, p->id)) return;
  p->x = ev->x, p->y = ev->y;
  if (t->pinch) {
    pointer *a = ptr_of(e, (uint32_t)t->pinch_a), *b = ptr_of(e, (uint32_t)t->pinch_b);
    if (!a || !b) return;
    const ge_member_t *q = &t->m[2];
    double scaled = t->pinch_q0 * (hypot(a->x - b->x, a->y - b->y) / t->pinch_d0);
    scaled = fmin(q->max, fmax(q->min, scaled));
    set_member(e, t->pinch_g, 2, scaled);
    close_g(e, t->pinch_g, ev->t_ms, 0);
    return;
  }
  int col = column_of(t, ev->x);
  if (t->kind == GE_BAR && !p->painting && col == p->col) p->in_x = ev->x, p->in_y = ev->y;
  if (!p->dragging) {
    if (hypot(ev->x - p->x0, ev->y - p->y0) <= d->drag_start_px) return;
    p->dragging = 1, p->fired = 1;
    p->acc = calloc(t->n + 1, sizeof(double));
    if (!p->acc) return;
    for (size_t m = 0; m < t->n; m++) p->acc[m] = ge_norm_of(&t->m[m], t->m[m].value);
    p->g = open_g(e, p->target, ev->fine ? OMX_PANEL_WORD_FINE : OMX_PANEL_WORD_DRAG, ev->fine ? IN_DRAG_FINE : IN_DRAG, p->t0, 1);
    /* the drag threshold is dead travel: the value moves from here */
    p->px = ev->x, p->py = ev->y;
  }
  gest *g = gest_at(e, p->g);
  if (!g) return;
  if (t->kind == GE_BAR && !p->painting && col != p->col && paint_with(e, p->type)) {
    /* a drag that leaves the pressed bar's column paints; the pressed bar keeps the height it had in its column */
    p->painting = 1;
    g->word = OMX_PANEL_WORD_PAINT, g->input = IN_SWEEP;
    set_member(e, p->g, (size_t)p->key, height_at(t, (size_t)p->key, p->in_y));
    p->prev_x = p->in_x, p->prev_y = p->in_y;
  }
  if (p->painting) {
    /* every bar entered takes its height, absolute; a column jumped over in one event is entered all the same */
    int from = column_of(t, p->prev_x);
    if (col >= 0 && from >= 0) {
      int dir = col > from ? 1 : col < from ? -1 : 0;
      int count = dir == 0 ? 1 : abs(col - from);
      for (int k = 0; k < count; k++) {
        int c = dir == 0 ? col : from + dir * (k + 1);
        double cx = t->col[4 * c] + t->col[4 * c + 2] / 2;
        double dx = ev->x - p->prev_x;
        double y = c == col ? ev->y : p->prev_y + (ev->y - p->prev_y) * ((cx - p->prev_x) / (dx == 0 ? 1 : dx));
        set_member(e, p->g, (size_t)c, height_at(t, (size_t)c, y));
      }
      p->prev_x = ev->x, p->prev_y = ev->y;
    }
    close_g(e, p->g, ev->t_ms, 0);
    return;
  }
  double ratio = ev->fine ? d->fine_ratio : 1;
  if (ev->fine) g->fine = 1, g->word = OMX_PANEL_WORD_FINE, g->input = IN_DRAG_FINE;
  double dx = ev->x - p->px, dy = ev->y - p->py;
  p->px = ev->x, p->py = ev->y;
  if (t->kind == GE_HANDLE) {
    p->acc[0] += (dx / t->plot[0]) * ratio;
    p->acc[1] += (-dy / t->plot[1]) * ratio;
    for (size_t m = 0; m < 2; m++) set_member(e, p->g, m, ge_value_of_norm(&t->m[m], p->acc[m]));
  } else {
    size_t m = t->kind == GE_BAR ? (size_t)p->key : 0;
    double travel = t->kind == GE_BAR ? t->col[4 * m + 3] : t->travel_px > 0 ? t->travel_px : d->default_travel_px;
    p->acc[m] += ((t->kind == GE_SINGLE && t->horizontal ? dx : -dy) / travel) * ratio;
    set_member(e, p->g, m, ge_value_of_norm(&t->m[m], p->acc[m]));
  }
  close_g(e, p->g, ev->t_ms, 0);
}

static void on_up(ge_engine *e, const omx_panel_event_t *ev) {
  const decl *d = e->d;
  pointer *p = ptr_of(e, ev->pointer);
  if (!p) return;
  int ti = p->target;
  tgt *t = &e->t[ti];
  if (!owns(t, p->id)) return;
  if (t->pinch) {
    close_g(e, t->pinch_g, ev->t_ms, 0);
    if (gest_at(e, t->pinch_g)) e->g[t->pinch_g].closed = 1;
    int keep = 0;
    for (int i = 0; i < t->owner_n; i++)
      if ((uint32_t)t->owner_ptr[i] != p->id) t->owner_ptr[keep++] = t->owner_ptr[i];
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
    close_g(e, pp.g, ev->t_ms, 0);
    if (gest_at(e, pp.g)) e->g[pp.g].closed = 1;
    free(pp.acc);
    return;
  }
  free(pp.acc);
  if (pp.fired) return;
  if (!hit(t, ev->x, ev->y) || (t->kind == GE_BAR && column_of(t, ev->x) != pp.col)) {
    e->cancelled = 1;
    if (e->keep) {
      double *nc = realloc(e->clog, (e->nclog + 1) * sizeof *nc);
      if (nc) e->clog = nc, e->clog[e->nclog++] = ev->t_ms;
    }
    return;
  }
  if (t->hold && ev->t_ms - pp.t0 < d->ms[TM_SAFETY_HOLD]) {
    char a[32], b[32];
    return refuse(e, OMX_PANEL_REFUSED_HOLD_SHORT, ev->t_ms, "held %s ms; the safety hold is %s ms", num(a, ev->t_ms - pp.t0), num(b, d->ms[TM_SAFETY_HOLD]));
  }
  if (pp.second && word_of(e, t, IN_DOUBLE_TAP) == OMX_PANEL_WORD_RESET) {
    int g = open_g(e, ti, OMX_PANEL_WORD_RESET, IN_DOUBLE_TAP, pp.t0, 1);
    reset_member(e, g, (size_t)(pp.key < 0 ? 0 : pp.key), ev->t_ms);
    close_g(e, g, ev->t_ms, 0);
    if (e->g[g].closed == 2) drop_last(e);
    t->tap_on = 0;
    return;
  }
  int word = word_of(e, t, IN_TAP);
  if (!word) return refuse(e, OMX_PANEL_REFUSED_NOT_IN_TABLE, ev->t_ms, "a %s has no tap", t->widget);
  int g = open_g(e, ti, word, IN_TAP, pp.t0, 1);
  size_t key = (size_t)(pp.key < 0 ? 0 : pp.key);
  if (word == OMX_PANEL_WORD_TOGGLE) {
    const ge_member_t *m = &t->m[key];
    set_member(e, g, key, m->value == m->max ? m->min : m->max);
  } else if (word == OMX_PANEL_WORD_SELECT) {
    /* a tap selects and never changes a value */
    t->selected = t->kind == GE_BAR ? (int)key : -1;
    e->sel_target = ti, e->sel_member = (int)key;
  }
  close_g(e, g, ev->t_ms, 0);
  t->tap_on = 1, t->tap_key = (int)key, t->tap_type = pp.type, t->tap_t = ev->t_ms;
}

/* ------------------------------------------------------------------------------------------------- wheels, detents and keys */

static void on_input(ge_engine *e, const omx_panel_event_t *ev, int target, int member) {
  const decl *d = e->d;
  int ti = -1;
  if (target == GE_NONE) return refuse(e, OMX_PANEL_REFUSED_NO_TARGET, ev->t_ms, "no bar or handle member selected for the step");
  if (target >= 0 && (size_t)target < e->nt) ti = target;
  else if (ev->kind == OMX_PANEL_EVENT_WHEEL) {
    for (size_t k = 0; k < e->nt && ti < 0; k++)
      if (hit(&e->t[k], ev->x, ev->y)) ti = (int)k, member = e->t[k].kind == GE_BAR ? column_of(&e->t[k], ev->x) : 0;
  } else {
    /* a key or a detent with no target named: the bar a tap last selected, else the only handle */
    for (size_t k = 0; k < e->nt && ti < 0; k++)
      if (e->t[k].selected >= 0 || e->t[k].kind == GE_HANDLE) ti = (int)k;
  }
  if (ti < 0) return refuse(e, OMX_PANEL_REFUSED_NO_TARGET, ev->t_ms, "no bar or handle member selected for the step");
  tgt *t = &e->t[ti];
  int input;
  if (ev->kind == OMX_PANEL_EVENT_WHEEL) input = ev->coarse ? IN_WHEEL_COARSE : IN_WHEEL;
  else if (ev->kind == OMX_PANEL_EVENT_DETENT) input = ev->encoder == 3 ? IN_ENCODER3 : ev->coarse ? IN_DETENT_COARSE : IN_DETENT;
  else if (ev->key == OMX_PANEL_KEY_BACKSPACE) input = IN_BACKSPACE;
  else input = ev->shift ? (t->kind == GE_HANDLE ? IN_ARROW_SECOND : IN_ARROW_COARSE) : IN_ARROW;
  if (read_only(e, t)) return refuse(e, OMX_PANEL_REFUSED_READ_ONLY, ev->t_ms, "a %s that is read-only takes no gesture", t->widget);
  char source[16];
  snprintf(source, sizeof source, "%s%s", ev->kind == OMX_PANEL_EVENT_WHEEL ? "wheel" : ev->kind == OMX_PANEL_EVENT_DETENT ? "detent" : "key",
           ev->kind == OMX_PANEL_EVENT_DETENT && ev->encoder ? (ev->encoder == 3 ? "3" : "?") : "");
  if (t->owner_n || (t->claim_on && ev->t_ms < t->claim_until && strcmp(t->claim_source, source)))
    return refuse(e, OMX_PANEL_REFUSED_CONTROL_OWNED, ev->t_ms, "the control belongs to another input");
  int word = word_of(e, t, input);
  if (!word) return refuse(e, OMX_PANEL_REFUSED_NOT_IN_TABLE, ev->t_ms, "a %s has no %s", t->widget, GE_INPUT_NAMES[input]);
  int arrow_member = -1, arrow_dir = 0;
  if (ev->kind == OMX_PANEL_EVENT_KEY) {
    switch (ev->key) {
    case OMX_PANEL_KEY_UP: arrow_member = 1, arrow_dir = 1; break;
    case OMX_PANEL_KEY_DOWN: arrow_member = 1, arrow_dir = -1; break;
    case OMX_PANEL_KEY_RIGHT: arrow_member = 0, arrow_dir = 1; break;
    case OMX_PANEL_KEY_LEFT: arrow_member = 0, arrow_dir = -1; break;
    default: break;
    }
  }
  int dir = ev->kind == OMX_PANEL_EVENT_KEY ? arrow_dir : (ev->n > 0) - (ev->n < 0);
  double count = (ev->kind == OMX_PANEL_EVENT_KEY ? 1 : fabs((double)ev->n)) *
                 (input == IN_WHEEL_COARSE || input == IN_DETENT_COARSE || input == IN_ARROW_COARSE ? d->coarse_steps : 1);
  int key;
  if (word == OMX_PANEL_WORD_SECOND) key = 2;
  else if (t->kind == GE_HANDLE) key = arrow_member;
  else if (t->kind == GE_BAR) key = member >= 0 ? member : t->selected;
  else key = 0;
  if (word == OMX_PANEL_WORD_RESET) {
    /* a bar with none selected has no default to reset */
    if (t->kind == GE_BAR && key < 0) {
      e->seq++; /* the reference opens the gesture, finds nothing to reset and drops it: its id is spent */
      return refuse(e, OMX_PANEL_REFUSED_NO_DEFAULT, ev->t_ms, "null declares no default");
    }
    int g = open_g(e, ti, OMX_PANEL_WORD_RESET, input, ev->t_ms, 0);
    reset_member(e, g, (size_t)(t->kind == GE_BAR ? key : 0), ev->t_ms);
    close_g(e, g, ev->t_ms, 0);
    if (e->g[g].closed == 2) drop_last(e);
    return;
  }
  if (key < 0 || (size_t)key >= t->n) return refuse(e, OMX_PANEL_REFUSED_NO_TARGET, ev->t_ms, "no bar or handle member selected for the step");
  /* steps of one source within the claim are one gesture, one undo entry */
  gest *sg = gest_at(e, t->step_g);
  if (!(sg && t->claim_on && !strcmp(t->claim_source, source) && ev->t_ms < t->claim_until && sg->word == word)) t->step_g = open_g(e, ti, word, input, ev->t_ms, 0);
  const ge_member_t *m = &t->m[key];
  set_member(e, t->step_g, (size_t)key, ge_value_of_norm(m, ge_norm_of(m, m->value) + dir * count * step_norm(d, m)));
  t->claim_on = 1, t->claim_until = ev->t_ms + d->ms[TM_CLAIM];
  snprintf(t->claim_source, sizeof t->claim_source, "%s", source);
  close_g(e, t->step_g, ev->t_ms, d->ms[TM_CLAIM]);
}

/* ------------------------------------------------------------------------------------------------- the front door of the engine */

void ge_begin(ge_engine *e) {
  e->nchg = 0, e->touched = -1, e->refusal = OMX_PANEL_REFUSED_NONE, e->cancelled = 0, e->sel_target = e->sel_member = -1;
}

void ge_tick(ge_engine *e, double t_ms) { tick_to(e, t_ms); }

void ge_event(ge_engine *e, const omx_panel_event_t *ev, int target, int member) {
  tick_to(e, ev->t_ms);
  switch (ev->kind) {
  case OMX_PANEL_EVENT_DOWN: on_down(e, ev, target); break;
  case OMX_PANEL_EVENT_MOVE: on_move(e, ev); break;
  case OMX_PANEL_EVENT_UP: on_up(e, ev); break;
  default: on_input(e, ev, target, member); break;
  }
}

const ge_change_t *ge_changes(const ge_engine *e, size_t *n) {
  if (n) *n = e->nchg;
  return e->chg;
}
omx_panel_refusal_t ge_refusal(const ge_engine *e) { return e->refusal; }
int ge_cancelled(const ge_engine *e) { return e->cancelled; }
void ge_selected(const ge_engine *e, int *target, int *member) {
  if (target) *target = e->sel_target;
  if (member) *member = e->sel_member;
}
int ge_selected_member(const ge_engine *e, int at) { return at >= 0 && (size_t)at < e->nt ? e->t[at].selected : -1; }
double ge_member_value(const ge_engine *e, int at, int member) { return e->t[at].m[member].value; }

static void gest_view(ge_engine *e, const gest *g, ge_gesture_t *out) {
  *out = (ge_gesture_t){g->id, (omx_panel_word_t)g->word, g->input, g->begin, g->end, g->shown_until, g->fine, g->closed, g->pointer, g->target, g->n, g->tag, g->chg, g->val};
  (void)e;
}
const ge_gesture_t *ge_touched(const ge_engine *e) {
  if (e->touched < 0 || (size_t)e->touched >= e->ng) return NULL;
  gest_view((ge_engine *)e, &e->g[e->touched], &((ge_engine *)e)->view);
  return &e->view;
}
size_t ge_gesture_count(const ge_engine *e) { return e->ng; }
int ge_gesture_at(const ge_engine *e, size_t i, ge_gesture_t *out) {
  if (i >= e->ng || !out) return 0;
  gest_view((ge_engine *)e, &e->g[i], out);
  return 1;
}
const ge_refusal_t *ge_refusals(const ge_engine *e, size_t *n) {
  if (n) *n = e->nrlog;
  return e->rlog;
}
const double *ge_cancellations(const ge_engine *e, size_t *n) {
  if (n) *n = e->nclog;
  return e->clog;
}

/* ------------------------------------------------------------------------------------------------- the JSON door */

struct omx_gesture {
  char *gestures_json;
  char *settings_json;
  omx_panel_refusal_t refused; /* what the settings were refused for, OMX_PANEL_REFUSED_NONE for none */
  char why[200];
};

/* a growing text */
typedef struct { char *s; size_t n, cap; int bad; } sbuf;
static void sb_put(sbuf *b, const char *s, size_t n) {
  if (b->bad) return;
  if (b->n + n + 1 > b->cap) {
    size_t cap = b->cap ? b->cap : 1024;
    while (cap < b->n + n + 1) cap *= 2;
    char *ns = realloc(b->s, cap);
    if (!ns) {
      b->bad = 1;
      return;
    }
    b->s = ns, b->cap = cap;
  }
  memcpy(b->s + b->n, s, n), b->n += n, b->s[b->n] = 0;
}
static void sb_str(sbuf *b, const char *s) { sb_put(b, s, strlen(s)); }
static void sb_fmt(sbuf *b, const char *fmt, ...) {
  char tmp[512];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(tmp, sizeof tmp, fmt, ap);
  va_end(ap);
  if (n > 0) sb_put(b, tmp, (size_t)n < sizeof tmp ? (size_t)n : sizeof tmp - 1);
}
/* a double as JSON text that reads back as the same double (-0 included) */
static void sb_num(sbuf *b, double v) {
  char t[40];
  if (!isfinite(v)) return sb_str(b, "null");
  for (int p = 15; p <= 17; p++) {
    snprintf(t, sizeof t, "%.*g", p, v);
    if (strtod(t, NULL) == v) break;
  }
  sb_str(b, t);
}
static void sb_json(sbuf *b, const char *s) {
  sb_str(b, "\"");
  for (; *s; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') sb_fmt(b, "\\%c", c);
    else if (c < 0x20) sb_fmt(b, "\\u%04x", c);
    else sb_put(b, s, 1);
  }
  sb_str(b, "\"");
}

omx_gesture_t *omx_gesture_open(const char *gestures_json, const char *settings_json) {
  if (!gestures_json) return NULL;
  ge_engine *probe = ge_open(gestures_json);
  if (!probe) return NULL;
  omx_gesture_t *ctx = calloc(1, sizeof *ctx);
  if (!ctx) return ge_close(probe), NULL;
  ctx->gestures_json = strdup(gestures_json), ctx->settings_json = settings_json && *settings_json ? strdup(settings_json) : NULL;
  if (!ctx->gestures_json || (settings_json && *settings_json && !ctx->settings_json)) {
    omx_gesture_close(ctx);
    ge_close(probe);
    return NULL;
  }
  /* the settings are held to the declaration now, so a refusal is the context's and every run answers it */
  cJSON *s = ctx->settings_json ? cJSON_Parse(ctx->settings_json) : NULL;
  if (ctx->settings_json && !s) {
    ctx->refused = OMX_PANEL_REFUSED_BAD_SETTING;
    say(ctx->why, sizeof ctx->why, "the settings are not JSON");
  }
  cJSON *tm = cJSON_GetObjectItemCaseSensitive(s, "timings"), *it;
  cJSON_ArrayForEach(it, tm) {
    if (ctx->refused) break;
    double ms = cJSON_IsNumber(it) ? it->valuedouble : NAN;
    ctx->refused = ge_set_timing(probe, it->string, ms, ctx->why, sizeof ctx->why);
  }
  if (!ctx->refused && cJSON_IsFalse(cJSON_GetObjectItemCaseSensitive(s, "paintWithTouch")))
    ctx->refused = OMX_PANEL_REFUSED_PAINT_REQUIRED, say(ctx->why, sizeof ctx->why, "painting is required on touch");
  cJSON_Delete(s);
  ge_close(probe);
  return ctx;
}

void omx_gesture_close(omx_gesture_t *ctx) {
  if (!ctx) return;
  free(ctx->gestures_json), free(ctx->settings_json);
  free(ctx);
}

static const char *jstr(const cJSON *o, const char *k) { return cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(o, k)); }
static int jhas(const cJSON *o, const char *k) { return cJSON_IsNumber(cJSON_GetObjectItemCaseSensitive(o, k)); }
static double jnum(const cJSON *o, const char *k, double dflt) {
  const cJSON *n = cJSON_GetObjectItemCaseSensitive(o, k);
  return cJSON_IsNumber(n) ? n->valuedouble : dflt;
}
static int jtrue(const cJSON *o, const char *k) { return cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(o, k)); }

/* a control's member from its JSON: ends, default, scale, step, integer, and the value it starts at (value, else default, else min) */
static ge_member_t member_of(const cJSON *o) {
  ge_member_t m = {.min = jnum(o, "min", 0), .max = jnum(o, "max", 1), .def = jnum(o, "def", 0), .step = jnum(o, "step", 0)};
  const char *sc = jstr(o, "scale");
  m.has_def = jhas(o, "def"), m.log = sc && !strcmp(sc, "log"), m.integer = jtrue(o, "integer");
  m.value = jhas(o, "value") ? jnum(o, "value", 0) : m.has_def ? m.def : m.min;
  return m;
}
static int rect_of(const cJSON *o, double r[4]) {
  const cJSON *t = cJSON_GetObjectItemCaseSensitive(o, "target");
  if (!cJSON_IsObject(t)) return 0;
  r[0] = jnum(t, "x", 0), r[1] = jnum(t, "y", 0), r[2] = jnum(t, "w", 0), r[3] = jnum(t, "h", 0);
  return 1;
}

typedef struct { char **name; size_t n; } idtab;
static uint32_t intern(idtab *t, const cJSON *id) {
  char buf[40];
  const char *s = cJSON_GetStringValue(id);
  if (!s) snprintf(buf, sizeof buf, "%.17g", cJSON_IsNumber(id) ? id->valuedouble : 0), s = buf;
  for (size_t i = 0; i < t->n; i++)
    if (!strcmp(t->name[i], s)) return (uint32_t)i;
  char **nn = realloc(t->name, (t->n + 1) * sizeof *nn);
  if (!nn) return 0;
  t->name = nn;
  t->name[t->n] = strdup(s);
  return (uint32_t)t->n++;
}
static const char *idtab_name(void *ctx, uint32_t id) {
  const idtab *t = ctx;
  return id < t->n ? t->name[id] : "?";
}

typedef struct { omx_panel_event_t ev; int member; size_t order; } scripted;
static int by_time(const void *a, const void *b) {
  const scripted *x = a, *y = b;
  return x->ev.t_ms < y->ev.t_ms ? -1 : x->ev.t_ms > y->ev.t_ms ? 1 : x->order < y->order ? -1 : x->order > y->order;
}

static void answer_error(sbuf *out, const char *code, const char *why) {
  sb_str(out, "{\"error\":{\"code\":");
  sb_json(out, code);
  sb_str(out, ",\"why\":");
  sb_json(out, why);
  sb_str(out, "}}");
}

/* One gesture as runGesture gives it; `names` are the members' names, which the change list is keyed by. */
static void put_gesture(sbuf *b, const ge_gesture_t *g, const char *const *names) {
  sb_fmt(b, "{\"id\":\"g%u\",\"word\":", g->id);
  sb_json(b, WORD_NAMES[g->word]);
  sb_str(b, ",\"input\":");
  sb_json(b, GE_INPUT_NAMES[g->input]);
  sb_str(b, ",\"begin\":"), sb_num(b, g->begin);
  sb_str(b, ",\"end\":"), sb_num(b, g->end);
  sb_str(b, ",\"changes\":{");
  const char *sep = "";
  for (size_t m = 0; m < g->n; m++) {
    if (!g->changed[m]) continue;
    sb_str(b, sep), sep = ",";
    sb_json(b, names[g->tag[m]]);
    sb_str(b, ":"), sb_num(b, g->value[m]);
  }
  sb_fmt(b, "},\"fine\":%s,\"shown\":{\"from\":", g->fine ? "true" : "false");
  sb_num(b, g->begin);
  sb_str(b, ",\"until\":"), sb_num(b, g->shown_until);
  sb_fmt(b, ",\"clearOfFinger\":true,\"drawnFollowsFinger\":%s,\"readBackReplaces\":true}}", g->pointer ? "true" : "false");
}

/* The control, held while a script runs on it. */
typedef struct {
  ge_target_t tg;
  ge_member_t mem[3];
  ge_member_t *bar_mem;
  double *cols;
  int *tags;
  const char **names;
  size_t n;
} door_control;

static void door_control_free(door_control *c) {
  free(c->bar_mem), free(c->cols), free(c->tags), free(c->names);
}

/* The control's JSON onto one target: a single control, a handle (freq, gain, q) or a bar group (bars). 0 when it cannot be held. */
static int door_control_read(door_control *c, const cJSON *control) {
  static const char *const handle_names[3] = {"freq", "gain", "q"};
  const char *widget = jstr(control, "widget");
  const cJSON *bars = cJSON_GetObjectItemCaseSensitive(control, "bars");
  ge_target_t *tg = &c->tg;
  *tg = (ge_target_t){.kind = GE_SINGLE, .row = ge_row_of(widget), .widget = widget, .section = jstr(control, "section")};
  tg->read_only = jtrue(control, "readOnly"), tg->hold = jtrue(control, "hold");
  if (widget && !strcmp(widget, "handle")) {
    for (int k = 0; k < 3; k++) {
      const cJSON *m = cJSON_GetObjectItemCaseSensitive(control, handle_names[k]);
      if (!cJSON_IsObject(m)) return 0;
      c->mem[k] = member_of(m);
    }
    const cJSON *pl = cJSON_GetObjectItemCaseSensitive(control, "plot");
    tg->kind = GE_HANDLE, tg->row = GE_ROW_HANDLE, tg->n = c->n = 3, tg->member = c->mem;
    tg->plot[0] = jnum(pl, "w", 1), tg->plot[1] = jnum(pl, "h", 1);
    c->names = calloc(3, sizeof *c->names);
    if (!c->names) return 0;
    for (int k = 0; k < 3; k++) c->names[k] = handle_names[k];
    return rect_of(control, tg->rect);
  }
  if (widget && !strcmp(widget, "bar")) {
    size_t n = cJSON_IsArray(bars) ? (size_t)cJSON_GetArraySize(bars) : 0;
    if (!n) return 0;
    c->bar_mem = calloc(n, sizeof *c->bar_mem), c->cols = calloc(n * 4, sizeof *c->cols), c->tags = malloc(n * sizeof *c->tags), c->names = calloc(n, sizeof *c->names);
    if (!c->bar_mem || !c->cols || !c->tags || !c->names) return 0;
    for (size_t i = 0; i < n; i++) {
      const cJSON *b = cJSON_GetArrayItem(bars, (int)i);
      double r[4];
      if (!cJSON_IsObject(b) || !rect_of(b, r)) return 0;
      c->bar_mem[i] = member_of(b), memcpy(c->cols + 4 * i, r, sizeof r), c->tags[i] = (int)i;
      c->names[i] = jstr(b, "symbol") ? jstr(b, "symbol") : "";
    }
    tg->kind = GE_BAR, tg->row = GE_ROW_BAR, tg->n = c->n = n, tg->member = c->bar_mem, tg->col = c->cols, tg->tag = c->tags, tg->name = c->names;
    return 1;
  }
  c->mem[0] = member_of(control);
  c->names = calloc(1, sizeof *c->names);
  if (!c->names) return 0;
  c->names[0] = "value";
  tg->n = c->n = 1, tg->member = c->mem;
  tg->travel_px = jnum(control, "travelPx", 0);
  tg->horizontal = jstr(control, "orientation") && !strcmp(jstr(control, "orientation"), "horizontal");
  return rect_of(control, tg->rect);
}

/* The events' JSON onto the engine's, in time order (a stable sort by t). Bars a wheel or key names are matched by symbol. */
static scripted *door_events_read(const cJSON *events, const door_control *c, idtab *ids, size_t *nev) {
  size_t n = (size_t)cJSON_GetArraySize(events);
  scripted *sc = calloc(n + 1, sizeof *sc);
  if (!sc) return NULL;
  for (size_t i = 0; i < n; i++) {
    const cJSON *j = cJSON_GetArrayItem(events, (int)i);
    scripted *s = &sc[i];
    const char *type = jstr(j, "type"), *pt = jstr(j, "ptype"), *key = jstr(j, "key");
    s->order = i, s->member = -1;
    s->ev.t_ms = jnum(j, "t", 0), s->ev.x = jnum(j, "x", 0), s->ev.y = jnum(j, "y", 0);
    s->ev.kind = !type ? OMX_PANEL_EVENT_KEY : !strcmp(type, "down") ? OMX_PANEL_EVENT_DOWN : !strcmp(type, "move") ? OMX_PANEL_EVENT_MOVE : !strcmp(type, "up") ? OMX_PANEL_EVENT_UP
                 : !strcmp(type, "wheel") ? OMX_PANEL_EVENT_WHEEL : !strcmp(type, "detent") ? OMX_PANEL_EVENT_DETENT : OMX_PANEL_EVENT_KEY;
    s->ev.type = !pt || !strcmp(pt, "touch") ? OMX_PANEL_POINTER_TOUCH : !strcmp(pt, "mouse") ? OMX_PANEL_POINTER_MOUSE : !strcmp(pt, "pen") ? OMX_PANEL_POINTER_PEN : OMX_PANEL_POINTER_FADER;
    s->ev.pointer = intern(ids, cJSON_GetObjectItemCaseSensitive(j, "id"));
    s->ev.fine = jtrue(j, "fine"), s->ev.coarse = jtrue(j, "coarse"), s->ev.shift = jtrue(j, "shift");
    s->ev.n = (int32_t)jnum(j, "n", 0), s->ev.encoder = (int32_t)jnum(j, "encoder", 0), s->ev.control = -1;
    s->ev.key = !key ? (omx_panel_key_t)-1 : !strcmp(key, "Backspace") ? OMX_PANEL_KEY_BACKSPACE : !strcmp(key, "ArrowUp") ? OMX_PANEL_KEY_UP : !strcmp(key, "ArrowDown") ? OMX_PANEL_KEY_DOWN
                : !strcmp(key, "ArrowLeft") ? OMX_PANEL_KEY_LEFT : !strcmp(key, "ArrowRight") ? OMX_PANEL_KEY_RIGHT : (omx_panel_key_t)-1;
    const char *bar = jstr(j, "bar");
    for (size_t k = 0; bar && c->tg.kind == GE_BAR && k < c->n; k++)
      if (!strcmp(c->names[k], bar)) s->member = (int)k;
  }
  qsort(sc, n, sizeof *sc, by_time);
  *nev = n;
  return sc;
}

/* The answer of runGesture: the value in the control's unit, every gesture, the undo entries, what was selected, refused, cancelled. */
static void door_answer(sbuf *out, ge_engine *e, const door_control *c, int sel_kind, int sel_member) {
  size_t ng = ge_gesture_count(e);
  ge_gesture_t g;
  sb_str(out, "{\"value\":");
  if (c->tg.kind == GE_SINGLE) sb_num(out, ge_member_value(e, 0, 0));
  else {
    sb_str(out, "{");
    for (size_t m = 0; m < c->n; m++) {
      sb_str(out, m ? "," : "");
      sb_json(out, c->names[m]);
      sb_str(out, ":"), sb_num(out, ge_member_value(e, 0, (int)m));
    }
    sb_str(out, "}");
  }
  sb_str(out, ",\"gestures\":[");
  for (size_t i = 0; i < ng; i++) {
    ge_gesture_at(e, i, &g);
    sb_str(out, i ? "," : "");
    put_gesture(out, &g, c->names);
  }
  sb_str(out, "],\"gesture\":");
  if (ng) ge_gesture_at(e, ng - 1, &g), put_gesture(out, &g, c->names);
  else sb_str(out, "null");
  if (ng) {
    sb_str(out, ",\"begin\":"), sb_num(out, g.begin);
    sb_str(out, ",\"end\":"), sb_num(out, g.end);
  } else sb_str(out, ",\"begin\":null,\"end\":null");
  sb_str(out, ",\"undo\":[");
  const char *sep = "";
  for (size_t i = 0; i < ng; i++) {
    ge_gesture_at(e, i, &g);
    int any = 0;
    for (size_t m = 0; m < g.n; m++) any |= g.changed[m];
    if (any) sb_fmt(out, "%s\"g%u\"", sep, g.id), sep = ",";
  }
  sb_str(out, "],\"selected\":");
  if (sel_kind == 1) sb_json(out, c->names[sel_member]);
  else if (sel_kind == 2) sb_str(out, "\"handle\"");
  else if (sel_kind == 3) sb_str(out, "true");
  else sb_str(out, "null");
  size_t nr, nc;
  const ge_refusal_t *r = ge_refusals(e, &nr);
  const double *cancelled = ge_cancellations(e, &nc);
  sb_str(out, ",\"refused\":[");
  for (size_t i = 0; i < nr; i++) {
    sb_str(out, i ? ",{\"code\":" : "{\"code\":");
    sb_json(out, ge_refusal_code(r[i].code));
    sb_str(out, ",\"t\":"), sb_num(out, r[i].t);
    sb_str(out, ",\"why\":"), sb_json(out, r[i].why);
    sb_str(out, "}");
  }
  sb_str(out, "],\"cancelled\":[");
  for (size_t i = 0; i < nc; i++) {
    sb_str(out, i ? ",{\"t\":" : "{\"t\":");
    sb_num(out, cancelled[i]);
    sb_str(out, ",\"why\":\"released outside the target\"}");
  }
  sb_str(out, "]}");
}

/* What a call to omx_gesture_run hands back: the text, copied into the caller's buffer as far as it goes, its length returned. */
static size_t hand_back(sbuf *out, char *answer, size_t cap) {
  size_t n = out->bad || !out->s ? 0 : out->n;
  if (answer && cap) {
    size_t k = n < cap - 1 ? n : cap - 1;
    if (n) memcpy(answer, out->s, k);
    answer[k] = 0;
  }
  free(out->s);
  return n;
}

size_t omx_gesture_run(omx_gesture_t *ctx, const char *control_json, const char *events_json, char *answer, size_t cap) {
  sbuf out = {0};
  if (!ctx) return 0;
  if (ctx->refused) {
    answer_error(&out, ge_refusal_code(ctx->refused), ctx->why);
    return hand_back(&out, answer, cap);
  }
  cJSON *control = control_json ? cJSON_Parse(control_json) : NULL, *events = events_json ? cJSON_Parse(events_json) : NULL;
  ge_engine *e = ge_open(ctx->gestures_json);
  door_control c = {0};
  idtab ids = {0};
  scripted *sc = NULL;
  size_t nev = 0;
  if (!cJSON_IsObject(control) || !cJSON_IsArray(events) || !e) answer_error(&out, "GESTURE_BAD_INPUT", "the control is a JSON object and the events a JSON array");
  else if (!door_control_read(&c, control) || ge_add(e, &c.tg) != 0) answer_error(&out, "GESTURE_BAD_INPUT", "the control has no target, or no members, the engine can hold");
  else {
    cJSON *s = ctx->settings_json ? cJSON_Parse(ctx->settings_json) : NULL, *it;
    cJSON_ArrayForEach(it, cJSON_GetObjectItemCaseSensitive(s, "timings")) ge_set_timing(e, it->string, it->valuedouble, NULL, 0);
    ge_set_paint(e, 1, cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(s, "paintWithMouse")));
    cJSON_Delete(s);
    ge_keep_log(e, 1);
    ge_set_id_namer(e, idtab_name, &ids);
    const char *selected = jstr(control, "selected");
    for (size_t i = 0; selected && c.tg.kind == GE_BAR && i < c.n; i++)
      if (!strcmp(c.names[i], selected)) ge_select(e, 0, (int)i);
    sc = door_events_read(events, &c, &ids, &nev);
    if (!sc) answer_error(&out, "GESTURE_BAD_INPUT", "out of memory");
    else {
      int sel_kind = 0, sel_member = ge_selected_member(e, 0); /* what the last select named: 1 a bar's member, 2 the handle, 3 the control */
      if (sel_member >= 0) sel_kind = 1;
      for (size_t i = 0; i < nev; i++) {
        ge_begin(e);
        ge_event(e, &sc[i].ev, 0, sc[i].member);
        int st, sm;
        ge_selected(e, &st, &sm);
        if (st >= 0) sel_kind = c.tg.kind == GE_BAR ? 1 : c.tg.kind == GE_HANDLE ? 2 : 3, sel_member = sm;
      }
      if (nev) ge_begin(e), ge_tick(e, sc[nev - 1].ev.t_ms);
      door_answer(&out, e, &c, sel_kind, sel_member);
    }
  }
  free(sc);
  for (size_t i = 0; i < ids.n; i++) free(ids.name[i]);
  free(ids.name);
  door_control_free(&c);
  ge_close(e);
  cJSON_Delete(control), cJSON_Delete(events);
  return hand_back(&out, answer, cap);
}
