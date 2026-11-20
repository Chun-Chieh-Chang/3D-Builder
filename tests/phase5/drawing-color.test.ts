import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, parseDrawing, serializeDrawing } from '@3db/model';
import { buildScene, toPdf, toSvg, type ViewLines } from '@3db/drawing';

function makeColoredDrawing() {
  let doc = createEmptyDrawing('ISO');
  doc = applyDrawingCommand(doc, {
    type: 'insertViews',
    views: [{ id: 'v1', name: '前視', source: 'part.3dbx', direction: 'front' }],
  });
  doc = applyDrawingCommand(doc, {
    type: 'insertDimensions',
    dimensions: [
      {
        id: 'd1',
        view: 'v1',
        kind: 'linear',
        a: { kind: 'face', name: 'f1' },
        b: { kind: 'face', name: 'f2' },
        orientation: 'horizontal',
        offset: 10,
      },
    ],
  });
  doc = applyDrawingCommand(doc, {
    type: 'insertAnnotations',
    annotations: [{ id: 'a1', view: 'v1', kind: 'note', at: [0, 15], text: 'CRITICAL' }],
  });

  const lines = new Map<string, ViewLines>([
    ['v1', { visible: [[0, 0, 20, 0, 20, 10, 0, 10, 0, 0]], hidden: [], box: { min: [0, 0], max: [20, 10] } }],
  ]);
  const elements = new Map([
    [
      'd1',
      {
        elements: [
          { kind: 'face' as const, type: 'plane' as const, point: [0, 0, 0] as [number, number, number], dir: [1, 0, 0] as [number, number, number] },
          { kind: 'face' as const, type: 'plane' as const, point: [20, 0, 0] as [number, number, number], dir: [1, 0, 0] as [number, number, number] },
        ],
      },
    ],
  ]);
  return { doc, lines, elements };
}

describe('custom dimension & annotation color', () => {
  it('propagates dimension style.color and annotation.color into Scene, SVG, PDF and survives serialization', () => {
    const { doc: base, lines, elements } = makeColoredDrawing();
    let doc = applyDrawingCommand(base, { type: 'setDimension', dimensionId: 'd1', patch: { style: { color: '#DC2626' } } });
    doc = applyDrawingCommand(doc, { type: 'setAnnotation', annotationId: 'a1', patch: { color: '#2563EB' } });

    const { scene } = buildScene(doc, lines, elements);
    const dimItems = scene.items.filter((i) => i.group === 'd1');
    const annItems = scene.items.filter((i) => i.owner === 'a1');
    expect(dimItems.length).toBeGreaterThan(0);
    expect(annItems.length).toBeGreaterThan(0);
    expect(dimItems.every((i) => i.color === '#DC2626')).toBe(true);
    expect(annItems.every((i) => i.color === '#2563EB')).toBe(true);

    const svg = toSvg(scene);
    expect(svg).toContain('stroke="#DC2626"');
    expect(svg).toContain('fill="#DC2626"');
    expect(svg).toContain('fill="#2563EB"');

    const pdfBytes = toPdf(scene).bytes;
    const pdfText = new TextDecoder('latin1').decode(pdfBytes);
    // #DC2626 -> r=220/255≈0.863, g=38/255≈0.149, b=38/255≈0.149
    expect(pdfText).toContain('0.863 0.149 0.149 RG 0.863 0.149 0.149 rg');
    // #2563EB -> r=37/255≈0.145, g=99/255≈0.388, b=235/255≈0.922
    expect(pdfText).toContain('0.145 0.388 0.922 RG 0.145 0.388 0.922 rg');

    // Serialize / parse round-trip
    const parsed = parseDrawing(serializeDrawing(doc));
    expect(parsed.pages[0]!.dimensions[0]!.style?.color).toBe('#DC2626');
    expect(parsed.pages[0]!.annotations?.[0]!.color).toBe('#2563EB');

    // Resetting removes custom color
    doc = applyDrawingCommand(doc, { type: 'setDimension', dimensionId: 'd1', patch: { style: null } });
    doc = applyDrawingCommand(doc, { type: 'setAnnotation', annotationId: 'a1', patch: { color: null } });
    const resetScene = buildScene(doc, lines, elements).scene;
    expect(resetScene.items.every((i) => i.color === undefined)).toBe(true);
  });

  it('rejects invalid color strings on both dimensions and annotations', () => {
    const { doc } = makeColoredDrawing();
    expect(() => applyDrawingCommand(doc, { type: 'setDimension', dimensionId: 'd1', patch: { style: { color: 'red' } } })).toThrow();
    expect(() => applyDrawingCommand(doc, { type: 'setDimension', dimensionId: 'd1', patch: { style: { color: '#FFF' } } })).toThrow();
    expect(() => applyDrawingCommand(doc, { type: 'setAnnotation', annotationId: 'a1', patch: { color: 'not-a-hex' } })).toThrow();
    expect(() => applyDrawingCommand(doc, { type: 'setAnnotation', annotationId: 'a1', patch: { color: '#GGGGGG' } })).toThrow();
  });
});
