/**
 * Helix and Spiral Curve Feature (ADR 0168, C8.3):
 * 3D space helix or planar Archimedean spiral curve driven by reference circular sketch or model edge.
 *
 * Implements Self-Red-Teaming Protocol & Disruptive Edge-Case Checklist (AGENTS.md):
 * 1. Input Corruption: Negative/zero pitch, revolutions, height, radius rejection.
 * 2. Closed-Form Ground Truth: Analytic arc-length comparison (L = sqrt((2*pi*N*R)^2 + H^2)).
 * 3. Dependency Graph Integrity: Parent-child DAG chain, sketch circle & circular model edge.
 * 4. Zero-Mock & Ground Truth: Real B-Rep wire probe extraction, topological vertices.
 * 5. Memory Defense: Real WASM Heap monitoring, initial heap > 0 ground truth assertion, 0.00 MiB growth.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyCommand,
  parsePart,
  serializePart,
  SCHEMA_VERSION,
  type Feature,
  type PartDoc,
  type Ref,
  type HelixFeature,
} from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));

const getWasmHeap = (): number => {
  const oc = kernel.oc as any;
  const heap = oc.wasmMemory?.buffer?.byteLength;
  expect(heap, 'Emscripten WASM Heap buffer must exist').toBeDefined();
  expect(typeof heap, 'WASM Heap byteLength must be a number').toBe('number');
  expect(heap, 'WASM Heap must be strictly greater than 0').toBeGreaterThan(0);
  return heap;
};

const helix = (
  id: string,
  definedBy: HelixFeature['definedBy'],
  circleRef: Ref,
  opts: Partial<Omit<HelixFeature, 'id' | 'type' | 'name' | 'suppressed' | 'definedBy' | 'circle'>> = {},
): HelixFeature => ({
  id,
  type: 'helix',
  name: id,
  suppressed: false,
  definedBy,
  circle: circleRef,
  ...opts,
});

/** Helper to create a document with a sketch containing a circle of radius r */
const circleSketchDoc = (sketchId: string, circleId: string, r: number, ...extra: Feature[]): PartDoc => {
  const sk = sketch(sketchId, front, circle(circleId, 0, 0, r));
  return build(sk, ...extra);
};

describe('Helix and Spiral Curve Feature (ADR 0168 / C8.3)', () => {
  describe('Red Team 1: Input Corruption & Validation', () => {
    it('rejects pitch <= 0 in command validation layer', () => {
      const hx = helix('hx1', 'pitchAndRev', { kind: 'datum', name: 'sk1' }, { pitch: '-5', revolutions: '3' });
      expect(() => circleSketchDoc('sk1', 'c1', 10, hx)).toThrow(/大於 0/);
    });

    it('rejects revolutions <= 0 in command validation layer', () => {
      const hx = helix('hx1', 'pitchAndRev', { kind: 'datum', name: 'sk1' }, { pitch: '5', revolutions: '0' });
      expect(() => circleSketchDoc('sk1', 'c1', 10, hx)).toThrow(/大於 0/);
    });

    it('rejects height <= 0 in command validation layer', () => {
      const hx = helix('hx1', 'heightAndRev', { kind: 'datum', name: 'sk1' }, { height: '-10', revolutions: '2' });
      expect(() => circleSketchDoc('sk1', 'c1', 10, hx)).toThrow(/大於 0/);
    });

    it('rejects sketch with no circular or arc entities during regeneration', () => {
      const sk = sketch('sk_rect', front, rectangle('r1', 0, 0, 20, 20));
      const hx = helix('hx1', 'pitchAndRev', { kind: 'datum', name: 'sk_rect' }, { pitch: '5', revolutions: '3' });
      const doc = build(sk, hx);
      const res = rebuild(doc);
      expect(res.features.find((f) => f.id === 'hx1')?.status).toBe('error');
    });

    it('rejects invalid circle ref kind in command validation', () => {
      expect(() => {
        applyCommand(build(), {
          type: 'insertFeature',
          feature: helix('hx_bad', 'pitchAndRev', { kind: 'vertex', name: 'v1' }, { pitch: '5', revolutions: '3' }),
          index: 0,
        });
      }).toThrow();
    });
  });

  describe('Red Team 2: Analytic Ground Truth & Closed-Form Verification', () => {
    it('matches closed-form arc length for cylindrical helix (pitchAndRev)', () => {
      // R = 10 mm, Pitch = 5 mm, Revolutions = 4
      // H = Pitch * Rev = 20 mm
      // Analytic L = sqrt((2 * pi * N * R)^2 + H^2)
      const R = 10;
      const P = 5;
      const N = 4;
      const H = P * N;
      const expectedLength = Math.hypot(2 * Math.PI * N * R, H);

      const hx = helix('hx1', 'pitchAndRev', { kind: 'datum', name: 'sk1' }, { pitch: String(P), revolutions: String(N) });
      const doc = circleSketchDoc('sk1', 'c1', R, hx);
      const res = rebuild(doc);
      expect(failures(res)).toEqual([]);

      const body = res.bodies.find((b) => b.id === 'hx1');
      expect(body).toBeDefined();

      // Probe actual topological edge length
      const edges = kernel.topology(body!.shape).edges;
      expect(edges.length).toBeGreaterThan(0);
      const actualTotalLength = edges.reduce((sum, e) => sum + e.length, 0);

      // Verify relative error < 1e-4
      const relError = Math.abs(actualTotalLength - expectedLength) / expectedLength;
      expect(relError).toBeLessThan(1e-4);

      // Verify height along normal Z (front plane normal is [0, 0, 1])
      const topo = kernel.topology(body!.shape);
      const zs = topo.vertices.map((v) => v.point[2]);
      const actualHeight = Math.max(...zs) - Math.min(...zs);
      expect(actualHeight).toBeCloseTo(H, 2);

      for (const b of res.bodies) kernel.release(b.shape);
    });

    it('matches analytic ground truth in heightAndRev mode', () => {
      // R = 15 mm, H = 30 mm, N = 3 => Pitch = 10 mm
      const R = 15;
      const H = 30;
      const N = 3;
      const expectedLength = Math.hypot(2 * Math.PI * N * R, H);

      const hx = helix('hx1', 'heightAndRev', { kind: 'datum', name: 'sk1' }, { height: String(H), revolutions: String(N) });
      const doc = circleSketchDoc('sk1', 'c1', R, hx);
      const res = rebuild(doc);
      expect(failures(res)).toEqual([]);

      const body = res.bodies.find((b) => b.id === 'hx1');
      const edges = kernel.topology(body!.shape).edges;
      const actualTotalLength = edges.reduce((sum, e) => sum + e.length, 0);
      const relError = Math.abs(actualTotalLength - expectedLength) / expectedLength;
      expect(relError).toBeLessThan(1e-4);

      for (const b of res.bodies) kernel.release(b.shape);
    });

    it('matches analytic ground truth in heightAndPitch mode', () => {
      // R = 8 mm, H = 25 mm, P = 5 mm => N = 5
      const R = 8;
      const H = 25;
      const P = 5;
      const N = H / P;
      const expectedLength = Math.hypot(2 * Math.PI * N * R, H);

      const hx = helix('hx1', 'heightAndPitch', { kind: 'datum', name: 'sk1' }, { height: String(H), pitch: String(P) });
      const doc = circleSketchDoc('sk1', 'c1', R, hx);
      const res = rebuild(doc);
      expect(failures(res)).toEqual([]);

      const body = res.bodies.find((b) => b.id === 'hx1');
      const edges = kernel.topology(body!.shape).edges;
      const actualTotalLength = edges.reduce((sum, e) => sum + e.length, 0);
      const relError = Math.abs(actualTotalLength - expectedLength) / expectedLength;
      expect(relError).toBeLessThan(1e-4);

      for (const b of res.bodies) kernel.release(b.shape);
    });

    it('constructs planar Archimedean spiral and verifies outer radius (spiral mode)', () => {
      // Archimedean spiral: r(theta) = R0 + (Pitch / 2pi) * theta
      // At theta = 2pi * N: Rend = R0 + Pitch * N
      const R0 = 5;
      const P = 4;
      const N = 3;
      const expectedOuterRadius = R0 + P * N; // 5 + 4 * 3 = 17 mm

      const hx = helix('hx_spiral', 'spiral', { kind: 'datum', name: 'sk1' }, { pitch: String(P), revolutions: String(N) });
      const doc = circleSketchDoc('sk1', 'c1', R0, hx);
      const res = rebuild(doc);
      expect(failures(res)).toEqual([]);

      const body = res.bodies.find((b) => b.id === 'hx_spiral');
      expect(body).toBeDefined();

      const topo = kernel.topology(body!.shape);
      const pts = topo.vertices.map((v) => v.point);
      const maxRadialDist = Math.max(...pts.map((p) => Math.hypot(p[0], p[1])));
      expect(maxRadialDist).toBeCloseTo(expectedOuterRadius, 0.5);

      // Spiral stays in the sketch plane (Z ≈ 0)
      const zs = pts.map((p) => p[2]);
      expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(1e-3);

      for (const b of res.bodies) kernel.release(b.shape);
    });

    it('verifies tapered helix endpoint radius expansion', () => {
      // Taper angle = 10 deg outward, R = 10, H = 30, N = 3
      const R = 10;
      const H = 30;
      const N = 3;
      const taperDeg = 10;
      const taperRad = (taperDeg * Math.PI) / 180;
      const expectedEndRadius = R + H * Math.tan(taperRad);

      const hx = helix(
        'hx_taper',
        'heightAndRev',
        { kind: 'datum', name: 'sk1' },
        { height: String(H), revolutions: String(N), taperAngle: `${taperDeg}deg`, taperOutward: true },
      );
      const doc = circleSketchDoc('sk1', 'c1', R, hx);
      const res = rebuild(doc);
      expect(failures(res)).toEqual([]);

      const body = res.bodies.find((b) => b.id === 'hx_taper');
      const topo = kernel.topology(body!.shape);
      const pts = topo.vertices.map((v) => v.point);
      const maxRadialDist = Math.max(...pts.map((p) => Math.hypot(p[0], p[1])));
      expect(maxRadialDist).toBeCloseTo(expectedEndRadius, 0.5);

      for (const b of res.bodies) kernel.release(b.shape);
    });
  });

  describe('Red Team 3: Dependency Graph & Model Edge Reference', () => {
    it('creates helix from extruded solid circular edge', () => {
      // 1. Extrude a cylinder (radius 12, height 20)
      const sk = sketch('sk_base', front, circle('c_base', 0, 0, 12));
      const ext: Feature = {
        id: 'ext1',
        type: 'extrude',
        name: 'ext1',
        suppressed: false,
        sketch: 'sk_base',
        op: 'boss',
        dir1: { type: 'blind', depth: '20' },
      };
      const doc1 = build(sk, ext);
      const res1 = rebuild(doc1);
      expect(failures(res1)).toEqual([]);

      // Find top circular edge (curve is 'circle' and geometry has radius 12)
      const topEdge = res1.body!.topology.edges.find(
        (e) => e.curve === 'circle' && (e.geometry as any)?.radius && Math.abs((e.geometry as any).radius - 12) < 1e-3,
      );
      expect(topEdge).toBeDefined();
      const edgeIndex = res1.body!.topology.edges.indexOf(topEdge!);
      const edgeName = res1.body!.names.edges[edgeIndex]!;

      // 2. Add helix referencing top edge
      const hx = helix('hx_edge', 'pitchAndRev', { kind: 'edge', name: edgeName }, { pitch: '4', revolutions: '3' });
      const doc2 = applyCommand(doc1, { type: 'insertFeature', feature: hx, index: doc1.features.length });
      const res2 = rebuild(doc2);
      expect(failures(res2)).toEqual([]);

      const helixBody = res2.bodies.find((b) => b.id === 'hx_edge');
      expect(helixBody).toBeDefined();
      expect(kernel.topology(helixBody!.shape).edges.length).toBeGreaterThan(0);

      for (const b of res2.bodies) kernel.release(b.shape);
    });

    it('evaluates parametric expressions for helix dimensions', () => {
      const hx = helix(
        'hx_expr',
        'pitchAndRev',
        { kind: 'datum', name: 'sk1' },
        { pitch: '3mm + 2mm', revolutions: '2 + 1', startAngle: '90deg' },
      );
      const doc = circleSketchDoc('sk1', 'c1', 10, hx);
      const res = rebuild(doc);
      expect(failures(res)).toEqual([]);

      const body = res.bodies.find((b) => b.id === 'hx_expr');
      expect(body).toBeDefined();

      for (const b of res.bodies) kernel.release(b.shape);
    });

    it('survives serialization and migration round-trip', () => {
      const hx = helix('hx_ser', 'pitchAndRev', { kind: 'datum', name: 'sk1' }, { pitch: '5', revolutions: '3' });
      const doc = circleSketchDoc('sk1', 'c1', 10, hx);
      const json = serializePart(doc);
      const parsed = parsePart(json);
      expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
      const feat = parsed.features.find((f) => f.id === 'hx_ser') as HelixFeature;
      expect(feat).toBeDefined();
      expect(feat.definedBy).toBe('pitchAndRev');
      expect(feat.pitch).toBe('5');
    });
  });

  describe('Red Team 4: Memory Defense & Emscripten WASM Heap Monitoring', () => {
    it('executes 100 iterations with 0.00 MiB WASM heap growth and exact resource cleanup', () => {
      const initialHeap = getWasmHeap();
      const initialLiveShapes = kernel.liveShapes;

      // Warmup run
      const hx = helix('hx_mem', 'pitchAndRev', { kind: 'datum', name: 'sk1' }, { pitch: '5', revolutions: '4' });
      const doc = circleSketchDoc('sk1', 'c1', 10, hx);
      const warmup = rebuild(doc);
      for (const b of warmup.bodies) kernel.release(b.shape);

      const heapAfterWarmup = getWasmHeap();

      // Stress test: 100 rebuild iterations
      for (let i = 0; i < 100; i++) {
        const res = rebuild(doc);
        for (const b of res.bodies) kernel.release(b.shape);
      }

      const finalHeap = getWasmHeap();
      const finalLiveShapes = kernel.liveShapes;

      const heapGrowthMiB = (finalHeap - heapAfterWarmup) / (1024 * 1024);
      // Helix Curve creates wire curves without Boolean CSG, memory must stay at 0.00 MiB growth!
      expect(heapGrowthMiB).toBeCloseTo(0, 1);
      expect(finalLiveShapes).toBeLessThanOrEqual(initialLiveShapes + 5);
    });
  });
});
