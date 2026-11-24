/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * scene_driver — paints one drawing of a look.json (the vintage knob's scene) on a transparent canvas through omx_scene_paint, for
 * test/scene.test.mjs, which holds it byte for byte to tools/svg-knob.mjs painting the same scene.
 *   scene_driver <look.json> <drawing> <finish> <angle> <k> <ox> <oy> <w> <h> <out.raw>
 * Writes w*h*4 bytes, R G B A, straight alpha. Exit 0, 2 for usage, 1 when the scene is refused (its reason on stderr).
 */
#include <cjson/cJSON.h>
#include <stdio.h>
#include <stdlib.h>

#include "../src/raster.h"
#include "../src/scene.h"

static char *slurp(const char *path) {
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

int main(int argc, char **argv) {
  if (argc != 11) {
    fprintf(stderr, "usage: scene_driver <look.json> <drawing> <finish> <angle> <k> <ox> <oy> <w> <h> <out.raw>\n");
    return 2;
  }
  char *json = slurp(argv[1]);
  if (!json) { fprintf(stderr, "scene_driver: cannot read %s\n", argv[1]); return 2; }
  cJSON *root = cJSON_Parse(json);
  char err[256] = "";
  omx_scene *s = root ? omx_scene_from_look(root, argv[2], argv[3], err, sizeof err) : NULL;
  if (!s) { fprintf(stderr, "scene_driver: %s\n", root ? err : "look.json is not JSON"); return 1; }
  int w = atoi(argv[8]), h = atoi(argv[9]);
  omx_canvas c = {calloc((size_t)w * h * 4, 1), w, h, (size_t)w * 4, 0, 0, 0, w, h};
  omx_scene_paint(&c, s, atof(argv[6]), atof(argv[7]), atof(argv[5]), atof(argv[4]));
  FILE *o = fopen(argv[10], "wb");
  if (!o || fwrite(c.px, 1, (size_t)w * h * 4, o) != (size_t)w * h * 4) { fprintf(stderr, "scene_driver: cannot write %s\n", argv[10]); return 2; }
  fclose(o);
  omx_scene_free(s);
  cJSON_Delete(root);
  free(c.px);
  free(json);
  return 0;
}
