/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * GENERATED — DO NOT EDIT BY HAND: the colour roles of schema/look-roles.json, which read_look (view.c) requires of
 * every look its host passes, each a #rrggbb. Regenerate: `node tools/look.mjs`, then commit the result.
 */
#ifndef OMX_PANEL_LOOK_ROLES_H
#define OMX_PANEL_LOOK_ROLES_H

#define OMX_LOOK_ROLE_COUNT 22

static const char *const omx_look_roles[OMX_LOOK_ROLE_COUNT] = {
    "--surface",
    "--surface-2",
    "--surface-3",
    "--glass",
    "--border",
    "--border-strong",
    "--ink",
    "--ink-dim",
    "--ink-faint",
    "--legend",
    "--accent",
    "--meter-green",
    "--meter-amber",
    "--meter-red",
    "--eq-delta-boost",
    "--eq-delta-cut",
    "--state-engaged",
    "--state-reduction",
    "--state-bypass",
    "--origin-fbs",
    "--origin-hrp",
    "--origin-room-mode",
};

#endif
