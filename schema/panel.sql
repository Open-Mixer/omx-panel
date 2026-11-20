-- SPDX-License-Identifier: GPL-3.0-or-later
-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
-- The descriptions store, user_version 1 (docs/descriptions-store.md, sections 3.3 and 3.4, verbatim, with WORD(c)
-- written out as the qualification store writes it). The writer sets PRAGMA user_version last: the line below is the one
-- place the version is held, and the build compiles it into the reader and the writer.
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
  format    TEXT NOT NULL CHECK ((length(format) > 0 AND instr(format, ' ') = 0 AND instr(format, char(9)) = 0 AND instr(format, char(10)) = 0)),
  uri       TEXT NOT NULL CHECK (length(uri) > 0),
  UNIQUE (sha256, format, uri)
) STRICT;

CREATE TABLE description (
  plugin_id   INTEGER PRIMARY KEY REFERENCES plugin ON DELETE CASCADE,
  edited      INTEGER NOT NULL CHECK (edited IN (0, 1)),   -- 1: written by a person; 0: derived by omx-panel
  made_by     TEXT NOT NULL,           -- a name: the omx-panel version that derived it, or that checked an edit
  rules       INTEGER NOT NULL CHECK (rules >= 1),          -- OMX_PANEL_RULES_VERSION of the derivation (3.6)
  source      TEXT NOT NULL CHECK (length(source) = 64 AND source NOT GLOB '*[^0-9a-f]*'),
                                       -- SHA-256 of the derivation's input as installed (3.6), not of the binary
  family      TEXT NOT NULL CHECK ((length(family) > 0 AND instr(family, ' ') = 0 AND instr(family, char(9)) = 0 AND instr(family, char(10)) = 0)),           -- a PANEL_FAMILIES word
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
                                       -- panelFingerprint(layout): of the LAYOUT the description was derived from,
                                       -- before the skin, the matrices and the pages; what a client compares to know
                                       -- the layout changed, not a check of body
  body        TEXT CHECK (body IS NULL OR json_valid(body)), -- the description BEFORE the skin and the matrices,
                                       -- canonical JSON, `pages` left out
  groups      TEXT CHECK (groups IS NULL OR json_valid(groups)), -- the repeated groups inferGroupModel found, as
                                       -- JSON; NULL exactly when body is NULL
  refused     TEXT CHECK (refused IS NULL OR (length(refused) > 0 AND instr(refused, ' ') = 0 AND instr(refused, char(9)) = 0 AND instr(refused, char(10)) = 0)), -- a DESCRIBE_CODES word: describe derived no description
  CHECK ((body IS NULL) <> (refused IS NULL)),              -- exactly one of the two
  CHECK ((body IS NULL) = (groups IS NULL))
) STRICT;

CREATE TABLE description_control (     -- per control, what the skin, the matrices and the pages read (section 14, 1, 8)
  plugin_id INTEGER NOT NULL REFERENCES description ON DELETE CASCADE,
  ordinal   INTEGER NOT NULL CHECK (ordinal >= 0),          -- the control's place in the derivation's control order
  symbol    TEXT NOT NULL,             -- a name: the SERVED symbol the body carries
  key       TEXT NOT NULL,             -- a name: the layout key (`keyOf`)
  id        TEXT NOT NULL,             -- a name: the effective control id, as `effective.controls` holds it
  group_key TEXT,                      -- a name: its group key (`c[GROUP]`), NULL when it has none
  governed  INTEGER NOT NULL CHECK (governed IN (0, 1)),   -- 1: the layout control has a visibleWhen
  PRIMARY KEY (plugin_id, ordinal),
  UNIQUE (plugin_id, symbol)
) STRICT;

CREATE TABLE port_group_verdict (      -- LV2 only in this pass: CLAP states no port groups
  plugin_id INTEGER PRIMARY KEY REFERENCES description ON DELETE CASCADE,
  outcome   TEXT NOT NULL CHECK ((length(outcome) > 0 AND instr(outcome, ' ') = 0 AND instr(outcome, char(9)) = 0 AND instr(outcome, char(10)) = 0)),            -- NEW PANEL_GROUP_OUTCOMES
  reason    TEXT CHECK (reason IS NULL OR (length(reason) > 0 AND instr(reason, ' ') = 0 AND instr(reason, char(9)) = 0 AND instr(reason, char(10)) = 0))     -- NEW PANEL_GROUP_REASONS
) STRICT;

CREATE TABLE port_group (
  plugin_id        INTEGER NOT NULL REFERENCES port_group_verdict ON DELETE CASCADE,
  symbol           TEXT NOT NULL,      -- a name: the group's lv2:symbol
  name             TEXT NOT NULL,      -- a name: its lv2:name
  display_priority INTEGER NOT NULL,
  rule             TEXT NOT NULL CHECK ((length(rule) > 0 AND instr(rule, ' ') = 0 AND instr(rule, char(9)) = 0 AND instr(rule, char(10)) = 0)),        -- NEW PANEL_GROUP_RULES
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

-- A refused derivation has no description to draw, so no control rows (the one rule here the spec's DDL block lacks).
CREATE TRIGGER description_control_not_refused BEFORE INSERT ON description_control
WHEN (SELECT body IS NULL FROM description WHERE plugin_id = NEW.plugin_id)
BEGIN SELECT RAISE(ABORT, 'description_control: no control under a refused entry'); END;

-- the same rule from the other side: a description that has controls cannot become a refused entry
CREATE TRIGGER description_control_not_refused_update BEFORE UPDATE OF body ON description
WHEN NEW.body IS NULL AND EXISTS (SELECT 1 FROM description_control WHERE plugin_id = NEW.plugin_id)
BEGIN SELECT RAISE(ABORT, 'description_control: no control under a refused entry'); END;

PRAGMA user_version = 1;
