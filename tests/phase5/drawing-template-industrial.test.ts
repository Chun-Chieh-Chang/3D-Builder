import { describe, expect, it } from 'vitest';
import {
  applyDrawingCommand,
  createEmptyDrawing,
  DRAWING_SCHEMA_VERSION,
  DRAWING_STANDARDS,
  drawingPageForOutput,
  page,
  parseDrawing,
  serializeDrawing,
  SHEET_SIZES,
  sheetTemplateOf,
  type DrawingDoc,
  type TitleField,
} from '@3db/model';
import {
  checkPdf,
  drawingSheetMetrics,
  evaluateQualityGate,
  INDUSTRIAL_REV_TABLE,
  INDUSTRIAL_TITLE_BLOCK,
  itemsBounds,
  readDxf,
  readPdf,
  revisionTableItems,
  sheetItems,
  sheetMetrics,
  stampPreliminary,
  toDxf,
  toPdf,
  toSvg,
  type CoverageReport,
  type DrawingLayoutInspection,
  type QualityGateInput,
  type Scene,
  type SceneItem,
  type ScenePolyline,
  type SceneText,
} from '@3db/drawing';
import { olderDrawingFile } from '../support/drawingVersion';

const textsOf = (items: readonly SceneItem[]): SceneText[] => items.filter((i): i is SceneText => i.kind === 'text');
const polysOf = (items: readonly SceneItem[]): ScenePolyline[] => items.filter((i): i is ScenePolyline => i.kind === 'polyline');

function industrialDoc(fields: Partial<Record<TitleField, string>> = {}): DrawingDoc {
  let doc = createEmptyDrawing('CNS');
  doc = applyDrawingCommand(doc, { type: 'setSheet', sheet: { template: 'industrial', projection: 'third', scale: [2, 1], unit: 'mm' } });
  for (const [field, value] of Object.entries(fields) as [TitleField, string][]) {
    doc = applyDrawingCommand(doc, { type: 'setTitle', field, value });
  }
  return doc;
}

describe('Generic bilingual industrial drawing sheet template (v46)', () => {
  it('round-trips schema v46, strips runtime outputPage, keeps legacy drawings as standard, and rejects invalid inputs', () => {
    expect(DRAWING_SCHEMA_VERSION).toBeGreaterThanOrEqual(46);
    const doc = industrialDoc({
      company: '通用精密股份有限公司',
      companyEn: 'ACME PRECISION CO., LTD.',
      drawingName: 'Test Housing Bracket',
      drawingNo: 'DWG-2026-001',
      fileNo: 'FILE-2026-001',
      material: 'AL6061-T6',
      finish: 'Anodize Clear',
      tolAngle: '±1°',
      tolDec1: '±0.2',
    });
    expect(doc.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    expect(sheetTemplateOf(page(doc).sheet)).toBe('industrial');

    const paged = drawingPageForOutput(doc, 0);
    expect(paged.outputPage).toEqual({ index: 0, total: 1 });
    const json = serializeDrawing(paged);
    expect(json).not.toContain('outputPage');

    const reparsed = parseDrawing(json);
    expect(reparsed.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    expect(sheetTemplateOf(page(reparsed).sheet)).toBe('industrial');
    expect(page(reparsed).title.companyEn).toBe('ACME PRECISION CO., LTD.');
    expect(page(reparsed).title.fileNo).toBe('FILE-2026-001');

    // Legacy v24 drawing upgrades cleanly and defaults to standard template
    const legacy = olderDrawingFile(createEmptyDrawing('ISO'), 24);
    const upgraded = parseDrawing(JSON.stringify(legacy));
    expect(upgraded.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    expect(sheetTemplateOf(page(upgraded).sheet)).toBe('standard');

    // Invalid template / title field rejected in both commands and file parser
    expect(() => applyDrawingCommand(doc, { type: 'setSheet', sheet: { template: 'custom' as never } })).toThrow();
    expect(() => applyDrawingCommand(doc, { type: 'setTitle', field: 'unknownField' as never, value: 'x' })).toThrow();
    const badJson = JSON.parse(json) as { pages: { sheet: { template?: string } }[] };
    badJson.pages[0]!.sheet.template = 'custom';
    expect(() => parseDrawing(JSON.stringify(badJson))).toThrow();
  });

  it('contains zero real company/person/part/tolerance data from the reference screenshot when blank', () => {
    const doc = industrialDoc();
    const items = sheetItems(doc);
    const allTexts = textsOf(items).map((t) => t.text).join('\n');

    const forbidden = [
      '凱益',
      'MOULDEX',
      'PVC',
      '7088G',
      'DEHP',
      'Gilbert',
      '12-110130',
      'M05003',
      '2.8mm',
      '4.1mm',
      '130mm',
      'Tubing',
      '2022-07',
      '±2°',
      '±.3',
      '±.25',
      '±.13',
      '新圖',
    ];
    for (const token of forbidden) {
      expect(allTexts, `leaked reference token: ${token}`).not.toContain(token);
    }

    // Standard bilingual headers and dimension classification labels are present
    for (const label of [
      '一般公差  TOLERANCES UNLESS SPECIFIED',
      'ANGLES',
      'FRACTIONAL',
      'DECIMALS/MM',
      '.X',
      '.XX',
      '.XXX',
      '尺寸級別  DIM. CLASSIFICATION',
      '重要尺寸',
      'CRITICAL',
      '次要尺寸',
      'MAJOR',
      '一般尺寸',
      'ALL OTHERS MINOR',
      'MATERIAL',
      'FINISHED',
      'SCALE',
      'UNIT',
      'REV',
      'PAGE',
      'DESCRIPTION',
      'PART NO.',
      '檔案編號  FILE NO.',
      '2:1',
      'mm',
      '1/1',
      '項',
      'REVISION',
      'DATE',
      'CKD',
      '原',
    ]) {
      expect(allTexts).toContain(label);
    }

    // Pure black ink (no explicit blue/color override on template items)
    for (const item of items) {
      expect(item.color).toBeUndefined();
    }
  });

  it('renders all user fields, multi-page numbering, vector triangles, projection symbols, and exports SVG/PDF/DXF cleanly', () => {
    let doc = industrialDoc({
      company: '通用範例公司',
      companyEn: 'GENERIC SAMPLE CO., LTD.',
      drawingName: 'Precision Mounting Collar Assembly Long Title Example',
      drawingNo: 'PART-9001',
      fileNo: 'PART-9001-A',
      material: 'SUS304',
      finish: 'Passivated',
      approvedBy: 'A. Lin',
      approvedDate: '2026-11-27',
      checkedBy: 'B. Wu',
      checkedDate: '2026-11-26',
      drafter: 'C. Tsai',
      date: '2026-11-25',
      tolAngle: '±1.5°',
      tolFraction: '±0.5',
      tolDec1: '±0.2',
      tolDec2: '±0.1',
      tolDec3: '±0.05',
      revision: 'B',
    });
    doc = applyDrawingCommand(doc, {
      type: 'insertPage',
      page: {
        id: 'page2',
        name: 'Sheet 2',
        sheet: { size: 'A3', orientation: 'landscape', projection: 'first', scale: [1, 1], standard: 'CNS', template: 'industrial' },
        title: { drawingName: 'Second Sheet Part', drawingNo: 'PART-9002' },
        views: [],
        dimensions: [],
        tables: [],
        surfaceFinishes: [],
        annotations: [],
      },
    });

    const page1 = drawingPageForOutput(doc, 0);
    const page2 = drawingPageForOutput(doc, 1);
    const m1 = sheetMetrics(page(page1).sheet);
    const items1 = sheetItems(page1);
    const items2 = sheetItems(page2);

    expect(textsOf(items1).some((t) => t.text === '1/2')).toBe(true);
    expect(textsOf(items2).some((t) => t.text === '2/2')).toBe(true);
    expect(textsOf(items1).some((t) => t.text === 'GENERIC SAMPLE CO., LTD.')).toBe(true);
    expect(textsOf(items1).some((t) => t.text === 'SUS304')).toBe(true);
    expect(textsOf(items1).some((t) => t.text === 'Passivated')).toBe(true);
    expect(textsOf(items1).some((t) => t.text === 'PART-9001-A')).toBe(true);
    expect(textsOf(items1).some((t) => t.text === '±0.05')).toBe(true);

    // Vector filled triangles present (1 solid ▲ + 1 half-filled triangle = 2 filled triangles)
    const filledPolys = polysOf(items1).filter((p) => p.filled);
    expect(filledPolys.length).toBe(2);

    // Projection symbols: third-angle has circles on left of trapezoid, first-angle has circles on right of trapezoid
    const projTopY = m1.titleBlock.y + m1.titleBlock.h;
    const thirdCircles = polysOf(items1).filter((p) => p.closed && p.points.length > 16 && p.points[1]! > projTopY);
    const firstCircles = polysOf(items2).filter((p) => p.closed && p.points.length > 16 && p.points[1]! > projTopY);
    expect(thirdCircles.length).toBe(2);
    expect(firstCircles.length).toBe(2);
    const avgX = (pts: number[]) => pts.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / (pts.length / 2);
    expect(avgX(thirdCircles[0]!.points)).toBeLessThan(m1.titleBlock.x + m1.titleBlock.w - INDUSTRIAL_TITLE_BLOCK.projectionBoxWidth / 2);
    expect(avgX(firstCircles[0]!.points)).toBeGreaterThan(m1.titleBlock.x + m1.titleBlock.w - INDUSTRIAL_TITLE_BLOCK.projectionBoxWidth / 2);

    // SVG, PDF (with ASCII check), DXF standard & compat all succeed cleanly
    const scene: Scene = { width: m1.width, height: m1.height, items: items1 };
    const svg = toSvg(scene);
    expect(svg).toContain('GENERIC SAMPLE CO., LTD.');
    expect(svg).toContain('PART-9001');

    const pdf = toPdf(scene);
    const parsedPdf = readPdf(pdf.bytes);
    expect(checkPdf(parsedPdf)).toEqual([]);
    const pdfText = parsedPdf.pages[0]!.texts.map((t) => t.text).join(' ');
    expect(pdfText).toContain('GENERIC SAMPLE CO., LTD.');
    expect(pdfText).toContain('PART-9001');
    expect(pdfText).toContain('1/2');

    for (const mode of ['standard', 'compat'] as const) {
      const dxf = toDxf(scene, { mode });
      const parsedDxf = readDxf(dxf);
      expect(parsedDxf.entities.length).toBeGreaterThan(10);
    }
  });

  it('links bottom-left revision table to revisionHistory (<= 4 and > 4 entries) with no top-right table or outside form code', () => {
    let doc = industrialDoc();
    doc = applyDrawingCommand(doc, { type: 'saveRevision', entry: { revision: 'A', date: '2026-11-01', description: 'Initial release', author: 'E1' } });
    doc = applyDrawingCommand(doc, { type: 'saveRevision', entry: { revision: 'B', date: '2026-11-05', description: 'Update wall thickness', author: 'E2' } });
    doc = applyDrawingCommand(doc, { type: 'saveRevision', entry: { revision: 'C', date: '2026-11-10', description: 'Add chamfer callout', author: 'E3' } });
    doc = applyDrawingCommand(doc, { type: 'saveRevision', entry: { revision: 'D', date: '2026-11-15', description: 'Adjust bore tolerance', author: 'E4' } });
    doc = applyDrawingCommand(doc, { type: 'saveRevision', entry: { revision: 'E', date: '2026-11-20', description: 'Final polish', author: 'E5' } });

    const m = sheetMetrics(page(doc).sheet);
    const rev = revisionTableItems(doc, m.frame)!;
    expect(rev).toBeDefined();
    // Bottom-left placement inside frame
    expect(rev.box.x).toBe(m.frame.x);
    expect(rev.box.y).toBe(m.frame.y);
    expect(rev.box.w).toBe(INDUSTRIAL_REV_TABLE.width);

    const revTexts = textsOf(rev.items).map((t) => t.text);
    expect(revTexts).toContain('Initial release');
    expect(revTexts).not.toContain('Update wall thickness');
    expect(revTexts).toContain('Add chamfer callout');
    expect(revTexts).toContain('Adjust bore tolerance');
    expect(revTexts).toContain('Final polish');
    // Triangle numbers for entries 2, 3, 4 when 5 total entries exist
    expect(revTexts).toContain('2');
    expect(revTexts).toContain('3');
    expect(revTexts).toContain('4');

    // Every item sits inside frame (no outside form code below frame)
    const items = sheetItems(doc);
    const bounds = itemsBounds(items)!;
    expect(bounds.x0).toBeGreaterThanOrEqual(m.frame.x - 1e-6);
    expect(bounds.y0).toBeGreaterThanOrEqual(m.frame.y - 1e-6);
    expect(bounds.x1).toBeLessThanOrEqual(m.frame.x + m.frame.w + 1e-6);
    expect(bounds.y1).toBeLessThanOrEqual(m.frame.y + m.frame.h + 1e-6);
  });

  it('never overlaps title block, projection box, revision table, or drawable area across all 20 sheet size/orientation/standard combinations', () => {
    for (const standard of DRAWING_STANDARDS) {
      for (const size of SHEET_SIZES) {
        for (const orientation of ['landscape', 'portrait'] as const) {
          let doc = createEmptyDrawing(standard);
          doc = applyDrawingCommand(doc, { type: 'setSheet', sheet: { size, orientation, template: 'industrial' } });
          const m = drawingSheetMetrics(doc);
          const items = sheetItems(doc);
          const bounds = itemsBounds(items)!;
          expect(bounds.x0, `${standard} ${size} ${orientation}`).toBeGreaterThanOrEqual(m.frame.x - 1e-6);
          expect(bounds.y0, `${standard} ${size} ${orientation}`).toBeGreaterThanOrEqual(m.frame.y - 1e-6);
          expect(bounds.x1, `${standard} ${size} ${orientation}`).toBeLessThanOrEqual(m.frame.x + m.frame.w + 1e-6);
          expect(bounds.y1, `${standard} ${size} ${orientation}`).toBeLessThanOrEqual(m.frame.y + m.frame.h + 1e-6);

          const rev = revisionTableItems(doc, m.frame)!;
          const projTop = m.titleBlock.y + m.titleBlock.h + INDUSTRIAL_TITLE_BLOCK.projectionBoxHeight;
          expect(m.area.y, `${standard} ${size} ${orientation} area above proj box`).toBeGreaterThan(projTop);
          expect(m.area.h, `${standard} ${size} ${orientation} positive area height`).toBeGreaterThan(50);

          // Revision table either sits cleanly left of title block or above drawable area (A4 portrait)
          const leftOfTitleBlock = rev.box.x + rev.box.w <= m.titleBlock.x - 1e-6 && rev.box.y + rev.box.h <= m.area.y;
          const aboveArea = rev.box.y >= m.area.y + m.area.h - 1e-6;
          expect(leftOfTitleBlock || aboveArea, `${standard} ${size} ${orientation} rev table clear`).toBe(true);
        }
      }
    }
  });

  it('recognizes industrial general tolerance fields in quality gate C5 and stamps PRELIMINARY above the 64 mm block', () => {
    const gateInput = (doc: DrawingDoc): QualityGateInput => {
      const coverage: CoverageReport = {
        ways: [{ way: 'X', datum: 0, places: 2, determined: 2, missing: [] }],
        rounds: { total: 1, determined: 1, missing: [] },
        slants: { total: 0, determined: 0, missing: [] },
        complete: true,
      };
      const layout: DrawingLayoutInspection = {
        pages: [{
          page: 0,
          sheet: 'A3',
          scale: '2:1',
          fillW: 0.6,
          fillH: 0.5,
          maxFill: 0.6,
          viewAreaFill: 0.2,
          minClearance: 10,
          needClearance: 7,
          clearances: [],
          details: [],
          nonStandardScales: [],
          captionClutter: [],
          checks: { clearance: true, fill: true, detailPlacement: true, detailContent: true, standardScales: true, captionsClear: true },
          pass: true,
        }],
        multiPage: { sameSheet: true, uniqueLetters: true, referenceMarked: true, pass: true },
        mainView: { revolved: false, axis: null, direction: 'front', sideOn: true, pass: true },
        pass: true,
      };
      return { doc, overlaps: 0, textOutOfRange: [], clutterCount: 0, outside: 0, failedDims: [], coverage, layout };
    };

    let blankDoc = industrialDoc();
    const blankReport = evaluateQualityGate(gateInput(blankDoc));
    expect(blankReport.rules.find((r) => r.rule === 'C5')?.pass).toBe(false);

    blankDoc = applyDrawingCommand(blankDoc, { type: 'setTitle', field: 'tolDec1', value: '±0.2' });
    const filledReport = evaluateQualityGate(gateInput(blankDoc));
    expect(filledReport.rules.find((r) => r.rule === 'C5')?.pass).toBe(true);

    const m = sheetMetrics(page(blankDoc).sheet);
    const stamped = stampPreliminary({ width: m.width, height: m.height, items: sheetItems(blankDoc) }, page(blankDoc).sheet);
    const prelim = textsOf(stamped.items).find((t) => t.text === 'PRELIMINARY')!;
    expect(prelim).toBeDefined();
    expect(prelim.at[1]).toBeGreaterThan(m.titleBlock.y + m.titleBlock.h);
  });
});
