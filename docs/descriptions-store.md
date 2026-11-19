<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# The descriptions store

Status: draft. Design spec, not built. It designs within the owner's decisions of 2026-11-19 and re-opens none of them.
A fact checked against a file names the file (sibling repositories at `origin/main`, zynthian-ui at its `openmixer`
branch). Anything else is marked as an assumption. The owner's answers to the questions this design raised are in section 14.

A plugin's panel description and its inferred port groups are made today on each run of each consumer: the console's
server cuts a description from a descriptor, Zynthian runs `omx-panel describe` per plugin, `omx-complement-sync` infers
the groups of every LV2 bundle again, and plugin-hostd reads declared `pg:group` only. This spec keeps them as DATA, in
three SQLite files keyed like the qualification store, so every consumer reads one answer per plugin binary, inference
runs once per plugin and layer, and each host generates its toolkit files from the stored data.

## 1. Scope

### What the store is

- Three files `panel.sqlite`, owned by omx-panel: a base built centrally and shipped in a noarch package, a system layer
  and a user layer (section 2).
- One schema, `schema/panel.sql` in this repository, with its own `PRAGMA user_version` (section 3).
- One reader and one writer, in C, with a command over them and a Python door (section 5).
- The key of the qualification store, (`sha256`, `format`, `uri`), so a host joins the two stores on that triple.

### What it is not

- Not a qualification store. The qualification store (plugin-db-qualification
  plugin-db-qualification's qualification store spec) holds no description, and this store holds no qualification figure.
- Not a toolkit file. A MOD GUI, an LV2 complement bundle and an LV2 desktop UI bundle are generated on each host from
  the store and never shipped in a package (section 6).
- Not the derivation. `tools/describe.mjs`, `tools/group-infer.mjs` and `tools/group-model.mjs` stay the one derivation;
  the store keeps their answers.
- Not the behaviour core. The core (`docs/behaviour-core.md`) reads a served description; the store is where the served
  description is kept.

### What it replaces

| Today | Where | With the store |
|---|---|---|
| the description made per call | `bin/omx-panel.mjs:154` `describeCommand` (`--descriptor <file>`, stdout only); zynthian-ui `zyngine/zynthian_engine_plugin_hostd.py:1135` and `:1190` run it per plugin; the console's server cuts it with `@openmixer/omx-panel` (`docs/group-model.md`, "Where it lives") | read from the store by key; derived once, when the key is absent |
| the port groups inferred per run | `tools/lv2-complement.mjs:227-228` (`inferGroups` with the model's instance groups) on every bundle of every run | read from the store; inferred once, when the key is absent |
| declared groups only in plugin-hostd | plugin-hostd `src/lv2.c:918` (`port_read`, `pg:group`), `src/lv2.c:1120` (pages of 8 by group), `src/transforms.c:446` | the store's groups, else the plugin's declared `pg:group` (section 7) |

## 2. Files and locations

| file | path | shipped or written by | opened |
| --- | --- | --- | --- |
| base | `/usr/share/omx/panel/panel.sqlite` | the noarch package `omx-panel-descriptions`, built centrally (section 6) | read only, immutable |
| system layer | `/var/lib/omx/panel/panel.sqlite` | a writer run as root or as a system service | read only by readers; read-write by the writer only |
| user layer | `<home>/.local/share/omx/panel/panel.sqlite`, `<home>` from `getpwuid(geteuid())`; `XDG_DATA_HOME` is not read | a writer run as that user | the same |
| the DDL | `schema/panel.sql` in this repository | read by the writer when it builds the base or creates a layer | |

**Scopes.** `OMX_PANEL_STORE_SCOPE_USER` reads the user layer, the system layer and the base, in that order of
precedence. `OMX_PANEL_STORE_SCOPE_SYSTEM` reads the system layer and the base and never the home. A process takes
`SYSTEM` when its effective uid is 0 and `USER` otherwise, the rule plugin-hostd applies to its directories today
(plugin-hostd `docs/guide.md:180-181`). The writer writes the layer of the same rule: the system layer as root, the user
layer otherwise, never both and never the base. This differs from the qualification store, whose user scope reads the
base and the home's layer only (its section 2): the owner decided this store merges three layers (section 4).

**Pointing elsewhere** follows omx-contract `docs/runtime-data.md` and the qualification store's section 2:

- The production entry point, `omx_panel_store_open(scope)`, takes no path and reads no environment variable: not
  `XDG_DATA_HOME`, not `HOME`, not `OMX_CONTRACT_PATH`.
- `omx_panel_store_open_at(base, system, user, contract_dir)` takes the four places. Its header says TEST AND COMMAND
  ONLY, and no production binary calls it.
- The command `omx-panel-store` takes `--base`, `--system`, `--user` and `--contract-dir`, and when a flag is absent
  reads `OMX_PANEL_STORE_BASE`, `OMX_PANEL_STORE_SYSTEM`, `OMX_PANEL_STORE_USER` and `OMX_CONTRACT_PATH`, then the
  installed places. Only the command and the tests read these variables.
- The base builder takes its input and `--out` as required flags and reads no variable.

## 3. Schema

### 3.1 What a row is

An ENTRY is the description of one plugin binary and its port groups: one `description` row and the `port_group_*`
rows of the same plugin, in one layer. The entry is the unit of the merge (section 4) and of a write: the writer
replaces a key's whole entry in one transaction.

The PLUGIN KEY is the qualification store's (its section 3.1): `sha256`, the SHA-256 of the plugin's binary as 64
lowercase hex digits (plugin-hostd computes it at an add, `src/descriptors.c:173-201` `identify`); `format`, a plugin-db
format word (`clap`, `lv2`); `uri`, the CLAP id or the LV2 URI (for a CLAP plugin the id after the `#` of
`clap:<path>#<id>`, as plugin-hostd `src/supervisor.c:3793-3799` `record_id` names a record). A different SHA-256 is a
different plugin.

### 3.2 Values

The qualification store's rules hold as written there (its section 3.2): a WORD column holds no white space and is
checked against its owner's domain item through `word_check`, never by shape alone; a NAME is stored as written; every
table is `STRICT`; a boolean is `INTEGER` with `CHECK (c IN (0, 1))`; no `CHECK` holds a list of quoted words. The one
JSON column is checked by `json_valid` in the DDL and against the description schema by the writer.

### 3.3 DDL

`schema/panel.sql` holds exactly this, with `WORD(c)` written out as the qualification store writes it. Foreign keys
are `ON DELETE CASCADE`; the writer runs with `PRAGMA foreign_keys = ON`.

```sql
CREATE TABLE store_info (
  one         INTEGER PRIMARY KEY CHECK (one = 1),
  layer       INTEGER NOT NULL CHECK (layer IN (0, 1, 2)),   -- 0: the base, 1: the system layer, 2: a user layer
  description TEXT NOT NULL,           -- the description's format name, as the description schema names it
  built_from  TEXT CHECK (built_from IS NULL OR (length(built_from) = 40 AND built_from NOT GLOB '*[^0-9a-f]*'))
                                       -- base: the commit its input was built from; a layer: NULL
) STRICT;

CREATE TABLE store_domain (            -- each domain the words were checked against, at its info.version
  domain  TEXT PRIMARY KEY,            -- 'panel', 'plugin-db'
  version TEXT NOT NULL
) STRICT;

CREATE TABLE word_check (
  tbl TEXT NOT NULL, col TEXT NOT NULL,
  domain TEXT NOT NULL REFERENCES store_domain,
  item TEXT NOT NULL,
  PRIMARY KEY (tbl, col, domain, item)
) STRICT;

CREATE TABLE plugin (                  -- the qualification store's plugin table, column for column
  plugin_id INTEGER PRIMARY KEY,
  sha256    TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  format    TEXT NOT NULL CHECK (WORD(format)),
  uri       TEXT NOT NULL CHECK (length(uri) > 0),
  UNIQUE (sha256, format, uri)
) STRICT;
```

The entry's own tables are in 3.4.

### 3.4 The entry: to agree with the description schema owner

The tables below are drafted from the description `omx-panel describe` serves today and are kept minimal. Their columns
are agreed with the description schema owner before step 1 (section 13) merges; until then they are a proposal.

What `describe` serves today (`tools/describe.mjs:283-309`): `family`, `fingerprint`, `easy`, `params`, `sections`
(each with `bars`, or with the served `matrix` of a repeated group, `docs/group-model.md` "The served matrix"),
`controls`, `meters`, `roles`, `displays` and `pages`. What the complement writes (`tools/lv2-complement.mjs:227-228`):
the verdict of `inferGroups` (`tools/group-infer.mjs:194`) with the group model's instance groups, each group a
`symbol`, a `name`, a `displayPriority`, its `ports` by port symbol and the `rule` that made it.

```sql
CREATE TABLE description (
  plugin_id   INTEGER PRIMARY KEY REFERENCES plugin ON DELETE CASCADE,
  edited      INTEGER NOT NULL CHECK (edited IN (0, 1)),   -- 1: written by a person; 0: derived by omx-panel
  made_by     TEXT NOT NULL,           -- a name: the omx-panel version that derived it, or that checked an edit
  rules       INTEGER NOT NULL CHECK (rules >= 1),          -- OMX_PANEL_RULES_VERSION of the derivation (3.6)
  source      TEXT NOT NULL CHECK (length(source) = 64 AND source NOT GLOB '*[^0-9a-f]*'),
                                       -- SHA-256 of the derivation's input as installed (3.6), not of the binary
  family      TEXT NOT NULL CHECK (WORD(family)),           -- a PANEL_FAMILIES word
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
                                       -- describe's fingerprint of its OUTPUT, as served today
  body        TEXT NOT NULL CHECK (json_valid(body))        -- describe's `description`, canonical JSON, `pages` left out
) STRICT;

CREATE TABLE port_group_verdict (      -- LV2 only in this pass: CLAP states no port groups
  plugin_id INTEGER PRIMARY KEY REFERENCES description ON DELETE CASCADE,
  outcome   TEXT NOT NULL CHECK (WORD(outcome)),            -- NEW PANEL_GROUP_OUTCOMES
  reason    TEXT CHECK (reason IS NULL OR WORD(reason))     -- NEW PANEL_GROUP_REASONS
) STRICT;

CREATE TABLE port_group (
  plugin_id        INTEGER NOT NULL REFERENCES port_group_verdict ON DELETE CASCADE,
  symbol           TEXT NOT NULL,      -- a name: the group's lv2:symbol
  name             TEXT NOT NULL,      -- a name: its lv2:name
  display_priority INTEGER NOT NULL,
  rule             TEXT NOT NULL CHECK (WORD(rule)),        -- NEW PANEL_GROUP_RULES
  declared         INTEGER NOT NULL CHECK (declared IN (0, 1)),  -- 1: the plugin's own node, kept
  PRIMARY KEY (plugin_id, symbol)
) STRICT;

CREATE TABLE port_group_member (
  plugin_id    INTEGER NOT NULL,
  group_symbol TEXT NOT NULL,
  port_symbol  TEXT NOT NULL,          -- a name: the port's lv2:symbol, never a blank node
  PRIMARY KEY (plugin_id, port_symbol),
  FOREIGN KEY (plugin_id, group_symbol) REFERENCES port_group (plugin_id, symbol) ON DELETE CASCADE
) STRICT;
```

- The description is derived with the stored groups applied: for an LV2 plugin whose verdict is `grouped`, a control of
  the descriptor that states no group takes its stored group as its group path before `describe` runs. The sections a
  surface draws and the groups jalv and plugin-hostd see are then one grouping.
- A verdict of `nothing-to-do` or `no-confident-grouping` holds no `port_group` row: the plugin keeps its declared groups.
- `pages` is not stored: it depends on the surface's width (`perPage`). A reader cuts them on read, `omx-panel describe
  --pages`, over the stored description (section 14, 1).

### 3.5 `user_version`

`PRAGMA user_version = 1`, `OMX_PANEL_STORE_SCHEMA_VERSION`, held once in `schema/panel.sql` and compiled into the reader
and the writer. Any change of the DDL is +1, and the rule is the qualification store's (its section 3.6): a reader reads
exactly its version; `schema-other` for a file at another version; `schema-mismatch` when the opened files differ from
each other (checked first, naming every file and version); `not-a-store` for 0, a missing `store_info` row, or a file
whose `store_info.layer` is not the place it was opened as. The base is built new at each version and never upgraded; a
system layer is not upgraded: it is derived again.

**A schema change** (section 14, 9; an owner-approved compatibility mechanism, scoped as follows and no wider). An
omx-panel release that raises `OMX_PANEL_STORE_SCHEMA_VERSION` installs a base at the new version. Then:

- **The base** is the new package's: built at the new version, never migrated.
- **The system layer** is regenerated: its writer, finding the layer at another version, replaces it with an empty layer
  at the new version, and the next pass and plugin-hostd's asks derive its entries again.
- **A user layer** is MIGRATED, and only its edited entries (`edited` 1): the writer, opening a user layer at an older
  version, writes a new layer at the new version holding the person's edits carried across (each one checked as an entry
  of the new schema; one that cannot be carried is kept aside in a file beside the layer and named, never dropped
  silently), renames it into place in one step, and leaves the derived entries to be derived again. The migration
  reads the one previous version only; it is written with the schema change that needs it and removed with the next.
- **A reader** that opens files at different versions answers `schema-mismatch` as above until the writers have run.
  It never reads an old layer itself.

### 3.6 Stale entries: the input and the rules

The key names the binary only, but an entry is derived from more than the binary: from the descriptor or the LV2
bundle's TTL, and from omx-panel's rules. An LV2 bundle whose TTL changes over the same `.so`, or a newer omx-panel that
derives otherwise, would keep serving the old entry from every layer. So each entry stores what it was derived from:

- `source`: the SHA-256 of the derivation's input as installed. For an LV2 plugin, the bundle's `.ttl` files, sorted by
  name, each as its name, a NUL and its bytes; for a CLAP plugin, the descriptor document `describe` read. One function
  computes it, `omx_panel_store_source(format, path, hex_out)`, in the reader library, so every caller hashes the same
  bytes the same way.
- `rules`: `OMX_PANEL_RULES_VERSION`, an integer in omx-panel raised by every change that moves `describe`'s or the
  inference's output for the same input (a golden of the derivation tests changes with it, so the raise is not forgotten).

The reader is given the caller's current `source` with the key (`omx_panel_store_get` takes it, section 5) and walks
the layers top down:

- an entry whose `source` differs from the caller's is STALE: it is skipped as if absent, and the next layer is read;
- a derived entry (`edited` 0) whose `rules` is below the reader's is STALE the same way;
- an edited entry (`edited` 1) is never staled by `rules` (the person's choice stands across omx-panel releases), but is
  staled by `source` (its ports may be gone). It is skipped, never deleted, and the answer names it (`stale_edit`, the
  layer) so a client can tell the person;
- `made_by` is a name for a person reading the row; no rule reads it.

A key whose every entry is stale is ABSENT to a producer: a generator, `describe --store` or plugin-hostd's ask derives
it again and the writer replaces its own layer's stale entry. A stale entry in a layer the producer may not write stays
until that layer's writer runs (the base: the next base build). Entries of plugins no longer installed are pruned: each scan prunes the system and user layers it may write, each
release of the base prunes the base (section 14, 3).

### 3.7 Joining the qualification store

The `plugin` tables are the same DDL. A host joins the two on the triple, never on `plugin_id`:

```sql
ATTACH 'file:/usr/share/omx/qualification/qualification.sqlite?mode=ro&immutable=1' AS q;
SELECT d.family, r.outcome
  FROM main.plugin p JOIN main.description d USING (plugin_id)
  JOIN q.plugin qp ON qp.sha256 = p.sha256 AND qp.format = p.format AND qp.uri = p.uri
  JOIN q.record r ON r.plugin_id = qp.plugin_id;
```

A merged answer (a layer over the base) comes from each store's reader; the two answers are joined on the same triple.

## 4. Merge semantics

- **Per whole entry.** When the user layer holds an entry for a key, that entry is the answer: the system layer's and
  the base's entries of the key are hidden whole, their description and their groups. Else the system layer's entry, else
  the base's. No field of a lower layer is ever taken beside a field of a higher one: a description and its groups are
  one derivation, and a user's edit of one section is a whole description.
- **Lower layers are never written by a higher writer.** The base is immutable; the user writer never opens the system
  layer for writing, and neither writer opens the base.
- **No tombstone.** Nothing asks to hide a lower entry without giving one: a user who wants a plugin left as it is writes
  an entry whose verdict is `nothing-to-do`. Removing a layer's entry brings the lower one back.
- **Conflicts.** One entry per key per layer (`description.plugin_id` is the key's). A newer write for a key replaces the
  layer's entry whole, in one transaction. Across layers there is no conflict, and each answer names its `layer`.
- **Absent layers.** An absent system or user layer is an empty layer. An absent base is `panel-store.absent`.

## 5. Reader and writer

**Language: C.** One library, `libomx-panel-store.so.0`, header `<omx-panel/omx_panel_store.h>`, pkg-config
`omx-panel-store`, built in a NEW directory `store/` beside `renderer/`, with the export map and ABI file of the
renderer (`renderer/src/exports.map`, `renderer/abi/`). Its soname stays `.so.0` through development.

```c
typedef struct omx_panel_store omx_panel_store;          /* opened layers; opaque */
typedef enum { OMX_PANEL_STORE_SCOPE_USER, OMX_PANEL_STORE_SCOPE_SYSTEM } omx_panel_store_scope;
typedef struct { const char *code; char message[256]; } omx_panel_store_error;

int  omx_panel_store_open(omx_panel_store_scope scope, omx_panel_store **out, omx_panel_store_error *err);
/* TEST AND COMMAND ONLY */
int  omx_panel_store_open_at(const char *base, const char *system, const char *user, const char *contract_dir,
                             omx_panel_store **out, omx_panel_store_error *err);
void omx_panel_store_close(omx_panel_store *s);

typedef struct { const char *sha256, *format, *uri; } omx_panel_store_key;
typedef struct { const char *symbol, *name, *rule; long display_priority; int declared;
                 const char *const *ports; size_t nports; } omx_panel_store_group;
typedef struct {
    const char *layer;                                   /* "user", "system" or "base" */
    const char *stale_edit_layer;                        /* a layer whose edited entry was skipped as stale, or NULL */
    int edited; const char *made_by, *family, *fingerprint, *body;   /* body: the description as JSON */
    const char *group_outcome, *group_reason;            /* NULL: no verdict (a CLAP plugin) */
    const omx_panel_store_group *groups; size_t ngroups;
} omx_panel_store_entry;

/* 0 and *e filled, valid until the next call on s; OMX_PANEL_STORE_NO_ENTRY for a key no layer holds */
/* source: the caller's omx_panel_store_source() of the plugin as installed (section 3.6); a stale entry is skipped */
int  omx_panel_store_get(omx_panel_store *s, const omx_panel_store_key *k, const char *source, omx_panel_store_entry *e);
int  omx_panel_store_source(const char *format, const char *path, char hex_out[65]);

/* The writer: the layer of the effective uid (section 2), created from schema/panel.sql when absent. */
int  omx_panel_store_writer_open(omx_panel_store **out, omx_panel_store_error *err);
int  omx_panel_store_put(omx_panel_store *w, const omx_panel_store_key *k, const char *entry_json, omx_panel_store_error *err);
int  omx_panel_store_remove(omx_panel_store *w, const omx_panel_store_key *k, omx_panel_store_error *err);
```

- **Refusals, by name** (NEW `PANEL_STORE_CODES`, `x-c-codes`, in the `panel` domain, as `docs/behaviour-core.md`
  section 4 adds its codes): `panel-store.absent`, `.unreadable`, `.not-a-store`, `.schema-mismatch`, `.schema-other`,
  `.domain-too-old`, `.word-unknown`, `.hot-journal`, `.busy`, `.entry-invalid` (a put whose JSON is not an entry of the
  description schema or whose words are not in their items), and the loader's codes passed through. Each is the
  qualification store's code of the same name (its section 6), with `panel-store.` for the prefix.
- **Word check at open** and at put, through omx-contract's loader (`omx_domain_open`, `omx_domain_word`), once.
- **Concurrency**, as the qualification store's: the base opened `mode=ro&immutable=1`; a layer opened `mode=ro` with
  `busy_timeout` 250 ms by a reader; the rollback journal (`journal_mode` `DELETE`), not WAL; one entry per transaction.
  Several writers (plugin-hostd's child, a generator, a person) share a layer through SQLite's lock.
- **Never in a real-time path.** Every call allocates, reads files and takes locks. A plugin window and plugin-hostd read
  an entry when a plugin is added or a window opens, and copy what they keep.
- **SQLite floor 3.38.0**: `STRICT` (3.37.0) and `json_valid` built in (3.38.0). No ceiling.

**The doors.** omx-panel has today a JavaScript package (`package.json` `exports`) and two C libraries
(`libomx-panel-render`, the window); `docs/behaviour-core.md` section 3 plans a wasm module and one ctypes module. The
store has:

| Client | Door |
|---|---|
| plugin-hostd, a plugin window, the LV2 desktop UI, any C program | link `omx-panel-store` |
| Zynthian, a Python tool | `omx_panel_store.py`, ctypes on `libomx-panel-store.so.0`, in `python3-omx-panel-store`; it holds no rule |
| omx-panel's own tools, the console's server (Node.js) | the command `omx-panel-store get --json` and `put` (stdin), one call per plugin or per run: Node.js 18, this package's floor (`package.json` `engines`), has no SQLite, as the qualification store's ruling 4 found |
| a browser | none: a browser has no store; the console serves the description |

**The command** `omx-panel-store`: `get --sha256 .. --format .. --uri .. --json` (the entry and its layer), `put
--sha256 .. --format .. --uri ..` (the entry as JSON on stdin, into the layer of the effective uid), `remove`, `check`
(opens every layer, prints `ok` or the code), `build --in <dir> --out <file> --built-from <commit>` (the base, section
6), and the four place flags of section 2. Exit 0, 1 with the code, 2 on usage.

## 6. Producers

### The generators read, infer only what is absent, and write the layer they may

`omx-modgui-sync`, `omx-complement-sync` and the NEW LV2 desktop UI generator (`omx-lv2ui-sync`, section 8) each do,
per installed plugin:

1. read the store by key (the scope of their uid);
2. when no layer holds the key, run `omx-panel describe --plugin <target> --store` (below): the description derived, the
   groups inferred, the entry written to the layer the generator may write (the system layer as root, the user layer
   otherwise);
3. generate their toolkit files from the entry, whatever layer it came from.

No generator infers a key the store holds. The three run as one pass (omx-plugins#120, "One sync pass"),
`omx-panel-sync`, which runs step 2 once per plugin and then the three generators; each generator stays callable alone.

**The single-plugin call.** `omx-panel describe` takes `--descriptor <file>` and prints `{ description, refusals }` to
stdout; it writes nothing and infers no port group (`bin/omx-panel.mjs:11`, `:154-203`). NEW:

```
omx-panel describe --plugin <target> [--descriptor <file>] [--sha256 <hex>] --store
```

`<target>` is `clap:<path>#<id>` or `lv2:<uri>`, the form `plugin-hostd-probe describe` takes. With `--store` it reads the
store first and prints the entry it finds, writing nothing. Else it takes the descriptor given, or finds one in
`omx-modgui-sync`'s order (the installed declaration, the descriptor directories, `plugin-hostd-probe describe`,
`bin/omx-modgui-sync:16-19`), infers the LV2 groups as `tools/lv2-complement.mjs:227-228` does, derives the description
over them (section 3.4), writes the entry through `omx-panel-store put` and prints it. `--sha256` is the binary's hash
when the caller has it; else the command hashes the binary by the same rule. One plugin, never a scan.

### Generated files are never shipped

A MOD GUI, an LV2 complement bundle and an LV2 UI bundle are generated on each host and never shipped in a package. That
includes omx-plugins' committed MOD GUIs: each plugin's bundle carries `modgui.ttl` and `modgui/` generated by
`omx-panel modgui` and committed (omx-plugins `plugins/omx-comp/Makefile:78-85`, `:113-120`; its manifest's
`rdfs:seeAlso <modgui.ttl>`, `tools/gen.mjs:771`). They leave the tree and the packages; `omx-modgui-sync` gives those
plugins their MOD GUI on the host, from the base's entries, as it does for any plugin without one.

### The base is built centrally

`omx-panel-store build` writes the base from a directory of inputs (each a descriptor with its plugin key, and for an LV2
plugin its bundle's TTL), running the same derivation per input. It follows the qualification store's migration rules
(its section 5): a new file each run, inputs in byte order of their paths, rows in a fixed order, `journal_mode`
`DELETE`, `page_size` 4096, `VACUUM`, `user_version` last, written to a temporary file and renamed only when complete;
row-identical everywhere and byte-identical with the same SQLite; `built_from` from git or a substituted `BUILT_FROM`
file, refused as `built-from-unknown` when neither. The package `omx-panel-descriptions` is noarch: a key carries its
binary's hash, so one file serves every architecture. Its inputs (the reference sets' descriptors and TTL) live with the base package's build in omx-panel (section 14, 2).

### No unit is needed

Nothing in this design depends on systemd. Every producer is a command a person, a script, a package trigger or
plugin-hostd runs directly. The units (section 10) are a batch convenience: enabled by default where systemd exists,
and nothing depends on them (section 14, 5).

## 7. plugin-hostd

### What it does today with an unknown or unqualified plugin

- **The add is not gated by a record.** "a record gates no add" (`src/qualcost.h:8-10`); "A descriptor describes a
  plugin; it gates no load" (`src/descriptors.h:8-10`).
- **The pin.** With `require_pins` 1 (the default, `docs/guide.md:204`) and `pin_mode` `first-use`, a plugin with no pin
  gets one learned from its files as they are and is not asked about again (`src/supervisor.c:2170-2182`). A plugin
  whose pin carries no in-process verdict is placed in a worker of its own (`src/supervisor.c:2192-2198`).
- **The figures.** The planner reads the cost of `qualification_dir`'s records by `record_id`
  (`src/supervisor.c:3793-3799`, `:3846-3852`); with no record the cost is `PLANNER_COST_UNKNOWN`
  (`src/qualcost.h:20-22`); `estimate` names such a member `-533` (`docs/guide.md:310`).
- **The descriptor.** After the add's reply, `descriptors_add` (`src/verbs.c:224-226`) starts, unless one is in place,
  `<probe> describe <target>` and then `<probe> panel <target>` in a child of its own (`src/descriptors.c:266-325`,
  `:335-397`), confined by `proc_confine` (`:309`); the file is named by the binary's SHA-256 (`docs/guide.md:180`).
- **The groups.** Declared `pg:group` only (`src/lv2.c:918`), cut into pages of 8 (`src/lv2.c:1120-1123`) and served by
  `remote_page_get` (`src/lv2.c:1200`); `src/transforms.c:446` maps a port's group. plugin-hostd never infers
  (plugin-hostd#179).

### What changes

- **Groups from the store, else declared.** At an add, after `identify` (`src/descriptors.c:173-201`) gives the format,
  the id and the hash, plugin-hostd reads the store entry of that key with the plugin's `source` as installed (`omx_panel_store_get`, its
  scope by its uid; a stale entry is absent, section 3.6). A
  `grouped` verdict's groups replace the declared ones for the pages and the port-group transform; any other verdict, or
  no entry, keeps the declared `pg:group`. plugin-hostd never infers. This is plugin-hostd#179's proof through the
  store: a plugin whose groups only the store holds pages the same as jalv reads through the complement, and is red
  with the entry removed.
- **The ask, for an unknown plugin.** A plugin is unknown when no layer holds its key. plugin-hostd then asks for that
  one plugin's qualification and description, never a scan and never another plugin: once the descriptor stage of
  `descriptors_add` has ended, it runs, as children of its own at the lowest priority (`nice` 19, `SCHED_IDLE`, I/O
  class idle), under `proc_confine`, one after the other:
  1. `plugin-qualify-sync --plugin <target>` (`--system` when it runs as root): the NEW single-plugin call of section
     11. It does not exist today: `plugin-qualify-sync` scans every plugin (`packaging/plugin-qualify-sync.1`, synopsis)
     and `plugin-qualify <uri>` measures one but writes only `--out` documents, no record and no layer
     (`packaging/plugin-qualify.1`).
  2. `omx-panel describe --plugin <target> --descriptor <the descriptor its scan wrote> --sha256 <hash> --store`.
  One ask per key at a time (as `scan_of` keeps one scan per binary, `src/descriptors.c:234`). A key whose ask failed is
  not asked again while plugin-hostd runs, until the next add of a changed binary; that memory is in the daemon only and
  is not stored, so a restart of plugin-hostd asks once more at the key's next add. Each child writes the layer it may
  (section 2).
- **Figures measured under load.** The ask runs while the engine plays, at the lowest priority: the cost and latency
  figures `plugin-qualify-sync --plugin` measures then are not a quiet machine's. Decided (section 14, 10): the ask is not
  deferred, and the single-plugin call records its figures with a measured-under-load mark (a NEW word of the
  qualification domain, the record's run condition, owner plugin-qualify). The planner reads the cost of such a record as
  `PLANNER_COST_UNKNOWN`, as it does with no record today (`src/qualcost.h:20-22`), and uses its verdicts; the next scan
  with the engine idle replaces the record whole. No figure measured under load is read as a quiet one.
- **The ask's toolkit files** (section 14, 6): after the two calls, the ask runs the three generators for THAT plugin
  only (`omx-complement-sync --only <bundle>`, `docs/lv2-complement.md:9-11`, and the same `--only` for the MOD GUI and
  the LV2 UI generators), under the same priority and confinement. Never another plugin.
- **Meanwhile the plugin loads as today**: declared groups, the first-use pin, unknown cost. When the ask ends,
  plugin-hostd reads the entry again; the next `remote_pages` and `panel_get` answer from it, and a NEW event
  `description_changed <uri>` tells the clients, as `pin_changed_event` does for a pin (`src/supervisor.c:2182`).
- **On by default when plugin-qualify is installed.** The NEW setting `ask_unknown` is `auto` (the default), `1` or `0`.
  `auto` asks when `plugin-qualify-sync` is found on the path (`proc_have_binary`, as the probe is checked at
  `src/descriptors.c:282`) and does nothing when it is absent: the plugin loads as today and nothing is reported as an
  error. The NEW optional last word of `add`, `ask` or `no-ask`, overrides the setting for that add either way. An ask
  forced while plugin-qualify is absent runs no child, logs the reason once, and the add answers as today. When
  `omx-panel` is absent, step 2 is skipped the same way.
- **No systemd.** plugin-hostd starts the children itself; no unit, timer or drop-in is involved, and none is required.
- **A key for clients.** NEW verb `description_get <uri>`: `resp 0 "<sha256> <format> <uri> <layer>"`, or `-529` when no
  layer holds it, `-530` while its ask runs. A client reads the store by that key.

## 8. Plugin GUIs

- **Every plugin of omx-plugins offers `clap.gui` and an LV2 `ui:X11UI`**, both drawn from its description by omx-panel's renderer
  window (`renderer/include/omx_panel_window.h`). `clap.gui` comes first as a Wayland floating window
  (`CLAP_WINDOW_API_WAYLAND`), then X11 embedded and floating; omx-clap-core's host already opens both
  (omx-clap-core `src/window.c:350`, `src/clap_host.h:963`). The window is X11 only today (its header: "X11"): Wayland
  is a NEW backend of the window. The window reads its plugin's entry from the store; with no store or no entry it
  draws the description the plugin carries (`org.openmixer.panel-description/1`, omx-plugins
  `include/omx_panel_description.h`) and never refuses to open (section 14, 4).
- **A CI gate in omx-plugins** refuses a plugin of the tree whose CLAP face answers no `clap.gui` from `get_extension` or whose
  LV2 bundle declares no `ui:X11UI` for the plugin. It runs over every plugin of the tree, sabotage-checked.
- **Third-party LV2 plugins get a desktop UI from the host.** `omx-lv2ui-sync` writes, for each installed LV2 plugin with
  no desktop UI, a separate bundle that declares a `ui:X11UI` on the plugin's URI, its `ui:binary` the one generic UI
  library omx-panel installs; the installed bundle is never touched, and the bundle is marked, rewritten and removed by
  the rules of the complement (`docs/lv2-complement.md`, "What is removed"). The generic UI reads the entry of the key
  the bundle names. No per-plugin binary is built.
- **A third-party CLAP plugin cannot get an outside UI.** CLAP has no way to attach a UI to another plugin: a host asks the
  plugin itself for `clap.gui`, and only the plugin can answer. A host may draw its own panel for it from the store;
  that is the host's window, not the plugin's.
- plugin-hostd's workers show no LV2 desktop UI (omx-clap-core `docs/lv2-compatibility.md:29`, `:202`). The LV2 UIs
  are for the hosts that do (jalv and desktop hosts); nothing changes in plugin-hostd for them.

## 9. Clients

- **The console** serves descriptions. Its server reads the entry by the key plugin-hostd's `description_get` gives, through
  the command, and serves the stored description to the browser; it cuts no description for a plugin the store holds.
  Drawing stays its own (Nuxt UI).
- **Zynthian's Tk UI** (zynthian-ui#93) reads the same entries through the ctypes door, by the same key, and draws them
  with Tk. The jalv path keeps reading groups through lilv from the complement bundle, which is generated from the
  same entry.
- **The plugin windows** read the same entries through the C library.
- Each toolkit draws; none derives a description or infers a group the store holds.

## 10. systemd: every place that assumes a unit

Nothing depends on a unit after this spec. The units stay, optional; the texts that present a unit as the way the work
happens say instead that the work runs on a direct call and that the unit is a batch convenience.

| Repository | Place | Today | Change |
|---|---|---|---|
| omx-panel | `systemd/omx-modgui-sync.service:5-6`, `:10-13`, `:25` | runs after each scan, opt-in | runs `omx-panel-sync` (one pass, section 6); enabled by default where systemd exists (section 14, 5) |
| omx-panel | `systemd/omx-complement-sync.service:5-6` | the same | folded into the one pass's unit |
| omx-panel | `systemd/plugin-qualify-sync.service.d/omx-modgui-sync.conf:10`, `omx-complement-sync.conf:7` | `ExecStartPost` queues each opt-in unit | one drop-in for the one pass, enabled by default where systemd exists (section 14, 5) |
| omx-panel | `Makefile:19`, `:110-114`; `packaging/omx-panel.spec:3-4`, `:40`, `:123-128`; `debian/rules:26`, `:39-43`; `debian/omx-panel.postinst:6-9` | install the units and drop-ins, never enabled | the same files for the one pass, ENABLED by default where systemd exists (section 14, 5); nothing depends on them |
| omx-panel | `etc/omx/modgui-sync.conf:3`; `bin/omx-modgui-sync:29` | the unit's `EnvironmentFile` | unchanged: the scripts read the same file run by hand |
| omx-panel | `bin/omx-modgui-sync:87-88`, `bin/omx-complement-sync:80-81` | `--check` reads other units' `LV2_PATH` when `systemctl` exists | unchanged: a check, skipped without systemd |
| omx-panel | `README.md:35`, `docs/overview.md:14-15`, `docs/lv2-complement.md:140-165`, `man/omx-modgui-sync.1:64-65`, `man/omx-complement-sync.1:52-53` | the unit after each scan is how GUIs and groups follow an install | the store, the direct call and plugin-hostd's ask first; the unit as a batch option |
| omx-panel | `test/modgui-sync.test.mjs:225-235`, `test/sync-drop-ins.test.mjs:3`, `:17`, `:44`, `test/packaging.test.mjs:23`, `:31`, `tools/deb-lint-check.sh:20-21` | hold the units and drop-ins | held for the one pass's unit; a NEW test runs the pass with no `systemctl` on the path |
| plugin-qualify | `packaging/systemd/plugin-qualify-sync.service:1-43`, `.path`, `.timer`, `plugin-qualify-sync-generator`, `plugin-qualify.tmpfiles.conf` | the batch scan | unchanged; the single-plugin call (section 11) runs without them |
| plugin-qualify | `packaging/systemd/80-plugin-qualify.preset:3-4`; `packaging/check-installed.sh:86-90` | the timer and the path unit enabled by the package, and checked so | unchanged: enabled by default where systemd exists (section 14, 5); nothing depends on them |
| plugin-qualify | `packaging/trigger-scan.sh:21-31`, `debian/triggers:1-6`, `debian/plugin-qualify.postinst:8-9`, `debian/rules:19-22`, `:33-43`, `packaging/plugin-qualify.spec:30`, `:57`, `:84-89`, `:101-109`, `:124-127`, `:140-143` | a package transaction starts the unit, else leaves a marker | unchanged |
| plugin-qualify | `packaging/plugin-qualify-sync.1` (FILES), `docs/overview.md:743-752` | the units as the way plugins are followed | name the single-plugin call and plugin-hostd's ask |
| plugin-hostd | `docs/own-host.md:95-96` | the realtime grant as a drop-in on `plugin-qualify-sync.service` | add: the ask's child inherits plugin-hostd's own grant; the drop-in stays for the batch |
| plugin-hostd | `docs/threat-model.md:18` | ships no unit | unchanged; add the ask's two children to the model |
| plugin-hostd | `tools/zynthian/image-boot-test.sh:96-97`, `:145-146` | lists the units an image holds, for observation | unchanged; the one pass's unit replaces the two names |
| omx-plugins | none | no file names a unit | none |

## 11. Cross-repository changes

### omx-panel

The store (`schema/panel.sql`, `store/`, `omx-panel-store`, `python3-omx-panel-store`); `omx-panel describe --plugin
--store`; the generators reading the store; `omx-panel-sync`; `omx-lv2ui-sync` and the generic UI library; the window's
Wayland backend; the base builder and `omx-panel-descriptions`; the NEW `panel` items `PANEL_GROUP_OUTCOMES`,
`PANEL_GROUP_REASONS`, `PANEL_GROUP_RULES` (the words `tools/group-infer.mjs` and `tools/group-model.mjs` write today)
and `PANEL_STORE_CODES`; the texts and tests of section 10.

### plugin-hostd-protocol

The `add` word `ask` / `no-ask`, the verb `description_get`, the event `description_changed`, and the codes they
answer, in its table, grammar and header (lane 7), before plugin-hostd answers them.

### plugin-hostd

The store reader linked; groups from the store, else declared; the ask, `ask_unknown`, the `add` word, the
`description_changed` event and `description_get`; `docs/guide.md`, `docs/panel.md`, `docs/threat-model.md`,
`docs/own-host.md`. plugin-hostd#179 is closed by the store: no lilv world change is needed for groups.

### omx-plugins

`clap.gui` and `ui:X11UI` in every plugin, drawn from its description; the CI gate; the committed MOD GUIs removed with
their `make modgui` checks, and the manifest's `<modgui.ttl>` with them (section 6).

### plugin-qualify

NEW `plugin-qualify-sync --plugin <target>`: the quick qualification of one plugin exactly as the scan gives it (pin,
sweep, cost, latency, descriptor, the distributed record when one applies), into the scope `--system` names, with the
same lock as a scan so a scan and a single call never measure at once (assumption: the sync has a lock to share; the
lane checks). It never scans. After the qualification store's consumer switch it writes that store's layer.

### plugin-db-qualification

Its spec names `plugin-qualify-sync of that user` and `plugin-qualify-sync --system` as the only writers of the two
layers, both "after the consumer switch" (plugin-db-qualification's qualification store spec, its section 2 table). plugin-hostd's ask writes a
layer through plugin-qualify's single-plugin call, run by another program. The spec's section 2 names the writer as
plugin-qualify's one writer module, called by a scan or by `--plugin`, for one plugin, in the scope of the caller's
uid; its section 6 adds that plugin-hostd starts a writer process for one plugin, which is no read ("it must not start a
process to read a figure" stands). The change is that repository's PR, with plugin-qualify's.

### zynthian-ui

The plugin-hostd engine reads entries through `omx_panel_store.py` by `description_get`'s key instead of running
`omx-panel describe --descriptor` per plugin (`zyngine/zynthian_engine_plugin_hostd.py:1092-1142`, `:1157-1200`,
branch `openmixer`); the Tk drawing is zynthian-ui#93's. The pages are cut on read by `omx-panel describe --pages` (section 14, 1).

### The console

The server reads the stored description by plugin-hostd's key, serves it, and keeps no derivation for a plugin the
store holds; it reacts to `description_changed`.

## 12. Ownership

| What | Owner domain | Producer | Changer | Readers |
|---|---|---|---|---|
| `store_info`, `store_domain`, `word_check`, `user_version`, the DDL | omx-panel | the writer | omx-panel | the reader |
| `plugin`: `sha256`, `format`, `uri` | the bytes; the format words are plugin-db's (checked against plugin-db's own item, the qualification store's precondition 2) | the writer, from the caller's key or the binary, by plugin-qualify's rule | nobody | every reader; the qualification store by the triple |
| `description` columns and `body` | the description schema (omx-panel), to agree with its owner | `tools/describe.mjs` through `describe --store`; a person for an edit (`edited` 1) | omx-panel | plugin-hostd, the console, Zynthian, the windows, the generators |
| `family` | `panel` (`PANEL_FAMILIES`) | the derivation | omx-panel | as above |
| `port_group_verdict.outcome`, `.reason` | `panel`, NEW `PANEL_GROUP_OUTCOMES`, `PANEL_GROUP_REASONS` | `tools/group-infer.mjs` | omx-panel | plugin-hostd, the complement |
| `port_group.rule` | `panel`, NEW `PANEL_GROUP_RULES` | `tools/group-infer.mjs`, `tools/group-model.mjs` | omx-panel | the complement; a reader of a diagnosis |
| `port_group` symbol, name, priority, `declared`; `port_group_member` | names | the inference, or the plugin for a declared node | omx-panel (the rules) | plugin-hostd, the complement, Zynthian |
| store refusal codes | `panel`, NEW `PANEL_STORE_CODES` | the reader and the writer | omx-panel | every door |
| `ask_unknown` (a plugin-hostd setting) | plugin-hostd | plugin-hostd | plugin-hostd | the person configuring it |
| the `add` word `ask` / `no-ask`, the verb `description_get`, the event `description_changed`, and the codes they answer (today's `-529` `DESCRIPTOR_ABSENT` and `-530` `DESCRIPTOR_PENDING`, `doc/protocol.md:843-844`, widened to the store, or new codes) | plugin-hostd-protocol (its table, grammar and header) | plugin-hostd | plugin-hostd-protocol | the console, Zynthian |
| `plugin-qualify-sync --plugin` | plugin-qualify | plugin-qualify | plugin-qualify | plugin-hostd |
| the qualification store's writers | plugin-db-qualification | plugin-qualify | plugin-db-qualification (spec), plugin-qualify (code) | |

## 13. Lanes

In this order. Each is one PR in its owner repository, red first: one commit of tests that fails, the failing line and
the run in the PR body, then the commits that turn it green.

1. **omx-panel: the store and its reader.** Proves: three layers merged whole, scopes, no environment, one version.
   Red: the reader's tests against a library that does not exist: an absent base is `absent`; a user entry hides the
   system's and the base's description and groups (sabotage: take the base's groups under a user description); the
   system scope never opens the home; a fixture `XDG_DATA_HOME` is not read; files at two versions are
   `schema-mismatch`; an entry with a family not in `PANEL_FAMILIES` is `entry-invalid`; the base file unchanged after
   reads; `json_valid` refuses a bad body; an entry whose `source` differs from the caller's, or a derived entry below the
   reader's `rules`, is skipped and the next layer answers, and a stale edited entry is named, not deleted. Precondition: the description schema owner agrees section 3.4.
2. **omx-panel: `describe --plugin --store`.** Proves: one plugin, inferred once, the layer by uid. Red: a fixture with two
   plugins writes only the named one's entry to the user layer when run unprivileged; a second run writes nothing; a key
   the base holds is printed, not derived; an LV2 fixture without `pg:group` gets the groups the complement infers and a
   description whose sections are those groups.
3. **omx-panel: the generators read the store and `omx-panel-sync`.** Proves: no inference for a stored key, one pass,
   no systemd. Red: a fixture store whose entry's groups differ from what the rules infer makes the complement write
   the store's groups (red today: it infers); the pass runs with no `systemctl` on the path; an entry of a plugin no longer installed is pruned from the layer
   the pass writes, and a lower layer's is not touched; section 10's texts.
4. **omx-panel: the base and `omx-panel-descriptions`.** Proves: reproducible, noarch. Red: two builds give the same
   sorted dump and bytes; the package holds `/usr/share/omx/panel/panel.sqlite` at `layer` 0 with `built_from`.
5. **plugin-qualify: `plugin-qualify-sync --plugin`.** Proves: one plugin, never a scan. Red: two fixture plugins on the
   search path, `--plugin A` gives A a record, a pin and a descriptor and B none; a run as non-root writes no system path; the record is marked measured under load when
   the call is told the engine runs, and the planner fixture reads its cost as unknown.
6. **plugin-db-qualification: the writer clause of its section 2 and 6.** A spec change, with plugin-qualify's lane 5.
   Its red is lane 5's.
7. **plugin-hostd-protocol: the ask's words.** Proves: the protocol states them before plugin-hostd answers them. The
   `add` word `ask` / `no-ask`, the verb `description_get`, the event `description_changed` in the table, the grammar
   and the header, and the codes they answer (`-529` and `-530` widened to the store with their text, or new codes: the
   protocol owner decides). Red: the protocol's own grammar and table tests with the new rows before the grammar holds
   them.
8. **plugin-hostd: groups from the store, the ask.** Proves: no inference in plugin-hostd, the ask's limits. Red: an LV2
   fixture with no `pg:group` and a store entry pages by the store's groups (red today: one page "Controls"); an add of
   an unknown plugin with stand-in `plugin-qualify-sync` and `omx-panel` on the path runs each once, with that target
   only, at nice 19, and never for a second plugin; with `plugin-qualify-sync` absent no child runs and the add answers
   as before; `ask_unknown 0` runs none, and `add ... ask` runs them; a known key runs none; the three generators run with
   that plugin's `--only` and no other; with no store installed, the add pages by the declared groups.
9. **omx-panel: the window on Wayland, the generic LV2 UI and `omx-lv2ui-sync`.** Proves: one UI library, generated
   bundles only. Red: for a fixture LV2 plugin with no UI, lilv lists a `ui:X11UI` on its URI from the generated bundle;
   the window opens under a headless Wayland compositor and under Xvfb and draws the stored description.
10. **omx-plugins: `clap.gui`, `ui:X11UI` and the gate.** Proves: every plugin of the tree has both. Red: the gate over today's
   tree fails on every plugin; the tree holds no generated `modgui.ttl`.
11. **zynthian-ui: entries from the store.** Proves: Zynthian reads, does not derive. Red: with a fixture store whose
    description differs from what `describe` derives, the engine draws the store's.
12. **The console: served from the store.** Red: a fixture entry is served as stored, and no derivation runs for its key.

## 14. Decided

The owner's answers to the questions this design raised (2026-11-19). The sections above follow them.

1. **Pages** are cut on read (`omx-panel describe --pages`, at the surface's width, `tools/describe.mjs:309`), never
   stored.
2. **The base's inputs** (the reference sets' descriptors and LV2 TTL) live with the base package's build in omx-panel.
3. **Pruning.** Each scan prunes, from the system and user layers it may write, the entries of plugins no longer
   installed; each release of the base prunes the base.
4. **A window with no entry** draws the description its plugin carries (`org.openmixer.panel-description/1`); it
   never refuses to open.
5. **Units** (OWNER): ENABLED by default where systemd exists; nothing depends on them, and every path works without
   them.
6. **The ask** runs qualify, describe and the three generators for THAT plugin only.
7. **plugin-hostd's lane does not wait for the qualification store's consumer switch**: it reads the store when the
   store exists, and declared groups until then; the single-plugin call writes the records where the scan writes them
   today until the switch.
8. **Skins.** A user's skin is applied by each reader over the stored description; it is never stored as an edited
   entry.
9. **A schema change** (OWNER): a MIGRATION carries a person's edits across schema versions, an owner-approved
   compatibility mechanism scoped to the user layer only; the system layer and the base are regenerated (section 3.5).
10. **Figures under load** are recorded with a measured-under-load mark; the ask is not deferred (section 7).
