/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * ui_case.h — what the ui drivers share: reading a file and the case's parameters (see ui_driver.c). Test code, header only.
 */
#ifndef OMX_PANEL_UI_CASE_H
#define OMX_PANEL_UI_CASE_H
#include <cjson/cJSON.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../include/omx_panel_ui.h"

static inline char *slurp(const char *path) {
  FILE *f = fopen(path, "rb");
  if (!f) return NULL;
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  char *b = malloc((size_t)n + 1);
  if (b && fread(b, 1, (size_t)n, f) == (size_t)n) b[n] = 0;
  else { free(b); b = NULL; }
  fclose(f);
  return b;
}

static inline double num(const cJSON *o, const char *k, double d) {
  const cJSON *v = cJSON_GetObjectItemCaseSensitive(o, k);
  return cJSON_IsNumber(v) ? v->valuedouble : d;
}
static inline bool flag(const cJSON *o, const char *k) { return cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(o, k)); }


/** The case's "params" as omx_panel_ui_param_t (the strings stay in `root`); `*n` their count. */
static inline omx_panel_ui_param_t *case_params(const cJSON *root, size_t *n) {
  const cJSON *ps = cJSON_GetObjectItemCaseSensitive(root, "params"), *p;
  *n = (size_t)cJSON_GetArraySize(ps);
  size_t i = 0;
  omx_panel_ui_param_t *params = calloc(*n ? *n : 1, sizeof *params);
  cJSON_ArrayForEach(p, ps) {
    omx_panel_ui_param_t *q = &params[i++];
    q->symbol = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(p, "symbol"));
    q->unit = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(p, "unit"));
    q->min = num(p, "min", 0), q->max = num(p, "max", 1), q->def = num(p, "def", 0), q->step = num(p, "step", 0);
    q->has_def = flag(p, "has_def"), q->log = flag(p, "log"), q->integer = flag(p, "integer"), q->read_only = flag(p, "read_only");
    const cJSON *ls = cJSON_GetObjectItemCaseSensitive(p, "labels");
    size_t nl = (size_t)cJSON_GetArraySize(ls), k = 0;
    const char **labels = calloc(nl ? nl : 1, sizeof *labels);
    const cJSON *l;
    cJSON_ArrayForEach(l, ls) labels[k++] = cJSON_GetStringValue(l);
    q->labels = labels, q->nlabels = nl;
  }
  return params;
}

#endif
