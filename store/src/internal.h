/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> */
/* What the command shares with the library and the shared library does not export (src/exports.map). */
#ifndef OMX_PANEL_STORE_INTERNAL_H
#define OMX_PANEL_STORE_INTERNAL_H

#include <omx-panel/omx_panel_store.h>

#define OMX_PANEL_STORE_BASE_PATH "/usr/share/omx/panel/panel.sqlite"
#define OMX_PANEL_STORE_SYSTEM_PATH "/var/lib/omx/panel/panel.sqlite"
#define OMX_PANEL_STORE_USER_SUFFIX "/.local/share/omx/panel/panel.sqlite"

/* The places the production open reads: malloc'd strings the caller frees; *user is NULL for the SYSTEM scope. The home
 * is the password database's for the effective uid; no environment variable is read. 0, or a status. */
int omx_panel_store__places(omx_panel_store_scope scope, char **base, char **system, char **user, omx_panel_store_error *err);
/* The same rule for the writer: the system layer's path as root, the user layer's otherwise. */
int omx_panel_store__writer_place(char **path, int *layer, omx_panel_store_error *err);

/* Each key of the writer's layer, in (sha256, format, uri) order: `each` is called with the three. 0, or a status. */
int omx_panel_store__keys(omx_panel_store *w, void (*each)(const char *sha256, const char *format, const char *uri, void *ctx), void *ctx,
                          omx_panel_store_error *err);

#endif
