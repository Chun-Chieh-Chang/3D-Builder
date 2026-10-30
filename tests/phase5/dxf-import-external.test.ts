/**
 * 「匯入 DXF」 (F2.6, ADR 0219) on DXF files other CAD programs saved: R12 to 2018, written by AutoCAD-format writers, LibreCAD (dxfrw) and QCAD (dxflib), from
 * the test resources of bjnortier/dxf (`tests/fixtures/public-dxf/bjnortier-dxf`, README there). What the import gives is checked against what does not come
 * from it: the bytes' hashes, the extents the writing program recorded, the DXF reference evaluated on an entity's own groups, and the entities read straight
 * from the text by the small reader below.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IdAllocator, sketchError, type SketchEntity } from '@3db/model';
import { DXF_APPROXIMATION, dxfText, importDxf, surveyDxf } from '@3db/drawing';
import { bezierPoint } from '@3db/sketch/interact';

type P = [number, number];
const DIR = fileURLToPath(new URL('../fixtures/public-dxf/bjnortier-dxf/', import.meta.url));
const bytes = (name: string) => new Uint8Array(readFileSync(DIR + name));
const textOf = (name: string) => dxfText(bytes(name));
const run = (name: string) => importDxf(textOf(name), new IdAllocator({}, []));

/** The files, the version each says it is, the writer its `999` comment names, and its SHA-256 (as in the README). */
const FILES: Record<string, { version: string; writer?: string; sha: string }> = {
  'issue42.dxf': { version: 'AC1009', sha: '24ca55104af8e7d42cd236643bf79851636756faf1e8c7f83d216eeaeca20964' },
  'supported_entities.dxf': { version: 'AC1015', writer: 'dxflib 3.12.2.0', sha: '8601dfdfa258445a9347b873403d4bda489f26340899baad5ba1caaad1d860d9' },
  'issue27b.dxf': { version: 'AC1018', sha: 'd6c18a060529926a877b06d4a2feb82a55fb5b2f26304f3ee368746b6b0695ee' },
  'issue21.dxf': { version: 'AC1021', writer: 'dxfrw 0.6.3', sha: '756b5a3901e6a77d74793d7ef0eb4d609d299a1beedf60c1658b4375fea8e92a' },
  'blocks1.dxf': { version: 'AC1021', writer: 'dxfrw 0.6.1', sha: 'ba33677808f6a534d64a5898803649caca30eccb543092e3e5a102043b9d1c2e' },
  'arrayed-holes.dxf': { version: 'AC1021', writer: 'dxfrw 0.6.3', sha: '29856a0eb2b8412527bef8be612200662ea5bb80fadc8decec1eccf79b8ec058' },
  'arc15.dxf': { version: 'AC1021', writer: 'dxfrw 0.6.3', sha: '2e46b1fc5925d916ef25eb0df8301d2f75aa0f720c2204336c27ebd1fbe2d891' },
  'elliptical-arc7.dxf': { version: 'AC1021', writer: 'dxfrw 0.6.3', sha: '9f40190864797ed6e9151fb7b7dfff777af0082536e0bf9d93639a19182953fa' },
  'elliptical-arc11.dxf': { version: 'AC1021', writer: 'dxfrw 0.6.3', sha: 'f36768b851f3c01430f0489e9f05cbb553a6442ea397269c7cd70833a71a9806' },
  'testModelPaperSpace.dxf': { version: 'AC1032', sha: 'c150ba46518b553d2fec08d1680ff6a66862f6708753946b8454c82bcadf417c' },
  'alu-profile.dxf': { version: 'AC1032', sha: 'b73d4a5671d7d2bdad16f89fa21413f4f89cbd42673f54af97332041fd8e7e8c' },
};

// ---- a small reader of the raw text, apart from the importer's ----

/** The group code and value pairs of the file, comments kept. */
function rawPairs(text: string): [number, string][] {
  const lines = text.split(/\r?\n/);
  const out: [number, string][] = [];
  for (let k = 0; k + 1 < lines.length; k += 2) out.push([Number(lines[k]!.trim()), lines[k + 1]!.trim()]);
  return out;
}
/** The first value of a header variable's group. */
function headerValue(text: string, name: string, code: number): number | undefined {
  const pairs = rawPairs(text);
  const at = pairs.findIndex(([c, v]) => c === 9 && v === name);
  if (at < 0) return undefined;
  for (let k = at + 1; k < pairs.length && pairs[k]![0] !== 9 && pairs[k]![0] !== 0; k++) if (pairs[k]![0] === code) return Number(pairs[k]![1]);
  return undefined;
}
/** The entities of the ENTITIES section, each its type and its groups. */
function rawEntities(text: string): { type: string; groups: [number, string][] }[] {
  const pairs = rawPairs(text);
  let k = pairs.findIndex(([c, v], j) => c === 2 && v === 'ENTITIES' && pairs[j - 1]?.[1] === 'SECTION') + 1;
  const out: { type: string; groups: [number, string][] }[] = [];
  for (; pairs[k]![1] !== 'ENDSEC'; k++) {
    if (pairs[k]![0] === 0) out.push({ type: pairs[k]![1], groups: [] });
    else out[out.length - 1]!.groups.push(pairs[k]!);
  }
  return out;
}
const group = (groups: [number, string][], code: number, fallback = 0) => {
  const g = groups.find(([c]) => c === code);
  return g ? Number(g[1]) : fallback;
};

/** Points of the import's curves, `n` along each. */
function points(es: SketchEntity[], n: number): P[] {
  const pt = new Map<string, P>();
  for (const e of es) if (e.type === 'point') pt.set(e.id, [e.x, e.y]);
  const out: P[] = [];
  for (const e of es) {
    if (e.type === 'arc') {
      const c = pt.get(e.center)!, s = pt.get(e.start)!, f = pt.get(e.end)!;
      const r = Math.hypot(s[0] - c[0], s[1] - c[1]);
      const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
      let a1 = Math.atan2(f[1] - c[1], f[0] - c[0]);
      if (a1 <= a0) a1 += 2 * Math.PI;
      for (let k = 0; k <= n; k++) out.push([c[0] + r * Math.cos(a0 + ((a1 - a0) * k) / n), c[1] + r * Math.sin(a0 + ((a1 - a0) * k) / n)]);
    } else if (e.type === 'spline') {
      const poles = e.points.map((id) => pt.get(id)!);
      for (let k = 0; k <= n; k++) out.push(bezierPoint(poles, k / n) as P);
    }
  }
  return out;
}

describe('the files', () => {
  it('are the ones the README records, of the version each says, the LibreCAD and QCAD ones naming their writer in a 999 comment', () => {
    for (const [name, f] of Object.entries(FILES)) {
      expect(createHash('sha256').update(bytes(name)).digest('hex'), name).toBe(f.sha);
      const pairs = rawPairs(textOf(name));
      const version = pairs.findIndex(([c, v]) => c === 9 && v === '$ACADVER');
      // R12 files may leave $ACADVER out; issue42 says AC1009
      expect(pairs[version + 1]?.[1], name).toBe(f.version);
      expect(pairs[0]![0] === 999 ? pairs[0]![1] : undefined, name).toBe(f.writer);
    }
  });
});

describe('every file comes in as a valid sketch', () => {
  it('reads (the 999 comment and the ACDSDATA section of AutoCAD 2013+ no longer refuse it), passes the sketch check, approximates within the bound', () => {
    const problems: Record<string, string[]> = {};
    for (const name of Object.keys(FILES)) {
      const r = run(name);
      expect(r.entities.length, name).toBeGreaterThan(0);
      expect(sketchError({ entities: r.entities, constraints: [] }), name).toBeNull();
      expect(r.approximated.deviation, name).toBeLessThanOrEqual(DXF_APPROXIMATION);
      if (r.problems.length) problems[name] = r.problems.map((p) => p.what);
    }
    // the only entities refused are the two lines of zero length in testModelPaperSpace (checked against the raw text below)
    expect(problems).toEqual({ 'testModelPaperSpace.dxf': ['LINE 12D', 'LINE 12E'] });
  });

  it('testModelPaperSpace (2018): the lines of model space come in, the circle and viewports of paper space (group 67 = 1) do not; the refused lines are of zero length in the file', () => {
    const raw = rawEntities(textOf('testModelPaperSpace.dxf'));
    const paper = raw.filter((e) => group(e.groups, 67) === 1);
    expect(paper.map((e) => e.type).sort()).toEqual(['CIRCLE', 'VIEWPORT', 'VIEWPORT']);
    const lines = raw.filter((e) => e.type === 'LINE' && group(e.groups, 67) !== 1);
    const zero = lines.filter((e) => group(e.groups, 10) === group(e.groups, 11) && group(e.groups, 20) === group(e.groups, 21));
    expect(zero.map((e) => e.groups.find(([c]) => c === 5)![1])).toEqual(['12D', '12E']);
    const r = run('testModelPaperSpace.dxf');
    expect(r.made).toEqual({ line: lines.length - zero.length });
    expect(r.problems.map((p) => p.what)).toEqual(['LINE 12D', 'LINE 12E']);
  });

  it('alu-profile (2018): its dimensions and hatches are left out, as many as the file has', () => {
    const raw = rawEntities(textOf('alu-profile.dxf'));
    const r = run('alu-profile.dxf');
    for (const type of ['DIMENSION', 'HATCH']) expect(r.skipped[type], type).toBe(raw.filter((e) => e.type === type).length);
    expect(r.skipped.DIMENSION).toBeGreaterThan(0);
    expect(r.made.line! + r.made.arc!).toBeGreaterThan(300);
  });
});

describe('where it comes in', () => {
  /** Millimetres per unit as `$INSUNITS` says, for the units these files use. */
  const MM: Record<number, number> = { 1: 25.4, 4: 1 };

  it('the extent is the one the writing program recorded ($EXTMIN, $EXTMAX), to 1e-9 of the size: R12, 2004 splines, 2007 blocks and arrays in inches, 2018', () => {
    for (const name of ['issue42.dxf', 'issue27b.dxf', 'blocks1.dxf', 'arrayed-holes.dxf', 'testModelPaperSpace.dxf']) {
      const text = textOf(name);
      const units = headerValue(text, '$INSUNITS', 70);
      const scale = units === undefined ? 1 : MM[units]!;
      const s = surveyDxf(text);
      expect(s.scale, name).toBe(scale);
      const min: P = [headerValue(text, '$EXTMIN', 10)! * scale, headerValue(text, '$EXTMIN', 20)! * scale];
      const max: P = [headerValue(text, '$EXTMAX', 10)! * scale, headerValue(text, '$EXTMAX', 20)! * scale];
      const size = Math.max(max[0] - min[0], max[1] - min[1]);
      expect(size, name).toBeGreaterThan(1);
      for (const k of [0, 1]) {
        expect(Math.abs(s.bounds!.min[k]! - min[k]!), `${name} min ${k}`).toBeLessThan(1e-9 * size);
        expect(Math.abs(s.bounds!.max[k]! - max[k]!), `${name} max ${k}`).toBeLessThan(1e-9 * size);
      }
    }
    // the arrays: arrayed-holes is in inches
    expect(surveyDxf(textOf('arrayed-holes.dxf')).scale).toBe(25.4);
  });

  it('arc15: the ARC is the one its groups give, to 1e-9 mm', () => {
    const [arc] = rawEntities(textOf('arc15.dxf'));
    const g = arc!.groups;
    const c: P = [group(g, 10) * 25.4, group(g, 20) * 25.4];
    const r = group(g, 40) * 25.4;
    const imported = run('arc15.dxf');
    expect(imported.made).toEqual({ arc: 1 });
    const ps = points(imported.entities, 2000);
    for (const p of ps) expect(Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - r)).toBeLessThan(1e-9);
    // from the start angle to the end, counter-clockwise
    const angle = (p: P) => (((Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI) + 360) % 360;
    expect(Math.abs(angle(ps[0]!) - group(g, 50))).toBeLessThan(1e-9);
    expect(Math.abs(angle(ps[ps.length - 1]!) - group(g, 51))).toBeLessThan(1e-9);
  });

  /** The ELLIPSE its groups give (DXF reference: centre 10, major axis 11 from it, minor = ratio 40 × (normal × major), parameters 41 to 42), in mm. */
  function ellipseOf(name: string) {
    const [e] = rawEntities(textOf(name));
    const g = e!.groups;
    const s = 25.4;
    const M: P = [group(g, 11), group(g, 21)];
    const z = Math.sign(group(g, 230, 1));
    const m: P = [-M[1] * group(g, 40) * z, M[0] * group(g, 40) * z];
    const t0 = group(g, 41);
    let t1 = group(g, 42, 2 * Math.PI);
    if (t1 <= t0) t1 += 2 * Math.PI;
    const at = (t: number): P => [(group(g, 10) + M[0] * Math.cos(t) + m[0] * Math.sin(t)) * s, (group(g, 20) + M[1] * Math.cos(t) + m[1] * Math.sin(t)) * s];
    /** How far a point is from the curve: the nearest of a fine sampling, then a golden-section search between its neighbours. */
    const distance = (p: P) => {
      const n = 20000;
      const d = (t: number) => { const q = at(Math.min(t1, Math.max(t0, t))); return Math.hypot(p[0] - q[0], p[1] - q[1]); };
      let best = 0;
      for (let k = 1; k <= n; k++) if (d(t0 + ((t1 - t0) * k) / n) < d(t0 + ((t1 - t0) * best) / n)) best = k;
      let a = t0 + ((t1 - t0) * (best - 1)) / n, b = t0 + ((t1 - t0) * (best + 1)) / n;
      const ratio = (Math.sqrt(5) - 1) / 2;
      for (let k = 0; k < 100; k++) { const c = b - ratio * (b - a), e = a + ratio * (b - a); if (d(c) < d(e)) b = e; else a = c; }
      return d((a + b) / 2);
    };
    return { at, t0, t1, distance };
  }

  it('elliptical-arc7: the part of an ellipse is approximated by connected Bézier pieces that lie within 0.001 mm of it and run from its start to its end', () => {
    const ref = ellipseOf('elliptical-arc7.dxf');
    const r = run('elliptical-arc7.dxf');
    expect(r.made.spline).toBeGreaterThan(1);
    expect(r.approximated.count).toBe(1);
    const ps = points(r.entities, 40);
    expect(Math.max(...ps.map(ref.distance))).toBeLessThanOrEqual(DXF_APPROXIMATION);
    // the pieces share their ends, the first starts and the last ends where the ellipse does
    const splines = r.entities.filter((e) => e.type === 'spline');
    for (let k = 1; k < splines.length; k++) expect(splines[k]!.points[0]).toBe(splines[k - 1]!.points.at(-1));
    const pt = new Map(r.entities.filter((e) => e.type === 'point').map((e) => [e.id, [e.x, e.y] as P]));
    const ends = [pt.get(splines[0]!.points[0]!)!, pt.get(splines.at(-1)!.points.at(-1)!)!];
    const want = [ref.at(ref.t0), ref.at(ref.t1)];
    // the ends are in either order (a clockwise ellipse comes in reversed)
    const gap = (a: P[], b: P[]) => Math.max(Math.hypot(a[0]![0] - b[0]![0], a[0]![1] - b[0]![1]), Math.hypot(a[1]![0] - b[1]![0], a[1]![1] - b[1]![1]));
    expect(Math.min(gap(ends, want), gap(ends, [want[1]!, want[0]!]))).toBeLessThan(1e-9);
  });

  it('elliptical-arc11: an ELLIPSE whose axes are equal comes in as an exact arc of the same curve', () => {
    const ref = ellipseOf('elliptical-arc11.dxf');
    const r = run('elliptical-arc11.dxf');
    expect(r.made).toEqual({ arc: 1 });
    expect(r.approximated.count).toBe(0);
    expect(Math.max(...points(r.entities, 400).map(ref.distance))).toBeLessThan(1e-9);
  });
});
