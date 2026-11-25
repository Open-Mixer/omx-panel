/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * ui_driver — omx_panel_ui.h with no window, for test/ui.test.mjs.
 *   ui_driver <layout.json> <data dir> <case.json>
 * The case: {"params": [{"symbol","unit","min","max","def","step","has_def","log","integer","read_only","labels"}], "steps": [...]}, each step
 *   {"set": [param, value]}                       the host reads a value
 *   {"drag": param, "dy": px}                     a mouse press in the control's target, a move of dy px (negative is up), a release
 *   {"wheel": param, "n": notches}                a wheel over the control
 *   {"read": param}                               the view's reading of the control
 *   {"target": param}                             where the control takes a press
 *   {"pressat": [x, y], "dy": px}                 a press at a place of the panel, a move of dy px, a release
 * and prints one line a call the host is told ("begin p", "set p value", "end p"), "told n" after a drag or a wheel, "set-ok p 0|1"
 * after a set, and "read p fraction value" after a read.
 */
#include "ui_case.h"

static void on_begin(void *u, uint32_t p) { (void)u; printf("begin %u\n", p); }
static void on_set(void *u, uint32_t p, double v) { (void)u; printf("set %u %.9g\n", p, v); }
static void on_end(void *u, uint32_t p) { (void)u; printf("end %u\n", p); }

int main(int argc, char **argv) {
  if (argc != 4) { fprintf(stderr, "usage: ui_driver <layout.json> <data dir> <case.json>\n"); return 2; }
  char *layout = slurp(argv[1]), *text = slurp(argv[3]);
  cJSON *root = text ? cJSON_Parse(text) : NULL;
  if (!layout || !root) { fprintf(stderr, "ui_driver: cannot read the layout or the case\n"); return 2; }
  size_t n;
  omx_panel_ui_param_t *params = case_params(root, &n);
  omx_panel_ui_host_t host = {NULL, on_begin, on_set, on_end};
  char err[256] = "";
  omx_panel_ui_t *ui = omx_panel_ui_create(layout, argv[2], params, n, &host, err, sizeof err);
  if (!ui) { fprintf(stderr, "ui_driver: %s\n", err); return 1; }
  const cJSON *st;
  double t = 0;
  cJSON_ArrayForEach(st, cJSON_GetObjectItemCaseSensitive(root, "steps")) {
    const cJSON *set = cJSON_GetObjectItemCaseSensitive(st, "set"), *read = cJSON_GetObjectItemCaseSensitive(st, "read"),
                *drag = cJSON_GetObjectItemCaseSensitive(st, "drag"), *wheel = cJSON_GetObjectItemCaseSensitive(st, "wheel");
    if (cJSON_IsArray(set)) {
      uint32_t pi = (uint32_t)cJSON_GetArrayItem(set, 0)->valuedouble;
      printf("set-ok %u %d\n", pi, omx_panel_ui_set_value(ui, pi, cJSON_GetArrayItem(set, 1)->valuedouble) ? 1 : 0);
    } else if (cJSON_IsNumber(read)) {
      uint32_t pi = (uint32_t)read->valuedouble;
      double f = -1, v = -1;
      bool ok = omx_panel_ui_reading(ui, pi, &f, &v);
      printf("read %u %d %.9g %.9g\n", pi, ok ? 1 : 0, f, v);
    } else if (cJSON_IsNumber(cJSON_GetObjectItemCaseSensitive(st, "target"))) {
      uint32_t pi = (uint32_t)cJSON_GetObjectItemCaseSensitive(st, "target")->valuedouble;
      double r[4], travel;
      bool ok = omx_panel_ui_target_rect(ui, pi, r, &travel);
      printf("target %u %d %.9g %.9g %.9g %.9g %.9g\n", pi, ok ? 1 : 0, ok ? r[0] : 0, ok ? r[1] : 0, ok ? r[2] : 0, ok ? r[3] : 0, ok ? travel : 0);
    } else if (cJSON_IsArray(cJSON_GetObjectItemCaseSensitive(st, "pressat"))) {
      /* a press at a place of the panel, whatever control is there: what a pointer does */
      const cJSON *at = cJSON_GetObjectItemCaseSensitive(st, "pressat");
      double x = cJSON_GetArrayItem(at, 0)->valuedouble, y = cJSON_GetArrayItem(at, 1)->valuedouble, dy = num(st, "dy", -30);
      size_t told = 0;
      omx_panel_event_t e = {0};
      e.type = OMX_PANEL_POINTER_MOUSE, e.control = -1, e.kind = OMX_PANEL_EVENT_DOWN, e.x = x, e.y = y, e.t_ms = t += 20;
      told += omx_panel_ui_event(ui, &e);
      for (int k = 1; k <= 3; k++) {
        e.kind = OMX_PANEL_EVENT_MOVE, e.y = y + dy * k / 3, e.t_ms = t += 20;
        told += omx_panel_ui_event(ui, &e);
      }
      e.kind = OMX_PANEL_EVENT_UP, e.t_ms = t += 20;
      told += omx_panel_ui_event(ui, &e);
      printf("told %zu\n", told);
    } else if (cJSON_IsNumber(drag) || cJSON_IsNumber(wheel)) {
      uint32_t pi = (uint32_t)(cJSON_IsNumber(drag) ? drag : wheel)->valuedouble;
      double r[4], travel;
      if (!omx_panel_ui_target_rect(ui, pi, r, &travel)) { printf("no-target %u\n", pi); continue; }
      double x = r[0] + r[2] / 2, y = r[1] + r[3] / 2;
      size_t told = 0;
      omx_panel_event_t e = {0};
      e.type = OMX_PANEL_POINTER_MOUSE, e.control = -1;
      if (cJSON_IsNumber(drag)) {
        double dy = num(st, "dy", -30);
        e.kind = OMX_PANEL_EVENT_DOWN, e.x = x, e.y = y, e.t_ms = t += 20;
        told += omx_panel_ui_event(ui, &e);
        for (int k = 1; k <= 3; k++) {
          e.kind = OMX_PANEL_EVENT_MOVE, e.y = y + dy * k / 3, e.t_ms = t += 20;
          told += omx_panel_ui_event(ui, &e);
        }
        e.kind = OMX_PANEL_EVENT_UP, e.t_ms = t += 20;
        told += omx_panel_ui_event(ui, &e);
      } else {
        e.kind = OMX_PANEL_EVENT_WHEEL, e.x = x, e.y = y, e.n = (int32_t)num(st, "n", 1), e.t_ms = t += 20;
        told += omx_panel_ui_event(ui, &e);
      }
      printf("told %zu\n", told);
    }
  }
  omx_panel_ui_destroy(ui);
  return 0;
}
