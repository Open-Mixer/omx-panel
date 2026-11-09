# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
"""The Tk leg of renderer/test/meter-surfaces.mjs: the meters band drawn on a Tk canvas from one recorded stream, each tick
grabbed from the X display as raw RGBA for the measuring side to read.

  python3 -I meter_tk.py <job.json> <out-dir>

job.json (written by meter-surfaces.mjs): the panel's size, each meter's frame (panel px at 1x), range and kind, the look's
colours, the stream's ticks, and the path of omx-dsp's view-law vectors. The marker is a Python copy of omx_meter_view_step,
read against omx-dsp's golden fall vectors before anything is drawn (contract 7.9: a copy of the law is held by omx-dsp's
vectors). Writes <out-dir>/tk-<k>.rgba per tick and <out-dir>/tk.json ({w, h, ticks}).
"""
import json
import os
import sys
import tkinter as tk

from PIL import ImageGrab


def view_step(state, fill, dt_s, fall_db_per_s, floor_db):
    """omx_meter_view_step (omx-dsp include/omxdsp/mix/omx_meter_view.h), state a dict {peak, elapsed}."""
    f = fill if fill > 0.0 else 0.0
    f = f if f < 1.0 else 1.0
    state["elapsed"] += dt_s if dt_s > 0.0 else 0.0
    m = state["peak"] - fall_db_per_s * state["elapsed"] / -floor_db
    if not m > f:
        m = f
        state["peak"] = f
        state["elapsed"] = 0.0
    return m


def check_vectors(path):
    """Every fall vector of omx-dsp's meter-view.json, at every draw rate, to 1e-12: the copy is the law."""
    v = json.load(open(path))
    law = v["law"]
    n = 0
    for c in v["cases"]:
        if c["set"] != "fall":
            continue
        st = {"peak": 0.0, "elapsed": 0.0}
        for k, want in enumerate(c["marker"]):
            got = view_step(st, 1.0 if k == 0 else c["live"], 0.0 if k == 0 else 1.0 / c["drawHz"], law["fallDbPerSecond"], law["floorDb"])
            if abs(got - want) > 1e-12:
                sys.exit(f"meter_tk: the Python copy differs from omx-dsp's fall vector at {c['drawHz']} Hz, tick {k}: {got} against {want}")
            n += 1
    if n == 0:
        sys.exit("meter_tk: no fall vector read")
    return n


def fraction(m, value):
    span = m["max"] - m["min"]
    f = (m["max"] - value) / span if m["gainReduction"] else (value - m["min"]) / span
    return min(1.0, max(0.0, f))


def main():
    job = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    checked = check_vectors(job["vectors"])
    fall = job["law"]["fallDbPerSecond"]
    col = job["colours"]
    root = tk.Tk()
    root.overrideredirect(True)
    root.geometry(f"{job['w']}x{job['h']}+0+0")
    cv = tk.Canvas(root, width=job["w"], height=job["h"], bg=col["surface"], highlightthickness=0, borderwidth=0)
    cv.place(x=0, y=0)
    band = job["band"]
    cv.create_rectangle(band["x"], band["y"], band["x"] + band["w"], band["y"] + band["h"], fill=col["section"], outline="")
    items = {}
    for m in job["meters"]:
        x, y, w, h = m["x"], m["y"], m["w"], m["h"]
        cv.create_rectangle(x, y, x + w, y + h, fill=col["rim"], outline="")
        cv.create_rectangle(x + 1, y + 1, x + w - 1, y + h - 1, fill=col["body"], outline="")
        bar = cv.create_rectangle(0, 0, 0, 0, fill=col["accent"], outline="", state="hidden")
        mark = cv.create_rectangle(0, 0, 0, 0, fill=col["ink"], outline="", state="hidden")
        items[m["symbol"]] = (bar, mark, {"peak": 0.0, "elapsed": 0.0})
    root.update()
    ox, oy = cv.winfo_rootx(), cv.winfo_rooty()
    for k, tick in enumerate(job["ticks"]):
        for m in job["meters"]:
            bar, mark, st = items[m["symbol"]]
            x, y, w, h = m["x"], m["y"], m["w"], m["h"]
            inner = w - 4
            f = fraction(m, tick["values"][m["symbol"]])
            mk = view_step(st, f, tick["elapsed"], fall, -(m["max"] - m["min"]))
            if f > 0:
                cv.coords(bar, x + 2, y + h - 6, x + 2 + inner * f, y + h - 2)
                cv.itemconfigure(bar, state="normal")
            else:
                cv.itemconfigure(bar, state="hidden")
            left = x + 2 + max(0.0, inner * mk - 2)
            cv.coords(mark, left, y + h - 7, left + 2, y + h - 1)
            cv.itemconfigure(mark, state="normal")
        root.update_idletasks()
        root.update()
        img = ImageGrab.grab(bbox=(ox, oy, ox + job["w"], oy + job["h"]), xdisplay=os.environ.get("DISPLAY"))
        open(os.path.join(out, f"tk-{k}.rgba"), "wb").write(img.convert("RGBA").tobytes())
    json.dump({"w": job["w"], "h": job["h"], "ticks": len(job["ticks"]), "vectorsChecked": checked}, open(os.path.join(out, "tk.json"), "w"))
    root.destroy()


if __name__ == "__main__":
    main()
