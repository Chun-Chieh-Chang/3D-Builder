/**
 * ADR 0261, drawing rules V4 and V6: where a detail view goes. It goes in the free spot nearest the view it enlarges, with a clear line between them (no other
 * view in the way). Every number is worked out by hand from the synthetic sheets below: cells are 2 mm, what is drawn is kept `gap` clear.
 */
import { describe, expect, it } from 'vitest';
import { nearestFreeSpot, type Box, type SceneItem } from '@3db/drawing';

const area = { x: 0, y: 0, w: 200, h: 100 };
const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 });
const outline = (b: Box): SceneItem => ({ kind: 'polyline', style: 'visible', closed: true, points: [b.x0, b.y0, b.x1, b.y0, b.x1, b.y1, b.x0, b.y1] });
const GAP = 8;
const CELL = 2;
const inBox = (p: { x: number; y: number }, w: number, h: number) => box(p.x - w / 2, p.y - h / 2, p.x + w / 2, p.y + h / 2);
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe('the nearest free spot', () => {
  const parent = box(10, 20, 60, 80); // a view 50 × 60 at the left of the sheet

  it('beside the parent, as near as the gap allows, level with it', () => {
    // a 40 × 40 detail: its box starts a gap (8 mm, a whole number of 2 mm cells further: 10) right of the parent's edge at 60, so its middle is at 60 + 10 + 20 = 90,
    // level with the parent's middle (y 50)
    const spot = nearestFreeSpot({ items: [outline(parent)], occupied: [parent], parent, area, footprint: { w: 40, h: 40 }, gap: GAP });
    expect(spot).not.toBeNull();
    expect(Math.abs(spot!.at[0] - 90)).toBeLessThanOrEqual(CELL + 1e-9);
    expect(Math.abs(spot!.at[1] - 50)).toBeLessThanOrEqual(CELL + 1e-9);
    expect(spot!.distance).toBeGreaterThanOrEqual(GAP - 1e-9);
    expect(spot!.distance).toBeLessThanOrEqual(GAP + CELL + 1e-9);
    expect(spot!.blocked).toBe(false);
  });

  it('never on what is drawn or on another view\'s box, whatever is nearer', () => {
    const other = box(66, 10, 120, 90); // a view right beside the parent, where the nearest spot would be
    const spot = nearestFreeSpot({ items: [outline(parent), outline(other)], occupied: [parent, other], parent, area, footprint: { w: 40, h: 40 }, gap: GAP })!;
    const foot = inBox({ x: spot.at[0], y: spot.at[1] }, 40, 40);
    expect(overlaps(foot, parent)).toBe(false);
    expect(overlaps(foot, other)).toBe(false);
    // and it keeps the gap from both
    expect(foot.x0 >= other.x1 + GAP - 1e-9 || foot.x1 <= parent.x0 - GAP + 1e-9 || foot.y0 >= 90 + GAP - 1e-9 || foot.y1 <= 10 - GAP + 1e-9).toBe(true);
  });

  it('inside the area of the sheet', () => {
    const spot = nearestFreeSpot({ items: [outline(parent)], occupied: [parent], parent, area, footprint: { w: 40, h: 40 }, gap: GAP })!;
    const foot = inBox({ x: spot.at[0], y: spot.at[1] }, 40, 40);
    expect(foot.x0).toBeGreaterThanOrEqual(area.x - 1e-9);
    expect(foot.y0).toBeGreaterThanOrEqual(area.y - 1e-9);
    expect(foot.x1).toBeLessThanOrEqual(area.x + area.w + 1e-9);
    expect(foot.y1).toBeLessThanOrEqual(area.y + area.h + 1e-9);
  });

  it('null when nothing of that size is free', () => {
    const wall = box(0, 0, 200, 100); // one view as big as the area
    expect(nearestFreeSpot({ items: [outline(wall)], occupied: [wall], parent: wall, area, footprint: { w: 40, h: 40 }, gap: GAP })).toBeNull();
    // and a footprint larger than the area itself
    expect(nearestFreeSpot({ items: [], occupied: [], parent, area, footprint: { w: 300, h: 40 }, gap: GAP })).toBeNull();
  });

  it('says so when another view lies between the spot and the parent', () => {
    // the parent shut in on three sides by the area's edge and two views, and a view of 12 mm on its right: the only room left is beyond that view
    const p = box(10, 20, 60, 80);
    const wall = box(62, 0, 74, 100); // a narrow view the whole height of the area, right beside the parent
    const spot = nearestFreeSpot({ items: [outline(p), outline(wall)], occupied: [p, wall], parent: p, area, footprint: { w: 40, h: 40 }, gap: GAP })!;
    expect(spot.at[0]).toBeGreaterThan(74);
    expect(spot.blocked).toBe(true);
  });

  it('a spot with a clear line wins over a blocked one as near', () => {
    // The parent (100..140 × 30..70) stands in a ring of views, closed on three sides and open at the top between x 110 and 130. Beyond the ring there are spots
    // on every side, all of them 16 mm from the parent (the ring is 8 mm thick and the gap 8): the ones above the opening look straight at the parent, the
    // others have a ring piece in the way. A 20 × 20 detail goes above the opening.
    const tall = { x: 0, y: 0, w: 200, h: 200 };
    const p = box(100, 30, 140, 70);
    const ring = [box(90, 22, 150, 30), box(90, 70, 110, 78), box(130, 70, 150, 78), box(92, 30, 100, 70), box(140, 30, 148, 70)];
    const spot = nearestFreeSpot({ items: [outline(p), ...ring.map(outline)], occupied: [p, ...ring], parent: p, area: tall, footprint: { w: 20, h: 20 }, gap: GAP })!;
    expect(spot.blocked).toBe(false);
    expect(spot.at[0]).toBeGreaterThanOrEqual(110 - 1e-9);
    expect(spot.at[0]).toBeLessThanOrEqual(130 + 1e-9);
    expect(spot.at[1]).toBeGreaterThan(78);
    expect(spot.distance).toBeGreaterThanOrEqual(16 - 1e-9);
    expect(spot.distance).toBeLessThanOrEqual(16 + CELL + 1e-9);
  });
});
