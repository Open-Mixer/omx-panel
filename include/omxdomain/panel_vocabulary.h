// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#ifndef PANEL_VOCABULARY_H
#define PANEL_VOCABULARY_H
/*
 * GENERATED: DO NOT EDIT BY HAND.
 * Produced by `omx-contract render --target c` from Open-Mixer/panel's data/: the vocabulary
 * (docs/data-layout.md). A code is OMX_ and the code in upper snake case, and a reply code that carries a resp has it as that name and _RESP; a word is OMX_<ITEM>_<NAME>, each words
 * item with its _COUNT and an _INIT of its words in their order. A consumer writes and compares these, never a
 * literal of its own.
 */

/** @file
 * @brief The vocabulary of panel: every code and every word as a string define, with its sentence
 * where it carries one. */

/* PANEL_FAMILIES (panel/panel.json) */
#define OMX_PANEL_FAMILIES_NONE "none" ///< a plugin with no family: its panel is laid out from its groups and roles
/** The source sentence (English) of OMX_PANEL_FAMILIES_NONE. */
#define OMX_PANEL_FAMILIES_NONE_TEXT_EN "A plugin with no family: its panel is laid out from its groups and its roles."
#define OMX_PANEL_FAMILIES_GATE "gate" ///< a gate or expander
/** The source sentence (English) of OMX_PANEL_FAMILIES_GATE. */
#define OMX_PANEL_FAMILIES_GATE_TEXT_EN "A gate's or an expander's panel family."
#define OMX_PANEL_FAMILIES_DYNAMICS "dynamics" ///< a compressor
/** The source sentence (English) of OMX_PANEL_FAMILIES_DYNAMICS. */
#define OMX_PANEL_FAMILIES_DYNAMICS_TEXT_EN "A compressor's panel family."
#define OMX_PANEL_FAMILIES_LIMITER "limiter" ///< a limiter
/** The source sentence (English) of OMX_PANEL_FAMILIES_LIMITER. */
#define OMX_PANEL_FAMILIES_LIMITER_TEXT_EN "A limiter's panel family."
#define OMX_PANEL_FAMILIES_DEESSER "deesser" ///< a de-esser
/** The source sentence (English) of OMX_PANEL_FAMILIES_DEESSER. */
#define OMX_PANEL_FAMILIES_DEESSER_TEXT_EN "A de-esser's panel family."
#define OMX_PANEL_FAMILIES_EQ "eq" ///< an equaliser, parametric or graphic
/** The source sentence (English) of OMX_PANEL_FAMILIES_EQ. */
#define OMX_PANEL_FAMILIES_EQ_TEXT_EN "An equaliser's panel family, parametric or graphic."
#define OMX_PANEL_FAMILIES_FILTER "filter" ///< a filter
/** The source sentence (English) of OMX_PANEL_FAMILIES_FILTER. */
#define OMX_PANEL_FAMILIES_FILTER_TEXT_EN "A filter's panel family."
#define OMX_PANEL_FAMILIES_DRIVE "drive" ///< a saturator or distortion
/** The source sentence (English) of OMX_PANEL_FAMILIES_DRIVE. */
#define OMX_PANEL_FAMILIES_DRIVE_TEXT_EN "A saturator's or a distortion's panel family."
#define OMX_PANEL_FAMILIES_MODULATION "modulation" ///< a chorus, flanger, phaser or tremolo
/** The source sentence (English) of OMX_PANEL_FAMILIES_MODULATION. */
#define OMX_PANEL_FAMILIES_MODULATION_TEXT_EN "A chorus's, a flanger's, a phaser's or a tremolo's panel family."
#define OMX_PANEL_FAMILIES_DELAY "delay" ///< a delay
/** The source sentence (English) of OMX_PANEL_FAMILIES_DELAY. */
#define OMX_PANEL_FAMILIES_DELAY_TEXT_EN "A delay's panel family."
#define OMX_PANEL_FAMILIES_REVERB "reverb" ///< a reverb
/** The source sentence (English) of OMX_PANEL_FAMILIES_REVERB. */
#define OMX_PANEL_FAMILIES_REVERB_TEXT_EN "A reverb's panel family."
#define OMX_PANEL_FAMILIES_PITCH "pitch" ///< a pitch shifter
/** The source sentence (English) of OMX_PANEL_FAMILIES_PITCH. */
#define OMX_PANEL_FAMILIES_PITCH_TEXT_EN "A pitch shifter's panel family."
#define OMX_PANEL_FAMILIES_UTILITY "utility" ///< a gain trim, a stereo width control or another utility that shapes a signal without a processor's character
/** The source sentence (English) of OMX_PANEL_FAMILIES_UTILITY. */
#define OMX_PANEL_FAMILIES_UTILITY_TEXT_EN "A utility's panel family: a trim, a width control, a balancer or a clipper."
/** The number of words of PANEL_FAMILIES. */
#define OMX_PANEL_FAMILIES_COUNT 13u
/** The words of PANEL_FAMILIES in their declared order, as a C initializer list. */
#define OMX_PANEL_FAMILIES_INIT { "none", "gate", "dynamics", "limiter", "deesser", "eq", "filter", "drive", "modulation", "delay", "reverb", "pitch", "utility" }
/** Expands `X(code, "word", NAME)` once per word of PANEL_FAMILIES, in order, the code being its place in the order. The panel families of a plugin (omx-panel docs/panel-layout.md): the kind of processor its panel is laid out for. The words and their order are the contract; omx-panel's tools/panel-description.mjs FAMILIES and the skin package schema read them, and keep their code. */
#define OMX_PANEL_FAMILIES(X) \
    X(0u, "none", NONE) X(1u, "gate", GATE) X(2u, "dynamics", DYNAMICS) X(3u, "limiter", LIMITER) \
    X(4u, "deesser", DEESSER) X(5u, "eq", EQ) X(6u, "filter", FILTER) X(7u, "drive", DRIVE) \
    X(8u, "modulation", MODULATION) X(9u, "delay", DELAY) X(10u, "reverb", REVERB) X(11u, "pitch", PITCH) \
    X(12u, "utility", UTILITY)

/* PANEL_STANDARD_WIDGETS (panel/panel.json) */
#define OMX_PANEL_STANDARD_WIDGETS_KNOB "knob" ///< a travel
/** The source sentence (English) of OMX_PANEL_STANDARD_WIDGETS_KNOB. */
#define OMX_PANEL_STANDARD_WIDGETS_KNOB_TEXT_EN "A travel, drawn as a knob."
#define OMX_PANEL_STANDARD_WIDGETS_FADER "fader" ///< a travel drawn long
/** The source sentence (English) of OMX_PANEL_STANDARD_WIDGETS_FADER. */
#define OMX_PANEL_STANDARD_WIDGETS_FADER_TEXT_EN "A travel drawn long, as a fader."
#define OMX_PANEL_STANDARD_WIDGETS_SWITCH "switch" ///< a toggle
/** The source sentence (English) of OMX_PANEL_STANDARD_WIDGETS_SWITCH. */
#define OMX_PANEL_STANDARD_WIDGETS_SWITCH_TEXT_EN "A toggle, drawn as a switch."
#define OMX_PANEL_STANDARD_WIDGETS_SELECTOR "selector" ///< an integer travel or labelled values
/** The source sentence (English) of OMX_PANEL_STANDARD_WIDGETS_SELECTOR. */
#define OMX_PANEL_STANDARD_WIDGETS_SELECTOR_TEXT_EN "An integer travel or labelled values, drawn as a selector."
#define OMX_PANEL_STANDARD_WIDGETS_METER "meter" ///< a readout
/** The source sentence (English) of OMX_PANEL_STANDARD_WIDGETS_METER. */
#define OMX_PANEL_STANDARD_WIDGETS_METER_TEXT_EN "A readout, drawn as a meter."
#define OMX_PANEL_STANDARD_WIDGETS_CURVE "curve" ///< a response or transfer curve
/** The source sentence (English) of OMX_PANEL_STANDARD_WIDGETS_CURVE. */
#define OMX_PANEL_STANDARD_WIDGETS_CURVE_TEXT_EN "A response or transfer curve, drawn as a graph."
#define OMX_PANEL_STANDARD_WIDGETS_XY "xy" ///< two controls drawn as one point
/** The source sentence (English) of OMX_PANEL_STANDARD_WIDGETS_XY. */
#define OMX_PANEL_STANDARD_WIDGETS_XY_TEXT_EN "Two controls drawn together as one point on a plane."
#define OMX_PANEL_STANDARD_WIDGETS_DISPLAY "display" ///< a value shown as text
/** The source sentence (English) of OMX_PANEL_STANDARD_WIDGETS_DISPLAY. */
#define OMX_PANEL_STANDARD_WIDGETS_DISPLAY_TEXT_EN "A value shown as text."
/** The number of words of PANEL_STANDARD_WIDGETS. */
#define OMX_PANEL_STANDARD_WIDGETS_COUNT 8u
/** The words of PANEL_STANDARD_WIDGETS in their declared order, as a C initializer list. */
#define OMX_PANEL_STANDARD_WIDGETS_INIT { "knob", "fader", "switch", "selector", "meter", "curve", "xy", "display" }
/** Expands `X(code, "word", NAME)` once per word of PANEL_STANDARD_WIDGETS, in order, the code being its place in the order. The standard widgets a panel picks from a descriptor and a representation (a skin) draws, in the order omx-panel's tools/panel-description.mjs STANDARD_WIDGETS lists them. */
#define OMX_PANEL_STANDARD_WIDGETS(X) \
    X(0u, "knob", KNOB) X(1u, "fader", FADER) X(2u, "switch", SWITCH) X(3u, "selector", SELECTOR) \
    X(4u, "meter", METER) X(5u, "curve", CURVE) X(6u, "xy", XY) X(7u, "display", DISPLAY)

/* PANEL_WIDGETS (panel/panel.json) */
#define OMX_PANEL_WIDGETS_AUTO "auto" ///< left out of a panel declaration: the layout picks the widget from the control
/** The source sentence (English) of OMX_PANEL_WIDGETS_AUTO. */
#define OMX_PANEL_WIDGETS_AUTO_TEXT_EN "Left out of a panel declaration: the layout picks the widget from the control."
#define OMX_PANEL_WIDGETS_KNOB "knob" ///< a rotary control
/** The source sentence (English) of OMX_PANEL_WIDGETS_KNOB. */
#define OMX_PANEL_WIDGETS_KNOB_TEXT_EN "A rotary control."
#define OMX_PANEL_WIDGETS_FADER "fader" ///< a linear control
/** The source sentence (English) of OMX_PANEL_WIDGETS_FADER. */
#define OMX_PANEL_WIDGETS_FADER_TEXT_EN "A linear control."
#define OMX_PANEL_WIDGETS_SWITCH "switch" ///< a two-state control
/** The source sentence (English) of OMX_PANEL_WIDGETS_SWITCH. */
#define OMX_PANEL_WIDGETS_SWITCH_TEXT_EN "A two-state control."
#define OMX_PANEL_WIDGETS_SELECTOR "selector" ///< a control that picks one of a few values
/** The source sentence (English) of OMX_PANEL_WIDGETS_SELECTOR. */
#define OMX_PANEL_WIDGETS_SELECTOR_TEXT_EN "A control that picks one of a few values."
/** The number of words of PANEL_WIDGETS. */
#define OMX_PANEL_WIDGETS_COUNT 5u
/** The words of PANEL_WIDGETS in their declared order, as a C initializer list. */
#define OMX_PANEL_WIDGETS_INIT { "auto", "knob", "fader", "switch", "selector" }
/** Expands `X(code, "word", NAME)` once per word of PANEL_WIDGETS, in order, the code being its place in the order. The widgets a declared panel may name for a control, and the extension serves (org.openmixer.panel-description/1): auto leaves the choice to the panel layout. The four others are the shared widgets of omx-panel's schema/panel.schema.json. */
#define OMX_PANEL_WIDGETS(X) \
    X(0u, "auto", AUTO) X(1u, "knob", KNOB) X(2u, "fader", FADER) X(3u, "switch", SWITCH) \
    X(4u, "selector", SELECTOR)

/* PANEL_DISPLAY_KINDS (panel/panel.json) */
#define OMX_PANEL_DISPLAY_KINDS_GAIN_REDUCTION_BAR "gain_reduction_bar" ///< a bar of the gain a dynamics processor takes off
/** The source sentence (English) of OMX_PANEL_DISPLAY_KINDS_GAIN_REDUCTION_BAR. */
#define OMX_PANEL_DISPLAY_KINDS_GAIN_REDUCTION_BAR_TEXT_EN "A bar showing the gain reduction."
#define OMX_PANEL_DISPLAY_KINDS_TRANSFER_CURVE "transfer_curve" ///< a dynamics processor's output level against its input level
/** The source sentence (English) of OMX_PANEL_DISPLAY_KINDS_TRANSFER_CURVE. */
#define OMX_PANEL_DISPLAY_KINDS_TRANSFER_CURVE_TEXT_EN "The dynamics transfer curve: output level against input level."
#define OMX_PANEL_DISPLAY_KINDS_EQ_RESPONSE "eq_response" ///< an equaliser's frequency response
/** The source sentence (English) of OMX_PANEL_DISPLAY_KINDS_EQ_RESPONSE. */
#define OMX_PANEL_DISPLAY_KINDS_EQ_RESPONSE_TEXT_EN "The equaliser's frequency response."
#define OMX_PANEL_DISPLAY_KINDS_METER "meter" ///< a level meter
/** The source sentence (English) of OMX_PANEL_DISPLAY_KINDS_METER. */
#define OMX_PANEL_DISPLAY_KINDS_METER_TEXT_EN "A level meter."
#define OMX_PANEL_DISPLAY_KINDS_TIME_RESPONSE "time_response" ///< a response over time: a delay's train of taps or a reverb's decay envelope
/** The source sentence (English) of OMX_PANEL_DISPLAY_KINDS_TIME_RESPONSE. */
#define OMX_PANEL_DISPLAY_KINDS_TIME_RESPONSE_TEXT_EN "The response over time: a delay's taps or a reverb's decay."
/** The number of words of PANEL_DISPLAY_KINDS. */
#define OMX_PANEL_DISPLAY_KINDS_COUNT 5u
/** The words of PANEL_DISPLAY_KINDS in their declared order, as a C initializer list. */
#define OMX_PANEL_DISPLAY_KINDS_INIT { "gain_reduction_bar", "transfer_curve", "eq_response", "meter", "time_response" }
/** Expands `X(code, "word", NAME)` once per word of PANEL_DISPLAY_KINDS, in order, the code being its place in the order. The displays a declared panel may carry, and the extension serves (org.openmixer.panel-description/1), in the order of their codes: a panel description names a display by its place here. omx-panel's tools/panel-description.mjs and omx-clap-core's panel tables read them, and keep their code. */
#define OMX_PANEL_DISPLAY_KINDS(X) \
    X(0u, "gain_reduction_bar", GAIN_REDUCTION_BAR) X(1u, "transfer_curve", TRANSFER_CURVE) X(2u, "eq_response", EQ_RESPONSE) X(3u, "meter", METER) \
    X(4u, "time_response", TIME_RESPONSE)

/* PANEL_DISPLAY_SOURCES (panel/panel.json) */
#define OMX_PANEL_DISPLAY_SOURCES_FAMILY "family" ///< the data the panel family itself implies
/** The source sentence (English) of OMX_PANEL_DISPLAY_SOURCES_FAMILY. */
#define OMX_PANEL_DISPLAY_SOURCES_FAMILY_TEXT_EN "The data the panel family implies."
#define OMX_PANEL_DISPLAY_SOURCES_METERS "meters" ///< the plugin's meter readouts
/** The source sentence (English) of OMX_PANEL_DISPLAY_SOURCES_METERS. */
#define OMX_PANEL_DISPLAY_SOURCES_METERS_TEXT_EN "The plugin's meter readouts."
#define OMX_PANEL_DISPLAY_SOURCES_GAIN_ADJUSTMENT "gain_adjustment" ///< the gain the processor applies
/** The source sentence (English) of OMX_PANEL_DISPLAY_SOURCES_GAIN_ADJUSTMENT. */
#define OMX_PANEL_DISPLAY_SOURCES_GAIN_ADJUSTMENT_TEXT_EN "The gain the processor applies."
#define OMX_PANEL_DISPLAY_SOURCES_CURVE "curve" ///< a curve the plugin declares
/** The source sentence (English) of OMX_PANEL_DISPLAY_SOURCES_CURVE. */
#define OMX_PANEL_DISPLAY_SOURCES_CURVE_TEXT_EN "A curve the plugin declares."
/** The number of words of PANEL_DISPLAY_SOURCES. */
#define OMX_PANEL_DISPLAY_SOURCES_COUNT 4u
/** The words of PANEL_DISPLAY_SOURCES in their declared order, as a C initializer list. */
#define OMX_PANEL_DISPLAY_SOURCES_INIT { "family", "meters", "gain_adjustment", "curve" }
/** Expands `X(code, "word", NAME)` once per word of PANEL_DISPLAY_SOURCES, in order, the code being its place in the order. Where a panel description's display takes its data from, in the order of their codes (org.openmixer.panel-description/1). omx-panel's tools/panel-description.mjs and omx-clap-core's panel tables read them, and keep their code. */
#define OMX_PANEL_DISPLAY_SOURCES(X) \
    X(0u, "family", FAMILY) X(1u, "meters", METERS) X(2u, "gain_adjustment", GAIN_ADJUSTMENT) X(3u, "curve", CURVE)

/* PANEL_PLACEMENTS (panel/panel.json) */
#define OMX_PANEL_PLACEMENTS_INSERT "insert" ///< an instance on a track's insert chain
/** The source sentence (English) of OMX_PANEL_PLACEMENTS_INSERT. */
#define OMX_PANEL_PLACEMENTS_INSERT_TEXT_EN "An instance on an insert chain."
#define OMX_PANEL_PLACEMENTS_RETURN "return" ///< an instance on a return track
/** The source sentence (English) of OMX_PANEL_PLACEMENTS_RETURN. */
#define OMX_PANEL_PLACEMENTS_RETURN_TEXT_EN "An instance on a return track."
#define OMX_PANEL_PLACEMENTS_BUS "bus" ///< an instance on a bus
/** The source sentence (English) of OMX_PANEL_PLACEMENTS_BUS. */
#define OMX_PANEL_PLACEMENTS_BUS_TEXT_EN "An instance on a bus."
#define OMX_PANEL_PLACEMENTS_MASTER "master" ///< an instance on the master
/** The source sentence (English) of OMX_PANEL_PLACEMENTS_MASTER. */
#define OMX_PANEL_PLACEMENTS_MASTER_TEXT_EN "An instance on the master."
/** The number of words of PANEL_PLACEMENTS. */
#define OMX_PANEL_PLACEMENTS_COUNT 4u
/** The words of PANEL_PLACEMENTS in their declared order, as a C initializer list. */
#define OMX_PANEL_PLACEMENTS_INIT { "insert", "return", "bus", "master" }
/** Expands `X(code, "word", NAME)` once per word of PANEL_PLACEMENTS, in order, the code being its place in the order. Where an instance sits, in the order of their codes: the clap.track-info/1 flags read as one value (org.openmixer.panel-description/1). omx-panel's tools/panel-description.mjs and omx-clap-core's panel tables read them, and keep their code. */
#define OMX_PANEL_PLACEMENTS(X) \
    X(0u, "insert", INSERT) X(1u, "return", RETURN) X(2u, "bus", BUS) X(3u, "master", MASTER)

#endif /* PANEL_VOCABULARY_H */
