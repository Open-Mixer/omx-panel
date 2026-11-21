/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> */
/**
 * @file
 * @brief The descriptions store's reader and writer (docs/descriptions-store.md, section 5).
 *
 * Three files `panel.sqlite`, merged whole per entry: the user layer over the system layer over the base. NEVER IN A
 * REAL-TIME PATH: every call allocates, reads files and takes locks. A plugin window and plugin-hostd read an entry
 * when a plugin is added or a window opens, and copy what they keep. A handle is used by one thread at a time.
 *
 * Every refusal is a status: omx_panel_store_code() gives its code (`panel-store.absent` ...), and the handle or the
 * error struct names the file and the reason. The loader's own codes (`contract.dir.absent` ...) pass through.
 */
#ifndef OMX_PANEL_STORE_H
#define OMX_PANEL_STORE_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* the library builds with -fvisibility=hidden: what this header declares is the API, and src/exports.map lists it */
#pragma GCC visibility push(default)

/** The version of the derivation's rules, raised by every change that moves describe's or the inference's output for
 *  the same input (3.6). Held here, once; the golden test of test/rules-golden.test.mjs reads this line. */
#define OMX_PANEL_RULES_VERSION 4

/** A status: 0, OMX_PANEL_STORE_NO_ENTRY, or a refusal (omx_panel_store_code() names it). A loader refusal is a
 *  positive status above OMX_PANEL_STORE_LOADER_BASE: the loader's own value plus the base. */
enum {
    OMX_PANEL_STORE_OK = 0,
    OMX_PANEL_STORE_NO_ENTRY = 1,            /**< omx_panel_store_get: no layer holds the key (or every entry of it is stale) */
    OMX_PANEL_STORE_ABSENT = 2,
    OMX_PANEL_STORE_UNREADABLE = 3,
    OMX_PANEL_STORE_NOT_A_STORE = 4,
    OMX_PANEL_STORE_SCHEMA_MISMATCH = 5,
    OMX_PANEL_STORE_SCHEMA_OTHER = 6,
    OMX_PANEL_STORE_DOMAIN_TOO_OLD = 7,
    OMX_PANEL_STORE_WORD_UNKNOWN = 8,
    OMX_PANEL_STORE_HOT_JOURNAL = 9,
    OMX_PANEL_STORE_BUSY = 10,
    OMX_PANEL_STORE_ENTRY_INVALID = 11,
    OMX_PANEL_STORE_LOADER_BASE = 1000
};

typedef struct omx_panel_store omx_panel_store;          /**< opened layers; opaque */
typedef enum { OMX_PANEL_STORE_SCOPE_USER, OMX_PANEL_STORE_SCOPE_SYSTEM } omx_panel_store_scope;
typedef struct { const char *code; char message[256]; } omx_panel_store_error;

/** The code string of a status (`panel-store.absent`), static; NULL for 0, NO_ENTRY and what is no code. */
const char *omx_panel_store_code(int status);
/** The schema version this library reads and writes: `PRAGMA user_version` of schema/panel.sql. */
int omx_panel_store_schema_version(void);

/** Production: the installed base, the system layer and, for the USER scope, the home's layer (from the password
 *  database by the effective uid). No path, no environment variable: not XDG_DATA_HOME, not HOME, not OMX_CONTRACT_PATH.
 *  An absent system or user layer is an empty layer; an absent base is OMX_PANEL_STORE_ABSENT. */
int  omx_panel_store_open(omx_panel_store_scope scope, omx_panel_store **out, omx_panel_store_error *err);
/** TEST AND COMMAND ONLY: the four places given (NULL: no such layer; contract_dir NULL: the installed one). No
 *  production binary calls it. */
int  omx_panel_store_open_at(const char *base, const char *system, const char *user, const char *contract_dir,
                             omx_panel_store **out, omx_panel_store_error *err);
void omx_panel_store_close(omx_panel_store *s);
/** TEST AND COMMAND ONLY: the reader's OMX_PANEL_RULES_VERSION, for a test of the rules rule. */
void omx_panel_store_set_rules(omx_panel_store *s, int rules);
/** The reason of the last refusal of a call on s (get, put, remove), naming the file; "" when none. */
const char *omx_panel_store_message(const omx_panel_store *s);

typedef struct { const char *sha256, *format, *uri; } omx_panel_store_key;
typedef struct { const char *symbol, *name, *rule; long display_priority; int declared;
                 const char *const *ports; size_t nports; } omx_panel_store_group;
/** A control of the stored derivation, in the derivation's control order: what the skin, the matrices and the pages
 *  read (section 3.4). group_key is NULL when the control has none. */
typedef struct { const char *symbol, *key, *id, *group_key; int governed; } omx_panel_store_control;
typedef struct {
    const char *layer;                                   /**< "user", "system" or "base" */
    const char *stale_edit_layer;                        /**< a layer whose edited entry was skipped as stale, or NULL */
    int edited; const char *made_by, *family, *fingerprint;
    const char *body;                                    /**< the description as JSON, or NULL when refused */
    const char *repeated_groups;                         /**< the repeated groups inferGroupModel found, as JSON; NULL when refused */
    const char *refused;                                 /**< the DESCRIBE_CODES word, or NULL */
    const char *group_outcome, *group_reason;            /**< NULL: no verdict (a CLAP plugin) */
    const omx_panel_store_group *groups; size_t ngroups; /**< by display priority, then symbol; ports in the order written */
    const omx_panel_store_control *controls; size_t ncontrols;
} omx_panel_store_entry;

/** 0 and *e filled, valid until the next call on s; OMX_PANEL_STORE_NO_ENTRY for a key no layer holds (*e then names
 *  only stale_edit_layer); another value is a refusal (a layer locked or with a hot journal at the time).
 *  source: the caller's omx_panel_store_source() of the plugin as installed (3.6); a stale entry is skipped. */
int  omx_panel_store_get(omx_panel_store *s, const omx_panel_store_key *k, const char *source, omx_panel_store_entry *e);
/** The SHA-256 of the derivation's input as installed (3.6), 64 lowercase hex digits and a NUL in hex_out. For `lv2`,
 *  path is the bundle directory: its `.ttl` files in byte order of their names, each as its name, a NUL and its bytes.
 *  For `clap`, path is the descriptor file: its JSON, canonical (object keys in byte order, no white space). */
int  omx_panel_store_source(const char *format, const char *path, char hex_out[65]);

/** The writer: the layer of the effective uid (the system layer as root, the user layer otherwise), created from
 *  schema/panel.sql when absent. Never both, never the base. */
int  omx_panel_store_writer_open(omx_panel_store **out, omx_panel_store_error *err);
/** TEST AND COMMAND ONLY: the writer of the file at path, as layer 1 (system) or 2 (user). */
int  omx_panel_store_writer_open_at(const char *path, int layer, const char *contract_dir,
                                    omx_panel_store **out, omx_panel_store_error *err);
/** Replaces the key's whole entry in the writer's layer, in one transaction. entry_json is one JSON object:
 *  edited (0|1), made_by, rules (>= 1), source (64 hex), family (a PANEL_FAMILIES word), fingerprint (64 hex), body
 *  (object|null), groups (value|null), refused (a PANEL_DESCRIBE_CODES word|null), controls (array of {symbol, key, id,
 *  group_key?, governed?}), verdict (null|{outcome, reason?, groups: [{symbol, name, display_priority, rule, declared,
 *  ports[]}]}). body and refused are exactly one; groups is null exactly when body is. OMX_PANEL_STORE_ENTRY_INVALID
 *  for anything else, and nothing is written. */
int  omx_panel_store_put(omx_panel_store *w, const omx_panel_store_key *k, const char *entry_json, omx_panel_store_error *err);
/** Removes the key's entry from the writer's layer: the lower layer's entry answers again. Not there is not an error. */
int  omx_panel_store_remove(omx_panel_store *w, const omx_panel_store_key *k, omx_panel_store_error *err);

#pragma GCC visibility pop

#ifdef __cplusplus
}
#endif

#endif
