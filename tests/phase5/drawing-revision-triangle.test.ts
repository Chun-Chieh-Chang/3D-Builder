import { describe, expect, it } from 'vitest';
import {
  applyDrawingCommand,
  createEmptyDrawing,
  DRAWING_SCHEMA_VERSION,
  page,
  parseDrawing,
  serializeDrawing,
  type RevisionAnnotation,
} from '@3db/model';
import {
  annotationItems,
  readDxf,
  readPdf,
  textWidthMm,
  toDxf,
  toPdf,
  toSvg,
  type DxfPolyline,
  type DxfText,
  type PlacedView,
} from '@3db/drawing';

const placed: PlacedView = { id: 'v', at: [100, 90], centre: [0, 0], w: 40, h: 30, scale: 1 };

function pointInTriangle(px: number, py: number, v0: [number, number], v1: [number, number], v2: [number, number]): boolean {
  const sign = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  const d1 = sign(px, py, v0[0], v0[1], v1[0], v1[1]);
  const d2 = sign(px, py, v1[0], v1[1], v2[0], v2[1]);
  const d3 = sign(px, py, v2[0], v2[1], v0[0], v0[1]);
  return (d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0);
}

function distToSegment(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

describe('revision triangle markers (RevisionAnnotation)', () => {
  it('places, edits, validates, serializes, and reopens with exact position and revision', () => {
    let doc = applyDrawingCommand(createEmptyDrawing(), {
      type: 'insertViews',
      views: [{ id: 'v', name: 'front', source: 'p.3dbx', direction: 'front' }],
    });
    doc = applyDrawingCommand(doc, {
      type: 'saveRevision',
      entry: { revision: 'B', date: '2026-11-22', description: '調整法蘭厚度', author: 'Tester' },
    });

    const rev: RevisionAnnotation = {
      id: 'ann1',
      kind: 'revision',
      view: 'v',
      at: [12.5, 8.25],
      revision: 'B',
      leader: [4, 2],
    };
    const placedDoc = applyDrawingCommand(doc, { type: 'insertAnnotations', annotations: [rev] });
    expect(page(placedDoc).annotations).toHaveLength(1);
    expect(page(placedDoc).annotations[0]).toMatchObject({ kind: 'revision', at: [12.5, 8.25], revision: 'B', leader: [4, 2] });

    // Edit revision label, position, and height
    const editedDoc = applyDrawingCommand(placedDoc, {
      type: 'setAnnotation',
      annotationId: 'ann1',
      patch: { revision: 'C', at: [18, 11], height: 4.5 },
    });
    expect(page(editedDoc).annotations[0]).toMatchObject({ revision: 'C', at: [18, 11], height: 4.5 });

    // Remove leader
    const noLeaderDoc = applyDrawingCommand(editedDoc, {
      type: 'setAnnotation',
      annotationId: 'ann1',
      patch: { leader: null, attach: null },
    });
    expect(page(noLeaderDoc).annotations[0]).not.toHaveProperty('leader');

    // Round-trip serialize -> parse
    const reopened = parseDrawing(serializeDrawing(editedDoc));
    expect(reopened.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    expect(page(reopened).annotations[0]).toMatchObject({
      id: 'ann1',
      kind: 'revision',
      view: 'v',
      at: [18, 11],
      revision: 'C',
      height: 4.5,
      leader: [4, 2],
    });

    // Legacy v40 upgrade compatibility
    const legacy = JSON.parse(serializeDrawing(doc));
    legacy.schemaVersion = 40;
    expect(parseDrawing(JSON.stringify(legacy)).schemaVersion).toBe(DRAWING_SCHEMA_VERSION);

    // Red-team input corruption: no silent coercion
    expect(() =>
      applyDrawingCommand(doc, { type: 'insertAnnotations', annotations: [{ ...rev, id: 'bad1', revision: '   ' }] }),
    ).toThrow();
    expect(() =>
      applyDrawingCommand(doc, { type: 'insertAnnotations', annotations: [{ ...rev, id: 'bad2', revision: 'A\nB' }] }),
    ).toThrow();
    expect(() =>
      applyDrawingCommand(doc, { type: 'insertAnnotations', annotations: [{ ...rev, id: 'bad3', revision: '12345678901234567' }] }),
    ).toThrow();
    expect(() =>
      applyDrawingCommand(doc, { type: 'insertAnnotations', annotations: [{ ...rev, id: 'bad4', height: 0.5 }] }),
    ).toThrow();
    expect(() =>
      applyDrawingCommand(doc, { type: 'insertAnnotations', annotations: [{ ...rev, id: 'bad5', at: [Number.NaN, 0] }] }),
    ).toThrow();
    expect(() =>
      applyDrawingCommand(doc, {
        type: 'insertAnnotations',
        annotations: [{ id: 'bad6', kind: 'revision', view: 'v', at: [0, 0], revision: 'A', attach: { ref: { kind: 'edge', name: 'e1' }, u: 0.5 } }],
      }),
    ).toThrow();
  });

  it('draws an equilateral triangle enclosing all text corners, attaches leader to boundary, and exports to SVG, DXF, and PDF', () => {
    const rev: RevisionAnnotation = {
      id: 'ann1',
      kind: 'revision',
      view: 'v',
      at: [10, 5],
      revision: 'B',
      height: 3.5,
      leader: [28, 16],
    };
    const items = annotationItems([rev], placed, () => undefined);
    const tri = items.find((i) => i.kind === 'polyline' && i.closed && i.points.length === 6);
    expect(tri?.kind).toBe('polyline');
    if (!tri || tri.kind !== 'polyline') throw new Error('triangle missing');

    const v0: [number, number] = [tri.points[0]!, tri.points[1]!];
    const v1: [number, number] = [tri.points[2]!, tri.points[3]!];
    const v2: [number, number] = [tri.points[4]!, tri.points[5]!];
    const s01 = Math.hypot(v1[0] - v0[0], v1[1] - v0[1]);
    const s12 = Math.hypot(v2[0] - v1[0], v2[1] - v1[1]);
    const s20 = Math.hypot(v0[0] - v2[0], v0[1] - v2[1]);
    // Equilateral
    expect(s01).toBeCloseTo(s12, 8);
    expect(s12).toBeCloseTo(s20, 8);
    // Pointing up
    expect(v2[1]).toBeGreaterThan(v0[1]);
    expect(v0[1]).toBeCloseTo(v1[1], 8);

    // Text corners strictly inside triangle
    const text = items.find((i) => i.kind === 'text');
    expect(text?.kind).toBe('text');
    if (!text || text.kind !== 'text') throw new Error('text missing');
    expect(text.text).toBe('B');
    expect(text.anchor).toBe('center');
    const w = textWidthMm(text.text, text.height);
    for (const x of [text.at[0] - w / 2, text.at[0] + w / 2]) {
      for (const y of [text.at[1], text.at[1] + text.height]) {
        expect(pointInTriangle(x, y, v0, v1, v2)).toBe(true);
      }
    }

    // Leader starts on triangle boundary
    const line = items.find((i) => i.kind === 'polyline' && !i.closed && i.points.length === 4);
    expect(line?.kind).toBe('polyline');
    if (!line || line.kind !== 'polyline') throw new Error('leader missing');
    const minEdgeDist = Math.min(
      distToSegment(line.points[0]!, line.points[1]!, v0, v1),
      distToSegment(line.points[0]!, line.points[1]!, v1, v2),
      distToSegment(line.points[0]!, line.points[1]!, v2, v0),
    );
    expect(minEdgeDist).toBeLessThan(1e-6);

    // SVG / DXF / PDF exports all contain the triangle and revision label
    const scene = { width: 210, height: 297, items };
    const svg = toSvg(scene);
    expect(svg).toContain('<polygon');
    expect(svg).toContain('>B<');

    const dxf = readDxf(toDxf(scene));
    const dxfTri = dxf.entities.find(
      (e): e is DxfPolyline => e.type === 'LWPOLYLINE' && (e as DxfPolyline).closed && (e as DxfPolyline).points.length === 6,
    );
    expect(dxfTri).toBeDefined();
    const dxfText = dxf.entities.find((e): e is DxfText => e.type === 'TEXT' && (e as DxfText).text === 'B');
    expect(dxfText).toBeDefined();

    const pdf = readPdf(toPdf(scene).bytes);
    expect(pdf.problems).toEqual([]);
    expect(pdf.pages[0]!.paths.length).toBeGreaterThan(0);
    expect(pdf.pages[0]!.texts.some((t) => t.text === 'B')).toBe(true);
  });

  it('fuzzes 100 revision labels and heights with all text corners enclosed and finite geometry', () => {
    const samples = ['A', 'B', '01', '02', 'Rev3', 'A1', '12', 'ECN-9'];
    for (let i = 0; i < 100; i++) {
      const label = samples[i % samples.length]!;
      const height = 1.8 + ((i * 7) % 100) / 10; // 1.8 .. 11.7 mm
      const angle = (i * 37 * Math.PI) / 180;
      const leader: [number, number] = [25 * Math.cos(angle), 25 * Math.sin(angle)];
      const items = annotationItems(
        [{ id: `r${i}`, kind: 'revision', view: 'v', at: [0, 0], revision: label, height, leader }],
        placed,
        () => undefined,
      );
      const tri = items.find((x) => x.kind === 'polyline' && x.closed && x.points.length === 6);
      const txt = items.find((x) => x.kind === 'text');
      expect(tri && tri.kind === 'polyline' && tri.points.every(Number.isFinite)).toBe(true);
      expect(txt && txt.kind === 'text').toBe(true);
      if (!tri || tri.kind !== 'polyline' || !txt || txt.kind !== 'text') continue;
      const v0: [number, number] = [tri.points[0]!, tri.points[1]!];
      const v1: [number, number] = [tri.points[2]!, tri.points[3]!];
      const v2: [number, number] = [tri.points[4]!, tri.points[5]!];
      const w = textWidthMm(txt.text, txt.height);
      for (const x of [txt.at[0] - w / 2, txt.at[0] + w / 2]) {
        for (const y of [txt.at[1], txt.at[1] + txt.height]) {
          expect(pointInTriangle(x, y, v0, v1, v2)).toBe(true);
        }
      }
    }
  });
});
