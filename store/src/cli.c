/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> */
/* omx-panel-store: the command over the reader and the writer (docs/descriptions-store.md, section 5). Only this command
 * and the tests read OMX_PANEL_STORE_BASE, _SYSTEM, _USER and OMX_CONTRACT_PATH; the library reads none. */
#define _GNU_SOURCE
#include "internal.h"

#include <cjson/cJSON.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define USAGE \
    "usage: omx-panel-store get --sha256 H --format F --uri U --source H [--rules N] --json\n" \
    "       omx-panel-store put --sha256 H --format F --uri U       (the entry as JSON on stdin)\n" \
    "       omx-panel-store remove --sha256 H --format F --uri U\n" \
    "       omx-panel-store list                                    (the keys of the layer of the effective uid)\n" \
    "       omx-panel-store build --out F --built-from C [--contract-dir D]   (the base, from [{sha256, format, uri, entry}] on stdin)\n" \
    "       omx-panel-store check\n" \
    "       omx-panel-store source --format lv2|clap --path P\n" \
    "       omx-panel-store places --production user|system\n" \
    "       omx-panel-store rules                                   (OMX_PANEL_RULES_VERSION: the rules an entry is put with)\n" \
    "  places: [--scope user|system] [--base F] [--system F] [--user F] [--contract-dir D]\n" \
    "          (else OMX_PANEL_STORE_BASE, _SYSTEM, _USER, OMX_CONTRACT_PATH, then the installed places)\n" \
    "  exit: 0, 1 with the code on stderr, 2 on usage\n"

static int usage(void) { fputs(USAGE, stderr); return 2; }

typedef struct {
    const char *sha256, *format, *uri, *source, *path, *scope, *base, *system, *user, *contract, *production, *out, *built_from;
    int rules, json;
} opts_t;

static int parse(int argc, char **argv, opts_t *o) {
    memset(o, 0, sizeof *o);
    for (int i = 2; i < argc; i++) {
        const char *a = argv[i];
        if (!strcmp(a, "--json")) { o->json = 1; continue; }
        if (i + 1 >= argc) return -1;
        const char *v = argv[++i];
        if (!strcmp(a, "--sha256")) o->sha256 = v;
        else if (!strcmp(a, "--format")) o->format = v;
        else if (!strcmp(a, "--uri")) o->uri = v;
        else if (!strcmp(a, "--source")) o->source = v;
        else if (!strcmp(a, "--path")) o->path = v;
        else if (!strcmp(a, "--scope")) o->scope = v;
        else if (!strcmp(a, "--base")) o->base = v;
        else if (!strcmp(a, "--system")) o->system = v;
        else if (!strcmp(a, "--user")) o->user = v;
        else if (!strcmp(a, "--contract-dir")) o->contract = v;
        else if (!strcmp(a, "--production")) o->production = v;
        else if (!strcmp(a, "--out")) o->out = v;
        else if (!strcmp(a, "--built-from")) o->built_from = v;
        else if (!strcmp(a, "--rules")) o->rules = atoi(v);
        else return -1;
    }
    return 0;
}

static const char *or_env(const char *flag, const char *var) { if (flag) return flag; const char *e = getenv(var); return e && *e ? e : NULL; }

static int fail(int st, const omx_panel_store_error *err) {
    fprintf(stderr, "%s %s\n", err->code ? err->code : "panel-store.error", err->message);
    return st ? 1 : 0;
}

/* the places: the flags, else the variables, else the installed ones; the system scope never has a home */
static int resolve(const opts_t *o, int writer, char **base, char **system, char **user, const char **contract, omx_panel_store_scope *scope) {
    if (o->scope && strcmp(o->scope, "system") && strcmp(o->scope, "user")) return -1;
    /* a writer writes the layer of the effective uid, whatever a scope flag says */
    int sys_scope = writer ? geteuid() == 0 : (o->scope ? !strcmp(o->scope, "system") : geteuid() == 0);
    *scope = sys_scope ? OMX_PANEL_STORE_SCOPE_SYSTEM : OMX_PANEL_STORE_SCOPE_USER;
    omx_panel_store_error err;
    char *b, *s, *u;
    if (omx_panel_store__places(*scope, &b, &s, &u, &err)) { fprintf(stderr, "%s %s\n", err.code, err.message); return 1; }
    const char *fb = or_env(o->base, "OMX_PANEL_STORE_BASE"), *fs = or_env(o->system, "OMX_PANEL_STORE_SYSTEM"), *fu = or_env(o->user, "OMX_PANEL_STORE_USER");
    if (fb) { free(b); b = strdup(fb); }
    if (fs) { free(s); s = strdup(fs); }
    if (fu && !sys_scope) { free(u); u = strdup(fu); }
    *base = b; *system = s; *user = u;
    *contract = or_env(o->contract, "OMX_CONTRACT_PATH");
    return 0;
}

static cJSON *json_text(const char *t) { return t ? cJSON_Parse(t) : cJSON_CreateNull(); }
static cJSON *str_or_null(const char *t) { return t ? cJSON_CreateString(t) : cJSON_CreateNull(); }

static void print_entry(const omx_panel_store_entry *e) {
    cJSON *o = cJSON_CreateObject();
    cJSON_AddItemToObject(o, "layer", str_or_null(e->layer));
    cJSON_AddItemToObject(o, "stale_edit_layer", str_or_null(e->stale_edit_layer));
    cJSON_AddNumberToObject(o, "edited", e->edited);
    cJSON_AddItemToObject(o, "made_by", str_or_null(e->made_by));
    cJSON_AddItemToObject(o, "family", str_or_null(e->family));
    cJSON_AddItemToObject(o, "fingerprint", str_or_null(e->fingerprint));
    cJSON_AddItemToObject(o, "body", json_text(e->body));
    cJSON_AddItemToObject(o, "groups_json", json_text(e->repeated_groups));
    cJSON_AddItemToObject(o, "refused", str_or_null(e->refused));
    cJSON_AddItemToObject(o, "group_outcome", str_or_null(e->group_outcome));
    cJSON_AddItemToObject(o, "group_reason", str_or_null(e->group_reason));
    cJSON *gs = cJSON_AddArrayToObject(o, "groups");
    for (size_t i = 0; i < e->ngroups; i++) {
        const omx_panel_store_group *g = &e->groups[i];
        cJSON *go = cJSON_CreateObject();
        cJSON_AddItemToObject(go, "symbol", str_or_null(g->symbol));
        cJSON_AddItemToObject(go, "name", str_or_null(g->name));
        cJSON_AddNumberToObject(go, "display_priority", (double)g->display_priority);
        cJSON_AddItemToObject(go, "rule", str_or_null(g->rule));
        cJSON_AddNumberToObject(go, "declared", g->declared);
        cJSON *ps = cJSON_AddArrayToObject(go, "ports");
        for (size_t p = 0; p < g->nports; p++) cJSON_AddItemToArray(ps, cJSON_CreateString(g->ports[p]));
        cJSON_AddItemToArray(gs, go);
    }
    cJSON *cs = cJSON_AddArrayToObject(o, "controls");
    for (size_t i = 0; i < e->ncontrols; i++) {
        const omx_panel_store_control *c = &e->controls[i];
        cJSON *co = cJSON_CreateObject();
        cJSON_AddItemToObject(co, "symbol", str_or_null(c->symbol));
        cJSON_AddItemToObject(co, "key", str_or_null(c->key));
        cJSON_AddItemToObject(co, "id", str_or_null(c->id));
        cJSON_AddItemToObject(co, "group_key", str_or_null(c->group_key));
        cJSON_AddNumberToObject(co, "governed", c->governed);
        cJSON_AddItemToArray(cs, co);
    }
    char *t = cJSON_PrintUnformatted(o);
    puts(t);
    free(t);
    cJSON_Delete(o);
}

static void print_key(const char *sha256, const char *format, const char *uri, void *ctx) {
    (void)ctx;
    printf("%s\t%s\t%s\n", sha256, format, uri);
}
static char *slurp_stdin(void) {
    size_t cap = 1 << 16, n = 0, r;
    char *b = malloc(cap + 1);
    while ((r = fread(b + n, 1, cap - n, stdin)) > 0) { n += r; if (n == cap) { cap *= 2; b = realloc(b, cap + 1); } }
    b[n] = 0;
    return b;
}

int main(int argc, char **argv) {
    if (argc < 2) return usage();
    const char *cmd = argv[1];
    opts_t o;
    if (parse(argc, argv, &o)) return usage();
    omx_panel_store_error err = { 0 };
    err.message[0] = 0;

    if (!strcmp(cmd, "source")) {
        char hex[65];
        if (!o.format || !o.path) return usage();
        if (omx_panel_store_source(o.format, o.path, hex)) { fprintf(stderr, "panel-store.unreadable %s: no source can be made of it as %s\n", o.path, o.format); return 1; }
        puts(hex);
        return 0;
    }
    if (!strcmp(cmd, "rules")) {
        /* the one place a derivation outside C reads the reader's rules version from (docs/descriptions-store.md 5) */
        if (argc != 2) return usage();
        printf("%d\n", OMX_PANEL_RULES_VERSION);
        return 0;
    }
    if (!strcmp(cmd, "build")) {
        /* the base from the derived entries on stdin (docs/descriptions-store.md 6); the base builder reads no variable
         * but the contract directory's, as every door of the command does */
        if (!o.out || !o.built_from) return usage();
        char *in = slurp_stdin();
        int rc = omx_panel_store__build(o.out, o.built_from, or_env(o.contract, "OMX_CONTRACT_PATH"), in, &err);
        free(in);
        return rc ? fail(rc, &err) : 0;
    }
    if (!strcmp(cmd, "places")) {
        if (!o.production || (strcmp(o.production, "user") && strcmp(o.production, "system"))) return usage();
        char *b, *s, *u;
        if (omx_panel_store__places(strcmp(o.production, "user") ? OMX_PANEL_STORE_SCOPE_SYSTEM : OMX_PANEL_STORE_SCOPE_USER, &b, &s, &u, &err)) return fail(1, &err);
        cJSON *j = cJSON_CreateObject();
        cJSON_AddStringToObject(j, "base", b);
        cJSON_AddStringToObject(j, "system", s);
        cJSON_AddItemToObject(j, "user", str_or_null(u));
        char *t = cJSON_PrintUnformatted(j);
        puts(t);
        free(t); cJSON_Delete(j); free(b); free(s); free(u);
        return 0;
    }
    int writer = !strcmp(cmd, "put") || !strcmp(cmd, "remove") || !strcmp(cmd, "list");
    if (strcmp(cmd, "get") && strcmp(cmd, "check") && !writer) return usage();
    char *base, *system, *user;
    const char *contract;
    omx_panel_store_scope scope;
    int rc = resolve(&o, writer, &base, &system, &user, &contract, &scope);
    if (rc < 0) return usage();
    if (rc) return 1;

    if (!strcmp(cmd, "check")) {
        omx_panel_store *s;
        rc = omx_panel_store_open_at(base, system, user, contract, &s, &err);
        if (rc) return fail(rc, &err);
        omx_panel_store_close(s);
        puts("ok");
        return 0;
    }
    if (!strcmp(cmd, "list")) {
        /* the keys of the layer of the effective uid; a layer not made yet holds none, and is not made by a list */
        int root = geteuid() == 0;
        const char *path = root ? system : user;
        if (!path || access(path, F_OK)) return 0;
        omx_panel_store *w;
        rc = omx_panel_store_writer_open_at(path, root ? 1 : 2, contract, &w, &err);
        if (rc) return fail(rc, &err);
        rc = omx_panel_store__keys(w, print_key, NULL, &err);
        omx_panel_store_close(w);
        return rc ? fail(rc, &err) : 0;
    }
    if (!o.sha256 || !o.format || !o.uri) return usage();
    omx_panel_store_key key = { o.sha256, o.format, o.uri };
    if (!strcmp(cmd, "get")) {
        if (!o.source) return usage();
        omx_panel_store *s;
        rc = omx_panel_store_open_at(base, system, user, contract, &s, &err);
        if (rc) return fail(rc, &err);
        if (o.rules) omx_panel_store_set_rules(s, o.rules);
        omx_panel_store_entry e;
        rc = omx_panel_store_get(s, &key, o.source, &e);
        if (rc == OMX_PANEL_STORE_NO_ENTRY) puts("null");
        else if (rc == 0) print_entry(&e);
        else { err.code = omx_panel_store_code(rc); snprintf(err.message, sizeof err.message, "%s", omx_panel_store_message(s)); }
        omx_panel_store_close(s);
        return rc == 0 || rc == OMX_PANEL_STORE_NO_ENTRY ? 0 : fail(rc, &err);
    }
    /* put and remove write the layer of the effective uid */
    omx_panel_store *w;
    int root = geteuid() == 0;
    rc = omx_panel_store_writer_open_at(root ? system : user, root ? 1 : 2, contract, &w, &err);
    if (rc) return fail(rc, &err);
    if (!strcmp(cmd, "remove")) rc = omx_panel_store_remove(w, &key, &err);
    else { char *in = slurp_stdin(); rc = omx_panel_store_put(w, &key, in, &err); free(in); }
    omx_panel_store_close(w);
    return rc ? fail(rc, &err) : 0;
}
