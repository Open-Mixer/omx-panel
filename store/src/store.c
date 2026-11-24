/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> */
/* The descriptions store's reader and writer (docs/descriptions-store.md, section 5). One file, no environment. */
#define _GNU_SOURCE
#include "internal.h"
#include "schema_gen.h"

#include <cjson/cJSON.h>
#include <omxcontract/omx_domain.h>
#include <sqlite3.h>

#include <dirent.h>
#include <errno.h>
#include <pwd.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define READER_BUSY_MS 250
#define WRITER_BUSY_MS 5000
#define PLUGIN_DB_FLOOR "1.0.0"   /* the plugin-db domain that publishes PLUGIN_DB_ADDRESS_FORMATS */

enum { LAYER_BASE = 0, LAYER_SYSTEM = 1, LAYER_USER = 2 };
static const char *const LAYER_NAME[3] = { "base", "system", "user" };

typedef struct { char *path; sqlite3 *db; int layer; int version; } file_t;

struct omx_panel_store {
    file_t f[3];             /* in order of precedence: those opened, user first */
    int nf;
    int rules;
    char msg[256];
    const char *contract_dir;
    char *contract_dir_own;
    /* the writer */
    sqlite3 *w; int wlayer; char *wpath;
    omx_domain *dom_panel, *dom_plugindb;
    /* what the last get returned */
    void **keep; size_t nkeep, capkeep;
};

/* the words a column is checked against: the one table the layers' word_check rows and a put's checks are made from */
static const struct { const char *tbl, *col, *domain, *item; } WORD_CHECKS[] = {
    { "plugin", "format", "plugin-db", "PLUGIN_DB_ADDRESS_FORMATS" },
    { "description", "family", "panel", "PANEL_FAMILIES" },
    { "description", "refused", "panel", "PANEL_DESCRIBE_CODES" },
    { "port_group_verdict", "outcome", "panel", "PANEL_GROUP_OUTCOMES" },
    { "port_group_verdict", "reason", "panel", "PANEL_GROUP_REASONS" },
    { "port_group", "rule", "panel", "PANEL_GROUP_RULES" },
};
#define NWORD_CHECKS (sizeof WORD_CHECKS / sizeof WORD_CHECKS[0])

/* ------------------------------------------------------------------------------------------------ status and errors */

static const char *const CODES[] = {
    [OMX_PANEL_STORE_ABSENT] = "panel-store.absent", [OMX_PANEL_STORE_UNREADABLE] = "panel-store.unreadable",
    [OMX_PANEL_STORE_NOT_A_STORE] = "panel-store.not-a-store", [OMX_PANEL_STORE_SCHEMA_MISMATCH] = "panel-store.schema-mismatch",
    [OMX_PANEL_STORE_SCHEMA_OTHER] = "panel-store.schema-other", [OMX_PANEL_STORE_DOMAIN_TOO_OLD] = "panel-store.domain-too-old",
    [OMX_PANEL_STORE_WORD_UNKNOWN] = "panel-store.word-unknown", [OMX_PANEL_STORE_HOT_JOURNAL] = "panel-store.hot-journal",
    [OMX_PANEL_STORE_BUSY] = "panel-store.busy", [OMX_PANEL_STORE_ENTRY_INVALID] = "panel-store.entry-invalid",
};

const char *omx_panel_store_code(int status) {
    if (status >= OMX_PANEL_STORE_LOADER_BASE) return omx_domain_code(status - OMX_PANEL_STORE_LOADER_BASE);
    if (status >= OMX_PANEL_STORE_ABSENT && status <= OMX_PANEL_STORE_ENTRY_INVALID) return CODES[status];
    return NULL;
}

int omx_panel_store_schema_version(void) { return OMX_PANEL_STORE_SCHEMA_VERSION; }

static int refuse(omx_panel_store *s, omx_panel_store_error *err, int status, const char *fmt, ...) {
    char msg[256];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof msg, fmt, ap);
    va_end(ap);
    if (s) snprintf(s->msg, sizeof s->msg, "%s", msg);
    if (err) { err->code = omx_panel_store_code(status); snprintf(err->message, sizeof err->message, "%s", msg); }
    return status;
}

static int from_sqlite(int rc) {
    switch (rc & 0xff) {
    case SQLITE_BUSY: case SQLITE_LOCKED: return OMX_PANEL_STORE_BUSY;
    case SQLITE_READONLY: return OMX_PANEL_STORE_HOT_JOURNAL;
    default: return OMX_PANEL_STORE_UNREADABLE;
    }
}

static int from_loader(int rc) {
    return rc == OMX_CONTRACT_CODE_PACKAGE_TOO_OLD ? OMX_PANEL_STORE_DOMAIN_TOO_OLD : OMX_PANEL_STORE_LOADER_BASE + rc;
}

const char *omx_panel_store_message(const omx_panel_store *s) { return s ? s->msg : ""; }
void omx_panel_store_set_rules(omx_panel_store *s, int rules) { if (s) s->rules = rules; }

/* ------------------------------------------------------------------------------------------------------- places */

static char *dup_or_null(const char *p) { return p ? strdup(p) : NULL; }

int omx_panel_store__places(omx_panel_store_scope scope, char **base, char **system, char **user, omx_panel_store_error *err) {
    *base = strdup(OMX_PANEL_STORE_BASE_PATH);
    *system = strdup(OMX_PANEL_STORE_SYSTEM_PATH);
    *user = NULL;
    if (scope == OMX_PANEL_STORE_SCOPE_USER) {
        struct passwd pw, *res = NULL;
        char buf[4096];
        if (getpwuid_r(geteuid(), &pw, buf, sizeof buf, &res) != 0 || !res || !res->pw_dir || !*res->pw_dir) {
            free(*base); free(*system); *base = *system = NULL;
            return refuse(NULL, err, OMX_PANEL_STORE_UNREADABLE, "no home directory in the password database for uid %u", (unsigned)geteuid());
        }
        size_t n = strlen(res->pw_dir) + sizeof OMX_PANEL_STORE_USER_SUFFIX;
        *user = malloc(n);
        snprintf(*user, n, "%s%s", res->pw_dir, OMX_PANEL_STORE_USER_SUFFIX);
    }
    return 0;
}

int omx_panel_store__writer_place(char **path, int *layer, omx_panel_store_error *err) {
    char *b, *s, *u;
    int root = geteuid() == 0;
    int rc = omx_panel_store__places(root ? OMX_PANEL_STORE_SCOPE_SYSTEM : OMX_PANEL_STORE_SCOPE_USER, &b, &s, &u, err);
    if (rc) return rc;
    *path = root ? s : u;
    *layer = root ? LAYER_SYSTEM : LAYER_USER;
    free(b); free(root ? u : s);
    return 0;
}

/* ------------------------------------------------------------------------------------------------------ sqlite */

static char *uri_of(const char *path, const char *query) {
    size_t n = strlen(path) * 3 + strlen(query) + 16;
    char *u = malloc(n), *o = u;
    o += sprintf(o, "file:");
    for (const unsigned char *p = (const unsigned char *)path; *p; p++) {
        if (*p == '%' || *p == '?' || *p == '#') o += sprintf(o, "%%%02X", *p);
        else *o++ = (char)*p;
    }
    sprintf(o, "?%s", query);
    return u;
}

static int open_db(const char *path, int flags, const char *query, int busy_ms, sqlite3 **db) {
    char *uri = uri_of(path, query);
    int rc = sqlite3_open_v2(uri, db, flags | SQLITE_OPEN_URI, NULL);
    free(uri);
    if (rc != SQLITE_OK) { sqlite3_close(*db); *db = NULL; return rc; }
    sqlite3_busy_timeout(*db, busy_ms);
    return SQLITE_OK;
}

/* one integer or text column of the first row of sql: 0, or a sqlite code; *have is 0 when no row */
static int query_int(sqlite3 *db, const char *sql, long *out, int *have) {
    sqlite3_stmt *st;
    int rc = sqlite3_prepare_v2(db, sql, -1, &st, NULL);
    if (rc != SQLITE_OK) return rc;
    rc = sqlite3_step(st);
    *have = rc == SQLITE_ROW;
    if (*have) *out = sqlite3_column_int64(st, 0);
    sqlite3_finalize(st);
    return rc == SQLITE_ROW || rc == SQLITE_DONE ? SQLITE_OK : rc;
}

/* a safe identifier of a word_check row: the names the file holds are used in SQL, so they are lower-case words */
static int identifier(const char *s) {
    if (!s || !*s) return 0;
    for (; *s; s++) if (!((*s >= 'a' && *s <= 'z') || (*s >= '0' && *s <= '9') || *s == '_')) return 0;
    return 1;
}

/* ----------------------------------------------------------------------------------------------- domains and words */

typedef struct { char name[64]; omx_domain *d; } dom_t;
#define MAXDOM 8

static int open_domain(const char *dir, const char *name, const char *floor, omx_domain **d, omx_panel_store_error *err) {
    omx_domain_error de;
    int rc = dir ? omx_domain_open_at(dir, name, floor, d, &de) : omx_domain_open(name, floor, d, &de);
    if (rc) {
        int st = from_loader(rc);
        refuse(NULL, err, st, "domain %s at or above %s: %s", name, floor, de.message);
        if (err && st >= OMX_PANEL_STORE_LOADER_BASE) err->code = de.code;
        return st;
    }
    return 0;
}

static void close_domains(dom_t *doms, int n) { for (int i = 0; i < n; i++) omx_domain_close(doms[i].d); }

static dom_t *find_domain(dom_t *doms, int n, const char *name) {
    for (int i = 0; i < n; i++) if (!strcmp(doms[i].name, name)) return &doms[i];
    return NULL;
}

/* the domains a file was checked against, each opened at the version recorded; then every word of the checked columns */
static int check_file_words(const file_t *f, const char *dir, int check_words, omx_panel_store *s, omx_panel_store_error *err) {
    dom_t doms[MAXDOM];
    int nd = 0, st = 0, rc;
    sqlite3_stmt *q = NULL;
    rc = sqlite3_prepare_v2(f->db, "SELECT domain, version FROM store_domain ORDER BY domain", -1, &q, NULL);
    if (rc != SQLITE_OK) return refuse(s, err, from_sqlite(rc), "%s: store_domain: %s", f->path, sqlite3_errmsg(f->db));
    while ((rc = sqlite3_step(q)) == SQLITE_ROW && nd < MAXDOM) {
        const char *name = (const char *)sqlite3_column_text(q, 0), *ver = (const char *)sqlite3_column_text(q, 1);
        omx_panel_store_error e2;
        doms[nd].d = NULL;
        st = open_domain(dir, name, ver, &doms[nd].d, &e2);
        if (st) { refuse(s, err, st, "%s: %s", f->path, e2.message); if (err) err->code = e2.code; break; }
        snprintf(doms[nd].name, sizeof doms[nd].name, "%s", name);
        nd++;
    }
    if (!st && rc != SQLITE_DONE && rc != SQLITE_ROW) st = refuse(s, err, from_sqlite(rc), "%s: store_domain: %s", f->path, sqlite3_errmsg(f->db));
    sqlite3_finalize(q);
    if (st || !check_words) { close_domains(doms, nd); return st; }

    /* every word of a column is in one of the column's items */
    rc = sqlite3_prepare_v2(f->db, "SELECT tbl, col, domain, item FROM word_check ORDER BY tbl, col, domain, item", -1, &q, NULL);
    if (rc != SQLITE_OK) { close_domains(doms, nd); return refuse(s, err, from_sqlite(rc), "%s: word_check: %s", f->path, sqlite3_errmsg(f->db)); }
    char (*rows)[4][96] = NULL;
    size_t nr = 0, cap = 0;
    while (sqlite3_step(q) == SQLITE_ROW) {
        if (nr == cap) { cap = cap ? cap * 2 : 16; rows = realloc(rows, cap * sizeof *rows); }
        for (int i = 0; i < 4; i++) snprintf(rows[nr][i], sizeof rows[nr][i], "%s", sqlite3_column_text(q, i));
        nr++;
    }
    sqlite3_finalize(q);
    for (size_t i = 0; i < nr && !st; i++) {
        if (i > 0 && !strcmp(rows[i][0], rows[i - 1][0]) && !strcmp(rows[i][1], rows[i - 1][1])) continue;   /* a column once */
        if (!identifier(rows[i][0]) || !identifier(rows[i][1])) { st = refuse(s, err, OMX_PANEL_STORE_NOT_A_STORE, "%s: word_check names %s.%s, which is no column", f->path, rows[i][0], rows[i][1]); break; }
        char sql[256];
        snprintf(sql, sizeof sql, "SELECT DISTINCT \"%s\" FROM \"%s\" WHERE \"%s\" IS NOT NULL", rows[i][1], rows[i][0], rows[i][1]);
        if (sqlite3_prepare_v2(f->db, sql, -1, &q, NULL) != SQLITE_OK) { st = refuse(s, err, OMX_PANEL_STORE_NOT_A_STORE, "%s: word_check names %s.%s, which is no column", f->path, rows[i][0], rows[i][1]); break; }
        while ((rc = sqlite3_step(q)) == SQLITE_ROW && !st) {
            const char *w = (const char *)sqlite3_column_text(q, 0);
            int found = 0;
            for (size_t j = i; j < nr && !strcmp(rows[j][0], rows[i][0]) && !strcmp(rows[j][1], rows[i][1]); j++) {
                dom_t *dm = find_domain(doms, nd, rows[j][2]);
                omx_domain_word_info wi;
                if (dm && omx_domain_word(dm->d, rows[j][3], w, &wi) == 0) { found = 1; break; }
            }
            if (!found) st = refuse(s, err, OMX_PANEL_STORE_WORD_UNKNOWN, "%s: %s.%s holds \"%s\", a word of none of its items", f->path, rows[i][0], rows[i][1], w);
        }
        sqlite3_finalize(q);
        if (!st && rc != SQLITE_DONE && rc != SQLITE_ROW) st = refuse(s, err, from_sqlite(rc), "%s: %s", f->path, sqlite3_errmsg(f->db));
    }
    free(rows);
    close_domains(doms, nd);
    return st;
}

/* ---------------------------------------------------------------------------------------------------------- open */

static void free_files(omx_panel_store *s) {
    for (int i = 0; i < s->nf; i++) { sqlite3_close(s->f[i].db); free(s->f[i].path); }
    s->nf = 0;
}

/* add the file at path as layer: 0 and *added 1; or 0 and *added 0 for an absent layer; or a status */
static int open_file(omx_panel_store *s, const char *path, int layer, omx_panel_store_error *err) {
    struct stat st;
    if (stat(path, &st) != 0) {
        if (errno == ENOENT || errno == ENOTDIR) return layer == LAYER_BASE ? refuse(s, err, OMX_PANEL_STORE_ABSENT, "%s: the base store does not exist", path) : 0;
        return refuse(s, err, OMX_PANEL_STORE_UNREADABLE, "%s: %s", path, strerror(errno));
    }
    if (!S_ISREG(st.st_mode)) return refuse(s, err, OMX_PANEL_STORE_UNREADABLE, "%s: not a regular file", path);
    file_t *f = &s->f[s->nf];
    f->path = strdup(path);
    f->layer = layer;
    int rc = open_db(path, SQLITE_OPEN_READONLY, layer == LAYER_BASE ? "mode=ro&immutable=1" : "mode=ro", READER_BUSY_MS, &f->db);
    if (rc != SQLITE_OK) { free(f->path); return refuse(s, err, OMX_PANEL_STORE_UNREADABLE, "%s: cannot open: %s", path, sqlite3_errstr(rc)); }
    long v = 0; int have = 0;
    rc = query_int(f->db, "PRAGMA user_version", &v, &have);
    if (rc != SQLITE_OK) {
        int stc = from_sqlite(rc);
        refuse(s, err, stc, "%s: %s", path, sqlite3_errmsg(f->db));
        sqlite3_close(f->db); free(f->path);
        return stc;
    }
    f->version = (int)v;
    s->nf++;
    return 0;
}

static int check_files(omx_panel_store *s, omx_panel_store_error *err) {
    /* one version across the files, checked first */
    int differ = 0;
    for (int i = 1; i < s->nf; i++) if (s->f[i].version != s->f[0].version) differ = 1;
    if (differ) {
        char msg[256] = "the store files are at different versions:";
        for (int i = 0; i < s->nf; i++) {
            size_t n = strlen(msg);
            snprintf(msg + n, sizeof msg - n, " %s is at %d,", s->f[i].path, s->f[i].version);
        }
        msg[strlen(msg) - 1] = '.';
        return refuse(s, err, OMX_PANEL_STORE_SCHEMA_MISMATCH, "%s", msg);
    }
    for (int i = 0; i < s->nf; i++) {
        file_t *f = &s->f[i];
        if (f->version == 0) return refuse(s, err, OMX_PANEL_STORE_NOT_A_STORE, "%s: user_version 0, no store", f->path);
        if (f->version != OMX_PANEL_STORE_SCHEMA_VERSION)
            return refuse(s, err, OMX_PANEL_STORE_SCHEMA_OTHER, "%s: schema version %d, this reader reads %d", f->path, f->version, OMX_PANEL_STORE_SCHEMA_VERSION);
        long layer = -1; int have = 0;
        int rc = query_int(f->db, "SELECT layer FROM store_info WHERE one = 1", &layer, &have);
        if (rc != SQLITE_OK) {
            if ((rc & 0xff) == SQLITE_ERROR) return refuse(s, err, OMX_PANEL_STORE_NOT_A_STORE, "%s: no store_info table", f->path);
            return refuse(s, err, from_sqlite(rc), "%s: %s", f->path, sqlite3_errmsg(f->db));
        }
        if (!have) return refuse(s, err, OMX_PANEL_STORE_NOT_A_STORE, "%s: no store_info row", f->path);
        if (layer != f->layer) return refuse(s, err, OMX_PANEL_STORE_NOT_A_STORE, "%s: a file of layer %ld opened as %s", f->path, layer, LAYER_NAME[f->layer]);
    }
    for (int i = 0; i < s->nf; i++) {
        int st = check_file_words(&s->f[i], s->contract_dir, 1, s, err);
        if (st) return st;
    }
    return 0;
}

int omx_panel_store_open_at(const char *base, const char *system, const char *user, const char *contract_dir,
                            omx_panel_store **out, omx_panel_store_error *err) {
    *out = NULL;
    omx_panel_store *s = calloc(1, sizeof *s);
    s->rules = OMX_PANEL_RULES_VERSION;
    s->contract_dir_own = dup_or_null(contract_dir);
    s->contract_dir = s->contract_dir_own;
    int st = 0;
    if (!base) st = refuse(s, err, OMX_PANEL_STORE_ABSENT, "no base store given");
    if (!st && user) st = open_file(s, user, LAYER_USER, err);
    if (!st && system) st = open_file(s, system, LAYER_SYSTEM, err);
    if (!st) st = open_file(s, base, LAYER_BASE, err);
    if (!st) st = check_files(s, err);
    if (st) { omx_panel_store_close(s); return st; }
    *out = s;
    return 0;
}

int omx_panel_store_open(omx_panel_store_scope scope, omx_panel_store **out, omx_panel_store_error *err) {
    char *b, *sy, *u;
    *out = NULL;
    int rc = omx_panel_store__places(scope, &b, &sy, &u, err);
    if (rc) return rc;
    rc = omx_panel_store_open_at(b, sy, u, NULL, out, err);
    free(b); free(sy); free(u);
    return rc;
}

static void reset_answer(omx_panel_store *s) {
    for (size_t i = 0; i < s->nkeep; i++) free(s->keep[i]);
    s->nkeep = 0;
}

void omx_panel_store_close(omx_panel_store *s) {
    if (!s) return;
    reset_answer(s);
    free(s->keep);
    free_files(s);
    if (s->w) sqlite3_close(s->w);
    omx_domain_close(s->dom_panel);
    omx_domain_close(s->dom_plugindb);
    free(s->wpath);
    free(s->contract_dir_own);
    free(s);
}

/* ----------------------------------------------------------------------------------------------------------- get */

static void *keep(omx_panel_store *s, void *p) {
    if (s->nkeep == s->capkeep) { s->capkeep = s->capkeep ? s->capkeep * 2 : 32; s->keep = realloc(s->keep, s->capkeep * sizeof *s->keep); }
    s->keep[s->nkeep++] = p;
    return p;
}
static const char *text(omx_panel_store *s, sqlite3_stmt *st, int col) {
    const unsigned char *t = sqlite3_column_text(st, col);
    return t ? (const char *)keep(s, strdup((const char *)t)) : NULL;
}

static int bad(omx_panel_store *s, const file_t *f, int rc) {
    return refuse(s, NULL, from_sqlite(rc), "%s: %s", f->path, sqlite3_errmsg(f->db));
}

/* the groups, the verdict and the controls of one plugin_id of one layer into e */
static int fill_children(omx_panel_store *s, const file_t *f, sqlite3_int64 id, omx_panel_store_entry *e) {
    sqlite3_stmt *st;
    int rc = sqlite3_prepare_v2(f->db, "SELECT outcome, reason FROM port_group_verdict WHERE plugin_id = ?", -1, &st, NULL);
    if (rc != SQLITE_OK) return bad(s, f, rc);
    sqlite3_bind_int64(st, 1, id);
    rc = sqlite3_step(st);
    if (rc == SQLITE_ROW) { e->group_outcome = text(s, st, 0); e->group_reason = text(s, st, 1); }
    sqlite3_finalize(st);
    if (rc != SQLITE_ROW && rc != SQLITE_DONE) return bad(s, f, rc);

    rc = sqlite3_prepare_v2(f->db, "SELECT symbol, name, display_priority, rule, declared FROM port_group WHERE plugin_id = ? ORDER BY display_priority, symbol", -1, &st, NULL);
    if (rc != SQLITE_OK) return bad(s, f, rc);
    sqlite3_bind_int64(st, 1, id);
    omx_panel_store_group *gs = NULL;
    size_t ng = 0;
    while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
        gs = realloc(gs, (ng + 1) * sizeof *gs);
        omx_panel_store_group *g = &gs[ng++];
        memset(g, 0, sizeof *g);
        g->symbol = text(s, st, 0); g->name = text(s, st, 1); g->display_priority = (long)sqlite3_column_int64(st, 2);
        g->rule = text(s, st, 3); g->declared = sqlite3_column_int(st, 4);
    }
    sqlite3_finalize(st);
    keep(s, gs);
    if (rc != SQLITE_DONE) return bad(s, f, rc);
    for (size_t i = 0; i < ng; i++) {
        rc = sqlite3_prepare_v2(f->db, "SELECT port_symbol FROM port_group_member WHERE plugin_id = ? AND group_symbol = ? ORDER BY rowid", -1, &st, NULL);
        if (rc != SQLITE_OK) return bad(s, f, rc);
        sqlite3_bind_int64(st, 1, id);
        sqlite3_bind_text(st, 2, gs[i].symbol, -1, SQLITE_STATIC);
        const char **ports = NULL;
        size_t np = 0;
        while ((rc = sqlite3_step(st)) == SQLITE_ROW) { ports = realloc(ports, (np + 1) * sizeof *ports); ports[np++] = text(s, st, 0); }
        sqlite3_finalize(st);
        keep(s, ports);
        if (rc != SQLITE_DONE) return bad(s, f, rc);
        gs[i].ports = ports; gs[i].nports = np;
    }
    e->groups = gs; e->ngroups = ng;

    rc = sqlite3_prepare_v2(f->db, "SELECT symbol, key, id, group_key, governed FROM description_control WHERE plugin_id = ? ORDER BY ordinal", -1, &st, NULL);
    if (rc != SQLITE_OK) return bad(s, f, rc);
    sqlite3_bind_int64(st, 1, id);
    omx_panel_store_control *cs = NULL;
    size_t nc = 0;
    while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
        cs = realloc(cs, (nc + 1) * sizeof *cs);
        omx_panel_store_control *c = &cs[nc++];
        c->symbol = text(s, st, 0); c->key = text(s, st, 1); c->id = text(s, st, 2); c->group_key = text(s, st, 3); c->governed = sqlite3_column_int(st, 4);
    }
    sqlite3_finalize(st);
    keep(s, cs);
    if (rc != SQLITE_DONE) return bad(s, f, rc);
    e->controls = cs; e->ncontrols = nc;
    return 0;
}

int omx_panel_store_get(omx_panel_store *s, const omx_panel_store_key *k, const char *source, omx_panel_store_entry *e) {
    reset_answer(s);
    memset(e, 0, sizeof *e);
    s->msg[0] = 0;
    if (!source || !k || !k->sha256 || !k->format || !k->uri) return refuse(s, NULL, OMX_PANEL_STORE_ENTRY_INVALID, "a get takes a key and the source of the plugin as installed");
    for (int i = 0; i < s->nf; i++) {
        const file_t *f = &s->f[i];
        sqlite3_stmt *st;
        int rc = sqlite3_prepare_v2(f->db,
            "SELECT p.plugin_id, d.edited, d.made_by, d.rules, d.source, d.family, d.fingerprint, d.body, d.groups, d.refused "
            "FROM plugin p JOIN description d ON d.plugin_id = p.plugin_id WHERE p.sha256 = ?1 AND p.format = ?2 AND p.uri = ?3", -1, &st, NULL);
        if (rc != SQLITE_OK) return bad(s, f, rc);
        sqlite3_bind_text(st, 1, k->sha256, -1, SQLITE_STATIC);
        sqlite3_bind_text(st, 2, k->format, -1, SQLITE_STATIC);
        sqlite3_bind_text(st, 3, k->uri, -1, SQLITE_STATIC);
        rc = sqlite3_step(st);
        if (rc == SQLITE_DONE) { sqlite3_finalize(st); continue; }
        if (rc != SQLITE_ROW) { int r = bad(s, f, rc); sqlite3_finalize(st); return r; }
        sqlite3_int64 id = sqlite3_column_int64(st, 0);
        int edited = sqlite3_column_int(st, 1), rules = sqlite3_column_int(st, 3);
        int stale = strcmp((const char *)sqlite3_column_text(st, 4), source) != 0;
        if (!stale && !edited && rules < s->rules) stale = 1;
        if (stale) {
            if (edited && !e->stale_edit_layer) e->stale_edit_layer = LAYER_NAME[f->layer];
            sqlite3_finalize(st);
            continue;
        }
        e->layer = LAYER_NAME[f->layer];
        e->edited = edited;
        e->made_by = text(s, st, 2);
        e->family = text(s, st, 5);
        e->fingerprint = text(s, st, 6);
        e->body = text(s, st, 7);
        e->repeated_groups = text(s, st, 8);
        e->refused = text(s, st, 9);
        sqlite3_finalize(st);
        int r = fill_children(s, f, id, e);
        if (r) { const char *stale_layer = e->stale_edit_layer; memset(e, 0, sizeof *e); e->stale_edit_layer = stale_layer; return r; }
        return 0;
    }
    return OMX_PANEL_STORE_NO_ENTRY;
}

/* -------------------------------------------------------------------------------------------------------- source */

typedef struct { uint32_t h[8]; uint64_t len; unsigned char buf[64]; size_t n; } sha_t;
static const uint32_t K256[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 };
#define ROR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))
static void sha_block(sha_t *c, const unsigned char *p) {
    uint32_t w[64], a, b, cc, d, e, f, g, h;
    for (int i = 0; i < 16; i++) w[i] = (uint32_t)p[4 * i] << 24 | (uint32_t)p[4 * i + 1] << 16 | (uint32_t)p[4 * i + 2] << 8 | p[4 * i + 3];
    for (int i = 16; i < 64; i++) {
        uint32_t s0 = ROR(w[i - 15], 7) ^ ROR(w[i - 15], 18) ^ (w[i - 15] >> 3), s1 = ROR(w[i - 2], 17) ^ ROR(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    a = c->h[0]; b = c->h[1]; cc = c->h[2]; d = c->h[3]; e = c->h[4]; f = c->h[5]; g = c->h[6]; h = c->h[7];
    for (int i = 0; i < 64; i++) {
        uint32_t t1 = h + (ROR(e, 6) ^ ROR(e, 11) ^ ROR(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i];
        uint32_t t2 = (ROR(a, 2) ^ ROR(a, 13) ^ ROR(a, 22)) + ((a & b) ^ (a & cc) ^ (b & cc));
        h = g; g = f; f = e; e = d + t1; d = cc; cc = b; b = a; a = t1 + t2;
    }
    c->h[0] += a; c->h[1] += b; c->h[2] += cc; c->h[3] += d; c->h[4] += e; c->h[5] += f; c->h[6] += g; c->h[7] += h;
}
static void sha_init(sha_t *c) {
    static const uint32_t i0[8] = { 0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19 };
    memcpy(c->h, i0, sizeof i0); c->len = 0; c->n = 0;
}
static void sha_add(sha_t *c, const void *data, size_t len) {
    const unsigned char *p = data;
    c->len += len;
    while (len) {
        size_t take = 64 - c->n < len ? 64 - c->n : len;
        memcpy(c->buf + c->n, p, take);
        c->n += take; p += take; len -= take;
        if (c->n == 64) { sha_block(c, c->buf); c->n = 0; }
    }
}
static void sha_hex(sha_t *c, char out[65]) {
    uint64_t bits = c->len * 8;
    unsigned char pad = 0x80, z = 0, lenb[8];
    sha_add(c, &pad, 1);
    while (c->n != 56) sha_add(c, &z, 1);
    for (int i = 0; i < 8; i++) lenb[i] = (unsigned char)(bits >> (56 - 8 * i));
    sha_add(c, lenb, 8);
    for (int i = 0; i < 8; i++) sprintf(out + 8 * i, "%08x", c->h[i]);
}

static int read_file(const char *path, char **buf, size_t *len) {
    FILE *fp = fopen(path, "rb");
    if (!fp) return -1;
    size_t cap = 1 << 16, n = 0;
    char *b = malloc(cap);
    size_t r;
    while ((r = fread(b + n, 1, cap - n, fp)) > 0) { n += r; if (n == cap) { cap *= 2; b = realloc(b, cap); } }
    int bad_read = ferror(fp);
    fclose(fp);
    if (bad_read) { free(b); return -1; }
    *buf = b; *len = n;
    return 0;
}

static int by_name(const void *a, const void *b) { return strcmp(*(char *const *)a, *(char *const *)b); }

static int source_lv2(const char *dir, char hex[65]) {
    DIR *d = opendir(dir);
    if (!d) return -1;
    char **names = NULL;
    size_t nn = 0;
    struct dirent *de;
    while ((de = readdir(d))) {
        size_t l = strlen(de->d_name);
        if (l > 4 && !strcmp(de->d_name + l - 4, ".ttl")) { names = realloc(names, (nn + 1) * sizeof *names); names[nn++] = strdup(de->d_name); }
    }
    closedir(d);
    qsort(names, nn, sizeof *names, by_name);
    sha_t c;
    sha_init(&c);
    int rc = 0;
    for (size_t i = 0; i < nn; i++) {
        char *path = NULL, *buf = NULL;
        size_t len = 0;
        if (asprintf(&path, "%s/%s", dir, names[i]) < 0) { rc = -1; break; }
        if (read_file(path, &buf, &len)) rc = -1;
        else { sha_add(&c, names[i], strlen(names[i])); sha_add(&c, "", 1); sha_add(&c, buf, len); }
        free(path); free(buf);
    }
    for (size_t i = 0; i < nn; i++) free(names[i]);
    free(names);
    if (!rc) sha_hex(&c, hex);
    return rc;
}

static int by_key(const void *a, const void *b) { return strcmp((*(cJSON *const *)a)->string, (*(cJSON *const *)b)->string); }

/* canonical JSON: object keys in byte order, no white space; strings and numbers as cJSON prints them */
static void canon(const cJSON *j, sha_t *c) {
    if (cJSON_IsObject(j)) {
        size_t n = (size_t)cJSON_GetArraySize(j), i = 0;
        const cJSON **kids = malloc((n + 1) * sizeof *kids);
        for (const cJSON *k = j->child; k; k = k->next) kids[i++] = k;
        qsort(kids, n, sizeof *kids, by_key);
        sha_add(c, "{", 1);
        for (i = 0; i < n; i++) {
            cJSON *name = cJSON_CreateString(kids[i]->string);
            char *p = cJSON_PrintUnformatted(name);
            if (i) sha_add(c, ",", 1);
            sha_add(c, p, strlen(p)); sha_add(c, ":", 1);
            free(p); cJSON_Delete(name);
            canon(kids[i], c);
        }
        sha_add(c, "}", 1);
        free(kids);
    } else if (cJSON_IsArray(j)) {
        sha_add(c, "[", 1);
        for (const cJSON *k = j->child; k; k = k->next) { canon(k, c); if (k->next) sha_add(c, ",", 1); }
        sha_add(c, "]", 1);
    } else {
        char *p = cJSON_PrintUnformatted(j);
        sha_add(c, p, strlen(p));
        free(p);
    }
}

static int source_clap(const char *file, char hex[65]) {
    char *buf = NULL;
    size_t len = 0;
    if (read_file(file, &buf, &len)) return -1;
    cJSON *j = cJSON_ParseWithLength(buf, len);
    free(buf);
    if (!j) return -1;
    sha_t c;
    sha_init(&c);
    canon(j, &c);
    cJSON_Delete(j);
    sha_hex(&c, hex);
    return 0;
}

int omx_panel_store_source(const char *format, const char *path, char hex_out[65]) {
    if (!format || !path || !hex_out) return -1;
    if (!strcmp(format, "lv2")) return source_lv2(path, hex_out);
    if (!strcmp(format, "clap")) return source_clap(path, hex_out);
    return -1;
}

/* ---------------------------------------------------------------------------------------------------------- writer */

static int exec(sqlite3 *db, const char *sql) { return sqlite3_exec(db, sql, NULL, NULL, NULL); }

static int mkdir_p(const char *path) {
    char *p = strdup(path);
    for (char *q = p + 1; *q; q++) {
        if (*q != '/') continue;
        *q = 0;
        if (mkdir(p, 0755) != 0 && errno != EEXIST) { free(p); return -1; }
        *q = '/';
    }
    free(p);
    return 0;
}

/* the layer's file, written whole beside its place and linked into it: a reader never sees half a layer */
/* A new store's schema and its fixed rows in `db`: store_info of `layer` (`built_from` for the base, else NULL), the
 * domains, the word checks. The user_version is set after, by the caller: last, once the file is whole. */
static int init_db(sqlite3 *db, int layer, const char *built_from) {
    char sql[512];
    if (exec(db, "PRAGMA page_size = 4096") != SQLITE_OK || exec(db, "PRAGMA journal_mode = DELETE") != SQLITE_OK || exec(db, "BEGIN") != SQLITE_OK
        || exec(db, OMX_PANEL_STORE_DDL) != SQLITE_OK) return -1;
    if (built_from) snprintf(sql, sizeof sql, "INSERT INTO store_info VALUES (1, %d, 'omx-panel.panel-description/1', '%s')", layer, built_from);
    else snprintf(sql, sizeof sql, "INSERT INTO store_info VALUES (1, %d, 'omx-panel.panel-description/1', NULL)", layer);
    if (exec(db, sql) != SQLITE_OK) return -1;
    snprintf(sql, sizeof sql, "INSERT INTO store_domain VALUES ('panel', '%s'), ('plugin-db', '%s')", OMX_PANEL_STORE_PANEL_VERSION, PLUGIN_DB_FLOOR);
    if (exec(db, sql) != SQLITE_OK) return -1;
    for (size_t i = 0; i < NWORD_CHECKS; i++) {
        snprintf(sql, sizeof sql, "INSERT INTO word_check VALUES ('%s', '%s', '%s', '%s')", WORD_CHECKS[i].tbl, WORD_CHECKS[i].col, WORD_CHECKS[i].domain, WORD_CHECKS[i].item);
        if (exec(db, sql) != SQLITE_OK) return -1;
    }
    return exec(db, "COMMIT") == SQLITE_OK ? 0 : -1;
}

static int create_layer(omx_panel_store *s, const char *path, int layer, omx_panel_store_error *err) {
    char *tmp = NULL;
    if (mkdir_p(path) != 0) return refuse(s, err, OMX_PANEL_STORE_UNREADABLE, "%s: cannot create its directory: %s", path, strerror(errno));
    if (asprintf(&tmp, "%s.new.%ld", path, (long)getpid()) < 0) return refuse(s, err, OMX_PANEL_STORE_UNREADABLE, "out of memory");
    unlink(tmp);
    sqlite3 *db = NULL;
    int rc = sqlite3_open_v2(tmp, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, NULL);
    int st = 0;
    if (rc != SQLITE_OK) { st = refuse(s, err, OMX_PANEL_STORE_UNREADABLE, "%s: cannot create: %s", tmp, sqlite3_errstr(rc)); goto done; }
    char sql[64];
    if (init_db(db, layer, NULL) != 0) goto failed;
    snprintf(sql, sizeof sql, "PRAGMA user_version = %d", OMX_PANEL_STORE_SCHEMA_VERSION);
    if (exec(db, sql) != SQLITE_OK) goto failed;
    sqlite3_close(db);
    db = NULL;
    if (link(tmp, path) != 0 && errno != EEXIST) { st = refuse(s, err, OMX_PANEL_STORE_UNREADABLE, "%s: cannot put the new layer in place: %s", path, strerror(errno)); goto done; }
    goto done;
failed:
    st = refuse(s, err, OMX_PANEL_STORE_UNREADABLE, "%s: cannot create the layer: %s", path, sqlite3_errmsg(db));
done:
    if (db) sqlite3_close(db);
    unlink(tmp);
    free(tmp);
    return st;
}

int omx_panel_store_writer_open_at(const char *path, int layer, const char *contract_dir, omx_panel_store **out, omx_panel_store_error *err) {
    *out = NULL;
    if (layer != LAYER_SYSTEM && layer != LAYER_USER) return refuse(NULL, err, OMX_PANEL_STORE_NOT_A_STORE, "a writer writes the system layer or a user layer, never the base");
    omx_panel_store *s = calloc(1, sizeof *s);
    s->rules = OMX_PANEL_RULES_VERSION;
    s->contract_dir_own = dup_or_null(contract_dir);
    s->contract_dir = s->contract_dir_own;
    s->wlayer = layer;
    s->wpath = strdup(path);
    int st = 0;
    if (access(path, F_OK) != 0 && errno == ENOENT) st = create_layer(s, path, layer, err);
    if (!st) {
        int rc = open_db(path, SQLITE_OPEN_READWRITE, "mode=rw", WRITER_BUSY_MS, &s->w);
        if (rc != SQLITE_OK) { st = refuse(s, err, from_sqlite(rc) == OMX_PANEL_STORE_BUSY ? OMX_PANEL_STORE_BUSY : OMX_PANEL_STORE_UNREADABLE, "%s: cannot open for writing: %s", path, sqlite3_errstr(rc)); }
    }
    if (!st) {
        file_t f = { .path = s->wpath, .db = s->w, .layer = layer };
        long v = 0, l = -1; int have = 0;
        int rc = query_int(s->w, "PRAGMA user_version", &v, &have);
        if (rc != SQLITE_OK) st = refuse(s, err, from_sqlite(rc), "%s: %s", path, sqlite3_errmsg(s->w));
        else if (v == 0) st = refuse(s, err, OMX_PANEL_STORE_NOT_A_STORE, "%s: user_version 0, no store", path);
        else if (v != OMX_PANEL_STORE_SCHEMA_VERSION) st = refuse(s, err, OMX_PANEL_STORE_SCHEMA_OTHER, "%s: schema version %ld, this writer writes %d", path, v, OMX_PANEL_STORE_SCHEMA_VERSION);
        else if (query_int(s->w, "SELECT layer FROM store_info WHERE one = 1", &l, &have) != SQLITE_OK || !have || l != layer)
            st = refuse(s, err, OMX_PANEL_STORE_NOT_A_STORE, "%s: not a store of layer %d", path, layer);
        else st = check_file_words(&f, s->contract_dir, 0, s, err);
    }
    if (!st) {
        /* the domains a put checks its words against, at the versions the layer holds them */
        omx_panel_store_error e2;
        st = open_domain(s->contract_dir, "panel", OMX_PANEL_STORE_PANEL_VERSION, &s->dom_panel, &e2);
        if (!st) st = open_domain(s->contract_dir, "plugin-db", PLUGIN_DB_FLOOR, &s->dom_plugindb, &e2);
        if (st) { refuse(s, err, st, "%s", e2.message); if (err) err->code = e2.code; }
    }
    if (!st) exec(s->w, "PRAGMA foreign_keys = ON");
    if (st) { omx_panel_store_close(s); return st; }
    *out = s;
    return 0;
}

int omx_panel_store_writer_open(omx_panel_store **out, omx_panel_store_error *err) {
    char *path;
    int layer;
    *out = NULL;
    int rc = omx_panel_store__writer_place(&path, &layer, err);
    if (rc) return rc;
    rc = omx_panel_store_writer_open_at(path, layer, NULL, out, err);
    free(path);
    return rc;
}

/* ---- a put: the entry as JSON, checked as an entry of the description schema, then written whole */

#define INVALID(...) (st = refuse(w, err, OMX_PANEL_STORE_ENTRY_INVALID, __VA_ARGS__))

static int is_hex(const char *s, size_t n) {
    if (!s || strlen(s) != n) return 0;
    for (; *s; s++) if (!((*s >= '0' && *s <= '9') || (*s >= 'a' && *s <= 'f'))) return 0;
    return 1;
}
static int word_in(omx_panel_store *w, const char *domain_item, const char *word) {
    omx_domain_word_info wi;
    const char *item = domain_item;
    omx_domain *d = !strncmp(item, "PLUGIN_DB_", 10) ? w->dom_plugindb : w->dom_panel;
    return word && omx_domain_word(d, item, word, &wi) == 0;
}
static const char *str_of(const cJSON *o, const char *name) { const cJSON *v = cJSON_GetObjectItemCaseSensitive(o, name); return cJSON_IsString(v) ? v->valuestring : NULL; }
static int int_of(const cJSON *o, const char *name, int dflt, int *ok) {
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(o, name);
    if (!v) return dflt;
    if (!cJSON_IsNumber(v) || v->valuedouble != (double)(long long)v->valuedouble) { *ok = 0; return dflt; }
    return (int)v->valuedouble;
}
static int bit_of(const cJSON *o, const char *name, int dflt, int *ok) { int v = int_of(o, name, dflt, ok); if (v != 0 && v != 1) *ok = 0; return v; }

static int bind_text_or_null(sqlite3_stmt *st, int i, const char *t) { return t ? sqlite3_bind_text(st, i, t, -1, SQLITE_TRANSIENT) : sqlite3_bind_null(st, i); }

static int step_done(sqlite3_stmt *st) { int rc = sqlite3_step(st); sqlite3_finalize(st); return rc == SQLITE_DONE ? SQLITE_OK : rc; }

int omx_panel_store_put(omx_panel_store *w, const omx_panel_store_key *k, const char *entry_json, omx_panel_store_error *err) {
    int st = 0;
    w->msg[0] = 0;
    if (!w->w) return refuse(w, err, OMX_PANEL_STORE_NOT_A_STORE, "not a writer");
    cJSON *j = cJSON_Parse(entry_json);
    if (!k->sha256 || !is_hex(k->sha256, 64)) { cJSON_Delete(j); return INVALID("the key's sha256 is not 64 lowercase hex digits"); }
    if (!k->format || !word_in(w, "PLUGIN_DB_ADDRESS_FORMATS", k->format)) { cJSON_Delete(j); return INVALID("the key's format %s is no address format of plugin-db", k->format ? k->format : "(none)"); }
    if (!k->uri || !*k->uri) { cJSON_Delete(j); return INVALID("the key has no uri"); }
    if (!cJSON_IsObject(j)) { cJSON_Delete(j); return INVALID("the entry is not a JSON object"); }
    int ok = 1;
    int edited = bit_of(j, "edited", -1, &ok), rules = int_of(j, "rules", 0, &ok);
    if (edited < 0) ok = 0;
    const char *made_by = str_of(j, "made_by"), *source = str_of(j, "source"), *family = str_of(j, "family"), *fp = str_of(j, "fingerprint"), *refused = str_of(j, "refused");
    const cJSON *body = cJSON_GetObjectItemCaseSensitive(j, "body"), *groups = cJSON_GetObjectItemCaseSensitive(j, "groups");
    const cJSON *rf = cJSON_GetObjectItemCaseSensitive(j, "refused"), *controls = cJSON_GetObjectItemCaseSensitive(j, "controls"), *verdict = cJSON_GetObjectItemCaseSensitive(j, "verdict");
    int has_body = body && !cJSON_IsNull(body), has_groups = groups && !cJSON_IsNull(groups), has_refused = rf && !cJSON_IsNull(rf);
    if (!ok) INVALID("edited is 0 or 1 and rules an integer");
    else if (!made_by || !*made_by) INVALID("made_by is a name");
    else if (rules < 1) INVALID("rules is an integer of 1 or more");
    else if (!is_hex(source, 64)) INVALID("source is 64 lowercase hex digits");
    else if (!is_hex(fp, 64)) INVALID("fingerprint is 64 lowercase hex digits");
    else if (!family || !word_in(w, "PANEL_FAMILIES", family)) INVALID("family %s is no word of PANEL_FAMILIES", family ? family : "(none)");
    else if (has_body && !cJSON_IsObject(body)) INVALID("body is a JSON object or null");
    else if (has_body == has_refused) INVALID("exactly one of body and refused");
    else if (has_body != has_groups) INVALID("groups is null exactly when body is");
    else if (has_refused && !(refused && word_in(w, "PANEL_DESCRIBE_CODES", refused))) INVALID("refused %s is no word of PANEL_DESCRIBE_CODES", refused ? refused : "(not a string)");
    else if (controls && !cJSON_IsNull(controls) && !cJSON_IsArray(controls)) INVALID("controls is an array");
    else if (verdict && !cJSON_IsNull(verdict) && !cJSON_IsObject(verdict)) INVALID("verdict is an object or null");
    const cJSON *vgroups = NULL;
    const char *outcome = NULL, *reason = NULL;
    if (!st && verdict && cJSON_IsObject(verdict)) {
        outcome = str_of(verdict, "outcome");
        reason = str_of(verdict, "reason");
        vgroups = cJSON_GetObjectItemCaseSensitive(verdict, "groups");
        if (!outcome || !word_in(w, "PANEL_GROUP_OUTCOMES", outcome)) INVALID("verdict.outcome %s is no word of PANEL_GROUP_OUTCOMES", outcome ? outcome : "(none)");
        else if (cJSON_GetObjectItemCaseSensitive(verdict, "reason") && !cJSON_IsNull(cJSON_GetObjectItemCaseSensitive(verdict, "reason")) && !(reason && word_in(w, "PANEL_GROUP_REASONS", reason))) INVALID("verdict.reason is no word of PANEL_GROUP_REASONS");
        else if (vgroups && !cJSON_IsArray(vgroups)) INVALID("verdict.groups is an array");
        else if (!strcmp(outcome, "grouped") ? cJSON_GetArraySize(vgroups) < 1 : cJSON_GetArraySize(vgroups) > 0) INVALID("a grouped verdict holds groups, any other none");
    }
    if (st) { cJSON_Delete(j); return st; }

    sqlite3 *db = w->w;
    sqlite3_stmt *q = NULL;
    sqlite3_int64 id = 0;
    if (exec(db, "BEGIN IMMEDIATE") != SQLITE_OK) { st = refuse(w, err, from_sqlite(sqlite3_errcode(db)), "%s: %s", w->wpath, sqlite3_errmsg(db)); cJSON_Delete(j); return st; }
    int rc = SQLITE_OK;
    char *body_text = has_body ? cJSON_PrintUnformatted(body) : NULL, *groups_text = has_groups ? cJSON_PrintUnformatted(groups) : NULL;

    /* the key's row, then the old entry gone whole */
    rc = sqlite3_prepare_v2(db, "INSERT OR IGNORE INTO plugin (sha256, format, uri) VALUES (?1, ?2, ?3)", -1, &q, NULL);
    if (rc == SQLITE_OK) { sqlite3_bind_text(q, 1, k->sha256, -1, SQLITE_STATIC); sqlite3_bind_text(q, 2, k->format, -1, SQLITE_STATIC); sqlite3_bind_text(q, 3, k->uri, -1, SQLITE_STATIC); rc = step_done(q); }
    if (rc == SQLITE_OK) {
        rc = sqlite3_prepare_v2(db, "SELECT plugin_id FROM plugin WHERE sha256 = ?1 AND format = ?2 AND uri = ?3", -1, &q, NULL);
        if (rc == SQLITE_OK) {
            sqlite3_bind_text(q, 1, k->sha256, -1, SQLITE_STATIC); sqlite3_bind_text(q, 2, k->format, -1, SQLITE_STATIC); sqlite3_bind_text(q, 3, k->uri, -1, SQLITE_STATIC);
            rc = sqlite3_step(q);
            if (rc == SQLITE_ROW) { id = sqlite3_column_int64(q, 0); rc = SQLITE_OK; }
            sqlite3_finalize(q);
        }
    }
    if (rc == SQLITE_OK) {
        rc = sqlite3_prepare_v2(db, "DELETE FROM description WHERE plugin_id = ?1", -1, &q, NULL);
        if (rc == SQLITE_OK) { sqlite3_bind_int64(q, 1, id); rc = step_done(q); }
    }
    if (rc == SQLITE_OK) {
        rc = sqlite3_prepare_v2(db, "INSERT INTO description VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)", -1, &q, NULL);
        if (rc == SQLITE_OK) {
            sqlite3_bind_int64(q, 1, id); sqlite3_bind_int(q, 2, edited); sqlite3_bind_text(q, 3, made_by, -1, SQLITE_STATIC); sqlite3_bind_int(q, 4, rules);
            sqlite3_bind_text(q, 5, source, -1, SQLITE_STATIC); sqlite3_bind_text(q, 6, family, -1, SQLITE_STATIC); sqlite3_bind_text(q, 7, fp, -1, SQLITE_STATIC);
            bind_text_or_null(q, 8, body_text); bind_text_or_null(q, 9, groups_text); bind_text_or_null(q, 10, has_refused ? refused : NULL);
            rc = step_done(q);
        }
    }
    int ordinal = 0;
    const cJSON *c;
    if (controls && cJSON_IsArray(controls)) cJSON_ArrayForEach(c, controls) {
        if (rc != SQLITE_OK) break;
        const char *sym = str_of(c, "symbol"), *key = str_of(c, "key"), *cid = str_of(c, "id"), *gk = str_of(c, "group_key");
        int cok = 1, gov = cJSON_IsObject(c) ? bit_of(c, "governed", 0, &cok) : 0;
        const cJSON *gkj = cJSON_IsObject(c) ? cJSON_GetObjectItemCaseSensitive(c, "group_key") : NULL;
        if (!cJSON_IsObject(c) || !sym || !key || !cid || !cok || (gkj && !cJSON_IsNull(gkj) && !gk)) { INVALID("a control is {symbol, key, id, group_key?, governed?}"); break; }
        rc = sqlite3_prepare_v2(db, "INSERT INTO description_control VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)", -1, &q, NULL);
        if (rc == SQLITE_OK) {
            sqlite3_bind_int64(q, 1, id); sqlite3_bind_int(q, 2, ordinal++); sqlite3_bind_text(q, 3, sym, -1, SQLITE_STATIC); sqlite3_bind_text(q, 4, key, -1, SQLITE_STATIC);
            sqlite3_bind_text(q, 5, cid, -1, SQLITE_STATIC); bind_text_or_null(q, 6, gk); sqlite3_bind_int(q, 7, gov);
            rc = step_done(q);
        }
    }
    if (!st && rc == SQLITE_OK && outcome) {
        rc = sqlite3_prepare_v2(db, "INSERT INTO port_group_verdict VALUES (?1, ?2, ?3)", -1, &q, NULL);
        if (rc == SQLITE_OK) { sqlite3_bind_int64(q, 1, id); sqlite3_bind_text(q, 2, outcome, -1, SQLITE_STATIC); bind_text_or_null(q, 3, reason); rc = step_done(q); }
        const cJSON *g;
        if (vgroups) cJSON_ArrayForEach(g, vgroups) {
            if (rc != SQLITE_OK) break;
            const char *sym = str_of(g, "symbol"), *name = str_of(g, "name"), *rule = str_of(g, "rule");
            int gok = 1, prio = int_of(g, "display_priority", 0, &gok), decl = bit_of(g, "declared", 0, &gok);
            const cJSON *ports = cJSON_GetObjectItemCaseSensitive(g, "ports");
            if (!cJSON_IsObject(g) || !sym || !name || !gok || !cJSON_IsArray(ports)) { INVALID("a group is {symbol, name, display_priority, rule, declared, ports[]}"); break; }
            if (!rule || !word_in(w, "PANEL_GROUP_RULES", rule)) { INVALID("group %s: rule %s is no word of PANEL_GROUP_RULES", sym, rule ? rule : "(none)"); break; }
            rc = sqlite3_prepare_v2(db, "INSERT INTO port_group VALUES (?1, ?2, ?3, ?4, ?5, ?6)", -1, &q, NULL);
            if (rc == SQLITE_OK) {
                sqlite3_bind_int64(q, 1, id); sqlite3_bind_text(q, 2, sym, -1, SQLITE_STATIC); sqlite3_bind_text(q, 3, name, -1, SQLITE_STATIC);
                sqlite3_bind_int(q, 4, prio); sqlite3_bind_text(q, 5, rule, -1, SQLITE_STATIC); sqlite3_bind_int(q, 6, decl);
                rc = step_done(q);
            }
            const cJSON *p;
            cJSON_ArrayForEach(p, ports) {
                if (rc != SQLITE_OK) break;
                if (!cJSON_IsString(p)) { INVALID("a port is its symbol, a string"); break; }
                rc = sqlite3_prepare_v2(db, "INSERT INTO port_group_member VALUES (?1, ?2, ?3)", -1, &q, NULL);
                if (rc == SQLITE_OK) { sqlite3_bind_int64(q, 1, id); sqlite3_bind_text(q, 2, sym, -1, SQLITE_STATIC); sqlite3_bind_text(q, 3, p->valuestring, -1, SQLITE_STATIC); rc = step_done(q); }
            }
            if (st) break;
        }
    }
    if (!st && rc != SQLITE_OK) {
        /* a constraint is the entry's fault; anything else is the file's */
        if ((rc & 0xff) == SQLITE_CONSTRAINT) INVALID("the entry breaks the store's constraints: %s", sqlite3_errmsg(db));
        else st = refuse(w, err, from_sqlite(rc), "%s: %s", w->wpath, sqlite3_errmsg(db));
    }
    if (!st && exec(db, "COMMIT") != SQLITE_OK) st = refuse(w, err, from_sqlite(sqlite3_errcode(db)), "%s: %s", w->wpath, sqlite3_errmsg(db));
    if (st) exec(db, "ROLLBACK");
    free(body_text); free(groups_text);
    cJSON_Delete(j);
    return st;
}

int omx_panel_store__keys(omx_panel_store *w, void (*each)(const char *, const char *, const char *, void *), void *ctx, omx_panel_store_error *err) {
    sqlite3_stmt *q;
    w->msg[0] = 0;
    if (!w->w) return refuse(w, err, OMX_PANEL_STORE_NOT_A_STORE, "not a writer");
    int rc = sqlite3_prepare_v2(w->w, "SELECT sha256, format, uri FROM plugin ORDER BY sha256, format, uri", -1, &q, NULL);
    while (rc == SQLITE_OK && (rc = sqlite3_step(q)) == SQLITE_ROW) {
        each((const char *)sqlite3_column_text(q, 0), (const char *)sqlite3_column_text(q, 1), (const char *)sqlite3_column_text(q, 2), ctx);
        rc = SQLITE_OK;
    }
    if (rc == SQLITE_DONE) rc = SQLITE_OK;
    sqlite3_finalize(q);
    return rc == SQLITE_OK ? 0 : refuse(w, err, from_sqlite(rc), "%s: %s", w->wpath, sqlite3_errmsg(w->w));
}

/* ---- the base (section 6): the derived entries written into a new file, in key order, renamed into place when whole */

static int key_cmp(const void *a, const void *b) {
    const cJSON *x = *(const cJSON *const *)a, *y = *(const cJSON *const *)b;
    for (const char *const *f = (const char *const[]){ "sha256", "format", "uri", NULL }; *f; f++) {
        int c = strcmp(str_of(x, *f) ? str_of(x, *f) : "", str_of(y, *f) ? str_of(y, *f) : "");
        if (c) return c;
    }
    return 0;
}

int omx_panel_store__build(const char *out, const char *built_from, const char *contract_dir, const char *entries_json, omx_panel_store_error *err) {
    if (!is_hex(built_from, 40)) return refuse(NULL, err, OMX_PANEL_STORE_ENTRY_INVALID, "built_from %s is not a commit (40 lowercase hex digits)", built_from ? built_from : "(none)");
    cJSON *all = cJSON_Parse(entries_json);
    if (!cJSON_IsArray(all)) { cJSON_Delete(all); return refuse(NULL, err, OMX_PANEL_STORE_ENTRY_INVALID, "the entries are a JSON array of { sha256, format, uri, entry }"); }
    int n = cJSON_GetArraySize(all);
    const cJSON **items = calloc(n ? n : 1, sizeof *items);
    int i = 0;
    const cJSON *it;
    cJSON_ArrayForEach(it, all) items[i++] = it;
    qsort(items, n, sizeof *items, key_cmp);

    omx_panel_store *s = calloc(1, sizeof *s);
    s->rules = OMX_PANEL_RULES_VERSION;
    s->contract_dir_own = dup_or_null(contract_dir);
    s->contract_dir = s->contract_dir_own;
    s->wlayer = LAYER_BASE;
    int st = 0;
    char *tmp = NULL;
    if (mkdir_p(out) != 0) st = refuse(s, err, OMX_PANEL_STORE_UNREADABLE, "%s: cannot create its directory: %s", out, strerror(errno));
    else if (asprintf(&tmp, "%s.build.%ld", out, (long)getpid()) < 0) st = refuse(s, err, OMX_PANEL_STORE_UNREADABLE, "out of memory");
    if (!st) {
        unlink(tmp);
        s->wpath = strdup(tmp);
        int rc = sqlite3_open_v2(tmp, &s->w, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, NULL);
        if (rc != SQLITE_OK || init_db(s->w, LAYER_BASE, built_from) != 0) st = refuse(s, err, OMX_PANEL_STORE_UNREADABLE, "%s: cannot create: %s", tmp, s->w ? sqlite3_errmsg(s->w) : sqlite3_errstr(rc));
    }
    if (!st) {
        omx_panel_store_error e2;
        st = open_domain(s->contract_dir, "panel", OMX_PANEL_STORE_PANEL_VERSION, &s->dom_panel, &e2);
        if (!st) st = open_domain(s->contract_dir, "plugin-db", PLUGIN_DB_FLOOR, &s->dom_plugindb, &e2);
        if (st) { refuse(s, err, st, "%s", e2.message); if (err) err->code = e2.code; }
    }
    if (!st) exec(s->w, "PRAGMA foreign_keys = ON");
    for (i = 0; !st && i < n; i++) {
        const cJSON *e = cJSON_GetObjectItemCaseSensitive(items[i], "entry");
        omx_panel_store_key k = { str_of(items[i], "sha256"), str_of(items[i], "format"), str_of(items[i], "uri") };
        if (!k.sha256 || !k.format || !k.uri || !cJSON_IsObject(e)) { st = refuse(s, err, OMX_PANEL_STORE_ENTRY_INVALID, "entry %d is not { sha256, format, uri, entry }", i); break; }
        char *text = cJSON_PrintUnformatted(e);
        st = omx_panel_store_put(s, &k, text, err);
        free(text);
    }
    if (!st) {
        char sql[64];
        snprintf(sql, sizeof sql, "PRAGMA user_version = %d", OMX_PANEL_STORE_SCHEMA_VERSION);
        if (exec(s->w, "VACUUM") != SQLITE_OK || exec(s->w, sql) != SQLITE_OK) st = refuse(s, err, OMX_PANEL_STORE_UNREADABLE, "%s: %s", tmp, sqlite3_errmsg(s->w));
    }
    if (s->w) { sqlite3_close(s->w); s->w = NULL; }
    if (!st && rename(tmp, out) != 0) st = refuse(s, err, OMX_PANEL_STORE_UNREADABLE, "%s: cannot put the base in place: %s", out, strerror(errno));
    if (tmp) { if (st) unlink(tmp); free(tmp); }
    free(items);
    cJSON_Delete(all);
    omx_panel_store_close(s);
    return st;
}

int omx_panel_store_remove(omx_panel_store *w, const omx_panel_store_key *k, omx_panel_store_error *err) {
    sqlite3_stmt *q;
    w->msg[0] = 0;
    if (!w->w) return refuse(w, err, OMX_PANEL_STORE_NOT_A_STORE, "not a writer");
    int rc = sqlite3_prepare_v2(w->w, "DELETE FROM plugin WHERE sha256 = ?1 AND format = ?2 AND uri = ?3", -1, &q, NULL);
    if (rc == SQLITE_OK) { sqlite3_bind_text(q, 1, k->sha256, -1, SQLITE_STATIC); sqlite3_bind_text(q, 2, k->format, -1, SQLITE_STATIC); sqlite3_bind_text(q, 3, k->uri, -1, SQLITE_STATIC); rc = step_done(q); }
    return rc == SQLITE_OK ? 0 : refuse(w, err, from_sqlite(rc), "%s: %s", w->wpath, sqlite3_errmsg(w->w));
}
