import { standardOf, type DrawingDoc } from '@3db/model';
import type { CoverageReport } from './autoDrawing';
import type { DrawingLayoutInspection } from './layoutMetrics';
import type { Scene, SceneText } from './scene';

/**
 * Drawing quality gate (ADR 0263, Phase 4: rules Q1, Q2, C5, C7, Q3).
 *
 * Evaluates every automatable rule in `docs/design/drawing-rules-cns.md` and produces a structured
 * `QualityGateReport`. A drawing reaches `status: 'release'` only when EVERY rule passes (`failed.length === 0`);
 * otherwise `status: 'draft'` and any exported sheet must be stamped `PRELIMINARY` (or formal export refused).
 * Per rule Q2, `coverage.complete === true` alone never constitutes release approval.
 */

export type DrawingReleaseStatus = 'release' | 'draft';

export interface QualityRuleCheck {
  /** Spec rule code (e.g. 'V1', 'P1_P2', 'D5', 'C5', 'C7', 'Q3'). */
  rule: string;
  /** Short machine-readable check name. */
  name: string;
  /** True when the rule has zero violations. */
  pass: boolean;
  /** Human-readable description of the violation when `pass === false`. */
  detail?: string;
}

export interface QualityGateReport {
  /** `'release'` iff every rule passes; `'draft'` whenever any rule fails (Q1, Q2). */
  status: DrawingReleaseStatus;
  /** Convenience boolean equal to `status === 'release'`. */
  pass: boolean;
  /** Every checked rule in deterministic order. */
  rules: QualityRuleCheck[];
  /** Subset of `rules` where `pass === false`. */
  failed: QualityRuleCheck[];
}

export interface QualityGateInput {
  doc: DrawingDoc;
  overlaps: number;
  textOutOfRange: readonly string[];
  clutterCount: number;
  clutterTexts?: readonly string[];
  clutterCrossings?: readonly string[];
  outside: number;
  failedDims: readonly { id: string; error: string }[];
  coverage: CoverageReport;
  layout: DrawingLayoutInspection;
}

const MODEL_AUTHORITY_RE = /\u4f9d\s*3D\s*\u6a21\u578b|\u4ee5\s*3D\s*\u6a21\u578b|\u672a\u6a19\u8a3b.*3D|per\s+3D\s+model|refer\s+to\s+3D\s+model|ASME\s*Y14\.41|ISO\s*16792/i;

/** Whether the drawing carries a 3D-model-authority note (rule C7, ASME Y14.41 / ISO 16792). */
export function hasModelAuthorityNote(doc: DrawingDoc): boolean {
  for (const p of doc.pages) {
    for (const a of p.annotations ?? []) {
      if (a.kind === 'note' && MODEL_AUTHORITY_RE.test(a.text)) return true;
    }
  }
  return false;
}

/** Evaluates all automatable drawing quality rules (ADR 0263, rules Q1, Q2, C5, C7, Q3, P/V/D/C). */
export function evaluateQualityGate(input: QualityGateInput): QualityGateReport {
  const { doc, overlaps, textOutOfRange, clutterCount, clutterTexts, clutterCrossings, outside, failedDims, coverage, layout } = input;
  const rules: QualityRuleCheck[] = [];
  const push = (rule: string, name: string, pass: boolean, detail?: string) => {
    rules.push(pass ? { rule, name, pass: true } : { rule, name, pass: false, ...(detail ? { detail } : {}) });
  };

  // Layout rules (Phase 2, P1-P4 / V1-V8)
  const badClearance = layout.pages.filter((p) => !p.checks.clearance);
  push(
    'V1',
    'viewClearance',
    badClearance.length === 0,
    badClearance.map((p) => `page ${p.page + 1}: minClearance ${p.minClearance} mm < ${p.needClearance} mm`).join('; '),
  );

  const badFill = layout.pages.filter((p) => !p.checks.fill);
  const dominantFillFailed = badFill.length === 0 && !layout.pass && layout.pages.every((p) => p.pass) && layout.multiPage.pass && layout.mainView.pass;
  push(
    'P1_P2',
    'sheetFill',
    badFill.length === 0 && !dominantFillFailed,
    badFill.length
      ? badFill.map((p) => `page ${p.page + 1}: maxFill ${p.maxFill} out of range`).join('; ')
      : dominantFillFailed
        ? `dominant page fill out of [0.60, 0.95]`
        : undefined,
  );

  const badDetailPlace = layout.pages.filter((p) => !p.checks.detailPlacement);
  push(
    'V4',
    'detailPlacement',
    badDetailPlace.length === 0,
    badDetailPlace.map((p) => `page ${p.page + 1}: detail blocked or too far from parent`).join('; '),
  );

  const badDetailContent = layout.pages.filter((p) => !p.checks.detailContent);
  push(
    'V6',
    'detailContent',
    badDetailContent.length === 0,
    badDetailContent.map((p) => `page ${p.page + 1}: detail inkRatio below minimum`).join('; '),
  );

  const badScales = layout.pages.filter((p) => !p.checks.standardScales);
  push(
    'P4',
    'standardScales',
    badScales.length === 0,
    badScales.map((p) => `page ${p.page + 1}: non-standard scales ${p.nonStandardScales.join(', ')}`).join('; '),
  );

  push(
    'P3_V7',
    'multiPageConsistency',
    layout.multiPage.pass,
    [
      !layout.multiPage.sameSheet ? 'pages use different sheet sizes' : '',
      !layout.multiPage.uniqueLetters ? 'duplicate section/detail letters' : '',
      !layout.multiPage.referenceMarked ? 'repeated base view not marked as reference' : '',
    ]
      .filter(Boolean)
      .join('; '),
  );

  const badCaptions = layout.pages.filter((p) => !p.checks.captionsClear);
  push(
    'V5',
    'captionsClear',
    badCaptions.length === 0,
    badCaptions.map((p) => `page ${p.page + 1}: caption overlap (${p.captionClutter.join(', ')})`).join('; '),
  );

  push(
    'V2',
    'mainViewOrientation',
    layout.mainView.pass,
    layout.mainView.revolved ? `turned part main view "${layout.mainView.direction}" is not side-on to axis` : undefined,
  );

  // Dimension readability & integrity rules (Phase 3, D2 / D5 / P1 / P6 / C4)
  push(
    'D5',
    'clutter',
    clutterCount === 0,
    clutterCount > 0
      ? `${clutterCount} clutter(s)${clutterTexts?.length ? ` [texts: ${clutterTexts.slice(0, 5).join(', ')}]` : ''}${clutterCrossings?.length ? ` [crossings: ${clutterCrossings.slice(0, 5).join(', ')}]` : ''}`
      : undefined,
  );

  push('D2', 'overlaps', overlaps === 0, overlaps > 0 ? `${overlaps} overlapping dimension(s)` : undefined);
  push('P6', 'textRange', textOutOfRange.length === 0, textOutOfRange.length > 0 ? `out of range: ${textOutOfRange.slice(0, 5).join(', ')}` : undefined);
  push('P1', 'insideDrawableArea', outside === 0, outside > 0 ? `content extends ${outside} mm outside drawable area` : undefined);
  push(
    'C4',
    'readableDimensions',
    failedDims.length === 0,
    failedDims.length > 0 ? `${failedDims.length} failed dimension(s): ${failedDims.slice(0, 5).map((d) => `${d.id} (${d.error})`).join(', ')}` : undefined,
  );

  // Rule C5: General tolerance block must not be blank (tool never auto-fills it)
  const blankTolPages = doc.pages
    .map((p, i) => ({ i, tol: (p.title.generalTolerance ?? '').trim() }))
    .filter((x) => x.tol.length === 0);
  push(
    'C5',
    'generalTolerance',
    blankTolPages.length === 0,
    blankTolPages.length > 0
      ? `generalTolerance is blank on page(s) ${blankTolPages.map((x) => x.i + 1).join(', ')} (specify general tolerance in title block)`
      : undefined,
  );

  // Rule C7: Complete dimensions OR (3D model authority note + general tolerance filled)
  const modelNote = hasModelAuthorityNote(doc);
  const c7Pass = coverage.complete || (modelNote && blankTolPages.length === 0);
  const missingSummary: string[] = [];
  for (const w of coverage.ways) if (w.missing.length) missingSummary.push(`${w.way}:${w.missing.length}`);
  if (coverage.rounds.missing.length) missingSummary.push(`rounds:${coverage.rounds.missing.length}`);
  if (coverage.slants.missing.length) missingSummary.push(`slants:${coverage.slants.missing.length}`);
  push(
    'C7',
    'completenessOrModelAuthority',
    c7Pass,
    !c7Pass
      ? `incomplete dimensions (${missingSummary.join(', ') || 'missing'}) without both a 3D model authority note and generalTolerance`
      : undefined,
  );

  // Rule Q3: Single drafting standard across all pages
  const standards = [...new Set(doc.pages.map((p) => standardOf(p.sheet)))];
  push(
    'Q3',
    'consistentStandard',
    standards.length <= 1,
    standards.length > 1 ? `mixed standards across pages: ${standards.join(', ')}` : undefined,
  );

  const failed = rules.filter((r) => !r.pass);
  const pass = failed.length === 0;
  return {
    status: pass ? 'release' : 'draft',
    pass,
    rules,
    failed,
  };
}

/**
 * Stamps a prominent `PRELIMINARY` watermark onto a sheet scene for draft exports (ADR 0263, rule Q1).
 * Works across PDF, SVG, DXF, and PNG because all exporters render `SceneText` with `angle` and `color`.
 */
export function stampPreliminary(scene: Scene): Scene {
  const height = Math.max(12, Math.round(Math.min(scene.width, scene.height) * 0.06));
  const stamp: SceneText = {
    kind: 'text',
    owner: 'quality:preliminary',
    color: '#CC3333',
    at: [scene.width / 2, scene.height / 2],
    text: 'PRELIMINARY',
    height,
    anchor: 'center',
    angle: 30,
  };
  return {
    ...scene,
    items: [...scene.items, stamp],
  };
}
