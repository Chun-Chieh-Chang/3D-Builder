/**
 * `Kernel.analyticFace` (C4): a face stored as a B-spline read as the plane, cylinder, cone, sphere or torus it is. The truth is known without the code
 * under test: each body is made with real planes, cylinders, cones, spheres and tori, then every face is converted to a B-spline
 * (`Kernel.toBSpline`, exact for these), so each converted face must read as the surface the same face had before, with the same sizes and side. The
 * negative controls are a spline wall (no simple surface at any tolerance asked) and a cylinder moved off itself by a known amount: the weights of
 * its rational B-spline changed in the STEP text by δ, which moves the surface about 10·δ mm off a cylinder of radius 15.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, KernelError, type ShapeId, type SurfaceGeometry } from '../src';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
const poly = (pts: number[][]) => ({ outer: pts.map((a, i, p) => L(a, p[(i + 1) % p.length]!, 'q' + i)), holes: [] });
const disc = (r: number, h: number): ShapeId => kernel.extrude(XY as never, [{ outer: [{ kind: 'circle', c: [0, 0], r, source: 'c' }], holes: [] }] as never, [0, 0, h]).shape;
const turned = (pts: number[][]): ShapeId => kernel.revolve(XY as never, [poly(pts)] as never, { origin: [0, 0, 0], dir: [0, 1, 0] }, 2 * Math.PI).shape;

/** Each face of `shape`'s B-spline copy against the face of `shape` at the same place: read as the same surface. Returns how many were compared. */
function sameAsBefore(shape: ShapeId): number {
  const before = kernel.topology(shape);
  const spline = kernel.toBSpline(shape);
  try {
    const after = kernel.topology(spline);
    expect(after.faces.length).toBe(before.faces.length);
    after.faces.forEach((f, i) => {
      expect(f.geometry, 'the converted face has no simple surface of its own').toBeUndefined();
      // the face it was: the nearest one of about the same area. A spline face's area and centre come from OCCT's fixed rule, measured 2.7e-3 of the
      // area and 0.02 mm off on these bodies, so they only tell the faces apart; the sizes below are what is checked.
      const far = (b: (typeof before.faces)[number]) => Math.hypot(b.center[0] - f.center[0], b.center[1] - f.center[1], b.center[2] - f.center[2]);
      const was = before.faces.filter((b) => Math.abs(b.area - f.area) < 1e-2 * b.area).sort((x, y) => far(x) - far(y))[0];
      expect(was?.geometry, `face ${i}`).toBeDefined();
      expect(far(was!), `face ${i}`).toBeLessThan(0.05);
      const read = kernel.analyticFace(spline, i, 1e-6);
      expect(read, `face ${i} (${was!.geometry!.type})`).not.toBeNull();
      expect(read!.deviation).toBeLessThan(1e-9);
      const [g, w] = [read!.geometry, was!.geometry!] as [SurfaceGeometry, SurfaceGeometry];
      expect(g.type).toBe(w.type);
      const par = (a: number[], b: number[]) => expect(Math.abs(Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) - 1)).toBeLessThan(1e-9);
      if (g.type === 'plane' && w.type === 'plane') {
        // the outward normal, not only its line
        expect(g.normal[0] * w.normal[0] + g.normal[1] * w.normal[1] + g.normal[2] * w.normal[2]).toBeGreaterThan(1 - 1e-9);
      } else if (g.type === 'cylinder' && w.type === 'cylinder') {
        par(g.axis, w.axis);
        expect(Math.abs(g.radius - w.radius)).toBeLessThan(1e-9);
        expect(g.convex).toBe(w.convex);
      } else if (g.type === 'cone' && w.type === 'cone') {
        par(g.axis, w.axis);
        expect(Math.abs(Math.abs(g.halfAngle) - Math.abs(w.halfAngle))).toBeLessThan(1e-9);
        expect(Math.hypot(g.apex[0] - w.apex[0], g.apex[1] - w.apex[1], g.apex[2] - w.apex[2])).toBeLessThan(1e-7);
        expect(g.convex).toBe(w.convex);
      } else if (g.type === 'sphere' && w.type === 'sphere') {
        expect(Math.abs(g.radius - w.radius)).toBeLessThan(1e-9);
        expect(g.convex).toBe(w.convex);
      } else if (g.type === 'torus' && w.type === 'torus') {
        par(g.axis, w.axis);
        expect(Math.abs(g.major - w.major)).toBeLessThan(1e-9);
        expect(Math.abs(g.minor - w.minor)).toBeLessThan(1e-9);
        expect(g.convex).toBe(w.convex);
      }
    });
    return after.faces.length;
  } finally {
    kernel.release(spline);
  }
}

describe('a face stored as a B-spline, read as what it is', () => {
  it('planes: a box', () => {
    const s = kernel.extrude(XY as never, [poly([[0, 0], [40, 0], [40, 30], [0, 30]])] as never, [0, 0, 12]).shape;
    try {
      expect(sameAsBefore(s)).toBe(6);
    } finally {
      kernel.release(s);
    }
  });

  it('cylinders, outside and inside: a tube', () => {
    const outer = disc(15, 8);
    const inner = kernel.extrude({ ...XY, origin: [0, 0, -1] } as never, [{ outer: [{ kind: 'circle', c: [0, 0], r: 6, source: 'c' }], holes: [] }] as never, [0, 0, 10]).shape;
    const tube = kernel.boolean('cut', outer, inner).shape;
    try {
      expect(sameAsBefore(tube)).toBe(4);
      // the premise of "outside and inside": one of each
      expect(kernel.topology(tube).faces.flatMap((f) => (f.geometry?.type === 'cylinder' ? [f.geometry.convex] : [])).sort()).toEqual([false, true]);
    } finally {
      for (const id of [outer, inner, tube]) kernel.release(id);
    }
  });

  it('a cone and its caps: a turned taper', () => {
    const s = turned([[0, 0], [10, 0], [6, 12], [0, 12]]);
    try {
      expect(kernel.topology(s).faces.some((f) => f.geometry?.type === 'cone')).toBe(true);
      expect(sameAsBefore(s)).toBe(3);
    } finally {
      kernel.release(s);
    }
  });

  it('a torus and a cylinder: a disc with its rim rounded', () => {
    const d = disc(15, 8);
    const t = kernel.topology(d);
    const rim = t.edges.flatMap((e, i) => (e.geometry?.type === 'circle' && Math.abs(e.mid[2] - 8) < 1e-9 ? [i] : []));
    const s = kernel.fillet(d, rim, 2).shape;
    try {
      expect(kernel.topology(s).faces.some((f) => f.geometry?.type === 'torus')).toBe(true);
      expect(sameAsBefore(s)).toBe(4);
    } finally {
      for (const id of [d, s]) kernel.release(id);
    }
  });

  it('a sphere: a ball', () => {
    // half a disc of radius 9 turned about its straight side
    const half = { outer: [L([0, -9], [0, 9], 'a'), { kind: 'arc', c: [0, 0], r: 9, from: [0, 9], to: [0, -9], ccw: false, source: 'b' }], holes: [] };
    const s = kernel.revolve(XY as never, [half] as never, { origin: [0, 0, 0], dir: [0, 1, 0] }, 2 * Math.PI).shape;
    try {
      expect(kernel.topology(s).faces.map((f) => f.geometry?.type)).toEqual(['sphere']);
      expect(sameAsBefore(s)).toBe(1);
    } finally {
      kernel.release(s);
    }
  });
});

describe('what it is not', () => {
  it('a face that already has a simple surface: null', () => {
    const s = disc(15, 8);
    try {
      kernel.topology(s).faces.forEach((_, i) => expect(kernel.analyticFace(s, i, 1e-3)).toBeNull());
    } finally {
      kernel.release(s);
    }
  });

  it('a spline wall: null at every tolerance asked', () => {
    const wall = kernel.extrude(XY as never, [{ outer: [L([0, 0], [30, 0], 'a'), L([30, 0], [30, 20], 'b'), { kind: 'spline', points: [[30, 20], [14, 28], [0, 20]], source: 'c' }, L([0, 20], [0, 0], 'd')], holes: [] }] as never, [0, 0, 8]).shape;
    try {
      const i = kernel.topology(wall).faces.findIndex((f) => !f.geometry);
      expect(i).toBeGreaterThanOrEqual(0);
      for (const tol of [1e-6, 1e-4, 1e-2]) expect(kernel.analyticFace(wall, i, tol)).toBeNull();
    } finally {
      kernel.release(wall);
    }
  });

  it('a cylinder moved off itself by a known amount: read only when the tolerance allows it, and the deviation reported is the real one', () => {
    const d = disc(15, 8);
    const spline = kernel.toBSpline(d);
    const text = kernel.exportStep(spline, 'p');
    kernel.release(d);
    kernel.release(spline);
    for (const delta of [1e-6, 1e-5, 1e-4]) {
      // surface and edge curves alike: a consistent body that is no cylinder
      const moved = text.replace(/RATIONAL_B_SPLINE_(SURFACE|CURVE)\(\([\s\S]*?\)\)/g, (m) => m.replace(/\b0\.5\b/g, String(0.5 + delta)));
      expect(moved).not.toBe(text);
      const s = kernel.importStep(new TextEncoder().encode(moved)).shape;
      try {
        const side = kernel.topology(s).faces.findIndex((f) => Math.abs(f.center[2] - 4) < 1e-2);
        expect(side).toBeGreaterThanOrEqual(0);
        // off by about 10·δ: measured 1.00e-5, 1.00e-4, 1.00e-3
        const off = 10 * delta;
        expect(kernel.analyticFace(s, side, off / 5), `δ ${delta} below`).toBeNull();
        const loose = kernel.analyticFace(s, side, off * 5);
        expect(loose?.geometry.type, `δ ${delta} above`).toBe('cylinder');
        expect(loose!.deviation).toBeGreaterThan(off / 5);
        expect(loose!.deviation).toBeLessThanOrEqual(off * 5);
      } finally {
        kernel.release(s);
      }
    }
  });

  it('a tolerance that is no length is refused, not corrected', () => {
    const s = disc(15, 8);
    try {
      for (const bad of [0, -1e-6, NaN, Infinity]) expect(() => kernel.analyticFace(s, 0, bad)).toThrow(KernelError);
      expect(() => kernel.analyticFace(s, 99, 1e-6)).toThrow(KernelError);
    } finally {
      kernel.release(s);
    }
  });

  it('leaves no shape behind', () => {
    const d = disc(15, 8);
    const spline = kernel.toBSpline(d);
    const live = kernel.liveShapes;
    for (let i = 0; i < 3; i++) kernel.analyticFace(spline, i, 1e-6);
    expect(kernel.liveShapes).toBe(live);
    kernel.release(d);
    kernel.release(spline);
  });
});
