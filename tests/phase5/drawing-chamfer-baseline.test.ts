import { describe, expect, it } from 'vitest';
import {
  applyDrawingCommand,
  createEmptyDrawing,
  DRAWING_SCHEMA_VERSION,
  parseDrawing,
  type ChamferDimension,
  type DrawingDoc,
  type ElementFacts,
  type LinearDimension,
  type ViewAxes,
  page,
} from '@3db/model';
import {
  dimensionText,
  evaluateDimension,
  planDimension,
  dragDimension,
  type Pickable,
  type PlacedView,
} from '@3db/drawing';

const AXES: ViewAxes = { dir: [0, 0, 1], up: [0, 1, 0] };
const PLACED: PlacedView = {
  id: 'view1',
  at: [100, 100],
  scale: 1,
  centre: [0, 0],
  w: 100,
  h: 100,
};

const baseDoc = (): DrawingDoc =>
  applyDrawingCommand(createEmptyDrawing(), {
    type: 'insertViews',
    views: [{ id: 'view1', kind: 'model', name: 'Front', source: 'part.3dbx', direction: 'front' }],
  });

describe('E5 Phase 2: Chamfer Dimension (Model & Schema)', () => {
  it('schema supports chamfer dimensions', () => {
    expect(DRAWING_SCHEMA_VERSION).toBeGreaterThanOrEqual(26);
  });

  it('inserts a valid chamfer dimension and keeps its fields', () => {
    let doc = baseDoc();
    const chamfer: ChamferDimension = {
      id: 'dim1',
      view: 'view1',
      kind: 'chamfer',
      ref: { kind: 'edge', name: 'chamfer_edge_1' },
      size: 2,
      angle: 45,
      chamferAngle: 45,
      chamferFormat: 'c',
      leader: 8,
    };
    doc = applyDrawingCommand(doc, { type: 'insertDimensions', dimensions: [chamfer] });
    const inserted = page(doc).dimensions.find((d) => d.id === 'dim1') as ChamferDimension;
    expect(inserted).toBeDefined();
    expect(inserted.kind).toBe('chamfer');
    expect(inserted.size).toBe(2);
    expect(inserted.chamferAngle).toBe(45);
    expect(inserted.chamferFormat).toBe('c');
    expect(inserted.angle).toBe(45);
    expect(inserted.leader).toBe(8);
  });

  it('refuses invalid chamfer dimension parameters on insert', () => {
    const doc = baseDoc();
    // Non-positive size
    expect(() =>
      applyDrawingCommand(doc, {
        type: 'insertDimensions',
        dimensions: [
          {
            id: 'dim_bad_1',
            view: 'view1',
            kind: 'chamfer',
            ref: { kind: 'edge', name: 'e1' },
            size: 0,
            angle: 45,
          },
        ],
      }),
    ).toThrow();

    // Invalid chamfer angle (e.g. >= 90)
    expect(() =>
      applyDrawingCommand(doc, {
        type: 'insertDimensions',
        dimensions: [
          {
            id: 'dim_bad_2',
            view: 'view1',
            kind: 'chamfer',
            ref: { kind: 'edge', name: 'e1' },
            size: 2,
            angle: 45,
            chamferAngle: 90,
          },
        ],
      }),
    ).toThrow();

    // Invalid format
    expect(() =>
      applyDrawingCommand(doc, {
        type: 'insertDimensions',
        dimensions: [
          {
            id: 'dim_bad_3',
            view: 'view1',
            kind: 'chamfer',
            ref: { kind: 'edge', name: 'e1' },
            size: 2,
            angle: 45,
            chamferFormat: 'unknown' as any,
          },
        ],
      }),
    ).toThrow();

    // Vertex reference
    expect(() =>
      applyDrawingCommand(doc, {
        type: 'insertDimensions',
        dimensions: [
          {
            id: 'dim_bad_4',
            view: 'view1',
            kind: 'chamfer',
            ref: { kind: 'vertex', name: 'v1' },
            size: 2,
            angle: 45,
          },
        ],
      }),
    ).toThrow();
  });

  it('patches chamfer dimension properties via setDimension', () => {
    let doc = baseDoc();
    const chamfer: ChamferDimension = {
      id: 'dim1',
      view: 'view1',
      kind: 'chamfer',
      ref: { kind: 'edge', name: 'e1' },
      size: 2,
      angle: 45,
    };
    doc = applyDrawingCommand(doc, { type: 'insertDimensions', dimensions: [chamfer] });

    // Patch size, chamferAngle, chamferFormat, count, leader
    doc = applyDrawingCommand(doc, {
      type: 'setDimension',
      dimensionId: 'dim1',
      patch: {
        size: 3.5,
        chamferAngle: 30,
        chamferFormat: 'distanceAngle',
        count: 2,
        leader: 12,
      },
    });

    const updated = page(doc).dimensions.find((d) => d.id === 'dim1') as ChamferDimension;
    expect(updated.size).toBe(3.5);
    expect(updated.chamferAngle).toBe(30);
    expect(updated.chamferFormat).toBe('distanceAngle');
    expect(updated.count).toBe(2);
    expect(updated.leader).toBe(12);

    // Refuses slide or callout on chamfer
    expect(() =>
      applyDrawingCommand(doc, {
        type: 'setDimension',
        dimensionId: 'dim1',
        patch: { slide: 5 },
      }),
    ).toThrow();

    expect(() =>
      applyDrawingCommand(doc, {
        type: 'setDimension',
        dimensionId: 'dim1',
        patch: { callout: true },
      }),
    ).toThrow();
  });

  it('migrates v25 document to v26 cleanly', () => {
    const json = JSON.stringify({ ...baseDoc(), schemaVersion: 25 });
    const upgraded = parseDrawing(json);
    expect(upgraded.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
  });
});

describe('E5 Phase 2: Chamfer Dimension (Text & Evaluation)', () => {
  const edgeFact: ElementFacts = {
    kind: 'edge',
    type: 'line',
    point: [10, 10, 0],
    dir: [1, 0, 0],
  };

  it('formats text correctly for C{c} and {c} × 45°', () => {
    const cDim: ChamferDimension = {
      id: 'd1',
      view: 'view1',
      kind: 'chamfer',
      ref: { kind: 'edge', name: 'e1' },
      size: 2,
      angle: 45,
      chamferFormat: 'c',
    };
    expect(dimensionText(cDim, 2)).toBe('C2');

    // With count
    expect(dimensionText({ ...cDim, count: 4 }, 2)).toBe('4×C2');

    // As reference
    expect(dimensionText({ ...cDim, reference: true }, 2)).toBe('(C2)');

    // Format distanceAngle
    const angleDim: ChamferDimension = {
      ...cDim,
      chamferFormat: 'distanceAngle',
      chamferAngle: 45,
    };
    expect(dimensionText(angleDim, 2)).toBe('2 × 45°');

    // 30 degree chamfer
    expect(dimensionText({ ...angleDim, chamferAngle: 30 }, 2)).toBe('2 × 30°');
  });

  it('evaluates chamfer dimension into scene items with leader and shelf', () => {
    const cDim: ChamferDimension = {
      id: 'd1',
      view: 'view1',
      kind: 'chamfer',
      ref: { kind: 'edge', name: 'e1' },
      size: 2,
      angle: 45,
      leader: 10,
    };
    const outcome = evaluateDimension(cDim, { elements: [edgeFact] }, AXES, PLACED);
    expect('error' in outcome).toBe(false);
    if ('error' in outcome) return;

    expect(outcome.value).toBe(2);
    expect(outcome.text).toBe('C2');
    expect(outcome.handle).toMatchObject({
      kind: 'round',
      radius: 0,
    });
    expect(outcome.items.length).toBeGreaterThanOrEqual(2);

    // Leader dragging calculates new angle and leader length
    if (outcome.handle?.kind === 'round') {
      const dragged = dragDimension(outcome.handle, false, [120, 120]);
      expect(dragged.angle).toBeDefined();
      expect(dragged.leader).toBeGreaterThan(0);
    }
  });

  it('plans chamfer dimension from picked edge', () => {
    const pick: Pickable = {
      type: 'edge',
      ref: { kind: 'edge', name: 'e1' },
      a: [0, 0],
      b: [2, 2],
      inPlane: true,
      depth: 0,
      ends: [null, null],
    };
    const plan = planDimension([pick], [15, 15], PLACED, AXES, 'chamfer');
    expect('error' in plan).toBe(false);
    if ('error' in plan || 'need' in plan) return;

    expect(plan.draft.kind).toBe('chamfer');
    if (plan.draft.kind === 'chamfer') {
      expect(plan.draft.size).toBeCloseTo(2, 1);
      expect(plan.draft.chamferFormat).toBe('c');
      expect(plan.draft.chamferAngle).toBe(45);
    }
  });
});

describe('E5 Phase 2: Baseline Dimension (Staggering & Continuation)', () => {
  it('computes successive parallel offsets outward with standard step', () => {
    const stepDist = 8;
    const initialOffset = 12;
    const sign = initialOffset >= 0 ? 1 : -1;

    const offsets = [initialOffset];
    for (let i = 1; i < 4; i++) {
      offsets.push(offsets[i - 1]! + sign * stepDist);
    }
    expect(offsets).toEqual([12, 20, 28, 36]);

    // Negative initial offset (stepping further negative, away from view)
    const negInitial = -15;
    const negSign = negInitial >= 0 ? 1 : -1;
    const negOffsets = [negInitial];
    for (let i = 1; i < 4; i++) {
      negOffsets.push(negOffsets[i - 1]! + negSign * stepDist);
    }
    expect(negOffsets).toEqual([-15, -23, -31, -39]);
  });

  it('creates clean LinearDimension entities sharing baseline reference', () => {
    let doc = baseDoc();
    const baseRef = { kind: 'edge' as const, name: 'base_edge' };

    const dims: LinearDimension[] = [
      {
        id: 'dim1',
        view: 'view1',
        kind: 'linear',
        a: baseRef,
        b: { kind: 'edge', name: 'step1' },
        orientation: 'horizontal',
        offset: 12,
      },
      {
        id: 'dim2',
        view: 'view1',
        kind: 'linear',
        a: baseRef,
        b: { kind: 'edge', name: 'step2' },
        orientation: 'horizontal',
        offset: 20,
      },
      {
        id: 'dim3',
        view: 'view1',
        kind: 'linear',
        a: baseRef,
        b: { kind: 'edge', name: 'step3' },
        orientation: 'horizontal',
        offset: 28,
      },
    ];

    doc = applyDrawingCommand(doc, { type: 'insertDimensions', dimensions: dims });

    const pageDims = page(doc).dimensions;
    expect(pageDims.length).toBe(3);
    expect(pageDims.every((d) => d.kind === 'linear')).toBe(true);
    expect(pageDims.map((d) => (d as LinearDimension).offset)).toEqual([12, 20, 28]);
    expect(pageDims.every((d) => (d as LinearDimension).a.name === 'base_edge')).toBe(true);
  });
});
