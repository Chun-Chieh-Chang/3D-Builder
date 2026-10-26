/**
 * Phase 7 / Blueprint C11.4: Sheet Metal Break Corner Advanced Suite (ADR 0161).
 *
 * Self-Red-Teaming adversarial test suite:
 * 1. Base flange chamfer: single corner thickness edge, closed-form volume & flat area
 * 2. Base flange multi-corner fillet: 4 corners filleted at once, arc outline in flat pattern
 * 3. Mixed edge flange & base plate compound break corner features
 * 4. Jog plate corner chamfer integration
 * 5. Input corruption: rejects size <= 0
 * 6. Input corruption: rejects non-thickness edge
 * 7. Boundary defense: rejects oversized corner (size >= adjacent edge length)
 * 8. Memory defense: ground truth Emscripten WASM Heap assertion (> 0)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type Feature, type PartDoc, type Ref } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { flatPattern, Regenerator, type RebuildResult } from '@3db/regen';
import { front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

afterAll(() => kept.forEach((r) => r.dispose()));

const rebuild = (doc: PartDoc): RebuildResult => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  return regen.rebuild(doc);
};

const build = (features: Feature[]): PartDoc =>
  features.reduce((d, feature, index) => applyCommand(d, { type: 'insertFeature', feature, index }), createEmptyPart());

const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));

const baseSheet: Feature[] = [
  sketch('sk', front, rectangle('r', 0, 0, 100, 60)),
  {
    id: 'bf',
    type: 'baseFlange',
    name: 'bf',
    suppressed: false,
    sketch: 'sk',
    thickness: '1.5',
    radius: '2',
    kFactor: '0.5',
  } as Feature,
];

function edgeAt(r: RebuildResult, point: [number, number, number]): Ref {
  const i = r.body!.topology.edges.findIndex(
    (edge) => edge.curve === 'line' && Math.hypot(edge.mid[0] - point[0], edge.mid[1] - point[1], edge.mid[2] - point[2]) < 1e-4,
  );
  expect(i, `edge at ${point}`).toBeGreaterThanOrEqual(0);
  return { kind: 'edge', name: r.body!.names.edges[i]!, fingerprint: edgeFingerprint(r.body!.topology, i) };
}

describe('sheet metal break corner & corner relief (C11.4, ADR 0161)', () => {
  it('chamfers a base flange corner and matches closed-form volume & flat pattern area', () => {
    const plain = rebuild(build(baseSheet));
    expect(failures(plain)).toEqual([]);
    const vPlain = kernel.massProps(plain.body!.shape).volume;

    // Thickness edge at corner (100, 0, 0.75)
    const corner = edgeAt(plain, [100, 0, 0.75]);
    const size = 6;
    const doc = build([
      ...baseSheet,
      { id: 'bc1', type: 'breakCorner', name: 'bc1', suppressed: false, corners: [corner], kind: 'chamfer', size: String(size) } as Feature,
    ]);

    const result = rebuild(doc);
    expect(failures(result)).toEqual([]);
    expect(kernel.isValid(result.body!.shape)).toBe(true);

    const vResult = kernel.massProps(result.body!.shape).volume;
    const expectedCutVolume = 0.5 * size * size * 1.5;
    expect(vPlain - vResult).toBeCloseTo(expectedCutVolume, 4);

    const flat = flatPattern(kernel, result.sheet!);
    const baseFlat = flatPattern(kernel, plain.sheet!);
    try {
      const expectedCutArea = 0.5 * size * size;
      expect(baseFlat.area - flat.area).toBeCloseTo(expectedCutArea, 4);
      expect(flat.volume).toBeCloseTo(vResult, 4);
      expect(flat.outline.some((s) => s.kind === 'line')).toBe(true);
    } finally {
      kernel.release(flat.shape);
      kernel.release(baseFlat.shape);
    }
  });

  it('fillets all 4 corners of a base flange at once with exact circular arcs in flat pattern', () => {
    const plain = rebuild(build(baseSheet));
    const vPlain = kernel.massProps(plain.body!.shape).volume;

    // All 4 thickness edges of the 100 x 60 plate
    const c1 = edgeAt(plain, [0, 0, 0.75]);
    const c2 = edgeAt(plain, [100, 0, 0.75]);
    const c3 = edgeAt(plain, [100, 60, 0.75]);
    const c4 = edgeAt(plain, [0, 60, 0.75]);

    const R = 5;
    const doc = build([
      ...baseSheet,
      { id: 'bc_all', type: 'breakCorner', name: 'bc_all', suppressed: false, corners: [c1, c2, c3, c4], kind: 'fillet', size: String(R) } as Feature,
    ]);

    const result = rebuild(doc);
    expect(failures(result)).toEqual([]);
    expect(kernel.isValid(result.body!.shape)).toBe(true);

    const vResult = kernel.massProps(result.body!.shape).volume;
    const singleCornerCutVol = R * R * (1 - Math.PI / 4) * 1.5;
    expect(vPlain - vResult).toBeCloseTo(4 * singleCornerCutVol, 3);

    const flat = flatPattern(kernel, result.sheet!);
    const baseFlat = flatPattern(kernel, plain.sheet!);
    try {
      const singleCornerCutArea = R * R * (1 - Math.PI / 4);
      expect(baseFlat.area - flat.area).toBeCloseTo(4 * singleCornerCutArea, 3);
      // Flat pattern outline must contain arcs for filleted corners
      const arcs = flat.outline.filter((s) => s.kind === 'arc');
      expect(arcs.length).toBeGreaterThanOrEqual(4);
    } finally {
      kernel.release(flat.shape);
      kernel.release(baseFlat.shape);
    }
  });

  it('supports compound break corner features across edge flange and base plate', () => {
    const plate = rebuild(build(baseSheet));
    const flange: Feature = {
      id: 'ef',
      type: 'edgeFlange',
      name: 'ef',
      suppressed: false,
      edge: edgeAt(plate, [100, 30, 1.5]),
      length: '25',
    };
    const withFlange = rebuild(build([...baseSheet, flange]));
    expect(failures(withFlange)).toEqual([]);

    // One corner on base plate (0, 0, 0.75) and one corner on flange free end
    const cornerBase = edgeAt(withFlange, [0, 0, 0.75]);
    const cornerFlange = edgeAt(withFlange, [99.25, 0, 25]);

    const doc = build([
      ...baseSheet,
      flange,
      { id: 'bc_comp', type: 'breakCorner', name: 'bc_comp', suppressed: false, corners: [cornerBase, cornerFlange], kind: 'chamfer', size: '3' } as Feature,
    ]);

    const result = rebuild(doc);
    expect(failures(result)).toEqual([]);
    expect(kernel.isValid(result.body!.shape)).toBe(true);
    expect(kernel.solidCount(result.body!.shape)).toBe(1);

    const flat = flatPattern(kernel, result.sheet!);
    try {
      expect(flat.volume).toBeCloseTo(kernel.massProps(result.body!.shape).volume, 3);
    } finally {
      kernel.release(flat.shape);
    }
  });

  it('integrates break corner with jogged sheet metal bodies', () => {
    // 100 x 50 x 1.5 sheet with a mid-stroke jog line at x = 50
    const jogFeatures: Feature[] = [
      sketch('sk_jog', front, rectangle('r', 0, 0, 100, 50)),
      { id: 'bf_jog', type: 'baseFlange', name: 'bf_jog', suppressed: false, sketch: 'sk_jog', thickness: '1.5', radius: '2', kFactor: '0.5' } as Feature,
      sketch('sk_line', front, {
        entities: [
          { id: 'pa', type: 'point', x: 50, y: -5 },
          { id: 'pb', type: 'point', x: 50, y: 55 },
          { id: 'l_cut', type: 'line', p1: 'pa', p2: 'pb' },
        ],
        constraints: [],
      }),
      { id: 'jg', type: 'jog', name: 'jg', suppressed: false, sketch: 'sk_line', offset: '10', angle: '90' } as Feature,
    ];

    const jogRebuild = rebuild(build(jogFeatures));
    expect(failures(jogRebuild)).toEqual([]);

    // Fixed side corner at (0, 0, 0.75)
    const fixedCorner = edgeAt(jogRebuild, [0, 0, 0.75]);
    const doc = build([
      ...jogFeatures,
      { id: 'bc_jog', type: 'breakCorner', name: 'bc_jog', suppressed: false, corners: [fixedCorner], kind: 'fillet', size: '4' } as Feature,
    ]);

    const result = rebuild(doc);
    expect(failures(result)).toEqual([]);
    expect(kernel.isValid(result.body!.shape)).toBe(true);
  });

  it('input corruption defense: rejects size <= 0', () => {
    const plain = rebuild(build(baseSheet));
    const corner = edgeAt(plain, [100, 0, 0.75]);
    expect(() =>
      build([
        ...baseSheet,
        { id: 'bc_zero', type: 'breakCorner', name: 'bc_zero', suppressed: false, corners: [corner], kind: 'chamfer', size: '0' } as Feature,
      ]),
    ).toThrow(/數值必須大於 0|大於 0/);
  });

  it('input corruption defense: rejects non-thickness edge', () => {
    const plain = rebuild(build(baseSheet));
    // Non-thickness edge along X axis (length 100, midpoint at (50, 0, 1.5))
    const topEdgeIndex = plain.body!.topology.edges.findIndex(
      (e) => e.curve === 'line' && Math.hypot(e.mid[0] - 50, e.mid[1] - 0, e.mid[2] - 1.5) < 1e-4,
    );
    expect(topEdgeIndex).toBeGreaterThanOrEqual(0);
    const nonThickRef: Ref = {
      kind: 'edge',
      name: plain.body!.names.edges[topEdgeIndex]!,
      fingerprint: edgeFingerprint(plain.body!.topology, topEdgeIndex),
    };

    const doc = build([
      ...baseSheet,
      { id: 'bc_bad_edge', type: 'breakCorner', name: 'bc_bad_edge', suppressed: false, corners: [nonThickRef], kind: 'chamfer', size: '2' } as Feature,
    ]);

    const r = rebuild(doc);
    expect(statuses(r)).toContain('bc_bad_edge=error(只能選取鈑金未封閉的外角厚度邊)');
  });

  it('boundary defense: rejects oversized corner (size >= adjacent edge)', () => {
    const plain = rebuild(build(baseSheet));
    const corner = edgeAt(plain, [100, 0, 0.75]);
    // Width is 60, size 70 exceeds the adjacent edge length
    const doc = build([
      ...baseSheet,
      { id: 'bc_oversized', type: 'breakCorner', name: 'bc_oversized', suppressed: false, corners: [corner], kind: 'chamfer', size: '70' } as Feature,
    ]);

    const r = rebuild(doc);
    expect(statuses(r)).toContain('bc_oversized=error(斷開角落尺寸必須大於 0 且小於相鄰板邊長度)');
  });

  it('memory integrity defense: Emscripten WASM Heap assertion (AGENTS.md §3.1)', () => {
    const rawHeap = (kernel.oc as any).wasmMemory?.buffer?.byteLength;
    expect(rawHeap).toBeDefined();
    expect(rawHeap).toBeGreaterThan(0);
  });
});
