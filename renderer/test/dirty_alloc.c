/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * dirty_alloc.c — omx_panel_view_draw_dirty short of memory. Linked with -Wl,--wrap=malloc,--wrap=calloc,--wrap=realloc, so every
 * allocation of the library goes through the wrappers below, which fail the n-th one counted from arm().
 *
 * A: the allocations a dirty draw makes before it paints (the layout) are counted on a call that changes nothing, then each is failed in
 *    turn on a call that changes a control: the call must still answer true, with the whole buffer as its one rectangle and the pixels of a
 *    full draw of the same state, and the call after it must be right too.
 * B: the allocations that end a full draw (the layout and what the view keeps to say what the next draw repaints) are failed in turn: the
 *    full draw's pixels are right and the next dirty draw is right (a whole one, the view having kept nothing).
 * Exit 0 all held, 1 a case that was not (named on stderr), 2 usage.
 *   dirty_alloc <description.json> <tools dir>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "omx_panel_render.h"

static size_t calls, fail_at;
static int armed;
void *__real_malloc(size_t n);
void *__real_calloc(size_t a, size_t b);
void *__real_realloc(void *p, size_t n);
static int fails(void) { return armed && ++calls == fail_at; }
void *__wrap_malloc(size_t n) { return fails() ? NULL : __real_malloc(n); }
void *__wrap_calloc(size_t a, size_t b) { return fails() ? NULL : __real_calloc(a, b); }
void *__wrap_realloc(void *p, size_t n) { return fails() ? NULL : __real_realloc(p, n); }
static void arm(size_t n) { calls = 0, fail_at = n, armed = 1; }
static size_t disarm(void) { armed = 0; return calls; }

#define W 600
#define H 420
static const char *desc, *data;

static omx_panel_view_t *make(void) {
  char err[256];
  omx_panel_view_t *v = omx_panel_view_create_from_files(desc, data, err, sizeof err);
  if (!v) { fprintf(stderr, "dirty_alloc: %s\n", err); exit(2); }
  omx_panel_view_set_title(v, "brand", "name");
  return v;
}
static omx_panel_buffer_t buffer(void) { return (omx_panel_buffer_t){calloc(W * H, 4), W, H, W * 4, 1, OMX_PANEL_PIXEL_RGBA8_PREMULTIPLIED}; }
static void change(omx_panel_view_t *v, int step) {
  char text[16];
  snprintf(text, sizeof text, "v%d", step);
  omx_panel_view_set_value(v, 0, step % 2 ? 0.8 : 0.2, text);
}
/* the pixels a view made anew draws of the state after `steps` changes */
static omx_panel_buffer_t reference(int steps) {
  omx_panel_view_t *v = make();
  omx_panel_buffer_t b = buffer();
  for (int k = 1; k <= steps; k++) change(v, k);
  omx_panel_view_draw(v, &b);
  omx_panel_view_destroy(v);
  return b;
}
static int same(const omx_panel_buffer_t *a, const omx_panel_buffer_t *b) { return !memcmp(a->pixels, b->pixels, (size_t)W * H * 4); }

static int fail(const char *what, size_t at) {
  fprintf(stderr, "dirty_alloc: %s, allocation %zu failed: not held\n", what, at);
  return 1;
}

int main(int argc, char **argv) {
  if (argc != 3) return 2;
  desc = argv[1], data = argv[2];
  omx_panel_buffer_t ref0 = reference(0), ref1 = reference(1), ref2 = reference(2);
  /* A: how many allocations does a call that changes nothing make? */
  omx_panel_view_t *v = make();
  omx_panel_buffer_t b = buffer();
  omx_panel_rect_t rects[8];
  size_t k = 0;
  omx_panel_view_draw(v, &b);
  arm(0);
  if (!omx_panel_view_draw_dirty(v, &b, rects, 8, &k) || k != 0) return fail("a call that changes nothing", 0);
  size_t layout = disarm();
  if (layout < 2) { fputs("dirty_alloc: the layout made no allocation to fail\n", stderr); return 1; }
  omx_panel_view_destroy(v), free(b.pixels);
  for (size_t j = 1; j <= layout; j++) {
    v = make(), b = buffer();
    omx_panel_view_draw(v, &b);
    change(v, 1);
    arm(j);
    int ok = omx_panel_view_draw_dirty(v, &b, rects, 8, &k);
    disarm();
    if (!ok) return fail("the dirty draw answered false", j);
    if (k != 1 || rects[0].x || rects[0].y || rects[0].width != W || rects[0].height != H) return fail("the draw did not report the whole buffer", j);
    if (!same(&b, &ref1)) return fail("the pixels are not a full draw's", j);
    change(v, 2);
    if (!omx_panel_view_draw_dirty(v, &b, rects, 8, &k) || !same(&b, &ref2)) return fail("the draw after it is not right", j);
    omx_panel_view_destroy(v), free(b.pixels);
  }
  /* B: the allocations at the end of a full draw */
  v = make(), b = buffer();
  arm(0);
  omx_panel_view_draw(v, &b);
  size_t total = disarm();
  omx_panel_view_destroy(v), free(b.pixels);
  for (size_t j = 0; j < layout + 2; j++) {
    v = make(), b = buffer();
    arm(total - j);
    int ok = omx_panel_view_draw(v, &b);
    disarm();
    if (!ok || !same(&b, &ref0)) return fail("the full draw answered false", total - j);
    change(v, 1);
    if (!omx_panel_view_draw_dirty(v, &b, rects, 8, &k) || !same(&b, &ref1)) return fail("the dirty draw after a full draw short of memory is not right", total - j);
    omx_panel_view_destroy(v), free(b.pixels);
  }
  free(ref0.pixels), free(ref1.pixels), free(ref2.pixels);
  printf("held: %zu layout allocations, %zu in a full draw\n", layout, total);
  return 0;
}
