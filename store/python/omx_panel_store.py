# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
"""The descriptions store for Python: ctypes on libomx-panel-store.so.0 (docs/descriptions-store.md, section 5). It holds
no rule: the merge, the staleness, the words and the refusals are the library's, and a refusal is a StoreError carrying
its code. Not for a real-time path. OMX_PANEL_STORE_LIB names another library (a checkout's); the library is otherwise
found by its soname."""
import ctypes
import os

OK, NO_ENTRY = 0, 1
SCOPE_USER, SCOPE_SYSTEM = 0, 1


class StoreError(Exception):
    def __init__(self, code, message):
        super().__init__("%s %s" % (code, message))
        self.code, self.message = code, message


class _Error(ctypes.Structure):
    _fields_ = [("code", ctypes.c_char_p), ("message", ctypes.c_char * 256)]


class _Key(ctypes.Structure):
    _fields_ = [("sha256", ctypes.c_char_p), ("format", ctypes.c_char_p), ("uri", ctypes.c_char_p)]


class _Group(ctypes.Structure):
    _fields_ = [("symbol", ctypes.c_char_p), ("name", ctypes.c_char_p), ("rule", ctypes.c_char_p),
                ("display_priority", ctypes.c_long), ("declared", ctypes.c_int),
                ("ports", ctypes.POINTER(ctypes.c_char_p)), ("nports", ctypes.c_size_t)]


class _Control(ctypes.Structure):
    _fields_ = [("symbol", ctypes.c_char_p), ("key", ctypes.c_char_p), ("id", ctypes.c_char_p),
                ("group_key", ctypes.c_char_p), ("governed", ctypes.c_int)]


class _Entry(ctypes.Structure):
    _fields_ = [("layer", ctypes.c_char_p), ("stale_edit_layer", ctypes.c_char_p), ("edited", ctypes.c_int),
                ("made_by", ctypes.c_char_p), ("family", ctypes.c_char_p), ("fingerprint", ctypes.c_char_p),
                ("body", ctypes.c_char_p), ("repeated_groups", ctypes.c_char_p), ("refused", ctypes.c_char_p),
                ("group_outcome", ctypes.c_char_p), ("group_reason", ctypes.c_char_p),
                ("groups", ctypes.POINTER(_Group)), ("ngroups", ctypes.c_size_t),
                ("controls", ctypes.POINTER(_Control)), ("ncontrols", ctypes.c_size_t)]


def _text(b):
    return None if b is None else b.decode()


def _load():
    lib = ctypes.CDLL(os.environ.get("OMX_PANEL_STORE_LIB") or "libomx-panel-store.so.0")
    vp, cp = ctypes.c_void_p, ctypes.c_char_p
    lib.omx_panel_store_open.argtypes = [ctypes.c_int, ctypes.POINTER(vp), ctypes.POINTER(_Error)]
    lib.omx_panel_store_open_at.argtypes = [cp, cp, cp, cp, ctypes.POINTER(vp), ctypes.POINTER(_Error)]
    lib.omx_panel_store_writer_open.argtypes = [ctypes.POINTER(vp), ctypes.POINTER(_Error)]
    lib.omx_panel_store_close.argtypes = [vp]
    lib.omx_panel_store_close.restype = None
    lib.omx_panel_store_get.argtypes = [vp, ctypes.POINTER(_Key), cp, ctypes.POINTER(_Entry)]
    lib.omx_panel_store_message.argtypes = [vp]
    lib.omx_panel_store_message.restype = cp
    lib.omx_panel_store_code.argtypes = [ctypes.c_int]
    lib.omx_panel_store_code.restype = cp
    lib.omx_panel_store_put.argtypes = [vp, ctypes.POINTER(_Key), cp, ctypes.POINTER(_Error)]
    lib.omx_panel_store_remove.argtypes = [vp, ctypes.POINTER(_Key), ctypes.POINTER(_Error)]
    lib.omx_panel_store_source.argtypes = [cp, cp, ctypes.c_char * 65]
    return lib


_lib = None


def _l():
    global _lib
    if _lib is None:
        _lib = _load()
    return _lib


def source(fmt, path):
    """The SHA-256 of a plugin's derivation input as installed (3.6): the library's one function."""
    out = (ctypes.c_char * 65)()
    if _l().omx_panel_store_source(fmt.encode(), os.fsencode(path), out) != 0:
        raise StoreError("panel-store.unreadable", "no source can be made of %s as %s" % (path, fmt))
    return out.value.decode()


class Store:
    """An opened store (the reader) or a writer's layer; close() or `with`."""

    def __init__(self, handle):
        self._h = handle

    @classmethod
    def _opened(cls, call, *args):
        h, err = ctypes.c_void_p(), _Error()
        rc = call(*args, ctypes.byref(h), ctypes.byref(err))
        if rc:
            raise StoreError(err.code.decode() if err.code else "panel-store.error", err.message.decode())
        return cls(h)

    @classmethod
    def open(cls, scope=SCOPE_USER):
        """Production: the installed places; no path and no environment variable."""
        return cls._opened(_l().omx_panel_store_open, scope)

    @classmethod
    def open_at(cls, base, system=None, user=None, contract_dir=None):
        """TEST AND COMMAND ONLY."""
        enc = lambda p: None if p is None else os.fsencode(p)
        return cls._opened(_l().omx_panel_store_open_at, enc(base), enc(system), enc(user), enc(contract_dir))

    @classmethod
    def writer(cls):
        """The layer of the effective uid."""
        return cls._opened(_l().omx_panel_store_writer_open)

    def close(self):
        if self._h:
            _l().omx_panel_store_close(self._h)
            self._h = None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()

    def get(self, sha256, fmt, uri, src):
        """The entry as a dict, or None when no layer holds the key (or every entry of it is stale). The strings are copied."""
        e, k = _Entry(), _Key(sha256.encode(), fmt.encode(), uri.encode())
        rc = _l().omx_panel_store_get(self._h, ctypes.byref(k), src.encode(), ctypes.byref(e))
        if rc == NO_ENTRY:
            return None
        if rc:
            raise StoreError(_text(_l().omx_panel_store_code(rc)) or "panel-store.error", _text(_l().omx_panel_store_message(self._h)) or "")
        groups = [{"symbol": _text(g.symbol), "name": _text(g.name), "rule": _text(g.rule), "display_priority": g.display_priority,
                   "declared": g.declared, "ports": [_text(g.ports[j]) for j in range(g.nports)]} for g in (e.groups[i] for i in range(e.ngroups))]
        controls = [{"symbol": _text(c.symbol), "key": _text(c.key), "id": _text(c.id), "group_key": _text(c.group_key), "governed": c.governed}
                    for c in (e.controls[i] for i in range(e.ncontrols))]
        return {"layer": _text(e.layer), "stale_edit_layer": _text(e.stale_edit_layer), "edited": e.edited, "made_by": _text(e.made_by),
                "family": _text(e.family), "fingerprint": _text(e.fingerprint), "body": _text(e.body), "repeated_groups": _text(e.repeated_groups),
                "refused": _text(e.refused), "group_outcome": _text(e.group_outcome), "group_reason": _text(e.group_reason),
                "groups": groups, "controls": controls}

    def put(self, sha256, fmt, uri, entry_json):
        err = _Error()
        k = _Key(sha256.encode(), fmt.encode(), uri.encode())
        if _l().omx_panel_store_put(self._h, ctypes.byref(k), entry_json.encode(), ctypes.byref(err)):
            raise StoreError(err.code.decode(), err.message.decode())

    def remove(self, sha256, fmt, uri):
        err = _Error()
        k = _Key(sha256.encode(), fmt.encode(), uri.encode())
        if _l().omx_panel_store_remove(self._h, ctypes.byref(k), ctypes.byref(err)):
            raise StoreError(err.code.decode(), err.message.decode())
