/**
 * ADR 0265: a fillet across the C1 joints of a sketch spline is made on the body cut there first. Each claim has its control: an analytic body is
 * not cut; a cut body that gets no fillet falls back to the uncut one; the history of a fillet made on the cut body is told in the uncut body's
 * faces and edges. The volumes the cut body's fillets are held to are those of the same edges uncut, measured at HEAD 908ca3b6
 * (spikes/0265-fillet-c1-joints/data/split100.json, `plain`).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type FaceOrigin } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { XY, recognizeStep, sample, splineBoss } from './recognize-rolling-ball.kit';
import { cupWithRoundedWindows } from './recognize-window-rounds.kit';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

/** Volumes of the uncut fillet at HEAD (split100.json `plain`). */
const UNCUT: Record<number, number> = { 1: 16635.01194147236, 46: 16175.46205921472, 50: 17647.722717282115, 12: 14551.768997079223 };

describe('fillet across C1 joints (ADR 0265)', () => {
  it('seed 96: the round OCCT gave up on after ~150 s uncut is made on the body cut at its joints', () => {
    const s = sample(96);
    const m = splineBoss(kernel, s.top, s.h);
    const t0 = performance.now();
    const r = kernel.fillet(m.shape, m.edges, s.radius);
    expect(kernel.lastFilletCut).toBe('cut');
    // measured 0.3 to 0.7 s on two cores; uncut, three fillet shapes of 49 to 77 s each, all failing
    expect(performance.now() - t0).toBeLessThan(30_000);
    expect(kernel.massProps(r.shape).volume).toBeGreaterThan(0);
  }, 120_000);

  it('seed 39: the cut body gets no round, the uncut body does (the fallback)', () => {
    const s = sample(39);
    const m = splineBoss(kernel, s.top, s.h);
    const r = kernel.fillet(m.shape, m.edges, s.radius);
    expect(kernel.lastFilletCut).toBe('fallback');
    expect(kernel.massProps(r.shape).volume).toBeCloseTo(17355.18193653506, 3);
  }, 120_000);

  it('seed 1: the cut body\'s round is looser than CUT_FILLET_TOLERANCE (its pieces meet with gaps), the uncut one is made too and kept', () => {
    const s = sample(1);
    const m = splineBoss(kernel, s.top, s.h);
    const r = kernel.fillet(m.shape, m.edges, s.radius);
    expect(kernel.lastFilletCut).toBe('uncut tighter');
    expect(kernel.massProps(r.shape).volume).toBeCloseTo(UNCUT[1]!, 6);
  }, 120_000);

  it('a box (planes, lines) is not cut', () => {
    const L = (a: number[], b: number[], source: string) => ({ kind: 'line', a, b, source });
    const box = kernel.extrude(XY as never, [{ outer: [[0, 0], [10, 0], [10, 20], [0, 20]].map((a, i, p) => L(a, p[(i + 1) % 4]!, 'q' + i)), holes: [] }] as never, [0, 0, 30]).shape;
    const r = kernel.fillet(box, [0], 1);
    expect(kernel.lastFilletCut).toBe('none');
    expect(kernel.topology(r.shape).faces.length).toBe(7);
  });

  it('a window\'s rim: the cup\'s cylinder cut along the drafted spline comes out invalid, so the body is not cut', () => {
    // window-rounds fuzz 20: the cut spoiled the cylinder in every one of its 24 fillets, and the fillet on it then failed after up to 24 s
    const cup = { r: 18.5, wall: 1, height: 18, windows: [{ kind: 'drafted' as const, at: 0, top: [[-3.5, 4], [0, 12], [3.5, 4]] as [number, number][], draft: 1.5 }] };
    const shape = cupWithRoundedWindows(kernel, cup, 0.5);
    try {
      expect(kernel.lastFilletCut).toBe('none');
    } finally {
      kernel.release(shape);
    }
  }, 120_000);

  it.each(Object.keys(UNCUT).map(Number))('seed %i: the cut body\'s round has the uncut one\'s volume to 1e-7', (seed) => {
    const s = sample(seed);
    const m = splineBoss(kernel, s.top, s.h);
    const r = kernel.fillet(m.shape, m.edges, s.radius);
    expect(['cut', 'uncut tighter']).toContain(kernel.lastFilletCut);
    const v = kernel.massProps(r.shape).volume;
    expect(Math.abs(v - UNCUT[seed]!) / UNCUT[seed]!).toBeLessThan(1e-7);
  }, 120_000);

  it('seed 14: the history of the round made on the cut body is told in the uncut body\'s faces and edges', () => {
    const s = sample(14);
    const m = splineBoss(kernel, s.top, s.h);
    const before = kernel.topology(m.shape);
    const fe = m.edges[0]!;
    const beside = new Set(before.edges[fe]!.faces);
    const r = kernel.fillet(m.shape, m.edges, s.radius);
    expect(kernel.lastFilletCut).toBe('cut');
    const after = kernel.topology(r.shape);
    // the round is in pieces (one per piece of the wall it was made on); the wall is one face again (mergePieces)
    expect(after.faces.length).toBeGreaterThan(before.faces.length);
    const origins = r.faceOrigins;
    expect(origins.length).toBe(after.faces.length);
    const of = (o: FaceOrigin) => o as { rel: string; kind: string; index: number };
    for (const list of origins) {
      // every face comes from something of the uncut body, and only from things that were there
      expect(list.length).toBeGreaterThan(0);
      for (const o of list.map(of)) {
        const n = o.kind === 'face' ? before.faces.length : o.kind === 'edge' ? before.edges.length : before.vertices.length;
        expect(o.index).toBeLessThan(n);
      }
    }
    expect(fe).toBe(13);
    // every face of the uncut body comes out once, as it did uncut at HEAD, the wall too (its pieces put back together); the round in pieces
    const head = ['modified:face:4', 'modified:face:8', 'generated:edge:13', 'same:face:9', 'modified:face:6', 'same:face:0', 'same:face:1', 'same:face:2', 'same:face:5', 'modified:face:7', 'same:face:10', 'same:face:3'];
    const told = origins.map((l) => l.map(of).map((o) => `${o.rel}:${o.kind}:${o.index}`).join('+'));
    expect(beside.has(7)).toBe(true);
    for (const h of head.filter((x) => x !== 'generated:edge:13')) expect(told.filter((x) => x === h).length, h).toBe(1);
    expect(told.filter((x) => x === 'generated:edge:13').length).toBeGreaterThan(1);
    expect(told.every((x) => head.includes(x))).toBe(true);
    expect(after.faces.filter((f) => f.surface === 'bsplinesurface').length).toBe(before.faces.filter((f) => f.surface === 'bsplinesurface').length + told.filter((x) => x === 'generated:edge:13').length);
  }, 120_000);

  it('seed 42: the round in pieces on the wall put back together is recognized as one round and rebuilt, within the heap budget', async () => {
    const s = sample(42);
    const m = splineBoss(kernel, s.top, s.h);
    const made = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true);
    expect(kernel.lastFilletCut).toBe('cut');
    // with the wall in pieces, each piece of the round rolled on another face and was its own fillet: the rebuild's first took the whole edge and the
    // next found none (RecognizeError, thrown); recognition's heap grew past its budget (rollingBall's supports, now kept per face)
    const r = await recognizeStep(kernel, await PlaneGcsSolver.create(), made.shape);
    expect(r.doc.features.filter((f) => f.type === 'fillet').length).toBe(1);
  }, 180_000);

  // The round ends where its spline wall ends, on a slant: near that end the ball rolls past the wall's end, and nothing measured against the wall
  // there says anything. A whole round's samples stayed clear of it (HEAD rebuilt both); the short last piece of a round made on the cut wall did not
  // (2026-11-25: seed 51 read 1.6e-3 off the ball and was refused as a freeform face; seed 26's sharp edge had no end, its last sample past the curve).
  it.each([
    [51, 'a ball centre past the wall\'s end is not measured against the wall'],
    [26, 'the sharp edge of the last piece ends 2% in from the end of the curve where its supports meet'],
  ])('seed %i: the last piece of the round, where the wall ends, is read as a round: %s', async (seed) => {
    const s = sample(seed);
    const m = splineBoss(kernel, s.top, s.h);
    const made = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true);
    expect(kernel.lastFilletCut).toBe('cut');
    const r = await recognizeStep(kernel, await PlaneGcsSolver.create(), made.shape);
    expect(r.report.volumeError).toBeLessThan(1e-9);
    expect(r.doc.features.filter((f) => f.type === 'fillet').length).toBe(1);
    kernel.release(made.shape);
  }, 180_000);
});
