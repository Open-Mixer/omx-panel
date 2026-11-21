# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# The build is npm's (`npm ci` first): `make` runs tsc and the copy step into dist/, the tree a release installs.
# `make test` is the node suite over it, `make check` the checks that read the tree itself. `make install` puts dist/,
# package.json and the runtime node modules under $(DATADIR)/omx-panel (OMX_PANEL for a caller), the omx-panel command
# in $(BINDIR), and the empty skins directory.

PREFIX ?= /usr/local
BINDIR ?= $(PREFIX)/bin
DATADIR ?= $(PREFIX)/share
MANDIR ?= $(DATADIR)/man
LIBDIR ?= $(PREFIX)/lib
INCLUDEDIR ?= $(PREFIX)/include
CONTRACTDIR ?= $(DATADIR)/omx-contract/contract.d
# omx-contract's domain installer (install-contract-dir.sh --domain), which installs the panel domain as it is
OMX_CONTRACT_INSTALLER ?= $(shell pkg-config --variable=datadir omx-contract 2>/dev/null)/install-contract-dir.sh
SYSCONFDIR ?= /etc
UNITDIR ?= $(PREFIX)/lib/systemd/system
PKGDIR = $(DATADIR)/omx-panel
# the omx-contract package's importable tree (package.json, lib/entry.mjs): the installed tools import
# @openmixer/omx-contract/entry through a link to it
OMX_CONTRACT_LIB ?= $(PREFIX)/lib/omx-contract
VERSION := $(shell sed -n 's/^  "version": "\(.*\)",$$/\1/p' package.json)

.PHONY: all build check test spdx public-sources look copies gestures codes group-words install install-contract renderer renderer-check install-renderer test-host-reads store store-check install-store

all: build

build:
	@test -n "$(VERSION)" || { echo "no version in package.json" >&2; exit 1; }
	@test -d node_modules || { echo "run npm ci first: the build needs typescript, the validator ajv" >&2; exit 1; }
	npm run -s build

# The example skin is valid against the schema, and look.json and the renderer's role list are what schema/look-roles.json gives.
check: build spdx public-sources look copies gestures codes group-words
	node dist/bin/omx-panel.mjs validate examples/skins/org.example.plate

test:
	npm test

OPENMIXER_DOTGITHUB ?= ../openmixer-dotgithub

# Every file a comment can be written in opens with its licence and copyright: Open-Mixer/.github's spdx-check, from a
# checkout of it (OPENMIXER_DOTGITHUB, else ../openmixer-dotgithub); CI runs the action.
spdx:
	$(OPENMIXER_DOTGITHUB)/.github/actions/spdx-check/check.sh .

# No tracked file points into a private repository, branch, issue or path.
# Open-Mixer/.github's private-refs check, from a checkout of it (OPENMIXER_DOTGITHUB, else ../openmixer-dotgithub); CI
# runs it through the public-sources-check workflow.
public-sources:
	$(OPENMIXER_DOTGITHUB)/.github/actions/private-refs-check/check.sh .

look:
	node tools/look.mjs --check
	node tools/look-pin.mjs --self

# schema/gestures.json is what the gestures domain gives (docs/contract-domains.md), byte for byte.
gestures:
	node tools/gestures-render.mjs --check

# schema/codes.json and catalogs/<lang>.json are what the panel domain gives (tools/codes-render.mjs), byte for byte.
codes:
	node tools/codes-render.mjs --check

# tools/group-words.mjs (the words group-infer reads, a browser module) is what the panel and lv2 domains give, byte for byte.
group-words:
	node tools/group-words-render.mjs --check

# No tracked file is a copy of a film strip or a fixture omx-panel ships, with the check's own sabotage arms.
copies:
	node tools/copies-check.mjs --self-test
	node tools/copies-check.mjs .

# The panel renderer, C (docs/renderer.md): its own Makefile. Its check reads the built tree, so `make` first. WINDOW=1
# adds the window (pugl, NanoVG); its tests want a display (xvfb-run). The packages ship the shared library alone
# (omx-panel-render, libomx-panel-render0) and its header, .so link and pkg-config file (-devel, -dev): install-renderer
# installs those, never the static library or the command.
WINDOW ?= 0
renderer:
	$(MAKE) -C renderer WINDOW=$(WINDOW)

# run in a private TMPDIR and fail on any scratch directory the tests leave there (#45)
# the role vocabulary the layout reads: this tree's stand-in, as npm test reads it, unless the caller names one (docs/renderer.md)
renderer-check: build
	OMX_ROLE_MEANINGS="$${OMX_ROLE_MEANINGS:-$(CURDIR)/test/fixtures/role-meanings/panel-roles.json}" \
	  sh tools/renderer-scratch-check.sh $(MAKE) -C renderer check WINDOW=$(WINDOW)

# a host that is not JavaScript reads the gesture word names and the compare values from what the panel ships (#23):
# the shared library and the command of this tree, or an installed package's (OMX_PANEL_RENDER_LIB, OMX_PANEL)
test-host-reads: build renderer
	python3 test/host_reads.py

# The descriptions store's reader and writer, C (docs/descriptions-store.md): its own Makefile (needs sqlite-devel 3.38 or above,
# cjson-devel and omx-contract's libomx-domain-devel). store-check builds it, runs its tests and the Python door's over the
# built tree: the tests build their fixtures with node 22's SQLite, and the golden of the rules version reads the built dist/.
store:
	$(MAKE) -C store

store-check: build store
	$(MAKE) -C store check
	python3 store/test/door.py

# The packages ship the store (omx-panel-store and -devel; libomx-panel-store0, libomx-panel-store-dev and the command's
# omx-panel-store): store/'s install, all of it: the library, its .so link, header and pkg-config file, the command and
# its page, and the DDL as $(DATADIR)/omx-panel-store/panel.sql. Never the static library: it is not installed.
install-store:
	$(MAKE) -C store install PREFIX=$(PREFIX) LIBDIR=$(LIBDIR) INCLUDEDIR=$(INCLUDEDIR) BINDIR=$(BINDIR) DATADIR=$(DATADIR) MANDIR=$(MANDIR)

install-renderer:
	$(MAKE) -C renderer install WINDOW=0 PREFIX=$(PREFIX) LIBDIR=$(LIBDIR) INCLUDEDIR=$(INCLUDEDIR) BINDIR=$(BINDIR) DATADIR=$(DATADIR)
	rm -f $(DESTDIR)$(LIBDIR)/libomx-panel-render.a $(DESTDIR)$(BINDIR)/omx-panel-render

# The panel and gestures domains (docs/contract-domains.md), as they are, by omx-contract's one domain installer: the loader
# reads $(CONTRACTDIR)/panel/panel.json and its catalogs/, and $(CONTRACTDIR)/gestures/gestures.json.
install-contract:
	sh "$(OMX_CONTRACT_INSTALLER)" --domain contract.d/panel "$(DESTDIR)$(CONTRACTDIR)"
	sh "$(OMX_CONTRACT_INSTALLER)" --domain contract.d/gestures "$(DESTDIR)$(CONTRACTDIR)"
	# the panel domain's one codes header (omx-contract render), for C that tables the panel words by code (row V1)
	install -Dm 0644 include/omxdomain/panel_codes.h "$(DESTDIR)$(INCLUDEDIR)/omxdomain/panel_codes.h"

install: build install-contract
	install -d $(DESTDIR)$(PKGDIR) $(DESTDIR)$(BINDIR) $(DESTDIR)$(DATADIR)/omx/skins
	cp -R dist/. $(DESTDIR)$(PKGDIR)/
	# the panel domain is omx-panel-contract's, read from the contract directory: dist/'s copy is the tree's, never installed
	rm -rf $(DESTDIR)$(PKGDIR)/contract.d
	install -m 0644 package.json $(DESTDIR)$(PKGDIR)/
	# the runtime modules only (ajv and what it needs), never the build's
	for m in $$(npm ls --omit=dev --all --parseable | tail -n +2); do \
	  rel=$${m#$(CURDIR)/}; [ "$$rel" = node_modules/@openmixer/omx-dsp ] && continue; install -d $(DESTDIR)$(PKGDIR)/$$(dirname $$rel); cp -R $$m $(DESTDIR)$(PKGDIR)/$$rel; \
	done
	# their pages are theirs, not the package's: the package's one page is its README
	if [ -d $(DESTDIR)$(PKGDIR)/node_modules ]; then find $(DESTDIR)$(PKGDIR)/node_modules -type f -iname '*.md' -delete; fi
	# omx-dsp is the omx-dsp-wasm package's: its dist/ and wasm/ are linked, never copied
	install -d $(DESTDIR)$(PKGDIR)/node_modules/@openmixer
	ln -sfn $(DATADIR)/omx-dsp $(DESTDIR)$(PKGDIR)/node_modules/@openmixer/omx-dsp
	# omx-contract is the omx-contract package's: the tools' isMain (@openmixer/omx-contract/entry) is linked, never copied
	ln -sfn $(OMX_CONTRACT_LIB) $(DESTDIR)$(PKGDIR)/node_modules/@openmixer/omx-contract
	ln -sf ../share/omx-panel/bin/omx-panel.mjs $(DESTDIR)$(BINDIR)/omx-panel
	install -d $(DESTDIR)$(MANDIR)/man1
	install -m 0644 man/omx-panel.1 $(DESTDIR)$(MANDIR)/man1/
	install -m 0644 man/omx-modgui-sync.1 $(DESTDIR)$(MANDIR)/man1/
	install -m 0644 man/omx-complement-sync.1 $(DESTDIR)$(MANDIR)/man1/
	install -m 0755 bin/omx-modgui-sync $(DESTDIR)$(BINDIR)/
	install -m 0755 bin/omx-complement-sync $(DESTDIR)$(BINDIR)/
	install -d $(DESTDIR)$(UNITDIR) $(DESTDIR)$(SYSCONFDIR)/omx
	install -m 0644 systemd/omx-modgui-sync.service $(DESTDIR)$(UNITDIR)/
	install -m 0644 systemd/omx-complement-sync.service $(DESTDIR)$(UNITDIR)/
	install -d $(DESTDIR)$(UNITDIR)/plugin-qualify-sync.service.d
	install -m 0644 systemd/plugin-qualify-sync.service.d/omx-modgui-sync.conf $(DESTDIR)$(UNITDIR)/plugin-qualify-sync.service.d/
	install -m 0644 systemd/plugin-qualify-sync.service.d/omx-complement-sync.conf $(DESTDIR)$(UNITDIR)/plugin-qualify-sync.service.d/
	install -m 0644 etc/omx/modgui-sync.conf $(DESTDIR)$(SYSCONFDIR)/omx/
