/**
 * Knurl fuzz (ADR 0124, AGENTS.md §3.4): 120 random configurations of a knurl tool, each of which must either build into a valid solid or be refused with a
 * reason, and never crash.
 *
 * In its own file, like `thread-fuzz.test.ts`: a helical sweep leaves the Emscripten heap larger every time it runs (see the note in `DEV_LOG.md` —
 * `thread` has done since T-1), so a fuzz that builds ~200 helical tools on top of everything else a suite has already allocated runs the wasm heap
 * out of room. Its own file gives it a heap of its own.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, KernelError, KNURL_OVERSHOOT, type KnurlSpec, type ShapeId, type Vec3 } from '@3db/kernel';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

const TAU = Math.PI * 2;
const deg = (d: number) => (d * Math.PI) / 180;
const Z_AXIS = { origin: [0, 0, 0] as Vec3, dir: [0, 0, 1] as Vec3 };
/** OCCT's default rule is about 1e-4 off on a knurl's B-spline flanks (Kernel.massProps). */
const volume = (id: ShapeId) => kernel.massProps(id, { eps: 1e-9 }).volume;

/** The pattern the *feature* offers; the kernel only ever makes one hand of it. */
type Pattern = 'straight' | 'helical' | 'diamond';
interface Case {
  radius: number;
  from: number;
  to: number;
  count: number;
  depth: number;
  included: number;
  pattern: Pattern;
  angle?: number;
  hand?: 'right' | 'left';
}

/** The one-hand tools a case needs: one for straight or helical, both hands for a diamond. */
const specsOf = (c: Case): KnurlSpec[] => {
  const base = { axis: Z_AXIS, radius: c.radius, count: c.count, from: c.from, to: c.to, depth: c.depth, included: c.included };
  if (c.pattern === 'straight') return [{ ...base, pattern: 'straight' }];
  const angle = c.angle ?? deg(30);
  if (c.pattern === 'helical') return [{ ...base, pattern: 'helical', angle, ...(c.hand ? { hand: c.hand } : {}) }];
  return [
    { ...base, pattern: 'helical', angle, hand: 'right' },
    { ...base, pattern: 'helical', angle, hand: 'left' },
  ];
};

describe('knurl fuzz (ADR 0124, AGENTS.md §3.4)', () => {
  it('makes a valid tool or refuses with a reason, never crashes', () => {
    let seed = 20261011;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 4294967296);
    const range = (lo: number, hi: number) => lo + rnd() * (hi - lo);
    let made = 0;
    let refused = 0;
    for (let i = 0; i < 120; i++) {
      const radius = range(3, 12);
      const count = 3 + Math.floor(rnd() * 60);
      const angle = deg(range(10, 45));
      const pattern = (['straight', 'helical', 'diamond'] as const)[Math.floor(rnd() * 3)]!;
      const included = deg(range(20, 160));
      const pitch = (TAU * radius) / count;
      const spacing = pattern === 'straight' ? pitch : pitch * Math.tan(angle);
      // the deepest V that still leaves room for its neighbour, by the kernel's own rule (Kernel.knurl): depth·(1+overshoot)·2·tan(α/2) < spacing
      const deepest = spacing / (2 * (1 + KNURL_OVERSHOOT) * Math.tan(included / 2));
      const tooDeep = rnd() < 0.3;
      const depth = tooDeep ? deepest * range(1.02, 1.5) : Math.min(deepest * range(0.05, 0.95), radius * 0.5);
      const phase = range(0, TAU);
      const c: Case = {
        radius,
        count,
        from: 0,
        to: range(2, 15),
        depth,
        included,
        pattern,
        ...(pattern === 'straight' ? {} : { angle, hand: rnd() < 0.5 ? ('right' as const) : ('left' as const) }),
      };
      if (tooDeep) {
        expect(() => specsOf(c).forEach((s) => kernel.knurl({ ...s, phase })), `case ${i} should be refused`).toThrowError(KernelError);
        refused += 1;
        continue;
      }
      const tools = specsOf(c).map((s) => kernel.knurl({ ...s, phase }));
      expect(tools.length, `case ${i} tools`).toBe(pattern === 'diamond' ? 2 : 1);
      for (const tool of tools) {
        expect(kernel.isValid(tool.shape), `case ${i} should be valid`).toBe(true);
        expect(volume(tool.shape), `case ${i} should have volume`).toBeGreaterThan(0);
        kernel.release(tool.shape);
      }
      made += 1;
    }
    expect(made).toBeGreaterThan(60);
    expect(made + refused).toBe(120);
  }, 900_000);
});
