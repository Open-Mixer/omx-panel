/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas
 *
 * gesture_driver — the test driver of the gesture unit: it runs cases through omx_gesture_run, the C reference of
 * docs/panel-gestures.md, and prints the answers. test/gesture-c.test.mjs feeds it the shipped scripted fixtures and holds its
 * answers to tools/gestures.mjs's.
 *
 *   gesture_driver <gestures.json> <cases.json>
 *
 * <cases.json> is an array of {"settings": "<JSON text>", "control": "<JSON text>", "events": "<JSON text>"}: each part is a string, so the
 * text reaches omx_gesture_run byte for byte as a caller would give it (re-printing a number through a JSON library can lose its last
 * digit). stdout is the array of the answers, each the
 * JSON text omx_gesture_run wrote, in the same order. Exit 0 when every case was run, 1 when a case's context could not be
 * opened, 2 usage or a file that cannot be read.
 */
#include <cjson/cJSON.h>
#include <stdio.h>
#include <stdlib.h>

#include "omx_panel_gesture.h"

static char *slurp(const char *path) {
  FILE *f = fopen(path, "rb");
  if (!f) return NULL;
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  rewind(f);
  char *s = n >= 0 ? malloc((size_t)n + 1) : NULL;
  if (s && fread(s, 1, (size_t)n, f) == (size_t)n) s[n] = 0;
  else free(s), s = NULL;
  fclose(f);
  return s;
}

int main(int argc, char **argv) {
  if (argc != 3) return fprintf(stderr, "usage: gesture_driver <gestures.json> <cases.json>\n"), 2;
  char *decl = slurp(argv[1]), *text = slurp(argv[2]);
  cJSON *cases = text ? cJSON_Parse(text) : NULL;
  if (!decl || !cJSON_IsArray(cases)) {
    fprintf(stderr, "gesture_driver: cannot read the declaration or the cases\n");
    cJSON_Delete(cases), free(decl), free(text);
    return 2;
  }
  int rc = 0;
  printf("[");
  cJSON *c;
  int first = 1;
  cJSON_ArrayForEach(c, cases) {
    const char *settings = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(c, "settings"));
    const char *control = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(c, "control"));
    const char *events = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(c, "events"));
    omx_gesture_t *ctx = omx_gesture_open(decl, settings);
    if (!ctx) {
      rc = 1;
      fprintf(stderr, "gesture_driver: the context did not open\n");
    } else {
      size_t need = omx_gesture_run(ctx, control, events, NULL, 0);
      char *answer = malloc(need + 1);
      size_t got = answer ? omx_gesture_run(ctx, control, events, answer, need + 1) : 0;
      printf("%s%s", first ? "" : ",", got == need && answer ? answer : "null");
      first = 0;
      free(answer);
      omx_gesture_close(ctx);
    }
  }
  printf("]\n");
  cJSON_Delete(cases);
  free(decl), free(text);
  return rc;
}
