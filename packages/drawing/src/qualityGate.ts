import { standardOf, type DrawingDoc, type DrawingSheet } from '@3db/model';
import { sheetMetrics } from './sheet';
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

export interface ControlledAttachmentRef {
  /** Controlled attachment document ID (single safe path segment, e.g. "R1-10226-GEO-01"). */
  document: string;
  /** Controlled attachment revision (e.g. "01"). */
  revision: string;
}

export interface ControlledAttachmentEvidence {
  /** Document ID read from manifest.json. */
  document: string;
  /** Revision read from manifest.json. */
  revision: string;
  /** Source model filename read from manifest.json (matched against drawing view source basenames). */
  source: string;
  /** True iff cryptographic checks (STEP original/regenerated SHA-256, part STEP blob SHA-256, and every member SHA-256) all passed. */
  integrityOk: boolean;
  /** Specific integrity failures when `integrityOk === false`. */
  integrityErrors?: readonly string[];
  /** Mapping from 3D-Builder persistent face ref (e.g. "import1:f203") to STEP face ID (e.g. 27739). */
  faceIndex: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
}

export interface ControlledAttachmentCheck {
  /** Cited attachment from drawing notes, if any. */
  cited: ControlledAttachmentRef | null;
  /** True iff the cited attachment verified revision, source model, cryptographic integrity, and every missing face ref + STEP citation. */
  pass: boolean;
  /** Ordered list of verification failures when `pass === false`. */
  errors: string[];
  /** Number of missing face refs resolved through the attachment + STEP citation. */
  coveredMissingCount: number;
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
  /** Optional host-verified controlled geometric attachment evidence (rule C7). */
  controlledAttachment?: ControlledAttachmentEvidence | null;
}

const MODEL_AUTHORITY_RE = /\u4f9d\s*3D\s*\u6a21\u578b|\u4ee5\s*3D\s*\u6a21\u578b|\u672a\u6a19\u8a3b.*3D|per\s+3D\s+model|refer\s+to\s+3D\s+model|ASME\s*Y14\.41|ISO\s*16792/i;
const CONTROLLED_ATTACHMENT_RE = /(?:\u53d7\u63a7\u5e7e\u4f55\u9644\u4ef6|controlled\s+geometric\s+attachment)\s+([A-Za-z0-9._-]+)\s+(?:\u7248[\u6b21\u672c]|rev(?:ision)?\.?)\s*([A-Za-z0-9._-]+)/gi;
const STEP_FACE_CITATION_RE = /#([1-9]\d*)/g;

/** Whether the drawing carries a 3D-model-authority note (rule C7, ASME Y14.41 / ISO 16792). */
export function hasModelAuthorityNote(doc: DrawingDoc): boolean {
  for (const p of doc.pages) {
    for (const a of p.annotations ?? []) {
      if (a.kind === 'note' && MODEL_AUTHORITY_RE.test(a.text)) return true;
    }
  }
  return false;
}

/** Extracts controlled geometric attachment citations (document + revision) from drawing notes. */
export function findControlledAttachmentRefs(doc: DrawingDoc): ControlledAttachmentRef[] {
  const out: ControlledAttachmentRef[] = [];
  const seen = new Set<string>();
  for (const p of doc.pages) {
    for (const a of p.annotations ?? []) {
      if (a.kind !== 'note') continue;
      CONTROLLED_ATTACHMENT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CONTROLLED_ATTACHMENT_RE.exec(a.text)) !== null) {
        const document = m[1]!;
        const revision = m[2]!;
        const key = `${document}@${revision}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ document, revision });
      }
    }
  }
  return out;
}

/** Extracts all cited STEP face IDs (e.g. `#27739`) from drawing notes. */
export function findCitedStepFaces(doc: DrawingDoc): Set<number> {
  const out = new Set<number>();
  for (const p of doc.pages) {
    for (const a of p.annotations ?? []) {
      if (a.kind !== 'note') continue;
      STEP_FACE_CITATION_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = STEP_FACE_CITATION_RE.exec(a.text)) !== null) {
        const id = Number(m[1]);
        if (Number.isSafeInteger(id) && id > 0) out.add(id);
      }
    }
  }
  return out;
}

function sourceBasename(source: string): string {
  const parts = source.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? source;
}

function lookupFaceStepId(faceIndex: ControlledAttachmentEvidence['faceIndex'], ref: string): number | undefined {
  if (faceIndex instanceof Map) return faceIndex.get(ref);
  const v = (faceIndex as Record<string, number>)[ref];
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : undefined;
}

/**
 * Verifies that a controlled geometric attachment satisfies C7 for all missing coverage items:
 * 1. Drawing note cites a single controlled attachment (document + revision) matching the manifest.
 * 2. Every model view's source basename matches the attachment manifest's source model.
 * 3. Host cryptographic integrity checks (STEP SHA-256 and member SHA-256s) passed.
 * 4. Every missing coverage face ref maps via `drawing-face-index.json` to a STEP face ID explicitly cited (`#<id>`) in drawing notes.
 */
export function verifyControlledAttachment(
  doc: DrawingDoc,
  coverage: CoverageReport,
  attachment?: ControlledAttachmentEvidence | null,
): ControlledAttachmentCheck {
  const refs = findControlledAttachmentRefs(doc);
  if (refs.length === 0) return { cited: null, pass: false, errors: [], coveredMissingCount: 0 };
  const cited = refs[0]!;
  const errors: string[] = [];
  if (refs.length > 1) {
    errors.push(`multiple controlled attachments cited (${refs.map((r) => `${r.document} rev ${r.revision}`).join(', ')})`);
  }
  if (!attachment) {
    errors.push(`controlled attachment ${cited.document} rev ${cited.revision} not loaded or missing`);
    return { cited, pass: false, errors, coveredMissingCount: 0 };
  }
  if (attachment.document !== cited.document) {
    errors.push(`attachment document mismatch (drawing cites ${cited.document}, manifest has ${attachment.document})`);
  }
  if (attachment.revision !== cited.revision) {
    errors.push(`attachment revision mismatch (drawing cites ${cited.revision}, manifest has ${attachment.revision})`);
  }
  const viewSources = new Set<string>();
  for (const p of doc.pages) {
    for (const v of p.views) {
      if ('source' in v && typeof v.source === 'string' && v.source.trim().length > 0) {
        viewSources.add(sourceBasename(v.source.trim()));
      }
    }
  }
  const manifestSource = sourceBasename(attachment.source.trim());
  if (!manifestSource) {
    errors.push('attachment manifest source is blank');
  } else if (viewSources.size > 0) {
    for (const vs of viewSources) {
      if (vs !== manifestSource) {
        errors.push(`attachment source mismatch (view uses ${vs}, manifest has ${manifestSource})`);
      }
    }
  }
  if (!attachment.integrityOk) {
    if (attachment.integrityErrors && attachment.integrityErrors.length > 0) {
      errors.push(...attachment.integrityErrors);
    } else {
      errors.push(`attachment ${attachment.document} failed integrity verification`);
    }
  }

  const citedStepFaces = findCitedStepFaces(doc);
  let coveredMissingCount = 0;

  const checkFaceRef = (ref: string, kind: string) => {
    const stepId = lookupFaceStepId(attachment.faceIndex, ref);
    if (stepId === undefined) {
      errors.push(`missing ${kind} "${ref}" not found in attachment drawing-face-index`);
      return false;
    }
    if (!citedStepFaces.has(stepId)) {
      errors.push(`missing ${kind} "${ref}" (STEP #${stepId}) not cited on drawing`);
      return false;
    }
    coveredMissingCount++;
    return true;
  };

  for (const ref of coverage.slants.missing) checkFaceRef(ref, 'slant');
  for (const r of coverage.rounds.missing) checkFaceRef(r.name, 'round');
  for (const w of coverage.ways) {
    for (const place of w.missing) {
      const ok = place.refs.some((ref) => {
        const stepId = lookupFaceStepId(attachment.faceIndex, ref);
        return stepId !== undefined && citedStepFaces.has(stepId);
      });
      if (!ok) {
        errors.push(`missing ${w.way} place at ${place.at} (${place.refs.join(', ')}) not indexed and cited via attachment`);
      } else {
        coveredMissingCount++;
      }
    }
  }

  return { cited, pass: errors.length === 0, errors, coveredMissingCount };
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

  // Rule C7: Complete dimensions OR ((3D model authority note OR verified controlled geometric attachment) + general tolerance filled)
  const modelNote = hasModelAuthorityNote(doc);
  const attachmentCheck = coverage.complete ? null : verifyControlledAttachment(doc, coverage, input.controlledAttachment);
  const c7Pass = coverage.complete || (blankTolPages.length === 0 && (modelNote || Boolean(attachmentCheck?.pass)));
  const missingSummary: string[] = [];
  for (const w of coverage.ways) if (w.missing.length) missingSummary.push(`${w.way}:${w.missing.length}`);
  if (coverage.rounds.missing.length) missingSummary.push(`rounds:${coverage.rounds.missing.length}`);
  if (coverage.slants.missing.length) missingSummary.push(`slants:${coverage.slants.missing.length}`);
  let c7Detail: string | undefined;
  if (!c7Pass) {
    if (attachmentCheck?.cited && attachmentCheck.errors.length > 0) {
      c7Detail = `incomplete dimensions (${missingSummary.join(', ') || 'missing'}); controlled attachment ${attachmentCheck.cited.document} rev ${attachmentCheck.cited.revision} failed: ${attachmentCheck.errors.join('; ')}`;
    } else if (attachmentCheck?.cited && blankTolPages.length > 0) {
      c7Detail = `incomplete dimensions (${missingSummary.join(', ') || 'missing'}); controlled attachment ${attachmentCheck.cited.document} rev ${attachmentCheck.cited.revision} requires generalTolerance`;
    } else {
      c7Detail = `incomplete dimensions (${missingSummary.join(', ') || 'missing'}) without both a 3D model authority note (or verified controlled attachment) and generalTolerance`;
    }
  }
  push('C7', 'completenessOrModelAuthority', c7Pass, c7Detail);

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
 * Places the `PRELIMINARY` status above the title block for draft exports (ADR 0263, rule Q1).
 * Works across PDF, SVG, DXF, and PNG because all exporters render `SceneText` with `angle` and `color`.
 */
export function stampPreliminary(scene: Scene, sheet: Pick<DrawingSheet, 'size' | 'orientation' | 'standard'>): Scene {
  const { titleBlock } = sheetMetrics(sheet);
  const stamp: SceneText = {
    kind: 'text',
    owner: 'quality:preliminary',
    color: '#CC3333',
    at: [titleBlock.x + titleBlock.w / 2, titleBlock.y + titleBlock.h + 1.5],
    text: 'PRELIMINARY',
    height: 4.5,
    anchor: 'center',
    angle: 0,
  };
  return {
    ...scene,
    items: [...scene.items, stamp],
  };
}
