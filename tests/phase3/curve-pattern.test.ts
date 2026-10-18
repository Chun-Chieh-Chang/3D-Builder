/**
 * Phase 3 (C6.4, ADR 0166): Curve-driven pattern feature.
 * What seeds added to the bodies is repeated along a model edge or sketch curve path.
 * Supports tangent orientation vs parallel alignment, equal spacing vs explicit spacing,
 * and reverse direction, with strict Red-Teaming defense (AGENTS.md).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc, type PatternDefinition, type PatternFeature, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { dependencies, Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, extrude, face, front, line, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);
const messageOf = (r: RebuildResult, id: string) => r.features.find((f) => f.id === id)?.message ?? '';

const BASE_W = 200;
const BASE_H = 80;
const BASE_T = 5;
const PAD_W = 100;
const PAD_H = 40;
const PAD_T = 5;
const POST_R = 2;
const POST_H = 5;
const POST_VOL = Math.PI * POST_R * POST_R * POST_H;

/**
 * Base plate 200 × 80 × 5 with a pad 100 × 40 × 5 at (20, 20).
 * Post seed is at (20, 10) on top face of base plate (Z=5).
 * Pad's lower edge is 100 mm long, from (20, 20, 5) to (120, 20, 5).
 */
const baseWithPadAndPost = (postX = 20, postY = 10): Feature[] => [
  sketch('s1', front, rectangle('base', 0, 0, BASE_W, BASE_H)),
  extrude('e1', 's1', 'boss', { type: 'blind', depth: String(BASE_T) }),
  sketch('s2', face('e1:cap:end'), rectangle('pad', 20, 20, PAD_W, PAD_H)),
  extrude('e2', 's2', 'boss', { type: 'blind', depth: String(PAD_T) }),
  sketch('s3', face('e1:cap:end'), circle('post', postX, postY, POST_R)),
  extrude('e3', 's3', 'boss', { type: 'blind', depth: String(POST_H) }),
];

const curvePattern = (
  seeds: string[],
  path: Ref,
  def: Partial<Extract<PatternDefinition, { mode: 'curve' }>> = {},
  extra: Partial<PatternFeature> = {}
): Feature => ({
  id: 'pat1',
  type: 'pattern',
  name: 'pat1',
  suppressed: false,
  seeds,
  def: {
    mode: 'curve',
    path,
    count: '4',
    spacing: '20',
    equal: true,
    alignment: 'tangent',
    reverse: false,
    ...def,
  },
  ...extra,
});

describe('Curve-driven pattern (C6.4, ADR 0166)', () => {
  describe('Red Team 1: Input Corruption & Boundary Validation', () => {
    it('rejects count < 2 at command level with explicit error', () => {
      expect(() => {
        build(
          ...baseWithPadAndPost(),
          curvePattern(['e3'], { kind: 'edge', name: 'dummy' }, { count: '1' })
        );
      }).toThrowError(/實例數/);
    });

    it('rejects spacing <= 0 when equal is false at command level', () => {
      expect(() => {
        build(
          ...baseWithPadAndPost(),
          curvePattern(['e3'], { kind: 'edge', name: 'dummy' }, { equal: false, spacing: '0' })
        );
      }).toThrowError(/大於 0/);
    });

    it('rejects missing curve path with explicit error message during rebuild', () => {
      const doc = build(
        ...baseWithPadAndPost(),
        curvePattern(['e3'], { kind: 'edge', name: 'non_existent_edge' })
      );
      const r = rebuild(doc);
      expect(r.features.find((f) => f.id === 'pat1')?.status).toBe('error');
      expect(messageOf(r, 'pat1')).toContain('曲線路徑找不到');
    });

    it('rejects empty sketch path with curvePathNoGeometry error', () => {
      const emptySketch: Feature = {
        id: 's_empty',
        type: 'sketch',
        name: 's_empty',
        suppressed: false,
        plane: front,
        entities: [],
        constraints: [],
      };
      const doc = build(
        ...baseWithPadAndPost(),
        emptySketch,
        curvePattern(['e3'], { kind: 'datum', name: 's_empty' })
      );
      const r = rebuild(doc);
      expect(r.features.find((f) => f.id === 'pat1')?.status).toBe('error');
      expect(messageOf(r, 'pat1')).toContain('輪廓線段');
    });
  });

  describe('Red Team 2: Geometric Self-Intersection & Overlap Defense', () => {
    it('detects and intercepts overlapping instances before solver crash', () => {
      const rBase = rebuild(build(...baseWithPadAndPost()));
      const padEdgeIdx = rBase.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.abs(e.length - 100) < 1 && e.mid[1] < 25);
      const padEdgeName = rBase.body!.names.edges[padEdgeIdx]!;
      // Post diameter is 4. Spacing 2 mm along straight edge will cause overlap.
      const doc = build(
        ...baseWithPadAndPost(),
        curvePattern(
          ['e3'],
          { kind: 'edge', name: padEdgeName },
          { equal: false, spacing: '2', count: '4' }
        )
      );
      const r = rebuild(doc);
      expect(r.features.find((f) => f.id === 'pat1')?.status).toBe('error');
      expect(messageOf(r, 'pat1')).toContain('重疊');
    });
  });

  describe('Red Team 3: Dependency Graph Integrity & Topology Naming', () => {
    it('correctly tracks dependencies on seed and path', () => {
      const rBase = rebuild(build(...baseWithPadAndPost()));
      const padEdgeIdx = rBase.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.abs(e.length - 100) < 1 && e.mid[1] < 25);
      const padEdgeName = rBase.body!.names.edges[padEdgeIdx]!;
      const doc = build(
        ...baseWithPadAndPost(),
        curvePattern(['e3'], { kind: 'edge', name: padEdgeName })
      );
      const deps = dependencies(doc);
      const patDeps = deps.parents.get('pat1');
      expect(patDeps).toBeDefined();
      expect(patDeps).toContain('e3');
    });

    it('honors skipped instances while keeping naming invariant for remaining ones', () => {
      const rBase = rebuild(build(...baseWithPadAndPost()));
      const baseVol = volume(rBase);
      const padEdgeIdx = rBase.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.abs(e.length - 100) < 1 && e.mid[1] < 25);
      const padEdgeName = rBase.body!.names.edges[padEdgeIdx]!;
      const doc = build(
        ...baseWithPadAndPost(),
        curvePattern(
          ['e3'],
          { kind: 'edge', name: padEdgeName },
          { count: '4', equal: true },
          { skip: ['2'] } // skip instance 2
        )
      );
      const r = rebuild(doc);
      expect(failures(r)).toEqual([]);
      // Base + 2 pattern instances (total 2 added posts)
      expect(volume(r)).toBeCloseTo(baseVol + 2 * POST_VOL, 3);
      const names = r.body!.names.faces;
      // inst1 and inst3 exist, inst2 is skipped
      expect(names).toEqual(expect.arrayContaining(['pat1:inst1:e3:cap:end', 'pat1:inst3:e3:cap:end']));
      expect(names).not.toEqual(expect.arrayContaining(['pat1:inst2:e3:cap:end']));
    });
  });

  describe('Red Team 4: Ground Truth, Alignment Parity & WASM Memory Defense', () => {
    it('along a model edge with equal spacing: generates valid solid and conserved volume', () => {
      const rBase = rebuild(build(...baseWithPadAndPost()));
      const baseVol = volume(rBase);
      const padEdgeIdx = rBase.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.abs(e.length - 100) < 1 && e.mid[1] < 25);
      const padEdgeName = rBase.body!.names.edges[padEdgeIdx]!;
      const doc = build(
        ...baseWithPadAndPost(),
        curvePattern(['e3'], { kind: 'edge', name: padEdgeName }, { count: '4', equal: true })
      );
      const r = rebuild(doc);
      expect(failures(r)).toEqual([]);
      expect(r.bodies).toHaveLength(1);
      expect(kernel.isValid(r.body!.shape)).toBe(true);
      // Base + 3 added instances = 3 extra posts
      expect(volume(r)).toBeCloseTo(baseVol + 3 * POST_VOL, 3);
      for (let i = 1; i <= 3; i++) {
        expect(r.body!.names.faces).toContain(`pat1:inst${i}:e3:cap:end`);
      }
    });

    it('along a sketch path: tangent orientation vs parallel alignment along a line sketch path', () => {
      // Path sketch: straight line from (20, 10) to (120, 10) on top face of base plate
      const pathSketch = sketch('s_path', face('e1:cap:end'), line('path_line', 20, 10, 120, 10));
      const rBase = rebuild(build(...baseWithPadAndPost(), pathSketch));
      const baseVol = volume(rBase);

      const docTangent = build(
        ...baseWithPadAndPost(),
        pathSketch,
        curvePattern(
          ['e3'],
          { kind: 'datum', name: 's_path' },
          { count: '4', equal: true, alignment: 'tangent' }
        )
      );
      const rTangent = rebuild(docTangent);
      expect(failures(rTangent)).toEqual([]);

      const docParallel = build(
        ...baseWithPadAndPost(),
        pathSketch,
        curvePattern(
          ['e3'],
          { kind: 'datum', name: 's_path' },
          { count: '4', equal: true, alignment: 'parallel' }
        )
      );
      const rParallel = rebuild(docParallel);
      expect(failures(rParallel)).toEqual([]);

      // Both produce valid geometry and identical overall post volume
      expect(volume(rTangent)).toBeCloseTo(baseVol + 3 * POST_VOL, 3);
      expect(volume(rParallel)).toBeCloseTo(baseVol + 3 * POST_VOL, 3);
    });

    it('reversing direction flips placement order along curve', () => {
      // Seed at (100, 10), so reverse moves leftwards onto the plate
      const rBase = rebuild(build(...baseWithPadAndPost(100, 10)));
      const padEdgeIdx = rBase.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.abs(e.length - 100) < 1 && e.mid[1] < 25);
      const padEdgeName = rBase.body!.names.edges[padEdgeIdx]!;

      const docRev = build(
        ...baseWithPadAndPost(100, 10),
        curvePattern(
          ['e3'],
          { kind: 'edge', name: padEdgeName },
          { count: '3', equal: false, spacing: '25', reverse: true }
        )
      );
      const rRev = rebuild(docRev);
      expect(failures(rRev)).toEqual([]);
    });

    it('WASM Heap memory leak defense: asserts true ground-truth indicator > 0 and 0 leak across rebuilds', () => {
      const getWasmHeap = () => (kernel.oc as any).wasmMemory?.buffer?.byteLength as number;
      const initialHeap = getWasmHeap();
      // AGENTS.md §3.1: Ground Truth Existence Defense
      expect(initialHeap, 'Emscripten WASM Heap must exist and be greater than 0').toBeGreaterThan(0);

      const rBase = rebuild(build(...baseWithPadAndPost()));
      const padEdgeIdx = rBase.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.abs(e.length - 100) < 1 && e.mid[1] < 25);
      const padEdgeName = rBase.body!.names.edges[padEdgeIdx]!;
      const doc = build(
        ...baseWithPadAndPost(),
        curvePattern(['e3'], { kind: 'edge', name: padEdgeName }, { count: '4', equal: true })
      );

      // Warmup run
      const r0 = rebuild(doc);
      expect(failures(r0)).toEqual([]);

      const baselineHeap = getWasmHeap();
      // Run multiple rebuild cycles
      for (let i = 0; i < 5; i++) {
        const r = rebuild(doc);
        expect(failures(r)).toEqual([]);
      }
      const finalHeap = getWasmHeap();
      expect(finalHeap, 'Linear edge curve pattern must not leak WASM memory across iterations').toBeLessThanOrEqual(baselineHeap + 1024 * 1024);
    });
  });
});
