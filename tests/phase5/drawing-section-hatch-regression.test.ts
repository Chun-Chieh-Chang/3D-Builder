import { beforeAll, expect, it } from 'vitest';
import { Kernel, type Frame, type ShapeId, type ProjectedView } from '@3db/kernel';
import { hatch } from '@3db/drawing';
let kernel: Kernel;
beforeAll(async () => { kernel = await Kernel.load(); });
const frame: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const solid = (pts: [number, number][]): ShapeId => kernel.extrude(frame, [{ outer: pts.map((a, i) => ({ kind: 'line' as const, a, b: pts[(i + 1) % pts.length]!, source: 'e' + i })), holes: [] }], [0, 0, 12]).shape;
for (const kind of ['straight', 'stepped', 'aligned', 'local'] as const) {
  it(`${kind}: does not hatch an uncut coplanar face adjoining a newly cut face`, () => {
    const shape = solid([[0, 0], [40, 0], [40, 5], [20, 5], [20, 30], [0, 30]]);
    try {
      expect(kernel.isValid(shape)).toBe(true);
      expect(kernel.massProps(shape).volume).toBeCloseTo(8400, 6);
      let view: ProjectedView;
      if (kind === 'straight') view = kernel.sectionView(shape, { origin: [0, 5, 0], normal: [0, 1, 0] }, [0, 0, 1]);
      else if (kind === 'local') view = kernel.sectionViewLocal(shape, [[0, 30, 0], [30, 30, 0], [30, 30, 12], [0, 30, 12], [0, 30, 0]], 25, { origin: [0, 30, 0], normal: [0, 1, 0] }, [0, 0, 1]);
      else view = kernel.sectionViewPath(shape, { normal: [0, 1, 0], path: kind === 'aligned' ? [[-5, 5, 0], [20, 5, 0], [45, 30, 0]] : [[-5, 5, 0], [20, 5, 0], [20, 10, 0], [45, 10, 0]], ...(kind === 'aligned' ? { aligned: true } : {}) }, [0, 0, 1]);
      const lines = hatch(view.cut!, 0.5, 0);
      expect(lines.length).toBeGreaterThan(0);
      // Projection x=-X, y=Z. X=20..40 is an original, uncut face at Y=5.
      expect(lines.every(l => l[0]! >= -20 - 1e-6 && l[2]! >= -20 - 1e-6), JSON.stringify(view.cut)).toBe(true);
      const area = lines.reduce((a, l) => a + Math.abs(l[2]! - l[0]!) * 0.5, 0);
      expect(area).toBeCloseTo(20 * 12, 6);
    } finally { kernel.release(shape); }
  });
}
