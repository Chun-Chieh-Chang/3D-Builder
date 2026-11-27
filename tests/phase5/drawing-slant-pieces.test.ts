/**
 * The pieces of one slanted plane, cut apart by a rib or a hole, are seen edge-on on one line. One angle sizes the plane: it is planned once, and it counts
 * for every piece (R1-16148, 2026-11-27: each 20.05° slope of the flange is cut in three by the ribs, and the section A-A had six angles where two are
 * enough). A parallel slant on another line is another plane and keeps its own angle.
 */
import { describe, expect, it } from 'vitest';
import { viewVectors } from '@3db/model';
import { dimensionCoverage, planDrawingDimensions, sameSlantLine, type DimensionLike, type ViewToDimension } from '@3db/drawing';

const ref = (name: string) => ({ kind: 'face' as const, name });
const t = Math.tan((20 * Math.PI) / 180);
const dir: [number, number] = [1 / Math.hypot(1, t), t / Math.hypot(1, t)];
/** A slant through (x, y0 + t·x): its pieces sit at different x on one line. */
const slant = (name: string, x: number, y0: number, area: number) => ({ type: 'slant' as const, ref: ref(name), at: [x, y0 + t * x] as [number, number], dir, area });
const plane = (name: string, axis: 'x' | 'y', coord: number) => ({ type: 'plane' as const, ref: ref(name), axis, coord, area: 60 });
const views = (features: object[]): ViewToDimension[] => [{ viewId: 'v', axes: viewVectors('front'), features } as unknown as ViewToDimension];

const pieces = [slant('top#1', 2, 10, 12), slant('top#2', 8, 10, 30), slant('top#3', 14, 10, 12)];
const other = slant('bottom', 8, -10, 30);
const datum = [plane('left', 'x', 0), plane('base', 'y', -20)];
const angles = (p: ReturnType<typeof planDrawingDimensions>) => p.filter((x) => (x.draft as { kind: string }).kind === 'angle');

describe('pieces of one slanted plane', () => {
  it('sameSlantLine: pieces on one line are; a parallel line, a crossing one, a cone are not', () => {
    expect(sameSlantLine(pieces[0]!, pieces[2]!)).toBe(true);
    expect(sameSlantLine(pieces[0]!, other)).toBe(false);
    expect(sameSlantLine(pieces[0]!, { ...pieces[2]!, dir: [dir[1], -dir[0]] })).toBe(false);
    expect(sameSlantLine(pieces[0]!, { ...pieces[2]!, cone: { side: 1, from: [0, 0], to: [1, 1], axial: 1, radial: 1 } })).toBe(false);
  });

  it('plans one angle for the plane, on its largest piece, and one for the parallel plane on another line', () => {
    const planned = planDrawingDimensions(views([...pieces, other, ...datum]), [], {});
    const a = angles(planned).map((p) => (p.draft as unknown as { a: { name: string } }).a.name).sort();
    expect(a, JSON.stringify(planned.map((p) => p.draft))).toEqual(['bottom', 'top#2']);
  });

  it('counts every piece determined by an angle on one of them; the parallel plane stays missing until it has its own', () => {
    const v = views([...pieces, other, ...datum]);
    const onPiece = { kind: 'angle', view: 'v', a: ref('top#1'), b: ref('left'), arc: 6 } as unknown as DimensionLike;
    expect(dimensionCoverage(v, [onPiece]).slants).toEqual({ total: 4, determined: 3, missing: ['bottom'] });
    const onOther = { kind: 'angle', view: 'v', a: ref('bottom'), b: ref('left'), arc: 6 } as unknown as DimensionLike;
    expect(dimensionCoverage(v, [onPiece, onOther]).slants).toEqual({ total: 4, determined: 4, missing: [] });
  });
});
