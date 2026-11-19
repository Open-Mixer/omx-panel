/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * scene_cache_driver — the scene's static-layer cache against painting without it, for test/scene-cache.test.mjs.
 *   scene_cache_driver <look.json> <drawing> <finish> <k> <ox> <oy> <w> <h>
 * Over a backdrop that is not flat, for 7 pointer angles: the scene is painted into a copy of the backdrop with the cache off, and
 * into another with it on, twice (the second is a hit); then one backdrop pixel inside the knob changes and the painting is
 * compared again (it must be a miss, and equal), then the scale changes by a hair, the box staying the same (a miss, and equal). Prints `key value` lines: equal (1 when every pair of canvases is byte for byte
 * the same), hits, misses, stale (1 when a changed backdrop was painted from a stale patch), then the bytes' checksum.
 */
#include <cjson/cJSON.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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

static void backdrop(uint8_t *px, int w, int h) {
  for (int y = 0; y < h; y++)
    for (int x = 0; x < w; x++) {
      uint8_t *p = px + ((size_t)y * w + x) * 4;
      p[0] = (uint8_t)(20 + x * 3 + y); p[1] = (uint8_t)(40 + y * 2); p[2] = (uint8_t)(60 + x); p[3] = 255;
    }
}

int main(int argc, char **argv) {
  if (argc != 9) {
    fprintf(stderr, "usage: scene_cache_driver <look.json> <drawing> <finish> <k> <ox> <oy> <w> <h>\n");
    return 2;
  }
  char *json = slurp(argv[1]);
  if (!json) return 2;
  cJSON *root = cJSON_Parse(json);
  char err[256] = "";
  omx_scene *s = root ? omx_scene_from_look(root, argv[2], argv[3], err, sizeof err) : NULL;
  if (!s) { fprintf(stderr, "scene_cache_driver: %s\n", root ? err : "look.json is not JSON"); return 1; }
  double k = atof(argv[4]), ox = atof(argv[5]), oy = atof(argv[6]);
  int w = atoi(argv[7]), h = atoi(argv[8]);
  size_t n = (size_t)w * h * 4;
  uint8_t *base = malloc(n), *a = malloc(n), *b = malloc(n);
  backdrop(base, w, h);
  int equal = 1, stale = 0;
  const double angles[] = {-135, -90, -45, 0, 45, 90, 135};
  double k0 = k;
  for (int phase = 0; phase < 3; phase++) {
    if (phase == 2) k = k0 * 0.9999; /* the same box, a different scale: the stored patch is not this one */
    if (phase == 1) { /* one backdrop pixel inside the knob changes */
      uint8_t *p = base + (((size_t)(oy + 24 * k) * w) + (size_t)(ox + 24 * k)) * 4;
      p[0] ^= 0x55; p[2] ^= 0x33;
    }
    for (size_t i = 0; i < sizeof angles / sizeof *angles; i++) {
      for (int rep = 0; rep < 2; rep++) {
        omx_canvas ca = {a, w, h, (size_t)w * 4, 0}, cb = {b, w, h, (size_t)w * 4, 0};
        memcpy(a, base, n); memcpy(b, base, n);
        omx_scene_set_cache(s, 0);
        omx_scene_paint(&ca, s, ox, oy, k, angles[i]);
        omx_scene_set_cache(s, 1);
        omx_scene_paint(&cb, s, ox, oy, k, angles[i]);
        if (memcmp(a, b, n) != 0) { equal = 0; if (phase >= 1) stale = 1; }
      }
    }
  }
  printf("equal %d\nhits %lu\nmisses %lu\nstale %d\n", equal, omx_scene_cache_hits(s), omx_scene_cache_misses(s), stale);
  omx_scene_free(s);
  cJSON_Delete(root);
  free(base); free(a); free(b); free(json);
  return 0;
}
