// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Two synthetic plugins whose controls carry every designation rule 2 groups (test/group-designation-f1.test.mjs): the verdicts, as JSON.
const { inferGroups } = await import(process.argv[2]);
const P = 'http://lv2plug.in/ns/ext/parameters#', L = 'http://lv2plug.in/ns/lv2core#';
const mk = (names) => names.flatMap((d, k) => [0, 1].map((j) => ({ symbol: `${d}${j}`, name: `Zq${k}x${j}`, designation: d === 'enabled' ? `${L}enabled` : `${P}${d}` }))).map((p, i) => ({ ...p, index: i * 3, control: true, input: true }));
const A = mk(['attack', 'decay', 'sustain', 'release', 'hold', 'delay', 'cutoffFrequency', 'resonance', 'waveform', 'pulseWidth', 'frequency', 'amplitude', 'gain', 'wetLevel', 'dryLevel', 'wetDryRatio', 'bypass', 'enabled']);
const B = mk(['threshold', 'ratio', 'attack', 'release', 'hold', 'decay', 'cutoffFrequency', 'gain']);
const sh = (v) => ({ outcome: v.outcome, reason: v.reason, groups: (v.groups ?? v.attempt?.groups ?? []).map((g) => `${g.name}:${g.ports.join(',')}`), placedBy: v.placedBy ?? v.attempt?.placedBy });
console.log(JSON.stringify({ A: sh(inferGroups({ uri: 'urn:a', ports: A })), B: sh(inferGroups({ uri: 'urn:b', ports: B })) }));
