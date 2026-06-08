/**
 * Geometry utility functions for 2D sketch calculations.
 */

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Projects a point p onto a line segment defined by a and b.
 * Returns the projected point on the infinite line.
 */
export function projectPointToLine(p: Point2D, a: Point2D, b: Point2D): Point2D {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return { x: a.x, y: a.y };

  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  return {
    x: a.x + t * dx,
    y: a.y + t * dy,
  };
}

/**
 * Returns the scalar t parameter of the projection of p onto line ab.
 */
export function getLineProjectionT(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return 0;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
}

/**
 * Calculates the perpendicular distance from point p to line ab.
 */
export function pointToLineDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const proj = projectPointToLine(p, a, b);
  const dx = p.x - proj.x;
  const dy = p.y - proj.y;
  return Math.sqrt(dx * dx + dy * dy);
}
