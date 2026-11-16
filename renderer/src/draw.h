/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * draw.h — the primitives a backend gives the view: a rounded rectangle, a disc, a round-capped segment, the gradient
 * area under a polyline and a line of text, in device px with straight colours. The CPU raster is one backend (view.c, a buffer), NanoVG the other
 * (window.c, a window); the layout and the widgets are view.c's, once. Internal.
 */
#ifndef OMX_PANEL_DRAW_H
#define OMX_PANEL_DRAW_H

#include "omx_panel_render.h"
#include "raster.h"

typedef struct omx_draw {
  void *ctx;
  void (*round_rect)(void *ctx, double x, double y, double w, double h, double r, omx_rgb rgb);
  void (*disc)(void *ctx, double cx, double cy, double r, omx_rgb rgb);
  void (*segment)(void *ctx, double ax, double ay, double bx, double by, double hw, omx_rgb rgb);
  /* the area under a polyline (`xs` ascending) down to `base_y`, painted in a vertical gradient: `nstops` colours at the
   * fractions `t` (ascending, 0..1) of the span y0..y1, held flat beyond it, laid at `alpha` */
  void (*fill_under)(void *ctx, const double *xs, const double *ys, size_t n, double base_y, double y0, double y1, const double *t,
                     const omx_rgb *stops, size_t nstops, double alpha);
  /* `cps` already cut to fit; `x` the left edge, the centre or the right edge by `align`, `y` the baseline */
  void (*text)(void *ctx, omx_font *f, const uint32_t *cps, size_t n, double x, double y, double px, omx_rgb rgb, omx_align align);
} omx_draw;

/* The panel through `d`, laid out for a box of width x height device px at `scale`. */
void omx_panel_view_paint(const omx_panel_view_t *v, uint32_t width, uint32_t height, double scale, const omx_draw *d);
/* The same, repainting only what can reach the clip (x0, y0, x1, y1 in device px; NULL for the whole panel): the elements it cannot reach are
 * not drawn at all, the others are drawn whole and the backend's own clip cuts them. */
void omx_panel_view_paint_clip(const omx_panel_view_t *v, uint32_t width, uint32_t height, double scale, const omx_draw *d, const int *clip);
omx_font *omx_panel_view_font(const omx_panel_view_t *v);
/* The font file's bytes, as loaded. */
const uint8_t *omx_font_bytes(const omx_font *f, size_t *size);

#endif
