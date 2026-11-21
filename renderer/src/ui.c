/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * ui.c — omx_panel_ui.h: a panel view bound to a plugin's parameters, and, built with the window, a window over it. The
 * binding is the whole of this file: which control a parameter drives, its travel, the text of a value, and the host told
 * of a gesture's value, begin and end. The drawing and the gestures are the view's (view.c, input.c).
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "omx_panel_ui.h"

/* the installed tools directory (the Makefile gives it): the look, the geometry and the font */
#ifndef OMX_PANEL_DATA_DIR
#define OMX_PANEL_DATA_DIR "/usr/share/omx-panel/tools"
#endif
#ifdef OMX_PANEL_WINDOW
#include "omx_panel_window.h"
#endif

#define CHANGES 64
#define NO_GESTURE UINT32_MAX

typedef struct {
  char *symbol, *unit;
  omx_panel_ui_param_t p; /* its symbol, unit and labels point into the copies below */
  char **labels;
  int32_t control; /* the control of the view this parameter drives, -1 for none */
} bound;

struct omx_panel_ui {
  omx_panel_view_t *view;
  omx_panel_ui_host_t host;
  bound *params;
  size_t n;
  int32_t *param_of; /* control -> parameter, -1 for none */
  size_t ncontrols;
  uint32_t open_gesture, open_param; /* the gesture the host was told `begin` of, NO_GESTURE for none */
  double scale;
#ifdef OMX_PANEL_WINDOW
  omx_panel_window_t *window;
#endif
};

static char *dup(const char *s) {
  size_t n = strlen(s ? s : "") + 1;
  char *d = malloc(n);
  if (d) memcpy(d, s ? s : "", n);
  return d;
}

static void fail(char *err, size_t n, const char *msg) {
  if (err && n) snprintf(err, n, "%s", msg);
}

omx_panel_ui_t *omx_panel_ui_create(const char *layout_json, const char *data_dir, const omx_panel_ui_param_t *params, size_t nparams,
                                    const omx_panel_ui_host_t *host, char *err, size_t err_size) {
  if (!data_dir) data_dir = OMX_PANEL_DATA_DIR;
  if (!layout_json || (nparams && !params)) { fail(err, err_size, "ui: no layout, or parameters named and none given"); return NULL; }
  omx_panel_view_t *view = omx_panel_view_create_from_data(layout_json, data_dir, err, err_size);
  if (!view) return NULL;
  struct omx_panel_ui *ui = calloc(1, sizeof *ui);
  if (!ui) { omx_panel_view_destroy(view); return NULL; }
  ui->view = view, ui->scale = 1, ui->open_gesture = NO_GESTURE;
  if (host) ui->host = *host;
  ui->n = nparams, ui->ncontrols = omx_panel_view_count(view);
  ui->params = calloc(nparams ? nparams : 1, sizeof *ui->params);
  ui->param_of = malloc((ui->ncontrols ? ui->ncontrols : 1) * sizeof *ui->param_of);
  if (!ui->params || !ui->param_of) { omx_panel_ui_destroy(ui); return NULL; }
  for (size_t c = 0; c < ui->ncontrols; c++) ui->param_of[c] = -1;
  uint32_t w, h;
  omx_panel_view_natural_size(view, &w, &h);
  omx_panel_view_set_surface(view, w, h, 1);
  for (size_t i = 0; i < nparams; i++) {
    bound *b = &ui->params[i];
    b->p = params[i];
    b->symbol = dup(params[i].symbol), b->unit = dup(params[i].unit);
    b->p.symbol = b->symbol, b->p.unit = b->unit;
    b->labels = calloc(params[i].nlabels ? params[i].nlabels : 1, sizeof *b->labels);
    for (size_t k = 0; b->labels && k < params[i].nlabels; k++) b->labels[k] = dup(params[i].labels[k]);
    b->p.labels = (const char *const *)b->labels;
    b->control = omx_panel_view_find(view, params[i].symbol);
    if (b->control < 0) continue;
    ui->param_of[b->control] = (int32_t)i;
    omx_panel_travel_t t = {params[i].min, params[i].max, params[i].def, params[i].step, params[i].has_def, params[i].log, params[i].integer};
    omx_panel_view_set_travel(view, (uint32_t)b->control, &t);
    omx_panel_view_set_read_only(view, (uint32_t)b->control, params[i].read_only);
  }
  /* a control no parameter drives (a meter, a display's frame) takes no gesture */
  for (size_t c = 0; c < ui->ncontrols; c++)
    if (ui->param_of[c] < 0) omx_panel_view_set_read_only(view, (uint32_t)c, true);
  return ui;
}

void omx_panel_ui_destroy(omx_panel_ui_t *ui) {
  if (!ui) return;
  omx_panel_ui_close(ui);
  for (size_t i = 0; ui->params && i < ui->n; i++) {
    free(ui->params[i].symbol), free(ui->params[i].unit);
    for (size_t k = 0; ui->params[i].labels && k < ui->params[i].p.nlabels; k++) free(ui->params[i].labels[k]);
    free(ui->params[i].labels);
  }
  free(ui->params), free(ui->param_of);
  omx_panel_view_destroy(ui->view);
  free(ui);
}

void omx_panel_ui_set_title(omx_panel_ui_t *ui, const char *brand, const char *name) {
  if (ui) omx_panel_view_set_title(ui->view, brand, name);
}

void omx_panel_ui_natural_size(const omx_panel_ui_t *ui, uint32_t *width, uint32_t *height) {
  uint32_t w = 0, h = 0;
  if (ui) omx_panel_view_natural_size(ui->view, &w, &h);
  if (width) *width = w;
  if (height) *height = h;
}

/* what the control shows beside a value: a step's label, else the number and its unit */
static void text_of(const bound *b, double value, char *out, size_t n) {
  long at = lround(value - b->p.min);
  if (b->p.integer && b->p.labels && at >= 0 && (size_t)at < b->p.nlabels && b->p.labels[at]) snprintf(out, n, "%s", b->p.labels[at]);
  else snprintf(out, n, "%.4g%s%s", value, b->p.unit && b->p.unit[0] ? " " : "", b->p.unit ? b->p.unit : "");
}

static double fraction_of(const bound *b, double value) {
  double lo = b->p.min, hi = b->p.max;
  if (!(hi > lo)) return 0;
  if (b->p.log && lo > 0 && value > 0) return log(value / lo) / log(hi / lo);
  return (value - lo) / (hi - lo);
}

bool omx_panel_ui_set_value(omx_panel_ui_t *ui, uint32_t param, double value) {
  if (!ui || param >= ui->n || value != value) return false;
  const bound *b = &ui->params[param];
  if (b->control < 0) return false;
  char text[96];
  text_of(b, value, text, sizeof text);
  if (b->p.integer) omx_panel_view_set_integer(ui->view, b->p.symbol, (int64_t)lround(value)); /* a governing control; others refuse */
  double count = b->p.max - b->p.min + 1;
  if (b->p.integer && count >= 2 && count <= 1024) {
    long at = lround(value - b->p.min);
    if (at < 0) at = 0;
    if (at > (long)count - 1) at = (long)count - 1;
    if (omx_panel_view_set_choice(ui->view, (uint32_t)b->control, (uint32_t)at, (uint32_t)count, text)) return true;
  }
  return omx_panel_view_set_value(ui->view, (uint32_t)b->control, fraction_of(b, value), text);
}

bool omx_panel_ui_reading(const omx_panel_ui_t *ui, uint32_t param, double *fraction, double *value) {
  if (!ui || param >= ui->n || ui->params[param].control < 0) return false;
  double f, v;
  if (!omx_panel_view_reading(ui->view, (uint32_t)ui->params[param].control, &f, &v)) return false;
  if (fraction) *fraction = f;
  if (value) *value = v;
  return true;
}

bool omx_panel_ui_target_rect(const omx_panel_ui_t *ui, uint32_t param, double rect[4], double *travel_px) {
  if (!ui || param >= ui->n || ui->params[param].control < 0) return false;
  return omx_panel_view_target_rect(ui->view, (uint32_t)ui->params[param].control, rect, travel_px);
}

bool omx_panel_ui_set_meter(omx_panel_ui_t *ui, const char *symbol, double value, double elapsed) {
  if (!ui) return false;
  int32_t m = omx_panel_view_meter_find(ui->view, symbol);
  return m >= 0 && omx_panel_view_set_meter(ui->view, (uint32_t)m, value, elapsed);
}

/* tell the host what a call changed, with the gesture's begin before its first value and its end after the release */
static size_t dispatch(omx_panel_ui_t *ui, const omx_panel_change_t *ch, size_t n, const omx_panel_answer_t *a) {
  size_t told = 0;
  for (size_t i = 0; i < n; i++) {
    int32_t p = ch[i].control < ui->ncontrols ? ui->param_of[ch[i].control] : -1;
    if (p < 0) continue;
    if (a->gesture && a->gesture != ui->open_gesture) {
      if (ui->open_gesture != NO_GESTURE && ui->host.end) ui->host.end(ui->host.user, ui->open_param);
      ui->open_gesture = a->gesture, ui->open_param = (uint32_t)p;
      if (ui->host.begin) ui->host.begin(ui->host.user, (uint32_t)p);
    }
    if (ui->host.set) ui->host.set(ui->host.user, (uint32_t)p, ch[i].value);
    told++;
  }
  if (a->ended && ui->open_gesture != NO_GESTURE) {
    if (ui->host.end) ui->host.end(ui->host.user, ui->open_param);
    ui->open_gesture = NO_GESTURE;
  }
  return told;
}

size_t omx_panel_ui_event(omx_panel_ui_t *ui, const omx_panel_event_t *event) {
  if (!ui || !event) return 0;
  omx_panel_change_t ch[CHANGES];
  omx_panel_answer_t a = {0};
  size_t n = omx_panel_view_input(ui->view, event, ch, CHANGES, &a);
  return dispatch(ui, ch, n, &a);
}

size_t omx_panel_ui_tick(omx_panel_ui_t *ui, double now_ms) {
  if (!ui) return 0;
  omx_panel_change_t ch[CHANGES];
  omx_panel_answer_t a = {0};
  size_t n = omx_panel_view_tick(ui->view, now_ms, ch, CHANGES, &a);
  return dispatch(ui, ch, n, &a);
}

bool omx_panel_ui_draw(omx_panel_ui_t *ui, const omx_panel_buffer_t *buffer) {
  return ui && omx_panel_view_draw(ui->view, buffer);
}

#ifdef OMX_PANEL_WINDOW
static void window_input(void *user, const omx_panel_event_t *event) { omx_panel_ui_event(user, event); }

bool omx_panel_ui_open(omx_panel_ui_t *ui, uintptr_t parent, double scale, char *err, size_t err_size) {
  if (!ui || ui->window) { fail(err, err_size, "ui: none, or its window is already open"); return false; }
  uint32_t w, h;
  omx_panel_view_natural_size(ui->view, &w, &h);
  omx_panel_view_set_surface(ui->view, w, h, scale > 0 ? scale : 1);
  ui->window = omx_panel_window_create(ui->view, parent, scale, err, err_size);
  if (!ui->window) return false;
  ui->scale = scale;
  omx_panel_window_set_input(ui->window, window_input, ui);
  return true;
}

void omx_panel_ui_close(omx_panel_ui_t *ui) {
  if (!ui || !ui->window) return;
  omx_panel_window_destroy(ui->window);
  ui->window = NULL;
}

bool omx_panel_ui_show(omx_panel_ui_t *ui) { return ui && ui->window && omx_panel_window_show(ui->window); }
bool omx_panel_ui_hide(omx_panel_ui_t *ui) { return ui && ui->window && omx_panel_window_hide(ui->window); }

void omx_panel_ui_idle(omx_panel_ui_t *ui, double now_ms) {
  if (!ui || !ui->window) return;
  omx_panel_window_idle(ui->window);
  omx_panel_ui_tick(ui, now_ms);
  omx_panel_window_redraw(ui->window);
}

void omx_panel_ui_window_size(const omx_panel_ui_t *ui, uint32_t *width, uint32_t *height) {
  uint32_t w = 0, h = 0;
  if (ui && ui->window) omx_panel_window_size(ui->window, &w, &h);
  if (width) *width = w;
  if (height) *height = h;
}

uintptr_t omx_panel_ui_native(const omx_panel_ui_t *ui) { return ui && ui->window ? omx_panel_window_native(ui->window) : 0; }

bool omx_panel_ui_window_read(omx_panel_ui_t *ui, const omx_panel_buffer_t *buffer) {
  return ui && ui->window && omx_panel_window_read(ui->window, buffer);
}
#else
bool omx_panel_ui_open(omx_panel_ui_t *ui, uintptr_t parent, double scale, char *err, size_t err_size) {
  (void)ui, (void)parent, (void)scale;
  fail(err, err_size, "ui: built without the window (make WINDOW=1)");
  return false;
}
void omx_panel_ui_close(omx_panel_ui_t *ui) { (void)ui; }
bool omx_panel_ui_show(omx_panel_ui_t *ui) { (void)ui; return false; }
bool omx_panel_ui_hide(omx_panel_ui_t *ui) { (void)ui; return false; }
void omx_panel_ui_idle(omx_panel_ui_t *ui, double now_ms) { (void)ui, (void)now_ms; }
void omx_panel_ui_window_size(const omx_panel_ui_t *ui, uint32_t *width, uint32_t *height) {
  (void)ui;
  if (width) *width = 0;
  if (height) *height = 0;
}
uintptr_t omx_panel_ui_native(const omx_panel_ui_t *ui) { (void)ui; return 0; }
bool omx_panel_ui_window_read(omx_panel_ui_t *ui, const omx_panel_buffer_t *buffer) { (void)ui, (void)buffer; return false; }
#endif
