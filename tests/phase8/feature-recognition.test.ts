/**
 * Feature recognition (F2.4, docs/design/feature-recognition/plan.md): a solid made with the kernel's own primitives, written as STEP and read back as an
 * imported body, is replaced by sketches, extrusions, revolves, holes, fillets and chamfers that rebuild the same solid. The ground truth is the solid
 * made here (its volume, its area, and the volume it does not share with the rebuilt one), never the recognizer's own numbers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type Feature, type PartDoc } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type Frame, type Region, type Segment, type ShapeId, type Vec3 } from '@3db/kernel';
import { reconstructImported, RecognizeError, Regenerator, type ReconstructReport } from '@3db/regen';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const XY: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const XZ: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
const at = (z: number, f: Frame = XY): Frame => ({ ...f, origin: [f.normal[0] * z, f.normal[1] * z, f.normal[2] * z] });
const poly = (pts: [number, number][]): Region => ({ outer: pts.map((a, i) => ({ kind: 'line', a, b: pts[(i + 1) % pts.length]!, source: `e${i}` }) as Segment), holes: [] });
const rect = (x: number, y: number, w: number, h: number) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
const disc = (cx: number, cy: number, r: number): Region => ({ outer: [{ kind: 'circle', c: [cx, cy], r, source: 'c' }], holes: [] });

const made: ShapeId[] = [];
const keep = (id: ShapeId) => (made.push(id), id);
afterAll(() => {
  for (const id of made) kernel.release(id);
});

const prism = (region: Region, z0: number, h: number) => keep(kernel.extrude(at(z0), [region], [0, 0, h]).shape);
const cut = (a: ShapeId, b: ShapeId) => keep(kernel.boolean('cut', a, b).shape);
const fuse = (a: ShapeId, b: ShapeId) => keep(kernel.boolean('fuse', a, b).shape);
const edgeWhere = (s: ShapeId, test: (mid: Vec3, dir: Vec3 | null, curve: string) => boolean) => {
  const i = kernel.topology(s).edges.findIndex((e) => test(e.mid, e.dir, e.curve));
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** The solid as an imported body of a part of its own, recognized and rebuilt. */
async function roundTrip(shape: ShapeId): Promise<{ doc: PartDoc; report: ReconstructReport; features: Feature[] }> {
  const bytes = new TextEncoder().encode(kernel.exportStep(shape, 'part'));
  const sha = await sha256Hex(bytes);
  const doc = applyCommand(createEmptyPart(), {
    type: 'importBody',
    blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'part.step' },
    feature: { id: 'imp1', type: 'importedBody', name: '輸入1', suppressed: false, blob: 'blob1' },
    index: 0,
  });
  const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
  try {
    const out = reconstructImported(kernel, regen, doc, 'imp1', solver);
    // the result stands on its own: a fresh regenerator, without the file, rebuilds it to the same volume
    const fresh = new Regenerator(kernel, solver, new Map());
    try {
      const r = fresh.rebuild(out.doc);
      expect(r.features.filter((f) => f.status !== 'ok').map((f) => `${f.id}:${f.message}`)).toEqual([]);
      // every sketch is fully defined: each size of the part is a dimension to change
      expect(r.features.filter((f) => f.sketch && (f.sketch.status !== 'fully' || f.sketch.dof !== 0)).map((f) => `${f.id}:${f.sketch!.status}/${f.sketch!.dof}`)).toEqual([]);
      // checked here against the solid made by the test, not against the recognizer's own report
      const v0 = kernel.massProps(shape).volume;
      const v1 = kernel.massProps(r.body!.shape).volume;
      const shared = kernel.common(shape, r.body!.shape, 0);
      if (shared.shape !== null) kernel.release(shared.shape);
      expect(Math.abs(v1 - v0) / v0).toBeLessThan(1e-6);
      expect((v0 + v1 - 2 * shared.volume) / v0).toBeLessThan(1e-6);
      expect(Math.abs(kernel.massProps(r.body!.shape).area - kernel.massProps(shape).area) / kernel.massProps(shape).area).toBeLessThan(1e-6);
    } finally {
      fresh.dispose();
    }
    expect(out.doc.features.some((f) => f.type === 'importedBody')).toBe(false);
    expect(out.doc.blobs).toEqual([]);
    expect(out.report.volumeError).toBeLessThanOrEqual(1e-6);
    expect(out.report.difference).toBeLessThanOrEqual(1e-6);
    return { ...out, features: out.doc.features };
  } finally {
    regen.dispose();
  }
}

const ofType = <T extends Feature['type']>(fs: Feature[], type: T) => fs.filter((f): f is Extract<Feature, { type: T }> => f.type === type);

describe('extrusions', () => {
  it('a box is one sketch and one extrusion', async () => {
    const { features, report } = await roundTrip(prism(rect(-30, -20, 60, 40), 0, 10));
    expect(ofType(features, 'extrude')).toHaveLength(1);
    expect(report.features.extrude).toBe(1);
    expect(report.faces).toEqual([6, 6]);
  });

  it('a stepped block is a stack of extrusions', async () => {
    const s = fuse(prism(rect(0, 0, 50, 30), 0, 8), prism(rect(10, 5, 20, 20), 8, 12));
    const { features } = await roundTrip(s);
    expect(ofType(features, 'extrude').map((e) => (e.dir1 as { depth: string }).depth).sort()).toEqual(['12', '8']);
  });

  it('a pocket from the top', async () => {
    const s = cut(prism(rect(0, 0, 50, 30), 0, 10), prism(rect(10, 10, 20, 10), 6, 5));
    const { report } = await roundTrip(s);
    expect(report.features.extrude).toBe(2);
  });

  it('an L outline with an arc', async () => {
    const r: Region = {
      outer: [
        { kind: 'line', a: [0, 0], b: [40, 0], source: 'a' },
        { kind: 'line', a: [40, 0], b: [40, 10], source: 'b' },
        { kind: 'line', a: [40, 10], b: [20, 10], source: 'c' },
        { kind: 'arc', c: [20, 20], r: 10, from: [20, 10], to: [10, 20], ccw: false, source: 'd' },
        { kind: 'line', a: [10, 20], b: [10, 30], source: 'e' },
        { kind: 'line', a: [10, 30], b: [0, 30], source: 'f' },
        { kind: 'line', a: [0, 30], b: [0, 0], source: 'g' },
      ],
      holes: [],
    };
    const { report } = await roundTrip(prism(r, 0, 15));
    expect(report.features.extrude).toBe(1);
  });
});

describe('holes', () => {
  const plate = () => prism(rect(-30, -20, 60, 40), 0, 10);

  it('a through hole', async () => {
    const { features } = await roundTrip(cut(plate(), prism(disc(5, 3, 4), -1, 12)));
    const [h] = ofType(features, 'hole');
    expect(h).toMatchObject({ kind: 'straight', diameter: '8', end: { type: 'throughAll' } });
  });

  it('two equal blind holes are one feature with two points', async () => {
    const s = cut(cut(plate(), prism(disc(-10, 0, 3), 4, 7)), prism(disc(10, 0, 3), 4, 7));
    const { features } = await roundTrip(s);
    const holes = ofType(features, 'hole');
    expect(holes).toHaveLength(1);
    expect(holes[0]).toMatchObject({ kind: 'straight', diameter: '6', end: { type: 'blind', depth: '6' } });
    const sk = ofType(features, 'sketch').find((s) => s.id === holes[0]!.sketch)!;
    expect(sk.entities.filter((e) => e.type === 'point')).toHaveLength(2);
  });

  it('a blind bore with a pin standing in it is not a drilled hole: it stays in the layered extrusions', async () => {
    const s = fuse(cut(plate(), prism(disc(0, 0, 5), 4, 7)), prism(disc(0, 0, 2), 4, 3));
    const { features } = await roundTrip(s);
    expect(ofType(features, 'hole')).toHaveLength(0);
    expect(ofType(features, 'extrude').length).toBeGreaterThan(1);
  });

  it('a counterbore', async () => {
    const s = cut(cut(plate(), prism(disc(0, 0, 6), 6, 5)), prism(disc(0, 0, 3), -1, 12));
    const [h] = ofType((await roundTrip(s)).features, 'hole');
    expect(h).toMatchObject({ kind: 'counterbore', diameter: '6', cbDiameter: '12', cbDepth: '4', end: { type: 'throughAll' } });
  });

  it('a countersink', async () => {
    // a cone from Ø12 at the top face down to Ø6, then the Ø6 bore through
    const tool = keep(kernel.revolve(at(0, XZ), [poly([[0, 11], [6, 11], [6, 10], [3, 7], [3, -1], [0, -1]])], { origin: [0, 0, 0], dir: [0, 0, 1] }, 2 * Math.PI).shape);
    const [h] = ofType((await roundTrip(cut(plate(), tool))).features, 'hole');
    expect(h).toMatchObject({ kind: 'countersink', diameter: '6', csDiameter: '12', csAngle: '90deg' });
  });
});

describe('fillets and chamfers', () => {
  it('a convex round on a vertical edge', async () => {
    const box = prism(rect(0, 0, 40, 30), 0, 10);
    const e = edgeWhere(box, (m, d) => !!d && Math.abs(d[2]) > 0.99 && near(m[0], 40) && near(m[1], 30));
    const s = keep(kernel.fillet(box, [e], 5).shape);
    const { features } = await roundTrip(s);
    expect(ofType(features, 'fillet')).toMatchObject([{ radius: '5' }]);
    expect(ofType(features, 'fillet')[0]!.edges).toHaveLength(1);
  });

  it('rounds of two radii, one of them on a concave corner', async () => {
    const l = fuse(prism(rect(0, 0, 40, 10), 0, 10), prism(rect(0, 10, 10, 20), 0, 10));
    const inner = edgeWhere(l, (m, d) => !!d && Math.abs(d[2]) > 0.99 && near(m[0], 10) && near(m[1], 10));
    const top = edgeWhere(l, (m, d) => !!d && Math.abs(d[0]) > 0.99 && near(m[1], 0) && near(m[2], 10));
    const s1 = keep(kernel.fillet(l, [inner], 3).shape);
    const top2 = edgeWhere(s1, (m, d) => !!d && Math.abs(d[0]) > 0.99 && near(m[1], 0) && near(m[2], 10));
    expect(top).toBeGreaterThanOrEqual(0);
    const s = keep(kernel.fillet(s1, [top2], 2).shape);
    const { features } = await roundTrip(s);
    expect(ofType(features, 'fillet').map((f) => f.radius).sort()).toEqual(['2', '3']);
  });

  it('an unequal chamfer', async () => {
    const box = prism(rect(0, 0, 40, 30), 0, 10);
    const topo = kernel.topology(box);
    const e = edgeWhere(box, (m, d) => !!d && Math.abs(d[0]) > 0.99 && near(m[1], 0) && near(m[2], 10));
    const front = topo.faces.findIndex((f) => f.normal && f.normal[1] < -0.99);
    const s = keep(kernel.chamfer(box, [{ edge: e, face: front }], 'distanceDistance', 2, 3).shape);
    const { features } = await roundTrip(s);
    const [c] = ofType(features, 'chamfer');
    expect([c!.distance, c!.second].sort()).toEqual(['2', '3']);
  });

  it('a chamfer at the entrance of a hole is the countersink of a hole', async () => {
    let s = cut(prism(rect(-20, -20, 40, 40), 0, 10), prism(disc(0, 0, 4), -1, 12));
    const rim = edgeWhere(s, (m, _d, c) => c === 'circle' && near(m[2], 10));
    const topo = kernel.topology(s);
    const top = topo.faces.findIndex((f) => f.normal && f.normal[2] > 0.99);
    s = keep(kernel.chamfer(s, [{ edge: rim, face: top }], 'distanceDistance', 1, 1).shape);
    const { features } = await roundTrip(s);
    expect(ofType(features, 'hole')).toMatchObject([{ kind: 'countersink', diameter: '8', csDiameter: '10', csAngle: '90deg', end: { type: 'throughAll' } }]);
    expect(ofType(features, 'chamfer')).toHaveLength(0);
  });

  it('a chamfer on the rim of a boss', async () => {
    let s = fuse(prism(rect(-20, -20, 40, 40), 0, 5), prism(disc(0, 0, 8), 5, 10));
    const rim = edgeWhere(s, (m, _d, c) => c === 'circle' && near(m[2], 15));
    const top = kernel.topology(s).faces.findIndex((f) => f.normal && f.normal[2] > 0.99 && near(f.center[2], 15));
    s = keep(kernel.chamfer(s, [{ edge: rim, face: top }], 'distanceDistance', 1, 2).shape);
    const { features } = await roundTrip(s);
    const [c] = ofType(features, 'chamfer');
    expect([c!.distance, c!.second].sort()).toEqual(['1', '2']);
  });
});

describe('revolves', () => {
  const turned = (pts: [number, number][]) => keep(kernel.revolve(XY, [poly(pts)], { origin: [0, 0, 0], dir: [0, 1, 0] }, 2 * Math.PI).shape);

  it('a stepped shaft with a taper', async () => {
    const { features } = await roundTrip(turned([[0, 0], [10, 0], [10, 20], [6, 25], [6, 40], [0, 40]]));
    expect(ofType(features, 'revolve')).toHaveLength(1);
    expect(ofType(features, 'extrude')).toHaveLength(0);
  });

  it('a shaft with a bore, rounded at its shoulder', async () => {
    const shaft = turned([[3, 0], [10, 0], [10, 20], [6, 20], [6, 40], [3, 40]]);
    const shoulder = edgeWhere(shaft, (m, _d, c) => c === 'circle' && near(m[1], 20) && near(Math.hypot(m[0], m[2]), 6));
    const s = keep(kernel.fillet(shaft, [shoulder], 1.5).shape);
    const { features } = await roundTrip(s);
    expect(ofType(features, 'revolve')).toHaveLength(1);
    expect(ofType(features, 'fillet')).toMatchObject([{ radius: '1.5' }]);
  });
});

describe('any direction', () => {
  it('a plate with a hole, turned 30° about a slanted axis', async () => {
    const s = cut(prism(rect(-30, -20, 60, 40), 0, 10), prism(disc(5, 3, 4), -1, 12));
    const c = Math.cos(Math.PI / 6);
    const n = Math.sin(Math.PI / 6);
    const k: Vec3 = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
    // Rodrigues' rotation about k by 30°, as a 3 × 4 row-major matrix
    const m = [0, 1, 2].flatMap((i) => [
      ...[0, 1, 2].map((j) => (i === j ? c : 0) + (1 - c) * k[i]! * k[j]! + n * ([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]] as number[][])[i]![j]!),
      [5, -3, 7][i]!,
    ]);
    const turnedPlate = keep(kernel.transformed(s, m));
    const { features } = await roundTrip(turnedPlate);
    expect(ofType(features, 'hole')).toHaveLength(1);
    expect(ofType(features, 'refPlane').length).toBeGreaterThan(0);
  });
});

describe('refusals', () => {
  async function refusal(shape: ShapeId): Promise<string> {
    const bytes = new TextEncoder().encode(kernel.exportStep(shape, 'part'));
    const sha = await sha256Hex(bytes);
    const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'p.step' }, feature: { id: 'imp1', type: 'importedBody', name: '輸入1', suppressed: false, blob: 'blob1' }, index: 0 });
    const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
    try {
      reconstructImported(kernel, regen, doc, 'imp1');
    } catch (e) {
      expect(e).toBeInstanceOf(RecognizeError);
      return (e as Error).message;
    } finally {
      regen.dispose();
    }
    throw new Error('not refused');
  }

  it('freeform faces', async () => {
    expect(await refusal(keep(kernel.toBSpline(prism(rect(0, 0, 10, 10), 0, 10))))).toContain('自由曲面');
  });

  it('two solids', async () => {
    expect(await refusal(keep(kernel.join([prism(rect(0, 0, 10, 10), 0, 10), prism(rect(20, 0, 10, 10), 0, 10)])))).toContain('2 個實體');
  });

  it('a face that is neither turned nor extruded', async () => {
    // a corner of a box cut off by a plane square to (1, 1, 1): no direction is parallel or square to every face
    const k = 1 / Math.sqrt(3);
    const n: Vec3 = [k, k, k];
    const x: Vec3 = [k * Math.SQRT2 * Math.sqrt(3) / 2, -k * Math.SQRT2 * Math.sqrt(3) / 2, 0];
    const corner: Frame = { origin: [16, 16, 16], xDir: x, yDir: [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]], normal: n };
    const knife = keep(kernel.extrude(corner, [rect(-50, -50, 100, 100)], [n[0] * 50, n[1] * 50, n[2] * 50]).shape);
    expect(await refusal(cut(prism(rect(0, 0, 20, 20), 0, 20), knife))).toContain('伸長方向');
  });
});
