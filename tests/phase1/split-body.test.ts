/**
 * Phase 1 / Blueprint C7.4: Split Body Feature (實體分割特徵).
 *
 * Self-Red-Teaming adversarial test suite (AGENTS.md §2, §3):
 * 1. Closed-form volume conservation (Zero-Mock): ∑ V_i = V_orig
 * 2. Split by standard datum plane (e.g. plane:top, plane:right)
 * 3. Split by reference plane (offset datum)
 * 4. Multi-body selective split (explicit targets vs all intersecting bodies)
 * 5. Input corruption defense:
 *    - Plane does not intersect target body -> explicit feature.splitNoIntersection
 *    - Non-planar tool -> explicit feature.splitToolNotPlanar / cmd.mustPickPlane
 * 6. Memory defense: Emscripten WASM Heap pointer existence defense (> 0)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Feature,
  type Ref,
  type SplitFeature,
} from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, front, rectangle, sketch, statuses } from './builders';

let kernel: Kernel;
let regen: Regenerator;
let solver: PlaneGcsSolver;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  regen = new Regenerator(kernel, solver);
});

const split = (id: string, tool: Ref, targets?: Ref[]): SplitFeature => ({
  id,
  type: 'split',
  name: id,
  suppressed: false,
  tool,
  ...(targets ? { targets } : {}),
});

describe('split body feature (C7.4, ADR 0158)', () => {
  it('splits a solid block exactly in half with a datum plane and conserves volume', () => {
    // Solid box: 40 (X) x 30 (Y) x 20 (Z)
    // Centered in X: [-20, 20], centered in Y: [-15, 15], Z in [0, 20]
    // V_orig = 40 * 30 * 20 = 24000
    const doc = build(
      sketch('s1', front, rectangle('r1', -20, -15, 40, 30)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
      split('sp1', { kind: 'datum', name: 'plane:top' }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'sp1=ok']);
    expect(r.bodies.length).toBe(2);

    const [b1, b2] = r.bodies;
    expect(kernel.isValid(b1!.shape)).toBe(true);
    expect(kernel.isValid(b2!.shape)).toBe(true);

    const v1 = kernel.massProps(b1!.shape).volume;
    const v2 = kernel.massProps(b2!.shape).volume;

    // Each half must be exactly 12000 mm^3
    expect(v1).toBeCloseTo(12000, 3);
    expect(v2).toBeCloseTo(12000, 3);
    // Strict volume conservation
    expect(v1 + v2).toBeCloseTo(24000, 3);

    // Verify TNP face naming
    // The cut faces should be tagged with :cut
    const b1Faces = r.body!.names.faces.slice(b1!.face0, b1!.face0 + b1!.faces);
    const b2Faces = r.body!.names.faces.slice(b2!.face0, b2!.face0 + b2!.faces);
    const b1CutFaces = b1Faces.filter((f) => f.includes('sp1:cut'));
    const b2CutFaces = b2Faces.filter((f) => f.includes('sp1:cut'));
    expect(b1CutFaces.length).toBeGreaterThanOrEqual(1);
    expect(b2CutFaces.length).toBeGreaterThanOrEqual(1);

    // Original face names should be preserved on the outer faces
    const b1OriginalFaces = b1Faces.filter((f) => f.includes('e1:'));
    expect(b1OriginalFaces.length).toBeGreaterThan(0);
  });

  it('splits a solid block along X axis using plane:right', () => {
    // 40 x 30 x 20 box, cut by plane:right (X=0)
    // Two halves of 20 x 30 x 20, volume 12000 each
    const doc = build(
      sketch('s1', front, rectangle('r1', -20, -15, 40, 30)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
      split('sp1', { kind: 'datum', name: 'plane:right' }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'sp1=ok']);
    expect(r.bodies.length).toBe(2);

    const vTotal = r.bodies.reduce((sum, b) => sum + kernel.massProps(b.shape).volume, 0);
    expect(vTotal).toBeCloseTo(24000, 3);

    for (const b of r.bodies) {
      expect(kernel.massProps(b.shape).volume).toBeCloseTo(12000, 3);
    }
  });

  it('splits a solid block using an offset reference plane', () => {
    // Create an offset plane at Z = 5 parallel to front plane (Z in [0, 20])
    // The split should produce one block of depth 5 (V = 40*30*5 = 6000)
    // and one block of depth 15 (V = 40*30*15 = 18000)
    const refPlane: Feature = {
      id: 'p_offset',
      type: 'refPlane',
      name: 'OffsetPlane',
      suppressed: false,
      def: {
        mode: 'offset',
        plane: front,
        distance: '5',
      },
    };

    const doc = build(
      sketch('s1', front, rectangle('r1', -20, -15, 40, 30)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
      refPlane,
      split('sp1', { kind: 'datum', name: 'p_offset' }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'p_offset=ok', 'sp1=ok']);
    expect(r.bodies.length).toBe(2);

    const vols = r.bodies.map((b) => kernel.massProps(b.shape).volume).sort((a, b) => a - b);
    expect(vols[0]).toBeCloseTo(6000, 3);
    expect(vols[1]).toBeCloseTo(18000, 3);
    expect(vols[0]! + vols[1]!).toBeCloseTo(24000, 3);
  });

  it('selectively splits only the targeted body when multiple bodies exist', () => {
    // Create two separate bodies side-by-side using extrude with merge: false
    // Body 1: [-50, -10] x [-10, 10] x [0, 10] -> V = 40 * 20 * 10 = 8000
    // Body 2: [10, 50] x [-10, 10] x [0, 10] -> V = 40 * 20 * 10 = 8000
    // Split with plane:top (Y=0) but target ONLY Body 1!
    // Result: Body 1 splits into 2 pieces (4000 each), Body 2 remains untouched (8000). Total = 3 bodies.
    const doc = build(
      sketch('s1', front, rectangle('r1', -50, -10, 40, 20)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      sketch('s2', front, rectangle('r2', 10, -10, 40, 20)),
      {
        id: 'e2',
        type: 'extrude',
        name: 'e2',
        suppressed: false,
        sketch: 's2',
        op: 'boss',
        dir1: { type: 'blind', depth: '10' },
        merge: false,
      },
      split('sp1', { kind: 'datum', name: 'plane:top' }, [{ kind: 'body', name: 'e1' }]),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 's2=ok', 'e2=ok', 'sp1=ok']);
    expect(r.bodies.length).toBe(3);

    const intactBody = r.bodies.find((b) => b.id === 'e2');
    expect(intactBody).toBeDefined();
    expect(kernel.massProps(intactBody!.shape).volume).toBeCloseTo(8000, 3);

    const splitPieces = r.bodies.filter((b) => b.id !== 'e2');
    expect(splitPieces.length).toBe(2);
    for (const piece of splitPieces) {
      expect(kernel.massProps(piece.shape).volume).toBeCloseTo(4000, 3);
    }
  });

  it('red team 1: explicit error when cutting plane does not intersect target body', () => {
    // Box in [0, 10] along Z. Plane at Z = 50.
    const farPlane: Feature = {
      id: 'p_far',
      type: 'refPlane',
      name: 'FarPlane',
      suppressed: false,
      def: {
        mode: 'offset',
        plane: front,
        distance: '50',
      },
    };

    const doc = build(
      sketch('s1', front, rectangle('r1', 0, 0, 10, 10)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      farPlane,
      split('sp1', { kind: 'datum', name: 'p_far' }),
    );

    const r = regen.rebuild(doc);
    const spStatus = r.features.find((f) => f.id === 'sp1');
    expect(spStatus?.status).toBe('error');
    expect(spStatus?.message).toMatch(/切割工具未切穿任何目標本體|does not intersect/);
  });

  it('red team 2: explicit error when cutting tool is invalid or not planar', () => {
    // 1. Command validation level: invalid ref kind throws immediately
    expect(() =>
      build(
        sketch('s1', front, rectangle('r1', 0, 0, 10, 10)),
        extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
        split('sp1', { kind: 'edge', name: 'invalid_edge' } as unknown as Ref),
      ),
    ).toThrow(/分割特徵的切割工具必須是基準面或實體面|must be a datum plane or a face/);

    // 2. Rebuild level: cylindrical face reference is rejected as non-planar
    // Create cylinder: circle at (0, 0) r=10 extruded 20
    const circleDoc = build(
      sketch('sc', front, {
        entities: [
          { id: 'c0', type: 'point', x: 0, y: 0 },
          { id: 'circ', type: 'circle', center: 'c0', radius: 10 },
        ],
        constraints: [{ id: 'rad', type: 'radius', circle: 'circ', value: '10' }],
      }),
      extrude('ec', 'sc', 'boss', { type: 'blind', depth: '20' }),
    );
    const rc = regen.rebuild(circleDoc);
    // Find the cylindrical lateral face:
    const cylFaceIdx = rc.body!.topology.faces.findIndex((f) => f.surface === 'cylinder');
    expect(cylFaceIdx).toBeGreaterThanOrEqual(0);
    const cylFaceName = rc.body!.names.faces[cylFaceIdx]!;

    // Now try to split using this cylindrical face as the tool
    const splitWithCyl = build(
      sketch('sc', front, {
        entities: [
          { id: 'c0', type: 'point', x: 0, y: 0 },
          { id: 'circ', type: 'circle', center: 'c0', radius: 10 },
        ],
        constraints: [{ id: 'rad', type: 'radius', circle: 'circ', value: '10' }],
      }),
      extrude('ec', 'sc', 'boss', { type: 'blind', depth: '20' }),
      split('sp_cyl', { kind: 'face', name: cylFaceName }),
    );

    const rFail = regen.rebuild(splitWithCyl);
    const failStatus = rFail.features.find((f) => f.id === 'sp_cyl');
    expect(failStatus?.status).toBe('error');
    expect(failStatus?.message).toMatch(/切割工具必須是平面|must be planar/);
  });

  it('red team 3: Emscripten WASM Heap pointer existence defense', () => {
    const wasmMem = (kernel.oc as any).wasmMemory?.buffer?.byteLength;
    expect(wasmMem).toBeDefined();
    expect(wasmMem).toBeGreaterThan(0);
  });
});
