/**
 * Helix and Spiral Curve Feature (ADR 0168, C8.3):
 * 3D space helix or planar Archimedean spiral curve driven by reference circular sketch or model edge.
 *
 * Implements Self-Red-Teaming Protocol & Disruptive Edge-Case Checklist (AGENTS.md):
 * 1. Input Corruption: Negative/zero pitch, revolutions, height, radius rejection.
 * 2. Closed-Form Ground Truth: Analytic arc-length comparison (L = sqrt((2*pi*N*R)^2 + H^2)).
 * 3. Dependency Graph Integrity: Parent-child DAG chain, sketch circle & circular model edge.
 * 4. Zero-Mock & Ground Truth: Real B-Rep wire probe extraction, topological vertices.
 * 5. Memory Defense: every shape released (liveShapes exact). The heap growth is printed, not asserted: 100 runs are absorbed by
 *    the heap slack (AGENTS.md §3.5). Measured apart, each in a fresh heap, 2000 rebuilds: helix +0.0 MiB; the control (extrude
 *    boss + cut) +422.7 MiB, and +0.0 over its first 500 — the slack.
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
import { HELIX_MAX_TURNS, Kernel } from '@3db/kernel';
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
    it('releases every shape it makes over 100 rebuilds (heap growth printed, see the header)', () => {
      const hx = helix('hx_mem', 'pitchAndRev', { kind: 'datum', name: 'sk1' }, { pitch: '5', revolutions: '4' });
      const doc = circleSketchDoc('sk1', 'c1', 10, hx);
      const warmup = rebuild(doc);
      for (const b of warmup.bodies) kernel.release(b.shape);

      const initialHeap = getWasmHeap();
      const initialLiveShapes = kernel.liveShapes;
      for (let i = 0; i < 100; i++) {
        const res = rebuild(doc);
        for (const b of res.bodies) kernel.release(b.shape);
      }
      console.log(`helix: 100 rebuilds, heap ${((getWasmHeap() - initialHeap) / (1024 * 1024)).toFixed(1)} MiB`);
      expect(kernel.liveShapes).toBe(initialLiveShapes);
    });
  });

  describe('Red Team 5: review of 2026-10-19 (names, taper, ambiguity, limits, surface features)', () => {
    const doc = (o: Partial<HelixFeature>, ...extra: Feature[]) =>
      circleSketchDoc('sk1', 'c1', 10, helix('hx', 'pitchAndRev', { kind: 'datum', name: 'sk1' }, { pitch: '5', revolutions: '4', ...o }), ...extra);
    const statusOf = (r: RebuildResult, id: string) => statuses(r).find((s) => s.startsWith(`${id}=`));
    const release = (r: RebuildResult) => {
      for (const b of r.bodies) kernel.release(b.shape);
    };
    const near = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!) < 1e-6;
    const vertex = (r: RebuildResult, name: string) => {
      const v = r.body!;
      const i = v.names.vertices.indexOf(name);
      expect(i, `vertex ${name}`).toBeGreaterThanOrEqual(0);
      return v.topology.vertices[i]!.point;
    };

    it('names every turn: one edge name per edge and one vertex name per vertex, in topology order', () => {
      const r = rebuild(doc({}));
      expect(failures(r)).toEqual([]);
      const view = r.body!;
      // 4 whole turns: an edge each, and 5 vertices (it used to name 1 edge and 2 vertices, leaving turns 2 to 4 without a name)
      expect(view.topology.edges.length).toBe(4);
      expect(view.topology.vertices.length).toBe(5);
      expect(view.names.edges).toEqual(view.topology.edges.map((e) => `hx:helix:${Math.floor(e.mid[2] / 5)}`));
      expect(new Set(view.names.vertices).size).toBe(5);
      expect(near(vertex(r, 'hx:start'), [10, 0, 0])).toBe(true);
      expect(near(vertex(r, 'hx:turn:2'), [10, 0, 10])).toBe(true);
      expect(near(vertex(r, 'hx:end'), [10, 0, 20])).toBe(true);
      release(r);
    });

    it('a part turn (2.75 revolutions) keeps the closed-form length and ends where the equation says', () => {
      const r = rebuild(doc({ revolutions: '2.75' }));
      expect(failures(r)).toEqual([]);
      expect([...r.body!.names.edges].sort()).toEqual(['hx:helix:0', 'hx:helix:1', 'hx:helix:2']);
      const length = r.body!.topology.edges.reduce((sum, e) => sum + e.length, 0);
      const expected = Math.hypot(2 * Math.PI * 2.75 * 10, 5 * 2.75);
      expect(Math.abs(length - expected) / expected).toBeLessThan(1e-4);
      // 2.75 turns from angle 0, the angle growing: 990° = 270°, so (0, -10) in the sketch's x, y
      expect(near(vertex(r, 'hx:end'), [0, -10, 13.75])).toBe(true);
      release(r);
    });

    it('starts at the start angle and winds clockwise or counter-clockwise', () => {
      const ends = (clockwise: boolean) => {
        const r = rebuild(doc({ revolutions: '0.25', startAngle: '90deg', clockwise }));
        expect(failures(r)).toEqual([]);
        const out = [vertex(r, 'hx:start'), vertex(r, 'hx:end')] as const;
        release(r);
        return out;
      };
      const [s1, e1] = ends(true);
      expect(near(s1, [0, 10, 0])).toBe(true);
      expect(near(e1, [-10, 0, 1.25])).toBe(true); // the angle grows going up the axis: a right-hand helix
      const [s2, e2] = ends(false);
      expect(near(s2, [0, 10, 0])).toBe(true);
      expect(near(e2, [10, 0, 1.25])).toBe(true);
    });

    it('an inward taper narrows to the closed-form radius, and is refused where it would cross the axis', () => {
      const ok = rebuild(doc({ taperAngle: '5deg', taperOutward: false }));
      expect(failures(ok)).toEqual([]);
      const end = vertex(ok, 'hx:end');
      expect(Math.hypot(end[0], end[1])).toBeCloseTo(10 - 20 * Math.tan((5 * Math.PI) / 180), 6);
      release(ok);
      // R 10, 100 up at 10° inward: 10 - 100·tan 10° = -7.6 (this used to rebuild "ok" through the apex of the cone)
      const bad = rebuild(doc({ pitch: '10', revolutions: '10', taperAngle: '10deg', taperOutward: false }));
      expect(statusOf(bad, 'hx')).toMatch(/穿過軸心/);
      release(bad);
    });

    it('refuses a negative taper and one of 90° with a reason (they used to be made positive, and an internal error)', () => {
      for (const taperAngle of ['-10deg', '90deg']) {
        const r = rebuild(doc({ taperAngle, taperOutward: true }));
        expect(statusOf(r, 'hx')).toMatch(/錐角必須介於/);
        release(r);
      }
    });

    it('refuses a sketch of two circles rather than taking the first', () => {
      const sk = sketch('sk2', front, circle('a', 0, 0, 10), circle('b', 50, 0, 3));
      const r = rebuild(build(sk, helix('hx', 'pitchAndRev', { kind: 'datum', name: 'sk2' }, { pitch: '5', revolutions: '3' })));
      expect(statusOf(r, 'hx')).toMatch(/2 個圓或圓弧/);
      release(r);
    });

    it(`refuses more revolutions than the limit (${HELIX_MAX_TURNS}) before building any`, () => {
      const r = rebuild(doc({ revolutions: String(HELIX_MAX_TURNS + 1) }));
      expect(statusOf(r, 'hx')).toMatch(/超過上限/);
      release(r);
    });

    it('is a curve: surface features refuse it with a reason (knit used to take it "ok")', () => {
      const knit = { id: 'kn', type: 'knit', name: 'kn', suppressed: false, bodies: [{ kind: 'body', name: 'hx' }] } as Feature;
      const thicken = { id: 'th', type: 'thicken', name: 'th', suppressed: false, body: { kind: 'body', name: 'hx' }, thickness: '1' } as Feature;
      for (const f of [knit, thicken]) {
        const r = rebuild(doc({}, f));
        expect(statusOf(r, 'hx')).toBe('hx=ok');
        expect(statusOf(r, f.id)).toMatch(/=error\(.*hx/);
        release(r);
      }
    });
  });
});
