# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
# the build runs with --nodeps, without systemd-rpm-macros: the unit directory is then the one it defines
%{!?_unitdir:%global _unitdir %{_prefix}/lib/systemd/system}

Name: omx-panel
Version: 0.13.8
Release: 1%{?dist}
License: GPL-3.0-or-later
Summary: Panels for LV2 and CLAP plugins, generated from what each plugin declares
URL: https://github.com/Open-Mixer/omx-panel
# omx-panel itself is architecture independent; the renderer library (omx-panel-render) is not, so the build is per
# architecture

Source0: %{url}/archive/v%{version}/%{name}-%{version}.tar.gz

BuildRequires: make
BuildRequires: sed
BuildRequires: nodejs >= 18
# npm ci fetches typescript (the build) and ajv (the validator, bundled below) from the registry, unless Source0 is
# the vendored tarball (tools/vendored-source.sh), which holds them; the build still runs npm itself
BuildRequires: npm
# %%check reads the installed vocabulary: omx-contract's schema, plugin-hostd's LV2 table, and the param-contract
# unit sheet (omx-contract's OMX_PARAM_CONTRACT_UNITS, from 3.6.0); nothing of omx-plugins, which builds with this package
BuildRequires: (omx-contract-data >= 3.18.0 with omx-contract-data < 4)
BuildRequires: (plugin-hostd-contract >= 0.20.7 with plugin-hostd-contract < 0.21)
# omx-modgui-sync lists the LV2 plugins with lilv and scans one with no descriptor with plugin-hostd-probe. Fedora's
# python3-lilv loads liblilv-0.so, the name only lilv-devel installs; without it `import lilv` fails. The package
# does not ask for lilv-devel (tools/runtime-install-check.sh: no development package at runtime), so a desk that
# runs omx-modgui-sync installs it beside python3-lilv; the build and CI do.
Recommends: python3-lilv
Recommends: (plugin-hostd >= 0.20.7 with plugin-hostd < 0.21)
# %%check runs omx-modgui-sync over a bundle (lilv-devel: the liblilv-0.so python3-lilv loads)
BuildRequires: python3-lilv
BuildRequires: lilv-devel
BuildRequires: systemd-rpm-macros
# the renderer library (renderer/Makefile): cJSON, omx-contract's C headers and omx-dsp's meter view
BuildRequires: gcc
BuildRequires: pkgconfig(libcjson)
BuildRequires: (omx-contract-devel >= 3.18.0 with omx-contract-devel < 4)
BuildRequires: (pkgconfig(omxdsp) >= 0.32.0 with pkgconfig(omxdsp) < 0.33)

Requires: nodejs >= 18
# the layout reads omx-contract's meanings and plugin-hostd's unit table from the contract directory these install
Requires: (omx-contract-data >= 3.18.0 with omx-contract-data < 4)
Requires: (plugin-hostd-contract >= 0.20.7 with plugin-hostd-contract < 0.21)
# the descriptors of omx-plugins' plugins, for modgui --installed
Recommends: (omx-plugins-contract >= 0.19.3 with omx-plugins-contract < 0.20)
Provides: bundled(nodejs-ajv)

%description
omx-panel makes panels for LV2 and CLAP plugins from what each plugin
declares. It lays a panel out from a plugin's descriptor (sections, controls,
roles, the pages of eight a controller shows), writes a MOD GUI for MOD and
Zynthian in the omx look, imports a plugin's own MOD GUI into a skin package,
and carries the skin package schema, its validator and the directory skin
packages are installed into. The omx-panel command runs each; the tools are
under /usr/share/omx-panel for a build that calls them.
Its documentation is on openmixer.org.

%package -n omx-panel-render
Summary: The omx-panel renderer, a library that draws a panel description into a pixel buffer
# the renderer reads the look, the geometry and the fonts omx-panel installs under /usr/share/omx-panel/tools
Requires: omx-panel%{?_isa} = %{version}-%{release}

%description -n omx-panel-render
libomx-panel-render.so.0 draws a panel description in the omx look into a CPU
pixel buffer and answers input with the one gesture vocabulary. A surface loads
it at run time (Zynthian's panel view); its look, geometry and fonts are
omx-panel's.

%package -n omx-panel-render-devel
Summary: Header, link and pkg-config file of the omx-panel renderer
Requires: omx-panel-render%{?_isa} = %{version}-%{release}
Requires: pkgconfig(libcjson)

%description -n omx-panel-render-devel
The header omx_panel_render.h, the libomx-panel-render.so link and the
omx-panel-render pkg-config file, to build against the omx-panel renderer.

%prep
%autosetup

%build
test -d node_modules || npm ci --no-audit --no-fund
%make_build
%make_build -C renderer WINDOW=0 PREFIX=%{_prefix} LIBDIR=%{_libdir} INCLUDEDIR=%{_includedir} DATADIR=%{_datadir}

%install
%make_install PREFIX=%{_prefix} BINDIR=%{_bindir} DATADIR=%{_datadir} UNITDIR=%{_unitdir} SYSCONFDIR=%{_sysconfdir}
make install-renderer DESTDIR=%{buildroot} PREFIX=%{_prefix} LIBDIR=%{_libdir} INCLUDEDIR=%{_includedir} BINDIR=%{_bindir} DATADIR=%{_datadir}

%check
make test

%files
%license LICENSE
%doc README.md
%{_bindir}/omx-panel
%{_bindir}/omx-modgui-sync
%{_bindir}/omx-complement-sync
%{_mandir}/man1/omx-panel.1*
%{_mandir}/man1/omx-modgui-sync.1*
%{_mandir}/man1/omx-complement-sync.1*
# installed, never enabled: no preset names them; `systemctl enable omx-modgui-sync` (omx-complement-sync) is the choice
%{_unitdir}/omx-modgui-sync.service
%{_unitdir}/omx-complement-sync.service
%dir %{_unitdir}/plugin-qualify-sync.service.d/
%{_unitdir}/plugin-qualify-sync.service.d/omx-modgui-sync.conf
%{_unitdir}/plugin-qualify-sync.service.d/omx-complement-sync.conf
%dir %{_sysconfdir}/omx/
%config(noreplace) %{_sysconfdir}/omx/modgui-sync.conf
%{_datadir}/omx-panel/
# the catalogs are the language packs' (one per listed language, each /usr/share/omx-panel/catalogs/<lang>.json)
%exclude %{_datadir}/omx-panel/catalogs/*.json
%dir %{_datadir}/omx/
%dir %{_datadir}/omx/skins/

%files -n omx-panel-render
%license LICENSE
%{_libdir}/libomx-panel-render.so.0

%files -n omx-panel-render-devel
%{_libdir}/libomx-panel-render.so
%{_includedir}/omx_panel_render.h
%{_libdir}/pkgconfig/omx-panel-render.pc

# BEGIN langpacks: generated by langpacks.py, do not edit
%package langpack-ca
Summary: The ca catalog of omx-panel's codes
BuildArch: noarch
Requires: omx-panel = %{version}-%{release}
Supplements: (omx-panel and langpacks-ca)

%description langpack-ca
The sentences of omx-panel's codes in the language ca, read by every surface
that shows them on a host in that locale; without it a surface shows the
English source sentence.

%files langpack-ca
%{_datadir}/omx-panel/catalogs/ca.json

%package langpack-es
Summary: The es catalog of omx-panel's codes
BuildArch: noarch
Requires: omx-panel = %{version}-%{release}
Supplements: (omx-panel and langpacks-es)

%description langpack-es
The sentences of omx-panel's codes in the language es, read by every surface
that shows them on a host in that locale; without it a surface shows the
English source sentence.

%files langpack-es
%{_datadir}/omx-panel/catalogs/es.json

%package langpack-fr
Summary: The fr catalog of omx-panel's codes
BuildArch: noarch
Requires: omx-panel = %{version}-%{release}
Supplements: (omx-panel and langpacks-fr)

%description langpack-fr
The sentences of omx-panel's codes in the language fr, read by every surface
that shows them on a host in that locale; without it a surface shows the
English source sentence.

%files langpack-fr
%{_datadir}/omx-panel/catalogs/fr.json

%package langpack-de
Summary: The de catalog of omx-panel's codes
BuildArch: noarch
Requires: omx-panel = %{version}-%{release}
Supplements: (omx-panel and langpacks-de)

%description langpack-de
The sentences of omx-panel's codes in the language de, read by every surface
that shows them on a host in that locale; without it a surface shows the
English source sentence.

%files langpack-de
%{_datadir}/omx-panel/catalogs/de.json

%package langpack-it
Summary: The it catalog of omx-panel's codes
BuildArch: noarch
Requires: omx-panel = %{version}-%{release}
Supplements: (omx-panel and langpacks-it)

%description langpack-it
The sentences of omx-panel's codes in the language it, read by every surface
that shows them on a host in that locale; without it a surface shows the
English source sentence.

%files langpack-it
%{_datadir}/omx-panel/catalogs/it.json

%package langpack-pt
Summary: The pt catalog of omx-panel's codes
BuildArch: noarch
Requires: omx-panel = %{version}-%{release}
Supplements: (omx-panel and langpacks-pt)

%description langpack-pt
The sentences of omx-panel's codes in the language pt, read by every surface
that shows them on a host in that locale; without it a surface shows the
English source sentence.

%files langpack-pt
%{_datadir}/omx-panel/catalogs/pt.json
# END langpacks

%changelog
* Fri Nov 13 2026 Pau Aliagas <linuxnow@gmail.com> - 0.13.8-1
- Built against omx-contract >= 3.18.0 and below 4 (was 3.16.0), and plugin-
  hostd and plugin-hostd-contract >= 0.20.7 and below 0.21 (were 0.20.3):
  every floor its newest version, served or released before it in the same pass, with its ceiling (D30). The
  jobs' dnf lines, three of them still at 3.13.0, state the same.
- Contract files keep the $schema the floor's reader reads.
- The organisation's name: FreeMixer becomes Open-Mixer and OpenMixer; an
  ordinary CI run builds against the channel, not the staging channel.
- systemd: a sync drop-in's post step exits 0 when its opt-in unit is disabled
  (plugin-qualify#56).

* Thu Nov 12 2026 Pau Aliagas <linuxnow@gmail.com> - 0.13.7-1
- tools/gesture-words.mjs ships as a command: executable, its declaration
  without the shebang. 0.13.6's DEBs failed lintian --fail-on warning
  (script-not-executable on gesture-words.mjs and gesture-words.d.mts), so
  0.13.6 published no DEB; the build now refuses a shipped module with a
  shebang that is not a listed command.

* Thu Nov 12 2026 Pau Aliagas <linuxnow@gmail.com> - 0.13.6-1
- omx_panel_word_name (the shared library) names each gesture word as
  schema/gestures.json spells it, from a header generated off gestures.json, and
  `omx-panel compare describe` answers the compare document's format, slots and
  ring bound: a host that is not JavaScript reads both instead of keeping its
  own (#23).
- Language packs: omx-panel-langpack-<lang> (rpm) and omx-panel-l10n-<lang>
  (deb), one per language omx-contract lists, each owning
  /usr/share/omx-panel/catalogs/<lang>.json; the Catalan entries are a person's,
  the others are made by omx-contract translate. Built against omx-contract >=
  3.16.0.

* Thu Nov 12 2026 Pau Aliagas <linuxnow@gmail.com> - 0.13.5-1
- describe serves a plugin's path and text parameters: an LV2 patch:writable
  parameter of range atom:Path or atom:String is a parameter of kind path or
  text and a control of the panel's last section, never on a page; a plugin
  whose only parameters are paths or texts has a panel; a patch parameter of
  another range is refused by panel.describe.param-unserved

* Wed Nov 11 2026 Pau Aliagas <linuxnow@gmail.com> - 0.13.3-1
- the meaning each panel role plays is read from the roleMeanings items the
  installed packages declare in their contract directories (omx-plugins-contract
  0.19.3 installs omx-plugins'); omx-panel keeps no list of its own, a role no
  package declares plays none, and one declared twice is refused
- a level meter of the descriptor's meters[] is the transfer curve's operating
  point whether or not it names its measurement: clap.meters/1 meters as
  plugin-hostd 0.20.3 describes them state none
- runs beside plugin-hostd 0.20.3: plugin-hostd-contract and the recommended
  plugin-hostd >= 0.20.3 and < 0.21, omx-contract-data >= 3.13.0 and < 4, the
  recommended omx-plugins-contract >= 0.19.3 and < 0.20
- tools/modgui-test.sh and tools/modgui-gen.mjs fail with the reason when the
  panel layout cannot be read (plugin-hostd's LV2 table not installed); both
  read that as no meters, so a MOD GUI was written without its meter frames and
  the test passed it (#11)

* Wed Nov 11 2026 Pau Aliagas <linuxnow@gmail.com> - 0.13.2-1
- tools/modgui-test.sh holds each meter frame the generator draws to the
  description's symbol, range and unit and counts it; a MOD GUI with meters
  failed 0.13.1's test with more rows drawn than declared

* Tue Nov 10 2026 Pau Aliagas <linuxnow@gmail.com> - 0.13.1-1
- the package metadata names Open-Mixer/omx-panel: repository, homepage and
  bugs in package.json, the Debian and RPM homepage and source; npm refused
  0.13.0, whose repository named the old organisation

* Mon Nov 09 2026 Pau Aliagas <linuxnow@gmail.com> - 0.13.0-1
- the renderer ships as a shared library: omx-panel-render carries
  libomx-panel-render.so.0, omx-panel-render-devel its header, link and
  pkg-config file; the build is per architecture for it
- describe --layout, CLAP feature macros, and an EQ band's Q, type and switch
  inferred from what its words name
- every code omx-panel emits has en and ca text in schema/codes.json; the
  meter refusal is panel.describe.meter-refused
- meters: describe reads the descriptor's meters word, and the renderer and
  the MOD GUI draw them
- colour roles: one declared set; look.json and the renderer derive from it
- runs beside plugin-hostd 0.20.2: plugin-hostd-contract and the recommended
  plugin-hostd >= 0.20.2 and < 0.21, omx-contract-data >= 3.12.0 and < 4, the
  recommended omx-plugins-contract >= 0.19.2 and < 0.20

* Mon Nov 09 2026 Pau Aliagas <linuxnow@gmail.com> - 0.12.0-1
- runs beside plugin-hostd 0.20: plugin-hostd-contract and the recommended
  plugin-hostd >= 0.20.0 and < 0.21, omx-contract-data >= 3.11.0 and < 4, the
  recommended omx-plugins-contract >= 0.19.1 and < 0.20

* Sat Nov 07 2026 Pau Aliagas <linuxnow@gmail.com> - 0.11.1-1
- describe serves what the console's derivation served: a CLAP parameter under its id, a scanned EQ's inferred bands, a factor gain as coef, a default inside the ends, a choice's labels only over integer values
- The renderer answers input with the one gesture vocabulary (omx_panel_view_input), read from schema/gestures.json; omx-panel-render --input runs a script
- describe --pages --per-page N: the one cut into pages (Easy first, remote pages as given, a group kept whole); the user's Easy list wins
- schema/gestures.json declares the gestures of every surface once and is installed
- The MOD GUI's static curve and band-origin marks through omx-dsp's twin when installed, the frame alone otherwise
* Fri Nov 06 2026 Pau Aliagas <linuxnow@gmail.com> - 0.11.0-1
- describe, the one derivation of a panel description: the family rule, the meaning inference, displays with their basis, refusals by code
- Bars: a section's bar group in the layout, the skin and the MOD GUI; the renderer draws bars, curve frames and host points
* Fri Nov 06 2026 Pau Aliagas <linuxnow@gmail.com> - 0.10.2-1
- plugin-hostd-contract >= 0.19.0 and < 0.20, the contract of plugin-hostd 0.19
* Thu Nov 05 2026 Pau Aliagas <linuxnow@gmail.com> - 0.10.1-1
- Publish the Debian packages; 0.10.0 published only the RPMs

* Wed Nov 04 2026 Pau Aliagas <linuxnow@gmail.com> - 0.10.0-1
- visibleWhen: a declared panel shows a control only while another control's value
  meets a rule; the pages and the MOD GUI follow it (#123)
- omx-panel modgui --films-only writes the film strips into a built bundle
- A C renderer for a panel description into a CPU buffer, and its window; a hidden
  control is not drawn (#120, #124); built in CI, not packaged yet
- @openmixer/omx-panel/role-table and copies-check are exported
- The tests read omx-contract's example descriptors; the lilv proofs run in CI
- The package installs its licence and a short README and no other markdown
- Every dependency on a sibling states a floor and a ceiling: omx-contract-data >= 3.8.0 and < 4,
  plugin-hostd-contract >= 0.18.0 and < 0.19, omx-plugins-contract (recommended) >= 0.15.0 and < 0.20
- SPDX lines are checked by the shared check, by format; copies-check reads a tree or fails
* Tue Nov 03 2026 Pau Aliagas <linuxnow@gmail.com> - 0.9.1-1
- 0.9.0 was tagged but not published: the release proof ran make check without
  the shared private-refs check at hand. Everything 0.9.0 carries is in this
  release; the release workflow now fetches that check before make check.
* Tue Nov 03 2026 Pau Aliagas <linuxnow@gmail.com> - 0.9.0-1
- The MOD GUI test bundle ships with the package, exported as
  @openmixer/omx-panel/fixtures, so a package that tests against it reads it
  from here instead of keeping a copy (#116).
- The commit message and private reference checks run from the shared
  FreeMixer/.github workflow; the local copies are gone (#115).
* Sun Nov 01 2026 Pau Aliagas <linuxnow@gmail.com> - 0.8.1-1
- The param-contract unit codes are read from omx-contract's
  OMX_PARAM_CONTRACT_UNITS sheet (omx-contract-data 3.6.0), no longer from
  omx-plugins-contract's param-units.json, which omx-plugins 0.17.0 drops. The
  omx-contract-data requirement is now >= 3.6.0.
* Sun Nov 01 2026 Pau Aliagas <linuxnow@gmail.com> - 0.8.0-1
- The Easy face: every plugin's handful of controls, from a declared list, else
  its family's roles, else its first controls. omx-panel layout --pages
  --easy-first and omx-panel modgui --easy-first put them first; without the
  option every page and file is as before. omx-modgui-sync turns it on.
- Compare A/B/C/D and an undo ring per processor, as pure functions a host runs:
  @openmixer/omx-panel/compare, and omx-panel compare for other hosts.
* Fri Oct 30 2026 Pau Aliagas <linuxnow@gmail.com> - 0.7.2-1
- omx-panel layout --pages --per-page N cuts each section into pages of at most
  N controls, in the section's order, keeping a declared group that fits a page
  whole and naming each page of a section by the controls it holds; without
  --per-page the pages are the plain cut of eight, as before (#93).

* Thu Oct 29 2026 Pau Aliagas <linuxnow@gmail.com> - 0.7.1-1
- The DEB builds again: v0.7.0 shipped without packages because the release
  lint refused the bundled font as a duplicate of a distribution font, which
  the package carries on purpose so the screenshot bytes are the same on every
  host. CI now builds and lints the DEB on every pull request (#85).
- The screenshot and thumbnail text is set in Inter, the look's own font
  (Inter 4.1, SIL OFL 1.1, its licence beside it), in place of Liberation
  Sans; the fixture images are regenerated (#83).

* Thu Oct 29 2026 Pau Aliagas <linuxnow@gmail.com> - 0.7.0-1
- The MOD GUI screenshot and thumbnail carry text: the plugin title, the
  section labels (one band per section, so per group of a grouped descriptor)
  and each control's name and default with its unit. The text is drawn from a
  font file the look names, Liberation Sans (SIL OFL 1.1, its licence beside
  it), with no host font, so the bytes are the same on every host. --check
  still refuses a stale image (#78).
- A modulation depth in octaves keeps its depth role and is published with its
  unit, so omx-phaser's depth gets a control (omx-plugins#232).
- Two LV2 bundles that would share one complement name are both written, under
  names derived from their paths, instead of both being refused (#72).

* Wed Oct 28 2026 Pau Aliagas <linuxnow@gmail.com> - 0.6.0-1
- The LV2 complement is new: the port groups an LV2 plugin does not declare
  are inferred from what it does declare (designations, shared name or
  symbol prefixes and trailing numbers, units, runs of port index, its own
  MOD GUI) and written into a replacing bundle, so the Zynthian touchscreen
  shows a plugin in sections instead of screens of four. A plugin whose
  grouping is not confident, or whose own groups are complete, is left as
  it is (plugin-hostd#218, G1, G2).
- omx-panel complement writes that bundle, named omx-complement-<bundle>.lv2
  and marked, beside the installed one; the installed files are never
  written. The inference is exported as
  @openmixer/omx-panel/group-infer (plugin-hostd#218, G1, G2).
- omx-complement-sync is a new binary, with omx-complement-sync.service and
  a man page. The unit is installed but not enabled; enabled, a drop-in on
  plugin-qualify-sync.service queues it after each scan, as for
  omx-modgui-sync (plugin-hostd#218, G2).
- A bundle of ours that is no longer wanted is removed, not reported, and
  omx-panel complement --check exits 3 for a stale or out-of-date bundle
  (plugin-hostd#218, G3).
- A generated group node never merges into one already in the bundle: a
  bundle that would collide is refused as group-iri-collision, and two
  bundles that would share one complement name are both refused
  (plugin-hostd#218, G3).
- The Turtle reader keeps an absolute IRI as written, and resolves only a
  relative one (plugin-hostd#218, G2).

* Wed Oct 28 2026 Pau Aliagas <linuxnow@gmail.com> - 0.5.0-1
- A CLAP control whose id is a number is keyed p<id>, so two parameters of
  one name no longer stop the layout; the published keys of scanned CLAP
  plugins change (#27).
- omx-panel modgui adds rdfs:seeAlso <modgui.ttl> to the bundle's
  manifest.ttl when the manifest exists and lacks it, and --check refuses a
  manifest without it (#28).
- A choice control without values is refused by code
  (MODGUI_CHOICE_NO_VALUES) naming the control (#30).
- A descriptor with no control to lay out is refused by code and the refusal
  says why (#31, the omx-panel half).
- A trigger control is left off the MOD GUI face and named on stderr; the
  rest is drawn (#47).
- omx-modgui-sync.service no longer carries WantedBy=plugin-qualify-
  sync.service: a drop-in on plugin-qualify-sync.service starts it after
  each scan when it is enabled, so a scan that begins while a GUI run is
  queued still gets its GUI run (#61).

* Wed Oct 28 2026 Pau Aliagas <linuxnow@gmail.com> - 0.4.3-1
- A control name holding a line break, a return or a tab no longer writes invalid
  Turtle: lilv refused the whole bundle (#51). The DEB of 0.4.2 was not
  published (lintian refused the unit's WantedBy); this is the first DEB with
  omx-modgui-sync's new search rule and the unit that follows plugin-qualify-sync.

* Wed Oct 28 2026 Pau Aliagas <linuxnow@gmail.com> - 0.4.2-1
- omx-modgui-sync reads the LV2 search list as plugin-hostd and plugin-qualify
  do ($LV2_PATH, else plugin-hostd's default), writes its bundles to
  /usr/local/lib/lv2 (~/.lv2 for a user; the folder may hold plugins too, and the
  bundles are named omx-modgui-<name>.lv2), and has --check: it says whether
  mod-host and mod-ui read the folder, and lists the CLAP search list (#44).
- The unit runs after plugin-qualify-sync once enabled, under CPU, memory and
  task limits. The Debian-only apt hook is gone.

* Tue Oct 27 2026 Pau Aliagas <linuxnow@gmail.com> - 0.4.1-1
- The DEB builds on Debian bookworm again: python3-lilv is no build dependency
  (bookworm has none); the omx-modgui-sync tests skip without it. The RPM is
  unchanged (#44).

* Tue Oct 27 2026 Pau Aliagas <linuxnow@gmail.com> - 0.4.0-1
- omx-modgui-sync, moved here from the Zynthian image: gives a generated MOD GUI to
  every LV2 plugin that ships none, into /var/lib/omx/modgui (standard directories,
  set in /etc/omx/modgui-sync.conf). The unit is installed, not enabled. A plugin
  that cannot get a GUI never fails the run (#44).

* Tue Oct 27 2026 Pau Aliagas <linuxnow@gmail.com> - 0.3.4-1
- The unit table is read from the contract data (param-units.json, installed by
  omx-plugins-contract) and not from the C header omx_param_contract.h, which
  only omx-plugins-devel ships: a runtime install lays out a control with a
  unit. omx-plugins-contract >= 0.15.0 is now required. $OMX_PARAM_CONTRACT_H
  is gone (#44).

* Tue Oct 27 2026 Pau Aliagas <linuxnow@gmail.com> - 0.3.3-1
- The MOD GUI's brand is the vendor, else the plugin name, else the file stem; a
  plugin that states no vendor is no longer refused (#44).
- `omx-panel modgui` exits 3, with one line and no stack trace, for a descriptor
  with no visible control (#44).

* Tue Oct 27 2026 Pau Aliagas <linuxnow@gmail.com> - 0.3.2-1
- A reader that stops early (head, grep -q) ends the output quietly: exit 0, no
  stack trace (#42).

* Tue Oct 27 2026 Pau Aliagas <linuxnow@gmail.com> - 0.3.1-1
- `omx-panel descriptors --installed` lists the installed descriptor files, one
  path per line (#37).

* Sun Oct 25 2026 Pau Aliagas <linuxnow@gmail.com> - 0.3.0-1
- The MOD GUI importer reads mod-ui's whole modgui:gui property list, refuses
  MODGUI_PORT_UNKNOWN and MODGUI_IMAGE_NOT_FOUND (ten refusal codes), and reads
  a template reference as mod-ui reads it (#33).

* Sun Oct 25 2026 Pau Aliagas <linuxnow@gmail.com> - 0.2.6-1
- A readout is drawn as a display, never looked up as a control input; 0.2.5
  stopped on a readout. The worked example, with its documents and examples.

* Sun Oct 25 2026 Pau Aliagas <linuxnow@gmail.com> - 0.2.5-1
- A man page for omx-panel; shipped declarations carry no shebang. 0.2.4
  shipped no DEB.

* Sun Oct 25 2026 Pau Aliagas <linuxnow@gmail.com> - 0.2.4-1
- The Debian package no longer carries the vendored modules' dotfiles; 0.2.3
  shipped no DEB.

* Sun Oct 25 2026 Pau Aliagas <linuxnow@gmail.com> - 0.2.3-1
- The Debian package depends on pkgconf, which the vocabulary reader runs;
  0.2.2 shipped no DEB either.

* Sun Oct 25 2026 Pau Aliagas <linuxnow@gmail.com> - 0.2.2-1
- The Debian build depends on node, npm and the dev packages its suite reads;
  0.2.1 shipped no DEB.

* Sun Oct 25 2026 Pau Aliagas <linuxnow@gmail.com> - 0.2.1-1
- The npm package is @openmixer/omx-panel; 0.2.0 named a scope that does not
  exist on the registry and never reached npm.

* Sun Oct 25 2026 Pau Aliagas <linuxnow@gmail.com> - 0.2.0-1
- The panel toolkit: the layout from a descriptor, the MOD GUI generator and
  its images, the omx look, the skin package at schema 1 with its facts, and
  the MOD GUI importer.
* Sat Oct 17 2026 Pau Aliagas <linuxnow@gmail.com> - 0.1.0-1
- First package: the skin package schema and the skins directory.
- The package was named omx-skins until 2026-10-25.
