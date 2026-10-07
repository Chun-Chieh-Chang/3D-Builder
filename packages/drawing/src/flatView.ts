import { circlePolyline } from './geometry';
import type { FlatDxfInput } from './flatDxf';
import type { ViewLines } from './layout';

/**
 * The flat pattern of a sheet metal part as a view of a drawing (S-1, ADR 0106): its outline as lines (holes and rounded corners as polylines), the bend lines as chain lines,
 * at full size in the coordinates of the pattern, the lower left corner of its box at the origin. The same data as the DXF of the pattern (`FlatDxfInput`).
 */

type P2 = [number, number];

/** The points of an arc from `from` to `to` through `mid`, about `c`, as a polyline (a point every 5° at least). */
function arcPolyline(c: P2, r: number, from: P2, to: P2, mid: P2): number[] {
  const angle = (q: P2) => Math.atan2(q[1] - c[1], q[0] - c[0]);
  const a0 = angle(from);
  const am = angle(mid);
  const a1 = angle(to);
  const TAU = 2 * Math.PI;
  const wrap = (x: number) => ((x % TAU) + TAU) % TAU;
  // the way round that passes the middle point
  const ccw = wrap(am - a0) < wrap(a1 - a0);
  const sweep = ccw ? wrap(a1 - a0) : -wrap(a0 - a1);
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push(c[0] + r * Math.cos(a), c[1] + r * Math.sin(a));
  }
  return out;
}

export function flatViewLines(p: FlatDxfInput): ViewLines & { center: number[][] } {
  const at = (q: P2): P2 => [q[0] - p.min[0], q[1] - p.min[1]];
  const visible: number[][] = [];
  for (const s of p.outline) {
    if (s.kind === 'line') visible.push([...at(s.a), ...at(s.b)]);
    else if (s.kind === 'circle') {
      const ring = circlePolyline(at(s.c), s.r);
      visible.push([...ring, ring[0]!, ring[1]!]); // closed
    }
    else visible.push(arcPolyline(at(s.c), s.r, at(s.from), at(s.to), at(s.mid)));
  }
  const center = p.bends.map((b) => [...at(b.a), ...at(b.b)]);
  return { visible, hidden: [], center, box: { min: [0, 0], max: [p.width, p.height] } };
}
