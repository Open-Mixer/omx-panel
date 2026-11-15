/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * raster.h — the renderer's drawing primitives over a plain pixel buffer, and the TrueType reader its
 * text needs. Internal: the public surface is omx_panel_render.h.
 */
#ifndef OMX_PANEL_RASTER_H
#define OMX_PANEL_RASTER_H

#include <stddef.h>
#include <stdint.h>

typedef struct omx_canvas {
  uint8_t *px;
  int w, h;
  size_t stride;
  int bgra; /* 1: B, G, R, A in memory; 0: R, G, B, A */
} omx_canvas;

typedef struct omx_rgb {
  uint8_t c[3];
} omx_rgb;

/** Rounds half up, as the MOD GUI's raster does, so the two agree to the bit. */
double omx_round(double v);
double omx_snap(double v);

void omx_round_rect(omx_canvas *c, double x, double y, double w, double h, double r, omx_rgb rgb);
void omx_disc(omx_canvas *c, double cx, double cy, double r, omx_rgb rgb);
void omx_segment(omx_canvas *c, double ax, double ay, double bx, double by, double hw, omx_rgb rgb);
/** Whether the sample (px, py) is inside a shape, and the colour a pixel's centre takes (R, G, B in 0..255, A in 0..1). */
typedef int (*omx_inside_fn)(const void *ctx, double px, double py);
typedef void (*omx_colour_fn)(const void *ctx, double px, double py, double rgba[4]);
/** Fill every pixel of the box by the fraction of its SSxSS samples `inside` accepts, each pixel coloured by `colour` at its centre
 * (the colour rounded, its alpha times the coverage): tools/raster.mjs paint(), to the bit. The scenes of scene.c are painted with it. */
void omx_paint(omx_canvas *c, double bx0, double by0, double bx1, double by1, omx_inside_fn inside, omx_colour_fn colour, const void *ctx);
/** The area under the polyline (xs ascending) down to base_y, in the vertical gradient of `nstops` colours at the fractions `t`
 * of y0..y1 (flat beyond), laid at `alpha`; supersampled as the shapes are. */
void omx_fill_under(omx_canvas *c, const double *xs, const double *ys, size_t n, double base_y, double y0, double y1, const double *t,
                    const omx_rgb *stops, size_t nstops, double alpha);
/** The strip between the segment (ax, a0)-(bx, b0) and the segment (ax, a1)-(bx, b1) over [ax, bx], in `rgb` laid at `alpha`;
 * supersampled as the shapes are. */
void omx_strip(omx_canvas *c, double ax, double bx, double a0, double a1, double b0, double b1, omx_rgb rgb, double alpha);

/* ------------------------------------------------------------------------------------- text */

typedef struct omx_font omx_font;

/** A font read from TrueType bytes (copied), or NULL with the reason in `err`. */
omx_font *omx_font_load(const uint8_t *bytes, size_t size, char *err, size_t err_size);
void omx_font_free(omx_font *f);

/** Text is UTF-8; `cps`/`n` a decoded run of code points. */
size_t omx_utf8_decode(const char *s, uint32_t **out);
double omx_text_width(omx_font *f, const uint32_t *cps, size_t n, double px);
/** `cps` cut to fit `max_w`, with ".." for what was dropped; whole when it fits. Returns the new
 * length (the run is rewritten in place and must have room for two more code points). */
size_t omx_fit_text(omx_font *f, uint32_t *cps, size_t n, double px, double max_w);

typedef enum { OMX_ALIGN_LEFT, OMX_ALIGN_CENTRE, OMX_ALIGN_RIGHT } omx_align;
void omx_draw_text(omx_canvas *c, omx_font *f, const uint32_t *cps, size_t n, double x, double y, double px, omx_rgb rgb,
                   omx_align align);

#endif
