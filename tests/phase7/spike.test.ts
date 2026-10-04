/**
 * 7-0 (docs/phase7-plan.md): the technical validation of what sheet metal needs that the program does not have yet, each against what is worked out by hand. The risk
 * (blueprint §5, row 8): there is no ready algorithm that unfolds a sheet metal solid, so the plan builds sheet metal *feature-native* — the bend data is recorded when the
 * bend is made, and the flat pattern is worked out from it, not from the solid. This asks whether the solid can be built from a bend that way and whether the flat length the
 * bend data gives agrees with the solid: a bend is a revolved rectangle, a flange an extrusion, a plate an extrusion, a bent profile one extrusion of an outline with arcs.
 * What this finds is in ADR 0083.
 *
 * Sizes: thickness T = 1.5, inner bend radius r = 2, K-factor k = 0.4 (the bend allowance of an angle θ is θ·(r + k·T)); the plate is x 0..100, y 0..w (w = 50), z 0..T,
 * and the flange stands up from its x = 100 edge.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type Region, type Segment, type ShapeId } from '@3db/kernel';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});
afterAll(() => {
  void kernel;
});

const T = 1.5;
const r = 2;
const w = 50;
type V3 = [number, number, number];
const line = (a: [number, number], b: [number, number], source: string): Segment => ({ kind: 'line', a, b, source });
const rect = (x0: number, y0: number, x1: number, y1: number, id: string): Region => ({
  outer: [line([x0, y0], [x1, y0], `${id}.a`), line([x1, y0], [x1, y1], `${id}.b`), line([x1, y1], [x0, y1], `${id}.c`), line([x0, y1], [x0, y0], `${id}.d`)],
  holes: [],
});
const frame = (origin: V3, xDir: V3, yDir: V3): Frame => ({ origin, xDir, yDir, normal: [xDir[1] * yDir[2] - xDir[2] * yDir[1], xDir[2] * yDir[0] - xDir[0] * yDir[2], xDir[0] * yDir[1] - xDir[1] * yDir[0]] });
const volume = (s: ShapeId) => kernel.massProps(s).volume;

/** The plate: x 0..x0, y 0..width, z 0..T. */
const plate = (x0 = 100, width = w): ShapeId => kernel.extrude(frame([0, 0, 0], [1, 0, 0], [0, 1, 0]), [rect(0, 0, x0, width, 'plate')], [0, 0, T]).shape;
/** A bend of `angle` radians at the plate's edge x = x0 (the plate's top face is the inside): the rectangle y 0..width, z 0..T in the plane x = x0, turned about the axis y at z = T + r. */
const bend = (angle: number, x0 = 100, width = w, sign = 1): ShapeId =>
  kernel.revolve(frame([x0, 0, 0], [0, 1, 0], [0, 0, 1]), [rect(0, 0, width, T, 'bend')], { origin: [x0, 0, T + r], dir: [0, sign, 0] }, angle).shape;
/** A flange standing up from the end of a 90° bend: x x0 + r .. x0 + r + T, y 0..width, z T + r .. T + r + length. */
const flange = (length: number, x0 = 100, width = w): ShapeId => kernel.extrude(frame([x0 + r, 0, T + r], [1, 0, 0], [0, 1, 0]), [rect(0, 0, T, width, 'flange')], [0, 0, length]).shape;
const fuse = (...shapes: ShapeId[]) => shapes.slice(1).reduce((acc, s) => kernel.boolean('fuse', acc, s).shape, shapes[0]!);

describe('a bend is a revolved rectangle', () => {
  it.each([45, 90, 135, 180])('%i°: the volume is θ·T·w·(r + T/2) — the sheet bent about the axis, whatever the angle', (deg) => {
    const angle = (deg * Math.PI) / 180;
    const b = bend(angle);
    expect(volume(b)).toBeCloseTo(angle * T * w * (r + T / 2), 6);
    expect(kernel.isValid(b)).toBe(true);
  });

  it('turned the right way: about +y the section swings toward −x (back over the plate) and about −y toward +x; the 90° bend that goes on from the plate reaches x = 100 + r + T and z = T + r', () => {
    // the sign is found, not assumed: the one that swings out past the edge of the plate (max x > 100) is the way a flange grows from it
    const [plus, minus] = [kernel.bounds(bend(Math.PI / 2, 100, w, 1)), kernel.bounds(bend(Math.PI / 2, 100, w, -1))];
    expect(plus.max[0] > 100 + 1).not.toBe(minus.max[0] > 100 + 1);
    const good = plus.max[0] > 100 + 1 ? plus : minus;
    expect(good.max[0]).toBeCloseTo(100 + r + T, 6);
    expect(good.max[2]).toBeCloseTo(T + r, 6);
    expect(good.min[0]).toBeCloseTo(100, 6);
    expect(good.min[2]).toBeCloseTo(0, 6);
  });
});

describe('a plate, a bend and a flange make one sheet', () => {
  const sign = () => (kernel.bounds(bend(Math.PI / 2, 100, w, 1)).max[0] > 100 + 1 ? 1 : -1);

  it('fused: one valid solid of 100·50·1.5 + ½(π/2)((r + T)² − r²)·50 + 1.5·50·30 = 10073.98 mm³ whose corner is where it should be', () => {
    const s = fuse(plate(), bend(Math.PI / 2, 100, w, sign()), flange(30));
    expect(kernel.solidCount(s)).toBe(1);
    expect(kernel.isValid(s)).toBe(true);
    const hand = 100 * 50 * T + 0.5 * (Math.PI / 2) * ((r + T) ** 2 - r ** 2) * 50 + T * 50 * 30;
    expect(hand).toBeCloseTo(10073.98, 2);
    expect(volume(s)).toBeCloseTo(hand, 5);
    const b = kernel.bounds(s);
    expect(b.max[0]).toBeCloseTo(100 + r + T, 6);
    expect(b.max[2]).toBeCloseTo(T + r + 30, 6);
    // the faces: the plate has its two faces and four sides, the bend its two cylinders, the flange its two faces — the joints between them merge nothing away that matters
    const faces = kernel.topology(s).faces;
    expect(faces.filter((f) => f.surface === 'cylinder')).toHaveLength(2);
    expect(faces.filter((f) => f.surface === 'cylinder').map((f) => Math.round(f.area * 1000) / 1000).sort()).toEqual([Math.round(50 * (Math.PI / 2) * r * 1000) / 1000, Math.round(50 * (Math.PI / 2) * (r + T) * 1000) / 1000].sort());
  });

  it('the flat length the bend data gives (x0 + θ(r + kT) + L) is the solid\'s own where it can be checked: at k = 0.5 the volume is T × width × the flat length (the volume of a sheet is conserved)', () => {
    const s = fuse(plate(), bend(Math.PI / 2, 100, w, sign()), flange(30));
    const flat = (kk: number) => 100 + (Math.PI / 2) * (r + kk * T) + 30;
    expect(flat(0.5)).toBeCloseTo(134.3197, 4);
    expect(volume(s) / (T * w)).toBeCloseTo(flat(0.5), 6);
    // at k = 0.4 it is shorter by (π/2)·0.1·T: a K-factor is an input about the material, the solid cannot confirm it (ADR 0083)
    expect(flat(0.4)).toBeCloseTo(134.0841, 4);
    expect(flat(0.5) - flat(0.4)).toBeCloseTo((Math.PI / 2) * 0.1 * T, 9);
  });
});

describe('a bent profile is one extrusion of an outline with arcs', () => {
  // a U channel 60 outer wide and 20 outer high, 40 long, bent at the two lower corners (inner radius r)
  const R = r + T;
  const arc = (c: [number, number], rad: number, from: [number, number], to: [number, number], ccw: boolean, source: string): Segment => ({ kind: 'arc', c, r: rad, from, to, ccw, source });
  const outline: Segment[] = [
    line([0, 20], [0, R], 'left'),
    arc([R, R], R, [0, R], [R, 0], true, 'bend1.out'),
    line([R, 0], [60 - R, 0], 'bottom'),
    arc([60 - R, R], R, [60 - R, 0], [60, R], true, 'bend2.out'),
    line([60, R], [60, 20], 'right'),
    line([60, 20], [60 - T, 20], 'tipR'),
    line([60 - T, 20], [60 - T, R], 'rightIn'),
    arc([60 - R, R], r, [60 - T, R], [60 - R, T], false, 'bend2.in'),
    line([60 - R, T], [R, T], 'bottomIn'),
    arc([R, R], r, [R, T], [T, R], false, 'bend1.in'),
    line([T, R], [T, 20], 'leftIn'),
    line([T, 20], [0, 20], 'tipL'),
  ];

  it('the section is T × the centerline (k = 0.5): 2·(20 − R) + (60 − 2R) + 2·(π/2)(r + T/2) = 94.639 mm, so 141.96 mm² and 5678.3 mm³ over 40 — one valid solid with four cylinders', () => {
    const s = kernel.extrude(frame([0, 0, 0], [1, 0, 0], [0, 0, 1]), [{ outer: outline, holes: [] }], [0, -40, 0]).shape;
    const centerline = 2 * (20 - R) + (60 - 2 * R) + 2 * (Math.PI / 2) * (r + T / 2);
    expect(centerline).toBeCloseTo(94.639, 3);
    expect(kernel.solidCount(s)).toBe(1);
    expect(kernel.isValid(s)).toBe(true);
    expect(volume(s)).toBeCloseTo(T * centerline * 40, 5);
    expect(kernel.topology(s).faces.filter((f) => f.surface === 'cylinder')).toHaveLength(4);
  });
});

describe('two flanges on adjacent edges of the plate', () => {
  const sign = () => (kernel.bounds(bend(Math.PI / 2, 100, w, 1)).max[0] > 100 + 1 ? 1 : -1);
  /** The same bend and flange on the edge y = y0 (running along x, from x = 0 for `width`): the plane y = y0, its axis along x. */
  const bendY = (y0: number, width: number, s: number): ShapeId =>
    kernel.revolve(frame([0, y0, 0], [1, 0, 0], [0, 0, 1]), [rect(0, 0, width, T, 'bendY')], { origin: [0, y0, T + r], dir: [-s, 0, 0] }, Math.PI / 2).shape;
  const flangeY = (y0: number, width: number, length: number): ShapeId => kernel.extrude(frame([0, y0 + r, T + r], [1, 0, 0], [0, 1, 0]), [rect(0, 0, width, T, 'flangeY')], [0, 0, length]).shape;

  it('with the flanges as long as their edges they meet along one line at the corner: what the solid comes to is recorded (ADR 0083), not assumed', () => {
    const base = plate(100, 100);
    const a = fuse(bend(Math.PI / 2, 100, 100, sign()), flange(30, 100, 100));
    const b = fuse(bendY(100, 100, sign()), flangeY(100, 100, 30));
    expect(kernel.bounds(b).max[1]).toBeCloseTo(100 + r + T, 6);
    expect(kernel.bounds(b).max[2]).toBeCloseTo(T + r + 30, 6);
    const s = fuse(base, a, b);
    expect([kernel.solidCount(s), kernel.isValid(s)]).toEqual([1, true]);
    // the two flanges and their bends do not overlap anywhere (they meet in a line): the volume is the sum
    expect(volume(s)).toBeCloseTo(volume(base) + volume(a) + volume(b), 6);
  });

  it('with a gap of 0.5 at the corner (the flange on the y edge shortened) the sheet is one valid solid with a notch the size of the gap — the relief that stops the flanges tearing each other', () => {
    const base = plate(100, 100);
    const gap = 0.5;
    const a = fuse(bend(Math.PI / 2, 100, 100, sign()), flange(30, 100, 100));
    const b = fuse(bendY(100, 100 - gap, sign()), flangeY(100, 100 - gap, 30));
    const s = fuse(base, a, b);
    expect(kernel.solidCount(s)).toBe(1);
    expect(kernel.isValid(s)).toBe(true);
    expect(volume(s)).toBeCloseTo(volume(base) + volume(a) + volume(b), 6);
    // the shortened flange is shorter by gap × (what a section of the bend and the flange is: T·(θ(r + T/2) + 30))
    const section = T * ((Math.PI / 2) * (r + T / 2) + 30);
    const full = fuse(bendY(100, 100, sign()), flangeY(100, 100, 30));
    expect(volume(full) - volume(b)).toBeCloseTo(gap * section, 6);
  });
});
