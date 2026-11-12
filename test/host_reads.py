#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
"""A host that is not JavaScript reads what omx-panel owns from what omx-panel ships (#23), as zynthian-ui does in
Python: the gesture word names through the C library's omx_panel_word_name, in schema/gestures.json's order, and the
compare document's format, slots and ring bound through `omx-panel compare describe`, the values tools/compare.mjs
holds. Nothing of either is restated here: the words are read from gestures.json, the compare values from the module.

  OMX_PANEL_RENDER_LIB  the shared library (default this tree's renderer/build/libomx-panel-render.so.0)
  OMX_PANEL             the command (default node bin/omx-panel.mjs of this tree)
Set both to an installed package's to read that package.
"""
import ctypes
import json
import os
import shlex
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.environ.get("OMX_PANEL_RENDER_LIB") or os.path.join(ROOT, "renderer", "build", "libomx-panel-render.so.0")
CMD = shlex.split(os.environ.get("OMX_PANEL") or "node %s" % shlex.quote(os.path.join(ROOT, "bin", "omx-panel.mjs")))


def declared_words():
    with open(os.path.join(ROOT, "schema", "gestures.json")) as f:
        return list(json.load(f)["words"])


def compare_module():
    """the compare constants as tools/compare.mjs exports them"""
    js = ("import('%s').then((m) => console.log(JSON.stringify({format: m.COMPARE_FORMAT, slots: m.COMPARE_SLOTS, "
          "ringBound: m.RING_BOUND})))" % os.path.join(ROOT, "tools", "compare.mjs"))
    return json.loads(subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True,
                                     check=True).stdout)


class test_a_host_reads_the_panel_declarations(unittest.TestCase):

    def test_the_word_names_come_from_the_library_in_the_declared_order(self):
        lib = ctypes.CDLL(LIB)
        lib.omx_panel_word_name.restype = ctypes.c_char_p
        lib.omx_panel_word_name.argtypes = [ctypes.c_int]
        words = declared_words()
        # OMX_PANEL_WORD_NONE is 0, the declared words follow it in gestures.json's order
        self.assertEqual([lib.omx_panel_word_name(i + 1).decode() for i in range(len(words))], words)
        self.assertEqual(lib.omx_panel_word_name(0), b"", "no word names nothing")
        self.assertIsNone(lib.omx_panel_word_name(len(words) + 1), "past the last word there is no name")
        self.assertIsNone(lib.omx_panel_word_name(-1))

    def test_the_compare_slots_and_ring_bound_come_from_the_command(self):
        out = subprocess.run(CMD + ["compare", "describe"], capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(json.loads(out.stdout), compare_module())


if __name__ == "__main__":
    unittest.main()
