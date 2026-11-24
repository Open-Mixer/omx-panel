#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
"""The Python door (store/python/omx_panel_store.py) reads what the command wrote, through the library, and agrees with
the command on the same files: the entry, the refusals by code, the source. A fixture contract directory is the repo's
panel domain with a plugin-db domain holding clap and lv2. Needs the built tree (make -C store)."""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BUILD = os.path.join(ROOT, "store", "build")
os.environ.setdefault("OMX_PANEL_STORE_LIB", os.path.join(BUILD, "libomx-panel-store.so.0"))
sys.path.insert(0, os.path.join(ROOT, "store", "python"))
import omx_panel_store as door  # noqa: E402

CMD = os.path.join(BUILD, "omx-panel-store")
SHA, SRC = "a" * 64, "1" * 64
# the derivation's rules version the reader holds (the header's), so the fixture entry is current
with open(os.path.join(ROOT, "store", "include", "omx-panel", "omx_panel_store.h"), encoding="utf-8") as f:
    RULES = int(re.search(r"#define OMX_PANEL_RULES_VERSION (\d+)", f.read()).group(1))
ENTRY = {"edited": 0, "made_by": "door test", "rules": RULES, "source": SRC, "family": "eq", "fingerprint": "f" * 64,
         "body": {"family": "eq"}, "groups": {"repeated": []}, "refused": None,
         "controls": [{"symbol": "g", "key": "g", "id": "g"}],
         "verdict": {"outcome": "grouped", "reason": None, "groups": [
             {"symbol": "b1", "name": "Band 1", "display_priority": 1, "rule": "name", "declared": 0, "ports": ["gain", "freq"]}]}}


def contract(d):
    import shutil
    shutil.copytree(os.path.join(ROOT, "contract.d", "panel"), os.path.join(d, "panel"))
    os.makedirs(os.path.join(d, "plugin-db"))
    words = [{"const": w, "title": w, "description": w, "x-code": i, "x-text": w} for i, w in enumerate(["clap", "lv2"])]
    with open(os.path.join(d, "plugin-db", "plugin-db.json"), "w") as f:
        json.dump({"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://openmixer.org/contract/plugin-db",
                   "info": {"title": "fixture", "version": "1.0.0", "x-owner": "plugin-db", "x-stability": "experimental"},
                   "components": {"schemas": {"PLUGIN_DB_ADDRESS_FORMATS": {"description": "d", "x-since": "1.0.0", "oneOf": words}}}}, f)


class test_the_door_reads_through_the_library(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        d = self.tmp.name
        contract(os.path.join(d, "c"))
        self.c, self.user = os.path.join(d, "c"), os.path.join(d, "u.sqlite")

    def put(self, entry=ENTRY):
        r = subprocess.run([CMD, "put", "--user", self.user, "--base", "x", "--contract-dir", self.c, "--sha256", SHA, "--format", "lv2",
                            "--uri", "urn:t"], input=json.dumps(entry), capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    def make_base(self, uri="urn:t", body='{"from":"base"}'):
        import sqlite3
        path = os.path.join(self.tmp.name, "base.sqlite")
        db = sqlite3.connect(path)
        with open(os.path.join(ROOT, "schema", "panel.sql")) as f:
            db.executescript(f.read())
        db.execute("DELETE FROM store_info")
        db.execute("INSERT INTO store_info VALUES (1, 0, 'omx-panel.panel-description/1', ?)", ("b" * 40,))
        with open(os.path.join(self.c, "panel", "panel.json")) as pj:
            panel = json.load(pj)["info"]["version"]
        db.executemany("INSERT INTO store_domain VALUES (?, ?)", [("panel", panel), ("plugin-db", "1.0.0")])
        db.executemany("INSERT INTO word_check VALUES (?, ?, ?, ?)", [
            ("plugin", "format", "plugin-db", "PLUGIN_DB_ADDRESS_FORMATS"), ("description", "family", "panel", "PANEL_FAMILIES"),
            ("description", "refused", "panel", "PANEL_DESCRIBE_CODES"), ("port_group_verdict", "outcome", "panel", "PANEL_GROUP_OUTCOMES"),
            ("port_group_verdict", "reason", "panel", "PANEL_GROUP_REASONS"), ("port_group", "rule", "panel", "PANEL_GROUP_RULES")])
        db.execute("INSERT INTO plugin (sha256, format, uri) VALUES (?, 'lv2', ?)", (SHA, uri))
        db.execute("INSERT INTO description VALUES (1, 0, 'base', ?, ?, 'eq', ?, ?, '{}', NULL)", (RULES, SRC, "f" * 64, body))
        db.commit()
        db.execute("PRAGMA user_version = 1")
        db.close()
        return path

    def test_a_user_entry_the_command_wrote_hides_the_base_and_is_read_whole(self):
        if os.geteuid() == 0:
            self.skipTest("the command writes the system layer as root")
        base = self.make_base()
        with door.Store.open_at(base, None, None, self.c) as s:
            self.assertEqual(s.get(SHA, "lv2", "urn:t", SRC)["layer"], "base")
        self.put()
        with door.Store.open_at(base, None, self.user, self.c) as s:
            e = s.get(SHA, "lv2", "urn:t", SRC)
            self.assertEqual(e["layer"], "user")
            self.assertEqual(json.loads(e["body"]), {"family": "eq"})
            self.assertEqual(e["group_outcome"], "grouped")
            self.assertEqual([(g["symbol"], g["ports"]) for g in e["groups"]], [("b1", ["gain", "freq"])])
            self.assertEqual([(c["symbol"], c["group_key"], c["governed"]) for c in e["controls"]], [("g", None, 0)])
            # a source that is not the entries' makes the key absent to a producer
            self.assertIsNone(s.get(SHA, "lv2", "urn:t", "2" * 64))
            self.assertIsNone(s.get(SHA, "lv2", "urn:other", SRC))

    def test_the_door_and_the_command_agree(self):
        base = self.make_base()
        with door.Store.open_at(base, None, None, self.c) as s:
            via_door = s.get(SHA, "lv2", "urn:t", SRC)
        r = subprocess.run([CMD, "get", "--base", base, "--system", "none", "--user", "none", "--contract-dir", self.c, "--sha256", SHA, "--format", "lv2",
                            "--uri", "urn:t", "--source", SRC, "--json"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        via_cmd = json.loads(r.stdout)
        self.assertEqual(via_cmd["body"], json.loads(via_door["body"]))
        self.assertEqual((via_cmd["layer"], via_cmd["family"]), (via_door["layer"], via_door["family"]))

    def test_absent_base_is_a_refusal_with_its_code(self):
        with self.assertRaises(door.StoreError) as e:
            door.Store.open_at(os.path.join(self.tmp.name, "none.sqlite"), None, None, self.c)
        self.assertEqual(e.exception.code, "panel-store.absent")

    def test_the_source_is_the_librarys_and_the_commands(self):
        p = os.path.join(self.tmp.name, "d.json")
        with open(p, "w") as f:
            f.write('{"b": 1, "a": [true]}')
        cmd = subprocess.run([CMD, "source", "--format", "clap", "--path", p], capture_output=True, text=True).stdout.strip()
        self.assertEqual(door.source("clap", p), cmd)
        with self.assertRaises(door.StoreError):
            door.source("vst3", p)


class test_the_store_codes_are_the_domains(unittest.TestCase):
    """Sorting pass row V2 (omx-panel#156): the refusal strings stay in C (store.c CODES: the domain-too-old answer must
    be given when the domain cannot open), and every one is the panel domain's PANEL_STORE_CODES word of its code."""
    ABSENT, ENTRY_INVALID = 2, 11  # omx_panel_store.h: OMX_PANEL_STORE_ABSENT .. OMX_PANEL_STORE_ENTRY_INVALID

    def domain_words(self, path=os.path.join(ROOT, "contract.d", "panel", "panel.json")):
        with open(path) as f:
            words = json.load(f)["components"]["schemas"]["PANEL_STORE_CODES"]["oneOf"]
        return [w["const"] for w in sorted(words, key=lambda w: w["x-code"])]

    def library_words(self):
        return [door._text(door._l().omx_panel_store_code(s)) for s in range(self.ABSENT, self.ENTRY_INVALID + 1)]

    def test_each_status_code_is_the_domain_word(self):
        self.assertEqual(self.library_words(), self.domain_words())

    def test_a_domain_word_the_library_does_not_answer_is_seen(self):
        words = self.domain_words()
        words[0] = "panel-store.sabotaged"
        self.assertNotEqual(self.library_words(), words)


if __name__ == "__main__":
    unittest.main()
