# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# The panel renderer (docs/renderer.md): libomx-panel-render.a (static, PIC), its header, its pkg-config file and the
# omx-panel-render command. Needs a C11 compiler, cJSON (libcjson), the panel domain's codes header (../include/omxdomain/panel_codes.h,
# rendered from contract.d/panel by omx-contract render) and omx-dsp's meter view (omx-dsp-devel, pkg-config omxdsp). `make check` draws the fixtures and holds them to the golden images and to the MOD GUI
# face (node, the parent tree's `npm ci` and the installed vocabulary its layout reads).
#
#   make [-C renderer] [WINDOW=1] build/ : the library (static and shared), the command (and the window: pugl-devel,
#                                 nanovg-devel, GL)
#   make check                    the golden images and the parity with the MOD GUI face; with WINDOW=1 and a display
#                                 (xvfb-run make WINDOW=1 check) the window held to the buffer by structure too
#                                 (each test's scratch dir in TMPDIR is removed at exit; OMX_PANEL_KEEP_SCRATCH=1 keeps it)
#   make install PREFIX=... DESTDIR=...

PREFIX ?= /usr/local
LIBDIR ?= $(PREFIX)/lib
INCLUDEDIR ?= $(PREFIX)/include
BINDIR ?= $(PREFIX)/bin
DATADIR ?= $(PREFIX)/share
PKG_CONFIG ?= pkg-config
VERSION := $(shell sed -n 's/^  "version": "\(.*\)",$$/\1/p' ../package.json)

DEPS := libcjson
# The meter's view law is omx-dsp's (contract 7.9): the marker's hold and fall by elapsed time are omx_meter_view_step() of
# <omxdsp/mix/omx_meter_view.h> and its rate OMX_METER_VIEW_FALL_DB_PER_SECOND, header-only, from omx-dsp-devel
# (pkg-config omxdsp); no number of the law is copied here.
# -ffp-contract=off: a fused multiply-add rounds differently, and the drawing is held to the bit
CFLAGS ?= -O2 -g
CFLAGS += -std=c11 -D_DEFAULT_SOURCE -fPIC -ffp-contract=off -Wall -Wextra -Werror -Iinclude -I../include $(shell $(PKG_CONFIG) --cflags $(DEPS) omxdsp)
LDLIBS += $(shell $(PKG_CONFIG) --libs libcjson) -lm

B := build
LIB_OBJ := $(B)/view.o $(B)/input.o $(B)/gesture.o $(B)/raster.o $(B)/scene.o
# the shared library, for a surface that loads the renderer at run time (Zynthian's Tk panel, through ctypes): the same
# objects, the C API its only exported symbols. SOVERSION moves when the API breaks.
SOVERSION := 1
SONAME := libomx-panel-render.so.$(SOVERSION)

# WINDOW=1 adds the window (pugl and NanoVG on OpenGL): libomx-panel-window.a, its header and pkg-config file, and
# --window in the command. Off by default: the buffer path links no window system.
WINDOW ?= 0
# the ui library (omx_panel_ui.h): the view and the binding of a plugin's panel to its parameters, and, with WINDOW=1, the window under it.
# A plugin's CLAP and LV2 adapters load it at run time (dlopen), so its only exports are omx_panel_ui_* (src/ui-exports.map).
UI_SONAME := libomx-panel-ui.so.$(SOVERSION)
UI_CFLAGS :=
UI_LIBS :=
UI_OBJ := $(LIB_OBJ) $(B)/ui.o
UI_WINDOW_DRIVER :=
WINDOW_DEPS := pugl-0 pugl-gl-0 nanovg gl
ifeq ($(WINDOW),1)
CLI_CFLAGS := -DOMX_PANEL_WINDOW $(shell $(PKG_CONFIG) --cflags $(WINDOW_DEPS))
CLI_LIBS := $(B)/libomx-panel-window.a $(shell $(PKG_CONFIG) --libs $(WINDOW_DEPS))
WINDOW_TARGETS := $(B)/libomx-panel-window.a $(B)/omx-panel-window.pc
UI_CFLAGS := -DOMX_PANEL_WINDOW $(shell $(PKG_CONFIG) --cflags $(WINDOW_DEPS))
UI_LIBS := $(B)/libomx-panel-window.a $(shell $(PKG_CONFIG) --libs $(WINDOW_DEPS))
UI_WINDOW_DRIVER := $(B)/ui_window_driver
endif

.PHONY: all check install clean bench
all: $(B)/libomx-panel-render.a $(B)/$(SONAME) $(B)/omx-panel-render $(B)/omx-panel-render.pc $(WINDOW_TARGETS) $(B)/$(UI_SONAME) $(B)/omx-panel-ui.pc

$(B):
	mkdir -p $@
# omx-dsp, found before the view is compiled against its header
$(B)/omxdsp-version: FORCE | $(B)
	@$(PKG_CONFIG) --exists --print-errors omxdsp
	@$(PKG_CONFIG) --modversion omxdsp | cmp -s - $@ || $(PKG_CONFIG) --modversion omxdsp > $@
$(B)/%.o: src/%.c $(B)/omxdsp-version src/raster.h src/scene.h src/draw.h src/view.h src/look_roles.h src/gesture_words.h src/gesture.h include/omx_panel_render.h include/omx_panel_gesture.h | $(B)
	$(CC) $(CFLAGS) -c -o $@ $<
$(B)/libomx-panel-render.a: $(LIB_OBJ)
	$(AR) rcs $@ $^
$(B)/$(SONAME): $(LIB_OBJ) src/exports.map
	$(CC) $(LDFLAGS) -shared -Wl,-soname,$(SONAME) -Wl,--version-script=src/exports.map -o $@ $(LIB_OBJ) $(LDLIBS)
$(B)/ui.o: src/ui.c include/omx_panel_ui.h include/omx_panel_render.h include/omx_panel_window.h | $(B)
	$(CC) $(CFLAGS) $(UI_CFLAGS) -DOMX_PANEL_DATA_DIR='"$(DATADIR)/omx-panel/tools"' -c -o $@ $<
$(B)/ui.o: $(B)/window-option
# the ui library carries the renderer's objects inside, whatever its own exports: a surface that loads it needs no other file of ours
$(B)/$(UI_SONAME): $(UI_OBJ) src/ui-exports.map $(WINDOW_TARGETS)
	$(CC) $(LDFLAGS) -shared -Wl,-soname,$(UI_SONAME) -Wl,--version-script=src/ui-exports.map -o $@ $(UI_OBJ) $(UI_LIBS) $(LDLIBS)
$(B)/omx-panel-ui.pc: omx-panel-ui.pc.in | $(B)
	sed -e 's|@PREFIX@|$(PREFIX)|' -e 's|@LIBDIR@|$(LIBDIR)|' -e 's|@INCLUDEDIR@|$(INCLUDEDIR)|' -e 's|@VERSION@|$(VERSION)|' $< > $@
$(B)/window.o: src/window.c $(B)/omxdsp-version src/draw.h src/view.h src/raster.h include/omx_panel_render.h include/omx_panel_window.h | $(B)
	$(CC) $(CFLAGS) $(shell $(PKG_CONFIG) --cflags $(WINDOW_DEPS)) -c -o $@ $<
$(B)/libomx-panel-window.a: $(B)/window.o
	$(AR) rcs $@ $^
$(B)/omx-panel-render: $(B)/cli.o $(B)/libomx-panel-render.a $(WINDOW_TARGETS)
	$(CC) $(LDFLAGS) -o $@ $(B)/cli.o $(CLI_LIBS) $(B)/libomx-panel-render.a $(LDLIBS)
# the command is built anew when WINDOW changes: build/window-option holds the last one
$(B)/window-option: FORCE | $(B)
	@echo $(WINDOW) | cmp -s - $@ || echo $(WINDOW) > $@
$(B)/cli.o: CFLAGS += -DOMX_PANEL_DATA_DIR='"$(DATADIR)/omx-panel/tools"' $(CLI_CFLAGS)
$(B)/cli.o: $(B)/window-option
$(B)/omx-panel-window.pc: omx-panel-window.pc.in | $(B)
	sed -e 's|@PREFIX@|$(PREFIX)|' -e 's|@LIBDIR@|$(LIBDIR)|' -e 's|@INCLUDEDIR@|$(INCLUDEDIR)|' -e 's|@VERSION@|$(VERSION)|' $< > $@
.PHONY: FORCE
FORCE:
$(B)/omx-panel-render.pc: omx-panel-render.pc.in | $(B)
	sed -e 's|@PREFIX@|$(PREFIX)|' -e 's|@LIBDIR@|$(LIBDIR)|' -e 's|@INCLUDEDIR@|$(INCLUDEDIR)|' \
	    -e 's|@DATADIR@|$(DATADIR)|' -e 's|@VERSION@|$(VERSION)|' $< > $@

# the gesture unit's test driver (test/gesture_driver.c): runs cases through omx_gesture_run for test/gesture-c.test.mjs
$(B)/gesture_driver: test/gesture_driver.c $(B)/libomx-panel-render.a include/omx_panel_gesture.h | $(B)
	$(CC) $(CFLAGS) -o $@ $< $(B)/libomx-panel-render.a $(LDLIBS)

# the ui's test driver (test/ui_driver.c): the binding of a layout to parameters, headless, for test/ui.test.mjs
$(B)/ui_driver: test/ui_driver.c test/ui_case.h $(B)/ui.o $(B)/libomx-panel-render.a $(WINDOW_TARGETS) include/omx_panel_ui.h | $(B)
	$(CC) $(CFLAGS) -o $@ $< $(B)/ui.o $(B)/libomx-panel-render.a $(UI_LIBS) $(LDLIBS)

# the ui's window driver (test/ui_window_driver.c, WINDOW=1 only): opens the ui's window under a display, for test/ui-window.test.mjs
$(B)/ui_window_driver: test/ui_window_driver.c $(B)/ui.o $(B)/libomx-panel-render.a $(WINDOW_TARGETS) include/omx_panel_ui.h | $(B)
	$(CC) $(CFLAGS) -o $@ $< $(B)/ui.o $(B)/libomx-panel-render.a $(UI_LIBS) $(LDLIBS)

# the scene painter's test driver (test/scene_driver.c): paints a drawing of look.json for test/scene.test.mjs
$(B)/scene_driver: test/scene_driver.c $(B)/libomx-panel-render.a src/scene.h | $(B)
	$(CC) $(CFLAGS) -o $@ $< $(B)/libomx-panel-render.a $(LDLIBS)

# the cache's test driver (test/scene_cache_driver.c): the scene's static-layer cache against painting without it
$(B)/scene_cache_driver: test/scene_cache_driver.c $(B)/libomx-panel-render.a src/scene.h | $(B)
	$(CC) $(CFLAGS) -o $@ $< $(B)/libomx-panel-render.a $(LDLIBS)

check: all $(B)/gesture_driver $(B)/scene_driver $(B)/scene_cache_driver $(B)/ui_driver $(UI_WINDOW_DRIVER)
	node --test test/*.test.mjs

# the renderer's share of one drag frame, full draw against dirty draw, 1000 frames at 1024 x 416 (bench/dirty_frame.c):
#   make -C renderer bench DESC=<layout.json> [DATA=<tools dir>] [CONTROL=<symbol>]
DATA ?= ../tools
$(B)/dirty_frame: bench/dirty_frame.c $(B)/libomx-panel-render.a include/omx_panel_render.h | $(B)
	$(CC) $(CFLAGS) -o $@ $< $(B)/libomx-panel-render.a $(LDLIBS)
bench: $(B)/dirty_frame
	@test -n "$(DESC)" || { echo "make bench DESC=<layout.json>" >&2; exit 2; }
	$(B)/dirty_frame $(DESC) $(DATA) $(CONTROL)

install: all
	install -d $(DESTDIR)$(LIBDIR)/pkgconfig $(DESTDIR)$(INCLUDEDIR) $(DESTDIR)$(BINDIR)
	install -m 0644 $(B)/libomx-panel-render.a $(DESTDIR)$(LIBDIR)/
	install -m 0755 $(B)/$(SONAME) $(DESTDIR)$(LIBDIR)/
	ln -sf $(SONAME) $(DESTDIR)$(LIBDIR)/libomx-panel-render.so
	install -m 0644 include/omx_panel_render.h include/omx_panel_gesture.h $(DESTDIR)$(INCLUDEDIR)/
	install -m 0644 $(B)/omx-panel-render.pc $(DESTDIR)$(LIBDIR)/pkgconfig/
	install -m 0755 $(B)/omx-panel-render $(DESTDIR)$(BINDIR)/
ifeq ($(WINDOW),1)
	# the ui library is installed whole or not at all: its header and pkg-config file go with it (its package is omx-panel#187)
	install -m 0755 $(B)/$(UI_SONAME) $(DESTDIR)$(LIBDIR)/
	ln -sf $(UI_SONAME) $(DESTDIR)$(LIBDIR)/libomx-panel-ui.so
	install -m 0644 include/omx_panel_ui.h $(DESTDIR)$(INCLUDEDIR)/
	install -m 0644 $(B)/omx-panel-ui.pc $(DESTDIR)$(LIBDIR)/pkgconfig/
	install -m 0644 $(B)/libomx-panel-window.a $(DESTDIR)$(LIBDIR)/
	install -m 0644 include/omx_panel_window.h $(DESTDIR)$(INCLUDEDIR)/
	install -m 0644 $(B)/omx-panel-window.pc $(DESTDIR)$(LIBDIR)/pkgconfig/
endif

clean:
	rm -rf $(B)
