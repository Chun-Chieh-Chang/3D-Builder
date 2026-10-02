/**
 * 3b-5c: measuring (E1.1) on shapes whose answers are known: what an element is (area, length, radius, direction), the exact shortest distance and the angle
 * between two elements, and the same when the parts are placed (and mirrored) as an assembly has them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { angleBetween, axisAngle, measureReport, placementRows, type MeasureTarget, type Pose } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Regenerator, measureTargets } from '@3db/regen';
import { build, circle, extrude, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
const shapes: Record<string, ShapeId> = {};

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  const make = (doc: ReturnType<typeof build>) => {
    const regen = new Regenerator(kernel, solver);
    kept.push(regen);
    return regen.rebuild(doc).body!.shape;
  };
  shapes.box = make(build(sketch('s', front, rectangle('r', 0, 0, 10, 20)), extrude('e', 's', 'boss', { type: 'blind', depth: '30' })));
  shapes.pin = make(build(sketch('s', front, circle('c', 0, 0, 7)), extrude('e', 's', 'boss', { type: 'blind', depth: '25' })));
});
afterAll(() => kept.forEach((r) => r.dispose()));

const at = (part: string, kind: MeasureTarget['kind'], index: number, pose: Pose | null = null, mirrored = false): MeasureTarget => ({ part, mirrored, pose, kind, index });
const measure = (...targets: MeasureTarget[]) => measureTargets(kernel, (t) => shapes[t.part ?? ''] ?? null, targets);
const topo = (part: string) => kernel.topology(shapes[part]!);
/** The planar face of a part whose normal is `n`. */
const faceWith = (part: string, n: [number, number, number]) => topo(part).faces.findIndex((f) => f.normal && f.normal.every((v, i) => Math.abs(v - n[i]!) < 1e-9));
const translate = (position: [number, number, number]): Pose => ({ position, rotation: [0, 0, 0, 1] });

describe('what one element is (3b-5c)', () => {
  it('a face of a block: its area, its kind, its normal as the direction', () => {
    const info = topo('box').faces;
    for (const [i, f] of info.entries()) {
      const r = measure(at('box', 'face', i));
      expect(r.elements[0]!.type).toBe('plane');
      expect(r.elements[0]!.area).toBeCloseTo(f.area, 9);
      expect(r.elements[0]!.direction).toEqual(f.normal);
    }
    // the three sizes of the block (10 × 20 × 30) give the face areas 200, 300 and 600
    expect([...new Set(info.map((f) => Math.round(f.area)))].sort((a, b) => a - b)).toEqual([200, 300, 600]);
  });

  it('a cylinder: its radius, its axis; the circle at its end: radius and length', () => {
    const t = topo('pin');
    const side = t.faces.findIndex((f) => f.surface === 'cylinder');
    const side$ = measure(at('pin', 'face', side)).elements[0]!;
    expect(side$.radius).toBeCloseTo(7, 9);
    expect(side$.area).toBeCloseTo(2 * Math.PI * 7 * 25, 6);
    const circleIndex = t.edges.findIndex((e) => e.curve === 'circle');
    const edge = measure(at('pin', 'edge', circleIndex)).elements[0]!;
    expect(edge.radius).toBeCloseTo(7, 9);
    expect(edge.length).toBeCloseTo(2 * Math.PI * 7, 9);
    // the axis of the cylinder and the normal of a cap are the same way: the angle between them is 0
    const cap = t.faces.findIndex((f) => f.surface === 'plane');
    expect(measure(at('pin', 'face', side), at('pin', 'face', cap)).angle).toBeCloseTo(0, 6);
  });

  it('a vertex: its place', () => {
    const v = topo('box').vertices[3]!;
    const r = measure(at('box', 'vertex', 3));
    expect(r.elements[0]!.point).toEqual(v.point);
    expect(r.distance).toBeNull();
    expect(r.angle).toBeNull();
  });
});

describe('two elements (3b-5c)', () => {
  it('the faces at the two ends of a block: the distance is its depth, the angle is 0', () => {
    const top = faceWith('box', [0, 0, 1]);
    const bottom = faceWith('box', [0, 0, -1]);
    const r = measure(at('box', 'face', top), at('box', 'face', bottom));
    expect(r.distance!.value).toBeCloseTo(30, 9);
    expect(Math.abs(r.distance!.delta[2])).toBeCloseTo(30, 9);
    expect(r.angle).toBeCloseTo(0, 9);
  });

  it('two faces that meet at an edge: the distance is 0 and the angle is 90', () => {
    const r = measure(at('box', 'face', faceWith('box', [0, 0, 1])), at('box', 'face', faceWith('box', [1, 0, 0])));
    expect(r.distance!.value).toBeCloseTo(0, 9);
    expect(r.angle).toBeCloseTo(90, 9);
  });

  it('the corners of a block that are farthest apart: the diagonal, and the differences along the axes', () => {
    const v = topo('box').vertices;
    let best = { i: 0, j: 0, d: -1 };
    for (const [i, a] of v.entries()) for (const [j, b] of v.entries()) if (Math.hypot(...a.point.map((x, k) => x - b.point[k]!) as [number, number, number]) > best.d) best = { i, j, d: Math.hypot(...a.point.map((x, k) => x - b.point[k]!) as [number, number, number]) };
    const r = measure(at('box', 'vertex', best.i), at('box', 'vertex', best.j));
    expect(r.distance!.value).toBeCloseTo(Math.hypot(10, 20, 30), 9);
    expect(r.distance!.delta.map(Math.abs).sort((a, b) => a - b)).toEqual([10, 20, 30].map((x) => expect.closeTo(x, 9)));
  });

  it('a vertex and a face: the exact distance to the plane, not to a point of it', () => {
    const top = faceWith('box', [0, 0, 1]);
    const topZ = topo('box').faces[top]!.center[2];
    // a corner at the other end of the block
    const far = topo('box').vertices.findIndex((p) => Math.abs(p.point[2] - topZ) > 1);
    expect(measure(at('box', 'vertex', far), at('box', 'face', top)).distance!.value).toBeCloseTo(30, 9);
  });
});

describe('parts placed as an assembly has them (3b-5c)', () => {
  it('a part moved along a face normal: the distance between the faces is what it was moved', () => {
    const top = faceWith('box', [0, 0, 1]);
    const r = measure(at('box', 'face', top), at('box', 'face', top, translate([0, 0, 100])));
    expect(r.distance!.value).toBeCloseTo(100, 9);
    expect(r.angle).toBeCloseTo(0, 9);
  });

  it('a part turned 30 degrees: the angle between its face and the same face of the part as it was', () => {
    const top = faceWith('box', [0, 0, 1]);
    const turned: Pose = { position: [0, 0, 0], rotation: axisAngle([0, 1, 0], Math.PI / 6) };
    const r = measure(at('box', 'face', top), at('box', 'face', top, turned));
    expect(r.angle).toBeCloseTo(30, 6);
    // its positions are in the assembly's frame: the element's point is the part's, turned
    const point = measure(at('box', 'vertex', 2, turned)).elements[0]!.point;
    const p = topo('box').vertices[2]!.point;
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    expect(point[0]).toBeCloseTo(c * p[0] + s * p[2], 9);
    expect(point[1]).toBeCloseTo(p[1], 9);
    expect(point[2]).toBeCloseTo(-s * p[0] + c * p[2], 9);
  });

  it('a mirrored part: the element is the same one (same number) on the other side of x = 0', () => {
    const v = topo('box').vertices[5]!.point;
    const r = measure(at('box', 'vertex', 5, null, true));
    expect(r.elements[0]!.point[0]).toBeCloseTo(-v[0], 9);
    expect(r.elements[0]!.point[1]).toBeCloseTo(v[1], 9);
    expect(r.elements[0]!.point[2]).toBeCloseTo(v[2], 9);
    // and with a pose: the mirror first, then the pose
    const pose = translate([100, 0, 0]);
    expect(measure(at('box', 'vertex', 5, pose, true)).elements[0]!.point[0]).toBeCloseTo(100 - v[0], 9);
    // a mirror turns a normal the other way, and not a direction's angle
    const side = faceWith('box', [1, 0, 0]);
    expect(measure(at('box', 'face', side, null, true)).elements[0]!.direction![0]).toBeCloseTo(-1, 9);
  });
});

describe('what cannot be measured (3b-5c)', () => {
  it('an element that is not there, a part that is not built, and the wrong number of elements are refused', () => {
    expect(() => measure(at('box', 'face', 999))).toThrow();
    expect(() => measure(at('nothing', 'face', 0))).toThrow();
    expect(() => measure()).toThrow();
    expect(() => measure(at('box', 'face', 0), at('box', 'face', 1), at('box', 'face', 2))).toThrow();
  });

  it('makes nothing that stays: the shapes it made are released', () => {
    const before = kernel.liveShapes;
    measure(at('box', 'face', 0, translate([1, 2, 3])), at('box', 'face', 1, translate([4, 5, 6]), true));
    expect(kernel.liveShapes).toBe(before);
    expect(() => measure(at('box', 'face', 999, translate([1, 2, 3])))).toThrow();
    expect(kernel.liveShapes).toBe(before); // also when it fails half-way
  });
});

describe('the pieces (3b-5c)', () => {
  it('the angle is the acute one, whichever way the directions point', () => {
    expect(angleBetween([0, 0, 1], [0, 0, -1])).toBeCloseTo(0, 9);
    expect(angleBetween([1, 0, 0], [1, 1, 0])).toBeCloseTo(45, 9);
    expect(angleBetween([1, 0, 0], [-1, 1, 0])).toBeCloseTo(45, 9);
    expect(angleBetween([0, 0, 0], [1, 0, 0])).toBeNaN();
  });

  it('no angle when one element has no direction (a vertex, a freeform face)', () => {
    const a = { kind: 'vertex' as const, type: 'point', point: [0, 0, 0] as [number, number, number], area: null, length: null, radius: null, direction: null };
    expect(measureReport([a, { ...a, direction: [0, 0, 1] }], { distance: 1, pointA: [0, 0, 0], pointB: [0, 0, 1] }).angle).toBeNull();
  });

  it('the placement matrix of a pose: a rotation and a translation, flipped in x when mirrored', () => {
    const pose: Pose = { position: [1, 2, 3], rotation: axisAngle([0, 0, 1], Math.PI / 2) };
    const m = placementRows(pose, false);
    // a turn of 90 degrees about z takes x to y: the first column is (0, 1, 0)
    expect([m[0], m[4], m[8]].map((v) => Math.round(v!))).toEqual([0, 1, 0]);
    expect([m[3], m[7], m[11]]).toEqual([1, 2, 3]);
    const mm = placementRows(pose, true);
    expect([mm[0], mm[4], mm[8]].map((v) => Math.round(v!) + 0)).toEqual([0, -1, 0]);
    expect([mm[3], mm[7], mm[11]]).toEqual([1, 2, 3]);
  });
});
