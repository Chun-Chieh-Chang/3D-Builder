/** Screen-space geometry for directional window/crossing selection. */
export type ScreenPoint = readonly [number, number];
export interface SelectionRect { left: number; top: number; right: number; bottom: number; crossing: boolean }
export function selectionRect(a: ScreenPoint, b: ScreenPoint): SelectionRect {
  if (![...a, ...b].every(Number.isFinite)) throw new Error('Selection coordinates must be finite');
  return { left: Math.min(a[0], b[0]), right: Math.max(a[0], b[0]), top: Math.min(a[1], b[1]), bottom: Math.max(a[1], b[1]), crossing: b[0] < a[0] };
}
export const inSelectionRect = (p: ScreenPoint, r: SelectionRect): boolean => p[0] >= r.left && p[0] <= r.right && p[1] >= r.top && p[1] <= r.bottom;

/** Liang-Barsky segment clipping, including tangency and zero-length segments. */
export function segmentInRect(a: ScreenPoint, b: ScreenPoint, r: SelectionRect): boolean {
  let lo = 0, hi = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0]-r.left], [dx, r.right-a[0]], [-dy, a[1]-r.top], [dy, r.bottom-a[1]]]) {
    if (p === 0) { if (q! < 0) return false; continue; }
    const t = q! / p!;
    if (p! < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    if (lo > hi) return false;
  }
  return true;
}
function insidePolygon(p: ScreenPoint, polygon: readonly ScreenPoint[]): boolean {
  let inside = false;
  for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i]!,b=polygon[j]!;
    if ((a[1]>p[1])!==(b[1]>p[1]) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
/** Actual polygon intersection, not a bounding-box proxy. A rectangle wholly inside a face crosses it. */
export function polygonInRect(polygon: readonly ScreenPoint[], r: SelectionRect): boolean {
  if (!polygon.length) return false;
  if (!r.crossing) return polygon.every(p=>inSelectionRect(p,r));
  if (polygon.some(p=>inSelectionRect(p,r))) return true;
  if (polygon.some((p,i)=>segmentInRect(p,polygon[(i+1)%polygon.length]!,r))) return true;
  return polygon.length>=3 && insidePolygon([r.left,r.top],polygon);
}
export const geometryInRect = (polygons: readonly (readonly ScreenPoint[])[], rect: SelectionRect): boolean =>
  polygons.length>0 && (rect.crossing ? polygons.some(p=>polygonInRect(p,rect)) : polygons.every(p=>polygonInRect(p,rect)));
