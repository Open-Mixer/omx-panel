<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# The kind of a scanned control

A `built` or `scanned` descriptor writes the kind from what the plugin states, and the plugin's formats state it in
different words: LV2 has `lv2:toggled`, `lv2:enumeration` and `lv2:integer`; CLAP has `CLAP_PARAM_IS_ENUM` and
`CLAP_PARAM_IS_STEPPED` and no boolean, so a CLAP plugin states a switch as a stepped parameter from 0 to 1 and in
no other way (omx-plugins' CLAP face, `lib/omx_clap_face.c`, flags its toggles so and nothing more). One rule, read in
this order, decides the kind for every format and every reader. Control kinds are panel vocabulary, so the rule is
omx-panel's (it moved here from omx-contract's draft, #153): omx-panel's own readers (the LV2 group inference,
`tools/group-infer.mjs`, and the group model over a descriptor, `tools/group-model.mjs`) apply it, and the other readers
(plugin-hostd's `describe`, openmixer's catalog) hold themselves to the vectors below.

The inputs are what the plugin states for the control: whether it is an **enumeration** (`CLAP_PARAM_IS_ENUM`,
`lv2:enumeration`), whether it is **toggled** (`lv2:toggled`; CLAP has no such flag), whether it is **stepped**
(`CLAP_PARAM_IS_STEPPED`, `lv2:integer`), the **scale word** of its parameter-contract entry when it has one
(`org.openmixer.param-contract/1`, an id of `PARAM_SCALES`), its **`min`**, **`max`**, its **`step`** when the
contract entry states one (none, or 0, is one step per unit, CLAP's integer step), and its **`default`**.

1. An enumeration is a `choice`, whatever its range. The enumeration flag is what tells a choice from a switch: a
   two-option choice over 0..1 is a choice, and a face that leaves the flag off has stated a switch.
2. Else a toggled control is a `toggle`.
3. Else the control's scale is its contract scale word when it states one, else `stepped` when it is flagged stepped,
   else what the format states (`log` for LV2 `pprops:logarithmic`; `unknown` for the rest). The contract entry is the
   plugin's fuller statement, so its word wins over the flag: a parameter flagged stepped whose contract entry says
   `linear` is a linear travel, and a contract entry saying `stepped` with no flag is stepped.
4. A stepped control with exactly two positions, `min` exactly 0 and `max` exactly 1, is a `toggle`: that is a
   boolean in CLAP's words. Two positions means no `step`, or a `step` of exactly 1; a step of 0.25 over 0..1 is five
   positions, a stepped travel. 0..2, 1..2 and -1..0 are stepped travels: a boolean's positions are 0 and 1, not any
   two integers.
5. Else the control is a `travel` with that scale.

A `toggle`'s `default` is `true` when the stated default is not 0, `false` when it is 0. The off position is
exactly 0 and every other value is on: LV2's law for a toggled port (zero is off, anything else is on), and the one
law a reader needs for both formats. No midpoint is invented: a default of 0.5 is no position of a two-position
control, and it is on as any non-zero value is. Readers that compared the default with 0.5 and readers that
compared it with 0 disagreed on a default such as 0.3; this rule ends that.

`schema/control-kind-vectors.json` holds one row per case: the inputs, the kind the rule gives and, for a toggle,
its `default`; for a travel, its scale when the rule fixes it. It is hand-written, validated against
`schema/control-kind-vectors.schema.json`, held to the rule by `tools/control-kind.mjs`
(`@openmixer/omx-panel/control-kind`, `controlKind(stated)`), and shipped as `@openmixer/omx-panel/control-kind-vectors.json`
and `@openmixer/omx-panel/control-kind-vectors.schema.json` (installed under `<datadir>/omx-panel/schema/`), the files
every reader's own test is held to. It is no declaration: no domain carries it. *Test: `test/control-kind.test.mjs`.*
