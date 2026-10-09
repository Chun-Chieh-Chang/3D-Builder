import { isDerived, type DrawingDoc, type DrawingView, type Id, type Scale, type ViewFeature } from '@3db/model';
import type { ElementsResult } from './dimension';
import type { ViewBom } from './bomTable';
import { STANDARD_SCALES, type ViewLines } from './layout';
import { buildScene, sheetItems, type SceneItem } from './scene';
import { sheetMetrics } from './sheet';

/** How wide a text is, as the dimension code and the overlap check reckon it (a Chinese character is wider than a letter). */
const widthOf = (text: string, height: number) => [...text].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 1.4 : 0.62) * height, 0);

/** The box round what a scene draws (lines, and texts as wide as they would be), or null when it draws nothing. */
export function itemsBounds(items: readonly SceneItem[]): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const take = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  for (const i of items) {
    if (i.kind === 'polyline') {
      for (let k = 0; k + 1 < i.points.length; k += 2) take(i.points[k]!, i.points[k + 1]!);
      continue;
    }
    const w = widthOf(i.text, i.height);
    // a turned text is taken as a square of its longer side, so that it fits whichever way it runs
    if (i.angle) {
      const s = Math.max(w, i.height);
      take(i.at[0] - s, i.at[1] - s);
      take(i.at[0] + s, i.at[1] + s);
      continue;
    }
    const left = i.anchor === 'center' ? i.at[0] - w / 2 : i.anchor === 'right' ? i.at[0] - w : i.at[0];
    take(left, i.at[1]);
    take(left + w, i.at[1] + i.height);
  }
  return x0 <= x1 ? { x0, y0, x1, y1 } : null;
}

export interface Fit {
  scale: Scale;
  /** Where the arrangement has to be moved to be in the middle of the area with what is drawn on it; null: where the layout puts it is the middle. */
  shift: [number, number] | null;
}

/**
 * 「最適比例」 (C16.1): the largest standard scale at which what the views that take the sheet's scale draw fits the area of the sheet, with what is drawn on them (the
 * dimensions, the centre marks, the labels of sections), not only their boxes; and where the arrangement has to be shifted to be in the middle of the area with all that.
 * Dimension lines are a fixed distance from the views on the sheet, so they take as much room at a small scale as at a large one: the best scale is smaller than the
 * one for the boxes alone as soon as there are any. 1:100 when none fits. Null when no view takes the sheet's scale.
 */
export function fitViews(
  doc: DrawingDoc,
  lines: ReadonlyMap<Id, ViewLines | null>,
  elements: ReadonlyMap<Id, ElementsResult> = new Map(),
  features: ReadonlyMap<Id, readonly ViewFeature[]> = new Map(),
  boms: ReadonlyMap<Id, ViewBom> = new Map(),
): Fit | null {
  const byId = new Map(doc.views.map((v) => [v.id, v]));
  /** A view that is laid out with the others and takes the sheet's scale, and so is every view it hangs on. */
  const auto = (v: DrawingView, depth = 0): boolean => {
    if (v.at || v.scale) return false;
    if (!isDerived(v)) return true;
    const parent = byId.get(v.parent);
    return !!parent && depth < 64 && auto(parent, depth + 1);
  };
  const views = doc.views.filter((v) => auto(v));
  if (views.length === 0) return null;
  const ids = new Set(views.map((v) => v.id));
  // only these views, their dimensions and no tables (they sit at the corner of the sheet, not among the views), where the arrangement is centred
  const own: DrawingDoc = { ...doc, views, dimensions: (doc.dimensions ?? []).filter((d) => ids.has(d.view)), tables: [], sheet: { ...doc.sheet, shift: undefined } };
  const skip = sheetItems(own).length;
  const area = sheetMetrics(doc.sheet).area;
  const fits = (scale: Scale) => {
    const { scene } = buildScene({ ...own, sheet: { ...own.sheet, scale } }, lines, elements, features, boms);
    const box = itemsBounds(scene.items.slice(skip));
    return box && box.x1 - box.x0 <= area.w + 1e-9 && box.y1 - box.y0 <= area.h + 1e-9 ? box : null;
  };
  for (const scale of [...STANDARD_SCALES, [1, 100] as Scale]) {
    const box = fits(scale);
    if (!box) continue;
    const dx = area.x + area.w / 2 - (box.x0 + box.x1) / 2;
    const dy = area.y + area.h / 2 - (box.y0 + box.y1) / 2;
    const r = (n: number) => Math.round(n * 100) / 100;
    return { scale, shift: Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05 ? null : [r(dx), r(dy)] };
  }
  return { scale: [1, 100], shift: null };
}
