<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# Changelog

## Unreleased

- The renderer is also a shared library, `libomx-panel-render.so.0`, exporting only the header's functions, for a surface
  that loads it at run time (Zynthian's Tk panel).
- `omx-panel describe --layout` prints the layout the description was derived from, the family's displays included: what the
  renderer draws, so a host draws exactly what it describes.
- The family rule reads a CLAP feature a scan spells by its macro (`CLAP_PLUGIN_FEATURE_EQUALIZER`) as the feature it stands
  for (`equalizer`): a scanned CLAP EQ or compressor had no candidate family.
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
