/** 正六角形草圖（對邊距 acrossFlats）：六點以 fix 固定，頂邊水平。面名為 `<extrude>:side:<sketch>.l0..l5`。 */
import type { SketchParts } from '../phase1/builders';

export function hexagon(id: string, acrossFlats: number): SketchParts {
  const R = acrossFlats / Math.sqrt(3);
  const pts = [0, 60, 120, 180, 240, 300].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return [R * Math.cos(a), R * Math.sin(a)] as [number, number];
  });
  return {
    entities: [
      ...pts.map(([x, y], i) => ({ id: `${id}p${i}`, type: 'point', x, y }) as const),
      ...[0, 1, 2, 3, 4, 5].map((i) => ({ id: `${id}l${i}`, type: 'line', p1: `${id}p${i}`, p2: `${id}p${(i + 1) % 6}` }) as const),
    ],
    constraints: pts.map((_, i) => ({ id: `${id}f${i}`, type: 'fix', point: `${id}p${i}` }) as const),
  };
}
