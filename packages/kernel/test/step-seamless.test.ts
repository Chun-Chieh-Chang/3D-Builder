/**
 * Fillets of round edges in STEP (2026-10-27): eDrawings drew the tori OCCT writes whole, closed by a seam edge, as the wrong part of the tube
 * (a concave fillet as three quarters of a ring, a convex one flaring out). The writer now cuts closed tori and spheres in two, as SolidWorks does;
 * the user checked the cut file in eDrawings. Cylinders and cones are left whole.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeId } from '../src';
import type { Frame, Region } from '../src/kernel';

let k: Kernel;
const live: ShapeId[] = [];
const keep = (id: ShapeId) => (live.push(id), id);
beforeAll(async () => {
  k = await Kernel.load();
});
afterAll(() => live.forEach((id) => k.release(id)));

const front: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const polygon = (pts: [number, number][]): Region => ({
  outer: pts.map((a, i) => ({ kind: 'line' as const, a, b: pts[(i + 1) % pts.length]!, source: `l${i}` })),
  holes: [],
});
const yAxis = { origin: [0, 0, 0] as [number, number, number], dir: [0, 1, 0] as [number, number, number] };

/** A stepped shaft (Ø40 × 60, Ø20 × 30) with every round edge filleted R2: two convex tori on the big end, one concave at the shoulder, one convex on the small end. */
const shaft = () => {
  const plain = keep(k.revolve(front, [polygon([[0, 0], [20, 0], [20, 60], [10, 60], [10, 90], [0, 90]])], yAxis, 2 * Math.PI).shape);
  const circles = k.topology(plain).edges.flatMap((e, i) => (e.curve === 'circle' ? [i] : []));
  return keep(k.fillet(plain, circles, 2).shape);
};

/** The faces of a STEP text on a surface of the given type, each with the curves of its edges. */
const facesOn = (text: string, surface: string) => {
  const ent = new Map<number, string>();
  for (const m of text.replace(/\r?\n/g, '').matchAll(/#(\d+)\s*=\s*([^;]*);/g)) ent.set(Number(m[1]), m[2]!);
  const refs = (s: string) => [...s.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  const faces: string[][] = [];
  for (const body of ent.values()) {
    if (!body.startsWith('ADVANCED_FACE')) continue;
    const r = refs(body);
    if (!ent.get(r[r.length - 1]!)!.startsWith(surface)) continue;
    faces.push(r.slice(0, -1).flatMap((bound) => refs(ent.get(refs(ent.get(bound)!)[0]!)!).map((oriented) => ent.get(refs(ent.get(refs(ent.get(oriented)!)[0]!)!)[2]!)!.split('(')[0]!.trim())));
  }
  return faces;
};

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('STEP export cuts closed tori and spheres in two', () => {
  it('writes each whole fillet torus as two faces without a seam; cylinders stay whole', () => {
    const s = shaft();
    const topo = k.topology(s);
    const tori = topo.faces.filter((f) => f.surface === 'torus').length;
    const cylinders = topo.faces.filter((f) => f.surface === 'cylinder').length;
    expect(tori).toBe(4);
    const warnings: string[] = [];
    const text = k.exportStep(s, 'shaft', 'MM', { warnings });
    expect(warnings).toEqual([]);
    const written = facesOn(text, 'TOROIDAL_SURFACE');
    expect(written).toHaveLength(2 * tori);
    for (const edges of written) {
      expect(edges).not.toContain('SEAM_CURVE');
      expect(edges).toHaveLength(4); // two half circles and two quarter arcs of the tube
    }
    expect(facesOn(text, 'CYLINDRICAL_SURFACE')).toHaveLength(cylinders);
    expect(facesOn(text, 'CYLINDRICAL_SURFACE').every((edges) => edges.includes('SEAM_CURVE'))).toBe(true);
  });

  it('reads back as the same solid: valid, the same volume and area, one more face for each torus', () => {
    const s = shaft();
    const back = keep(k.importStep(k.exportStep(s, 'shaft')).shape);
    expect(k.check(back).valid).toBe(true);
    const [a, b] = [k.massProps(s), k.massProps(back)];
    expect(a.volume).toBeGreaterThan(0);
    expect(rel(b.volume, a.volume)).toBeLessThan(1e-9);
    expect(rel(b.area, a.area)).toBeLessThan(1e-9);
    const before = k.topology(s).faces;
    const after = k.topology(back).faces;
    expect(after.length).toBe(before.length + before.filter((f) => f.surface === 'torus').length);
    expect(after.filter((f) => f.surface === 'cylinder').length).toBe(before.filter((f) => f.surface === 'cylinder').length);
  });

  it('gives both halves of a cut face its color, and the faces that were not cut theirs', () => {
    const s = shaft();
    const faces = k.topology(s).faces;
    const torus = faces.findIndex((f) => f.surface === 'torus');
    const cylinder = faces.findIndex((f) => f.surface === 'cylinder');
    const colors = faces.map((_, i) => (i === torus ? '#ff0000' : i === cylinder ? '#00aa33' : null));
    const c = k.readAssemblyStep(k.exportStep(s, 'shaft', 'MM', { faceColors: colors }));
    const p = c.prototypes[c.root]!;
    keep(p.shape!);
    const read = k.topology(p.shape!).faces;
    const colored = read.map((f, i) => ({ f, hex: p.faceColors![i] })).filter((x) => x.hex);
    expect(colored.map((x) => [x.f.surface, x.hex]).sort()).toEqual([['cylinder', '#00aa33'], ['torus', '#ff0000'], ['torus', '#ff0000']]);
    // the two red halves are the torus that was colored: together its area
    const red = colored.filter((x) => x.hex === '#ff0000').reduce((sum, x) => sum + x.f.area, 0);
    expect(rel(red, faces[torus]!.area)).toBeLessThan(1e-9);
  });

  it('cuts a whole sphere too, and leaves a shape without closed tori or spheres as it was', () => {
    const ball = keep(k.revolve(front, [{ outer: [{ kind: 'arc', c: [0, 0], r: 10, from: [0, -10], to: [0, 10], ccw: true, source: 'a' }, { kind: 'line', a: [0, 10], b: [0, -10], source: 'l' }], holes: [] }], yAxis, 2 * Math.PI).shape);
    const text = k.exportStep(ball, 'ball');
    expect(facesOn(text, 'SPHERICAL_SURFACE').length).toBe(2 * k.topology(ball).faces.filter((f) => f.surface === 'sphere').length);
    const back = keep(k.importStep(text).shape);
    expect(rel(k.massProps(back).volume, k.massProps(ball).volume)).toBeLessThan(1e-9);

    const block = keep(k.revolve(front, [polygon([[0, 0], [5, 0], [5, 8], [0, 8]])], yAxis, 2 * Math.PI).shape);
    const plain = keep(k.importStep(k.exportStep(block, 'block')).shape);
    expect(k.topology(plain).faces.length).toBe(k.topology(block).faces.length);
  });
});
