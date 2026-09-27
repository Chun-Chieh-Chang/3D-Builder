import { constraintRefs, isDimension, SKETCH_ORIGIN, type Id, type PlaneFrame, type SketchConstraint, type SketchFeature } from '@3db/model';
import { add, dimensionText, layoutDimension, mid, polar, sample, type Geometry } from '@3db/sketch/interact';
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
  dimension: 0x3d4650,
  origin: 0xe03131,
} as const;

const RELATION_SYMBOL: Record<Exclude<SketchConstraint['type'], 'distance' | 'distanceX' | 'distanceY' | 'radius' | 'diameter' | 'angle'>, string> = {
  coincident: '⊙',
  horizontal: '―',
  vertical: '│',
  collinear: '≡',
  parallel: '∥',
  perpendicular: '⊥',
  tangent: '◠',
  concentric: '◎',
  equal: '=',
  midpoint: '◇',
  pointOnCurve: '⊙',
  symmetric: '⇋',
  fix: '⚓',
};

export interface OverlayOptions {
  showRelations: boolean;
  /** Dimension label next to the cursor while the smart-dimension tool is placing one. */
  dimensionPreview: { text: string; at: P2 } | null;
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
  const colorOf = (id: Id) =>
    selected.has(id) ? SKETCH_COLORS.selected : highlighted.has(id) ? SKETCH_COLORS.hover : statusColor(solve?.entityStatus?.get(id) ?? fallback);

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
    for (const [a, b] of layout.segments) curves.push({ points: [a, b], color });
    labels.push({ key: `dim:${c.id}`, p: layout.text, text: dimensionText(c), className: `dimension ${state}`, interactive: true, title: c.label ?? '按兩下修改尺寸' });
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
        title: `${RELATION_LABEL[c.type]}（按一下選取，Delete 刪除）`,
      });
    }
  }

  return { frame, curves, points, labels };
}
