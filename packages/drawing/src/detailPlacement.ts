import { itemsBounds } from './fit';
import type { SceneItem } from './scene';
import type { Rect } from './sheet';
import type { Box } from './layoutMetrics';

/**
 * Where a detail view goes (ADR 0261, drawing rules V4 and V6): in the free spot nearest the view it enlarges, with a clear line between the two. A detail put
 * in "the largest free place" ends up wherever the sheet has room, behind other views, far from what it is a detail of.
 */

export interface FreeSpotInput {
  /** What is drawn on the page: lines and texts, each kept `gap` clear. */
  items: readonly SceneItem[];
  /** Boxes that are taken whole, each kept `gap` clear: the boxes of the views (a view has empty space inside its box where no line is). */
  occupied: readonly Box[];
  /** The view the detail is of. */
  parent: Box;
  /** Where the detail may go: the sheet's area. */
  area: Rect;
  /** The room the detail needs: its circle and what is drawn for it. */
  footprint: { w: number; h: number };
  gap: number;
}

export interface FreeSpot {
  /** The middle of the footprint on the sheet. */
  at: [number, number];
  /** The distance between the footprint's box and the parent's box (mm). */
  distance: number;
  /** A view other than the parent lies on the line from the spot to the parent's middle. */
  blocked: boolean;
}

const CELL = 2;
/** Added to the distance of a spot with a view in the way, so that any spot with a clear line is preferred to it: further than a sheet is wide. */
const BLOCKED_PENALTY = 1e4;
/** The weight of the distance between the middles against the distance between the boxes: only to tell equally near spots apart (a cell is 2 mm, a sheet 1200 mm at most). */
const LEVEL = 1e-3;

/** Whether the segment from p to q passes through the inside of the box (Liang–Barsky). */
function crosses(p: readonly [number, number], q: readonly [number, number], b: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const d = [q[0] - p[0], q[1] - p[1]];
  const edges: [number, number][] = [
    [-d[0]!, p[0] - b.x0],
    [d[0]!, b.x1 - p[0]],
    [-d[1]!, p[1] - b.y0],
    [d[1]!, b.y1 - p[1]],
  ];
  for (const [pk, qk] of edges) {
    if (pk === 0) {
      if (qk <= 0) return false;
    } else {
      const r = qk / pk;
      if (pk < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 >= t1) return false;
    }
  }
  return t1 - t0 > 1e-9;
}

const same = (a: Box, b: Box) => Math.abs(a.x0 - b.x0) < 1e-6 && Math.abs(a.y0 - b.y0) < 1e-6 && Math.abs(a.x1 - b.x1) < 1e-6 && Math.abs(a.y1 - b.y1) < 1e-6;

/**
 * The spot for a detail: every position of the footprint on a 2 mm grid that is inside the area and clear of what is drawn and of the views' boxes by `gap`,
 * the nearest to the parent (by the distance between the boxes), a spot with a clear line to the parent before any with a view in the way. Null when the footprint
 * fits nowhere.
 */
export function nearestFreeSpot(input: FreeSpotInput): FreeSpot | null {
  const { items, occupied, parent, area, footprint, gap } = input;
  const nx = Math.floor(area.w / CELL);
  const ny = Math.floor(area.h / CELL);
  const fw = Math.ceil(footprint.w / CELL);
  const fh = Math.ceil(footprint.h / CELL);
  if (nx < fw || ny < fh) return null;
  const used = new Uint8Array(nx * ny);
  const pad = Math.ceil(gap / CELL);
  const mark = (x0: number, y0: number, x1: number, y1: number) => {
    const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - area.x) / CELL) - pad);
    const i1 = Math.min(nx - 1, Math.floor((Math.max(x0, x1) - area.x) / CELL) + pad);
    const j0 = Math.max(0, Math.floor((Math.min(y0, y1) - area.y) / CELL) - pad);
    const j1 = Math.min(ny - 1, Math.floor((Math.max(y0, y1) - area.y) / CELL) + pad);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) used[j * nx + i] = 1;
  };
  for (const it of items) {
    if (it.kind === 'polyline') {
      for (let k = 0; k + 3 < it.points.length; k += 2) {
        const [ax, ay, bx, by] = [it.points[k]!, it.points[k + 1]!, it.points[k + 2]!, it.points[k + 3]!];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / CELL));
        for (let t = 0; t <= n; t++) {
          const x = ax + ((bx - ax) * t) / n;
          const y = ay + ((by - ay) * t) / n;
          mark(x, y, x, y);
        }
      }
    } else {
      const b = itemsBounds([it]);
      if (b) mark(b.x0, b.y0, b.x1, b.y1);
    }
  }
  for (const b of occupied) mark(b.x0, b.y0, b.x1, b.y1);

  // a summed-area table: how many used cells a block of cells holds, in one lookup
  const w1 = nx + 1;
  const sat = new Int32Array(w1 * (ny + 1));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) sat[(j + 1) * w1 + i + 1] = used[j * nx + i]! + sat[j * w1 + i + 1]! + sat[(j + 1) * w1 + i]! - sat[j * w1 + i]!;
  const held = (i: number, j: number) => sat[(j + fh) * w1 + i + fw]! - sat[j * w1 + i + fw]! - sat[(j + fh) * w1 + i]! + sat[j * w1 + i]!;

  const obstacles = occupied.filter((o) => !same(o, parent));
  const pc: [number, number] = [(parent.x0 + parent.x1) / 2, (parent.y0 + parent.y1) / 2];
  let best: (FreeSpot & { score: number }) | null = null;
  for (let j = 0; j + fh <= ny; j++)
    for (let i = 0; i + fw <= nx; i++) {
      if (held(i, j) !== 0) continue;
      const x0 = area.x + i * CELL;
      const y0 = area.y + j * CELL;
      const x1 = x0 + fw * CELL;
      const y1 = y0 + fh * CELL;
      const dx = Math.max(parent.x0 - x1, x0 - parent.x1, 0);
      const dy = Math.max(parent.y0 - y1, y0 - parent.y1, 0);
      const distance = Math.hypot(dx, dy);
      // a spot that cannot beat the best even with a clear line is not worth the test of the line
      if (best && distance > best.score) continue;
      const at: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2];
      const blocked = obstacles.some((o) => crosses(at, pc, o));
      // of spots equally near (all along the parent's side) the one whose middle is nearest the parent's: level with it, not in a corner of the free place
      const score = distance + (blocked ? BLOCKED_PENALTY : 0) + LEVEL * Math.hypot(at[0] - pc[0], at[1] - pc[1]);
      if (!best || score < best.score) best = { at, distance, blocked, score };
    }
  return best ? { at: best.at, distance: best.distance, blocked: best.blocked } : null;
}
