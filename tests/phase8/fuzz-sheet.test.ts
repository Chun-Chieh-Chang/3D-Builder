/**
 * Hardening H-5: sheet metal parts made at random (a seeded generator: a failure names its seed and is made again by it), checked against what has to be true of any of them whatever the
 * numbers: a feature either works or says why it cannot (nothing throws, nothing is made wrong without being said); what is made is one valid solid whose faces are named once each;
 * at K 0.5 the flat pattern has the volume of the folded sheet; the DXF of the pattern is one the checker has nothing to say of and covers the pattern; the same part rebuilt, or saved
 * and read back and rebuilt, is the same part; and a K-factor changed moves the pattern and nothing of the folded sheet.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkDxf, flatPatternDxf, readDxf, type DxfLine } from '@3db/drawing';
import { readPartFile, writePartFile } from '@3db/io';
import { applyCommand, createEmptyPart, type Feature, type PartDoc, type Ref } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { flatPattern, Regenerator, sheetChecks, type RebuildResult } from '@3db/regen';
import { circle, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const rebuild = (doc: PartDoc): RebuildResult => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  return regen.rebuild(doc);
};
const build = (features: Feature[]): PartDoc => features.reduce((d, feature, index) => applyCommand(d, { type: 'insertFeature', feature, index }), createEmptyPart());

/** mulberry32 */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (lo: number, hi: number) => lo + (hi - lo) * next();
  const round = (v: number, step = 0.5) => Math.round(v / step) * step;
  return { next, between, round, pick: <T,>(xs: T[]): T => xs[Math.floor(next() * xs.length)]! };
}

interface Case {
  seed: number;
  features: Feature[];
  K: number;
  description: string;
}

/** A plate with up to four flanges or hems, each kept clear of the next by its insets (a collision is a thing the program says, but it should not be most of the cases). */
function generate(seed: number, harsh = false): Case {
  const r = rng(seed);
  const L = r.round(r.between(70, 180), 5);
  const W = r.round(r.between(50, 130), 5);
  const T = r.pick([0.8, 1, 1.2, 1.5, 2, 2.5, 3]);
  const radius = r.round(r.between(T, 3 * T), 0.1);
  const K = r.pick([0.3, 0.4, 0.44, 0.5]);
  const holes = r.pick([0, 1, 2]);
  const parts = [rectangle('r', 0, 0, L, W), ...Array.from({ length: holes }, (_, i) => circle(`h${i}`, L * (0.3 + 0.1 * i), W * (0.4 + 0.2 * i), r.pick([1.5, 2.5, 3])))];
  const plate = sketch('sk', front, ...parts) as Feature;
  const base = { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: String(T), radius: String(radius), kFactor: String(K) } as Feature;
  const p = rebuild(build([plate, base]));
  const at = (mid: [number, number, number]): Ref => {
    const i = p.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.hypot(e.mid[0] - mid[0], e.mid[1] - mid[1], e.mid[2] - mid[2]) < 1e-6);
    return { kind: 'edge', name: p.body!.names.edges[i]!, fingerprint: edgeFingerprint(p.body!.topology, i) };
  };
  const edges: [string, Ref, number][] = [['x1', at([L, W / 2, T]), W], ['y1', at([L / 2, W, T]), L], ['x0', at([0, W / 2, T]), W], ['y0', at([L / 2, 0, T]), L]];
  const Ro = radius + T;
  const features: Feature[] = [plate, base];
  const used: string[] = [];
  edges.forEach(([name, edge, along], k) => {
    if (r.next() < 0.35) return;
    const hem = r.next() < 0.3;
    // every flange stops short of both ends of its edge by more than the setback of its own bend and of the bend next to it, so that none reaches another
    const angle = hem ? 180 : harsh ? r.pick([20, 45, 90, 135, 160, 170]) : r.pick([45, 90, 90, 120, 135]);
    const setback = hem ? Ro : Ro * Math.tan((angle * Math.PI) / 360);
    const inset = harsh ? r.round(r.between(0, setback + Ro + 4), 0.5) : r.round(setback + Ro + r.between(1, 6), 0.5);
    if (along - 2 * inset < (harsh ? 3 : 12)) return;
    used.push(`${name}:${hem ? 'hem' : angle}`);
    const extra = { inset: { start: String(inset), end: String(inset) }, ...(r.next() < 0.6 ? { relief: { width: String(r.round(r.between(0.5, harsh ? 8 : 2.5), 0.5) || 0.5), depth: String(r.round(r.between(0.5, harsh ? 8 : 2.5), 0.5) || 0.5) } } : {}) };
    features.push(
      hem
        ? ({ id: `f${k}`, type: 'hem', name: `f${k}`, suppressed: false, edge, length: String(harsh ? r.round(r.between(0.5, 30), 0.5) : r.round(r.between(4 * T, 10 * T), 0.5)), gap: String(harsh ? r.round(r.between(0.2, 6), 0.1) : r.round(r.between(0.3 * T, 2 * T), 0.1)), ...extra } as Feature)
        : ({ id: `f${k}`, type: 'edgeFlange', name: `f${k}`, suppressed: false, edge, length: String(harsh ? r.round(r.between(0.5, 60), 0.5) : r.round(r.between(setback + 4 * T + 2, 40), 0.5)), angle: `${angle}deg`, ...(r.next() < 0.2 ? { position: 'bendOutside' } : {}), ...extra } as Feature),
    );
  });
  return { seed, features, K, description: `${harsh ? 'harsh ' : ''}seed ${seed}: plate ${L} × ${W} × ${T}, r ${radius}, K ${K}, ${holes} holes, ${used.join(' ') || 'no flanges'}` };
}

const SEEDS = Array.from({ length: 36 }, (_, i) => 1000 + i * 7);
const stats = { ok: 0, said: 0, flanges: 0 };

const HARSH_SEEDS = Array.from({ length: 60 }, (_, i) => 5000 + i * 13);
const harshStats = { ok: 0, said: 0, flanges: 0 };

async function check(c: Case, tally: { ok: number; said: number; flanges: number }) {
  {
    const why = c.description;
    const r = rebuild(build(c.features));
    // a feature works or says why
    for (const f of r.features) {
      expect(['ok', 'error'], `${why}: ${f.id}`).toContain(f.status);
      if (f.status === 'error') expect((f.message ?? '').length, `${why}: ${f.id} says nothing`).toBeGreaterThan(0);
    }
    const bad = r.features.filter((f) => f.status === 'error');
    if (bad.length > 0) {
      tally.said++;
      // what is said is one of the things the program knows to say
      for (const f of bad) expect(f.message, `${why}: ${f.id}`).toMatch(/撞到|放不下|太短|縮短|找不到|遺失|太大|失敗|無法/);
      return;
    }
    tally.ok++;
    tally.flanges += r.sheet!.flanges.length;
    const shape = r.body!.shape;
    expect(kernel.solidCount(shape), why).toBe(1);
    expect(kernel.isValid(shape), why).toBe(true);
    expect(new Set(r.body!.names.faces).size, `${why}: names`).toBe(r.body!.names.faces.length);
    const volume = kernel.massProps(shape).volume;

    // the pattern: made, the volume of the folded sheet at K 0.5 (and the area times the thickness always), a DXF the checker likes that covers it
    const pattern = flatPattern(kernel, r.sheet!);
    kernel.release(pattern.shape);
    expect(pattern.volume, `${why}: area × T`).toBeCloseTo(pattern.area * r.sheet!.thickness, 4);
    if (c.K === 0.5) expect(pattern.volume, `${why}: volume conserved`).toBeCloseTo(volume, 2);
    const dxf = readDxf(flatPatternDxf(pattern));
    expect(checkDxf(dxf), why).toEqual([]);
    const outline = dxf.entities.filter((e): e is DxfLine => e.type === 'LINE' && e.layer === 'OUTLINE');
    if (outline.length > 0 && pattern.outline.every((s) => s.kind === 'line' || s.kind === 'circle')) {
      expect(Math.max(...outline.flatMap((l) => [l.a[0], l.b[0]])), `${why}: width`).toBeCloseTo(pattern.width, 3);
      expect(Math.max(...outline.flatMap((l) => [l.a[1], l.b[1]])), `${why}: height`).toBeCloseTo(pattern.height, 3);
    }
    expect(dxf.entities.filter((e) => e.type === 'LINE' && e.layer === 'BEND'), why).toHaveLength(r.sheet!.bends.length);

    // the checks run on any of them and say something about every flat piece
    const checks = sheetChecks(kernel, r.sheet!);
    expect(checks.filter((k) => k.rule === 'flangeLength'), why).toHaveLength(r.sheet!.flanges.length);

    // the same part again, and the part saved and read back
    const again = rebuild(build(c.features));
    expect(again.body!.names.faces.slice().sort(), `${why}: rebuilt`).toEqual(r.body!.names.faces.slice().sort());
    expect(kernel.massProps(again.body!.shape).volume, why).toBeCloseTo(volume, 6);
    const back = await readPartFile(await writePartFile(build(c.features)));
    const read = rebuild(back.doc);
    expect(read.features.every((f) => f.status === 'ok'), `${why}: read back`).toBe(true);
    expect(read.body!.names.faces.slice().sort(), `${why}: read back`).toEqual(r.body!.names.faces.slice().sort());
    expect(kernel.massProps(read.body!.shape).volume, why).toBeCloseTo(volume, 6);

    // the K-factor moves the pattern and nothing of the folded sheet
    const other = rebuild(applyCommand(build(c.features), { type: 'setBaseFlange', featureId: 'bf', flange: { thickness: String(r.sheet!.thickness), radius: String(r.sheet!.radius), kFactor: c.K === 0.5 ? '0.4' : '0.5' } }));
    expect(other.features.every((f) => f.status === 'ok'), `${why}: K changed`).toBe(true);
    expect(kernel.massProps(other.body!.shape).volume, why).toBeCloseTo(volume, 6);
    expect(other.body!.names.faces.slice().sort(), why).toEqual(r.body!.names.faces.slice().sort());
  }
}

describe('sheet metal parts made at random', () => {
  it.each(SEEDS)('seed %i: what is made is whole, what cannot be made is said, and the pattern, the file and the rebuild agree', (seed) => check(generate(seed), stats), 60000);

  it.each(HARSH_SEEDS)('harsh seed %i: the same of parts with flanges that may touch, may be too short or too deep', (seed) => check(generate(seed, true), harshStats), 60000);

  it('most of them were made (the generator keeps the flanges apart), and flanges were made in them', () => {
    expect(stats.ok + stats.said).toBe(SEEDS.length);
    expect(stats.ok).toBeGreaterThanOrEqual(Math.ceil(SEEDS.length * 0.7));
    expect(stats.flanges).toBeGreaterThan(SEEDS.length);
    // (in the harsh ones many are refused, with a reason: that is what they are for)
    expect(harshStats.ok + harshStats.said).toBe(HARSH_SEEDS.length);
    expect(harshStats.ok).toBeGreaterThan(10);
  });
});

describe('flanges on flanges and bent base flanges made at random, against the numbers worked out here', () => {
  it.each(Array.from({ length: 24 }, (_, i) => 300 + i * 11))('chain seed %i: a plate, a 90° flange and a hem folded on the end of it', (seed) => {
    const r = rng(seed);
    const L = r.round(r.between(80, 160), 5);
    const W = r.round(r.between(40, 100), 5);
    const T = r.pick([1, 1.5, 2]);
    const radius = r.round(r.between(T, 2.5 * T), 0.1);
    const Lf = r.round(r.between(20, 50), 1);
    const gap = r.round(r.between(0.4, 2 * T), 0.1);
    const hemLength = r.round(r.between(3, 12), 0.5);
    const Ro = radius + T;
    const rh = gap / 2;
    const base = { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: String(T), radius: String(radius), kFactor: '0.5' } as Feature;
    const plate = sketch('sk', front, rectangle('r', 0, 0, L, W)) as Feature;
    const p = rebuild(build([plate, base]));
    const edge = (rb: RebuildResult, mid: [number, number, number]): Ref => {
      const i = rb.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.hypot(e.mid[0] - mid[0], e.mid[1] - mid[1], e.mid[2] - mid[2]) < 1e-6);
      expect(i, `an edge at ${mid}`).toBeGreaterThanOrEqual(0);
      return { kind: 'edge', name: rb.body!.names.edges[i]!, fingerprint: edgeFingerprint(rb.body!.topology, i) };
    };
    const flange = { id: 'ef', type: 'edgeFlange', name: 'ef', suppressed: false, edge: edge(p, [L, W / 2, T]), length: String(Lf) } as Feature;
    const first = rebuild(build([plate, base, flange]));
    const hem = { id: 'hm', type: 'hem', name: 'hm', suppressed: false, edge: edge(first, [L - T, W / 2, Lf]), length: String(hemLength), gap: String(gap) } as Feature;
    const why = `chain seed ${seed}: ${L} × ${W} × ${T}, r ${radius}, flange ${Lf}, hem ${hemLength} gap ${gap}`;
    const res = rebuild(build([plate, base, flange, hem]));
    const flat1 = Lf - Ro;
    const flat2 = flat1 - (rh + T); // what is left of the flat piece of the flange after the hem has cut it back
    if (flat2 < 0.5) {
      expect(res.features.find((f) => f.id === 'hm')!.status, why).toBe('error');
      return;
    }
    expect(res.features.map((f) => f.status), why).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(kernel.solidCount(res.body!.shape), why).toBe(1);
    expect(kernel.isValid(res.body!.shape), why).toBe(true);
    const bend = (theta: number, rr: number) => theta * T * W * (rr + T / 2);
    expect(kernel.massProps(res.body!.shape).volume, why).toBeCloseTo(T * W * (L - Ro - 0) + bend(Math.PI / 2, radius) + T * W * flat2 + bend(Math.PI, rh) + T * W * hemLength, 3);
    const pattern = flatPattern(kernel, res.sheet!);
    kernel.release(pattern.shape);
    expect(pattern.width, why).toBeCloseTo(L - Ro + (Math.PI / 2) * (radius + T / 2) + flat2 + Math.PI * (rh + T / 2) + hemLength, 3);
    expect(pattern.height, why).toBeCloseTo(W, 4);
    expect(pattern.volume, why).toBeCloseTo(kernel.massProps(res.body!.shape).volume, 2);
    expect(res.sheet!.flanges.map((f) => f.parent), why).toEqual([-1, 0]);
  }, 60000);

  it.each(Array.from({ length: 24 }, (_, i) => 700 + i * 17))('channel seed %i: a bent base flange of a random profile', (seed) => {
    const r = rng(seed);
    const T = r.pick([0.8, 1.2, 1.5, 2, 3]);
    const radius = r.round(r.between(T, 3 * T), 0.1);
    const width = r.round(r.between(20, 80), 5);
    const flip = r.next() < 0.5;
    // a profile of two to four pieces, turning left or right by 45° to 135° at each corner; each piece long enough for the bends at its two ends. The path is rounded with the radius of the
    // side it is on: a corner that turns toward the side the sheet grows to has r + T (the outside of the bend), the others r
    const turns = Array.from({ length: r.pick([1, 2, 3]) }, () => r.pick([-1, 1]) * r.pick([45, 90, 135]));
    const rho = (turn: number) => (turn > 0 === !flip ? radius + T : radius); // (left turns are positive; the sheet grows to the left unless it is flipped)
    const need = (turn: number) => rho(turn) * Math.tan((Math.abs(turn) * Math.PI) / 360);
    const pts: [number, number][] = [[0, 0]];
    let dir = 0;
    const lengths = [0, ...turns].map((_, i) => r.round((i > 0 ? need(turns[i - 1]!) : 0) + (i < turns.length ? need(turns[i]!) : 0) + r.between(5, 40), 0.5));
    lengths.forEach((len, i) => {
      const [x, y] = pts[pts.length - 1]!;
      pts.push([x + len * Math.cos(dir), y + len * Math.sin(dir)]);
      dir += ((turns[i] ?? 0) * Math.PI) / 180;
    });
    const polyline = { ...sketch('sk', front), entities: pts.flatMap(([x, y], i) => [{ id: `p${i}`, type: 'point', x, y }, ...(i > 0 ? [{ id: String.fromCharCode(96 + i), type: 'line', p1: `p${i - 1}`, p2: `p${i}` }] : [])]) } as Feature;
    const K = r.pick([0.3, 0.4, 0.5]);
    const base = { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: String(T), radius: String(radius), kFactor: String(K), depth: String(width), ...(flip ? { flipSide: true } : {}) } as Feature;
    const why = `channel seed ${seed}: T ${T}, r ${radius}, width ${width}, turns ${turns.join(' ')}, lengths ${lengths.join(' ')}, K ${K}`;
    const res = rebuild(build([polyline, base]));
    // the corners that overlap themselves (a profile that turns back on itself) are said; the others are made
    if (res.features[1]!.status === 'error') {
      expect(res.features[1]!.message, why).toMatch(/太短|折回|無法|失敗|撞到|放不下/);
      return;
    }
    expect(kernel.solidCount(res.body!.shape), why).toBe(1);
    expect(kernel.isValid(res.body!.shape), why).toBe(true);
    const sheet = res.sheet!;
    expect(sheet.bends, why).toHaveLength(turns.length);
    const straight = lengths.reduce((a, len, i) => a + len - (i > 0 ? need(turns[i - 1]!) : 0) - (i < turns.length ? need(turns[i]!) : 0), 0);
    const allowance = turns.reduce((a, turn) => a + (Math.abs(turn) * Math.PI) / 180 * (radius + K * T), 0);
    expect(sheet.flatLength!, why).toBeCloseTo(straight + allowance, 4);
    // the sheet's volume is T × width × (the straight pieces + θ(r + T/2)) whatever K is
    const centreline = straight + turns.reduce((a, turn) => a + (Math.abs(turn) * Math.PI) / 180 * (radius + T / 2), 0);
    const folded = kernel.massProps(res.body!.shape).volume;
    expect(Math.abs(folded - T * width * centreline) / folded, why).toBeLessThan(1e-6);
    const pattern = flatPattern(kernel, sheet);
    kernel.release(pattern.shape);
    expect(pattern.width, why).toBeCloseTo(sheet.flatLength!, 4);
    expect(pattern.height, why).toBeCloseTo(width, 4);
    if (K === 0.5) expect(pattern.volume, why).toBeCloseTo(kernel.massProps(res.body!.shape).volume, 2);
  }, 60000);
});

describe('a profile that crosses itself', () => {
  it('is said, or made as a valid solid — never made as an invalid one without a word', () => {
    // (0,0) → (40,0) → (40,40) → (20,40) → (20,-20): the last piece crosses the first
    const pts: [number, number][] = [[0, 0], [40, 0], [40, 40], [20, 40], [20, -20]];
    const polyline = { ...sketch('sk', front), entities: pts.flatMap(([x, y], i) => [{ id: `p${i}`, type: 'point', x, y }, ...(i > 0 ? [{ id: String.fromCharCode(96 + i), type: 'line', p1: `p${i - 1}`, p2: `p${i}` }] : [])]) } as Feature;
    const base = { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5', depth: '30' } as Feature;
    const r = rebuild(build([polyline, base]));
    const f = r.features[1]!;
    if (f.status === 'ok') {
      expect(kernel.isValid(r.body!.shape)).toBe(true);
      expect(kernel.solidCount(r.body!.shape)).toBe(1);
    } else expect(f.message).toContain('交疊');
    expect(f.status).toBe('error'); // this one crosses: it has to be said
  });
});

describe('closed corners made at random, against the numbers worked out here', () => {
  it.each(Array.from({ length: 24 }, (_, i) => 900 + i * 19))('corner seed %i: two 90° flanges on neighbouring edges, the second closed against the first', (seed) => {
    const r = rng(seed);
    const L = r.round(r.between(70, 150), 5);
    const W = r.round(r.between(50, 110), 5);
    const T = r.pick([1, 1.5, 2, 3]);
    const radius = r.round(r.between(T, 2.5 * T), 0.1);
    const Ro = radius + T;
    const LA = r.round(r.between(Ro + 8, 45), 1);
    const LB = r.round(r.between(Ro + 8, 45), 1);
    const inset = r.round(r.between(0, 2), 0.1);
    const gap = r.round(r.between(0, radius + inset + 1), 0.1); // (more than the way there: said)
    const base = { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: String(T), radius: String(radius), kFactor: '0.5' } as Feature;
    const plate = sketch('sk', front, rectangle('r', 0, 0, L, W)) as Feature;
    const edge = (rb: RebuildResult, mid: [number, number, number]): Ref => {
      const i = rb.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.hypot(e.mid[0] - mid[0], e.mid[1] - mid[1], e.mid[2] - mid[2]) < 1e-6);
      expect(i, `an edge at ${mid}`).toBeGreaterThanOrEqual(0);
      return { kind: 'edge', name: rb.body!.names.edges[i]!, fingerprint: edgeFingerprint(rb.body!.topology, i) };
    };
    const a = { id: 'fa', type: 'edgeFlange', name: 'fa', suppressed: false, edge: edge(rebuild(build([plate, base])), [L, W / 2, T]), length: String(LA) } as Feature;
    const withA = rebuild(build([plate, base, a]));
    const b = { id: 'fb', type: 'edgeFlange', name: 'fb', suppressed: false, edge: edge(withA, [(L - Ro) / 2, W, T]), length: String(LB), inset: { start: String(inset), end: '0' }, corner: { start: String(gap) } } as Feature;
    const why = `corner seed ${seed}: ${L} × ${W} × ${T}, r ${radius}, flanges ${LA} and ${LB}, inset ${inset}, gap ${gap}`;
    const res = rebuild(build([plate, base, a, b]));
    const reach = radius + inset; // from the end of the bend of the second flange to the inside of the first
    // (the first flange has to cover the middle of the flat piece of the second: it stands as high as LA, the middle of that piece is at Ro + (LB − Ro)/2)
    if (Ro + (LB - Ro) / 2 > LA + 1e-9) {
      expect(res.features.find((f) => f.id === 'fb'), why).toMatchObject({ status: 'error', message: expect.stringContaining('蓋住') });
      return;
    }
    if (gap > reach + 1e-9) {
      expect(res.features.find((f) => f.id === 'fb')!.status, why).toBe('error');
      return;
    }
    expect(res.features.map((f) => f.status), why).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(kernel.isValid(res.body!.shape), why).toBe(true);
    expect(kernel.solidCount(res.body!.shape), why).toBe(1);
    const ext = reach - gap;
    expect(res.sheet!.flanges[1]!.corner[0], why).toBeCloseTo(ext, 6);
    const bend = (w: number) => (Math.PI / 2) * T * w * (radius + T / 2);
    const WB = L - Ro - inset;
    const expected = T * (L * W - Ro * W - Ro * WB) + bend(W) + T * W * (LA - Ro) + bend(WB) + T * (WB + ext) * (LB - Ro);
    expect(kernel.massProps(res.body!.shape).volume, why).toBeCloseTo(expected, 3);
    const pattern = flatPattern(kernel, res.sheet!);
    kernel.release(pattern.shape);
    expect(pattern.volume, why).toBeCloseTo(kernel.massProps(res.body!.shape).volume, 2);
    expect(pattern.width, why).toBeCloseTo(L - Ro + (Math.PI / 2) * (radius + T / 2) + LA - Ro, 3);
  }, 60000);
});
