import type { Region } from '@3db/kernel';
import { TEAR_RELIEF_WIDTH, type ReliefShape } from '@3db/model';

/**
 * The notch of a relief beside an edge flange (C11.4), seen from above the sheet: `x0` to `x1` along the edge, `deep` in from the edge (past the bend start). A rectangle and a
 * tear (a slit `TEAR_RELIEF_WIDTH` wide) are cut with a strip through the thickness; an obround has a half circle at its closed end, so it is cut with a profile of its own.
 */
export interface Notch {
  x0: number;
  x1: number;
  deep: number;
  shape: ReliefShape;
}

/** The notch of a relief for a flange that starts at `edgeX` and stops short by `inset` at the start (`atStart`) or the end of the edge; the width is cut back to the inset. */
export function notchOf(shape: ReliefShape, width: number, depth: number, trim: number, inset: number, edgeX: number, atStart: boolean): Notch {
  const w = shape === 'tear' ? Math.min(TEAR_RELIEF_WIDTH, inset) : Math.min(width, inset);
  return { x0: atStart ? edgeX - w : edgeX, x1: atStart ? edgeX : edgeX + w, deep: trim + depth, shape };
}

/** Whether the closed end of an obround notch fits: the depth is at least half of the width. */
export const obroundFits = (n: Notch): boolean => n.deep + 1e-9 >= (n.x1 - n.x0) / 2;

/**
 * The profile of an obround notch in the plane of the sheet: x along the edge, y into the sheet from 1 mm outside the edge (y = -1) to the bottom of the half circle (y = `deep`).
 * Walked counter-clockwise, as a region of the kernel is.
 */
export function obroundRegion(n: Notch, prefix: string): Region {
  const r = (n.x1 - n.x0) / 2;
  const cx = (n.x0 + n.x1) / 2;
  const yc = n.deep - r;
  const line = (a: [number, number], b: [number, number], source: string) => ({ kind: 'line' as const, a, b, source: `${prefix}.${source}` });
  return {
    outer: [
      line([n.x0, -1], [n.x1, -1], 'out'),
      line([n.x1, -1], [n.x1, yc], 's1'),
      { kind: 'arc' as const, c: [cx, yc] as [number, number], r, from: [n.x1, yc] as [number, number], to: [n.x0, yc] as [number, number], ccw: true, source: `${prefix}.end` },
      line([n.x0, yc], [n.x0, -1], 's0'),
    ],
    holes: [],
  };
}
