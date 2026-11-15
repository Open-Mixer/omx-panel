// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * rta-console-reference.mjs — the console analyser's picture of one fixed spectrum and EQ curve, as geometry, for the renderer's
 * spectrum parity test (renderer/test/spectrum.test.mjs). It runs the console's own RTA scene builder (line mode, the bands as
 * its POST trace (the level after the plugin, as a reader on an instance's outputs measures it), the meter gradient, the EQ curve
 * on, no tilt) from a console checkout, bundled with that checkout's esbuild, and writes what the parity reads: every coordinate
 * as a fraction of the plot (x of its width, y of its height), so the fixture does not depend on omx-panel's layout. The test
 * never needs the console's source: the fixture is committed, with the commit it was made from.
 *
 *   node tools/rta-console-reference.mjs <console checkout> [--out test/fixtures/rta/console-scene.json]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const om = resolve(args[0] ?? '');
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'test/fixtures/rta/console-scene.json';
const commit = execFileSync('git', ['-C', om, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const pnpm = join(om, 'node_modules', '.pnpm');
const esbuildDir = readdirSync(pnpm).filter((d) => d.startsWith('esbuild@')).sort().pop();
if (!esbuildDir) throw new Error(`no esbuild under ${pnpm}`);
const esbuild = join(pnpm, esbuildDir, 'node_modules', 'esbuild', 'bin', 'esbuild');
const utils = join(om, 'packages', 'web-ui', 'app', 'utils');

// THE INPUT, fixed: 31 bands log-spaced from 20 Hz to 20 kHz with a dip near 1 kHz and one band whose peak reaches the top of the
// window (a clip tick); an EQ curve of 64 points, a 12 dB notch at 1 kHz and a 6 dB shelf above 5 kHz.
export const BANDS = Array.from({ length: 31 }, (_, k) => {
  const hz = 20 * Math.pow(1000, k / 30);
  const db = -30 - 8 * Math.sin(k / 3) - 14 * Math.exp(-((Math.log10(hz / 1000) / 0.12) ** 2));
  return { hz, db: k === 25 ? -6 : db, peakDb: k === 25 ? 0 : db + 3 };
});
export const CURVE = Array.from({ length: 64 }, (_, k) => {
  const hz = 20 * Math.pow(1000, k / 63);
  const notch = -12 * Math.exp(-((Math.log10(hz / 1000) / 0.05) ** 2));
  const shelf = 6 / (1 + Math.pow(5000 / hz, 2));
  return { hz, gain: notch + shelf };
});
/** The EQ's gain at `hz`, the curve's own formula: PRE is the POST bands less it, so the delta is the EQ's move. */
export const gainAt = (hz) => -12 * Math.exp(-((Math.log10(hz / 1000) / 0.05) ** 2)) + 6 / (1 + Math.pow(5000 / hz, 2));
// PRE: what the EQ was given, the POST bands less the EQ's gain (silence stays silence), its peak 3 dB above
export const PRE = BANDS.map((b) => ({ hz: b.hz, db: b.db - gainAt(b.hz), peakDb: b.db - gainAt(b.hz) + 3 }));

const dir = mkdtempSync(join(tmpdir(), 'rta-ref-'));
const entry = join(dir, 'entry.ts');
writeFileSync(entry, `
import { buildRtaScene } from ${JSON.stringify(join(utils, 'render', 'rtaScene.ts'))};
import { DB_MAX, DB_MIN, DB_GRID_STEP, F_MIN, dbToY, freqToX } from ${JSON.stringify(join(utils, 'spectrum.ts'))};
import { EQ_CURVE_REF_DB } from ${JSON.stringify(join(utils, 'rtaEqCurve.ts'))};
type B = { hz: number; db: number; peakDb: number };
export function scene(bands: B[], curve: { hz: number; gain: number }[], fmx: number,
                      o: { pre?: B[]; showPre?: boolean; showPost?: boolean; dimPre?: boolean; deltaOn?: boolean } = {}) {
  const c = [0, 0, 0, 1] as [number, number, number, number];
  // the accent at mid grey, so a delta quad's colour tells its sign: a boost mixes toward black, a cut toward white
  const a = [0.5, 0.5, 0.5, 1] as [number, number, number, number];
  const pal = { bg: c, border: c, ink: c, inkDim: c, inkFaint: c, accent: a, green: c, amber: c, red: c };
  const eqCurve = curve.map((p) => ({ x: freqToX(p.hz, F_MIN, fmx), y: dbToY(EQ_CURVE_REF_DB + p.gain, DB_MIN, DB_MAX) }));
  const s = buildRtaScene({
    w: 1, h: 1, fmx, palette: pal, tilt: 0, pre: (o.pre ?? []) as any, post: bands as any, showPre: o.showPre ?? false,
    showPost: o.showPost ?? true, dimPre: o.dimPre ?? false, meterColour: true, deltaOn: o.deltaOn ?? false, peakHold: null, eqCurve, peak: null, ringing: [], mode: 'line',
    gridLabel: (hz: number) => String(hz), fmtHz: (hz: number) => String(hz),
  });
  return { s, window: { dbMin: DB_MIN, dbMax: DB_MAX, gridDb: DB_GRID_STEP, refDb: EQ_CURVE_REF_DB, fMin: F_MIN } };
}
`);
const bundle = join(dir, 'bundle.mjs');
execFileSync(esbuild, [entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${bundle}`, '--log-level=warning'], {
  cwd: join(om, 'packages', 'web-ui'), stdio: ['ignore', 'inherit', 'inherit'],
});
const { scene } = await import(pathToFileURL(bundle).href);
const fmx = 20000;
const { s, window } = scene(BANDS, CURVE, fmx);

// what the parity reads, in plot fractions: the dB graticule's rows, the trace, the area's outline, the clip ticks' x, the curve
const lines = s.prims.filter((p) => p.kind === 'line');
const horizontal = lines.filter((p) => p.pts.length === 2 && p.pts[0].y === p.pts[1].y && p.pts[0].x === 0 && p.pts[1].x === 1);
const trace = lines.find((p) => p.width === 1.5 && !p.dash);
const curve = lines.find((p) => p.dash);
const area = s.prims.find((p) => p.kind === 'area');
const ticks = s.prims.filter((p) => p.kind === 'rect' && p.h === 4);
// BOTH, as the console draws it: POST filled and PRE its dim reference line; with the delta, a quad per pair of bands
const both = scene(BANDS, CURVE, fmx, { pre: PRE, showPre: true, showPost: true, dimPre: true }).s;
const delta = scene(BANDS, CURVE, fmx, { pre: PRE, showPre: true, showPost: true, dimPre: true, deltaOn: true }).s;
const preTrace = both.prims.find((p) => p.kind === 'line' && p.width === 1 && p.pts.length === PRE.length);
const quads = delta.prims.filter((p) => p.kind === 'quad');
const fixture = {
  source: { scene: "the console's RTA scene builder", commit,
    mode: 'line', meterColour: true, tilt: 0, eqCurve: 'on' },
  window: { ...window, fMax: fmx },
  input: { bands: BANDS, curve: CURVE, pre: PRE },
  graticule: horizontal.map((p) => p.pts[0].y),
  trace: trace.pts,
  area: { pts: area.pts, baseY: area.baseY, alpha: area.alpha, stops: area.paint.stops.map((st) => st.t) },
  clipTicksX: ticks.map((t) => t.x + t.w / 2),
  curve: curve.pts,
  // the two-tap scenes: PRE's dim line in BOTH, and each delta quad (its band pair by its left x, its corners, its sign)
  both: { preTrace: preTrace.pts, alpha: preTrace.alpha, width: preTrace.width },
  delta: { wedges: quads.map((q) => ({ band: preTrace.pts.findIndex((p) => Math.abs(p.x - q.pts[0].x) < 1e-9),
    pts: q.pts, sign: q.color[0] < 0.5 ? 'boost' : 'cut' })) },
};
writeFileSync(out, JSON.stringify(fixture, null, 1) + '\n');
console.log(`rta-console-reference: ${out} from the console at ${commit.slice(0, 10)}: ${fixture.graticule.length} graticule rows, ${fixture.trace.length} trace points, ${fixture.clipTicksX.length} clip tick(s), ${fixture.curve.length} curve points, ${fixture.delta.wedges.length} delta wedges`);
