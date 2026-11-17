/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 */
/**
 * @file omx_panel_gesture.h
 * @brief The one gesture vocabulary of OpenMixer panels, as one C implementation behind three calls.
 *
 * Every surface moves a panel's controls with the gestures docs/panel-gestures.md and schema/gestures.json declare: drag past
 * 10 px, fine at 0.3, step (the declared step, else 1% of the travel; coarse is 5 steps), second (a handle's Q: pinch, encoder 3,
 * wheel, Shift with the arrows), reset to the declared default, more and select (never a value), toggle on release inside, and
 * painting across a bar group with one gesture id per sweep. Ownership is refused as `GESTURE_CONTROL_OWNED`, a read-only control
 * as `GESTURE_READ_ONLY`, a reset with no declared default as `GESTURE_NO_DEFAULT`. Each value is in the control's own unit.
 *
 * The calls take and answer JSON text and no struct crosses the boundary, so a runtime binds three functions. The declaration is
 * the text of schema/gestures.json; every timing, threshold and table cell is read from it and none is kept here. A caller that
 * holds a gesture in flight runs the whole script again on each event: a run starts from the control as given and nothing
 * carries from one run to the next.
 *
 * The control is the one tools/gestures.mjs's `runGesture` takes: `{widget, min, max, def, scale, step, integer, value,
 * readOnly, hold, section, orientation, travelPx, target: {x, y, w, h}}` for a knob, fader, switch, selector or xy; a handle is
 * `{widget: "handle", target, plot: {w, h}, freq, gain, q}` with each of the three a member (`min`, `max`, `def`, `scale`, `step`,
 * `integer`, `value`); a bar group is `{widget: "bar", selected, bars: [{symbol, min, max, def, value, target}]}`. A member
 * starts at its `value`, else its `def`, else its `min`; a `scale` of `"log"` is a logarithmic travel, a `step` the declared step.
 * The events are `{t, type: "down" | "move" | "up", id, ptype: "touch" | "mouse" | "pen" | "fader", x, y, fine}`,
 * `{t, type: "wheel" | "detent", n, coarse, encoder, bar}` and `{t, type: "key", key, shift, bar}` (`key` is `"Backspace"` or an
 * arrow). The settings are `{timings: {longPressMs, doubleTapMs, palmGuardMs, safetyHoldMs, claimMs}, paintWithMouse,
 * paintWithTouch}`; a safety hold below the declared floor is refused.
 *
 * The answer is `{value, gestures: [{id, word, input, begin, end, changes, fine, shown}], gesture, begin, end, undo, selected,
 * refused: [{code, t, why}], cancelled: [{t, why}]}`: `value` a number for a single control, `{freq, gain, q}` for a handle,
 * `{symbol: value}` for a bar group, `gesture` the last of `gestures`, `undo` the ids of the gestures that changed a value, one
 * undo entry each. A refused setting or a control or script that cannot be read answers `{"error": {"code", "why"}}` instead.
 *
 * Nothing here is thread-safe on one context; two contexts share nothing.
 */
#ifndef OMX_PANEL_GESTURE_H
#define OMX_PANEL_GESTURE_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/** A context: the declaration and the surface's settings, which every run is held to. Opaque. */
typedef struct omx_gesture omx_gesture_t;

/**
 * Open a context.
 *
 * The settings are checked here against the declaration, as `timingsOf` does: an unknown timing, a time not above zero, a safety
 * hold below the declared floor (`GESTURE_HOLD_BELOW_FLOOR`) or `paintWithTouch` false (`GESTURE_PAINT_REQUIRED_ON_TOUCH`) is
 * not refused by a NULL return but answered by every run of the context as an `error`, the way the reference throws at its run.
 *
 * @param gestures_json  The text of schema/gestures.json.
 * @param settings_json  The surface's settings as JSON text, or NULL or "" for the declared defaults.
 * @return The context, or NULL when the declaration cannot be read or memory is short. Free it with omx_gesture_close().
 */
omx_gesture_t *omx_gesture_open(const char *gestures_json, const char *settings_json);

/**
 * Run a script of events against one control and answer what came of it, as JSON text.
 *
 * Scripts are in time order (a stable sort by `t` is applied). The answer is written into `answer` as a NUL-terminated string,
 * cut at `cap` - 1 bytes when it does not fit.
 *
 * @param ctx           A context from omx_gesture_open().
 * @param control_json  The control, as JSON text.
 * @param events_json   The events, a JSON array.
 * @param answer        Where the answer goes; may be NULL to ask only how long it is.
 * @param cap           The size of `answer` in bytes.
 * @return The length of the whole answer in bytes, not counting the NUL: a value of `cap` or more says it was cut. 0 for a NULL context.
 */
size_t omx_gesture_run(omx_gesture_t *ctx, const char *control_json, const char *events_json, char *answer, size_t cap);

/**
 * Free a context.
 *
 * @param ctx  A context from omx_gesture_open(); NULL is nothing.
 */
void omx_gesture_close(omx_gesture_t *ctx);

#ifdef __cplusplus
}
#endif

#endif
