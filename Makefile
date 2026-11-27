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

.PHONY: base install-base all build check test spdx public-sources look copies gestures codes group-words install install-contract renderer renderer-check install-renderer test-host-reads store store-check install-store console-map shapes shapes-check install-python link-packaged

all: build

build:
	@test -n "$(VERSION)" || { echo "no version in package.json" >&2; exit 1; }
	@test -d node_modules || { echo "run npm ci first: the build needs typescript, the validator ajv" >&2; exit 1; }
	npm run -s build

# The example skin is valid against the schema, and look.json and the renderer's role list are what schema/look-roles.json gives.
check: build spdx public-sources look copies gestures codes group-words console-map shapes-check
	node dist/bin/omx-panel.mjs validate examples/skins/org.example.plate

test:
	npm test

# The tree reads the twins the channel installs, never the registry's copy npm ci fetched: node_modules/@openmixer/omx-dsp
# and node_modules/@openmixer/omx-contract become links to omx-dsp-wasm's and omx-contract's directories, as the installed
# package links them (install-base). A devel wave stages versions the registry has not got (npm publishes from a tag only).
link-packaged:
	@install -d node_modules/@openmixer; \
	for p in omx-dsp:$(DATADIR)/omx-dsp omx-contract:$(OMX_CONTRACT_LIB); do n=$${p%%:*}; d=$${p#*:}; \
	  test -f $$d/package.json || { echo "link-packaged: no $$n at $$d: install its package" >&2; exit 1; }; \
	  rm -rf node_modules/@openmixer/$$n; ln -sfn $$d node_modules/@openmixer/$$n; \
	  echo "link-packaged: @openmixer/$$n -> $$d ($$(node -p "require('$$d/package.json').version"))"; done

OPENMIXER_DOTGITHUB ?= ../openmixer-dotgithub

# Every file a comment can be written in opens with its licence and copyright: Open-Mixer/.github's spdx-check, from a
# checkout of it (OPENMIXER_DOTGITHUB, else ../openmixer-dotgithub); CI runs the action.
spdx:
	$(OPENMIXER_DOTGITHUB)/.github/actions/spdx-check/check.sh .

# No tracked file points into a private repository, branch, issue or path.
# Open-Mixer/.github's private-refs check, from a checkout of it (OPENMIXER_DOTGITHUB, else ../openmixer-dotgithub); CI
# runs it through the public-sources-check workflow. The check reads this repository's visibility and topics from GitHub
# first, with GH_TOKEN (or GITHUB_TOKEN); on a desk: GH_TOKEN=$$(gh auth token) make public-sources.
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

# docs/modgui.md's map table is what tools/look/console-map.json gives, printed by tools/console-map-render.mjs (#69).
console-map:
	node tools/console-map-render.mjs --check

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
# (omx-panel-render, libomx-panel-render1) and its header, .so link and pkg-config file (-devel, -dev): install-renderer
# installs those, never the static library or the command.
WINDOW ?= 0
renderer:
	$(MAKE) -C renderer WINDOW=$(WINDOW)

# The published reference: Open-Mixer/.github's docs-publish.yml runs this with DOCS_OUT, an empty absolute directory,
# then renders the Markdown and the man pages and, at a release tag, publishes the tree under
# https://www.openmixer.org/reference/omx-panel/<version>/. Only what the tree generates or keeps: the renderer's C API
# reference doxygen renders with the Doxyfile the documentation gate reads (api/), the design pages of docs/ with their
# shots, the man pages, README, BUILDING and LICENSE. The gate itself (doc-gate, against the base) is ci.yml's job docs.
.PHONY: docs-site
docs-site:
	@case "$(DOCS_OUT)" in /*) ;; *) echo "docs-site: FAIL - DOCS_OUT '$(DOCS_OUT)' is not an absolute directory: name the directory the reference is written to" >&2; exit 1;; esac
	rm -rf build/doxygen && mkdir -p build/doxygen
	doxygen Doxyfile
	@test -f build/doxygen/html/index.html || { echo "docs-site: FAIL - doxygen wrote no build/doxygen/html/index.html" >&2; exit 1; }
	mkdir -p $(DOCS_OUT)/api $(DOCS_OUT)/docs $(DOCS_OUT)/man
	cp -a build/doxygen/html/. $(DOCS_OUT)/api/
	cp README.md BUILDING.md LICENSE $(DOCS_OUT)/
	cp -a docs/. $(DOCS_OUT)/docs/
	rm -f $(DOCS_OUT)/docs/doxygen-baseline.txt $(DOCS_OUT)/docs/doxygen-version.txt
	cp man/*.1 $(DOCS_OUT)/man/

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
# The descriptions store's base (docs/descriptions-store.md 6, lane 5): base/inputs/ derived by omx-panel base and written
# by the store's command (built by make store) into base/build/panel.sqlite. The word checks read one contract directory:
# base/build/contract.d holds the installed domains (BASE_CONTRACTDIR, omx-contract's contractdir: plugin-db's among
# them) with this tree's panel domain in place of an installed one.
BASE_CONTRACTDIR ?= $(shell pkg-config --variable=contractdir omx-contract 2>/dev/null)
base: build store
	rm -rf base/build
	mkdir -p base/build/contract.d
	for d in $(BASE_CONTRACTDIR)/*; do [ "$${d##*/}" = panel ] || ln -s "$$d" base/build/contract.d/; done
	ln -s $(CURDIR)/contract.d/panel base/build/contract.d/panel
	PATH=$(CURDIR)/store/build:$$PATH OMX_CONTRACT_PATH=$(CURDIR)/base/build/contract.d node dist/bin/omx-panel.mjs base --in base/inputs --out base/build/panel.sqlite

# omx-panel-descriptions: the base, the one file
install-base:
	install -D -m 0644 base/build/panel.sqlite $(DESTDIR)$(DATADIR)/omx/panel/panel.sqlite

install-store:
	$(MAKE) -C store install PREFIX=$(PREFIX) LIBDIR=$(LIBDIR) INCLUDEDIR=$(INCLUDEDIR) BINDIR=$(BINDIR) DATADIR=$(DATADIR) MANDIR=$(MANDIR)

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

# The panel and gestures domains (docs/contract-domains.md), as they are, by omx-contract's one domain installer: the loader
# reads $(CONTRACTDIR)/panel/panel.json and its catalogs/, and $(CONTRACTDIR)/gestures/gestures.json.
install-contract:
	sh "$(OMX_CONTRACT_INSTALLER)" --domain contract.d/panel "$(DESTDIR)$(CONTRACTDIR)" omx-panel
	sh "$(OMX_CONTRACT_INSTALLER)" --domain contract.d/gestures "$(DESTDIR)$(CONTRACTDIR)" omx-panel
	# the panel domain's one codes header (omx-contract render), for C that tables the panel words by code (row V1)
	install -Dm 0644 include/omxdomain/panel_codes.h "$(DESTDIR)$(INCLUDEDIR)/omxdomain/panel_codes.h"

install: build install-contract
	install -d $(DESTDIR)$(PKGDIR) $(DESTDIR)$(BINDIR) $(DESTDIR)$(DATADIR)/omx/skins
	cp -R dist/. $(DESTDIR)$(PKGDIR)/
	# the panel domain is omx-panel-contract's, read from the contract directory: dist/'s copy is the tree's, never installed
	rm -rf $(DESTDIR)$(PKGDIR)/contract.d
	# the package.json of that tree: its exports and bin name the installed files, dist/ being the package directory itself
	node tools/installed-package-json.mjs package.json $(DESTDIR)$(PKGDIR)/package.json
	chmod 0644 $(DESTDIR)$(PKGDIR)/package.json
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
	install -m 0644 man/omx-panel-sync.1 $(DESTDIR)$(MANDIR)/man1/
	install -m 0755 bin/omx-modgui-sync $(DESTDIR)$(BINDIR)/
	install -m 0755 bin/omx-complement-sync $(DESTDIR)$(BINDIR)/
	install -m 0755 bin/omx-panel-sync $(DESTDIR)$(BINDIR)/
	install -d $(DESTDIR)$(UNITDIR) $(DESTDIR)$(SYSCONFDIR)/omx
	install -m 0644 systemd/omx-panel-sync.service $(DESTDIR)$(UNITDIR)/
	install -d $(DESTDIR)$(UNITDIR)/plugin-qualify-sync.service.d
	install -m 0644 systemd/plugin-qualify-sync.service.d/omx-panel-sync.conf $(DESTDIR)$(UNITDIR)/plugin-qualify-sync.service.d/
	install -m 0644 etc/omx/modgui-sync.conf $(DESTDIR)$(SYSCONFDIR)/omx/
