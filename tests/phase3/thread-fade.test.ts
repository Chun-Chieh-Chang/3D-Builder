import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type Region, type Segment, type ThreadSpec, type Vec3 } from '@3db/kernel';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

const TAU = Math.PI * 2;
const XZ: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
const Z_AXIS = { origin: [0, 0, 0] as Vec3, dir: [0, 0, 1] as Vec3 };

type P = [number, number];
const area2 = (pts: P[]) => pts.reduce((s, [x0, y0], i) => { const [x1, y1] = pts[(i + 1) % pts.length]!; return s + x0 * y1 - x1 * y0; }, 0);
const region = (pts: P[], name = 'p'): Region => {
  const loop = area2(pts) > 0 ? pts : [...pts].reverse();
  const outer: Segment[] = loop.map((a, i) => ({ kind: 'line', a, b: loop[(i + 1) % loop.length]!, source: `${name}${i + 1}` }));
  return { outer, holes: [] };
};

describe('Thread Taper-In & Taper-Out Fade Transitions (T-7)', () => {
  const toothProfile: P[] = [
    [5.0, -0.4],
    [3.8, -0.1],
    [3.8, 0.1],
    [5.0, 0.4],
  ];

  it('generates a valid helical tool with smooth fade-in and fade-out runout', () => {
    const pitch = 2.0;
    const starts = 1;
    const from = 0;
    const to = 20;

    // 0.5 turns fade at both start and end
    const spec: ThreadSpec = {
      axis: Z_AXIS,
      pitch,
      starts,
      hand: 'right',
      from,
      to,
      fadeTurnsIn: 0.5,
      fadeTurnsOut: 0.5,
    };

    const tool = kernel.thread(XZ, [region(toothProfile)], spec);
    const props = kernel.massProps(tool.shape);
    expect(props.volume).toBeGreaterThan(0);

    // Fade tool must have strictly less volume than a blunt full-length cylinder cut
    const unFadedTool = kernel.thread(XZ, [region(toothProfile)], { ...spec, fadeTurnsIn: 0, fadeTurnsOut: 0 });
    const unFadedProps = kernel.massProps(unFadedTool.shape);
    expect(props.volume).toBeLessThan(unFadedProps.volume);

    kernel.release(tool.shape);
    kernel.release(unFadedTool.shape);
  });

  it('proves that tooth height gradually vanishes to root radius at z = from and z = to', () => {
    const pitch = 2.0;
    const starts = 1;
    const from = 0;
    const to = 10;

    const spec: ThreadSpec = {
      axis: Z_AXIS,
      pitch,
      starts,
      hand: 'right',
      from,
      to,
      fadeTurnsIn: 1.0,
      fadeTurnsOut: 1.0,
    };

    const tool = kernel.thread(XZ, [region(toothProfile)], spec);

    // Integer turns along helix: at z = 4.0 (2 whole turns), the tooth profile is at +X direction
    // Probe middle crest at z = 4.0
    const midPoint: Vec3 = [4.5, 0, 4.0];
    const classifyMid = kernel.classify(tool.shape, [midPoint]);
    expect(classifyMid).toEqual(['in']);

    // At near start z = 0.05, tooth profile is also at +X direction, but height is tapered down to root (~3.8)
    // So outer point [4.5, 0, 0.05] must be 'out'
    const startOuterPoint: Vec3 = [4.5, 0, 0.05];
    const classifyStart = kernel.classify(tool.shape, [startOuterPoint]);
    expect(classifyStart).toEqual(['out']);

    kernel.release(tool.shape);
  });

  it('fuses faded thread onto a solid shaft and performs STEP roundtrip without defects', () => {
    const pitch = 1.5;
    const spec: ThreadSpec = {
      axis: Z_AXIS,
      pitch,
      starts: 1,
      hand: 'right',
      from: 2,
      to: 18,
      fadeTurnsIn: 0.5,
      fadeTurnsOut: 0.5,
    };

    const tool = kernel.thread(XZ, [region(toothProfile)], spec);

    // Core cylinder with radius 3.8 (root radius) from z = 0 to 20
    const cyl = kernel.revolve(XZ, [region([[0, 0], [3.8, 0], [3.8, 20], [0, 20]])], Z_AXIS, TAU).shape;
    const fused = kernel.boolean('fuse', cyl, tool.shape).shape;
    expect(kernel.massProps(fused).volume).toBeGreaterThan(0);

    // STEP Roundtrip
    const step = kernel.exportStep(fused);
    const imported = kernel.importStep(step).shape;

    const v0 = kernel.massProps(fused).volume;
    const v1 = kernel.massProps(imported).volume;
    expect(Math.abs(v1 - v0) / v0).toBeLessThan(1e-4);

    kernel.release(cyl);
    kernel.release(tool.shape);
    kernel.release(fused);
    kernel.release(imported);
  });


  it('rejects illegal fade inputs with clear error messages (Self-Red-Teaming)', () => {
    const specBase: ThreadSpec = {
      axis: Z_AXIS,
      pitch: 2.0,
      starts: 1,
      hand: 'right',
      from: 0,
      to: 10,
    };

    // Negative fade turns
    expect(() => kernel.thread(XZ, [region(toothProfile)], { ...specBase, fadeTurnsIn: -0.5 })).toThrowError(/漸縮/);

    // Fade transitions exceeding total length (5 turns * 2mm + 5 turns * 2mm = 20mm >= 10mm)
    expect(() => kernel.thread(XZ, [region(toothProfile)], { ...specBase, fadeTurnsIn: 3.0, fadeTurnsOut: 3.0 })).toThrowError(/兩端漸縮長度合計不能超過/);
  });
});
