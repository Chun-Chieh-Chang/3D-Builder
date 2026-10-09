import { dxfEscape, TEXT_LAYER, toDxf } from './dxf';
import type { Scene } from './scene';

/**
 * The flat pattern of a sheet metal part as a DXF (C11.3, F3.1, ADR 0089): the outline on the layer OUTLINE as lines, arcs and circles (true ones, not polylines), the bend
 * lines on BEND (dashed) with a note beside each saying which way it bends, by how much and the radius, and a note of the thickness and K-factor; in millimetres, the lower
 * left corner of the pattern at the origin. It is written by the same writer as a drawing's DXF, so `readDxf` and `checkDxf` read it too.
 */

type P2 = [number, number];

/** What a flat pattern is as the DXF needs it (the report of `flatPattern`, which has more). */
export interface FlatDxfInput {
  outline: ({ kind: 'line'; a: P2; b: P2 } | { kind: 'arc'; c: P2; r: number; from: P2; to: P2; mid: P2 } | { kind: 'circle'; c: P2; r: number })[];
  bends: { a: P2; b: P2; angle: number; radius: number; direction: 'up' | 'down'; kFactor: number }[];
  min: P2;
  max: P2;
  width: number;
  height: number;
  thickness: number;
}

export const FLAT_OUTLINE_LAYER = 'OUTLINE';
export const FLAT_BEND_LAYER = 'BEND';

const deg = (r: number) => (r * 180) / Math.PI;
const norm = (d: number) => ((d % 360) + 360) % 360;
const round = (v: number, digits: number) => String(Math.round(v * 10 ** digits) / 10 ** digits);

export function flatPatternDxf(p: FlatDxfInput): string {
  const dx = -p.min[0];
  const dy = -p.min[1];
  const at = (q: P2): P2 => [q[0] + dx, q[1] + dy];
  const scene: Scene = { width: p.width, height: p.height, items: [] };
  return toDxf(scene, {
    layers: [
      { name: FLAT_OUTLINE_LAYER, linetype: 'CONTINUOUS', weight: 25 },
      { name: FLAT_BEND_LAYER, linetype: 'DASHED', weight: 18 },
    ],
    entities: ({ entity, g, int, extent }) => {
      const text = (x: number, y: number, height: number, value: string, angle = 0, center = false) => {
        entity('TEXT', TEXT_LAYER, 'AcDbText');
        g(10, x).g(20, y).g(30, 0).g(40, height).g(1, dxfEscape(value));
        if (angle) g(50, angle);
        g(7, 'STANDARD');
        if (center) int(72, 1).g(11, x).g(21, y).g(31, 0);
        g(100, 'AcDbText');
        if (center) int(73, 0);
        extent(x, y);
        extent(x, y + height);
      };
      for (const s of p.outline) {
        if (s.kind === 'line') {
          const [a, b] = [at(s.a), at(s.b)];
          entity('LINE', FLAT_OUTLINE_LAYER, 'AcDbLine');
          g(10, a[0]).g(20, a[1]).g(30, 0).g(11, b[0]).g(21, b[1]).g(31, 0);
          extent(a[0], a[1]);
          extent(b[0], b[1]);
        } else if (s.kind === 'circle') {
          const c = at(s.c);
          entity('CIRCLE', FLAT_OUTLINE_LAYER, 'AcDbCircle');
          g(10, c[0]).g(20, c[1]).g(30, 0).g(40, s.r);
        } else {
          // a DXF arc always runs counter-clockwise from its start to its end: when the arc as the pattern has it goes the other way round, the ends change places
          const c = at(s.c);
          const ang = (q: P2) => deg(Math.atan2(q[1] - s.c[1], q[0] - s.c[0]));
          const [a0, am, a1] = [ang(s.from), ang(s.mid), ang(s.to)];
          const ccw = norm(am - a0) < norm(a1 - a0);
          entity('ARC', FLAT_OUTLINE_LAYER, 'AcDbCircle');
          g(10, c[0]).g(20, c[1]).g(30, 0).g(40, s.r).g(100, 'AcDbArc').g(50, norm(ccw ? a0 : a1)).g(51, norm(ccw ? a1 : a0));
        }
      }
      for (const b of p.bends) {
        const [a, e] = [at(b.a), at(b.b)];
        entity('LINE', FLAT_BEND_LAYER, 'AcDbLine');
        g(10, a[0]).g(20, a[1]).g(30, 0).g(11, e[0]).g(21, e[1]).g(31, 0);
        extent(a[0], a[1]);
        extent(e[0], e[1]);
        // the note beside the line, along it
        const len = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
        const n: P2 = [-(e[1] - a[1]) / len, (e[0] - a[0]) / len];
        const mid: P2 = [(a[0] + e[0]) / 2 + n[0] * 1.5, (a[1] + e[1]) / 2 + n[1] * 1.5];
        // along the line, but never upside down: a line that runs to the left (over 90 degrees up to 270) is read from the other end
        const along = norm(deg(Math.atan2(e[1] - a[1], e[0] - a[0])));
        const upright = along > 90 + 1e-9 && along <= 270 + 1e-9 ? norm(along - 180) : along;
        text(mid[0], mid[1], 2.5, `${b.direction === 'up' ? 'UP' : 'DOWN'} ${round(deg(b.angle), 1)}\u00B0 R${round(b.radius, 3)}`, upright, true);
      }
      text(0, -5, 2.5, `T=${round(p.thickness, 3)}  K=${round(p.bends[0]?.kFactor ?? 0.5, 3)}`);
    },
  });
}
