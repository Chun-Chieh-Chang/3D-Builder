/**
 * ADR 0262, drawing rules C1, C2, C4, D1, D3, D9, L1, L2: what a dimension counts, where extension lines and centre marks go, and what is left out.
 * Faces cut from one coaxial cylinder or fillet ring are one feature (`surface`), so a count is of features and not of face patches; concentric circles share
 * one centre cross; coaxial side-on cylinders share one axis line; sliver faces (< 0.01 mm²) are left out; section extension lines start outside cut hatching;
 * ordinate numbers stay clear of their own extension lines; stepped internal bores ending in a narrowing cone/torus are not marked through.
 */
import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, viewVectors, type Dimension, type DrawingView, type ElementFacts, type ViewFeature } from '@3db/model';
import { buildScene, centreItems, clutterOf, dimensionCoverage, evaluateDimension, planDrawingDimensions, type DimensionLike, type PlacedView, type ViewLines, type ViewToDimension } from '@3db/drawing';
import { holeInfo, MIN_DIMENSION_FACE_AREA, sketchTextPrefixes, viewFeatures } from '@3db/regen';
import type { Topology } from '@3db/kernel';

const ref = (name: string) => ({ kind: 'face' as const, name });
const circle = (name: string, r: number, full: boolean, surface?: string, centre: [number, number] = [0, 0]): ViewFeature => ({
  type: 'circle', ref: ref(name), centre, radius: r, convex: true, full, outward: 45, ...(surface ? { surface } : {}),
});
const view = (features: ViewFeature[]): ViewToDimension[] => [{ viewId: 'v1', axes: viewVectors('front'), features }];
const sizes = (v: ViewToDimension[]) => planDrawingDimensions(v, [], {}).filter((p) => p.role === 'size');

describe('a count is of features, not of face patches (rule C1)', () => {
  it('three faces of one cylinder cut by slots are one Ø without a count', () => {
    const planned = sizes(view([circle('a', 5, true, 's1'), circle('b', 5, true, 's1'), circle('c', 5, true, 's1')]));
    expect(planned).toHaveLength(1);
    expect(planned[0]!.draft).toMatchObject({ kind: 'diameter' });
    expect((planned[0]!.draft as { count?: number }).count).toBeUndefined();
  });

  it('two separate cylinders of the same diameter are 2×', () => {
    const planned = sizes(view([circle('a', 5, true, 's1', [0, 0]), circle('b', 5, true, 's2', [30, 0])]));
    expect(planned).toHaveLength(1);
    expect((planned[0]!.draft as { count?: number }).count).toBe(2);
  });

  it('a size written for one patch gives the whole surface: coverage counts the other patches as sized', () => {
    const v = view([circle('a', 5, true, 's1'), circle('b', 5, true, 's1')]);
    const written = [{ id: 'd1', view: 'v1', kind: 'diameter', ref: ref('a'), angle: 45 }] as unknown as DimensionLike[];
    expect(dimensionCoverage(v, written).rounds.missing).toEqual([]);
  });
});

describe('centre marks (rules L1, L2)', () => {
  const placed = { id: 'v1', at: [100, 100] as [number, number], scale: 1, w: 40, h: 40, centre: [0, 0] as [number, number] };
  const model = { id: 'v1', name: 'f', source: 'a.3dbx', direction: 'front' as const };

  it('concentric whole circles share one centre cross, sized to the largest', () => {
    const items = centreItems(model, [circle('a', 2, true), circle('b', 5, true), circle('c', 8, true)], placed);
    expect(items).toHaveLength(4);
    const longest = Math.max(...items.map((i) => (i.kind === 'polyline' ? Math.hypot(i.points[2]! - i.points[0]!, i.points[3]! - i.points[1]!) : 0)));
    expect(longest).toBeCloseTo(8 + 2, 6);
  });

  it('circles at different centres each keep their own cross', () => {
    expect(centreItems(model, [circle('a', 2, true, undefined, [0, 0]), circle('b', 2, true, undefined, [20, 0])], placed)).toHaveLength(8);
  });

  it('side-on cylinders on one line draw one axis from end to end; a section draws it too when asked', () => {
    const axis = (name: string, from: [number, number], to: [number, number]): ViewFeature => ({ type: 'axis', ref: ref(name), from, to, radius: 3 });
    const features = [axis('a', [0, 0], [10, 0]), axis('b', [10, 0], [25, 0])];
    const items = centreItems(model, features, placed);
    expect(items).toHaveLength(2);
    const xs = items.flatMap((i) => (i.kind === 'polyline' ? [i.points[2]!] : []));
    // the axis runs from x = 0 to 25 (sheet 100 + (x − 0)) and 2 mm past each end
    expect(Math.min(...xs)).toBeCloseTo(100 - 2, 6);
    expect(Math.max(...xs)).toBeCloseTo(100 + 25 + 2, 6);
    const section = { id: 's', name: 'A', kind: 'section' as const, parent: 'v1', line: [[0, 0], [0, 1]] as [[number, number], [number, number]], label: 'A' };
    expect(centreItems(section, features, placed)).toEqual([]);
    expect(centreItems({ ...section, centreMarks: true }, features, placed)).toHaveLength(2);
  });
});

describe('hidden end-on circles move to side-on Ø (rule C2)', () => {
  it('a full circle hidden in the end view gets a side-on Ø linear dimension in the section, covering all split patches', () => {
    const endView: ViewToDimension = {
      viewId: 'end',
      axes: viewVectors('top'),
      features: [circle('c1', 4, true, 'cyl#0'), circle('c2', 4, true, 'cyl#0')],
      hidden: new Set(['c1', 'c2']),
    };
    const secView: ViewToDimension = {
      viewId: 'sec',
      axes: viewVectors('front'),
      section: true,
      features: [{ type: 'axis', ref: ref('c1'), from: [0, 0], to: [0, 20], radius: 4 }],
    };
    const planned = sizes([endView, secView]);
    expect(planned).toHaveLength(1);
    expect(planned[0]!.view).toBe('sec');
    expect(planned[0]!.draft).toMatchObject({ kind: 'linear', aSide: 1, bSide: -1, prefix: 'Ø' });
    const written = planned.map((p) => ({ ...p.draft, view: p.view }) as DimensionLike);
    expect(dimensionCoverage([endView, secView], written).rounds.missing).toEqual([]);
  });
});

describe('sliver faces are excluded from viewFeatures (rule C4)', () => {
  it('ignores faces with area < MIN_DIMENSION_FACE_AREA (0.01 mm²) and keeps valid faces', () => {
    const topo: Topology = {
      faces: [
        { surface: 'plane', area: 1e-4, center: [0, 0, 0], normal: [1, 0, 0], geometry: { type: 'plane', origin: [0, 0, 0], normal: [1, 0, 0] } },
        { surface: 'plane', area: 25, center: [10, 0, 0], normal: [1, 0, 0], geometry: { type: 'plane', origin: [10, 0, 0], normal: [1, 0, 0] } },
      ],
      edges: [],
      vertices: [],
    };
    expect(MIN_DIMENSION_FACE_AREA).toBe(0.01);
    const feats = viewFeatures(topo, { faces: ['sliver', 'good'], edges: [], vertices: [] }, viewVectors('front'));
    expect(feats.map((f) => f.ref.name)).toEqual(['good']);
  });
});

describe('section extension lines and ordinate spacing (rules D1, D3)', () => {
  const placed: PlacedView = { id: 'v1', at: [100, 100], scale: 1, w: 40, h: 40, centre: [20, 20] };
  const axes = viewVectors('front');

  it('extension line in a section view starts outside the cut hatch polygon', () => {
    const dim: Dimension = { id: 'd1', view: 'v1', kind: 'linear', a: ref('a'), b: ref('b'), orientation: 'horizontal', offset: -10 };
    const ea: ElementFacts = { kind: 'face', type: 'plane', point: [10, 20, 0], dir: [1, 0, 0], center: [10, 20, 0] };
    const eb: ElementFacts = { kind: 'face', type: 'plane', point: [30, 20, 0], dir: [1, 0, 0], center: [30, 20, 0] };
    // Visible step sits inside y in [15, 25], while the cut hatch polygon extends down to y = 0 around x = 10 and x = 30
    const lines: ViewLines = {
      visible: [[10, 15, 10, 25], [30, 15, 30, 25]],
      hidden: [],
      cut: [[5, 0, 35, 0, 35, 40, 5, 40, 5, 0]],
      box: { min: [0, 0], max: [40, 40] },
    };
    const out = evaluateDimension(dim, { elements: [ea, eb] }, axes, placed, 'mm', undefined, lines);
    expect('error' in out).toBe(false);
    if (!('error' in out)) {
      // Every extension line point must have sheet y <= 80 (which is view y = 0, the bottom of the cut polygon)
      const extYs = out.items.flatMap((i) => (i.kind === 'polyline' && !i.filled && i.points[0] === i.points[2] ? [i.points[1]!, i.points[3]!] : []));
      expect(extYs.length).toBeGreaterThanOrEqual(4);
      expect(Math.max(...extYs)).toBeLessThanOrEqual(80);
    }
  });

  it('ordinate dimension numbers stay clear of their own extension lines under -0.6 mm clearance', () => {
    const dim: Dimension = { id: 'd1', view: 'v1', kind: 'ordinate', axis: 'x', origin: ref('p0'), refs: [ref('p1'), ref('p2')], offset: -10 };
    const els: ElementFacts[] = [0, 10, 30].map((x) => ({ kind: 'face', type: 'plane', point: [x, 0, 0], dir: [1, 0, 0], center: [x, 0, 0] }));
    const out = evaluateDimension(dim, { elements: els }, axes, placed);
    expect('error' in out).toBe(false);
    if (!('error' in out)) {
      const items = out.items.map((i) => ({ ...i, group: 'd1' }));
      expect(clutterOf(items, -0.6).count).toBe(0);
    }
  });
});

describe('stepped internal bore is not marked through (rule D9)', () => {
  it('a concave cylinder meeting a narrowing cone at one end is blind, not through', () => {
    const r = 5;
    const circ = 2 * Math.PI * r;
    const topo: Topology = {
      faces: [
        { surface: 'cylinder', area: circ * 10, center: [r, 0, 5], normal: null, geometry: { type: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: r, convex: false } },
        { surface: 'plane', area: 500, center: [20, 0, 0], normal: [0, 0, -1], geometry: { type: 'plane', origin: [0, 0, 0], normal: [0, 0, -1] } },
        { surface: 'cone', area: 40, center: [4, 0, 11], normal: null, geometry: { type: 'cone', apex: [0, 0, 15], axis: [0, 0, 1], halfAngle: 0.785, convex: false } },
      ],
      edges: [
        { curve: 'circle', length: circ, mid: [r, 0, 0], dir: null, geometry: { type: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: r }, faces: [0, 1], vertices: [] },
        { curve: 'circle', length: circ, mid: [r, 0, 10], dir: null, geometry: { type: 'circle', center: [0, 0, 10], normal: [0, 0, 1], radius: r }, faces: [0, 2], vertices: [] },
        // the cone narrows to radius 3 (< 5), so it is a stepped internal transition, not an open countersink mouth
        { curve: 'circle', length: 2 * Math.PI * 3, mid: [3, 0, 12], dir: null, geometry: { type: 'circle', center: [0, 0, 12], normal: [0, 0, 1], radius: 3 }, faces: [2], vertices: [] },
      ],
      vertices: [],
    };
    const info = holeInfo(topo, 0);
    expect(info).not.toBeNull();
    expect(info!.through).toBe(false);
  });
});

describe('slanted face auto-dimensioning (coverage.slants)', () => {
  it('plans one chamfer dimension for a conical slant and marks slants complete', () => {
    const views: ViewToDimension[] = [
      {
        viewId: 'v1',
        axes: { dir: [0, 0, 1], up: [0, 1, 0] },
        features: [
          { type: 'plane', ref: ref('x0'), axis: 'x', coord: 0, area: 100 },
          { type: 'plane', ref: ref('x1'), axis: 'x', coord: 20, area: 100 },
          { type: 'plane', ref: ref('y0'), axis: 'y', coord: 0, area: 100 },
          { type: 'plane', ref: ref('y1'), axis: 'y', coord: 10, area: 100 },
          { type: 'slant', ref: ref('coneChamfer'), at: [19, 9], dir: [0.707, -0.707], area: 15, cone: { side: 1, from: [18, 10], to: [20, 8], axial: 2, radial: 2, setback: 2 } },
          { type: 'slant', ref: ref('coneChamfer'), at: [19, 1], dir: [0.707, 0.707], area: 15, cone: { side: -1, from: [18, 0], to: [20, 2], axial: 2, radial: 2, setback: 2 } },
        ],
      },
    ];
    const planned = planDrawingDimensions(views);
    const chamfers = planned.filter((p) => p.draft.kind === 'chamfer');
    expect(chamfers).toHaveLength(1);
    expect(chamfers[0]!.draft).toMatchObject({ kind: 'chamfer', ref: { name: 'coneChamfer' }, size: 2, coneSide: 1 });
    const cov = dimensionCoverage(views, planned.map((p) => ({ view: p.view, ...p.draft })));
    expect(cov.slants).toEqual({ total: 1, determined: 1, missing: [] });
    expect(cov.complete).toBe(true);
  });

  it('plans an angle dimension against the nearest visible plane for a planar slant', () => {
    const views: ViewToDimension[] = [
      {
        viewId: 'v1',
        axes: { dir: [0, 0, 1], up: [0, 1, 0] },
        features: [
          { type: 'plane', ref: ref('left'), axis: 'x', coord: 0, area: 500 },
          { type: 'plane', ref: ref('nearTop'), axis: 'y', coord: 20, area: 100 },
          { type: 'plane', ref: ref('bottom'), axis: 'y', coord: 0, area: 500 },
          { type: 'slant', ref: ref('bevel'), at: [38, 18], dir: [0.707, -0.707], area: 10 },
        ],
      },
    ];
    const planned = planDrawingDimensions(views);
    const angles = planned.filter((p) => p.draft.kind === 'angle');
    expect(angles).toHaveLength(1);
    expect(angles[0]!.draft).toMatchObject({ kind: 'angle', a: { name: 'bevel' }, b: { name: 'nearTop' }, arc: 6 });
    const cov = dimensionCoverage(views, planned.map((p) => ({ view: p.view, ...p.draft })));
    expect(cov.slants).toEqual({ total: 1, determined: 1, missing: [] });
    expect(cov.complete).toBe(true);
  });

  it('excludes engraved sketch text stroke walls from slant features while keeping real slants', () => {
    const doc = {
      features: [
        { id: 'skText', type: 'sketch' as const, name: 'skText', plane: 'xy', entities: [{ id: 'tx', type: 'text' as const, at: [0, 0] as [number, number], text: 'A', height: 3 }] },
      ],
    };
    const prefixes = sketchTextPrefixes(doc as unknown as Parameters<typeof sketchTextPrefixes>[0]);
    expect([...prefixes]).toEqual(['skText.tx#']);
    const topo: Topology = {
      faces: [
        { surface: 'plane', area: 1.5, center: [0, 0, 0], normal: [1, 1, 0], geometry: { type: 'plane', origin: [0, 0, 0], normal: [0.70710678, 0.70710678, 0] } },
        { surface: 'plane', area: 12, center: [10, 0, 0], normal: [1, 1, 0], geometry: { type: 'plane', origin: [10, 0, 0], normal: [0.70710678, 0.70710678, 0] } },
      ],
      edges: [],
      vertices: [],
    };
    const names = { faces: ['cuText:side:skText.tx#17', 'exPlate:side:skPlate.m3'], edges: [], vertices: [] };
    const feats = viewFeatures(topo, names, { dir: [0, 0, 1], up: [0, 1, 0] }, undefined, undefined, undefined, prefixes);
    expect(feats.map((f) => f.ref.name)).toEqual(['exPlate:side:skPlate.m3']);
  });

  it('groups repeated <=5deg draft slants into one counted angle callout while keeping 45deg slants individual', () => {
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const views: ViewToDimension[] = [
      {
        viewId: 'view1',
        axes: { dir: [0, 0, 1], up: [0, 1, 0] },
        features: [
          { type: 'plane', ref: { kind: 'face', name: 'base' }, axis: 'y', coord: 0, area: 100 },
          { type: 'slant', ref: { kind: 'face', name: 'draft1' }, at: [10, 5], dir: [Math.sin(rad(0.5)), Math.cos(rad(0.5))], area: 20 },
          { type: 'slant', ref: { kind: 'face', name: 'draft2' }, at: [20, 5], dir: [-Math.sin(rad(0.5)), Math.cos(rad(0.5))], area: 15 },
          { type: 'slant', ref: { kind: 'face', name: 'draft3' }, at: [30, 5], dir: [Math.sin(rad(0.5)), Math.cos(rad(0.5))], area: 10 },
          { type: 'slant', ref: { kind: 'face', name: 'vgroove1' }, at: [40, 5], dir: [Math.SQRT1_2, Math.SQRT1_2], area: 18 },
          { type: 'slant', ref: { kind: 'face', name: 'vgroove2' }, at: [50, 5], dir: [-Math.SQRT1_2, Math.SQRT1_2], area: 18 },
        ],
      },
    ];
    const plan = planDrawingDimensions(views, []);
    const angles = plan.filter((p) => p.draft.kind === 'angle');
    expect(angles).toHaveLength(3);
    const grouped = angles.find((p) => p.draft.kind === 'angle' && p.draft.count === 3);
    expect(grouped).toBeTruthy();
    const cov = dimensionCoverage(
      views,
      plan.map((p) => ({ view: p.view, ...p.draft })),
    );
    expect(cov.slants).toEqual({ total: 5, determined: 5, missing: [] });
  });

  it('draws centre marks for end-on cones/spheres, inherits parent features in detail/crop views, and clips centrelines across broken views', () => {
    const placed: PlacedView = { id: 'v1', at: [100, 100], scale: 1, centre: [0, 0], w: 80, h: 40 };
    const model: DrawingView = { id: 'v1', name: '前視', source: 'p.3dbx', direction: 'front' };
    // End-on cone/sphere centre mark merges with concentric circle taking the larger radius
    const merged = centreItems(model, [
      { type: 'circle', ref: { kind: 'face', name: 'cyl' }, centre: [10, 10], radius: 3, convex: true, full: true, outward: 45 },
      { type: 'centre', ref: { kind: 'face', name: 'cone' }, centre: [10, 10], radius: 6 },
      { type: 'centre', ref: { kind: 'face', name: 'sphere' }, centre: [30, 10], radius: 4 },
    ], placed);
    expect(merged).toHaveLength(8);
    // Detail and crop views inherit parent features when only the parent view's features are supplied to buildScene
    let doc = createEmptyDrawing('CNS');
    doc = applyDrawingCommand(doc, {
      type: 'insertViews',
      views: [
        model,
        { id: 'v2', name: 'A', kind: 'detail', parent: 'v1', centre: [10, 10], radius: 10, label: 'A', at: [220, 120], scale: [2, 1] },
        { id: 'v3', name: 'B', kind: 'sectionLocal', parent: 'v1', outline: { kind: 'rectangle', p0: [0, 0], p1: [20, 20] }, depth: 5, label: 'B', at: [300, 120] },
        { id: 'v4', name: 'Crop', kind: 'crop', parent: 'v3', outline: { kind: 'rectangle', p0: [2, 2], p1: [18, 18] }, at: [360, 120] },
      ],
    });
    const parentLines: ViewLines = { visible: [[-20, -20, 40, -20, 40, 20, -20, 20, -20, -20]], hidden: [], box: { min: [-20, -20], max: [40, 20] } };
    const parentFeats: ViewFeature[] = [
      { type: 'centre', ref: { kind: 'face', name: 'c1' }, centre: [10, 10], radius: 4 },
      { type: 'centre', ref: { kind: 'face', name: 'c2' }, centre: [35, 10], radius: 4 },
    ];
    const { scene } = buildScene(doc, new Map([['v1', parentLines], ['v3', parentLines]]), new Map(), new Map([['v1', parentFeats]]));
    const detailCentres = scene.items.filter((i) => i.kind === 'polyline' && i.style === 'center' && i.owner === 'view:v2');
    const cropCentres = scene.items.filter((i) => i.kind === 'polyline' && i.style === 'center' && i.owner === 'view:v4');
    expect(detailCentres).toHaveLength(4);
    expect(cropCentres).toHaveLength(4);
    // Broken view splits horizontal axis across the break band instead of drawing through the gap
    const broken: PlacedView = { ...placed, break: { axis: 0, from: -10, to: 10, gap: 4 } };
    const axisOnly: ViewFeature[] = [{ type: 'axis', ref: { kind: 'face', name: 'shaft' }, from: [-30, 0], to: [30, 0], radius: 5 }];
    const brokenItems = centreItems(model, axisOnly, broken);
    expect(brokenItems).toHaveLength(2);
    // Every segment lies strictly outside the open gap on the sheet (gap spans x in [90, 94] with centre=0, at=100, from=-10, gap=4)
    for (const item of brokenItems) {
      if (item.kind !== 'polyline') continue;
      const xs = [item.points[0]!, item.points[2]!];
      expect(Math.max(...xs) <= 90 + 1e-6 || Math.min(...xs) >= 94 - 1e-6).toBe(true);
    }
  });

  it('emits centrelines for trimmed cylinders, drafted cones, and spheres while excluding 90deg corner fillets', () => {
    const topo: Topology = {
      faces: [
        // 1. Trimmed cylinder (360° wrap = 2π, only 1 end or oblique cut: no circle edge in topology.edges)
        { surface: 'cylinder', area: 2 * Math.PI * 5 * 20, center: [5, 0, 10], normal: [1, 0, 0], geometry: { type: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 5, convex: true } },
        // 2. 90° corner fillet cylinder (wrap = π/2, must NOT get an axis)
        { surface: 'cylinder', area: 0.5 * Math.PI * 5 * 20, center: [5, 0, 10], normal: [1, 0, 0], geometry: { type: 'cylinder', origin: [30, 0, 0], axis: [0, 0, 1], radius: 5, convex: true } },
        // 3. Drafted circular boss (1° cone, wrap = 2π, no full circle edges)
        { surface: 'cone', area: 2 * Math.PI * 5 * 10 / Math.cos(Math.PI / 180), center: [55, 0, 5], normal: [1, 0, 0], geometry: { type: 'cone', apex: [50, 0, 5 / Math.tan(Math.PI / 180) + 5], axis: [0, 0, -1], halfAngle: Math.PI / 180, convex: true } },
        // 4. Hemisphere (area = 2πr², must get a centre mark)
        { surface: 'sphere', area: 2 * Math.PI * 4 * 4, center: [80, 0, 4], normal: [0, 0, 1], geometry: { type: 'sphere', center: [80, 0, 0], radius: 4, convex: true } },
      ],
      edges: [
        { faces: [0], vertices: [0, 1], length: 20, mid: [5, 0, 10], dir: [0, 0, 1], curve: 'line' },
        { faces: [1], vertices: [2, 3], length: 20, mid: [35, 0, 10], dir: [0, 0, 1], curve: 'line' },
        { faces: [2], vertices: [4, 5], length: 10, mid: [55, 0, 5], dir: [0, 0, 1], curve: 'line' },
      ],
      vertices: [
        { point: [5, 0, 0], faces: [0] }, { point: [5, 0, 20], faces: [0] },
        { point: [35, 0, 0], faces: [1] }, { point: [35, 0, 20], faces: [1] },
        { point: [55, 0, 0], faces: [2] }, { point: [55, 0, 10], faces: [2] },
      ],
    };
    const names = { faces: ['trimmedCyl', 'cornerFillet', 'draftedBoss', 'dome'], edges: ['e0', 'e1', 'e2'], vertices: ['v0', 'v1', 'v2', 'v3', 'v4', 'v5'] };
    const sideFeats = viewFeatures(topo, names, { dir: [0, 1, 0], up: [0, 0, 1] });
    expect(sideFeats.filter((f) => f.type === 'axis').map((f) => f.ref.name)).toEqual(['trimmedCyl', 'draftedBoss']);
    expect(sideFeats.filter((f) => f.type === 'centre').map((f) => f.ref.name)).toEqual(['dome']);
    const topFeats = viewFeatures(topo, names, { dir: [0, 0, 1], up: [0, 1, 0] });
    expect(topFeats.filter((f) => f.type === 'circle' && f.full).map((f) => f.ref.name)).toEqual(['trimmedCyl']);
    expect(topFeats.filter((f) => f.type === 'centre').map((f) => f.ref.name)).toEqual(['draftedBoss', 'dome']);
  });
});
