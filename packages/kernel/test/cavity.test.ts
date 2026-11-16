import { beforeAll, expect, it } from 'vitest';
import { Kernel, KernelError, type Frame, type Region, type Vec3 } from '../src';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

function rectangle(x: number, y: number, width: number, height: number): Region {
  const points: [number, number][] = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
  return { outer: points.map((a, i) => ({ kind: 'line', a, b: points[(i + 1) % points.length]!, source: `e${i}` })), holes: [] };
}

it('integrates the connected volume of three ports and rejects missing or invalid end faces', () => {
  const xy: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
  const xz: Frame = { origin: [0, 13, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
  const prism = (frame: Frame, profile: Region, direction: Vec3) => kernel.extrude(frame, [profile], direction).shape;
  const envelope = prism(xy, rectangle(0, 0, 12, 12), [0, 0, 16]);
  const bore = prism({ ...xy, origin: [0, 0, -1] }, rectangle(4, 4, 4, 4), [0, 0, 18]);
  const branch = prism(xz, rectangle(5, 7, 2, 2), [0, -7, 0]);
  const through = kernel.boolean('cut', envelope, bore).shape;
  const tee = kernel.boolean('cut', through, branch).shape;
  try {
    const faces = kernel.topology(tee).faces;
    const end = (coordinate: 1 | 2, value: number) => faces.findIndex(({ geometry: g }) =>
      g?.type === 'plane' && Math.abs(g.origin[coordinate] - value) < 1e-8 && Math.abs(g.normal[coordinate]) > 0.99);
    const ports = [end(2, 0), end(2, 16), end(1, 12)];
    expect(ports.every((i) => i >= 0)).toBe(true);
    const expected = 4 * 4 * 16 + 2 * 2 * (12 - 8);
    const baseline = kernel.massProps(tee).volume;
    expect(kernel.cavityVolume(tee, ports)).toBeCloseTo(expected, 9);
    expect(kernel.cavityVolume(tee, [...ports, ports[0]!])).toBeCloseTo(expected, 9);
    for (const index of ports) expect(() => kernel.cavityVolume(tee, ports.filter((i) => i !== index))).toThrow(KernelError);
    for (const indices of [[], [end(1, 0)], [NaN], [-1], [1.5], [Number.MAX_SAFE_INTEGER]]) {
      expect(() => kernel.cavityVolume(tee, indices)).toThrow(KernelError);
    }
    expect(kernel.check(tee).valid).toBe(true);
    expect(kernel.massProps(tee).volume).toBe(baseline);
  } finally {
    for (const shape of [tee, through, branch, bore, envelope]) kernel.release(shape);
  }
});
