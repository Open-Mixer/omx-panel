# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
"""The shapes of omx-panel's documents as typed dictionaries (docs/shapes.md), one module per shape, each the file
share/omx-panel/omx_contract_<name>_shape.py, GENERATED from shapes/<name>.schema.json by omx-contract's
`render --target py --shapes`; python3-omx-panel installs each as omx_panel.shapes.<name>:

    from omx_panel.shapes.gestures import Word, Input, Widget    # typing.get_args(Word) is the gesture words, in order
    from omx_panel.shapes.gesture_io import Control, Event, Answer
    from omx_panel.shapes.look_role import LookRole
    from omx_panel.shapes.code import PanelCode
"""
