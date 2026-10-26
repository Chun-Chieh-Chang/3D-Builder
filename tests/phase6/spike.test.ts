/**
 * 6-0 (docs/phase6-plan.md): the technical validation of what a plastic part needs that the program does not have yet, each against what is worked out by hand. The risks
 * (blueprint §5): the analyses (E3.2 draft, E3.3 undercut, E3.5 thickness) have no OCCT call to lean on — they are worked out here from the mesh and checked on bodies
 * whose answer is known; the unequal wall (C5.4) is not something OCCT's shell does (one thickness for the whole body), so it is tried as a shell followed by moving the inner
 * faces (ADR 0003: no face-offset operation, the program's own `moveFace`); the lip and the groove (C4.11) lean on the offset of a wire (`BRepOffsetAPI_MakeOffset`).
 * What this finds is in ADR 0074.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Feature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, circle, extrude, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const body = (doc: ReturnType<typeof build>): ShapeId => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  const r = regen.rebuild(doc);
  expect(r.features.filter((f) => f.status !== 'ok').map((f) => f.message)).toEqual([]);
  return r.body!.shape;
};
const on = (name: string) => ({ kind: 'datum', name }) as const;
const raw = () => kernel as unknown as { oc: any; get(id: ShapeId): any; put(s: unknown): ShapeId }; // eslint-disable-line @typescript-eslint/no-explicit-any
const deg = (rad: number) => (rad * 180) / Math.PI;

type V3 = [number, number, number];
interface Triangle {
  face: number;
  a: V3;
  b: V3;
  c: V3;
  n: V3;
  area: number;
  centre: V3;
}
const sub = (p: V3, q: V3): V3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];

/** The triangles of a shape's mesh, each with the face it is of, its outward normal (the mesh's own, from the surface) and area. */
function triangles(shape: ShapeId, tolerance = 0.02, angular = 0.2): Triangle[] {
  const m = kernel.mesh(shape, { tolerance, angular });
  const out: Triangle[] = [];
  for (let r = 0; r < m.faceRanges.length; r += 3) {
    const [start, count, face] = [m.faceRanges[r]!, m.faceRanges[r + 1]!, m.faceRanges[r + 2]!];
    for (let i = start; i < start + count; i += 3) {
      const at = (k: number): V3 => [m.positions[3 * m.indices[i + k]!]!, m.positions[3 * m.indices[i + k]! + 1]!, m.positions[3 * m.indices[i + k]! + 2]!];
      const nat = (k: number): V3 => [m.normals[3 * m.indices[i + k]!]!, m.normals[3 * m.indices[i + k]! + 1]!, m.normals[3 * m.indices[i + k]! + 2]!];
      const [a, b, c] = [at(0), at(1), at(2)];
      const cr = cross(sub(b, a), sub(c, a));
      const area = Math.hypot(...cr) / 2;
      if (area < 1e-12) continue;
      // the normal of the triangle itself (the mesh's own vertex normals are averaged from its triangles and are less true on a curved face), turned to the side the mesh's own normal points to
      const s = [0, 1, 2].map(nat);
      const mean: V3 = [s[0]![0] + s[1]![0] + s[2]![0], s[0]![1] + s[1]![1] + s[2]![1], s[0]![2] + s[1]![2] + s[2]![2]];
      const flip = dot(cr, mean) < 0 ? -1 : 1;
      const len = Math.hypot(...cr);
      const n: V3 = [(cr[0] * flip) / len, (cr[1] * flip) / len, (cr[2] * flip) / len];
      out.push({ face, a, b, c, n, area, centre: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3] });
    }
  }
  return out;
}

/** Möller–Trumbore: the distance along the ray (origin o, unit direction d) to the triangle, or Infinity. */
function hit(o: V3, d: V3, t: Triangle): number {
  const e1 = sub(t.b, t.a);
  const e2 = sub(t.c, t.a);
  const p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-14) return Infinity;
  const inv = 1 / det;
  const s = sub(o, t.a);
  const u = dot(s, p) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return Infinity;
  const q = cross(s, e1);
  const v = dot(d, q) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return Infinity;
  const dist = dot(e2, q) * inv;
  return dist > 0 ? dist : Infinity;
}

/**
 * The normals of the surface itself at the nodes of the mesh of each face (not the mesh's own, which are averaged from its triangles): the surface is evaluated at the
 * nodes' (u, v) (`BRepLProp_SLProps`), turned outward on a reversed face. Per face: the points and normals.
 */
function surfaceNormals(shape: ShapeId, tolerance = 0.02, angular = 0.2): Map<number, { point: V3; normal: V3 }[]> {
  const { oc } = raw();
  kernel.mesh(shape, { tolerance, angular }); // makes the triangulation of every face
  const out = new Map<number, { point: V3; normal: V3 }[]>();
  const faces = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  oc.TopExp.MapShapes(raw().get(shape), 'TopAbs_FACE', faces);
  for (let i = 1; i <= faces.Extent(); i++) {
    const face = oc.TopoDS.Face(faces.FindKey(i));
    const loc = new oc.TopLoc_Location();
    const tri = oc.BRep_Tool.Triangulation(face, loc, 0);
    if (!tri || !tri.HasUVNodes()) continue;
    const trsf = loc.Transformation();
    const surface = new oc.BRepAdaptor_Surface(face, true);
    const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    const list: { point: V3; normal: V3 }[] = [];
    for (let n = 1; n <= tri.NbNodes(); n++) {
      const uv = tri.UVNode(n);
      const props = new oc.BRepLProp_SLProps(surface, uv.X(), uv.Y(), 1, 1e-9);
      if (!props.IsNormalDefined()) continue;
      const nd = props.Normal();
      const p = tri.Node(n).Transformed(trsf);
      const nn = new oc.gp_Vec(nd.X(), nd.Y(), nd.Z());
      nn.Transform(trsf);
      const s = reversed ? -1 : 1;
      list.push({ point: [p.X(), p.Y(), p.Z()], normal: [s * nn.X(), s * nn.Y(), s * nn.Z()] });
    }
    out.set(i - 1, list);
  }
  return out;
}

describe('draft analysis (E3.2): the angle of every wall to the way the mold opens, from the normals of the mesh', () => {
  /** For each face, the draft angles (radians) of the triangles' normals to the pull direction: asin(n · pull), positive when the wall leans so the part comes out the pull way. */
  const draftOf = (shape: ShapeId, pull: V3, angular = 0.2) => {
    const per = new Map<number, { min: number; max: number; area: number }>();
    for (const [face, samples] of surfaceNormals(shape, 0.02, angular)) {
      let min = Infinity;
      let max = -Infinity;
      for (const s of samples) {
        const a = Math.asin(Math.max(-1, Math.min(1, dot(s.normal, pull))));
        min = Math.min(min, a);
        max = Math.max(max, a);
      }
      per.set(face, { min, max, area: 0 });
    }
    return per;
  };
  /** The four classes of SolidWorks's draft analysis for a required angle: positive, negative, draft required (between), straddle (both signs). */
  const classify = (s: { min: number; max: number }, required: number) =>
    s.min >= required ? 'positive' : s.max <= -required ? 'negative' : s.min < -required && s.max > required ? 'straddle' : 'required';

  it('a block drawn with 3° on its walls (narrowing along the pull): the four walls are 3°, the top 90°, the bottom −90°; with 1° required: the walls positive', () => {
    const drafted = body(build(sketch('s', front, rectangle('r', -20, -15, 40, 30)), { ...extrude('e', 's', 'boss', { type: 'blind', depth: '20' }), draft1: { angle: '3deg', inward: true } } as Feature));
    const per = draftOf(drafted, [0, 0, 1]);
    const faces = kernel.topology(drafted).faces;
    let walls = 0;
    for (const [face, s] of per) {
      const normal = faces[face]!.normal!;
      if (Math.abs(normal[2]) < 0.5) {
        walls++;
        expect(deg(s.min)).toBeCloseTo(3, 4);
        expect(deg(s.max)).toBeCloseTo(3, 4);
        expect(classify(s, (1 * Math.PI) / 180)).toBe('positive');
      }
    }
    expect(walls).toBe(4);
    // the same walls seen from the other way up lean the wrong way: negative
    for (const [face, s] of draftOf(drafted, [0, 0, -1])) if (Math.abs(faces[face]!.normal![2]) < 0.5) expect(classify(s, (1 * Math.PI) / 180)).toBe('negative');
  });

  it('a cylinder standing along the pull has 0° walls: draft required; a cone of 5° half angle is 5°; a sphere straddles', () => {
    const cylinder = body(build(sketch('s', front, circle('c', 0, 0, 10)), extrude('e', 's', 'boss', { type: 'blind', depth: '20' })));
    const wall = [...draftOf(cylinder, [0, 0, 1])].find(([face]) => kernel.topology(cylinder).faces[face]!.surface === 'cylinder')![1];
    expect(Math.abs(wall.min)).toBeLessThan(1e-9);
    expect(classify(wall, (1 * Math.PI) / 180)).toBe('required');
    body(build(sketch('s', front, circle('c', 0, 0, 10)), { ...extrude('e', 's', 'boss', { type: 'blind', depth: '20' }), draft1: { angle: '5deg', inward: true } } as Feature));
    // the angle comes from the normals of the surface itself, at the nodes of the mesh: as exact as the surface (the triangle's own normal, or the mesh's averaged one, is 0.1° out here)
    const error = (angular: number) => {
      // a mesh is made once for a shape: each fineness is a shape of its own
      const own = body(build(sketch('s', front, circle('c', 0, 0, 10)), { ...extrude('e', 's', 'boss', { type: 'blind', depth: '20' }), draft1: { angle: '5deg', inward: true } } as Feature));
      const side = [...draftOf(own, [0, 0, 1], angular)].find(([face]) => kernel.topology(own).faces[face]!.surface === 'cone')![1];
      return Math.max(Math.abs(deg(side.min) - 5), Math.abs(deg(side.max) - 5));
    };
    const coarse = error(0.2);
    const fine = error(0.05);
    expect(coarse).toBeLessThan(1e-6);
    expect(fine).toBeLessThan(1e-6);
    const sphere = raw().put(new (raw().oc.BRepPrimAPI_MakeSphere)(15).Shape());
    const s = [...draftOf(sphere, [0, 0, 1])][0]![1];
    expect(classify(s, (1 * Math.PI) / 180)).toBe('straddle');
  });
});

describe('undercut analysis (E3.3): what cannot be seen along the pull, either way, by rays against the mesh', () => {
  /** Whether each face can be reached from `+pull` and from `−pull`: from a point just off the surface (along its normal) a ray along the direction meets nothing. Returns, per face, the share of its area that is clear each way. */
  function visibility(shape: ShapeId, pull: V3) {
    const tris = triangles(shape);
    const per = new Map<number, { up: number; down: number; area: number }>();
    for (const t of tris) {
      const o: V3 = [t.centre[0] + t.n[0] * 1e-4, t.centre[1] + t.n[1] * 1e-4, t.centre[2] + t.n[2] * 1e-4];
      const clear = (d: V3) => !tris.some((u) => u !== t && hit(o, d, u) < Infinity);
      const s = per.get(t.face) ?? { up: 0, down: 0, area: 0 };
      per.set(t.face, { up: s.up + (clear(pull) ? t.area : 0), down: s.down + (clear([-pull[0], -pull[1], -pull[2]]) ? t.area : 0), area: s.area + t.area });
    }
    return per;
  }

  it('a block 40 × 30 × 20 with a Ø6 hole across it (along x, at z = 10), pulled along z: the top is clear from above, the bottom from below, the four sides both ways, and the whole wall of the hole is an undercut', () => {
    const holed = body(
      build(sketch('s', front, rectangle('r', -20, -15, 40, 30)), extrude('e', 's', 'boss', { type: 'blind', depth: '20' }), sketch('h', on('plane:right'), circle('c', -10, 0, 3)), {
        ...extrude('x', 'h', 'cut', { type: 'throughAll' }),
        dir2: { type: 'throughAll' },
      } as Feature),
    );
    const topo = kernel.topology(holed);
    const per = visibility(holed, [0, 0, 1]);
    for (const [face, v] of per) {
      const f = topo.faces[face]!;
      const clearUp = v.up / v.area;
      const clearDown = v.down / v.area;
      if (f.surface === 'cylinder') {
        // the wall of the hole: every part of it is hidden both ways, but for the lines where it runs along the pull (the sampling of the mesh may miss or catch them)
        expect(clearUp).toBeLessThan(0.05);
        expect(clearDown).toBeLessThan(0.05);
        expect(f.area).toBeCloseTo(2 * Math.PI * 3 * 40, 0);
      } else if (f.normal![2] > 0.99) expect([clearUp, clearDown]).toEqual([expect.closeTo(1, 6), expect.closeTo(0, 6)]);
      else if (f.normal![2] < -0.99) expect([clearUp, clearDown]).toEqual([expect.closeTo(0, 6), expect.closeTo(1, 6)]);
      else expect([clearUp, clearDown], `side face ${face}`).toEqual([expect.closeTo(1, 6), expect.closeTo(1, 6)]);
    }
  });

  it('the same block with the hole along the pull instead (a hole in the top, through): nothing is an undercut — the wall of the hole is clear both ways', () => {
    const holed = body(
      build(sketch('s', front, rectangle('r', -20, -15, 40, 30)), extrude('e', 's', 'boss', { type: 'blind', depth: '20' }), sketch('h', on('plane:front'), circle('c', 0, 0, 3)), extrude('x', 'h', 'cut', { type: 'throughAll', reverse: true })),
    );
    const topo = kernel.topology(holed);
    const wall = [...visibility(holed, [0, 0, 1])].find(([face]) => topo.faces[face]!.surface === 'cylinder')![1];
    expect(wall.up / wall.area).toBeGreaterThan(0.95);
    expect(wall.down / wall.area).toBeGreaterThan(0.95);
  });
});

describe('thickness analysis (E3.5): the distance through the wall, by a ray along the inward normal to the other surface', () => {
  /** For each triangle, the distance from its centre along −normal (into the material) to the next surface; Infinity when it meets none. */
  function thickness(shape: ShapeId) {
    const tris = triangles(shape);
    return tris.map((t) => {
      const o: V3 = [t.centre[0] - t.n[0] * 1e-4, t.centre[1] - t.n[1] * 1e-4, t.centre[2] - t.n[2] * 1e-4];
      const d: V3 = [-t.n[0], -t.n[1], -t.n[2]];
      let best = Infinity;
      for (const u of tris) if (u !== t) best = Math.min(best, hit(o, d, u));
      return { face: t.face, centre: t.centre, n: t.n, area: t.area, distance: best + 1e-4 };
    });
  }

  it('a box 60 × 40 × 30 shelled open at the top, 2 thick: every wall, inside and out, is 2 thick (floor and walls) to 1e-5; the rim, seen along its normal, is the height of the wall', () => {
    const box = body(build(sketch('s', front, rectangle('r', -30, -20, 60, 40)), extrude('e', 's', 'boss', { type: 'blind', depth: '30' })));
    const topo = kernel.topology(box);
    const top = topo.faces.findIndex((f) => f.normal && f.normal[2] > 0.99);
    const shelled = kernel.shell(box, [top], 2, false).shape;
    const rows = thickness(shelled);
    const faces = kernel.topology(shelled).faces;
    // the rim (the face round the opening) is not a wall seen across: through it the ray runs down the whole wall, 30 (floor to rim) — it comes out as thick, which it is
    for (const r of rows) {
      const f = faces[r.face]!;
      const rim = f.normal![2] > 0.99 && Math.abs(r.centre[2] - 30) < 1e-6;
      expect(r.distance, `face ${r.face} (${f.surface}) at ${r.centre.map((v) => v.toFixed(1))}`).toBeCloseTo(rim ? 30 : 2, 5);
    }
  });

  it('a plate whose thickness runs 2 to 6 along 40: from the flat side the ray gives the height there, 2 + 0.1·x; from the sloping side √1.01 times the height there', () => {
    // the profile drawn in the front plane (x, y), 20 thick in z: (0,0) (40,0) (40,6) (0,2)
    const pts: [number, number][] = [[0, 0], [40, 0], [40, 6], [0, 2]];
    const wedge = body(
      build(
        {
          id: 'w',
          type: 'sketch',
          name: 'w',
          suppressed: false,
          plane: front,
          entities: [
            ...pts.map(([x, y], i) => ({ id: `p${i}`, type: 'point', x, y }) as const),
            ...pts.map((_, i) => ({ id: `l${i}`, type: 'line', p1: `p${i}`, p2: `p${(i + 1) % 4}` }) as const),
          ],
          constraints: [],
        } as Feature,
        extrude('e', 'w', 'boss', { type: 'blind', depth: '20' }),
      ),
    );
    const topo = kernel.topology(wedge);
    const flat = topo.faces.findIndex((f) => f.normal && f.normal[1] < -0.99);
    const slope = topo.faces.findIndex((f) => f.normal && f.normal[1] > 0.9 && f.normal[1] < 0.999);
    expect(flat).toBeGreaterThanOrEqual(0);
    expect(slope).toBeGreaterThanOrEqual(0);
    const rows = thickness(wedge);
    for (const r of rows.filter((x) => x.face === flat && x.centre[0] < 39)) expect(r.distance).toBeCloseTo(2 + 0.1 * r.centre[0], 5);
    for (const r of rows.filter((x) => x.face === slope && x.centre[0] < 30)) expect(r.distance).toBeCloseTo((2 + 0.1 * r.centre[0]) * Math.sqrt(1.01), 4);
  });
});

describe('an unequal wall (C5.4): the shell, then the inner floor moved up', () => {
  it('a box 60 × 40 × 30 shelled 2 and its inner floor moved 2 up (the floor 4 thick, the walls 2): 72000 − 56·36·26 = 19584, valid, with the same faces', () => {
    const box = body(build(sketch('s', front, rectangle('r', -30, -20, 60, 40)), extrude('e', 's', 'boss', { type: 'blind', depth: '30' })));
    const topo = kernel.topology(box);
    const top = topo.faces.findIndex((f) => f.normal && f.normal[2] > 0.99);
    const bottom = topo.faces.findIndex((f) => f.normal && f.normal[2] < -0.99);
    const uniform = kernel.shell(box, [top], 2, false);
    expect(kernel.massProps(uniform.shape).volume).toBeCloseTo(72000 - 56 * 36 * 28, 6);
    // the inner face that lies against the outer floor: the one generated from it
    const inner = uniform.faceOrigins.findIndex((o) => o.some((x) => x.rel === 'generated' && x.kind === 'face' && x.index === bottom));
    expect(inner).toBeGreaterThanOrEqual(0);
    expect(kernel.topology(uniform.shape).faces[inner]!.center[2]).toBeCloseTo(2, 9);
    const thick = kernel.moveFace(uniform.shape, inner, 2);
    expect(kernel.isValid(thick.shape)).toBe(true);
    expect(kernel.massProps(thick.shape).volume).toBeCloseTo(19584, 6);
    expect(kernel.topology(thick.shape).faces).toHaveLength(kernel.topology(uniform.shape).faces.length);
    // the wall of 3 on one side instead: the inner wall that lies against the +x outer wall moved 1 toward the cavity
    const side = kernel.topology(box).faces.findIndex((f) => f.normal && f.normal[0] > 0.99);
    const innerSide = uniform.faceOrigins.findIndex((o) => o.some((x) => x.rel === 'generated' && x.kind === 'face' && x.index === side));
    const moved = kernel.moveFace(uniform.shape, innerSide, 1);
    expect(kernel.isValid(moved.shape)).toBe(true);
    expect(kernel.massProps(moved.shape).volume).toBeCloseTo(72000 - 55 * 36 * 28, 6);
  });
});

describe('a lip (C4.11): a ring on the rim, from the offset of its outline', () => {
  it('the rim of the shell is 60 × 40 outside; the outline offset 0.5 and 1.5 inward gives 59 × 39 and 57 × 37, and the ring between them is 192 mm² — a lip 1.2 high is 230.4 mm³, fused on the rim', () => {
    const box = body(build(sketch('s', front, rectangle('r', -30, -20, 60, 40)), extrude('e', 's', 'boss', { type: 'blind', depth: '30' })));
    const topo = kernel.topology(box);
    const top = topo.faces.findIndex((f) => f.normal && f.normal[2] > 0.99);
    const shelled = kernel.shell(box, [top], 2, false).shape;
    const rim = kernel.topology(shelled).faces.findIndex((f) => f.normal && f.normal[2] > 0.99);
    expect(kernel.topology(shelled).faces[rim]!.area).toBeCloseTo(60 * 40 - 56 * 36, 6);
    const { oc } = raw();
    const face = kernel.subShape(shelled, 'face', rim);
    const outer = oc.BRepTools.OuterWire(oc.TopoDS.Face(raw().get(face)));
    const offsetWire = (d: number) => {
      const mk = new oc.BRepOffsetAPI_MakeOffset(outer, oc.GeomAbs_JoinType.GeomAbs_Intersection, false);
      mk.Perform(-d);
      return oc.TopoDS.Wire(mk.Shape());
    };
    const ring = new oc.BRepBuilderAPI_MakeFace(offsetWire(0.5), true);
    ring.Add(oc.TopoDS.Wire(offsetWire(1.5).Reversed()));
    const ringFace = raw().put(ring.Face());
    expect(kernel.topology(ringFace).faces[0]!.area).toBeCloseTo(59 * 39 - 57 * 37, 6);
    const lip = raw().put(new oc.BRepPrimAPI_MakePrism(raw().get(ringFace), new oc.gp_Vec(0, 0, 1.2), false, true).Shape());
    expect(kernel.massProps(lip).volume).toBeCloseTo(192 * 1.2, 6);
    const fused = kernel.boolean('fuse', shelled, lip).shape;
    expect(kernel.solidCount(fused)).toBe(1);
    expect(kernel.massProps(fused).volume).toBeCloseTo(72000 - 56 * 36 * 28 + 192 * 1.2, 5);
    // and the groove on the other part is the same ring cut: a groove 1.2 deep into the rim takes the same volume
    const grooved = kernel.boolean('cut', shelled, raw().put(new oc.BRepPrimAPI_MakePrism(raw().get(ringFace), new oc.gp_Vec(0, 0, -1.2), false, true).Shape())).shape;
    expect(kernel.massProps(grooved).volume).toBeCloseTo(72000 - 56 * 36 * 28 - 192 * 1.2, 5);
  });
});
