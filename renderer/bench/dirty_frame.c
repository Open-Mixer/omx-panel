/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * dirty_frame.c — the renderer's share of one drag frame: the same control moved 1000 times, each frame drawn in full
 * (omx_panel_view_draw) and, from the same state, drawn dirty (omx_panel_view_draw_dirty), into a buffer of the same pixels
 * (1024 x 416, the size schema/frame-budget.json declares). Prints p50, p99 and max of each, in ms, the pixels the dirty draws
 * repainted, and exits 1 if the two buffers differ at the end. The budget's own p99 covers the host's conversion and blit as
 * well, which this does not measure: it is the draw's share of it.
 *   dirty_frame <description.json> <tools dir> [control symbol or index (default 0)] [frames (default 1000)]
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "omx_panel_render.h"

static double now_ms(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (double)t.tv_sec * 1e3 + (double)t.tv_nsec / 1e6;
}
static int cmp(const void *a, const void *b) {
  double x = *(const double *)a, y = *(const double *)b;
  return x < y ? -1 : x > y;
}
static void report(const char *what, double *ms, int n) {
  qsort(ms, (size_t)n, sizeof *ms, cmp);
  printf("%-6s p50 %.3f ms  p99 %.3f ms  max %.3f ms\n", what, ms[n / 2], ms[(int)((double)n * 0.99)], ms[n - 1]);
}

int main(int argc, char **argv) {
  if (argc < 3) return 2;
  char err[256];
  omx_panel_view_t *v = omx_panel_view_create_from_files(argv[1], argv[2], err, sizeof err);
  if (!v) { fprintf(stderr, "dirty_frame: %s\n", err); return 2; }
  int32_t ctl = argc > 3 ? omx_panel_view_find(v, argv[3]) : 0;
  if (ctl < 0) ctl = (int32_t)strtol(argv[3], NULL, 10);
  int n = argc > 4 ? atoi(argv[4]) : 1000;
  const uint32_t w = 1024, h = 416;
  omx_panel_buffer_t full = {calloc((size_t)w * h, 4), w, h, w * 4, 1, OMX_PANEL_PIXEL_BGRA8_PREMULTIPLIED}, dirty = full;
  dirty.pixels = calloc((size_t)w * h, 4);
  double *tf = malloc((size_t)n * sizeof *tf), *td = malloc((size_t)n * sizeof *td);
  omx_panel_rect_t rects[16];
  size_t k = 0, px = 0;
  char text[32];
  omx_panel_view_set_title(v, "brand", "name");
  omx_panel_view_draw(v, &full);
  for (int i = 0; i < n; i++) {
    snprintf(text, sizeof text, "%.1f", i * 0.1);
    omx_panel_view_set_value(v, (uint32_t)ctl, (double)(i % 100) / 100, text);
    double a = now_ms();
    omx_panel_view_draw(v, &full);
    tf[i] = now_ms() - a;
  }
  omx_panel_view_draw_dirty(v, &dirty, rects, 16, &k); /* the first frame: whole */
  for (int i = 0; i < n; i++) {
    snprintf(text, sizeof text, "%.1f", i * 0.1);
    omx_panel_view_set_value(v, (uint32_t)ctl, (double)(i % 100) / 100, text);
    double a = now_ms();
    omx_panel_view_draw_dirty(v, &dirty, rects, 16, &k);
    td[i] = now_ms() - a;
    px = 0;
    for (size_t j = 0; j < k; j++) px += (size_t)rects[j].width * rects[j].height;
  }
  printf("%u x %u, %d frames, control %d\n", w, h, n, ctl);
  report("full", tf, n);
  report("dirty", td, n);
  printf("dirty frame repaints %zu of %u px (%zu rectangle%s)\n", px, w * h, k, k == 1 ? "" : "s");
  int same = !memcmp(full.pixels, dirty.pixels, (size_t)w * h * 4);
  printf("final buffers %s\n", same ? "equal" : "DIFFER");
  return same ? 0 : 1;
}
