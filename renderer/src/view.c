/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * view.c — a panel description laid out and drawn: the head, each section in order, each control in
 * its cell by its standard widget, its label and the text its plugin gives for its value. The layout
 * and the widgets are the MOD GUI face's (tools/modgui-gen.mjs: layout, renderFace, drawKnob ...), the
 * numbers tools/look/geometry.json's and the colours the colour roles' (schema/look-roles.json, whose list
 * look_roles.h carries), valued by the look its host passes, tools/look.json by default; nothing here types a size or
 * a colour. The widget names are omx-panel's panel domain's (PANEL_STANDARD_WIDGETS).
 */
#include "omx_panel_render.h"

#include <cjson/cJSON.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "look_roles.h"
#include "scene.h"
#include "gesture_words.h"
#include "view.h"

/* whether `w` is the widget word whose X-macro name is `name` (view.h): the word is the name in lower case */
static int is_widget_word(const char *w, const char *name) {
  for (; *name; w++, name++)
    if (*w != (*name >= 'A' && *name <= 'Z' ? *name - 'A' + 'a' : *name)) return 0;
  return *w == 0;
}

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

/* A colour the console look (looks.console of look.json) sets: `#rrggbb`, or a colour role's name in braces, read in `tok`. */
static int look_colour(cJSON *flat, cJSON *tok, const char *name, omx_rgb *out, char *err, size_t n) {
  const char *s = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(flat, name));
  char role[48];
  if (s && s[0] == '{' && s[1] == '-' && strlen(s) < sizeof role + 2 && s[strlen(s) - 1] == '}') {
    snprintf(role, sizeof role, "%.*s", (int)strlen(s) - 2, s + 1);
    s = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(tok, role));
  }
  if (hex_colour(s, out)) return 1;
  fail(err, n, "look: looks.console %s is not a colour or a role's name%s", name, NULL);
  return 0;
}

static int read_look(omx_panel_view_t *v, const char *json, char *err, size_t n) {
  cJSON *root = cJSON_Parse(json);
  cJSON *tok = cJSON_GetObjectItemCaseSensitive(root, "tokens");
  struct { const char *name; omx_rgb *to; } want[] = {
      {"--surface", &v->col.surface}, {"--surface-2", &v->col.section}, {"--surface-3", &v->col.body},
      {"--border-strong", &v->col.rim}, {"--ink", &v->col.ink},       {"--ink-dim", &v->col.inkDim},
      {"--accent", &v->col.accent},   {"--knob-pointer", &v->col.pointer},   {"--curve-stroke", &v->col.curve},
      {"--meter-green", &v->col.meterGreen}, {"--meter-amber", &v->col.meterAmber}, {"--meter-red", &v->col.meterRed},
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
  /* the scribble strip's two colours are the console look's (the flat look the roles give): a colour or a role's name in braces */
  cJSON *flat = cJSON_GetObjectItemCaseSensitive(cJSON_GetObjectItemCaseSensitive(root, "looks"), "console");
  if (!look_colour(flat, tok, "--scribble-bg", &v->col.scribbleBg, err, n) || !look_colour(flat, tok, "--scribble-ink", &v->col.scribbleInk, err, n)) {
    cJSON_Delete(root);
    return 0;
  }
  /* the knob the look's style names: `--knob` of looks[style], `flat` or a drawing of the look (omx-panel#123); a style or a drawing the
   * look does not carry is refused by name, never drawn flat */
  const char *style = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(root, "style"));
  if (style) {
    cJSON *entry = cJSON_GetObjectItemCaseSensitive(cJSON_GetObjectItemCaseSensitive(root, "looks"), style);
    const char *knob = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(entry, "--knob"));
    if (!cJSON_IsObject(entry) || !knob) {
      fail(err, n, "look: the style '%s' names no look with a --knob%s", style, NULL);
      cJSON_Delete(root);
      return 0;
    }
    if (strcmp(knob, "flat") != 0) {
      const char *finish = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(entry, "--finish"));
      v->knob_scene = omx_scene_from_look(root, knob, finish ? finish : "", err, n);
      if (!v->knob_scene) {
        cJSON_Delete(root);
        return 0;
      }
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
  NUM(g, scribbleW, &v->g, "geometry"); NUM(g, scribbleH, &v->g, "geometry");
  NUM(t, brand, &v->t, "text"); NUM(t, brandBase, &v->t, "text"); NUM(t, title, &v->t, "text");
  NUM(t, titleBase, &v->t, "text"); NUM(t, small, &v->t, "text"); NUM(t, sectionBase, &v->t, "text");
  NUM(t, nameBase, &v->t, "text"); NUM(t, nameBaseStrip, &v->t, "text"); NUM(t, valueBase, &v->t, "text");
  NUM(t, readingBase, &v->t, "text");
  cJSON_Delete(root);
  return 1;
bad:
  cJSON_Delete(root);
  return 0;
}

static void apply_counts(omx_panel_view_t *v);

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
      if (is_widget_word(w, WIDGET_NAMES[k].name)) found = (int)WIDGET_NAMES[k].w;
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
  /* the repeated groups: a section's `matrix` is the group model's matrixOf as the description carries it (docs/renderer.md);
   * read as given, never inferred here */
  {
    size_t si = 0;
    cJSON_ArrayForEach(it, secs) {
      cJSON *mx = cJSON_GetObjectItemCaseSensitive(it, "matrix");
      size_t sec = si++;
      if (!mx || cJSON_IsNull(mx)) continue;
      if (!cJSON_IsObject(mx)) {
        fail(err, n, "description: a section's matrix is not an object%s%s", NULL, NULL);
        goto bad;
      }
      const char *ori = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(mx, "orientation"));
      cJSON *heads = cJSON_GetObjectItemCaseSensitive(mx, "heads"), *rows = cJSON_GetObjectItemCaseSensitive(mx, "rows"),
            *cells = cJSON_GetObjectItemCaseSensitive(mx, "cells"), *cnt = cJSON_GetObjectItemCaseSensitive(mx, "count");
      if (!ori || (strcmp(ori, "columns") && strcmp(ori, "rows"))) {
        fail(err, n, "description: a matrix's orientation is neither columns nor rows%s%s", NULL, NULL);
        goto bad;
      }
      if (!cJSON_IsArray(heads) || !cJSON_IsArray(rows) || !cJSON_IsArray(cells) || cJSON_GetArraySize(cells) != cJSON_GetArraySize(rows)) {
        fail(err, n, "description: a matrix needs heads, rows and cells arrays, one cells row for each of the rows%s%s", NULL, NULL);
        goto bad;
      }
      v->matrices = realloc(v->matrices, (v->nmatrices + 1) * sizeof *v->matrices);
      matrix *m = &v->matrices[v->nmatrices++];
      *m = (matrix){(int)sec, !strcmp(ori, "columns"), (size_t)cJSON_GetArraySize(heads), (size_t)cJSON_GetArraySize(rows), NULL, NULL, NULL, -1, 0, -1};
      m->heads = calloc(m->nheads ? m->nheads : 1, sizeof *m->heads);
      m->row_label = calloc(m->nrows ? m->nrows : 1, sizeof *m->row_label);
      size_t ncells = m->nheads * m->nrows;
      m->cell = malloc((ncells > 0 ? ncells : 1) * sizeof *m->cell);
      for (size_t k = 0; k < ncells; k++) m->cell[k] = -1;
      /* a control the matrix names: in this section, once; it takes the head's or the row's label */
      #define PLACE(SYM, LABEL, OUT)                                                                                                   \
        do {                                                                                                                           \
          int at_ = -1;                                                                                                                \
          for (size_t j_ = 0; (SYM) && j_ < v->ncontrols; j_++)                                                                        \
            if (strcmp(v->controls[j_].symbol, (SYM)) == 0) at_ = (int)j_;                                                             \
          if (at_ < 0 || v->controls[at_].section != (int)sec) {                                                                       \
            fail(err, n, "description: a matrix names '%s', which is no control of its section%s", (SYM) ? (SYM) : "(not a string)", NULL); \
            goto bad;                                                                                                                  \
          }                                                                                                                            \
          if (v->controls[at_].placed) {                                                                                               \
            fail(err, n, "description: a matrix places '%s' twice%s", (SYM), NULL);                                                    \
            goto bad;                                                                                                                  \
          }                                                                                                                            \
          v->controls[at_].placed = 1;                                                                                                 \
          if (LABEL) free(v->controls[at_].label), v->controls[at_].label = dup(LABEL);                                                \
          (OUT) = at_;                                                                                                                 \
        } while (0)
      for (size_t k = 0; k < m->nheads; k++) {
        cJSON *h = cJSON_GetArrayItem(heads, (int)k), *on = cJSON_GetObjectItemCaseSensitive(h, "on"), *edge = cJSON_GetObjectItemCaseSensitive(h, "edge");
        const char *lab = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(h, "label"));
        if (!lab) {
          fail(err, n, "description: a matrix head has no label%s%s", NULL, NULL);
          goto bad;
        }
        m->heads[k].label = dup(lab), m->heads[k].on = -1, m->heads[k].edge = cJSON_IsString(edge) && *edge->valuestring;
        /* the served head's on/off is { symbol, sense } and nothing else; it is PLACED by the head row's cell, below */
        if (on && !cJSON_IsNull(on) && (!cJSON_IsObject(on) || !cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(on, "symbol")))) {
          fail(err, n, "description: a matrix head's on/off is not a { symbol, sense } object (head '%s')%s", lab, NULL);
          goto bad;
        }
      }
      for (size_t r = 0; r < m->nrows; r++) {
        cJSON *row = cJSON_GetArrayItem(rows, (int)r);
        const char *lab = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(row, "label"));
        cJSON *line = cJSON_GetArrayItem(cells, (int)r), *c, *head = cJSON_GetObjectItemCaseSensitive(row, "head");
        if (!lab || !cJSON_IsArray(line) || (size_t)cJSON_GetArraySize(line) != m->nheads) {
          fail(err, n, "description: a matrix row has no label, or its cells are not one for each head%s%s", NULL, NULL);
          goto bad;
        }
        m->row_label[r] = dup(lab);
        /* a cell holding a parameter other than the row's is named by the row's `labels` (omx-panel#122) */
        cJSON *labels = cJSON_GetObjectItemCaseSensitive(row, "labels");
        size_t k = 0;
        int is_head = cJSON_IsTrue(head);
        if (is_head) {
          /* the head row: its cells are the heads' on/off, placed here like any row's, each named by its head */
          if (m->head_row >= 0) {
            fail(err, n, "description: a matrix has two head rows%s%s", NULL, NULL);
            goto bad;
          }
          m->head_row = (int)r;
        }
        cJSON_ArrayForEach(c, line) {
          cJSON *on = cJSON_GetObjectItemCaseSensitive(cJSON_GetArrayItem(heads, (int)k), "on");
          const char *sym = cJSON_GetStringValue(c);
          if (is_head) {
            const char *want = cJSON_IsObject(on) ? cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(on, "symbol")) : NULL;
            if ((sym || want) && (!sym || !want || strcmp(sym, want))) {
              fail(err, n, "description: the matrix's head row differs from its heads' on/off at '%s'%s", sym ? sym : "(empty)", NULL);
              goto bad;
            }
          }
          if (!cJSON_IsNull(c)) {
            const char *own = cJSON_GetStringValue(cJSON_GetArrayItem(labels, (int)k));
            PLACE(sym, is_head ? m->heads[k].label : own ? own : lab, m->cell[r * m->nheads + k]);
            if (is_head) m->heads[k].on = m->cell[r * m->nheads + k];
          }
          k++;
        }
      }
      #undef PLACE
      /* the served matrix always opens with its head row (docs/group-model.md L3, omx-panel#121) */
      if (m->head_row != 0) {
        fail(err, n, "description: a matrix's head row is missing or is not its first row%s%s", NULL, NULL);
        goto bad;
      }
      if (cnt && !cJSON_IsNull(cnt)) {
        const char *sym = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(cnt, "symbol"));
        cJSON *def = cJSON_GetObjectItemCaseSensitive(cnt, "default");
        for (size_t j = 0; sym && j < v->ncontrols; j++)
          if (strcmp(v->controls[j].symbol, sym) == 0 && v->controls[j].section == (int)sec && !v->controls[j].placed) m->count_ctl = (int)j;
        if (m->count_ctl < 0 || (def && !cJSON_IsNull(def) && !cJSON_IsNumber(def))) {
          fail(err, n, "description: a matrix's count '%s' is no control of its section outside the matrix, or its default is not a number%s", sym ? sym : "(not a string)", NULL);
          goto bad;
        }
        /* a served count may carry no default (null): every instance is drawn until the host gives the value */
        m->count = cJSON_IsNumber(def) ? (int64_t)def->valuedouble : (int64_t)m->nheads;
      }
    }
    apply_counts(v);
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
  /* the displays: each on a section, its axis (a PANEL_DISPLAY_AXES word the description serves) the curve's axes, its basis the
   * caption. The axis is read, never inferred from the kind: a display without one, or with another word, is refused by name */
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
      const char *axis = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "axis"));
      if (!cJSON_IsNumber(sec) || sec->valueint < 0 || (size_t)sec->valueint >= v->nsections || !kind) {
        fail(err, n, "description: a display lacks a section index or a kind%s%s", NULL, NULL);
        goto bad;
      }
      char which[96];
      snprintf(which, sizeof which, "%zu (%.64s)", i - 1, kind);
      if (!axis) {
        fail(err, n, "description: display %s has no axis, one of PANEL_DISPLAY_AXES (linear, log-frequency, time)%s", which, "");
        goto bad;
      }
      if (strcmp(axis, "linear") != 0 && strcmp(axis, "log-frequency") != 0 && strcmp(axis, "time") != 0) {
        fail(err, n, "description: display %s has the axis '%s', none of PANEL_DISPLAY_AXES (linear, log-frequency, time)", which, axis);
        goto bad;
      }
      /* only a closed-form curve has a place on the panel; a gain-reduction bar or a meter is a control's reading */
      d->section = (strcmp(kind, "eq_response") == 0 || strcmp(kind, "transfer_curve") == 0 || strcmp(kind, "time_response") == 0) ? sec->valueint : -1;
      d->time_x = strcmp(axis, "time") == 0;
      d->log_x = strcmp(axis, "log-frequency") == 0, d->symmetric = d->log_x;
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
  omx_scene_free(v->knob_scene);
  free(v->gestures_json);
  for (size_t i = 0; i < v->nsections; i++) free(v->sections[i]), free(v->section_keys ? v->section_keys[i] : NULL);
  free(v->section_keys);
  for (size_t i = 0; i < v->ncontrols; i++)
    free(v->controls[i].symbol), free(v->controls[i].label), free(v->controls[i].text), free(v->controls[i].gov), free(v->controls[i].bar);
  for (size_t i = 0; i < v->ndisplays; i++) free(v->displays[i].basis), free(v->displays[i].x), free(v->displays[i].y), free(v->displays[i].mark_freq), free(v->displays[i].mark_depth), free(v->displays[i].mark_letter),
                                               free(v->displays[i].stem_x), free(v->displays[i].stem_y), free(v->displays[i].stem_shade), free(v->displays[i].stem_letter),
                                               free(v->displays[i].spec_hz), free(v->displays[i].spec_db), free(v->displays[i].spec_peak);
  for (size_t i = 0; i < v->nmeters; i++) free(v->meters[i].symbol), free(v->meters[i].label), free(v->meters[i].unit);
  free(v->meters);
  for (size_t k = 0; k < v->nmatrices; k++) {
    for (size_t h = 0; h < v->matrices[k].nheads; h++) free(v->matrices[k].heads[h].label);
    for (size_t r = 0; r < v->matrices[k].nrows; r++) free(v->matrices[k].row_label[r]);
    free(v->matrices[k].heads), free(v->matrices[k].row_label), free(v->matrices[k].cell);
  }
  free(v->matrices);
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

void omx_panel_view_set_head(omx_panel_view_t *v, bool shown) {
  if (v) v->headless = !shown;
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
    if (!isfinite(x[k]) || !isfinite(y[k]) || (k && !(x[k] > x[k - 1])) || (d->log_x && !(x[k] > 0)) || (d->time_x && !(x[k] >= 0))) return false;
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

bool omx_panel_view_set_stems(omx_panel_view_t *v, uint32_t index, const double *t_ms, const double *db, const double *shade, const char *letters,
                              uint32_t n) {
  if (!v || index >= v->ndisplays || v->displays[index].section < 0 || !v->displays[index].time_x || (n && (!t_ms || !db || !shade || !letters)))
    return false;
  display *d = &v->displays[index];
  /* a stem stands on the time axis at or after 0, at a finite level, with a shade in 0..1 */
  for (uint32_t k = 0; k < n; k++)
    if (!isfinite(t_ms[k]) || !(t_ms[k] >= 0) || !isfinite(db[k]) || !isfinite(shade[k]) || !(shade[k] >= 0 && shade[k] <= 1)) return false;
  double *nx = malloc((n ? n : 1) * sizeof *nx), *ny = malloc((n ? n : 1) * sizeof *ny), *ns = malloc((n ? n : 1) * sizeof *ns);
  char *nl = malloc(n ? n : 1);
  if (!nx || !ny || !ns || !nl) {
    free(nx), free(ny), free(ns), free(nl);
    return false;
  }
  if (n) memcpy(nx, t_ms, n * sizeof *nx), memcpy(ny, db, n * sizeof *ny), memcpy(ns, shade, n * sizeof *ns), memcpy(nl, letters, n);
  free(d->stem_x), free(d->stem_y), free(d->stem_shade), free(d->stem_letter);
  d->stem_x = nx, d->stem_y = ny, d->stem_shade = ns, d->stem_letter = nl, d->nstems = n;
  return true;
}

bool omx_panel_view_set_spectrum(omx_panel_view_t *v, uint32_t index, const double *hz, const double *db, const double *peak_db, uint32_t n,
                                 double db_min, double db_max, double grid_db) {
  if (!v || index >= v->ndisplays || v->displays[index].section < 0 || !v->displays[index].log_x) return false;
  if (!isfinite(db_min) || !isfinite(db_max) || !isfinite(grid_db) || !(db_min < db_max) || !(grid_db > 0)) return false;
  if (n && (!hz || !db || !peak_db)) return false;
  /* a level is finite or silence (-INFINITY); a centre is above zero and above the one before */
  for (uint32_t k = 0; k < n; k++)
    if (!(hz[k] > 0) || !isfinite(hz[k]) || (k && !(hz[k] > hz[k - 1])) || !(isfinite(db[k]) || db[k] == -INFINITY) ||
        !(isfinite(peak_db[k]) || peak_db[k] == -INFINITY))
      return false;
  display *d = &v->displays[index];
  double *nh = NULL, *nd = NULL, *np = NULL;
  if (n) {
    nh = malloc(n * sizeof *nh), nd = malloc(n * sizeof *nd), np = malloc(n * sizeof *np);
    if (!nh || !nd || !np) {
      free(nh), free(nd), free(np);
      return false;
    }
    memcpy(nh, hz, n * sizeof *nh), memcpy(nd, db, n * sizeof *nd), memcpy(np, peak_db, n * sizeof *np);
  }
  free(d->spec_hz), free(d->spec_db), free(d->spec_peak);
  d->spec_hz = nh, d->spec_db = nd, d->spec_peak = np, d->nspec = n;
  d->spec_min = db_min, d->spec_max = db_max, d->spec_grid = grid_db;
  return true;
}

/* Whether control `c` is shown at its governing control's current value. */
static int shown(const control *c) { return !c->cut && (!c->gov || (c->value >= 0 && c->value <= 63 && ((c->mask >> c->value) & 1u))); }

bool omx_panel_view_set_integer(omx_panel_view_t *v, const char *symbol, int64_t value) {
  bool governs = false;
  for (size_t i = 0; v && symbol && i < v->ncontrols; i++)
    if (v->controls[i].gov && strcmp(v->controls[i].gov, symbol) == 0) v->controls[i].value = value, governs = true;
  for (size_t k = 0; v && symbol && k < v->nmatrices; k++)
    if (v->matrices[k].count_ctl >= 0 && strcmp(v->controls[v->matrices[k].count_ctl].symbol, symbol) == 0) v->matrices[k].count = value, governs = true;
  if (governs) apply_counts(v), omx_input_dirty(v);
  return governs;
}

bool omx_panel_view_visible(const omx_panel_view_t *v, uint32_t i) { return v && i < v->ncontrols && shown(&v->controls[i]); }

/* Which heads of a matrix are drawn: every edge, and the first `count` of the others when the matrix has a count control. map[h]
 * is the head's place among the drawn ones, -1 for a head closed up; the number drawn is returned. */
static size_t visible_heads(const matrix *m, int *map) {
  size_t drawn = 0, instance = 0;
  for (size_t h = 0; h < m->nheads; h++) {
    int keep = m->heads[h].edge || m->count_ctl < 0 || (int64_t)instance < m->count;
    if (!m->heads[h].edge) instance++;
    map[h] = keep ? (int)drawn++ : -1;
  }
  return drawn;
}

/* Close up the heads beyond each matrix's count: their controls are cut, as a control the values hide is. */
static void apply_counts(omx_panel_view_t *v) {
  for (size_t k = 0; k < v->nmatrices; k++) {
    matrix *m = &v->matrices[k];
    int *map = malloc((m->nheads ? m->nheads : 1) * sizeof *map);
    visible_heads(m, map);
    for (size_t h = 0; h < m->nheads; h++) {
      int cut = map[h] < 0;
      for (size_t r = 0; r < m->nrows; r++)
        if (m->cell[r * m->nheads + h] >= 0) v->controls[m->cell[r * m->nheads + h]].cut = cut;
    }
    free(map);
  }
}

static const matrix *matrix_of_section(const omx_panel_view_t *v, size_t s) {
  for (size_t k = 0; k < v->nmatrices; k++)
    if (v->matrices[k].section == (int)s) return &v->matrices[k];
  return NULL;
}

/* The cell of a matrix's grid at (drawn head, row) in a section whose matrix starts `top` below it: the rows as served, the head
 * row the last. */
static void grid_at(const geometry *g, const matrix *m, double top, int head, int line, double *x, double *y) {
  *x = g->sectionPad + (m->columns ? head : line) * g->cellW;
  *y = top + (m->columns ? line : head) * g->cellH;
}

/* ------------------------------------------------------------------------------------ layout */

uint32_t omx_panel_view_visible_columns(const omx_panel_view_t *v, uint32_t width, double scale) {
  if (!v || !v->nmatrices || !(scale > 0)) return 0;
  const matrix *m = &v->matrices[0];
  int *map = malloc((m->nheads ? m->nheads : 1) * sizeof *map);
  size_t columns = m->columns ? visible_heads(m, map) : m->nrows;
  free(map);
  double fit = floor((double)width / (v->g.cellW * scale));
  size_t n = fit < 1 ? 1 : (size_t)fit;
  return (uint32_t)(n < columns ? n : columns);
}


typedef struct { double x, y, w, h; } box;
typedef struct {
  double w, h;
  box *sections;     /* one per section */
  double *cx, *cy;   /* each control's cell, relative to its section */
  int *curves;       /* one per section: how many curve rows it holds, above its controls */
  char *drawn;       /* one per section: 0 for a section whose every control is hidden, which takes no space */
  double *mtop;      /* one per section: where its matrix starts below the section's top, -1 for a section with none */
  box meters;        /* the meters band, below the sections; h is 0 when no meter stands in it */
} laid;

/* Every box of the face, in logical px, with `per_row` controls a row (tools/modgui-gen.mjs layout). */
static laid lay_out(const omx_panel_view_t *v, int per_row) {
  const geometry *g = &v->g;
  laid L = {0, 0, calloc(v->nsections ? v->nsections : 1, sizeof(box)), calloc(v->ncontrols ? v->ncontrols : 1, sizeof(double)),
            calloc(v->ncontrols ? v->ncontrols : 1, sizeof(double)), calloc(v->nsections ? v->nsections : 1, 1),
            calloc(v->nsections ? v->nsections : 1, sizeof(int)), calloc(v->nsections ? v->nsections : 1, sizeof(double)), {0, 0, 0, 0}};
  for (size_t s = 0; s < v->nsections; s++) L.mtop[s] = -1;
  for (size_t k = 0; k < v->ndisplays; k++)
    if (v->displays[k].section >= 0) L.curves[v->displays[k].section]++;
  /* a hidden control takes no cell; a section the values empty takes no space (one declared empty keeps its title) */
  size_t most = 0, across_most = 0;
  for (size_t s = 0; s < v->nsections; s++) {
    size_t k = 0, all = 0;
    const matrix *mx = matrix_of_section(v, s);
    for (size_t i = 0; i < v->ncontrols; i++)
      if (v->controls[i].section == (int)s && !v->controls[i].placed) all++, k += shown(&v->controls[i]);
    L.drawn[s] = k > 0 || all == 0 || mx != NULL;
    if (mx) {
      int *map = malloc((mx->nheads ? mx->nheads : 1) * sizeof *map);
      size_t nv = visible_heads(mx, map);
      free(map);
      size_t across = mx->columns ? nv : mx->nrows;
      if (across > across_most) across_most = across;
    }
    if (k > most) most = k;
    if (L.curves[s] && most < 3) most = 3; /* a curve row needs a width of its own */
  }
  if (most > (size_t)per_row) most = (size_t)per_row;
  if (across_most > most) most = across_most; /* a matrix is never wrapped */
  /* the sections start below the head, or at the top of a face without one */
  double top0 = v->headless ? g->pad : g->sectionTop;
  double section_w = most * g->cellW + 2 * g->sectionPad, y = top0;
  double last = -1;
  for (size_t s = 0; s < v->nsections; s++) {
    if (!L.drawn[s]) continue;
    size_t j = 0;
    for (size_t i = 0; i < v->ncontrols; i++) {
      if (v->controls[i].section != (int)s || v->controls[i].placed || !shown(&v->controls[i])) continue;
      L.cx[i] = g->sectionPad + (double)(j % per_row) * g->cellW;
      L.cy[i] = g->sectionTitleH + L.curves[s] * (g->curveH + g->curveGap) + floor((double)j / per_row) * g->cellH;
      j++;
    }
    double rows = ceil((double)j / per_row), top = g->sectionTitleH + L.curves[s] * (g->curveH + g->curveGap) + rows * g->cellH;
    double h = top + g->sectionPad / 2;
    const matrix *mx = matrix_of_section(v, s);
    if (mx) {
      int *map = malloc((mx->nheads ? mx->nheads : 1) * sizeof *map);
      size_t nv = visible_heads(mx, map);
      for (size_t k = 0; k < mx->nheads; k++) {
        if (map[k] < 0) continue;
        /* every cell, the head row's among them, where the served rows put it */
        for (size_t r = 0; r < mx->nrows; r++)
          if (mx->cell[r * mx->nheads + k] >= 0) {
            int c = mx->cell[r * mx->nheads + k];
            grid_at(g, mx, top, map[k], (int)r, &L.cx[c], &L.cy[c]);
          }
      }
      free(map);
      L.mtop[s] = top;
      h = top + (double)(mx->columns ? mx->nrows : nv) * g->cellH + g->sectionPad / 2;
    }
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
  L.h = last >= 0 ? last + g->pad : top0 + g->pad;
  return L;
}

static void lay_free(laid *L) { free(L->sections), free(L->cx), free(L->cy), free(L->drawn), free(L->curves), free(L->mtop); }

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

static void draw_knob(const omx_draw *d, double cx, double cy, double r, double f, const palette *col, omx_scene *scene, double knob_px) {
  /* a look with a knob drawing wears it, scaled to this knob: the scene the MOD GUI's film strip is made from (tools/modgui-gen.mjs drawKnob) */
  if (scene && d->scene) {
    double k = (2 * r) / knob_px, half = omx_scene_size(scene) / 2;
    d->scene(d->ctx, scene, cx - half * k, cy - half * k, k, -135 + 270 * fmin(1, fmax(0, f)));
    return;
  }
  d->disc(d->ctx, cx, cy, r, col->rim);
  d->disc(d->ctx, cx, cy, r - fmax(1, r * 0.08), col->body);
  double th = (-135 + 270 * fmin(1, fmax(0, f))) * (M_PI / 180);
  double sx = sin(th), sy = -cos(th);
  d->segment(d->ctx, cx + sx * r * 0.28, cy + sy * r * 0.28, cx + sx * r * 0.78, cy + sy * r * 0.78, fmax(0.75, r * 0.08), col->pointer);
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

/* The spectrum a host set on an eq_response (omx_panel_view_set_spectrum), on the console analyser's axes (its scene
 * builder, line mode): x the log frequency axis the bands and the curve share, y the level window with ONE graticule, a line every grid_db
 * from the top and a label on each line inside the window; under it the trace's area to the foot in the meter gradient (red at
 * the top, amber at 0.18, green from 0.5 down) at 0.34, then the trace, a clip tick at the top over each band whose peak reaches
 * the top, then the curve, a gain parked with 0 dB at the window's middle, and its marks on the same axis. A silent band
 * (-INFINITY) is drawn as nothing: the trace and its area break there. */
static void draw_analyser(const omx_draw *d, omx_font *font, const textsizes *T, const display *c, double ix, double iy, double iw,
                          double ih, double s, const palette *col) {
  const double lo = c->spec_min, hi = c->spec_max, mid = (lo + hi) / 2;
  double f0 = c->spec_hz[0], f1 = c->spec_hz[c->nspec - 1];
  if (c->n >= 2) f0 = fmin(f0, c->x[0]), f1 = fmax(f1, c->x[c->n - 1]);
  if (!(f1 > f0)) f1 = f0 * 10;
  const double x0 = log10(f0), x1 = log10(f1);
#define AX(hz) (ix + (log10(hz) - x0) / (x1 - x0) * iw)
#define AY(db) (iy + (hi - fmin(hi, fmax(lo, (db)))) / (hi - lo) * ih)
  for (int k = 0;; k++) {
    double g = hi - k * c->spec_grid, y;
    if (g < lo - c->spec_grid * 1e-9) break;
    y = AY(g);
    d->segment(d->ctx, ix, y, ix + iw, y, fmax(0.5, 0.5 * s), col->rim);
    if (g > lo + c->spec_grid * 1e-9 && k > 0) {
      char label[24];
      snprintf(label, sizeof label, "%g", fabs(g) < 1e-9 ? 0.0 : g);
      text(d, font, label, 0, iw, ix + 3 * s, y - 2 * s, T->small * s, col->inkDim, OMX_ALIGN_LEFT);
    }
  }
  static const double stop_t[4] = {0, 0.18, 0.5, 1};
  const omx_rgb stops[4] = {col->meterRed, col->meterAmber, col->meterGreen, col->meterGreen};
  double *xs = malloc(c->nspec * sizeof *xs), *ys = malloc(c->nspec * sizeof *ys);
  for (size_t k = 0; xs && ys && k < c->nspec;) {
    size_t m = 0;
    for (; k < c->nspec && isfinite(c->spec_db[k]); k++) xs[m] = AX(c->spec_hz[k]), ys[m] = AY(c->spec_db[k]), m++;
    if (m >= 2) {
      d->fill_under(d->ctx, xs, ys, m, iy + ih, iy, iy + ih, stop_t, stops, 4, 0.34);
      for (size_t j = 1; j < m; j++) d->segment(d->ctx, xs[j - 1], ys[j - 1], xs[j], ys[j], fmax(0.75, 0.75 * s), col->accent);
    }
    if (k < c->nspec && !isfinite(c->spec_db[k])) k++;
  }
  free(xs), free(ys);
  for (size_t k = 0; k < c->nspec; k++)
    if (c->spec_peak[k] >= hi) d->round_rect(d->ctx, AX(c->spec_hz[k]) - 1.5 * s, iy, 3 * s, 4 * s, 0, col->meterRed);
  for (size_t k = 1; k < c->n; k++)
    d->segment(d->ctx, AX(c->x[k - 1]), AY(mid + c->y[k - 1]), AX(c->x[k]), AY(mid + c->y[k]), fmax(0.75, 0.75 * s), col->curve);
  for (size_t k = 0; c->n >= 2 && k < c->nmarks; k++) {
    double qx = AX(c->mark_freq[k]), qy = AY(mid + c->mark_depth[k]);
    char one[2] = {c->mark_letter[k], 0};
    d->disc(d->ctx, qx, qy, fmax(2, 2.5 * s), col->ink);
    text(d, font, one, 0, iw, qx, qy - 5 * s, T->small * s, col->ink, OMX_ALIGN_CENTRE);
  }
#undef AX
#undef AY
}

/* A colour part way from `a` to `b`: `t` of the way, for a stem dimmed by its shade. */
static omx_rgb towards(omx_rgb a, omx_rgb b, double t) {
  omx_rgb o;
  for (int k = 0; k < 3; k++) o.c[k] = (uint8_t)omx_round(a.c[k] + (b.c[k] - a.c[k]) * t);
  return o;
}

/* A time response (the processing-view spec, amendment 2026-09-16h): x is time in ms from 0 to the content's end (the last point or
 * stem), y is level in dB on the window from the floor, -60, to 0, raised to the next 6 dB when a level exceeds 0. The envelope the host
 * gave is a polyline, each stem a segment from the floor to its level, its paint dimmed by its shade toward the body, its leg letter
 * above. The 0 dB line is the reference. No point is computed here. */
static void draw_time(const omx_draw *d, omx_font *font, const textsizes *T, const display *c, double ix, double iy, double iw, double ih,
                      double s, double w, const palette *col) {
  double xmax = 0, ymax = 0;
  for (size_t k = 0; k < c->n; k++) xmax = fmax(xmax, c->x[k]), ymax = fmax(ymax, c->y[k]);
  for (size_t k = 0; k < c->nstems; k++) xmax = fmax(xmax, c->stem_x[k]), ymax = fmax(ymax, c->stem_y[k]);
  if (!(xmax > 0)) xmax = 1;
  const double lo = -60, hi = ymax > 0 ? ceil(ymax / 6) * 6 : 0;
  double qy0 = iy + ih - ((0 - lo) / (hi - lo)) * ih;
  d->segment(d->ctx, ix, qy0, ix + iw, qy0, fmax(0.5, 0.5 * s), col->rim);
  double px = 0, py = 0;
  for (size_t k = 0; k < c->n; k++) {
    double qx = ix + (c->x[k] / xmax) * iw, qy = iy + ih - ((fmax(c->y[k], lo) - lo) / (hi - lo)) * ih;
    if (k) d->segment(d->ctx, px, py, qx, qy, fmax(0.75, 0.75 * s), col->curve);
    px = qx, py = qy;
  }
  for (size_t k = 0; k < c->nstems; k++) {
    if (!(c->stem_y[k] > lo)) continue; /* a stem at or below the floor is not there */
    double qx = ix + (c->stem_x[k] / xmax) * iw, qy = iy + ih - ((c->stem_y[k] - lo) / (hi - lo)) * ih;
    d->segment(d->ctx, qx, iy + ih, qx, qy, fmax(1, 1.25 * s), towards(col->body, col->accent, c->stem_shade[k]));
    if (c->stem_letter[k] != ' ') {
      /* the letter's baseline sits 3 px over the stem's top; a stem at the ceiling would put it over the frame, so it is
       * held to the frame's top (the text is baseline-aligned: the glyph occupies the size above the baseline) */
      char one[2] = {c->stem_letter[k], 0};
      text(d, font, one, 0, w, qx, fmax(qy - 3 * s, iy + T->small * s), T->small * s, col->ink, OMX_ALIGN_CENTRE);
    }
  }
}

/* A curve: its frame, its axis, the points the host gave as a polyline, and the basis word in the caption place. The axes are the
 * display's `axis` word over the points' extent: log-frequency (an eq_response) is a log frequency axis with the dB symmetric about 0, to
 * the next 6 dB; linear (a transfer_curve) is linear dB, input and output on one span, with the unity line; time, below. No point is computed here. With no points the frame and the caption stand: a
 * modelled curve is never read as the plugin's response, so the word is always there. */
static void draw_curve(const omx_draw *d, omx_font *font, const textsizes *T, const display *c, double x, double y, double w, double h, double s,
                       const palette *col) {
  d->round_rect(d->ctx, x, y, w, h, fmin(4, h / 4), col->rim);
  d->round_rect(d->ctx, x + 1, y + 1, w - 2, h - 2, fmin(3, h / 4), col->body);
  double ix = x + 5 * s, iy = y + 5 * s, iw = w - 10 * s, ih = h - 10 * s - 12 * s;
  if (c->nspec)
    draw_analyser(d, font, T, c, ix, iy, iw, ih, s, col);
  else if (c->time_x) {
    if (c->n >= 2 || c->nstems) draw_time(d, font, T, c, ix, iy, iw, ih, s, w, col);
  } else if (c->n >= 2) {
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
      if (k) d->segment(d->ctx, px, py, qx, qy, fmax(0.75, 0.75 * s), col->curve);
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
  if (!v->headless) {
    d->round_rect(d->ctx, s, (g->headH - 2) * s, (L.w - 2) * s, 2 * s, 0, col->accent);
    d->disc(d->ctx, (L.w - g->pad - 10) * s, (g->headH / 2) * s, 5 * s, col->accent);
    double head_w = (L.w - 2 * g->pad - 24) * s;
    text(d, font, v->brand, 1, head_w, g->pad * s, T->brandBase * s, T->brand * s, col->inkDim, OMX_ALIGN_LEFT);
    text(d, font, v->name, 0, head_w, g->pad * s, T->titleBase * s, T->title * s, col->ink, OMX_ALIGN_LEFT);
  }
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
    /* a head-row cell with no control is its head's caption: the head's label in that cell's name place, a row of its own */
    const matrix *mx = matrix_of_section(v, si);
    if (mx) {
      int *map = malloc((mx->nheads ? mx->nheads : 1) * sizeof *map);
      visible_heads(mx, map);
      for (size_t h = 0; h < mx->nheads; h++) {
        if (map[h] < 0 || mx->cell[(size_t)mx->head_row * mx->nheads + h] >= 0) continue;
        double cx, cy;
        grid_at(g, mx, L.mtop[si], map[h], mx->head_row, &cx, &cy);
        text(d, font, mx->heads[h].label, 0, (g->cellW - 4) * s, (sec.x + cx + g->cellW / 2) * s, (sec.y + cy + T->nameBase) * s, T->small * s, col->inkDim,
             OMX_ALIGN_CENTRE);
      }
      free(map);
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
        draw_knob(d, (x + g->cellW / 2) * s, (y + g->knobTop + g->knob / 2) * s, (g->knob / 2) * s, k->fraction, col, v->knob_scene, g->knob);
        break;
      default: /* a meter fills its frame; a display, a curve and an xy pad show a frame until each has its own drawing */
        draw_display(d, (x + (g->cellW - g->selectorW) / 2) * s, (y + g->selectorTop) * s, g->selectorW * s, g->selectorH * s,
                     k->w == W_METER ? k->fraction : 0, col);
        reading = 1;
      }
      double mid = (x + g->cellW / 2) * s, w = (g->cellW - 4) * s;
      /* a selector's and a display's label stands under its control; every other label sits on its value strip (geometry.json) */
      int strip = !reading && (k->bar || k->w != W_SELECTOR);
      text(d, font, k->bar ? k->bar : k->label, 0, w, mid, (y + (strip ? T->nameBaseStrip : T->nameBase)) * s, T->small * s, col->inkDim, OMX_ALIGN_CENTRE);
      if (!k->bar && k->w == W_SELECTOR)
        text(d, font, k->text, 0, (g->selectorW - 8) * s, mid, (y + g->selectorTop + g->selectorH / 2 + T->small * 0.36) * s,
             T->small * s, col->ink, OMX_ALIGN_CENTRE);
      else if (strip) {
        /* the scribble strip: a recessed well the value is set in */
        double sw = g->scribbleW * s;
        d->round_rect(d->ctx, mid - sw / 2, (y + g->cellH - g->scribbleH) * s, sw, g->scribbleH * s, 3 * s, col->scribbleBg);
        text(d, font, k->text, 0, sw - 4 * s, mid, (y + T->valueBase) * s, T->small * s, col->scribbleInk, OMX_ALIGN_CENTRE);
      } else if (k->text[0])
        text(d, font, k->text, 0, w, mid, (y + T->readingBase) * s, T->small * s, col->ink, OMX_ALIGN_CENTRE);
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
static void cpu_fill_under(void *c, const double *xs, const double *ys, size_t n, double base_y, double y0, double y1, const double *t,
                           const omx_rgb *stops, size_t nstops, double alpha) {
  omx_fill_under(c, xs, ys, n, base_y, y0, y1, t, stops, nstops, alpha);
}
static void cpu_scene(void *c, omx_scene *sc, double ox, double oy, double k, double angle) { omx_scene_paint(c, sc, ox, oy, k, angle); }
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
  const omx_draw d = {&cv, cpu_round_rect, cpu_disc, cpu_segment, cpu_fill_under, cpu_text, cpu_scene};
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
