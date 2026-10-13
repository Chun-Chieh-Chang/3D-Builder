import { t } from '@3db/i18n';
import { constraintRefs, isDimension, isPlain, SKETCH_ORIGIN, type DimensionConstraint, type Id, type PlaneFrame, type SketchConstraint, type SketchFeature } from '@3db/model';
import { add, dimensionText, layoutDimension, measuredText, mid, polar, sample, type Geometry } from '@3db/sketch/interact';
import type { EntityStatus, P2, SolvedGeometry } from '@3db/sketch';
import type { OverlayCurve, OverlayLabel, OverlayPoint, SketchOverlay } from '@3db/render';
import { RELATION_LABEL } from '../strings';
import type { SketchSolvePayload } from '../worker/protocol';
import type { ControllerView, PreviewShape } from './controller';

/** SolidWorks sketch colours: black = fully defined, blue = under-defined, red = over-defined. */
export const SKETCH_COLORS = {
  fully: 0x1d232b,
  under: 0x1c7ed6,
  over: 0xe03131,
  selected: 0x0ca678,
  hover: 0xf08c00,
  preview: 0x74b0e8,
  guide: 0x868e96,
  dimension: 0x3d4650,
  origin: 0xe03131,
  reference: 0x7048e8,
} as const;

const RELATION_SYMBOL: Record<Exclude<SketchConstraint['type'], 'distance' | 'distanceX' | 'distanceY' | 'radius' | 'diameter' | 'arcLength' | 'angle'>, string> = {
  coincident: '⊙',
  horizontal: '―',
  vertical: '│',
  collinear: '≡',
  parallel: '∥',
  perpendicular: '⊥',
  tangent: '◠',
  concentric: '◎',
  coradial: '◉',
  intersection: '✕',
  equal: '=',
  midpoint: '◇',
  pointOnCurve: '⊙',
  symmetric: '⇋',
  fix: '⚓',
};

export interface OverlayOptions {
  showRelations: boolean;
  /** What each dimension's expression comes to (mm, radians); shown in place of the expression, with a Σ (SolidWorks' mark for a dimension driven by an equation). */
  values?: ReadonlyMap<Id, number>;
  /** Dimension label next to the cursor while the smart-dimension tool is placing one. */
  dimensionPreview: { text: string; at: P2 } | null;
  /** Decimals a dimension worked out from an expression shows (B8.4). */
  precision?: number;
}

const shown = (v: number, decimals = 4) => String(Math.round(v * 10 ** decimals) / 10 ** decimals);

/** A dimension's text: as typed when it is a plain number, else its value marked with Σ. */
function dimensionLabel(c: DimensionConstraint, value: number | undefined, measured: string | undefined, precision = 4): string {
  if (c.driving === false) return dimensionText(c, measured); // a reference: what is measured now, in parentheses
  if (value === undefined || isPlain(c.value)) return dimensionText(c);
  return 'Σ' + dimensionText({ ...c, value: c.type === 'angle' ? shown((value * 180) / Math.PI, precision) : shown(value, precision) });
}

function statusColor(s: EntityStatus | undefined): number {
  return s === 'fully' ? SKETCH_COLORS.fully : s === 'over' ? SKETCH_COLORS.over : SKETCH_COLORS.under;
}

/** Where a relation symbol is shown: near the first entity it refers to. */
function anchorOf(geometry: Geometry, id: Id): P2 | null {
  if (id === SKETCH_ORIGIN) return [0, 0];
  const g = geometry.get(id);
  if (!g) return null;
  switch (g.type) {
    case 'point':
      return g.p;
    case 'line':
      return mid(g.a, g.b);
    case 'circle':
      return polar(g.c, g.r, -Math.PI / 4);
    case 'arc': {
      const tau = 2 * Math.PI;
      const sweep = (((g.a1 - g.a0) % tau) + tau) % tau;
      return polar(g.c, g.r, g.a0 + sweep / 2);
    }
  }
}

function previewCurves(shapes: PreviewShape[], px: number): OverlayCurve[] {
  return shapes.map((s): OverlayCurve => {
    switch (s.kind) {
      case 'line':
        return { points: [s.a, s.b], color: SKETCH_COLORS.preview, dashed: s.construction ?? false };
      case 'box':
        return { points: [s.a, [s.b[0], s.a[1]], s.b, [s.a[0], s.b[1]], s.a], color: SKETCH_COLORS.dimension, dashed: true };
      case 'circle':
        return { points: sample({ type: 'circle', c: s.c, r: s.r, center: '', construction: false }, px), color: SKETCH_COLORS.preview };
      case 'arc':
        return { points: sample({ type: 'arc', c: s.c, r: s.r, a0: s.a0, a1: s.a1, center: '', start: '', end: '', construction: false }, px), color: SKETCH_COLORS.preview };
    }
  });
}

/**
 * The sketch being edited as a 2D overlay (C1.31 colours, C1.27 relation symbols, D6.2 dimensions,
 * D5.2 highlights and the tool's preview). Pure: the same inputs always draw the same picture.
 */
export function buildOverlay(frame: PlaneFrame, sketch: SketchFeature, solve: SketchSolvePayload | null, view: ControllerView, px: number, options: OverlayOptions): SketchOverlay {
  const geometry: Geometry = solve?.geometry ?? new Map<Id, SolvedGeometry>();
  const selected = new Set(view.selection);
  const highlighted = new Set([...(view.hover ? [view.hover] : []), ...view.picks]);
  const over = new Set([...(solve?.conflicting ?? []), ...(solve?.redundant ?? [])]);
  const fallback: EntityStatus | undefined = solve?.status === 'fully' ? 'fully' : undefined;
  // what follows the model (C1.18) is drawn in its own colour: it is the model's, not the sketch's, to change
  const followed = new Set(sketch.entities.filter((e) => (e.type === 'point' ? e.pierce : e.ref)).map((e) => e.id));
  const colorOf = (id: Id) =>
    selected.has(id) ? SKETCH_COLORS.selected : highlighted.has(id) ? SKETCH_COLORS.hover : followed.has(id) ? SKETCH_COLORS.reference : statusColor(solve?.entityStatus?.get(id) ?? fallback);

  const curves: OverlayCurve[] = [];
  const points: OverlayPoint[] = [];
  const labels: OverlayLabel[] = [];

  // origin (C3.1): short red axes
  curves.push({ points: [[0, 0], [14 * px, 0]], color: SKETCH_COLORS.origin }, { points: [[0, 0], [0, 14 * px]], color: SKETCH_COLORS.origin });
  points.push({ p: [0, 0], color: highlighted.has(SKETCH_ORIGIN) ? SKETCH_COLORS.hover : SKETCH_COLORS.origin, size: 6 });

  for (const [id, g] of geometry) {
    if (g.type === 'point') points.push({ p: g.p, color: colorOf(id), size: selected.has(id) || highlighted.has(id) ? 8 : 5 });
    else curves.push({ points: sample(g, px), color: colorOf(id), dashed: g.construction });
  }

  curves.push(...previewCurves(view.preview, px));
  if (view.snap && view.snap.kind !== 'free') points.push({ p: view.snap.p, color: SKETCH_COLORS.hover, size: 9 });
  // the model edge the cursor is on (D5.3b), lit like a sketch element under the cursor
  if (view.snap?.kind === 'model') {
    const q = view.snap.item.projected;
    const shape: SolvedGeometry =
      q.kind === 'line'
        ? { type: 'line', a: q.a, b: q.b, p1: '', p2: '', construction: false }
        : q.kind === 'circle'
          ? { type: 'circle', c: q.c, r: q.r, center: '', construction: false }
          : { type: 'arc', c: q.c, r: q.r, a0: Math.atan2(q.start[1] - q.c[1], q.start[0] - q.c[0]), a1: Math.atan2(q.end[1] - q.c[1], q.end[0] - q.c[0]), center: '', start: '', end: '', construction: false };
    curves.push({ points: sample(shape, px), color: SKETCH_COLORS.hover });
  }
  // the dotted lines to the points the cursor lines up with (D5.3a)
  if (view.snap?.kind === 'free' && view.snap.align) {
    for (const target of [view.snap.align.h, view.snap.align.v]) {
      if (!target) continue;
      curves.push({ points: [target.p, view.snap.p], color: SKETCH_COLORS.guide, dashed: true });
      points.push({ p: target.p, color: SKETCH_COLORS.guide, size: 7 });
    }
  }
  // on the extension of a line: the dotted extension from its end to the point
  if (view.snap?.kind === 'extension') curves.push({ points: [view.snap.from, view.snap.p], color: SKETCH_COLORS.guide, dashed: true });
  // a collinear line is shown as the dotted extension of the line it continues
  if (view.snap && view.inferLine?.kind === 'collinear') {
    const ref = geometry.get(view.inferLine.line);
    if (ref?.type === 'line') {
      const far = Math.hypot(ref.a[0] - view.snap.p[0], ref.a[1] - view.snap.p[1]) > Math.hypot(ref.b[0] - view.snap.p[0], ref.b[1] - view.snap.p[1]) ? ref.a : ref.b;
      curves.push({ points: [far, view.snap.p], color: SKETCH_COLORS.guide, dashed: true });
    }
  }
  if (view.cursor && view.inference) {
    labels.push({ key: 'inference', p: add(view.cursor, [14 * px, -14 * px]), text: view.inference, className: 'hint' });
  }
  if (options.dimensionPreview) {
    labels.push({ key: 'dimension-preview', p: add(options.dimensionPreview.at, [16 * px, 16 * px]), text: options.dimensionPreview.text, className: 'dimension preview' });
  }

  // dimensions (D6.2) laid out outside the geometry
  const pts = [...geometry.values()].flatMap((g) => (g.type === 'point' ? [g.p] : []));
  const center: P2 = pts.length ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length] : [0, 0];
  for (const c of sketch.constraints) {
    if (!isDimension(c)) continue;
    const layout = layoutDimension(c, geometry, px, center);
    if (!layout) continue;
    const state = selected.has(c.id) ? 'selected' : over.has(c.id) ? 'over' : '';
    const color = state === 'selected' ? SKETCH_COLORS.selected : state === 'over' ? SKETCH_COLORS.over : SKETCH_COLORS.dimension;
    const text = c.labelPosition ?? layout.text;
    for (const [a, b] of layout.segments) curves.push({ points: [a, b], color });
    // A relocated text keeps the automatic dimension line attached to its geometry and gains a leader to its chosen position.
    if (c.labelPosition) curves.push({ points: [layout.text, text], color });
    labels.push({ key: `dim:${c.id}`, p: text, text: dimensionLabel(c, options.values?.get(c.id), measuredText(c, geometry), options.precision), className: `dimension ${state}${c.driving === false ? ' driven' : ''}`, interactive: true, title: c.label ?? t('overlay.editDimension') });
  }

  // relation symbols (C1.27), stacked when several sit at the same place
  if (options.showRelations) {
    const stack = new Map<string, number>();
    for (const c of sketch.constraints) {
      if (isDimension(c)) continue;
      const first = constraintRefs(c)[0];
      const anchor = first === undefined ? null : anchorOf(geometry, first);
      if (!anchor) continue;
      const key = `${anchor[0].toFixed(3)},${anchor[1].toFixed(3)}`;
      const n = stack.get(key) ?? 0;
      stack.set(key, n + 1);
      const state = selected.has(c.id) ? 'selected' : over.has(c.id) ? 'over' : '';
      labels.push({
        key: `rel:${c.id}`,
        p: add(anchor, [(12 + 15 * n) * px, 12 * px]),
        text: RELATION_SYMBOL[c.type],
        className: `relation ${state}`,
        interactive: true,
        title: t('overlay.relationTip', { name: RELATION_LABEL[c.type] }),
      });
    }
  }

  return { frame, curves, points, labels };
}
