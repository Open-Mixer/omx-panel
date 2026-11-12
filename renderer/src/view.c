/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * view.c — a panel description laid out and drawn: the head, each section in order, each control in
 * its cell by its standard widget, its label and the text its plugin gives for its value. The layout
 * and the widgets are the MOD GUI face's (tools/modgui-gen.mjs: layout, renderFace, drawKnob ...), the
 * numbers tools/look/geometry.json's and the colours the colour roles' (schema/look-roles.json, whose list
 * look_roles.h carries), valued by the look its host passes, tools/look.json by default; nothing here types a size or
 * a colour. The widget names are omx-contract's (PANEL_STANDARD_WIDGETS).
 */
#include "omx_panel_render.h"

#include <cjson/cJSON.h>
#include <math.h>
#include <omxcontract/omx_vocabulary.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "look_roles.h"
#include "gesture_words.h"
#include "view.h"

static void fail(char *err, size_t n, const char *fmt, const char *a, const char *b) {
  if (err && n) snprintf(err, n, fmt, a ? a : "", b ? b : "");
}

static char *dup(const char *s) {
  size_t n = strlen(s ? s : "");
  char *d = malloc(n + 1);
  if (d) memcpy(d, s ? s : "", n + 1);
  return d;
}

static int hex_colour(const char *s, omx_rgb *out) {
  if (!s || strlen(s) != 7 || s[0] != '#') return 0;
  unsigned v;
  char *end;
  v = (unsigned)strtoul(s + 1, &end, 16);
  if (*end) return 0;
  out->c[0] = (v >> 16) & 255, out->c[1] = (v >> 8) & 255, out->c[2] = v & 255;
  return 1;
}

static int read_look(omx_panel_view_t *v, const char *json, char *err, size_t n) {
  cJSON *root = cJSON_Parse(json);
  cJSON *tok = cJSON_GetObjectItemCaseSensitive(root, "tokens");
  struct { const char *name; omx_rgb *to; } want[] = {
      {"--surface", &v->col.surface}, {"--surface-2", &v->col.section}, {"--surface-3", &v->col.body},
      {"--border-strong", &v->col.rim}, {"--ink", &v->col.ink},       {"--ink-dim", &v->col.inkDim},
      {"--accent", &v->col.accent},
  };
  if (!cJSON_IsObject(tok)) {
    fail(err, n, "look: no tokens object%s%s", NULL, NULL);
    cJSON_Delete(root);
    return 0;
  }
  /* every colour role, drawn here or not: a look short of one is no look of the role file's, refused by name */
  for (size_t i = 0; i < OMX_LOOK_ROLE_COUNT; i++) {
    omx_rgb any;
    if (!hex_colour(cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(tok, omx_look_roles[i])), &any)) {
      fail(err, n, "look: the role %s is not a #rrggbb colour%s", omx_look_roles[i], NULL);
      cJSON_Delete(root);
      return 0;
    }
  }
  for (size_t i = 0; i < sizeof want / sizeof *want; i++) {
    const char *s = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(tok, want[i].name));
    if (!hex_colour(s, want[i].to)) {
      fail(err, n, "look: %s is not a #rrggbb colour%s", want[i].name, NULL);
      cJSON_Delete(root);
      return 0;
    }
  }
  cJSON_Delete(root);
  return 1;
}

#define NUM(obj, field, dst, what)                                                                                    \
  do {                                                                                                                \
    cJSON *x_ = cJSON_GetObjectItemCaseSensitive(obj, #field);                                                        \
    if (!cJSON_IsNumber(x_)) {                                                                                        \
      fail(err, n, "geometry: %s.%s is not a number", what, #field);                                                  \
      goto bad;                                                                                                       \
    }                                                                                                                 \
    (dst)->field = x_->valuedouble;                                                                                   \
  } while (0)

static int read_geometry(omx_panel_view_t *v, const char *json, char *err, size_t n) {
  cJSON *root = cJSON_Parse(json);
  cJSON *g = cJSON_GetObjectItemCaseSensitive(root, "geometry"), *t = cJSON_GetObjectItemCaseSensitive(root, "text");
  cJSON *row = cJSON_GetObjectItemCaseSensitive(root, "rowControls");
  if (!cJSON_IsNumber(row) || row->valueint < 1) {
    fail(err, n, "geometry: rowControls is not a whole number of at least 1%s%s", NULL, NULL);
    goto bad;
  }
  v->row_controls = row->valueint;
  NUM(g, pad, &v->g, "geometry"); NUM(g, headH, &v->g, "geometry"); NUM(g, sectionTop, &v->g, "geometry");
  NUM(g, sectionGap, &v->g, "geometry"); NUM(g, sectionPad, &v->g, "geometry"); NUM(g, sectionTitleH, &v->g, "geometry");
  NUM(g, cellW, &v->g, "geometry"); NUM(g, cellH, &v->g, "geometry"); NUM(g, knob, &v->g, "geometry");
  NUM(g, knobTop, &v->g, "geometry"); NUM(g, switchW, &v->g, "geometry"); NUM(g, switchH, &v->g, "geometry");
  NUM(g, switchTop, &v->g, "geometry"); NUM(g, selectorW, &v->g, "geometry"); NUM(g, selectorH, &v->g, "geometry");
  NUM(g, selectorTop, &v->g, "geometry"); NUM(g, faderW, &v->g, "geometry"); NUM(g, faderCap, &v->g, "geometry");
  NUM(g, radius, &v->g, "geometry"); NUM(g, sectionRadius, &v->g, "geometry");
  NUM(g, curveH, &v->g, "geometry"); NUM(g, curveGap, &v->g, "geometry");
  NUM(g, meterH, &v->g, "geometry"); NUM(g, meterGap, &v->g, "geometry");
  NUM(t, brand, &v->t, "text"); NUM(t, brandBase, &v->t, "text"); NUM(t, title, &v->t, "text");
  NUM(t, titleBase, &v->t, "text"); NUM(t, small, &v->t, "text"); NUM(t, sectionBase, &v->t, "text");
  NUM(t, nameBase, &v->t, "text"); NUM(t, valueBase, &v->t, "text");
  cJSON_Delete(root);
  return 1;
bad:
  cJSON_Delete(root);
  return 0;
}

static int read_description(omx_panel_view_t *v, const char *json, char *err, size_t n) {
  cJSON *root = cJSON_Parse(json);
  cJSON *secs = cJSON_GetObjectItemCaseSensitive(root, "sections"), *ctls = cJSON_GetObjectItemCaseSensitive(root, "controls");
  if (!cJSON_IsArray(secs) || !cJSON_IsArray(ctls)) {
    fail(err, n, "description: not a panel description (no sections and controls arrays)%s%s", NULL, NULL);
    goto bad;
  }
  v->nsections = (size_t)cJSON_GetArraySize(secs);
  v->sections = calloc(v->nsections ? v->nsections : 1, sizeof *v->sections);
  v->section_keys = calloc(v->nsections ? v->nsections : 1, sizeof *v->section_keys);
  size_t i = 0;
  cJSON *it;
  cJSON_ArrayForEach(it, secs) {
    const char *label = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "label"));
    if (!label) {
      fail(err, n, "description: a section has no label%s%s", NULL, NULL);
      goto bad;
    }
    v->section_keys[i] = dup(cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "key")));
    v->sections[i++] = dup(label);
  }
  v->ncontrols = (size_t)cJSON_GetArraySize(ctls);
  v->controls = calloc(v->ncontrols ? v->ncontrols : 1, sizeof *v->controls);
  i = 0;
  cJSON_ArrayForEach(it, ctls) {
    control *c = &v->controls[i++];
    const char *sym = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "symbol"));
    const char *label = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "label"));
    cJSON *sec = cJSON_GetObjectItemCaseSensitive(it, "section");
    const char *w = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(cJSON_GetObjectItemCaseSensitive(it, "standard"), "widget"));
    if (!sym || !label || !cJSON_IsNumber(sec) || sec->valueint < 0 || (size_t)sec->valueint >= v->nsections || !w) {
      fail(err, n, "description: control '%s' lacks a symbol, a label, a section or a standard widget%s", sym, NULL);
      goto bad;
    }
    int found = -1;
    for (size_t k = 0; k < sizeof WIDGET_NAMES / sizeof *WIDGET_NAMES; k++)
      if (strcmp(w, WIDGET_NAMES[k].name) == 0) found = (int)WIDGET_NAMES[k].w;
    if (found < 0) {
      fail(err, n, "description: control '%s' names the widget '%s', which is not a standard widget", sym, w);
      goto bad;
    }
    c->symbol = dup(sym), c->label = dup(label), c->section = sec->valueint, c->w = (widget)found;
    c->text = dup(""), c->at = 0, c->count = 1, c->fraction = 0;
    cJSON *vis = cJSON_GetObjectItemCaseSensitive(it, "visibleWhen");
    if (vis && !cJSON_IsNull(vis)) {
      const char *gov = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(vis, "symbol"));
      cJSON *def = cJSON_GetObjectItemCaseSensitive(vis, "default");
      const char *mask = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "mask"));
      char *end = NULL;
      unsigned long long m = mask ? strtoull(mask, &end, 16) : 0;
      if (!gov || !cJSON_IsNumber(def) || !mask || !*mask || *end) {
        fail(err, n, "description: control '%s' has a visibleWhen without its symbol, default or hex mask%s", sym, NULL);
        goto bad;
      }
      c->gov = dup(gov), c->mask = (uint64_t)m, c->value = (int64_t)def->valuedouble;
    }
  }
  /* the bar groups: a section's `bars` runs name their controls and labels in order */
  cJSON_ArrayForEach(it, secs) {
    cJSON *runs = cJSON_GetObjectItemCaseSensitive(it, "bars"), *run;
    if (!runs || cJSON_IsNull(runs)) continue;
    if (!cJSON_IsArray(runs)) {
      fail(err, n, "description: a section's bars is not an array%s%s", NULL, NULL);
      goto bad;
    }
    cJSON_ArrayForEach(run, runs) {
      cJSON *syms = cJSON_GetObjectItemCaseSensitive(run, "controls"), *labs = cJSON_GetObjectItemCaseSensitive(run, "labels");
      if (!cJSON_IsArray(syms) || !cJSON_IsArray(labs) || cJSON_GetArraySize(syms) != cJSON_GetArraySize(labs)) {
        fail(err, n, "description: a bar run needs a controls array and a labels array of one length%s%s", NULL, NULL);
        goto bad;
      }
      for (int k = 0; k < cJSON_GetArraySize(syms); k++) {
        const char *sym = cJSON_GetStringValue(cJSON_GetArrayItem(syms, k)), *lab = cJSON_GetStringValue(cJSON_GetArrayItem(labs, k));
        int at = -1;
        for (size_t j = 0; sym && j < v->ncontrols; j++)
          if (strcmp(v->controls[j].symbol, sym) == 0) at = (int)j;
        if (at < 0 || !lab) {
          fail(err, n, "description: a bar run names '%s', which is no control or has no label%s", sym ? sym : "(not a string)", NULL);
          goto bad;
        }
        free(v->controls[at].bar);
        v->controls[at].bar = dup(lab);
      }
    }
  }
  /* the meters (contract 7.9): the range, the unit and the kind are the description's; a meter that is one of the controls
   * is that control's reading, the others stand in the band below the sections */
  cJSON *mts = cJSON_GetObjectItemCaseSensitive(root, "meters");
  if (cJSON_IsArray(mts)) {
    v->nmeters = (size_t)cJSON_GetArraySize(mts);
    v->meters = calloc(v->nmeters ? v->nmeters : 1, sizeof *v->meters);
    i = 0;
    cJSON_ArrayForEach(it, mts) {
      meter *m = &v->meters[i++];
      const char *sym = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "symbol"));
      const char *label = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "label"));
      const char *unit = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "unit"));
      const char *kind = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "kind"));
      cJSON *mn = cJSON_GetObjectItemCaseSensitive(it, "min"), *mx = cJSON_GetObjectItemCaseSensitive(it, "max");
      if (!sym || !label || !unit || !kind || !cJSON_IsNumber(mn) || !cJSON_IsNumber(mx) || !(mx->valuedouble > mn->valuedouble)) {
        fail(err, n, "description: meter '%s' lacks a label, a unit, a kind or a range%s", sym ? sym : "?", NULL);
        goto bad;
      }
      m->symbol = dup(sym), m->label = dup(label), m->unit = dup(unit);
      m->min = mn->valuedouble, m->max = mx->valuedouble, m->gain_reduction = strcmp(kind, "gain-reduction") == 0;
      m->in_band = 1;
      for (size_t k = 0; k < v->ncontrols; k++)
        if (strcmp(v->controls[k].symbol, sym) == 0) m->in_band = 0;
      v->nband += (size_t)m->in_band;
    }
  }
  /* the displays: each on a section, its kind the curve's axes, its basis the caption */
  cJSON *dis = cJSON_GetObjectItemCaseSensitive(root, "displays");
  if (cJSON_IsArray(dis)) {
    v->ndisplays = (size_t)cJSON_GetArraySize(dis);
    v->displays = calloc(v->ndisplays ? v->ndisplays : 1, sizeof *v->displays);
    i = 0;
    cJSON_ArrayForEach(it, dis) {
      display *d = &v->displays[i++];
      cJSON *sec = cJSON_GetObjectItemCaseSensitive(it, "section");
      const char *kind = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "kind"));
      const char *basis = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "basis"));
      if (!cJSON_IsNumber(sec) || sec->valueint < 0 || (size_t)sec->valueint >= v->nsections || !kind) {
        fail(err, n, "description: a display lacks a section index or a kind%s%s", NULL, NULL);
        goto bad;
      }
      /* only a closed-form curve has a place on the panel; a gain-reduction bar or a meter is a control's reading */
      d->section = (strcmp(kind, "eq_response") == 0 || strcmp(kind, "transfer_curve") == 0) ? sec->valueint : -1;
      d->log_x = strcmp(kind, "eq_response") == 0, d->symmetric = d->log_x;
      d->basis = dup(basis ? basis : "modelled");
    }
  }
  cJSON_Delete(root);
  return 1;
bad:
  cJSON_Delete(root);
  return 0;
}

omx_panel_view_t *omx_panel_view_create(const omx_panel_sources_t *src, char *err, size_t n) {
  if (!src || !src->description_json || !src->look_json || !src->geometry_json || !src->font) {
    fail(err, n, "sources: the description, the look, the geometry and the font are all needed%s%s", NULL, NULL);
    return NULL;
  }
  omx_panel_view_t *v = calloc(1, sizeof *v);
  if (!v) return NULL;
  v->brand = dup(""), v->name = dup("");
  v->gestures_json = src->gestures_json ? dup(src->gestures_json) : NULL;
  if (!read_look(v, src->look_json, err, n) || !read_geometry(v, src->geometry_json, err, n) ||
      !read_description(v, src->description_json, err, n) || !(v->font = omx_font_load(src->font, src->font_size, err, n))) {
    omx_panel_view_destroy(v);
    return NULL;
  }
  return v;
}

static char *slurp(const char *path, size_t *size) {
  FILE *f = fopen(path, "rb");
  if (!f) return NULL;
  char *buf = NULL;
  size_t len = 0, cap = 0, got;
  do {
    if (len + 65536 + 1 > cap) {
      cap = (len + 65536 + 1) * 2;
      char *nb = realloc(buf, cap);
      if (!nb) { free(buf); fclose(f); return NULL; }
      buf = nb;
    }
    got = fread(buf + len, 1, 65536, f);
    len += got;
  } while (got > 0);
  fclose(f);
  buf[len] = 0;
  if (size) *size = len;
  return buf;
}

omx_panel_view_t *omx_panel_view_create_from_files(const char *description_path, const char *data_dir, char *err, size_t n) {
  char look_path[4096], geom_path[4096], font_path[4096], gest_path[4096];
  snprintf(look_path, sizeof look_path, "%s/look.json", data_dir);
  snprintf(geom_path, sizeof geom_path, "%s/look/geometry.json", data_dir);
  omx_panel_view_t *v = NULL;
  size_t font_size = 0;
  char *desc = slurp(description_path, NULL), *look = slurp(look_path, NULL), *geom = slurp(geom_path, NULL), *font = NULL, *gest = NULL;
  if (!desc) { fail(err, n, "cannot read %s%s", description_path, NULL); goto out; }
  if (!look) { fail(err, n, "cannot read %s%s", look_path, NULL); goto out; }
  if (!geom) { fail(err, n, "cannot read %s%s", geom_path, NULL); goto out; }
  {
    /* the font file is the look's --font-file, relative to the tools directory, and never leaves it */
    cJSON *root = cJSON_Parse(look);
    const char *ff = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(cJSON_GetObjectItemCaseSensitive(root, "tokens"), "--font-file"));
    if (!ff || ff[0] == '/' || strstr(ff, "..")) {
      fail(err, n, "look: --font-file is missing or leaves %s%s", data_dir, NULL);
      cJSON_Delete(root);
      goto out;
    }
    snprintf(font_path, sizeof font_path, "%s/%s", data_dir, ff);
    cJSON_Delete(root);
  }
  font = slurp(font_path, &font_size);
  if (!font) { fail(err, n, "cannot read %s%s", font_path, NULL); goto out; }
  /* the gesture declaration is omx-panel's schema/gestures.json: beside the tools directory in the source tree and in dist/,
   * under the data directory itself where an install puts it. A tree without it still draws; its input refuses by name. */
  snprintf(gest_path, sizeof gest_path, "%s/../schema/gestures.json", data_dir);
  gest = slurp(gest_path, NULL);
  if (!gest) {
    snprintf(gest_path, sizeof gest_path, "%s/gestures.json", data_dir);
    gest = slurp(gest_path, NULL);
  }
  omx_panel_sources_t s = {desc, look, geom, (const uint8_t *)font, font_size, gest};
  v = omx_panel_view_create(&s, err, n);
out:
  free(desc), free(look), free(geom), free(font), free(gest);
  return v;
}

void omx_panel_view_destroy(omx_panel_view_t *v) {
  if (!v) return;
  omx_input_free(v->in);
  free(v->gestures_json);
  for (size_t i = 0; i < v->nsections; i++) free(v->sections[i]), free(v->section_keys ? v->section_keys[i] : NULL);
  free(v->section_keys);
  for (size_t i = 0; i < v->ncontrols; i++)
    free(v->controls[i].symbol), free(v->controls[i].label), free(v->controls[i].text), free(v->controls[i].gov), free(v->controls[i].bar);
  for (size_t i = 0; i < v->ndisplays; i++) free(v->displays[i].basis), free(v->displays[i].x), free(v->displays[i].y), free(v->displays[i].mark_freq), free(v->displays[i].mark_depth), free(v->displays[i].mark_letter);
  for (size_t i = 0; i < v->nmeters; i++) free(v->meters[i].symbol), free(v->meters[i].label), free(v->meters[i].unit);
  free(v->meters);
  free(v->sections), free(v->controls), free(v->displays), free(v->brand), free(v->name);
  omx_font_free(v->font);
  free(v);
}

uint32_t omx_panel_view_meter_count(const omx_panel_view_t *v) { return v ? (uint32_t)v->nmeters : 0; }

int32_t omx_panel_view_meter_find(const omx_panel_view_t *v, const char *symbol) {
  for (size_t i = 0; v && symbol && i < v->nmeters; i++)
    if (strcmp(v->meters[i].symbol, symbol) == 0) return (int32_t)i;
  return -1;
}

/* The fraction of a meter's range a value fills: a level from the foot of the range, a gain reduction from its top (0 dB). */
static double meter_fraction(const meter *m, double value) {
  double f = m->gain_reduction ? (m->max - value) / (m->max - m->min) : (value - m->min) / (m->max - m->min);
  return fmin(1, fmax(0, f));
}

/* The bar is the reading's fraction; the marker is omx-dsp's view law (omx_meter_view_step): it takes a fuller fraction at
 * once and falls OMX_METER_VIEW_FALL_DB_PER_SECOND for each second elapsed, the meter's own range standing for the scale's
 * floor, so a fall in dB is the same on a -24 dB gain reduction and a -70 LUFS loudness. */
bool omx_panel_view_set_meter(omx_panel_view_t *v, uint32_t index, double value, double elapsed) {
  if (!v || index >= v->nmeters || !isfinite(value) || !(elapsed >= 0) || !isfinite(elapsed)) return false;
  meter *m = &v->meters[index];
  m->fill = meter_fraction(m, value);
  m->marker = omx_meter_view_step(&m->view, m->fill, elapsed, OMX_METER_VIEW_FALL_DB_PER_SECOND, -(m->max - m->min));
  m->has = 1;
  return true;
}

uint32_t omx_panel_view_count(const omx_panel_view_t *v) { return v ? (uint32_t)v->ncontrols : 0; }

const char *omx_panel_word_name(omx_panel_word_t word) {
  static const char *const names[] = {OMX_PANEL_WORD_NAMES};
  _Static_assert(sizeof names / sizeof names[0] == OMX_PANEL_WORD_LAST + 1,
                 "gesture_words.h and omx_panel_word_t differ: run node tools/gesture-words.mjs --check");
  _Static_assert(OMX_PANEL_WORD_PAINT == OMX_PANEL_WORD_LAST, "omx_panel_word_t's last word is gestures.json's last");
  return (int)word >= 0 && (size_t)word < sizeof names / sizeof names[0] ? names[word] : NULL;
}

int32_t omx_panel_view_find(const omx_panel_view_t *v, const char *symbol) {
  for (size_t i = 0; v && symbol && i < v->ncontrols; i++)
    if (strcmp(v->controls[i].symbol, symbol) == 0) return (int32_t)i;
  return -1;
}

const char *omx_panel_view_symbol(const omx_panel_view_t *v, uint32_t i) { return v && i < v->ncontrols ? v->controls[i].symbol : NULL; }

void omx_panel_view_set_title(omx_panel_view_t *v, const char *brand, const char *name) {
  if (!v) return;
  free(v->brand), free(v->name);
  v->brand = dup(brand), v->name = dup(name);
}

bool omx_panel_view_set_value(omx_panel_view_t *v, uint32_t i, double fraction, const char *text) {
  if (!v || i >= v->ncontrols || fraction != fraction) return false;
  control *c = &v->controls[i];
  c->fraction = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  free(c->text);
  c->text = dup(text);
  return true;
}

bool omx_panel_view_set_choice(omx_panel_view_t *v, uint32_t i, uint32_t at, uint32_t count, const char *text) {
  if (!v || i >= v->ncontrols || count == 0 || at >= count) return false;
  control *c = &v->controls[i];
  c->at = at, c->count = count;
  c->fraction = count > 1 ? (double)at / (count - 1) : 0;
  free(c->text);
  c->text = dup(text);
  return true;
}

bool omx_panel_view_set_curve(omx_panel_view_t *v, uint32_t index, const double *x, const double *y, uint32_t n) {
  if (!v || !x || !y || n < 2) return false;
  /* the index counts the description's displays; one with no place on the panel (a meter, a gain-reduction bar) takes no curve */
  if (index >= v->ndisplays || v->displays[index].section < 0) return false;
  display *d = &v->displays[index];
  for (uint32_t k = 0; k < n; k++) {
    if (!isfinite(x[k]) || !isfinite(y[k]) || (k && !(x[k] > x[k - 1])) || (d->log_x && !(x[k] > 0))) return false;
  }
  double *nx = malloc(n * sizeof *nx), *ny = malloc(n * sizeof *ny);
  if (!nx || !ny) {
    free(nx), free(ny);
    return false;
  }
  memcpy(nx, x, n * sizeof *nx), memcpy(ny, y, n * sizeof *ny);
  free(d->x), free(d->y);
  d->x = nx, d->y = ny, d->n = n;
  return true;
}

bool omx_panel_view_set_marks(omx_panel_view_t *v, uint32_t index, const double *freq, const double *depth, const char *letters, uint32_t n) {
  if (!v || index >= v->ndisplays || v->displays[index].section < 0 || (n && (!freq || !depth || !letters))) return false;
  display *d = &v->displays[index];
  /* a mark sits on an eq_response: its frequency is on the log axis */
  for (uint32_t k = 0; k < n; k++)
    if (!(freq[k] > 0) || !isfinite(freq[k]) || !isfinite(depth[k]) || !d->log_x) return false;
  double *nf = malloc((n ? n : 1) * sizeof *nf), *nd = malloc((n ? n : 1) * sizeof *nd);
  char *nl = malloc(n ? n : 1);
  if (!nf || !nd || !nl) {
    free(nf), free(nd), free(nl);
    return false;
  }
  if (n) memcpy(nf, freq, n * sizeof *nf), memcpy(nd, depth, n * sizeof *nd), memcpy(nl, letters, n);
  free(d->mark_freq), free(d->mark_depth), free(d->mark_letter);
  d->mark_freq = nf, d->mark_depth = nd, d->mark_letter = nl, d->nmarks = n;
  return true;
}

/* Whether control `c` is shown at its governing control's current value. */
static int shown(const control *c) { return !c->gov || (c->value >= 0 && c->value <= 63 && ((c->mask >> c->value) & 1u)); }

bool omx_panel_view_set_integer(omx_panel_view_t *v, const char *symbol, int64_t value) {
  bool governs = false;
  for (size_t i = 0; v && symbol && i < v->ncontrols; i++)
    if (v->controls[i].gov && strcmp(v->controls[i].gov, symbol) == 0) v->controls[i].value = value, governs = true;
  if (governs) omx_input_dirty(v);
  return governs;
}

bool omx_panel_view_visible(const omx_panel_view_t *v, uint32_t i) { return v && i < v->ncontrols && shown(&v->controls[i]); }

/* ------------------------------------------------------------------------------------ layout */

typedef struct { double x, y, w, h; } box;
typedef struct {
  double w, h;
  box *sections;     /* one per section */
  double *cx, *cy;   /* each control's cell, relative to its section */
  int *curves;       /* one per section: how many curve rows it holds, above its controls */
  char *drawn;       /* one per section: 0 for a section whose every control is hidden, which takes no space */
  box meters;        /* the meters band, below the sections; h is 0 when no meter stands in it */
} laid;

/* Every box of the face, in logical px, with `per_row` controls a row (tools/modgui-gen.mjs layout). */
static laid lay_out(const omx_panel_view_t *v, int per_row) {
  const geometry *g = &v->g;
  laid L = {0, 0, calloc(v->nsections ? v->nsections : 1, sizeof(box)), calloc(v->ncontrols ? v->ncontrols : 1, sizeof(double)),
            calloc(v->ncontrols ? v->ncontrols : 1, sizeof(double)), calloc(v->nsections ? v->nsections : 1, 1),
            calloc(v->nsections ? v->nsections : 1, sizeof(int)), {0, 0, 0, 0}};
  for (size_t k = 0; k < v->ndisplays; k++)
    if (v->displays[k].section >= 0) L.curves[v->displays[k].section]++;
  /* a hidden control takes no cell; a section the values empty takes no space (one declared empty keeps its title) */
  size_t most = 0;
  for (size_t s = 0; s < v->nsections; s++) {
    size_t k = 0, all = 0;
    for (size_t i = 0; i < v->ncontrols; i++)
      if (v->controls[i].section == (int)s) all++, k += shown(&v->controls[i]);
    L.drawn[s] = k > 0 || all == 0;
    if (k > most) most = k;
    if (L.curves[s] && most < 3) most = 3; /* a curve row needs a width of its own */
  }
  if (most > (size_t)per_row) most = (size_t)per_row;
  double section_w = most * g->cellW + 2 * g->sectionPad, y = g->sectionTop;
  double last = -1;
  for (size_t s = 0; s < v->nsections; s++) {
    if (!L.drawn[s]) continue;
    size_t j = 0;
    for (size_t i = 0; i < v->ncontrols; i++) {
      if (v->controls[i].section != (int)s || !shown(&v->controls[i])) continue;
      L.cx[i] = g->sectionPad + (double)(j % per_row) * g->cellW;
      L.cy[i] = g->sectionTitleH + L.curves[s] * (g->curveH + g->curveGap) + floor((double)j / per_row) * g->cellH;
      j++;
    }
    double rows = ceil((double)j / per_row), h = g->sectionTitleH + L.curves[s] * (g->curveH + g->curveGap) + rows * g->cellH + g->sectionPad / 2;
    L.sections[s] = (box){g->pad, y, section_w, h};
    last = y + h;
    y += h + g->sectionGap;
  }
  if (v->nband) {
    double top = last >= 0 ? last + g->sectionGap : y;
    double h = g->sectionTitleH + (double)v->nband * (g->meterH + g->meterGap) + g->sectionPad / 2;
    L.meters = (box){g->pad, top, section_w, h};
    last = top + h;
  }
  L.w = section_w + 2 * g->pad;
  L.h = last >= 0 ? last + g->pad : g->sectionTop + g->pad;
  return L;
}

static void lay_free(laid *L) { free(L->sections), free(L->cx), free(L->cy), free(L->drawn), free(L->curves); }

void omx_panel_view_natural_size(const omx_panel_view_t *v, uint32_t *w, uint32_t *h) {
  if (!v) return;
  laid L = lay_out(v, v->row_controls);
  if (w) *w = (uint32_t)ceil(L.w);
  if (h) *h = (uint32_t)ceil(L.h);
  lay_free(&L);
}

/* ----------------------------------------------------------------------------------- drawing */

/* The widgets, each one drawing over the backend's primitives: the same calls reach the CPU raster (a buffer) and
 * NanoVG (a window), so both draw one layout with one widget code. */

static void draw_knob(const omx_draw *d, double cx, double cy, double r, double f, const palette *col) {
  d->disc(d->ctx, cx, cy, r, col->rim);
  d->disc(d->ctx, cx, cy, r - fmax(1, r * 0.08), col->body);
  double th = (-135 + 270 * fmin(1, fmax(0, f))) * (M_PI / 180);
  double sx = sin(th), sy = -cos(th);
  d->segment(d->ctx, cx + sx * r * 0.28, cy + sy * r * 0.28, cx + sx * r * 0.78, cy + sy * r * 0.78, fmax(0.75, r * 0.08), col->accent);
}

static void draw_selector(const omx_draw *d, double x, double y, double w, double h, double at, double n, const palette *col) {
  d->round_rect(d->ctx, x, y, w, h, fmin(4, h / 4), col->rim);
  d->round_rect(d->ctx, x + 1, y + 1, w - 2, h - 2, fmin(3, h / 4), col->body);
  double seg = (w - 4) / fmax(1, n);
  d->round_rect(d->ctx, x + 2 + at * seg, y + h - 4, fmax(1, seg), 2, 0, col->accent);
}

static void draw_fader(const omx_draw *d, const geometry *g, double cx, double top, double h, double f, const palette *col) {
  double slot = fmax(1, g->faderW * 0.25 * (h / g->knob));
  double cap = g->faderCap * (h / g->knob);
  d->round_rect(d->ctx, cx - slot / 2, top + cap / 2, slot, h - cap, slot / 2, col->rim);
  double y = top + (1 - fmin(1, fmax(0, f))) * (h - cap);
  d->round_rect(d->ctx, cx - (g->faderW * (h / g->knob)) / 2, y, g->faderW * (h / g->knob), cap, fmin(2, cap / 4), col->inkDim);
  d->round_rect(d->ctx, cx - (g->faderW * (h / g->knob)) / 2, y + cap / 2 - 0.5, g->faderW * (h / g->knob), 1, 0, col->accent);
}

/* A reading's frame; a meter fills it to its fraction along the foot. */
static void draw_display(const omx_draw *d, double x, double y, double w, double h, double fill, const palette *col) {
  d->round_rect(d->ctx, x, y, w, h, fmin(4, h / 4), col->rim);
  d->round_rect(d->ctx, x + 1, y + 1, w - 2, h - 2, fmin(3, h / 4), col->body);
  if (fill > 0) d->round_rect(d->ctx, x + 2, y + h - 4, (w - 4) * fill, 2, 0, col->accent);
}

static void draw_switch(const omx_draw *d, double x, double y, double w, double h, int on, const palette *col) {
  d->round_rect(d->ctx, x, y, w, h, h / 2, on ? col->accent : col->body);
  double r = h / 2 - h * 0.15;
  d->disc(d->ctx, on ? x + w - h / 2 : x + h / 2, y + h / 2, r, on ? col->ink : col->inkDim);
}

/* `s` as code points, upper-cased in ASCII (a section label and the brand are set in capitals). */
static size_t text_of(const char *s, int upper, uint32_t **out) {
  size_t n = omx_utf8_decode(s, out);
  if (upper)
    for (size_t i = 0; i < n; i++)
      if ((*out)[i] >= 'a' && (*out)[i] <= 'z') (*out)[i] -= 32;
  return n;
}

/* A line of text, cut to fit by the font's own advances whatever the backend: both cut it at the same character. */
static void text(const omx_draw *d, omx_font *f, const char *s, int upper, double fit, double x, double y, double px, omx_rgb rgb,
                 omx_align align) {
  uint32_t *cps;
  size_t n = text_of(s, upper, &cps);
  n = omx_fit_text(f, cps, n, px, fit);
  d->text(d->ctx, f, cps, n, x, y, px, rgb, align);
  free(cps);
}

/* A curve: its frame, its axis, the points the host gave as a polyline, and the basis word in the caption place. The axes come from the
 * points alone: an eq_response is a log frequency axis with the dB symmetric about 0, to the next 6 dB; a transfer_curve is linear dB,
 * input and output on one span, with the unity line. No point is computed here. With no points the frame and the caption stand: a
 * modelled curve is never read as the plugin's response, so the word is always there. */
static void draw_curve(const omx_draw *d, omx_font *font, const textsizes *T, const display *c, double x, double y, double w, double h, double s,
                       const palette *col) {
  d->round_rect(d->ctx, x, y, w, h, fmin(4, h / 4), col->rim);
  d->round_rect(d->ctx, x + 1, y + 1, w - 2, h - 2, fmin(3, h / 4), col->body);
  double ix = x + 5 * s, iy = y + 5 * s, iw = w - 10 * s, ih = h - 10 * s - 12 * s;
  if (c->n >= 2) {
    double x0, x1, lo, hi;
    if (c->symmetric) {
      double m = 6;
      for (size_t k = 0; k < c->n; k++) m = fmax(m, fabs(c->y[k]));
      hi = ceil(m / 6) * 6, lo = -hi;
      x0 = log10(c->x[0]), x1 = log10(c->x[c->n - 1]);
      d->segment(d->ctx, ix, iy + ih / 2, ix + iw, iy + ih / 2, fmax(0.5, 0.5 * s), col->rim);
    } else {
      lo = fmin(c->x[0], c->y[0]), hi = fmax(c->x[c->n - 1], c->y[0]);
      for (size_t k = 0; k < c->n; k++) lo = fmin(lo, c->y[k]), hi = fmax(hi, c->y[k]);
      x0 = lo, x1 = hi;
      d->segment(d->ctx, ix, iy + ih, ix + iw, iy, fmax(0.5, 0.5 * s), col->rim);
    }
    double px = 0, py = 0;
    for (size_t k = 0; k < c->n; k++) {
      double u = ((c->log_x ? log10(c->x[k]) : c->x[k]) - x0) / (x1 - x0);
      double qx = ix + u * iw, qy = iy + ih - ((c->y[k] - lo) / (hi - lo)) * ih;
      if (k) d->segment(d->ctx, px, py, qx, qy, fmax(0.75, 0.75 * s), col->accent);
      px = qx, py = qy;
    }
    /* the marks, on the log axis at the band's own depth: a disc and its planter's letter above */
    for (size_t k = 0; k < c->nmarks; k++) {
      double u = (log10(c->mark_freq[k]) - x0) / (x1 - x0);
      double qx = ix + u * iw, qy = iy + ih - ((c->mark_depth[k] - lo) / (hi - lo)) * ih;
      char one[2] = {c->mark_letter[k], 0};
      d->disc(d->ctx, qx, qy, fmax(2, 2.5 * s), col->ink);
      text(d, font, one, 0, w, qx, qy - 5 * s, T->small * s, col->ink, OMX_ALIGN_CENTRE);
    }
  }
  text(d, font, c->basis, 0, w - 12 * s, x + 6 * s, y + h - 5 * s, T->small * s, col->inkDim, OMX_ALIGN_LEFT);
}

/* The layout a box of width x height device px at `scale` gets, and the scale it is drawn at: the controls a row that
 * let the panel be drawn largest in the box, the most of them at a tie. At its natural size (or larger) the panel is
 * drawn as laid out; smaller than that it reflows, then shrinks. */
static laid place(const omx_panel_view_t *v, uint32_t width, uint32_t height, double scale, double *s) {
  laid L = {0};
  double k = -1;
  for (int per_row = v->row_controls; per_row >= 1; per_row--) {
    laid T = lay_out(v, per_row);
    double kx = omx_round(T.w * scale) <= width ? 1 : width / (T.w * scale);
    double ky = omx_round(T.h * scale) <= height ? 1 : height / (T.h * scale);
    if (fmin(kx, ky) > k) {
      if (k >= 0) lay_free(&L);
      L = T, k = fmin(kx, ky);
    } else
      lay_free(&T);
  }
  *s = scale * k;
  return L;
}

bool omx_panel_view_control_rect(const omx_panel_view_t *v, uint32_t width, uint32_t height, double scale, uint32_t index,
                                 double rect[4]) {
  if (!v || index >= v->ncontrols || !shown(&v->controls[index]) || !width || !height || !(scale > 0)) return false;
  double s;
  laid L = place(v, width, height, scale, &s);
  const box *sec = &L.sections[v->controls[index].section];
  rect[0] = (sec->x + L.cx[index]) * s, rect[1] = (sec->y + L.cy[index]) * s;
  rect[2] = v->g.cellW * s, rect[3] = v->g.cellH * s;
  lay_free(&L);
  return true;
}

bool omx_view_cells(const omx_panel_view_t *v, uint32_t width, uint32_t height, double scale, double *cells, unsigned char *shown_out) {
  if (!v || !width || !height || !(scale > 0)) return false;
  double s;
  laid L = place(v, width, height, scale, &s);
  for (size_t i = 0; i < v->ncontrols; i++) {
    shown_out[i] = shown(&v->controls[i]);
    if (!shown_out[i]) continue;
    const box *sec = &L.sections[v->controls[i].section];
    cells[4 * i] = sec->x + L.cx[i], cells[4 * i + 1] = sec->y + L.cy[i], cells[4 * i + 2] = v->g.cellW, cells[4 * i + 3] = v->g.cellH;
  }
  lay_free(&L);
  return true;
}

/* A meter of the band: the frame with its caption (the label and the range with its unit), the bar along the foot, and the
 * peak marker over it. Until a reading is given only the frame and the caption stand, as the MOD GUI draws it. */
static void draw_meter(const omx_draw *d, omx_font *font, const textsizes *T, const meter *m, double x, double y, double w, double h, double s,
                       const palette *col) {
  d->round_rect(d->ctx, x, y, w, h, fmin(4, h / 4), col->rim);
  d->round_rect(d->ctx, x + 1, y + 1, w - 2, h - 2, fmin(3, h / 4), col->body);
  char cap[256];
  snprintf(cap, sizeof cap, "%s  %g to %g %s", m->label, m->min, m->max, m->unit);
  text(d, font, cap, 0, w - 12 * s, x + 6 * s, y + 12 * s, T->small * s, col->inkDim, OMX_ALIGN_LEFT);
  if (!m->has) return;
  double inner = w - 4 * s, f = m->fill, mk = m->marker;
  if (f > 0) d->round_rect(d->ctx, x + 2 * s, y + h - 6 * s, inner * f, 4 * s, 0, col->accent);
  d->round_rect(d->ctx, x + 2 * s + fmax(0, inner * mk - 2 * s), y + h - 7 * s, 2 * s, 6 * s, 0, col->ink);
}

void omx_panel_view_paint(const omx_panel_view_t *v, uint32_t width, uint32_t height, double scale, const omx_draw *d) {
  const geometry *g = &v->g;
  const textsizes *T = &v->t;
  const palette *col = &v->col;
  omx_font *font = v->font;
  double s;
  laid L = place(v, width, height, scale, &s);

  d->round_rect(d->ctx, 0, 0, L.w * s, L.h * s, g->radius * s, col->rim);
  d->round_rect(d->ctx, s, s, (L.w - 2) * s, (L.h - 2) * s, (g->radius - 1) * s, col->surface);
  d->round_rect(d->ctx, s, (g->headH - 2) * s, (L.w - 2) * s, 2 * s, 0, col->accent);
  d->disc(d->ctx, (L.w - g->pad - 10) * s, (g->headH / 2) * s, 5 * s, col->accent);
  double head_w = (L.w - 2 * g->pad - 24) * s;
  text(d, font, v->brand, 1, head_w, g->pad * s, T->brandBase * s, T->brand * s, col->inkDim, OMX_ALIGN_LEFT);
  text(d, font, v->name, 0, head_w, g->pad * s, T->titleBase * s, T->title * s, col->ink, OMX_ALIGN_LEFT);
  for (size_t si = 0; si < v->nsections; si++) {
    if (!L.drawn[si]) continue;
    box sec = L.sections[si];
    d->round_rect(d->ctx, sec.x * s, sec.y * s, sec.w * s, sec.h * s, g->sectionRadius * s, col->section);
    text(d, font, v->sections[si], 1, (sec.w - 2 * g->sectionPad) * s, (sec.x + g->sectionPad) * s, (sec.y + T->sectionBase) * s,
         T->small * s, col->inkDim, OMX_ALIGN_LEFT);
    int row = 0;
    for (size_t m = 0; m < v->ndisplays; m++) {
      if (v->displays[m].section != (int)si) continue;
      draw_curve(d, font, T, &v->displays[m], (sec.x + g->sectionPad) * s, (sec.y + g->sectionTitleH + row++ * (g->curveH + g->curveGap)) * s,
                 (sec.w - 2 * g->sectionPad) * s, g->curveH * s, s, col);
    }
    for (size_t i = 0; i < v->ncontrols; i++) {
      const control *k = &v->controls[i];
      if (k->section != (int)si || !shown(k)) continue;
      double x = sec.x + L.cx[i], y = sec.y + L.cy[i];
      int reading = 0;
      switch (k->bar ? W_FADER : k->w) {
      case W_SWITCH:
        draw_switch(d, (x + (g->cellW - g->switchW) / 2) * s, (y + g->switchTop) * s, g->switchW * s, g->switchH * s, k->fraction >= 0.5, col);
        break;
      case W_SELECTOR:
        draw_selector(d, (x + (g->cellW - g->selectorW) / 2) * s, (y + g->selectorTop) * s, g->selectorW * s, g->selectorH * s, k->at, k->count, col);
        break;
      case W_FADER:
        draw_fader(d, g, (x + g->cellW / 2) * s, (y + g->knobTop) * s, g->knob * s, k->fraction, col);
        break;
      case W_KNOB:
        draw_knob(d, (x + g->cellW / 2) * s, (y + g->knobTop + g->knob / 2) * s, (g->knob / 2) * s, k->fraction, col);
        break;
      default: /* a meter fills its frame; a display, a curve and an xy pad show a frame until each has its own drawing */
        draw_display(d, (x + (g->cellW - g->selectorW) / 2) * s, (y + g->selectorTop) * s, g->selectorW * s, g->selectorH * s,
                     k->w == W_METER ? k->fraction : 0, col);
        reading = 1;
      }
      double mid = (x + g->cellW / 2) * s, w = (g->cellW - 4) * s;
      text(d, font, k->bar ? k->bar : k->label, 0, w, mid, (y + T->nameBase) * s, T->small * s, col->inkDim, OMX_ALIGN_CENTRE);
      if (!k->bar && k->w == W_SELECTOR)
        text(d, font, k->text, 0, (g->selectorW - 8) * s, mid, (y + g->selectorTop + g->selectorH / 2 + T->small * 0.36) * s,
             T->small * s, col->ink, OMX_ALIGN_CENTRE);
      else if (!reading || k->text[0])
        text(d, font, k->text, 0, w, mid, (y + T->valueBase) * s, T->small * s, col->ink, OMX_ALIGN_CENTRE);
    }
  }
  if (v->nband) {
    box b = L.meters;
    d->round_rect(d->ctx, b.x * s, b.y * s, b.w * s, b.h * s, g->sectionRadius * s, col->section);
    text(d, font, "Meters", 1, (b.w - 2 * g->sectionPad) * s, (b.x + g->sectionPad) * s, (b.y + T->sectionBase) * s, T->small * s, col->inkDim, OMX_ALIGN_LEFT);
    int row = 0;
    for (size_t k = 0; k < v->nmeters; k++) {
      if (!v->meters[k].in_band) continue;
      draw_meter(d, font, T, &v->meters[k], (b.x + g->sectionPad) * s, (b.y + g->sectionTitleH + row++ * (g->meterH + g->meterGap)) * s,
                 (b.w - 2 * g->sectionPad) * s, g->meterH * s, s, col);
    }
  }
  lay_free(&L);
}

omx_font *omx_panel_view_font(const omx_panel_view_t *v) { return v ? v->font : NULL; }

/* ------------------------------------------------------------------------------- the CPU path */

static void cpu_round_rect(void *c, double x, double y, double w, double h, double r, omx_rgb rgb) { omx_round_rect(c, x, y, w, h, r, rgb); }
static void cpu_disc(void *c, double cx, double cy, double r, omx_rgb rgb) { omx_disc(c, cx, cy, r, rgb); }
static void cpu_segment(void *c, double ax, double ay, double bx, double by, double hw, omx_rgb rgb) { omx_segment(c, ax, ay, bx, by, hw, rgb); }
static void cpu_text(void *c, omx_font *f, const uint32_t *cps, size_t n, double x, double y, double px, omx_rgb rgb, omx_align a) {
  omx_draw_text(c, f, cps, n, x, y, px, rgb, a);
}

bool omx_panel_view_draw(omx_panel_view_t *v, const omx_panel_buffer_t *b) {
  if (!v || !b || !b->pixels || !b->width || !b->height || b->stride < (uint64_t)b->width * 4 || !(b->scale > 0) ||
      (unsigned)b->format > OMX_PANEL_PIXEL_BGRA8_STRAIGHT)
    return false;
  for (uint32_t y = 0; y < b->height; y++) memset(b->pixels + (size_t)y * b->stride, 0, (size_t)b->width * 4);
  int bgra = b->format == OMX_PANEL_PIXEL_BGRA8_PREMULTIPLIED || b->format == OMX_PANEL_PIXEL_BGRA8_STRAIGHT;
  omx_canvas cv = {b->pixels, (int)b->width, (int)b->height, b->stride, bgra};
  const omx_draw d = {&cv, cpu_round_rect, cpu_disc, cpu_segment, cpu_text};
  omx_panel_view_paint(v, b->width, b->height, b->scale, &d);
  /* drawn with straight alpha; a premultiplied buffer gets each colour times its alpha, rounded to the nearest */
  if (b->format == OMX_PANEL_PIXEL_RGBA8_PREMULTIPLIED || b->format == OMX_PANEL_PIXEL_BGRA8_PREMULTIPLIED)
    for (uint32_t y = 0; y < b->height; y++) {
      uint8_t *p = b->pixels + (size_t)y * b->stride;
      for (uint32_t x = 0; x < b->width; x++, p += 4)
        if (p[3] != 255)
          for (int k = 0; k < 3; k++) p[k] = (uint8_t)((p[k] * p[3] + 127) / 255);
    }
  return true;
}
