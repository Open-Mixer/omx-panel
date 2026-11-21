/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * ui_window_driver — omx_panel_ui.h's window, under a display (xvfb-run), for test/ui-window.test.mjs. Built with WINDOW=1.
 *   ui_window_driver <layout.json> <data dir> <case.json>
 * Opens a window of its own for the case's parameters, shows it, reads two frames, one with parameter 0 at its minimum and one at its maximum,
 * and prints `natural W H`, `size W H` (the window's), `opaque N` (pixels the first frame drew), `changed N` (pixels that differ between the two
 * frames), `native 0|1` (the window has a native handle) and `closed 1` once it is closed and destroyed.
 */
#include <unistd.h>

#include "ui_case.h"

static void settle(omx_panel_ui_t *ui) {
  for (int i = 0; i < 20; i++) {
    omx_panel_ui_idle(ui, i * 10.0);
    usleep(10000);
  }
}

int main(int argc, char **argv) {
  if (argc != 4) { fprintf(stderr, "usage: ui_window_driver <layout.json> <data dir> <case.json>\n"); return 2; }
  char *layout = slurp(argv[1]), *text = slurp(argv[3]);
  cJSON *root = text ? cJSON_Parse(text) : NULL;
  if (!layout || !root) { fprintf(stderr, "ui_window_driver: cannot read the layout or the case\n"); return 2; }
  size_t n;
  omx_panel_ui_param_t *params = case_params(root, &n);
  char err[256] = "";
  omx_panel_ui_t *ui = omx_panel_ui_create(layout, argv[2], params, n, NULL, err, sizeof err);
  if (!ui) { fprintf(stderr, "ui_window_driver: %s\n", err); return 1; }
  if (!omx_panel_ui_open(ui, 0, 1.0, err, sizeof err)) { fprintf(stderr, "ui_window_driver: %s\n", err); return 1; }
  uint32_t nw, nh, w, h;
  omx_panel_ui_natural_size(ui, &nw, &nh);
  printf("natural %u %u\n", nw, nh);
  if (!omx_panel_ui_show(ui)) { fprintf(stderr, "ui_window_driver: show failed\n"); return 1; }
  settle(ui);
  omx_panel_ui_window_size(ui, &w, &h);
  printf("size %u %u\n", w, h);
  printf("native %d\n", omx_panel_ui_native(ui) != 0);
  uint8_t *a = calloc((size_t)w * h, 4), *b = calloc((size_t)w * h, 4);
  omx_panel_buffer_t ba = {a, w, h, w * 4, 1.0, OMX_PANEL_PIXEL_RGBA8_STRAIGHT}, bb = ba;
  bb.pixels = b;
  omx_panel_ui_set_value(ui, 0, params[0].min);
  int ok = omx_panel_ui_window_read(ui, &ba);
  omx_panel_ui_set_value(ui, 0, params[0].max);
  ok = omx_panel_ui_window_read(ui, &bb) && ok;
  size_t opaque = 0, changed = 0;
  for (size_t i = 0; ok && i < (size_t)w * h; i++) {
    if (a[i * 4 + 3]) opaque++;
    if (memcmp(a + i * 4, b + i * 4, 4)) changed++;
  }
  printf("read %d\nopaque %zu\nchanged %zu\n", ok, opaque, changed);
  omx_panel_ui_destroy(ui);
  printf("closed 1\n");
  return 0;
}
