import type { Vec3 } from '@3db/model';

export interface VertexAnchor {
  name: string;
  point: Vec3;
}

/** Bind a picked point to a real model vertex only when it is within the snap tolerance. */
export function captureVertexAnchor(names: readonly string[], points: ArrayLike<number>, at: Vec3, tolerance = 0.05): VertexAnchor | null {
  let best = -1;
  let distance = tolerance;
  for (let i = 0; i < names.length; i++) {
    const point: Vec3 = [points[i * 3] ?? NaN, points[i * 3 + 1] ?? NaN, points[i * 3 + 2] ?? NaN];
    const d = Math.hypot(point[0] - at[0], point[1] - at[1], point[2] - at[2]);
    if (d <= distance) {
      best = i;
      distance = d;
    }
  }
  if (best < 0) return null;
  return { name: names[best]!, point: [points[best * 3]!, points[best * 3 + 1]!, points[best * 3 + 2]!] };
}

/** Resolve only the same persistent topology name; a deleted vertex never binds to a neighbour by index. */
export function resolveVertexAnchor(names: readonly string[], points: ArrayLike<number>, name: string): Vec3 | null {
  const index = names.indexOf(name);
  if (index < 0 || points.length < index * 3 + 3) return null;
  return [points[index * 3]!, points[index * 3 + 1]!, points[index * 3 + 2]!];
}
