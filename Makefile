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
SYSCONFDIR ?= /etc
UNITDIR ?= $(PREFIX)/lib/systemd/system
PKGDIR = $(DATADIR)/omx-panel
VERSION := $(shell sed -n 's/^  "version": "\(.*\)",$$/\1/p' package.json)

.PHONY: all build check test spdx public-sources look copies install renderer renderer-check install-renderer test-host-reads shapes shapes-check install-python

all: build

build:
	@test -n "$(VERSION)" || { echo "no version in package.json" >&2; exit 1; }
	@test -d node_modules || { echo "run npm ci first: the build needs typescript, the validator ajv" >&2; exit 1; }
	npm run -s build

# The example skin is valid against the schema, and look.json and the renderer's role list are what schema/look-roles.json gives.
check: build spdx public-sources look copies shapes-check
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

# The document shapes (docs/shapes.md): shapes/<name>.schema.json rendered to a TypeScript interface set and to Python
# TypedDicts by omx-contract's own `render --shapes` and its two pinned generators, never written by hand. The renders are
# COMMITTED (test/golden/ts/shapes, share/omx-panel); a consumer reads them and runs no generator. `make shapes` writes them,
# `make shapes-check` holds the committed files to a fresh render byte for byte (CI runs it). The generators run from an
# omx-contract tree (OMX_CONTRACT_TREE, default ../omx-contract) with its `npm ci` done and `pip install -r
# tools/shapes-requirements.txt` (or OMX_DATAMODEL_CODEGEN naming the command).
OMX_CONTRACT_TREE ?= ../omx-contract
SHAPES_RENDER = node $(OMX_CONTRACT_TREE)/bin/omx-contract.mjs render --shapes --shapes-dir $(CURDIR)/shapes
shapes:
	$(SHAPES_RENDER) --target ts --out test/golden/ts
	$(SHAPES_RENDER) --target py --out share/omx-panel

shapes-check:
	$(SHAPES_RENDER) --target ts --out test/golden/ts --check
	$(SHAPES_RENDER) --target py --out share/omx-panel --check

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

install-renderer:
	$(MAKE) -C renderer install WINDOW=0 PREFIX=$(PREFIX) LIBDIR=$(LIBDIR) INCLUDEDIR=$(INCLUDEDIR) BINDIR=$(BINDIR) DATADIR=$(DATADIR)
	rm -f $(DESTDIR)$(LIBDIR)/libomx-panel-render.a $(DESTDIR)$(BINDIR)/omx-panel-render

# The Python shapes as the package omx_panel (omx_panel.shapes.<name>, docs/shapes.md): the files share/omx-panel/ holds,
# installed under PYTHONDIR, where this python3 keeps pure modules under PREFIX; a package build names its own (the spec's
# python3_sitelib, Debian's dist-packages)
PYTHONDIR = $(shell python3 -c 'import sysconfig; print(sysconfig.get_path("purelib", vars={"base": "$(PREFIX)"}))')

install-python:
	install -d $(DESTDIR)$(PYTHONDIR)/omx_panel/shapes
	install -m 0644 python/omx_panel/__init__.py $(DESTDIR)$(PYTHONDIR)/omx_panel/__init__.py
	install -m 0644 python/omx_panel/shapes/__init__.py $(DESTDIR)$(PYTHONDIR)/omx_panel/shapes/__init__.py
	for f in share/omx-panel/omx_contract_*_shape.py; do n=$$(basename "$$f" _shape.py | sed 's/^omx_contract_//'); install -m 0644 "$$f" $(DESTDIR)$(PYTHONDIR)/omx_panel/shapes/$$n.py || exit 1; done

install: build
	install -d $(DESTDIR)$(PKGDIR) $(DESTDIR)$(BINDIR) $(DESTDIR)$(DATADIR)/omx/skins
	cp -R dist/. $(DESTDIR)$(PKGDIR)/
	install -m 0644 package.json $(DESTDIR)$(PKGDIR)/
	# the runtime modules only (ajv and what it needs), never the build's
	for m in $$(npm ls --omit=dev --all --parseable | tail -n +2); do \
	  rel=$${m#$(CURDIR)/}; install -d $(DESTDIR)$(PKGDIR)/$$(dirname $$rel); cp -R $$m $(DESTDIR)$(PKGDIR)/$$rel; \
	done
	# their pages are theirs, not the package's: the package's one page is its README
	if [ -d $(DESTDIR)$(PKGDIR)/node_modules ]; then find $(DESTDIR)$(PKGDIR)/node_modules -type f -iname '*.md' -delete; fi
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
