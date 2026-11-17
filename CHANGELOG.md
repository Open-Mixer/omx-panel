<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# Changelog

## Unreleased

- The `utility` panel family's content (omx-contract's `PANEL_FAMILIES`, 3.19), the family of a trim, a width control, a
  balancer or a clipper: the role table gives it `gain`, `width`, `pseudo`, `pseudo_time`, `bass_mono`, `bass_mono_freq`,
  `amount`, `range`, `drive`, `ceiling` and `softness` (one per control omx-trim, omx-width, omx-balancer and omx-clipper
  declare whose unit a token serves; the balancer's dB/s speed and dB/oct slope have none), `gain`, `width`, `amount` or
  `drive` as the one required role, and an Easy row. A utility is declared, never inferred. The packaging floors move to
  omx-contract 3.19.1, the release that carries the word, with no ceiling.

- The gesture reference is C. `renderer/src/gesture.c`, built into `libomx-panel-render`, is the one implementation of the
  gesture vocabulary of `docs/panel-gestures.md`; `renderer/include/omx_panel_gesture.h` (installed with the -devel
  package) exports `omx_gesture_open`, `omx_gesture_run` and `omx_gesture_close`: a control and a script of events in as JSON,
  the answer `tools/gestures.mjs` gives out as JSON, so one call shape serves every runtime. `input.c` now holds only the
  renderer's mapping of controls onto targets and calls the unit for the arithmetic. The 20 shipped scripts, 117 rules and
  4500 seeded random scripts give the same answers from C and from `tools/gestures.mjs`; the ABI is
  `renderer/abi/omx_panel_gesture.abi`. `tools/gestures.mjs` keeps its arithmetic and stays the
  JavaScript reference until its wasm loader lands; it gains `validateInput` only. `schema/gestures.json` now declares every
  refusal code with its sentence (`codes`), including `GESTURE_BAD_INPUT`, which both references answer, in the same words, to
  input neither can read. An integer travel now rounds as `Math.round` does, exactly, where the renderer rounded a negative half
  away from zero, and a wheel's notch count is a number, not an int32.
- The gesture parity scripts are exported by name: `@openmixer/omx-panel/gestures/scripts.json` resolves to
  `dist/test/fixtures/gestures/scripts.json`, the file the installed tree already carries, so the console reads the
  same scripts as the Zynthian UI without a path into `dist/`.
- The look is the vintage look, and `tools/look.json` is the one public source of its tokens. The role defaults of
  `schema/look-roles.json` move from the dark, cyan, modern look to the console's default: dark, orange accent
  (`--accent` `#e8732c`), aluminium, vintage (`--glass` `#05070a`). The package carries the file as
  `dist/tools/look.json`, now exported as `@openmixer/omx-panel/look.json`, and installs it as
  `/usr/share/omx-panel/tools/look.json`; its readers are the MOD GUI generator, the renderer, the Zynthian UI and its
  pixel test, and the console's check of its own `tokens.css`.
  Two new roles, each one drawing, neither drawn in `--accent` any more: `--knob-pointer` (a knob's pointer, the
  console's cream `#f4efe2`) and `--curve-stroke` (the line of an `eq_response`, a `transfer_curve` or a
  `time_response` display; the accent's value at this look). The renderer and the MOD GUI generator draw both from
  the roles. A look that lacks either is refused by the role's name, as for every role; nothing stands in for a
  missing role. A host that passes its own look (`look.json` in the renderer's data directory, a console theme, a
  Zynthian palette) must now value both, or the renderer refuses it.
  Every MOD GUI image, stylesheet and golden image moves with the look. The knob is still drawn flat: its metal face,
  rim and relief are not in this change. docs/modgui.md "The look"; `test/look-roles.test.mjs`,
  `renderer/test/look-roles.test.mjs`, `test/packaging.test.mjs`.

- An EQ's band matrix on every screen (the owner's rule: the high-pass the first band, the low-pass the last, the bands
  between in their number order, aligned; the audio order untouched). The group model reads a descriptor of any origin:
  one a scan wrote states no `symbol`, the model read none of its controls, and a host, which draws from a scan, got
  omx-eq8 as the sections HPF, LPF, Band 1 .. Band 8 with no matrix. Its controls are now keyed as the layout keys them;
  a CLAP scan's instance number is read from the parameter's name and its 0..1 whole-number travel is a toggle. The page
  cut keeps every instance's places: a place an instance has no control at (an empty cell, or a control the Easy pages
  took) is a blank slot, so slot k is the same parameter on every band's screen. A surface that pages an EQ sees one more
  screen for a band whose gain is an Easy control where the band no longer fits its width (omx-eq8 at 4 slots).
  docs/group-model.md, L7 and P1; `test/eq-band-matrix.test.mjs`.

- 0.13.8: built against omx-contract >= 3.18.0 and plugin-hostd >= 0.20.7, every floor its newest version, served or released before it in the same pass, with its ceiling (D30).
  This release also carries: the spectrum layer, drawn by the renderer on the console analyser's axes (built against
  omx-dsp >= 0.32.3 and below 0.33); the `time_response` display kind and describe reading a plugin's served panel as the
  declared form (both below); and fixes: the commit-msg hook takes the current stub from the checker's release line,
  artifact retention is explicit (30 days on a tag, 2 otherwise), the Makefile names the shared checks' checkout through
  OPENMIXER_DOTGITHUB, the renderer tests remove their scratch directories and read readelf in the C locale, debian/control
  floors libomx-contract-dev as the spec floors omx-contract-devel, and the omx-eq8 fixture matches the installed file
  apart from its version lines.
- The `time_response` display kind (ruling 6, the lost FX graphics; the processing-view spec, amendment 2026-09-16h): a delay
  section's `delay-taps` and a reverb section's `decay-envelope` are one display kind, x time in ms from 0 to the content's
  end, y level in dB with the floor at -60, drawn by the renderer from what the host sets: the envelope as the display's curve
  (`omx_panel_view_set_curve`) and the stems as `omx_panel_view_set_stems` (one per tap: time, level, shade, leg letter), each
  array when present. The closed forms of the delay and reverb families name it, the served panel reads it back to the family's
  graph word, the skin schema lists it. `describe` refuses a graph word that names no display kind by name: it used to drop the
  display in silence, which is how the reverb's picture went missing. omx-plugins' omx-reverb joins the fixtures.

- 0.13.8: describe given a plugin's own panel takes each parameter's role from the panel's declaration in place of a
  scan's `unknown` meaning (#43: on the Pi, omx-comp 0.19.3's panel over plugin-hostd's scan descriptor answered family
  `none`, `panel.describe.family-not-backed`, and the console drew knobs alone). A declared panel's roles back its
  family; a control the panel binds to a role serves the role's meaning where the descriptor states none; a meaning the
  descriptor does state still has to agree with the role, or the role is named and not bound
  (`panel.describe.role-dropped`). `--panel` also reads the panel a plugin serves, `org.openmixer.panel-description/1` as
  omx-clap-scan --json prints it and plugin-hostd-probe panel copies it (`tools/panel-served.mjs`): its tables name
  parameters by id, and are read as the declared form over the descriptor's keys; plugin-hostd stays a host that copies
  bytes.
- 0.13.7: the DEBs build again. 0.13.6's failed lintian --fail-on warning (script-not-executable): tools/gesture-words.mjs ships as a command now, executable, its declaration without the shebang, and the build refuses a shipped module with a shebang that is not a listed command.
- 0.13.6: a host that is not JavaScript reads the gesture word names through the library (`omx_panel_word_name`,
  generated from schema/gestures.json) and the compare format, slots and ring bound through `omx-panel compare describe`
  (#23); one language pack per listed language (ca, es, fr, de, it, pt), each owning its catalog.
- 0.13.4 was tagged without a version bump and never released: its tag is empty, and nothing was published under
  it.
- 0.13.5: describe serves a plugin's path and text parameters (#17): an LV2 patch:writable lv2:Parameter of range atom:Path or
  atom:String is a `params` entry of kind `path` or `text` and a control of the last section, never on a page; a plugin
  whose only parameters are paths or texts has a panel; a patch parameter of another range is refused by
  `panel.describe.param-unserved`. LSP Impulse Reverb's four impulse files, LSP Matcher's files and link name and
  zeroconvolv's impulse response are the proofs.
- 0.13.3: describe leaves a control meaning `bypass` to the header: a derived panel does not draw it as a control and its
  fingerprint does not count it; the param is still served. EQ10Q's `eq*qm` toggle `bypass`, which plugin-qualify's
  scan gives that meaning (plugin-qualify#27), was drawn a second time.
- 0.13.3: the meaning each panel role plays comes from the `roleMeanings` items the installed packages declare
  (omx-contract 3.13.0's kind; omx-plugins-contract 0.19.3 installs omx-plugins'), no list of omx-panel's own; a role no
  package declares plays none, one declared twice is refused. A level meter of the descriptor's `meters[]` is the
  transfer curve's operating point without a `measurement`, as plugin-hostd 0.20.3 describes `clap.meters/1` meters.
- 0.13.3: `tools/modgui-test.sh` and `tools/modgui-gen.mjs` fail with the reason when the panel layout cannot be read (plugin-hostd's
  LV2 table not installed): both read that as "no meters", so the generator wrote a MOD GUI without its meter frames and
  the test passed it (#11).
- 0.13.2: `tools/modgui-test.sh` holds each meter frame the generator draws to the description's symbol, range and unit,
  with no port role, and counts it; a MOD GUI with meters failed 0.13.1's test with more rows drawn than declared.
- 0.13.1: the package metadata names Open-Mixer/omx-panel (repository, homepage, bugs), so npm accepts the package
  its provenance names; 0.13.0 was refused for naming the old organisation.
- The renderer is also a shared library, `libomx-panel-render.so.0`, exporting only the header's functions, for a surface
  that loads it at run time (Zynthian's Tk panel).
- `omx-panel describe --layout` prints the layout the description was derived from, the family's displays included: what the
  renderer draws, so a host draws exactly what it describes.
- The family rule reads a CLAP feature a scan spells by its macro (`CLAP_PLUGIN_FEATURE_EQUALIZER`) as the feature it stands
  for (`equalizer`): a scanned CLAP EQ or compressor had no candidate family.
- An EQ band whose frequency and gain the descriptor's words name gets the Q, the type (with its shapes) and the switch the
  words leave unnamed from the band inference, at the words' index: an LV2 port states no Q, so a scanned LV2 EQ had a curve
  plugin-hostd could not draw.
- The band inference keys a CLAP parameter by its name: its id is a number and says nothing of its band, so a scanned CLAP
  EQ (`Band 1 Frequency`, `Band 1 Gain`) had no band.
- describe reads the descriptor's `meters` word: each meter is a meter control with its kind, measurement, unit, range,
  channels, symbol, held and clip. A dynamics family's gain reduction is its section's `gain_reduction_bar`; the transfer
  curve's operating point reads the input and output level meters. A foreign read-only level control stays a meter with no
  measurement. A meter whose name is phantom, pad or head-amp state is refused by code (`panel.describe.meter-refused`). The meters
  stay out of the canonical form and the fingerprint.
- `rms`, `vu` and `ppm` are no longer measurements.
- The renderer draws the meters: a bar and a peak marker over the description's range (`omx_panel_view_set_meter`); the marker
  is omx-dsp's view law (`omx_meter_view_step`), falling by elapsed time at 18 dB/s.
- The MOD GUI face draws each meter as a static frame with its range; there is no live meter. The meter frame's style is
  written whenever a meter stands, with or without a curve.
- The MOD GUI's pedal rim is an inset shadow: its border had set every box of the template 1 px right and down of the raster.
- The renderer build needs omx-dsp-devel >= 0.32.0 and < 0.33 (`pkg-config omxdsp`).
- `renderer/test/meter-surfaces.mjs` measures one recorded stream on the renderer, in Chromium and in Tk.
