<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# Changelog

## Unreleased

- describe leaves a control meaning `bypass` to the header: a derived panel does not draw it as a control and its
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
