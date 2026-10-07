/**
 * The flat pattern of a flange grown on a bent base (ADR 0114): until now it was refused ("折過的基材凸緣上再長凸緣"). A bent base is a sheet along a path (here the L (0,0) → (60,0) → (60,40), 40 wide, 1.5
 * thick, inside radius 2, K 0.5); each straight piece of the path has its own motion into the flat strip, and a flange on the end of the second leg (an edge across the width, 90°, length 20 from
 * the outside virtual sharp: a flat piece of 20 − 3.5 = 16.5, the sheet cut back by the setback 3.5) grows from there. By hand, the flat strip is the base's flat length
 * (`flatLength`: the straight pieces and the allowance of its bend) less the 3.5 cut back, plus the allowance of the flange (π/2 · 2.75 = 4.3197) and its 16.5: 40 wide all the way.
 * The same with the sheet on the other side of the path, with the path walked the other way and with the width the other way: the flat pattern is the same size each time.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type Feature, type PartDoc, type Ref, type SketchEntity } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { flatPattern, Regenerator, type RebuildResult } from '@3db/regen';
import { front, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const rebuild = (doc: PartDoc): RebuildResult => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  return regen.rebuild(doc);
};
const build = (features: Feature[]): PartDoc => features.reduce((d, feature, index) => applyCommand(d, { type: 'insertFeature', feature, index }), createEmptyPart());
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const BA = (Math.PI / 2) * 2.75;

const path = (pts: [number, number][]) => ({
  ...sketch('sk', front),
  entities: [
    ...pts.map(([x, y], i) => ({ id: `p${i}`, type: 'point', x, y }) as SketchEntity),
    ...pts.slice(1).map((_, i) => ({ id: `l${i}`, type: 'line', p1: `p${i}`, p2: `p${i + 1}` }) as SketchEntity),
  ],
});
const base = (extra: Record<string, unknown> = {}): Feature => ({ id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5', depth: '40', ...extra }) as Feature;

/** An edge across the width at the end of the last leg: a straight edge along z whose middle is at the end of the path (y = 40, or x = 0 when the path is walked the other way). */
function endEdge(r: RebuildResult, at: (mid: number[]) => boolean): Ref {
  const t = r.body!.topology;
  const i = t.edges.findIndex((e) => e.curve === 'line' && e.dir && Math.abs(Math.abs(e.dir[2]) - 1) < 1e-9 && at(e.mid));
  expect(i, 'an edge across the width at the end of the path').toBeGreaterThanOrEqual(0);
  return { kind: 'edge', name: r.body!.names.edges[i]!, fingerprint: edgeFingerprint(t, i) };
}
const flange = (edge: Ref): Feature => ({ id: 'fa', type: 'edgeFlange', name: 'fa', suppressed: false, edge, length: '20' }) as Feature;

const cases: { name: string; pts: [number, number][]; extra: Record<string, unknown>; end: (m: number[]) => boolean }[] = [
  { name: 'the sheet to the left, width along +z', pts: [[0, 0], [60, 0], [60, 40]], extra: {}, end: (m) => Math.abs(m[1]! - 40) < 1e-6 },
  { name: 'the sheet to the right of the path', pts: [[0, 0], [60, 0], [60, 40]], extra: { flipSide: true }, end: (m) => Math.abs(m[1]! - 40) < 1e-6 },
  { name: 'the width the other way (−z)', pts: [[0, 0], [60, 0], [60, 40]], extra: { reverse: true }, end: (m) => Math.abs(m[1]! - 40) < 1e-6 },
  { name: 'the path walked the other way: from (60, 40) to (0, 0), the flange at (60, 40) — the start of the path', pts: [[60, 40], [60, 0], [0, 0]], extra: {}, end: (m) => Math.abs(m[1]! - 40) < 1e-6 },
];

describe('the flat pattern of a flange on a bent base (ADR 0114)', () => {
  for (const c of cases) {
    it(`${c.name}: the strip is flatLength − 3.5 + BA + 16.5 long, 40 wide, with the two bends`, () => {
      const without = rebuild(build([path(c.pts), base(c.extra)]));
      expect(failures(without)).toEqual([]);
      const edge = endEdge(without, c.end);
      const r = rebuild(build([path(c.pts), base(c.extra), flange(edge)]));
      expect(failures(r)).toEqual([]);
      const flat = r.sheet!.base!;
      expect(flat.kind).toBe('bent');
      const p = flatPattern(kernel, r.sheet!);
      expect(kernel.solidCount(p.shape)).toBe(1);
      expect(kernel.isValid(p.shape)).toBe(true);
      kernel.release(p.shape);
      const length = (flat as { flatLength: number }).flatLength - 3.5 + BA + 16.5;
      expect(p.width).toBeCloseTo(length, 4);
      expect(p.height).toBeCloseTo(40, 6);
      expect(p.area).toBeCloseTo(length * 40, 3);
      expect(p.bends).toHaveLength(2);
      // the volume of the flat is the volume of the folded sheet (K 0.5)
      expect(p.volume).toBeCloseTo(kernel.massProps(r.body!.shape).volume, 2);
      expect(r.sheet!.flanges[0]!.host).toBeGreaterThanOrEqual(0);
    });
  }

  it('the flange sits where it should along the strip: its bend line is at flatLength − 3.5 + BA/2 from the start of the strip, across the whole width (when the path starts at (0, 0))', () => {
    const without = rebuild(build([path([[0, 0], [60, 0], [60, 40]]), base()]));
    const r = rebuild(build([path([[0, 0], [60, 0], [60, 40]]), base(), flange(endEdge(without, (m) => Math.abs(m[1]! - 40) < 1e-6))]));
    const p = flatPattern(kernel, r.sheet!);
    kernel.release(p.shape);
    const bend = p.bends[1]!;
    const flatLength = (r.sheet!.base as { flatLength: number }).flatLength;
    expect(bend.a[0]).toBeCloseTo(flatLength - 3.5 + BA / 2, 4);
    expect(bend.b[0]).toBeCloseTo(flatLength - 3.5 + BA / 2, 4);
    expect(Math.abs(bend.b[1] - bend.a[1])).toBeCloseTo(40, 6);
  });

  it('a flange on a long edge of a leg (along the path, at the end of the width) grows the strip the other way: 40 − 3.5 + BA + 16.5 across, flatLength along', () => {
    const without = rebuild(build([path([[0, 0], [60, 0], [60, 40]]), base()]));
    const t = without.body!.topology;
    const i = t.edges.findIndex((e) => e.curve === 'line' && e.dir && Math.abs(Math.abs(e.dir[0]) - 1) < 1e-9 && Math.abs(e.mid[2]! - 40) < 1e-6 && Math.abs(e.mid[1]!) < 1e-6);
    expect(i, 'a long edge of the first leg at z = 40').toBeGreaterThanOrEqual(0);
    const edge: Ref = { kind: 'edge', name: without.body!.names.edges[i]!, fingerprint: edgeFingerprint(t, i) };
    const r = rebuild(build([path([[0, 0], [60, 0], [60, 40]]), base(), flange(edge)]));
    expect(failures(r)).toEqual([]);
    const p = flatPattern(kernel, r.sheet!);
    expect(kernel.solidCount(p.shape)).toBe(1);
    expect(kernel.isValid(p.shape)).toBe(true);
    kernel.release(p.shape);
    const flatLength = (r.sheet!.base as { flatLength: number }).flatLength;
    expect(p.height).toBeCloseTo(40 - 3.5 + BA + 16.5, 4);
    expect(p.width).toBeCloseTo(flatLength, 4);
    expect(p.bends).toHaveLength(2);
    expect(p.volume).toBeCloseTo(kernel.massProps(r.body!.shape).volume, 2);
  });
});
