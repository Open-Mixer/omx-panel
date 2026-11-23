/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * scene.h — a drawing of tools/look.json (`drawings`: a scene of shapes and gradients whose colours are placeholders of the look) read
 * once and painted by coverage: the vintage knob (omx-panel#123). The drawing is DATA of the look and the one source: the MOD GUI's
 * film strips and face are painted from it by tools/svg-knob.mjs, the renderer by this, and test/scene.test.mjs holds the two equal to
 * the bit. Internal: the public surface is omx_panel_render.h.
 */
#ifndef OMX_PANEL_SCENE_H
#define OMX_PANEL_SCENE_H

#include <cjson/cJSON.h>
#include <stddef.h>

#include "raster.h"

typedef struct omx_scene omx_scene;

/** The drawing `drawing` of the look document `root` (look.json parsed), its placeholders set: `{--role}` from root.tokens,
 * `{console:--x}` from root.console.tokens, `{finish:--x}` from the console's finish `finish` (root.console.finish); the pointer's
 * `{angle}` stays the frame's. NULL, with the reason by name in `err`, for a drawing the look does not carry, a finish the console's
 * pin does not, a gradient of other than two stops (the two backends take two), a shape outside the subset (circle, ellipse, rect,
 * line) and a placeholder nothing carries. */
omx_scene *omx_scene_from_look(const cJSON *root, const char *drawing, const char *finish, char *err, size_t err_size);
void omx_scene_free(omx_scene *s);

/** Paint the scene onto `c`, its origin at (ox, oy), `k` device px per scene unit, the pointer at `angle` degrees from straight up.
 * It writes the scene (the static-layer cache), so one scene is not safe to paint from two threads at once; the renderer has no
 * second thread today, and a caller that paints from several gives each its own scene. */
void omx_scene_paint(omx_canvas *c, omx_scene *s, double ox, double oy, double k, double angle);

/** The static-layer cache: every shape before the pointer's (those that do not turn with the frame's angle) is painted once over a
 * given backdrop and the box kept, with the backdrop it was made over; a later paint of the same place and scale over the same
 * backdrop, byte for byte, copies the box and paints only the pointer. The bytes are those of painting without the cache. On by
 * default; off, nothing is stored and nothing is read. */
void omx_scene_set_cache(omx_scene *s, int on);
/** How many paints took a stored box (hits) and how many painted the static layers (misses), since the scene was made. */
unsigned long omx_scene_cache_hits(const omx_scene *s);
unsigned long omx_scene_cache_misses(const omx_scene *s);

/** The scene's side in units (its viewBox). */
double omx_scene_size(const omx_scene *s);

#endif
