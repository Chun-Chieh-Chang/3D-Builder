import { beforeAll, expect, it } from 'vitest';
import { Kernel, type Frame, type Region, type Vec3 } from '@3db/kernel';
import { t } from '@3db/i18n';
import { toothedProfile } from '../../packages/regen/src/gears';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

const xy: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const circle = (r: number) => ({ kind: 'circle' as const, c: [0, 0] as [number, number], r, source: String(r) });

it('offsets a real involute gear section, retaining its bore at a small gap', () => {
  const region = toothedProfile({ kind: 'gear', module: 1, teeth: 24, pressureAngle: 20 * Math.PI / 180, width: 5, bore: 6, backlash: 0, baseHeight: 0 });
  const source = kernel.extrude(xy, [region], [0, 0, 5]).shape;
  try {
    expect(kernel.check(source).valid).toBe(true);
    const offset = kernel.sectionClearance(source, { ...xy, origin: [0, 0, 2.5] }, 0.01);
    expect(offset.regions).toHaveLength(1);
    expect(offset.regions[0]!.holes).toHaveLength(1);
    expect(offset.approximationBound).toBeGreaterThan(0);
  } finally {
    kernel.release(source);
  }
}, 60000);

it('approximates Bézier section edges with a bounded biarc envelope', () => {
  const source = kernel.extrude(xy, [{
    outer: [
      { kind: 'spline', points: [[0, 0], [10, 0]], bezierPoles: [[0, 0], [3, 8], [7, 8], [10, 0]], closed: false, source: 'curve' },
      { kind: 'line', a: [10, 0], b: [0, 0], source: 'base' },
    ],
    holes: [],
  }], [0, 0, 4]).shape;
  try {
    expect(kernel.check(source).valid).toBe(true);
    const result = kernel.sectionClearance(source, { ...xy, origin: [0, 0, 2] }, 0.25);
    expect(result.approximationBound).toBeGreaterThan(0);
    expect(result.approximationBound).toBeLessThanOrEqual(2e-6);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]!.outer.filter((s) => s.kind === 'arc').length).toBeGreaterThan(4);
  } finally {
    kernel.release(source);
  }
});

it.each(['out', 'in'] as const)('offsets a concentric annulus %s without losing its hole', (side) => {
  const source = kernel.extrude(xy, [{ outer: [circle(6)], holes: [[circle(3)]] }], [0, 0, 4]).shape;
  try {
    expect(kernel.check(source).valid).toBe(true);
    const slice: Frame = { ...xy, origin: [0, 0, 2] };
    const offset = kernel.sectionClearance(source, slice, 0.5, side);
    expect(offset.regions).toHaveLength(1);
    expect(offset.regions[0]!.holes).toHaveLength(1);
    const tool = kernel.extrude(slice, offset.regions, [0, 0, 1]).shape;
    try {
      const signedGap = side === 'out' ? 0.5 : -0.5;
      expect(kernel.check(tool).valid).toBe(true);
      expect(kernel.massProps(tool).volume).toBeCloseTo(Math.PI * ((6 + signedGap) ** 2 - (3 - signedGap) ** 2), 7);
    } finally {
      kernel.release(tool);
    }
  } finally {
    kernel.release(source);
  }
});

it('merges outward offsets of separate section regions when they overlap', () => {
  const source = kernel.extrude(xy, [-2.2, 2.2].map((x) => ({ outer: [{ ...circle(2), c: [x, 0] }], holes: [] })), [0, 0, 4]).shape;
  try {
    expect(kernel.check(source).valid).toBe(true);
    const slice: Frame = { ...xy, origin: [0, 0, 2] };
    const { regions } = kernel.sectionClearance(source, slice, 0.4);
    expect(regions).toHaveLength(1);
    const tool = kernel.extrude(slice, regions, [0, 0, 1]).shape;
    try {
      const r = 2.4;
      const halfSeparation = 2.2;
      const overlap = 2 * (r * r * Math.acos(halfSeparation / r) - halfSeparation * Math.sqrt(r * r - halfSeparation ** 2));
      expect(kernel.check(tool).valid).toBe(true);
      expect(kernel.massProps(tool).volume).toBeCloseTo(2 * Math.PI * r * r - overlap, 7);
    } finally {
      kernel.release(tool);
    }
  } finally {
    kernel.release(source);
  }
});

it('rejects invalid inputs and a gap that consumes the section', () => {
  const source = kernel.extrude(xy, [{ outer: [circle(6)], holes: [[circle(3)]] }], [0, 0, 4]).shape;
  try {
    const slice: Frame = { ...xy, origin: [0, 0, 2] };
    for (const gap of [NaN, Infinity, 0, -1, 1e-7, 1e100]) {
      expect(() => kernel.sectionClearance(source, slice, gap)).toThrow(t('sectionClearance.gapRange'));
    }
    expect(() => kernel.sectionClearance(source, { ...slice, yDir: [1, 0, 0] }, 0.5)).toThrow(t('sectionClearance.frame'));
    expect(() => kernel.sectionClearance(source, { ...slice, origin: [0, 0, 5] }, 0.5)).toThrow(t('sectionClearance.empty'));
    expect(() => kernel.sectionClearance(source, slice, 1.5, 'in')).toThrow(t('sectionClearance.vanished'));
  } finally {
    kernel.release(source);
  }
});

it('rebuilds 100 seeded circular sections across translated planes, radii and offset directions', () => {
  let state = 1529;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const before = kernel.liveShapes;
  const memory = (kernel.oc as unknown as { wasmMemory?: WebAssembly.Memory }).wasmMemory;
  const heapStart = memory?.buffer.byteLength;
  expect(heapStart).toBeGreaterThan(0);
  for (let i = 0; i < 100; i++) {
    const angle = random() * 2 * Math.PI;
    const frame: Frame = { origin: [30 * random(), -20 * random(), 5 * random()], xDir: [Math.cos(angle), Math.sin(angle), 0],
      yDir: [0, 0, 1], normal: [Math.sin(angle), -Math.cos(angle), 0] };
    const r = 0.2 + 20 * random();
    const gap = r * (0.01 + 0.85 * random());
    const side = i % 2 ? 'in' : 'out';
    const vector: Vec3 = [2 * frame.normal[0], 2 * frame.normal[1], 0];
    const source = kernel.extrude(frame, [{ outer: [circle(r)], holes: [] }], vector).shape;
    try {
      expect(kernel.check(source).valid).toBe(true);
      const slice: Frame = { ...frame, origin: [frame.origin[0] + vector[0] / 2, frame.origin[1] + vector[1] / 2, frame.origin[2]] };
      const { regions } = kernel.sectionClearance(source, slice, gap, side);
      const tool = kernel.extrude(slice, regions, vector).shape;
      try {
        expect(kernel.check(tool).valid).toBe(true);
        expect(kernel.massProps(tool).volume).toBeCloseTo(2 * Math.PI * (r + (side === 'out' ? gap : -gap)) ** 2, 7);
      } finally {
        kernel.release(tool);
      }
    } finally {
      kernel.release(source);
    }
    expect(kernel.liveShapes).toBe(before);
  }
  const heapEnd = memory!.buffer.byteLength;
  expect(heapEnd - heapStart!).toBeLessThan(512 * 1024 ** 2);
  console.info(`Section clearance fuzz Heap: ${heapStart! / 1024 ** 2} → ${heapEnd / 1024 ** 2} MiB`);
}, 60000);

it('offsets a rectangular section in a translated, oblique frame and sweeps it from that plane', () => {
  const frame: Frame = { origin: [13, -21, 8], xDir: [0.6, 0.8, 0], yDir: [0, 0, 1], normal: [0.8, -0.6, 0] };
  const corners: [number, number][] = [[-4, -3], [4, -3], [4, 3], [-4, 3]];
  const rectangle: Region = {
    outer: corners.map((a, i) => ({ kind: 'line', a, b: corners[(i + 1) % corners.length]!, source: String(i) })),
    holes: [],
  };
  const source = kernel.extrude(frame, [rectangle], [4, -3, 0]).shape;
  try {
    expect(kernel.check(source).valid).toBe(true);
    const slice: Frame = { ...frame, origin: [14.6, -22.2, 8] };
    const gap = 0.5;
    const depth = 1.25;
    const direction: Vec3 = [depth * 0.8, depth * -0.6, 0];
    expect(typeof kernel.sectionClearance).toBe('function');
    const offset = kernel.sectionClearance(source, slice, gap);
    const tool = kernel.extrude(slice, offset.regions, direction).shape;
    try {
      expect(kernel.check(tool).valid).toBe(true);
      const props = kernel.massProps(tool);
      const area = 8 * 6 + 2 * (8 + 6) * gap + Math.PI * gap ** 2;
      expect(props.volume).toBeCloseTo(area * depth, 7);
      expect(props.center[0]).toBeCloseTo(slice.origin[0] + direction[0] / 2, 7);
      expect(props.center[1]).toBeCloseTo(slice.origin[1] + direction[1] / 2, 7);
      expect(props.center[2]).toBeCloseTo(slice.origin[2], 7);
      expect(offset.approximationBound).toBe(0);
    } finally {
      kernel.release(tool);
    }
  } finally {
    kernel.release(source);
  }
});
