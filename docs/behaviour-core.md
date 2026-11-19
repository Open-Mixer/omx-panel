<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# The behaviour core

Status: design spec, not built. It designs within the owner's decisions of 2026-11-19 and re-opens none of them.
A fact checked against a file names the file. Anything else is marked as an assumption.

Every client moves a control the same way, maps a value to a position by the same law, steps it by the same step
and writes the same value text. Today four pieces of code do this, each in its own language. This spec makes it ONE C
library, built for C and for WebAssembly, and turns every client into a thin adapter that reads the panel description and
calls it.

## 1. Scope

### What the core is

One C library, `libomx-panel-behaviour`, in this repository. It holds four areas and nothing else:

- gestures: the words, the rules and the timings of `docs/panel-gestures.md`;
- mappings: value to position and back by the scale laws of omx-contract `docs/scale-position.md`, steps and coarse steps;
- value text: a value written as text in its unit, and text read back as a value;
- meter readings: a reading to its position on the meter's range, and its text.

### What it is not

- Drawing. Each toolkit draws: the web UI in Nuxt UI, Zynthian in Tk and PIL (its plugin panels still come through this repository's renderer, until it draws them itself),
  this repository's renderer for the MOD GUI face and a plugin window. The core draws nothing and returns no pixel, no colour and no geometry beyond what a gesture
  needs (a target's box and its travel in px, given by the caller).
- Look tokens. `schema/look-roles.json` and `tools/look.json` stay with the drawing. The core reads none.
- The protocol client. Sending a change to the host and reading it back stays where it is (the console's TypeScript
  client, held to other implementations by shared vectors). The core answers a value; the adapter sends it.
- The layout and the pages. `describe` and `pagesOf` (`docs/panel-layout.md`, "Pages") stay in `tools/` and are served
  as JSON. The core reads a served description; it never lays one out.
- The meter's ballistics. The fall of a peak marker is omx-dsp's view law (`omx_meter_view_step`,
  `<omxdsp/mix/omx_meter_view.h>`, `docs/renderer.md` "Meters"). The core does not restate it.

### What it retires

| Copy | Language | Where | What it holds |
|---|---|---|---|
| the gesture unit | C | `renderer/src/gesture.c` (1354 lines), `gesture.h`, `renderer/include/omx_panel_gesture.h` | gestures; linear, log and integer travels (`ge_norm_of`, `ge_value_of_norm`, `step_norm`) |
| the JavaScript reference | JS | `tools/gestures.mjs`, the package export `./gestures` (`package.json`) | the same, held equal to the C unit (`renderer/test/gesture-c.test.mjs`) |
| the Zynthian copy | Python | zynthian-ui `zyngine/zynthian_panel_gestures.py` (716 lines, branch `openmixer`) | gestures and steps on Tk events |
| the scale law | JS, Python | omx-contract `lib/scale.mjs` (source `src/lib/scale.mts`), `share/omx-contract/omx_contract_scale.py`; read by zynthian-ui `zyngine/zynthian_position_law.py` and by the console | value to position for `linear`, `log`, `stepped`, `map`; its code stays omx-contract's, in C, with wasm and ctypes doors (decision 1) |
| value text | JS, C, Python | `tools/modgui-gen.mjs` `valueText`; `renderer/src/view.c` (`%g`); Zynthian `get_value2label`; the console's own | four rules, none shared |

The console also keeps its own gesture table, the law `docs/panel-gestures.md` conforms to. It is a client like any other
here: it moves onto the core in its own step (section 7).

## 2. The API

All names below are an outline: the header is written by step 1's PR. The prefix is `omx_behaviour_`; the
header is `omx_panel_behaviour.h`.

### The context

```c
typedef struct omx_behaviour omx_behaviour_t;              /* opaque, immutable once open */

typedef struct {
  const char *panel_json;      /* the text of <contractdir>/panel/panel.json */
  const char *lang;            /* the catalog language of the value text; NULL is English (x-text) */
  const char *catalog_json;    /* <contractdir>/panel/catalogs/<lang>.json, or NULL */
} omx_behaviour_docs_t;

int  omx_behaviour_open(const omx_behaviour_docs_t *docs, const char *settings_json,
                        omx_behaviour_t **out, omx_behaviour_error_t *err);
void omx_behaviour_close(omx_behaviour_t *b);
```

The context is opened once from the `panel` domain document as text and checks it against the floor the core was built for
(`info.version`), refusing by name as `omx_domain_open` does. It holds every timing, threshold, table cell and text rule
after `open`; no other call reads a file, an environment variable or a clock. The settings are a surface's own timings
and paint switches, checked as `omx_gesture_open` checks them today (`renderer/include/omx_panel_gesture.h`). Taking the
documents as text is what lets one source serve C, ctypes and wasm alike; a browser has no contract directory and is
handed the documents by the page (omx-contract `docs/consumer-move.md`, step 4). A native client opens `panel` through
`omx_domain_open` first and hands the core the same file's text (decision 2).

The core reads no omx-contract document. `PARAM_SCALES` is classic data (`data/primitives.json`) and the unit list is a
schema enum (`$defs.unit` of `schema/omx-contract.schema.json`): neither is an installed domain document. The laws switch
on the build-time constants `OMX_PARAM_SCALES_*` of omx-contract's C header, and a unit is a plain string the core writes
as given until omx-contract's `PARAM_UNITS` item lands (decision 3).

### Mappings

```c
typedef struct {
  int law;                       /* OMX_PARAM_SCALES_* of omx-contract's C header (build time); ignored for a map travel */
  double min, max, step, def;
  int has_def, integer;
  const double *points; size_t npoints;   /* a `map` travel: [plain, quantity] pairs; else NULL, 0 */
  const char *unit;              /* the unit as the description gives it, a plain string; "" none */
} omx_behaviour_travel_t;

double omx_behaviour_position(const omx_behaviour_travel_t *t, double value);  /* 0..1 */
double omx_behaviour_value(const omx_behaviour_travel_t *t, double p);
double omx_behaviour_step(const omx_behaviour_t *b, const omx_behaviour_travel_t *t, double value, double n, int coarse);
int    omx_behaviour_within_step(const omx_behaviour_t *b, const omx_behaviour_travel_t *t, double a, double v);
int    omx_behaviour_travel_check(const omx_behaviour_travel_t *t, omx_behaviour_error_t *err);
```

- `position` and `value` are the laws of omx-contract `docs/scale-position.md`, all four, each within one ulp of
  `data/scale-vectors.json`. Today's C unit has `linear`, `log` and integer only (`renderer/src/gesture.c`, `ge_norm_of`);
  `stepped` by its declared step and `map` are new to C.
- The laws' code is omx-contract's, in C (decision 1): the core links it, and these calls wrap it with the travel's
  step and detent rules.
- A `map` travel is told by its points: `points` not NULL and `npoints` at least 2. It has no `PARAM_SCALES` word (`map`
  is the override module's table, not a word, `docs/scale-position.md`), and `law` is not read.
- `step` is n declared steps away, coarse n times `coarseSteps`, else `stepFraction` of the travel
  (`schema/gestures.json` `thresholds`); a fraction of n counts, as today.
- A log travel whose floor is not positive is served linear, as the scale page says. A travel with no ends, a min not below
  its max or a negative step is refused by `travel_check` with `GESTURE_BAD_INPUT`'s words, as today.
- Pure functions: no state, no allocation, safe on any thread.
- Detents: none is declared today (`schema/gestures.json` has no such threshold). An encoder detent is the input `detent`
  of the word `step`. A value a drag sticks at (a centre, 0 dB) is not in this spec.

### Value text

```c
size_t omx_behaviour_text(const omx_behaviour_t *b, const omx_behaviour_control_t *c, double value, char *out, size_t cap);
int    omx_behaviour_parse(const omx_behaviour_t *b, const omx_behaviour_control_t *c, const char *text, double *value,
                           omx_behaviour_error_t *err);
```

- `omx_behaviour_control_t` is a control of the served description: its kind (section 4), its travel, and a selector's
  choice labels (`[{value, label}]`, the description's, in the plugin's own words).
- A number is written by one rule, today's `valueText` (`tools/modgui-gen.mjs`): at most `maxPlaces` decimals, fewer as
  the value or the span grows, trailing zeros dropped, then a space and the unit as the unit list spells it. A `ratio` is
  `n:1` (assumption: no surface writes one today, and the unit list says a ratio is `n:1`, omx-contract
  `docs/descriptors.md`, "Units"). A selector writes its label. A switch writes `On` or `Off` from the panel catalogs.
- `parse` reads what `text` writes, the unit optional; a word or a label it cannot read is refused with a code
  (section 4). `parse(text(v))` lands within one step of `v`.
- Writes into the caller's buffer, as `omx_gesture_run` does: the whole length is returned, a cut is said by a length of
  `cap` or more. No allocation.

### Meter readings

```c
double omx_behaviour_meter_position(const omx_behaviour_travel_t *range, double reading);
size_t omx_behaviour_meter_text(const omx_behaviour_t *b, const omx_behaviour_travel_t *range, double reading, char *out, size_t cap);
```

A readout's range, unit and scale are omx-contract's readout declaration (`docs/readouts.md`). Position and text are the
mappings above; a meter is a travel nobody moves. The marker's fall is the client's call to omx-dsp.

### Gestures

```c
typedef struct omx_behaviour_surface omx_behaviour_surface_t;   /* one per drawn panel */

omx_behaviour_surface_t *omx_behaviour_surface_new(const omx_behaviour_t *b, size_t max_targets, size_t max_pointers);
int    omx_behaviour_target(omx_behaviour_surface_t *s, int at, const omx_behaviour_target_desc_t *d);  /* add or update */
size_t omx_behaviour_event(omx_behaviour_surface_t *s, const omx_behaviour_event_t *e,
                           omx_behaviour_change_t *out, size_t cap, omx_behaviour_answer_t *a);
size_t omx_behaviour_tick(omx_behaviour_surface_t *s, double t_ms, omx_behaviour_change_t *out, size_t cap,
                          omx_behaviour_answer_t *a);
void   omx_behaviour_surface_free(omx_behaviour_surface_t *s);

size_t omx_behaviour_run(const omx_behaviour_t *b, const char *control_json, const char *events_json, char *answer, size_t cap);
```

- The target, event, change and answer structs are today's internal ones made public: `ge_target_t`, `omx_panel_event_t`,
  `omx_panel_change_t` and `omx_panel_answer_t` (`renderer/src/gesture.h`, `renderer/src/input.c`). A target is a single
  control, a bar group or a curve handle, with its box and travel in the surface's logical px.
- State is the surface's: the targets, the pointers, the claims, the gesture ids. Ownership, painting across a bar group
  and a pinch span targets and pointers, so the state is per surface, not per control.
- The surface is sized once, at `surface_new`. `event` and `tick` never allocate: today's engine grows its targets and its
  gesture log with `realloc` (`renderer/src/gesture.c`); the core keeps the last gesture only and leaves the log to the
  caller. Time is the caller's (`t_ms`); the core reads no clock.
- `omx_behaviour_run` is today's JSON door, `omx_gesture_run`, under the core's name: one control and a script in, the
  answer out. The conformance suite and the wasm loader's tests drive it.

### Threads

A context is immutable after `open` and can be read from any thread. A surface belongs to one thread at a time; two
surfaces share nothing. No call runs on an audio thread: the core is a UI and surface library, and a plugin's audio code
never links it.

## 3. Build and packaging

Modelled on omx-dsp's curve function, which is one C source built natively and as WebAssembly (omx-dsp
`tools/wasm-build.sh`, `wasm/omx_curve_wasm.c`, `ts/src/wasm.ts`, `docs/wasm-vs-native.md`).

| | omx-dsp (verified) | the core (proposed) |
|---|---|---|
| C source | `include/omxdsp/...`, `omx_curve_json.h` | `core/src/*.c`, `core/include/omx_panel_behaviour.h` (NEW directory) |
| native library | `libomxdsp`, `omxdsp.pc` | `libomx-panel-behaviour.so.0` and `.a`, `omx-panel-behaviour.pc`; export map and ABI file as the renderer's (`renderer/src/exports.map`, `renderer/abi/`) |
| wasm recipe | `tools/wasm-build.sh`: distribution clang, lld, wasi-libc, no Emscripten, `-ffp-contract=off` | the same script, called with the core's sources (its header already names omx-panel's gesture module as a user) |
| wasm door | `wasm/omx_curve_wasm.c`: a request buffer, an answer buffer, a capacity, one call | `core/wasm/omx_behaviour_wasm.c`: the same four exports per call family, plus handles for an opened context and a surface |
| loader | `loadCurve(source)`, async, `ts/src/wasm.ts`; WASI imports stood in by functions that throw | `loadBehaviour(source, docs)`, async, returns a module synchronous to use; the same stand-ins |
| npm | `@openmixer/omx-dsp`, `wasm/omx-dsp.wasm` | `@openmixer/omx-panel`, export `./behaviour`, `wasm/omx-panel-behaviour.wasm`; the export imports nothing of Node |
| distro | `omx-dsp-wasm` (noarch, `/usr/share/omx-dsp/wasm/`) | `omx-panel-behaviour`, `omx-panel-behaviour-devel` (`libomx-panel-behaviour-dev`), as `omx-panel-render` is packaged (`packaging/omx-panel.spec`); the module in the existing `/usr/share/omx-panel/` tree |
| Python | none | `python3-omx-panel-behaviour`: one ctypes module, `omx_panel_behaviour.py`, the only Python door; it holds no rule |

- The renderer links the core: `libomx-panel-render` loses `gesture.c` and calls `omx_behaviour_*` from `input.c`.
- The version is omx-panel's. The soname stays `.so.0` through development; an API change needs no bump.
- The domain floor the core needs is a constant of the build, checked at `open`.

How each client loads it:

| Client | Door |
|---|---|
| this repository's renderer, a CLAP plugin GUI, a C surface daemon | link `omx-panel-behaviour` (`pkg-config`) |
| Zynthian | `omx_panel_behaviour.py` (ctypes on `libomx-panel-behaviour.so.0`) |
| the web UI, the MOD GUI script, a surface adapter in Node | `loadBehaviour` from `@openmixer/omx-panel/behaviour` |

## 4. Data ownership

Every word and table the core reads, and what it writes. NEW marks an item this spec proposes. The producer writes the
value, the changer is the repository whose PR changes it, and the readers read it.

| What | Owner domain | Item | Producer | Changer | Readers |
|---|---|---|---|---|---|
| the scale words | omx-contract (classic data, not a domain) | `PARAM_SCALES` (`data/primitives.json`) | omx-contract's authors | omx-contract | the core at build time (`OMX_PARAM_SCALES_*`); descriptor readers; the console |
| the scale laws | omx-contract | `docs/scale-position.md`, `data/scale-vectors.json` | omx-contract's authors; the vectors in 60-digit decimal arithmetic | omx-contract | omx-contract's C law and its wasm and ctypes doors (decision 1), which the core links; the core's conformance runners |
| the unit list | omx-contract (a schema enum, not an item) | `$defs.unit` of `schema/omx-contract.schema.json`; descriptor units, `docs/descriptors.md` | omx-contract's authors | omx-contract | descriptor validation; the core takes the unit as a plain string from the description until the NEW `PARAM_UNITS` item (decision 3) |
| readout ranges | omx-contract; each kernel's owner | readouts, `docs/readouts.md` | the kernel owners (omx-dsp's kernel files) | omx-dsp or omx-contract | omx-panel's `describe` into the description's `meters`; the core through the description |
| control kinds | panel | NEW `PANEL_CONTROL_KINDS`: `knob`, `fader`, `switch`, `selector`, `xy`, `meter`, `display`, `curve`, `bar`, `handle` | omx-panel's authors | omx-panel | the core at `open` |
| gesture words | panel | NEW `PANEL_GESTURE_WORDS` (`x-c-codes`) | omx-panel's authors | omx-panel | the core (its codes header replaces the generated `renderer/src/gesture_words.h`); adapters through the core's answers |
| gesture inputs | panel | NEW `PANEL_GESTURE_INPUTS` (`x-c-codes`): the 16 of `inputs` | omx-panel's authors | omx-panel | the core; adapter bindings by `x-from` |
| the table | panel | NEW `PANEL_GESTURE_TABLE_<KIND>`, one words item per kind: each input, `x-group` its word, `x-groups: PANEL_GESTURE_WORDS` | omx-panel's authors | omx-panel | the core at `open`, through the loader's word answer with its NEW `group` (decision 4) |
| timings | panel | NEW `PANEL_GESTURE_TIMINGS`, a range item: `longPressMs`, `doubleTapMs`, `palmGuardMs`, `safetyHoldMs`, `claimMs` | omx-panel's authors (`default` the declared default, `minimum` the floor: `safetyHoldMs` 800) | omx-panel | the core; a surface's settings are checked against it |
| thresholds | panel | NEW `PANEL_GESTURE_THRESHOLDS`, a range item: `dragStartPx`, `fineRatio`, `stepFraction`, `coarseSteps`, `defaultTravelPx` | omx-panel's authors | omx-panel | the core |
| paint | panel | NEW `PANEL_GESTURE_PAINT`: `touch` `required`, `mouse` `optional` | omx-panel's authors | omx-panel | the core |
| gesture codes | panel | NEW `PANEL_GESTURE_CODES` (`x-c-codes`), the 10 codes with their sentences as `x-text` and in the catalogs | the words: omx-panel's authors; a refusal at run time: the core | omx-panel | adapters (what they show), the vectors |
| section exceptions | none | dropped | | | |
| value text rule | panel | NEW `PANEL_VALUE_TEXT`, a range item: `maxPlaces` (3), `significantFigures` (3) | omx-panel's authors (today typed in `tools/modgui-gen.mjs`) | omx-panel | the core |
| switch words | panel | NEW `PANEL_SWITCH_STATES`: `off`, `on`, translated in `contract.d/panel/catalogs/` | omx-panel's authors; the translators of the catalogs | omx-panel | the core's value text |
| text codes | panel | NEW `PANEL_TEXT_CODES` (`x-c-codes`): `TEXT_NOT_A_NUMBER`, `TEXT_NO_CHOICE`, `TEXT_OUT_OF_TRAVEL` | the words: omx-panel's authors; a refusal at run time: the core | omx-panel | adapters, the vectors |
| value text | none: an answer, not data | `omx_behaviour_text` | the core | omx-panel (the rule) | adapters, the MOD GUI generator |
| a control surface's inputs | the adapter's domain, e.g. NEW `surface/xtouch` | `SURFACE_XTOUCH_INPUTS`: each word `x-from` `{ "$ref": "https://openmixer.org/contract/panel#/components/schemas/PANEL_GESTURE_INPUTS", "x-term": "detent" }` | the adapter's authors | the adapter's repository | that adapter at start-up; `omx-contract validate` (rule `word-from`) |
| an OSC binding | the adapter's domain, e.g. NEW `osc/panel` | `OSC_PANEL_ADDRESSES`: each address `x-from` a `PANEL_GESTURE_WORDS` term (`step`, `reset`) or the mapping it carries (a position or a plain value) | the adapter's authors | the adapter's repository | that adapter; `omx-contract validate` |
| the vectors | none: a test file | `vectors/behaviour.json` (section 6) | omx-panel's authors, worked by hand | omx-panel | the C, wasm and Python runners; each adapter's harness |

`schema/gestures.json` becomes the items above and is then deleted: no second copy, no alias (`docs/contract-domains.md`
already lists the `gestures` words as a follow-up; the owner's split puts them in `panel`). Its `exceptions` (empty
today; `docs/panel-gestures.md`: "a section-word exception may be layered on it there, and none is used") is dropped with
it, and so is the target's `section` field in the C unit (`renderer/src/gesture.h`); a section exception would be a NEW
item the day one is needed. The deletion waits until no other repository reads the file (section 7, step 7).
Assumption: a words item's `const` can serve as an `x-term` key; contract-dir names `x-term` "the term's key" of a terms
item (omx-contract `docs/contract-dir.md`, "Domains").

## 5. Adapters, the starter and the MOD GUI

### A runtime adapter must

- read the served description at run time (`omx-panel describe`, or the host's copy of it) and build each control's travel
  and target from it;
- open one context from the installed domain documents, once;
- turn every toolkit input into a core event with the toolkit's own timestamp, and every timer into `tick`;
- draw what the core answers: the value, the gesture word, the `shown` interval, the text;
- send the value the core answers to the host through its protocol client;
- pass the conformance suite through its own input path (section 6).

### A runtime adapter must not

- hold a timing, a threshold, a table cell, a scale law, a step or a text rule;
- compute a position, a step or a value text itself, or round one the core answered;
- keep generated UI code that is regenerated from the description;
- refuse an input the core accepts, or accept one the core refuses.

### The starter

`omx-panel starter --toolkit <nuxt|tk|c> --out <dir>` writes, once, a skeleton adapter for one toolkit: the loading of
the core, a widget per control kind wired to the core's calls, and the conformance harness. It refuses a directory that
exists. After that the toolkit owns every file: its widgets, its layout, its look. omx-panel never rewrites them and keeps
no template that tracks them. The starter is held by a test that its output passes the conformance suite as written.

### The MOD GUI: the static target

`omx-panel modgui` still generates the bundle from the descriptor (`docs/modgui.md`). The face is static. Its
generated script loads the wasm module for what it moves at run time: meter positions and value text. Its values in the
generated face (`valueText` today) come from the core at generation time, through the same loader, so a face and a live
surface write one text. A knob drag inside mod-ui is mod-ui's own (`docs/modgui.md`: "mod-ui writes the port's value" into the scribble
strip), and stays so (decision 5).

## 6. Conformance

One file: `vectors/behaviour.json` in this repository, owned by omx-panel, installed as
`share/omx-panel/behaviour-vectors.json` and exported as `@openmixer/omx-panel/behaviour-vectors.json`.

```json
{ "schema": 1, "doc": "...", "panelFloor": "x.y.z",
  "cases": [
    { "id": "map/log-1k", "area": "position", "travel": { ... }, "value": 1000, "expect": { "p": 0.5663 }, "tolerance": "ulp" },
    { "id": "text/ratio", "area": "text", "control": { ... }, "value": 4, "expect": { "text": "4:1" } },
    { "id": "gesture/eq-band-drag", "area": "gesture", "control": { ... }, "events": [ ... ], "expect": { ... } }
  ] }
```

- Areas: `position`, `value`, `step`, `text`, `parse`, `meter`, `gesture`. The gesture cases are today's 20 scripts
  (`test/fixtures/gestures/scripts.json`) moved in, with the 117 entries of `RULES` (`renderer/test/gesture-c.mjs`).
- Expected values are worked from the declaration and the law, never taken from the core, as `data/scale-vectors.json` is
  computed apart from its library. The scale law's own vectors stay omx-contract's; the core's suite also runs
  `share/omx-contract/scale-vectors.json` as it is.
- Tolerance per case: exact for a reset, a tap, a text and a parse; one ulp for the laws; `withinStep` for a drag. A
  native and wasm difference (glibc against wasi-libc's musl) is reported as omx-dsp `docs/wasm-vs-native.md` reports it,
  never absorbed by a wider tolerance.
- Three runners: C (`make -C core check`), wasm (`node --test` through `loadBehaviour`), Python (the ctypes module). All
  three in this repository's CI. Each is sabotaged once per area, as `renderer/test/gesture-c-sabotage.test.mjs` does.
- A toolkit proves its adapter by replaying the `gesture` cases through its own input path (synthetic toolkit events into
  its adapter, not straight into the core) and the `text` cases through its own widgets' displayed string, equal to the
  expected. The harness comes with the starter. A surface adapter replays the cases its inputs can make and lists the
  rest as not applicable, with the reason.

## 7. Migration

One PR per owner repository per step. Each step is red first: one commit of tests that fails, then the commits that turn
it green, the failing line and the run in the PR body. Nothing old is kept once its replacement lands. The core reads
`schema/gestures.json` as today's unit does until step 7, so no client is broken before it has moved.

0. **omx-contract: the scale law in C.** Before step 1. Red: omx-contract's `data/scale-vectors.json` run against a C
   law that does not exist. Green: the four laws in omx-contract's C library, with its wasm and ctypes doors
   (decision 1). Its TypeScript and Python functions stay until step 8.
1. **omx-panel: the core and its vectors (this repository's first step).** Red: `vectors/behaviour.json` with the
   `position`, `value`, `step` and `gesture` areas, and the three runners against `libomx-panel-behaviour`, which does not exist. Green:
   `core/` built from `gesture.c` and `gesture.h` moved (`git mv`, history kept), the four laws linked from step 0, the
   surface made allocation-free, the renderer linked to it, `omx_gesture_*` renamed to `omx_behaviour_*` with no alias.
   Proof: the 20 shipped scripts and the 117 entries of `RULES` (`renderer/test/gesture-c.mjs`: 66 written out, 8 rounding cases, 43
   unreadable inputs, run by the 15 tests of `renderer/test/gesture-c.test.mjs`) pass in C, and
   `renderer/test/input.test.mjs` stays green.
2. **omx-panel: value text and meters.** Red: the `text`, `parse` and `meter` areas. Green: the text rule, the NEW text
   items, `modgui-gen.mjs` writing its face values through the C call, `view.c` through it too.
3. **omx-panel: the Python door and the starter.** Red: the Python runner; the starter's output run against the suite.
   Green: `python3-omx-panel-behaviour` (it finds the installed declaration itself, so no client names the file),
   `omx-panel starter`.
4. **zynthian-ui: the adapter.** Red: the `gesture` and `text` cases replayed through Tk events. Green:
   `zynthian_panel_gestures.py` and `zynthian_position_law.py` become an adapter over the ctypes door; the Python rules,
   `ZYNTHIAN_OMX_GESTURES`, the CI step that clones omx-panel for `schema/gestures.json` and the symlink of it in
   `zynthian_omx_panel_view.py` go. After this step no zynthian-ui file names the file.
5. **omx-panel: wasm and the loader.** Red: the wasm runner and a check that `./gestures` and `tools/gestures.mjs` are gone.
   Green: `./behaviour`, `loadBehaviour`, the module in the npm tree and the rpm and deb, the JS reference deleted.
6. **The console: the web UI and its surface adapters.** Lockstep with step 5 (decision 6). Red: the cases through
   its own pointer and surface paths. Green: its gesture table, its scale calls in the UI and its value text replaced by
   the loader.
7. **omx-panel: the domain items.** Red: a test that opens `panel` and finds the NEW gesture items; a fixture domain with
   one timing changed moves the core; a check that no file of this tree names `schema/gestures.json`. Green: the file
   becomes the items of section 4 and is deleted; `gesture_words.h` and `tools/gesture-words.mjs` give way to the codes
   header (omx-contract `docs/consumer-move.md`). The readers this step must find gone (grep of 2026-11-19):
   - omx-panel: `tools/gestures.mjs`, `tools/gesture-words.mjs`, `tools/copy-data.mjs`, `renderer/src/view.c` and
     `view.h` (the file beside the data directory), the renderer's tests (`gesture-c.mjs`, `gesture_driver.c`,
     `input.test.mjs`, `look-roles.test.mjs`, `harness.mjs`), `test/gestures.test.mjs`, `test/host_reads.py`,
     `test/packaging.test.mjs`, the CI step "gesture word names" (`.github/workflows/ci.yml`), and the docs and headers
     that name it;
   - zynthian-ui (branch `openmixer`): `zyngine/zynthian_panel_gestures.py`, `zyngine/zynthian_omx_panel_view.py`,
     `zyngui/zynthian_widget_omx_panel.py`, `tests/test_panel_gestures.py`, `tests/test_bar_xy_gestures.py`,
     `tests/test_omx_panel_view.py`, `tests/test_ui_look_widgets.py`, `tools/pi/panel_gestures_on_the_pi.py`,
     `.github/workflows/tests.yml` lines 91 to 99, `docs/ui-look-drawn-widgets.md`; gone in step 4;
   - the published technical note on the libraries that read our plugins (openmixer-www) lists the installed path; it is
     updated in the same window.
8. **omx-contract: the TypeScript and Python scale functions.** After every user named in decision 1 reads the law
   through the C doors: omx-contract's `./scale` and `omx_contract_scale.py` are deleted, with no alias.

## 8. Decisions

The owner decided the questions this design raised (2026-11-19).

1. **The scale law's code stays omx-contract's, in C.** It has readers that draw nothing: the console's core param model
   and its server's library-range conformance test, as well as Zynthian and the console's UI. omx-contract carries the
   law in C with its own wasm and ctypes doors (step 0); the behaviour core links it, and the param model loads only
   omx-contract. omx-contract's TypeScript and Python functions are replaced by those doors (step 8). The core keeps
   steps, gestures and text.
2. **A native client opens the domains through the loader.** A native adapter opens `panel` through `omx_domain_open`
   first (the floor, the refusal, exit 78) and then hands the core the same file's text; the core repeats only the floor
   check.
3. **The unit list becomes an item.** omx-contract adds a `PARAM_UNITS` words item (the unit list, each word's symbol as
   written) and renders the schema's enum from it, in its own PR after the current pass. Until then the core reads the
   unit as a plain string and refuses none.
4. **The gesture table is one words item per control kind.** Each input is `x-group` its word, and the loader's word
   answer (`omx_domain_word_info`, omx-contract `include/omxcontract/omx_domain.h`) gains `group`: an additive
   omx-contract change, in its own PR after the current pass and before step 7.
5. **The MOD GUI's knob drag stays mod-ui's.** The generated script uses the core for meters and value text only.
6. **`./gestures` goes in lockstep.** Step 5's omx-panel release and step 6's console change land together, the console
   requiring that release by a floor (`>=`) and no ceiling; no alias is shipped and there is no overlap.
