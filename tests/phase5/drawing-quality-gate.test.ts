import { describe, expect, it } from 'vitest';
import { createEmptyDrawing, type DrawingDoc } from '@3db/model';
import { evaluateQualityGate, hasModelAuthorityNote, stampPreliminary, toDxf, toSvg, type CoverageReport, type DrawingLayoutInspection, type QualityGateInput, type Scene } from '@3db/drawing';

function cleanDoc(): DrawingDoc {
  const doc = createEmptyDrawing();
  doc.pages[0]!.title.generalTolerance = 'ISO 2768-mK';
  return doc;
}

function cleanCoverage(complete = true): CoverageReport {
  return {
    ways: [{ way: 'X', datum: 0, places: 2, determined: complete ? 2 : 1, missing: complete ? [] : [{ at: 10, refs: ['f1'] }] }],
    rounds: { total: 1, determined: 1, missing: [] },
    slants: { total: 0, determined: 0, missing: [] },
    complete,
  };
}

function cleanLayout(): DrawingLayoutInspection {
  return {
    pages: [
      {
        page: 0,
        sheet: 'A3',
        scale: '1:1',
        fillW: 0.72,
        fillH: 0.55,
        maxFill: 0.72,
        viewAreaFill: 0.22,
        minClearance: 12,
        needClearance: 7,
        clearances: [],
        details: [],
        nonStandardScales: [],
        captionClutter: [],
        checks: {
          clearance: true,
          fill: true,
          detailPlacement: true,
          detailContent: true,
          standardScales: true,
          captionsClear: true,
        },
        pass: true,
      },
    ],
    multiPage: { sameSheet: true, uniqueLetters: true, referenceMarked: true, pass: true },
    mainView: { revolved: false, axis: null, direction: 'top', sideOn: true, pass: true },
    pass: true,
  };
}

function cleanInput(): QualityGateInput {
  return {
    doc: cleanDoc(),
    overlaps: 0,
    textOutOfRange: [],
    clutterCount: 0,
    outside: 0,
    failedDims: [],
    coverage: cleanCoverage(true),
    layout: cleanLayout(),
  };
}

describe('Phase 4: drawing quality gate (ADR 0263, rules Q1, Q2, C5, C7, Q3)', () => {
  it('passes as release only when every rule has zero violations', () => {
    const r = evaluateQualityGate(cleanInput());
    expect(r.status).toBe('release');
    expect(r.pass).toBe(true);
    expect(r.failed).toEqual([]);
    expect(r.rules.length).toBeGreaterThanOrEqual(16);
  });

  it('Q2: complete coverage alone never passes when another rule fails', () => {
    const inp = cleanInput();
    inp.clutterCount = 2;
    inp.clutterTexts = ['Ø10', '60'];
    const r = evaluateQualityGate(inp);
    expect(inp.coverage.complete).toBe(true);
    expect(r.status).toBe('draft');
    expect(r.pass).toBe(false);
    expect(r.failed.map((f) => f.rule)).toEqual(['D5']);
  });

  it('blocks release and identifies the exact failing rule for every automatable rule (rule 4-1)', () => {
    const cases: { rule: string; mutate: (inp: QualityGateInput) => void }[] = [
      { rule: 'V1', mutate: (i) => { i.layout.pages[0]!.checks.clearance = false; i.layout.pages[0]!.minClearance = 2; i.layout.pages[0]!.pass = false; i.layout.pass = false; } },
      { rule: 'P1_P2', mutate: (i) => { i.layout.pages[0]!.checks.fill = false; i.layout.pages[0]!.maxFill = 1.1; i.layout.pages[0]!.pass = false; i.layout.pass = false; } },
      { rule: 'V4', mutate: (i) => { i.layout.pages[0]!.checks.detailPlacement = false; i.layout.pages[0]!.pass = false; i.layout.pass = false; } },
      { rule: 'V6', mutate: (i) => { i.layout.pages[0]!.checks.detailContent = false; i.layout.pages[0]!.pass = false; i.layout.pass = false; } },
      { rule: 'P4', mutate: (i) => { i.layout.pages[0]!.checks.standardScales = false; i.layout.pages[0]!.nonStandardScales = [{ id: 'view2', scale: 3 }]; i.layout.pages[0]!.pass = false; i.layout.pass = false; } },
      { rule: 'P3_V7', mutate: (i) => { i.layout.multiPage.uniqueLetters = false; i.layout.multiPage.pass = false; i.layout.pass = false; } },
      { rule: 'V5', mutate: (i) => { i.layout.pages[0]!.checks.captionsClear = false; i.layout.pages[0]!.captionClutter = ['前視']; i.layout.pages[0]!.pass = false; i.layout.pass = false; } },
      { rule: 'V2', mutate: (i) => { i.layout.mainView = { revolved: true, axis: [0, 1, 0], direction: 'bottom', sideOn: false, pass: false }; i.layout.pass = false; } },
      { rule: 'D5', mutate: (i) => { i.clutterCount = 1; i.clutterTexts = ['20']; } },
      { rule: 'D2', mutate: (i) => { i.overlaps = 1; } },
      { rule: 'P6', mutate: (i) => { i.textOutOfRange = ['10 (1.2 mm)']; } },
      { rule: 'P1', mutate: (i) => { i.outside = 4.5; } },
      { rule: 'C4', mutate: (i) => { i.failedDims = [{ id: 'dim1', error: 'broken ref' }]; } },
      { rule: 'C5', mutate: (i) => { i.doc.pages[0]!.title.generalTolerance = '   '; } },
      { rule: 'C7', mutate: (i) => { i.coverage = cleanCoverage(false); } },
      {
        rule: 'Q3',
        mutate: (i) => {
          const p2 = structuredClone(i.doc.pages[0]!);
          p2.sheet.standard = 'ISO';
          i.doc.pages[0]!.sheet.standard = 'CNS';
          i.doc.pages.push(p2);
        },
      },
    ];

    for (const c of cases) {
      const inp = cleanInput();
      c.mutate(inp);
      const r = evaluateQualityGate(inp);
      expect(r.status, c.rule).toBe('draft');
      expect(r.pass, c.rule).toBe(false);
      expect(r.failed.map((f) => f.rule), c.rule).toContain(c.rule);
    }
  });

  it('C7: incomplete dimensions pass C7 only when BOTH "依 3D 模型" note AND generalTolerance are present', () => {
    const inp = cleanInput();
    inp.coverage = cleanCoverage(false);
    expect(hasModelAuthorityNote(inp.doc)).toBe(false);
    expect(evaluateQualityGate(inp).failed.map((f) => f.rule)).toContain('C7');

    // Add 3D model authority note + generalTolerance -> passes both C5 and C7
    inp.doc.pages[0]!.annotations = [{ id: 'ann1', kind: 'note', view: 'view1', text: '未標註尺寸依 3D 模型與一般公差管制', at: [40, 40] }];
    expect(hasModelAuthorityNote(inp.doc)).toBe(true);
    const ok = evaluateQualityGate(inp);
    expect(ok.status).toBe('release');
    expect(ok.failed).toEqual([]);

    // Remove generalTolerance while keeping the note -> fails BOTH C5 and C7
    inp.doc.pages[0]!.title.generalTolerance = '';
    const bad = evaluateQualityGate(inp);
    expect(bad.status).toBe('draft');
    expect(bad.failed.map((f) => f.rule)).toEqual(['C5', 'C7']);
  });

  it('stampPreliminary writes PRELIMINARY into SVG and DXF scenes', () => {
    const base: Scene = { width: 420, height: 297, items: [] };
    const stamped = stampPreliminary(base);
    expect(stamped.items.some((i) => i.kind === 'text' && i.text === 'PRELIMINARY')).toBe(true);
    expect(toSvg(stamped)).toContain('PRELIMINARY');
    expect(toDxf(stamped)).toContain('PRELIMINARY');
    expect(toSvg(base)).not.toContain('PRELIMINARY');
  });
});
