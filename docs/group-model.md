<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# The group model: groups, repeated instances, parameters

A plugin's controls are drawn by three surfaces: the console's processing view, the Zynthian panel builder and the MOD
GUI that `omx-panel modgui` generates. Each needs to know which controls form a group, and which groups are the
**same group repeated** (the bands of an EQ, the bands of a multiband compressor), so that it can draw the repeats as one
aligned matrix instead of stacked sections whose controls wrap wherever a row runs out. `tools/group-model.mjs`
(`@openmixer/omx-panel/group-model`) is the one place that decides it (omx-panel#61). No surface infers a repeat on its own.

```js
import { controlsOfDescriptor, controlsOfLv2, inferGroupModel, matrixOf } from '@openmixer/omx-panel/group-model';

const { groups } = inferGroupModel(controlsOfDescriptor(descriptor));     // or controlsOfLv2(triples, uri)
for (const g of groups) if (g.kind === 'repeated') draw(matrixOf(g));     // else draw g.parameters as a list
```

## What exists, and what this extends

| piece | where | what it answers | what it lacks |
|---|---|---|---|
| port-group inference | `tools/group-infer.mjs:194` `inferGroups`, [group-inference.md](group-inference.md) | flat groups for an LV2 plugin that states none (a Zynthian screen of four per group) | no instance and no parameter across instances: "Band 1" and "Band 2" are two unrelated groups |
| the LV2 port reader | `tools/group-infer.mjs:663` `readPluginPorts` | a port's symbol, name, index, unit, `pg:group` | a port's kind and range, which this model matches across instances (extended here) |
| EQ band roles | `tools/meaning-infer.mjs:139` `inferBands` | which control is band N's frequency, gain, Q, type (the curve) | the other parameters of a band, and every repeat that is not an EQ |
| the panel's sections | `tools/panel-description.mjs:219` `panelLayout` | the served sections, from a declared panel or from the descriptor's `group` paths | nothing about repeats: a section is a list |
| the MOD GUI's layout | `tools/modgui-gen.mjs:340` `layout` | sections stacked top to bottom, each section's controls flowed into rows of `rowControls` (8) | the same parameter lands at a different place in each band |
| the console | its web UI's level 2 view (`level2Sections`) and its EQ house view | the served sections as lists, one per section; the EQ house view's per-band roles, a hand-written table for one family | any other repeat, and any plugin the house view does not know |
| the Zynthian builder | zynthian-ui `zyngine/zynthian_engine_plugin_hostd.py:1044` `panel_layout` (lane/zynthian-pages); `zyngine/zynthian_lv2.py:1006` and `zynthian_engine.py:681` on the jalv path | omx-panel's pages through `omx-panel describe --pages`; else lilv's `pg:group`, cut into screens of four | a band as one screen; a page cut inside a band |

The model reuses `group-infer.mjs`'s name tokens and section words and its LV2 reader; it does not restate them.

## Where it lives, and why

One implementation, in JavaScript, in omx-panel: `tools/group-model.mjs`, exported as
`@openmixer/omx-panel/group-model`. Each surface already reaches omx-panel, so none needs a second implementation:

- the **console** reads the served panel description, which its server cuts with `@openmixer/omx-panel` (a dependency of
  openmixer's `core`, `server` and `web-ui` already): the description carries the model, the browser draws it;
- the **Zynthian builder** already runs the `omx-panel` command for its pages (plugin-hostd engine) and reads the groups
  lilv hands it from the lv2-complement bundle omx-panel writes (jalv engine): both are outputs of this module;
- **modgui-gen** is in this package.

A Python port with a conformance corpus was the alternative, and is refused: two implementations of the same rules
drift, and the corpus would then prove agreement on the cases it holds and nothing else. Zynthian needs the result, not an
in-process call, and it already shells out to `omx-panel` for it.

## The model

`inferGroupModel(controls)` returns `{ groups }`, in the order of each group's first control (`index`); the controls an EQ
took as its edges do not count, so omx-strip's EQ stays after its Gate though its HPF sits before it. A group is:

- `kind: 'list'`: `parameters`, its controls' symbols in index order. A list that was a candidate repeat and failed a
  check carries `reason` (a code of the table below) and `detail` (the evidence, for a reader).
- `kind: 'repeated'`:
  - `instances`, **low to high** (ascending instance number): each `{ index, label, on, parameters }`, where `parameters`
    maps a row key to the control's symbol and `on` is the instance's head toggle, `{ symbol, sense: 'on' | 'off' }`
    (`off` for a bypass or a mute), or null;
  - `rows`: the parameters every instance holds, in drawing order, each `{ key, label, role }`;
  - `parameters`: the group's own controls that belong to no instance (an EQ's master on, its band count), a plain list;
  - `family`: `'eq'` or null; `edges` (an EQ only): its filters and shelves, each `{ edge, label, on, parameters }`;
  - `count`: `{ symbol }` or null, the control that sets how many instances are live (S10).
- both: `key`, `label` (the declared group's label, null for a plugin's undeclared controls) and `source`:
  `declared`, `indexed` or `none`.

The input is one control shape from either reader: `{ symbol, name, index, kind: 'toggle'|'choice'|'travel', unit,
min, max, options, path }`, where `path` is the declared group path. `controlsOfDescriptor(descriptor, { panel })` reads an
omx-contract descriptor (`group` is the path; a declared `panel`'s sections, when given, replace it), `controlsOfLv2(triples,
uri)` an LV2 plugin (its `pg:group`'s name is the path; the kind from `lv2:toggled` / `lv2:enumeration`, the range from
`lv2:minimum` / `lv2:maximum`).

## The sources, in order of trust

Each rule names the test that proves it (`test/group-model.test.mjs`).

- **S1, the declaration buckets.** Controls are split by the first element of their declared path: one bucket per
  declared group, one for the undeclared controls. No inference ever joins controls of two declared groups into one
  instance. *Test: "S1: a repeat never crosses a declared group" (omx-strip's Filters and Gate stay lists beside its EQ).*
- **S2, declared instances (source a).** A bucket whose controls sit in sub-groups labelled one series ("Band 1" ...
  "Band 8") has those sub-groups as its instances. Declared top-level groups labelled one series ("Output 1" ...) are
  merged into one group of instances the same way. The symbol's number must agree with the declared one, or be one less (a
  symbol counting from 0), with one offset for the whole group; else `declared-index-conflict`. *Tests: omx-eq8, omx-eq16,
  omx-eq32 in the corpus; "S2: a declared band whose symbols carry another number is refused".*
- **S3, indexed instances (source b).** In a bucket with no declared instances, a symbol carrying exactly one number
  (`b3_freq`, `eq3Freq`, `f_3`, `freq3`, `threshold3`) is parameter `stem` (the symbol with `#` for the number) of
  instance `number`. A stem seen at two numbers or more is repeated; the instances are the numbers of the repeated stems.
  *Tests: omx-strip, x42 fil4, LSP para-equalizer x8, Calf multiband compressor in the corpus.*
- **S4, matched across instances (source c).** A parameter (a stem every instance holds) has the same kind in every
  instance, the same unit, and, unless its unit is hertz or it is a toggle, the same range (a choice: the same number of
  options). A frequency may span another range per band. *Tests: "S4: kind / unit / range mismatch is refused", one each.*
- **S5, the parameters.** A stem every instance holds is a row. A stem held by all but one instance is a row too, **with an
  empty cell** for the instance that lacks it (omx-delay's `tap1Factor` .. `tap3Factor`: tap 1 plays at the delay's own
  time and has no factor), provided each control it holds is that instance's own: its name prints the one number the
  instance's other names print (the number it prints, or none where the instance prints none). That is what keeps Calf's
  three crossover frequencies (`freq0` .. `freq2`, "Split 1/2", held by three of four bands, each naming two numbers)
  out of the rows: they sit between bands, not in one. A stem held by fewer instances is no row either. The controls of
  every stem that is no row join the group's own `parameters`. A row held by all but one instance obeys S4 over the
  instances that hold it, and the existing `ragged-instances` check counts it among the controls it is not a row of
  (so a group of mostly such stems is still refused). The words of a row's label are its first holding instance's name
  less the number and less the words every complete parameter of that instance shares ("Band 1 Gain" -> "Gain"); such a
  row is drawn after the rows every instance holds. *Tests: the Calf multiband compressor in the corpus (its crossovers
  stay the group's own); omx-delay in the corpus (the Taps matrix's Time row, tap 0's cell empty); "S5: ...".*
- **S6, the head.** A toggle whose remaining words are none, or only `on`, `enable(d)`, `active`, `power` or a section
  word ("EQ 1", "Section 1", "Band 1 On"), is the instance's head with sense `on`; else a toggle of `bypass`, `mute` or
  `off` is the head with sense `off`. A head is not a row. *Tests: omx-eq8's `b1_on`, fil4's `sec1`, Calf's `bypass0`.*
- **S7, the label.** A declared instance keeps its declared label. An indexed one is the words its parameters share
  plus its number ("EQ 3"), else a section word its names hold plus its number ("Section 3"), else "Band" and the number
  for an EQ, else the number alone. The number is the one its names print, else its symbol's.
- **S8, the EQ.** A repeated group is an EQ (`family: 'eq'`) when its rows hold a frequency (unit hertz, or a word
  `frequency`, `freq`, `f`), a gain (unit dB, or `gain`, `g`, `level`), and a Q (`q`, `quality`, `bandwidth`, `resonance`)
  or a type. Its rows that carry one of the roles `type`, `slope`, `freq`, `gain`, `q` are keyed by that role, so the
  edges below align with the bands. **A role a control's words claim wins over a role its unit claims**: a dB control
  that is not called `gain` (`threshold`, `range`) is no gain while another control of the band is, and keeps its own
  stem as its row key (omx-dyneq's `gain1` is the gain row; `threshold1` and `range1` are rows of their own, not three
  candidates for `gain` that key none). Where no control's words claim the role, the unit's claim stands (the
  `gain`-less EQ whose one dB control is its gain). *Tests: omx-dyneq in the corpus; "S8: ...".*
- **S9, the EQ's edges.** An EQ's high-pass, low shelf, high shelf and low-pass are found by the words its control names
  open with (`HPF`, `Highpass`, `Low cut`; `Lowshelf`; `Highshelf`; `LPF`, `Lowpass`, `High cut`): among the EQ's own
  `parameters`, and in **any list group of the plugin**, whatever else that group holds: **every control whose name
  opens with an edge word is taken**, and the remainder stays that group's own list. The high-pass is the EQ's first
  column and the low-pass its last on every plugin (the owner's rule for every grouped drawing; the audio order is
  unchanged). omx-strip's `Filters` group (`filterOn`, `hpfOn`, `hpfFreq`, `hpfSlope`, `lpfOn`, `lpfFreq`, `lpfSlope`)
  gives the EQ its HPF (head `hpfOn`, rows `freq`, `slope`) and its LPF, and keeps `filterOn` as a list of one. An edge
  has a frequency, or it is no edge and its controls stay where they were. *Tests: omx-eq8, x42 fil4, omx-strip in the
  corpus (HPF first, LPF last); "S9: ...".*
- **S10, the count.** A repeated group's own parameter that sets how many of its instances are live is the group's
  `count: { symbol }`. It is a whole-number travel (step 1) from 0 or 1, whose maximum is the number of instances, and
  whose name holds a word the group is called by (the instances' shared word or the group's label), singular or plural:
  omx-strip's `eqBands` ("EQ Bands", 1..32, over `EQ 1` .. `EQ 32`), omx-delay's `fxDelayTaps` ("Taps", 1..4, over
  `Tap 1` .. `Tap 4`). Anything else a group holds of its own is no count (Calf's `mode`). A count is inferred; no
  descriptor declares one. The control stays among the group's `parameters`. *Tests: omx-strip and omx-delay in the
  corpus; "S10: ...".*

## Uncertain: a reason, and a plain list

An inference that does not hold is never drawn as a guessed matrix: the bucket is a `list` of all its controls, with one
of these codes. The checks run in this order; the first that fails names the list.

| code | the candidate fails when | test |
|---|---|---|
| `two-indices` | more than half its numbered controls carry two numbers in their symbol (`mix_3_5`): a grid of two indices | x42 matrixmixer (corpus) |
| `declared-index-conflict` | a declared instance's symbol numbers are not its number nor one less, by one offset | "S2: ..." |
| `ragged-instances` | more of its numbered controls sit in stems some instances lack than in stems all hold (a stem held by all but one, which S5 makes a row, is still a stem some instances lack here) | AMS advenv (corpus) |
| `one-parameter` | fewer than two stems are held by every instance: a row of one repeated control (`tools/bars.mjs`'s business) | "one-parameter" |
| `index-gap` | the instance numbers of an indexed group are not consecutive (1, 2, 4) | "index-gap" |
| `kind-mismatch` | a parameter is a toggle in one instance and a travel or a choice in another | "S4: kind" |
| `unit-mismatch` | a parameter has two units across instances | "S4: unit" |
| `range-mismatch` | a parameter that is not a frequency nor a toggle spans two ranges, or a choice two option counts | "S4: range" |
| `name-number-disagrees` | an instance's names print two numbers, or two instances print the same one | "name-number-disagrees" |

A bucket with no repeated stem at all is a `list` with no reason: there was no candidate.

## The layout every surface applies

`matrixOf(group)` turns a repeated group into `{ orientation, columns, rows, cells }`, `cells[row][column]` a symbol or
null. A surface draws it as given; none reorders, wraps or transposes it.

- **L1, aligned, never flowed.** The same parameter of every instance sits at the same position: one row of the matrix
  per parameter, one column per instance (or the transpose, L4). A cell an instance lacks (an edge without a gain) is
  left empty; nothing moves into it. *Test: "L1: every row holds one parameter across the instances".*
- **L2, the EQ is always horizontal.** `orientation: 'columns'`: the bands are columns, left to right in ascending
  instance number; the high-pass is the leftmost column and the low-pass the rightmost; a low shelf sits right of the
  high-pass and a high shelf left of the low-pass. Each column stacks its parameters in the owner's order: `freq`,
  then `gain` (one aligned row: the gain of a bell or shelf band and the slope of the high-pass and low-pass, an edge's
  `slope` taking the `gain` row when the bands hold no slope row of their own; a band that holds both keeps `gain`, then
  `slope`), `q`, `type`, then the rest in the first instance's order, and last the column's on/off (L3). *Tests: omx-eq8, omx-eq16, omx-eq32, x42 fil4, LSP
  para-equalizer, omx-strip; "L2: an EQ of more rows than bands is still columns".*
- **L3, the head.** Each column (each row, transposed) carries its label and its on/off (`on`) as its head, which is its
  state, not a parameter row of `matrixOf`; a surface DRAWS the on/off as the column's last row, and the served matrix
  (below) ends its `rows` with that row, `{ label: 'On', head: true }`, its cells the heads' `on` symbols (the same
  control: drawn once, there). *Test: the corpus' `heads`.*
- **L4, any other repeat takes the orientation that fits.** `columns` when there are at least as many instances as
  rows, else `rows` (one row per instance, the parameters across). *Test: the Calf multiband compressor (4 bands, 8
  parameters: rows).*
- **L5, the group's own parameters** (`parameters`) are a plain list drawn before the matrix.
- **L6, the count.** A group that has a `count` (S10) is drawn with **only its first `count` instances**, at the count
  port's current value: the instances are counted in ascending instance number, an instance beyond the count is hidden
  and **leaves no gap** (the next column closes up), and the edges (HPF, LPF, shelves) are always drawn. `matrixOf(g,
  { values })` applies it (`values[count.symbol]`, a value left out showing every instance); a surface that draws live
  reads each head's `ordinal` (its place among the instances, null for an edge) and shows it while `ordinal < value`.
  **The count control itself is drawn as a selector**: a port that is an enumeration, or a whole number of few points,
  is a selector and never a knob; the count is one whatever its range (`eqBands` 1..32 is a selector of 32 options).
  The MOD GUI face is static: it draws the first `count` instances at the count port's come-up value (omx-strip: 4 of 32;
  omx-delay: 1 of 4), and an instance beyond it is not on the face, its ports not among the pedal's. A plugin whose declared panel already
  governs each instance by a `visibleWhen` rule on the count keeps that live rule instead: its instances stay on the face,
  hidden by the rule. *Tests: "L6: ..."
  (library); modgui-gen's omx-strip and omx-delay faces.*

- **L7, the owner's drawing rule for an EQ, every surface.** An EQ is one matrix: a column per band, left to right, HPF
  first and LPF last; each column's controls stacked vertically, every column in the same row order, a control a band lacks
  an empty cell, so row `r` is the same parameter in every column (the HPF's gain cell is empty and its `freq` sits on the
  band's `freq` row). A surface shows **as many columns as fit**: `visibleColumns(matrix, { width, column })` is
  `max(1, floor(width / column))` columns, never one band per screen while more fit; a surface that cannot show them all
  scrolls whole columns. An encoder surface (Zynthian) shows the whole matrix and its encoders edit the **selected
  column**: `selectedColumn(matrix, n)` is the column `n` clamped to the matrix (one knob picks `n`), and the encoders
  of the surface are that column's rows in row order, an empty cell leaving its encoder idle. The head toggle (`on`) is
  the column's header in this model; a surface that stacks it draws it as the column's last row. *Tests: "L7: ...".*

## The corpus

`test/fixtures/group-model/`: each plugin's input (a descriptor as omx-plugins ships it, or the TTL as its package
installs it; provenance and licences in `SOURCES`) and `expected.json`, the inference written down before the library
existed. `test/group-model.test.mjs` compares each in full.

| plugin | input | expected |
|---|---|---|
| omx-eq8, omx-eq16, omx-eq32 | descriptor | one EQ, declared: HPF, bands 1..N, LPF as columns; rows freq, gain (the HPF's and LPF's slope on it), q, type |
| omx-strip | descriptor | its EQ indexed: HPF, 32 columns `EQ 1` .. `EQ 32` headed by `eqN On`, LPF (heads `hpfOn`, `lpfOn`; rows freq, gain (slope on it for the edges), q, type); `eqOn` and `eqBands` its own, `eqBands` its count; Filters a list of `filterOn`; Input, Gate, Comp, Order lists |
| omx-dyneq | descriptor | one EQ, declared: Band 1..6 as columns headed by `bandOnN`; rows freq, gain, q, type (each the one control called that), then dynMode, threshold, ratio, range, attack, release, listen under their own stems; `mixPct` in Output |
| omx-delay | descriptor | its Taps indexed: Tap 1..4 as columns, rows Gain, Pan, then Time (tap 1's cell empty); `fxDelayTaps` its own and its count; not an EQ |
| x42 fil4 (mono) | TTL | one EQ, indexed: Highpass, Lowshelf, Section 1..4, Highshelf, Lowpass; rows freq, gain, q |
| LSP para-equalizer x8 mono | TTL | one EQ, indexed: Band 0..7 (its names count from 0), no head (it has no on toggle), ten rows |
| Calf multiband compressor | TTL | four bands as rows (L4), headed by their bypass (sense off); the split frequencies its own |
| x42 matrixmixer (ambiguous) | TTL | a list, `two-indices` |
| AMS advenv (ambiguous) | TTL | a list, `ragged-instances` |

## The served description carries the model

`omx-panel describe` serves the model, so no surface re-derives it (the console, the C renderer of omx-panel#62, the
Zynthian builder read the description). A section that carries a repeated group has `matrix`, `matrixOf(g)` with every
symbol as the description serves it and in one shape whatever the orientation: `{ orientation, heads, rows, cells,
count? }`. `heads` are the instances and the edges along one axis, each `{ label, on: { symbol, sense } | null, edge }`
(`edge` is `hpf`, `lowshelf`, `highshelf`, `lpf`, or null for an instance), `rows` the parameters, each `{ label }`,
`cells[row][head]` a served symbol or null (`orientation` says only whether the surface lays the heads out as columns or
as rows), and `count: { symbol, default }` when the group has one (S10): the surface draws the first `count` non-edge heads
at the count port's value (`default` when it holds none), closed up, the edges kept (L6); the count control is drawn as a
selector. The library's own `matrixOf` keeps the keys, roles and ordinals the description leaves out. The section is the first that holds the group's instances;
the controls the matrix places (the edges, taken from beside the EQ, among them) are that section's, and a section the
group emptied is left out of `sections`. A group the description cannot place whole (a member it does not serve, or an
instance section that holds another plugin control beside the group) carries no matrix and is drawn as before. *Tests:
`test/describe-group-model.test.mjs`: omx-eq8 carries it; omx-strip's carries HPF first and LPF last.*

## The consumers

- **modgui-gen** (`tools/modgui-gen.mjs` `withRepeats`): the sections that hold a repeated group's instances and own
  parameters, when they hold nothing else, are drawn as one section laid out by `matrixOf` (at the count's come-up value,
  L6), its own parameters flowed above the matrix, the count drawn as a selector; the edges are taken from whatever
  section holds them, which keeps the rest of its controls (omx-strip's Filters keeps `filterOn`). A group some of whose
  controls are not drawn (an Easy section took them), or whose instance section holds anything else beside the group, is
  drawn as before. *Test: `test/modgui-group-model.test.mjs`.*
- **the panel renderer** (`renderer/`), held pixel-equal to the MOD GUI face by `renderer/test/parity.test.mjs`: it draws
  the same matrix from the description (omx-panel#62). Until it does, the eq-marks parity fixture differs from the face,
  and modgui-gen's consumer does not merge alone.
- **the console**: the served panel description carries the model; the processing view draws a repeated group by
  `matrixOf` (a follow-up in openmixer, linked from omx-panel#61).
- **the Zynthian builder**: a page never cuts inside an instance, and an instance is one screen (a follow-up in
  zynthian-ui, linked from omx-panel#61).
