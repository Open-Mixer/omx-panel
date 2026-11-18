/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * scene.c — a drawing of look.json read once and painted by coverage. A port of tools/svg-knob.mjs (resolveScene, paintScene) over
 * raster.c's omx_paint, which ports tools/raster.mjs paint(): the same operations in the same order, so the two painters agree to
 * the bit (test/scene.test.mjs). Nothing here is a second drawing: the shapes, the gradient and every colour are the look's.
 */
#include "scene.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { T_CIRCLE, T_ELLIPSE, T_RECT, T_LINE };
enum { FILL_NONE, FILL_SOLID, FILL_GRADIENT };
#define MAX_ROT 4
#define MAX_GRAD 8

typedef struct {
  double a, cx, cy;
  int frame; /* the angle is the frame's ({angle}) */
} rot_t;

typedef struct {
  char id[32];
  int radial;
  double p[4]; /* linear: x1 y1 x2 y2; radial: cx cy r */
  double at[2], alpha[2];
  double rgb[2][3];
} grad_t;

typedef struct {
  int tag;
  double v[8]; /* circle: cx cy r; ellipse: cx cy rx ry; rect: x y w h rx; line: x1 y1 x2 y2 half-width */
  int fill, grad;
  double rgb[3], opacity;
  int nrot;
  rot_t rot[MAX_ROT];
} shape_t;

struct omx_scene {
  double view_box;
  int ngrad, nshape;
  grad_t grad[MAX_GRAD];
  shape_t *shapes;
};

static void refuse(char *err, size_t n, const char *fmt, const char *a, const char *b, const char *c) {
  if (err && n) snprintf(err, n, fmt, a ? a : "", b ? b : "", c ? c : "");
}

static const cJSON *item(const cJSON *o, const char *k) { return cJSON_GetObjectItemCaseSensitive((cJSON *)o, k); }

/* #rrggbb or the console's three-digit shade, as tools/raster.mjs rgbOf reads them */
static int hex_rgb(const char *s, double out[3]) {
  size_t len = s ? strlen(s) : 0;
  unsigned v = 0;
  if (len != 7 && len != 4) return 0;
  if (s[0] != '#') return 0;
  for (size_t i = 1; i < len; i++) {
    char ch = s[i];
    if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F'))) return 0;
    unsigned d = (unsigned)(ch <= '9' ? ch - '0' : (ch | 32) - 'a' + 10);
    v = len == 7 ? v * 16 + d : v * 256 + d * 17;
  }
  out[0] = (v >> 16) & 255, out[1] = (v >> 8) & 255, out[2] = v & 255;
  return 1;
}

typedef struct {
  const cJSON *tokens, *console, *finish;
  const char *drawing, *finish_name;
} look_t;

/* A colour of the scene: #rrggbb, or one placeholder naming the look, the console's pin or the console's finish. */
static int colour(const look_t *L, const char *s, double out[3], char *err, size_t n) {
  if (hex_rgb(s, out)) return 1;
  size_t len = s ? strlen(s) : 0;
  if (len < 4 || s[0] != '{' || s[len - 1] != '}') {
    refuse(err, n, "drawing '%s': '%s' is neither #rrggbb nor a placeholder%s", L->drawing, s, NULL);
    return 0;
  }
  char name[96];
  snprintf(name, sizeof name, "%.*s", (int)len - 2, s + 1);
  const cJSON *tab;
  const char *key = name;
  if (strncmp(name, "console:", 8) == 0) tab = item(L->console, "tokens"), key = name + 8;
  else if (strncmp(name, "finish:", 7) == 0) tab = item(item(L->console, "finish"), L->finish_name), key = name + 7;
  else tab = L->tokens;
  const char *hex = cJSON_GetStringValue(item(tab, key));
  if (!hex_rgb(hex, out)) {
    refuse(err, n, "drawing '%s': {%s} is carried by no %s of the look and the console's pin", L->drawing, name,
           strncmp(name, "finish:", 7) == 0 ? "finish token" : "token");
    return 0;
  }
  return 1;
}

static double num(const cJSON *o, const char *k, double d) {
  const cJSON *v = item(o, k);
  return cJSON_IsNumber(v) ? v->valuedouble : d;
}

omx_scene *omx_scene_from_look(const cJSON *root, const char *drawing, const char *finish, char *err, size_t err_size) {
  const cJSON *d = item(item(root, "drawings"), drawing);
  const cJSON *console = item(root, "console");
  if (!cJSON_IsObject(d)) {
    refuse(err, err_size, "look: no drawing '%s' in the look's drawings%s%s", drawing, NULL, NULL);
    return NULL;
  }
  if (!cJSON_IsObject(item(item(console, "finish"), finish))) {
    refuse(err, err_size, "look: '%s' is no finish of the console's pin (drawing '%s')%s", finish, drawing, NULL);
    return NULL;
  }
  look_t L = {item(root, "tokens"), console, NULL, drawing, finish};
  omx_scene *s = calloc(1, sizeof *s);
  if (!s) return NULL;
  s->view_box = num(d, "viewBox", 0);
  if (!(s->view_box > 0)) {
    refuse(err, err_size, "drawing '%s' has no viewBox number%s%s", drawing, NULL, NULL);
    goto bad;
  }
  const cJSON *g;
  cJSON_ArrayForEach(g, item(d, "gradients")) {
    char id[32];
    snprintf(id, sizeof id, "%s", g->string ? g->string : "");
    const cJSON *stops = item(g, "stops");
    int ns = cJSON_GetArraySize(stops);
    if (ns != 2) {
      char count[16];
      snprintf(count, sizeof count, "%d", ns);
      refuse(err, err_size, "drawing '%s': gradient '%s' has %s stops; the renderer's backends take 2", drawing, id, count);
      goto bad;
    }
    if (s->ngrad >= MAX_GRAD) {
      refuse(err, err_size, "drawing '%s': more than 8 gradients%s%s", drawing, NULL, NULL);
      goto bad;
    }
    grad_t *gr = &s->grad[s->ngrad++];
    snprintf(gr->id, sizeof gr->id, "%s", id);
    const char *kind = cJSON_GetStringValue(item(g, "kind"));
    gr->radial = kind && strcmp(kind, "radialGradient") == 0;
    if (!gr->radial && !(kind && strcmp(kind, "linearGradient") == 0)) {
      refuse(err, err_size, "drawing '%s': gradient '%s' is '%s', not a linearGradient or a radialGradient", drawing, id, kind);
      goto bad;
    }
    const cJSON *a = item(g, "attrs");
    if (gr->radial) gr->p[0] = num(a, "cx", 0.5), gr->p[1] = num(a, "cy", 0.5), gr->p[2] = num(a, "r", 0.5);
    else gr->p[0] = num(a, "x1", 0), gr->p[1] = num(a, "y1", 0), gr->p[2] = num(a, "x2", 1), gr->p[3] = num(a, "y2", 0);
    for (int i = 0; i < 2; i++) {
      const cJSON *st = cJSON_GetArrayItem(stops, i);
      gr->at[i] = num(st, "offset", 0);
      gr->alpha[i] = num(st, "opacity", 1);
      if (!colour(&L, cJSON_GetStringValue(item(st, "color")), gr->rgb[i], err, err_size)) goto bad;
    }
  }
  int count = cJSON_GetArraySize(item(d, "shapes"));
  s->shapes = calloc((size_t)(count ? count : 1), sizeof *s->shapes);
  if (!s->shapes) goto bad;
  const cJSON *sh;
  cJSON_ArrayForEach(sh, item(d, "shapes")) {
    shape_t *x = &s->shapes[s->nshape];
    char at[16];
    snprintf(at, sizeof at, "%d", s->nshape);
    const char *tag = cJSON_GetStringValue(item(sh, "tag"));
    const cJSON *a = item(sh, "attrs");
    if (tag && strcmp(tag, "circle") == 0) x->tag = T_CIRCLE, x->v[0] = num(a, "cx", 0), x->v[1] = num(a, "cy", 0), x->v[2] = num(a, "r", 0);
    else if (tag && strcmp(tag, "ellipse") == 0)
      x->tag = T_ELLIPSE, x->v[0] = num(a, "cx", 0), x->v[1] = num(a, "cy", 0), x->v[2] = num(a, "rx", 0), x->v[3] = num(a, "ry", 0);
    else if (tag && strcmp(tag, "rect") == 0)
      x->tag = T_RECT, x->v[0] = num(a, "x", 0), x->v[1] = num(a, "y", 0), x->v[2] = num(a, "width", 0), x->v[3] = num(a, "height", 0), x->v[4] = num(a, "rx", 0);
    else if (tag && strcmp(tag, "line") == 0)
      x->tag = T_LINE, x->v[0] = num(a, "x1", 0), x->v[1] = num(a, "y1", 0), x->v[2] = num(a, "x2", 0), x->v[3] = num(a, "y2", 0),
      x->v[4] = num(a, "stroke-width", 1) / 2;
    else {
      char q[48];
      snprintf(q, sizeof q, "'%s'", tag ? tag : "");
      refuse(err, err_size, "drawing '%s': shape %s is %s, outside the subset (circle, ellipse, rect, line)", drawing, at, q);
      goto bad;
    }
    x->opacity = x->tag == T_LINE ? num(a, "stroke-opacity", 1) : num(a, "fill-opacity", 1);
    const cJSON *spec = item(a, x->tag == T_LINE ? "stroke" : "fill");
    const char *ps = cJSON_GetStringValue(spec);
    if (!ps || strcmp(ps, "none") == 0) x->fill = FILL_NONE;
    else if (strncmp(ps, "url(#", 5) == 0) {
      char id[32];
      snprintf(id, sizeof id, "%.*s", (int)strlen(ps) - 6 < 31 ? (int)strlen(ps) - 6 : 31, ps + 5);
      x->grad = -1;
      for (int i = 0; i < s->ngrad; i++) if (strcmp(s->grad[i].id, id) == 0) x->grad = i;
      if (x->grad < 0) {
        refuse(err, err_size, "drawing '%s': shape %s paints with url(#%s), which names no gradient", drawing, at, id);
        goto bad;
      }
      x->fill = FILL_GRADIENT;
    } else {
      x->fill = FILL_SOLID;
      if (!colour(&L, ps, x->rgb, err, err_size)) goto bad;
    }
    const cJSON *r;
    cJSON_ArrayForEach(r, item(sh, "rotate")) {
      if (x->nrot >= MAX_ROT) {
        refuse(err, err_size, "drawing '%s': shape %s has more than 4 rotations%s", drawing, at, NULL);
        goto bad;
      }
      rot_t *o = &x->rot[x->nrot++];
      const cJSON *ang = item(r, "angle");
      o->frame = cJSON_IsString(ang) && strcmp(ang->valuestring, "{angle}") == 0;
      if (!o->frame && !cJSON_IsNumber(ang)) {
        refuse(err, err_size, "drawing '%s': shape %s rotates by something that is neither a number nor {angle}%s", drawing, at, NULL);
        goto bad;
      }
      o->a = o->frame ? 0 : ang->valuedouble;
      o->cx = num(r, "cx", 0), o->cy = num(r, "cy", 0);
    }
    s->nshape++;
  }
  return s;
bad:
  omx_scene_free(s);
  return NULL;
}

void omx_scene_free(omx_scene *s) {
  if (!s) return;
  free(s->shapes);
  free(s);
}

double omx_scene_size(const omx_scene *s) { return s->view_box; }

/* ------------------------------------------------------------------------------------- painting */

typedef struct {
  const omx_scene *s;
  const shape_t *sh;
  double ox, oy, k;
  double co[MAX_ROT], si[MAX_ROT];
} pctx;

/* Math.round: half up (the film painter rounds the sine and the cosine to 1e-9 first) */
static double js_round(double v) { return floor(v + 0.5); }
static double round9(double v) { return js_round(v * 1e9) / 1e9; }

/* V8's Math.hypot over two numbers: scaled by the larger, the squares summed with Kahan's compensation, so the last bit is its */
static double js_hypot(double a, double b) {
  double m = fmax(fabs(a), fabs(b));
  if (m == 0) return 0;
  double sum = 0, comp = 0, v[2] = {fabs(a) / m, fabs(b) / m};
  for (int i = 0; i < 2; i++) {
    double summand = v[i] * v[i] - comp;
    double prelim = sum + summand;
    comp = (prelim - sum) - summand;
    sum = prelim;
  }
  return sqrt(sum) * m;
}

/* the sample (sx, sy) of the canvas taken back into the shape's own frame, through its rotations, the innermost last */
static void to_shape(const pctx *p, double sx, double sy, double *ox, double *oy) {
  double x = (sx - p->ox) / p->k, y = (sy - p->oy) / p->k;
  for (int i = 0; i < p->sh->nrot; i++) {
    const rot_t *r = &p->sh->rot[i];
    double dx = x - r->cx, dy = y - r->cy;
    double nx = r->cx + dx * p->co[i] - dy * p->si[i];
    double ny = r->cy + dx * p->si[i] + dy * p->co[i];
    x = nx, y = ny;
  }
  *ox = x, *oy = y;
}

static double clamp01(double v) { return fmin(1, fmax(0, v)); }

static int inside(const void *ctx, double sx, double sy) {
  const pctx *p = ctx;
  const shape_t *s = p->sh;
  double x, y;
  to_shape(p, sx, sy, &x, &y);
  if (s->tag == T_CIRCLE || s->tag == T_ELLIPSE) {
    double rx = s->v[2], ry = s->tag == T_CIRCLE ? s->v[2] : s->v[3];
    double u = (x - s->v[0]) / rx, w = (y - s->v[1]) / ry;
    return u * u + w * w <= 1;
  }
  if (s->tag == T_RECT) {
    double x0 = s->v[0], y0 = s->v[1], w = s->v[2], h = s->v[3], r = s->v[4];
    double qx = fmax(fmax(x0 + r - x, 0), x - (x0 + w - r)), qy = fmax(fmax(y0 + r - y, 0), y - (y0 + h - r));
    return x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h && qx * qx + qy * qy <= r * r;
  }
  double x1 = s->v[0], y1 = s->v[1], dx = s->v[2] - x1, dy = s->v[3] - y1, hw = s->v[4], len2 = dx * dx + dy * dy;
  double t = len2 == 0 ? 0 : fmax(0, fmin(1, ((x - x1) * dx + (y - y1) * dy) / len2));
  double ex = x - x1 - t * dx, ey = y - y1 - t * dy;
  return ex * ex + ey * ey <= hw * hw;
}

/* the shape's own bounding box (x, y, w, h): a gradient follows it */
static void bbox(const shape_t *s, double b[4]) {
  if (s->tag == T_CIRCLE) b[0] = s->v[0] - s->v[2], b[1] = s->v[1] - s->v[2], b[2] = 2 * s->v[2], b[3] = 2 * s->v[2];
  else if (s->tag == T_ELLIPSE) b[0] = s->v[0] - s->v[2], b[1] = s->v[1] - s->v[3], b[2] = 2 * s->v[2], b[3] = 2 * s->v[3];
  else if (s->tag == T_RECT) b[0] = s->v[0], b[1] = s->v[1], b[2] = s->v[2], b[3] = s->v[3];
  else {
    double dx = s->v[2] - s->v[0], dy = s->v[3] - s->v[1], hw = s->v[4];
    b[0] = fmin(s->v[0], s->v[2]) - hw, b[1] = fmin(s->v[1], s->v[3]) - hw, b[2] = fabs(dx) + 2 * hw, b[3] = fabs(dy) + 2 * hw;
  }
}

static void colour_at(const void *ctx, double sx, double sy, double out[4]) {
  const pctx *p = ctx;
  const shape_t *s = p->sh;
  if (s->fill == FILL_SOLID) {
    out[0] = s->rgb[0], out[1] = s->rgb[1], out[2] = s->rgb[2], out[3] = s->opacity;
    return;
  }
  const grad_t *g = &p->s->grad[s->grad];
  double b[4], x, y;
  bbox(s, b);
  to_shape(p, sx, sy, &x, &y);
  double u = (x - b[0]) / b[2], v = (y - b[1]) / b[3], at;
  if (!g->radial) {
    double dx = g->p[2] - g->p[0], dy = g->p[3] - g->p[1];
    at = ((u - g->p[0]) * dx + (v - g->p[1]) * dy) / (dx * dx + dy * dy);
  } else {
    at = js_hypot(u - g->p[0], v - g->p[1]) / g->p[2];
  }
  double t = clamp01(at);
  double w = g->at[1] == g->at[0] ? 0 : clamp01((t - g->at[0]) / (g->at[1] - g->at[0]));
  for (int i = 0; i < 3; i++) out[i] = g->rgb[0][i] + (g->rgb[1][i] - g->rgb[0][i]) * w;
  out[3] = (g->alpha[0] + (g->alpha[1] - g->alpha[0]) * w) * s->opacity;
}

void omx_scene_paint(omx_canvas *c, const omx_scene *s, double ox, double oy, double k, double angle) {
  for (int i = 0; i < s->nshape; i++) {
    const shape_t *sh = &s->shapes[i];
    if (sh->fill == FILL_NONE) continue;
    pctx p = {s, sh, ox, oy, k, {0}, {0}};
    for (int r = 0; r < sh->nrot; r++) {
      double a = sh->rot[r].frame ? angle : sh->rot[r].a;
      double th = (-a * M_PI) / 180;
      p.co[r] = round9(cos(th)), p.si[r] = round9(sin(th));
    }
    /* the shape's own box, carried through its rotations to the canvas (a pixel outside it has no sample inside the shape, so the
     * pixels painted are the same as over the whole frame, only fewer are looked at) */
    double b[4];
    bbox(sh, b);
    double lx = 1e300, ly = 1e300, hx = -1e300, hy = -1e300;
    for (int q = 0; q < 4; q++) {
      double x = b[0] + (q & 1 ? b[2] : 0), y = b[1] + (q & 2 ? b[3] : 0);
      for (int r = sh->nrot - 1; r >= 0; r--) {
        double dx = x - sh->rot[r].cx, dy = y - sh->rot[r].cy;
        double nx = sh->rot[r].cx + dx * p.co[r] + dy * p.si[r];
        double ny = sh->rot[r].cy - dx * p.si[r] + dy * p.co[r];
        x = nx, y = ny;
      }
      x = ox + x * k, y = oy + y * k;
      lx = fmin(lx, x), hx = fmax(hx, x), ly = fmin(ly, y), hy = fmax(hy, y);
    }
    omx_paint(c, fmax(lx - 1, ox), fmax(ly - 1, oy), fmin(hx + 1, ox + s->view_box * k), fmin(hy + 1, oy + s->view_box * k), inside, colour_at, &p);
  }
}
