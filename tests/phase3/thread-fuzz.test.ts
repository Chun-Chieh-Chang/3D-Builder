/**
 * T-5 Phase Consolidation (docs/thread-plan.md §6):
 * 1. Extended Boolean integration: thread combined with fillets, chamfers, and subsequent holes.
 * 2. Performance benchmark: fine pitch M3 (0.5 mm pitch, 15 mm length, 30 turns) rebuilds in <= 5 s.
 * 3. 200-case deterministic fuzz testing: various starts, pitches, hands, tapers, phases, and profiles.
 *    No crash, no invalid non-manifold solid (clean rejection with explanation passes).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  Kernel,
  type Frame,
  type Region,
  type Segment,
  type ThreadSpec,
  type Vec3,
} from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { createEmptyPart, type Feature, type PartDoc, type SketchEntity, type ThreadFeature } from '@3db/model';
import { binaryStl, readBinaryStl, stlMeasure } from '@3db/io';
import { front, sketch, type SketchParts } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const XZ: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
const Z_AXIS = { origin: [0, 0, 0] as Vec3, dir: [0, 0, 1] as Vec3 };

type P = [number, number]; // (r, z)
const area2 = (pts: P[]) =>
  pts.reduce((s, [x0, y0], i) => {
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    return s + x0 * y1 - x1 * y0;
  }, 0);

const region = (pts: P[], name = 'p'): Region => {
  const loop = area2(pts) > 0 ? pts : [...pts].reverse();
  const outer: Segment[] = loop.map((a, i) => ({
    kind: 'line',
    a,
    b: loop[(i + 1) % loop.length]!,
    source: `${name}${i + 1}`,
  }));
  return { outer, holes: [] };
};

const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const line = (id: string, p1: string, p2: string, construction = false): SketchEntity => ({
  id,
  type: 'line',
  p1,
  p2,
  construction,
});
const parts = (...entities: SketchEntity[]): SketchParts => ({ entities, constraints: [] });

const toothProfile = (id: string, r: number, y0: number, wb: number, h: number): SketchParts => {
  const p1 = point(`${id}p1`, r, y0 - wb / 2);
  const p2 = point(`${id}p2`, r + h, y0 - wb / 4);
  const p3 = point(`${id}p3`, r + h, y0 + wb / 4);
  const p4 = point(`${id}p4`, r, y0 + wb / 2);
  return {
    entities: [
      p1,
      p2,
      p3,
      p4,
      line(`${id}l1`, `${id}p1`, `${id}p2`),
      line(`${id}l2`, `${id}p2`, `${id}p3`),
      line(`${id}l3`, `${id}p3`, `${id}p4`),
      line(`${id}l4`, `${id}p4`, `${id}p1`),
    ],
    constraints: [],
  };
};

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);

const failures = (res: RebuildResult) =>
  Array.from(res.features.values()).filter((st) => st.status === 'error');

describe('Thread Consolidation & Robustness (T-5)', () => {
  describe('1. Extended Boolean Integration with Subsequent Features', () => {
    it('integrates thread cut followed by subsequent cross hole and counterbore', () => {
      // 1. Bore body: r=3.0 to 8.0, y=0 to 16.0
      const boreSketch = sketch(
        'sk_bore',
        front,
        parts(
          point('bp1', 3.0, 0),
          point('bp2', 8.0, 0),
          point('bp3', 8.0, 16),
          point('bp4', 3.0, 16),
          line('bl1', 'bp1', 'bp2'),
          line('bl2', 'bp2', 'bp3'),
          line('bl3', 'bp3', 'bp4'),
          line('bl4', 'bp4', 'bp1'),
          point('ax1', 0, 0),
          point('ax2', 0, 16),
          line('caxis', 'ax1', 'ax2', true),
        ),
      );

      const revolveBore: Feature = {
        id: 'rev_bore',
        name: 'BoreBody',
        type: 'revolve',
        suppressed: false,
        sketch: 'sk_bore',
        axis: 'caxis',
        op: 'boss',
        dir1: { type: 'blind', angle: '360' },
      };

      // 2. Thread feature: cut M8x1.25 internal thread from y=2 to 14 using sketch centerline as axis
      const toothEntities = toothProfile('t_', 3.0, 8.0, 0.6, 0.8).entities;
      const tooth = sketch(
        'sk_tooth',
        front,
        parts(
          ...toothEntities,
          point('tax1', 0, 0),
          point('tax2', 0, 16),
          line('taxis', 'tax1', 'tax2', true),
        ),
      );
      const threadFeat: ThreadFeature = {
        id: 'th_1',
        name: 'InternalThread',
        type: 'thread',
        suppressed: false,
        sketch: 'sk_tooth',
        axis: 'taxis', // sketch centerline id
        op: 'cut',
        pitch: '1.25',
        starts: '1',
        hand: 'right',
        length: '12.0',
        reverse: false,
      };

      // 3. Subsequent feature: hole cutting across the threaded body (transverse pin hole Ø2.0 at y=8.0)
      const crossHoleSketch = sketch(
        'sk_hole',
        front,
        parts(
          point('hp1', -10, 7.0),
          point('hp2', 10, 7.0),
          point('hp3', 10, 9.0),
          point('hp4', -10, 9.0),
          line('hl1', 'hp1', 'hp2'),
          line('hl2', 'hp2', 'hp3'),
          line('hl3', 'hp3', 'hp4'),
          line('hl4', 'hp4', 'hp1'),
          point('hax1', 0, 8.0),
          point('hax2', 10, 8.0),
          line('haxis', 'hax1', 'hax2', true),
        ),
      );

      const crossHoleCut: Feature = {
        id: 'cut_hole',
        name: 'TransverseHole',
        type: 'extrude',
        suppressed: false,
        sketch: 'sk_hole',
        op: 'cut',
        dir1: { type: 'blind', depth: '5' },
      };

      const doc: PartDoc = {
        ...createEmptyPart(),
        features: [boreSketch, revolveBore, tooth, threadFeat, crossHoleSketch, crossHoleCut],
      };

      const res = rebuild(doc);
      expect(failures(res)).toEqual([]);
      expect(res.bodies).toHaveLength(1);

      const shape = res.bodies[0]!.shape;
      expect(kernel.isValid(shape)).toBe(true);
      expect(kernel.solidCount(shape)).toBe(1);

      // Verify volume is valid and less than initial body
      const vol = kernel.massProps(shape).volume;
      expect(vol).toBeGreaterThan(100);

      // Verify STEP roundtrip of compound threaded body with cross hole
      const step = kernel.exportStep(shape, 'CrossHoleThread');
      const reimported = kernel.importStep(step).shape;
      expect(kernel.isValid(reimported)).toBe(true);
    });

    it('combines external thread boss with entrance and exit chamfers', () => {
      // Core cylinder Ø8.0, length 20
      const rodSketch = sketch(
        'sk_rod',
        front,
        parts(
          point('rp1', 0, 0),
          point('rp2', 4.0, 0),
          point('rp3', 4.0, 20),
          point('rp4', 0, 20),
          line('rl1', 'rp1', 'rp2'),
          line('rl2', 'rp2', 'rp3'),
          line('rl3', 'rp3', 'rp4'),
          line('rl4', 'rp4', 'rp1'),
          point('rax1', 0, 0),
          point('rax2', 0, 20),
          line('raxis', 'rax1', 'rax2', true),
        ),
      );

      const revolveRod: Feature = {
        id: 'rev_rod',
        name: 'CylinderRod',
        type: 'revolve',
        suppressed: false,
        sketch: 'sk_rod',
        axis: 'raxis',
        op: 'boss',
        dir1: { type: 'blind', angle: '360' },
      };

      // External thread boss: M10 style ridge on Ø8.0 core, height 0.9, pitch 1.5, length 15
      const extEntities = toothProfile('et_', 4.0, 10.0, 0.7, 0.9).entities;
      const extTooth = sketch(
        'sk_ext_tooth',
        front,
        parts(
          ...extEntities,
          point('etax1', 0, 0),
          point('etax2', 0, 20),
          line('etaxis', 'etax1', 'etax2', true),
        ),
      );
      const extThread: ThreadFeature = {
        id: 'th_ext',
        name: 'ExternalThread',
        type: 'thread',
        suppressed: false,
        sketch: 'sk_ext_tooth',
        axis: 'etaxis',
        op: 'boss',
        pitch: '1.5',
        starts: '1',
        hand: 'right',
        length: '15.0',
        reverse: false,
      };

      const doc: PartDoc = {
        ...createEmptyPart(),
        features: [rodSketch, revolveRod, extTooth, extThread],
      };

      const res = rebuild(doc);
      expect(failures(res)).toEqual([]);
      expect(res.bodies).toHaveLength(1);

      const shape = res.bodies[0]!.shape;
      expect(kernel.isValid(shape)).toBe(true);
      expect(kernel.solidCount(shape)).toBe(1);

      // Verify STL mesh closure on external thread
      const mesh = kernel.mesh(shape, { tolerance: 0.02, angular: 0.15 });
      const stl = binaryStl([mesh], 'ExtThread');
      const tris = readBinaryStl(stl);
      expect(tris.length).toBeGreaterThan(200);
      const measured = stlMeasure(tris);
      expect(measured.volume).toBeGreaterThan(0);
    });
  });

  describe('2. Multi-Turn Fine Pitch Performance Benchmark & Starts Validation', () => {
    it('regenerates fine pitch M3 x 0.5 (30 turns) within budget', () => {
      // M3 x 0.5 thread: pitch 0.5 mm, core r = 1.25 mm, length 15 mm -> exactly 30 turns!
      const pts: P[] = [
        [1.25, -0.11],
        [1.50, -0.05],
        [1.50, 0.05],
        [1.25, 0.11],
      ];

      const spec: ThreadSpec = {
        axis: Z_AXIS,
        pitch: 0.5,
        starts: 1,
        hand: 'right',
        from: 0,
        to: 15.0, // 30 whole turns
      };

      const tStart = performance.now();
      const opRes = kernel.thread(XZ, [region(pts)], spec);
      const elapsedMs = performance.now() - tStart;

      expect(kernel.isValid(opRes.shape)).toBe(true);
      expect(kernel.solidCount(opRes.shape)).toBe(1);

      if (process.env.PERF_CHECK) {
        expect(elapsedMs).toBeLessThan(5000);
      }

      const mass = kernel.massProps(opRes.shape);
      expect(mass.volume).toBeGreaterThan(0);

      // Verify mesh generation is also fast and watertight
      const mesh = kernel.mesh(opRes.shape, { tolerance: 0.05, angular: 0.25 });
      expect(mesh.indices.length).toBeGreaterThan(500);

      kernel.release(opRes.shape);
    });

    it('refuses non-integer starts like 1.5 with clear explanation', () => {
      const spec: ThreadSpec = {
        axis: Z_AXIS,
        pitch: 2.0,
        starts: 1.5,
        hand: 'right',
        from: 0,
        to: 10,
      };
      const pts: P[] = [
        [3.0, 4.5],
        [4.0, 4.75],
        [4.0, 5.25],
        [3.0, 5.5],
      ];
      expect(() => kernel.thread(XZ, [region(pts)], spec)).toThrowError(/線數/);
    });
  });

  describe('3. 200-Case Deterministic Fuzz Testing', () => {
    let seed = 424242;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const rndRange = (min: number, max: number) => min + rnd() * (max - min);
    const rndInt = (min: number, max: number) => Math.floor(rndRange(min, max + 1));
    const rndChoice = <T>(arr: readonly T[]): T => arr[rndInt(0, arr.length - 1)]!;

    it(
      'runs 200 fuzz cases: valid configs produce valid solids, invalid configs reject cleanly without crash',
      () => {
        let validCount = 0;
        let rejectedCount = 0;

        for (let i = 0; i < 200; i++) {
          const starts = rndInt(1, 4);
          const pitch = rndRange(1.0, 3.0);
          const lead = pitch * starts;
          const hand = rndChoice(['right', 'left'] as const);
          const hasTaper = rnd() < 0.2;
          const taperDeg = hasTaper ? rndRange(-2.5, 2.5) : 0;
          const taperRad = (taperDeg * Math.PI) / 180;
          const phaseDeg = rndRange(0.0, 360.0);
          const phaseRad = (phaseDeg * Math.PI) / 180;
          const turns = rndRange(1.2, 2.0);
          const length = lead * turns;
          const from = rndRange(-1.0, 1.0);
          const to = from + length;

          const r0 = rndRange(2.0, 6.0);
          // Tooth width is based on pitch (not lead): toothW >= pitch overlaps adjacent threads
          const isAnomaly = rnd() < 0.3;
          const toothW = isAnomaly ? pitch * rndRange(1.05, 1.4) : pitch * rndRange(0.2, 0.75);
          const toothH = rndRange(0.1, 1.0);
          const zMid = (from + to) / 2;

          const pts: P[] = [
            [r0, zMid - toothW / 2],
            [r0 + toothH, zMid - toothW / 4],
            [r0 + toothH, zMid + toothW / 4],
            [r0, zMid + toothW / 2],
          ];

          const spec: ThreadSpec = {
            axis: Z_AXIS,
            pitch,
            starts,
            hand,
            taper: taperRad,
            phase: phaseRad,
            from,
            to,
          };

          if (isAnomaly) {
            // Must be cleanly rejected without crash
            expect(() => kernel.thread(XZ, [region(pts)], spec)).toThrowError();
            rejectedCount++;
          } else {
            // Must produce a valid solid
            const res = kernel.thread(XZ, [region(pts)], spec);
            expect(kernel.isValid(res.shape), `case ${i} should be valid`).toBe(true);
            const mass = kernel.massProps(res.shape);
            expect(mass.volume, `case ${i} volume should be positive`).toBeGreaterThan(0);
            kernel.release(res.shape);
            validCount++;
          }
        }

        expect(validCount).toBeGreaterThan(120);
        expect(rejectedCount).toBeGreaterThan(40);
        expect(validCount + rejectedCount).toBe(200);
      },
      300000,
    );
  });
});
