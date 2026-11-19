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

/** Paint the scene onto `c`, its origin at (ox, oy), `k` device px per scene unit, the pointer at `angle` degrees from straight up. */
void omx_scene_paint(omx_canvas *c, const omx_scene *s, double ox, double oy, double k, double angle);

/** The scene's side in units (its viewBox). */
double omx_scene_size(const omx_scene *s);

#endif
