/**
 * S-1 (docs/sheet-metal-drawing-plan.md): the flat pattern of a sheet metal part as a view of a drawing. The lines are the outline of the pattern (holes and rounded corners
 * as polylines) and its bend lines as chain lines, at full size; sizes by hand as in tests/phase7/flat-pattern.test.ts (plate 100 × 50 × 1.5, inside radius 2, K 0.5:
 * a flange of 90°, 30 from the outside, makes it 100 − 2 × 3.5 + 30 + BA long, the bend line in the middle of the allowance at x = 96.5 + BA/2).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, type Feature, type PartDoc, type Ref } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { flatPattern, Regenerator, type RebuildResult } from '@3db/regen';
import { buildScene, checkDxf, flatViewLines, readDxf, toDxf, type DxfPolyline, type ViewLines } from '@3db/drawing';
import { build, circle, front, rectangle, sketch, statuses } from '../phase1/builders';

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
const Ro = 3.5;
const BA = (Math.PI / 2) * (2 + 0.5 * 1.5);
const baseFlange: Feature = { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' } as Feature;
const plate = (...extra: ReturnType<typeof circle>[]): Feature[] => [sketch('sk', front, rectangle('r', 0, 0, 100, 50), ...extra), baseFlange];

function edgeAt(r: RebuildResult, mid: [number, number, number]): Ref {
  const i = r.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.hypot(e.mid[0] - mid[0], e.mid[1] - mid[1], e.mid[2] - mid[2]) < 1e-6);
  expect(i, `an edge at ${mid}`).toBeGreaterThanOrEqual(0);
  return { kind: 'edge', name: r.body!.names.edges[i]!, fingerprint: edgeFingerprint(r.body!.topology, i) };
}

/** The view lines of the flat pattern of a part (the solid of the pattern is released). */
function viewOf(features: Feature[]) {
  const result = rebuild(build(...features));
  expect(statuses(result).filter((s) => !s.endsWith('=ok'))).toEqual([]);
  const pattern = flatPattern(kernel, result.sheet!);
  kernel.release(pattern.shape);
  return { pattern, lines: flatViewLines(pattern), result };
}
const flanged = (): Feature[] => {
  const edge = edgeAt(rebuild(build(...plate())), [100, 25, 1.5]);
  return [...plate(), { id: 'ef', type: 'edgeFlange', name: 'ef', suppressed: false, edge, length: '30' } as Feature];
};

describe('the lines of a flat pattern', () => {
  it('a plate is its four sides, 100 × 50 with the lower left corner of the box at the origin, and no bend line', () => {
    const { lines } = viewOf(plate());
    expect(lines.visible).toHaveLength(4);
    expect(lines.center).toEqual([]);
    expect(lines.hidden).toEqual([]);
    expect(lines.box).toEqual({ min: [0, 0], max: [expect.closeTo(100, 6), expect.closeTo(50, 6)] });
    const xs = lines.visible.flatMap((l) => [l[0]!, l[2]!]);
    const ys = lines.visible.flatMap((l) => [l[1]!, l[3]!]);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(100, 6);
    expect(Math.min(...ys)).toBeCloseTo(0, 6);
    expect(Math.max(...ys)).toBeCloseTo(50, 6);
  });

  it('a plate with a flange of 90°, 30 long: 127.3197 × 50, four sides, one chain line along y in the middle of the allowance at x = 96.5 + BA/2', () => {
    const { lines } = viewOf(flanged());
    expect(lines.box!.max[0]).toBeCloseTo(100 - 2 * Ro + 30 + BA, 4);
    expect(lines.box!.max[0]).toBeCloseTo(127.31969, 4);
    expect(lines.box!.max[1]).toBeCloseTo(50, 6);
    expect(lines.visible).toHaveLength(4);
    expect(lines.center).toHaveLength(1);
    const b = lines.center![0]!;
    expect(b[0]).toBeCloseTo(100 - Ro + BA / 2, 4);
    expect(b[2]).toBeCloseTo(100 - Ro + BA / 2, 4);
    expect(Math.min(b[1]!, b[3]!)).toBeCloseTo(0, 6);
    expect(Math.max(b[1]!, b[3]!)).toBeCloseTo(50, 6);
  });

  it('a hole is a closed polyline of points all a radius from its centre: Ø5 at (40, 20)', () => {
    const { lines } = viewOf(plate(circle('h', 40, 20, 2.5)));
    const ring = lines.visible.find((l) => l.length > 100)!;
    expect(ring).toBeDefined();
    expect(ring.slice(0, 2)).toEqual(ring.slice(-2)); // closed
    let cx = 0;
    let cy = 0;
    const n = ring.length / 2 - 1;
    for (let i = 0; i < n; i++) {
      cx += ring[2 * i]! / n;
      cy += ring[2 * i + 1]! / n;
    }
    expect(cx).toBeCloseTo(40, 4);
    expect(cy).toBeCloseTo(20, 4);
    for (let i = 0; i < n; i++) expect(Math.hypot(ring[2 * i]! - cx, ring[2 * i + 1]! - cy)).toBeCloseTo(2.5, 6);
  });
});

describe('the view in a drawing', () => {
  const lines = () => viewOf(flanged()).lines;
  const doc = () => applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'view1', name: '展平圖', source: 'a.3dbx', direction: 'flat' }] });

  it('is a view of direction flat, which the document takes (schema 6)', () => {
    expect(doc().views[0]).toMatchObject({ direction: 'flat' });
    expect(doc().schemaVersion).toBe(10);
  });

  it('draws the sides as visible lines and the bend line as a chain line on the sheet', () => {
    const l: ViewLines = lines();
    const { scene } = buildScene(doc(), new Map([['view1', l]]));
    const polylines = scene.items.filter((i) => i.kind === 'polyline' && i.points.length === 4 && (i.style === 'visible' || i.style === 'center'));
    expect(polylines.filter((p) => p.kind === 'polyline' && p.style === 'visible')).toHaveLength(4);
    expect(polylines.filter((p) => p.kind === 'polyline' && p.style === 'center')).toHaveLength(1);
  });

  it('is written to a DXF with the bend line on the CENTER layer, and the file is sound', () => {
    const { scene } = buildScene(doc(), new Map([['view1', lines()]]));
    const dxf = readDxf(toDxf(scene));
    expect(checkDxf(dxf)).toEqual([]);
    const center = dxf.entities.filter((e): e is DxfPolyline => e.type === 'LWPOLYLINE' && e.layer === 'CENTER');
    expect(center).toHaveLength(1);
  });
});
