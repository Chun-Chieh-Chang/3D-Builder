/**
 * A sketch attached to the model (G7, ADR 0181): its origin on a vertex or a point, its x along a straight edge or an axis, the plane unchanged. The model is
 * a prism, the triangle (0, 0), (30, 0), (0, 40) on the front plane drawn 10 deep (z 0 to 10); the sketch lies on a plane 25 in front of the front plane
 * (z = 25, x and y as the front plane has them). Truth by hand: the hypotenuse is 50 long and runs (−30, 40, 0) / 50 = (−0.6, 0.8, 0), parallel to the
 * plane; a vertex at (30, 0, 10) falls on the plane at (30, 0, 25); a z edge is square to the plane and gives no direction.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { t } from '@3db/i18n';
import { applyCommand, CommandError, mapRefs, parsePart, SCHEMA_VERSION, serializePart, type Feature, type PartDoc, type Ref, type SketchAttach, type SketchFeature } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { parentsOf, Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, front, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
const regen = () => new Regenerator(kernel, solver, new Map());

const triangle = (w = 30): Feature =>
  sketch('s0', front, {
    entities: [
      { id: 'a', type: 'point', x: 0, y: 0 },
      { id: 'b', type: 'point', x: w, y: 0 },
      { id: 'c', type: 'point', x: 0, y: 40 },
      { id: 'ab', type: 'line', p1: 'a', p2: 'b' },
      { id: 'bc', type: 'line', p1: 'b', p2: 'c' },
      { id: 'ca', type: 'line', p1: 'c', p2: 'a' },
    ],
    constraints: [
      { id: 'fa', type: 'fix', point: 'a' },
      { id: 'fb', type: 'fix', point: 'b' },
      { id: 'fc', type: 'fix', point: 'c' },
    ],
  } as never);
const pl = (d = 25): Feature => ({ id: 'pl', type: 'refPlane', name: '基準面1', suppressed: false, def: { mode: 'offset', plane: front, distance: String(d) } }) as Feature;
const onPl: Ref = { kind: 'datum', name: 'pl' };
const prism = (w = 30): Feature[] => [triangle(w), extrude('e1', 's0', 'boss', { type: 'blind', depth: '10' }), pl()];
const s2 = (attach?: SketchAttach): Feature => ({ ...sketch('s2', onPl), ...(attach ? { attach } : {}) }) as Feature;
const doc = (attach?: SketchAttach, w = 30): PartDoc => build(...prism(w), s2(attach));

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const close = (a: V3, b: V3, eps = 1e-9) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < eps;

/** The model before the sketch, from which the references are taken (names and fingerprints as a click would give them). */
function model(w = 30) {
  const r = regen().rebuild(build(...prism(w)));
  if (!r.body) throw new Error('no body: ' + statuses(r).join(' '));
  const { topology, names } = r.body;
  const vertex = (p: V3): Ref => {
    const i = topology.vertices.findIndex((v) => close(v.point as V3, p, 1e-6));
    if (i < 0) throw new Error('no vertex at ' + p.join(','));
    return { kind: 'vertex', name: names.vertices[i]! };
  };
  const edgeAlong = (d: V3): Ref => {
    const i = topology.edges.findIndex((e) => e.curve === 'line' && e.dir && Math.abs(Math.abs(dot(e.dir as V3, d)) - 1) < 1e-9);
    if (i < 0) throw new Error('no edge along ' + d.join(','));
    return { kind: 'edge', name: names.edges[i]!, fingerprint: edgeFingerprint(topology, i) };
  };
  return { vertex, edgeAlong };
}
const frameOf = (r: RebuildResult) => r.frames.get('s2')!;
const sketchStatus = (r: RebuildResult) => r.features.find((f) => f.id === 's2')!;
/** A point of the sketch (its own coordinates) in the part. */
const at = (r: RebuildResult, x: number, y: number): V3 => {
  const f = frameOf(r);
  return [f.origin[0] + f.xDir[0] * x + f.yDir[0] * y, f.origin[1] + f.xDir[1] * x + f.yDir[1] * y, f.origin[2] + f.xDir[2] * x + f.yDir[2] * y];
};
const HYP: V3 = [-0.6, 0.8, 0];

describe('a sketch with no attachment is as it was', () => {
  it('its origin is where the part origin falls on the plane, its axes the plane\'s', () => {
    const r = regen().rebuild(doc());
    expect(statuses(r).every((x) => x.endsWith('=ok'))).toBe(true);
    expect(frameOf(r)).toEqual({ origin: [0, 0, 25], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] });
  });
});

describe('the origin on a vertex or a point', () => {
  it('a vertex off the plane falls on it along the normal: (30, 0, 10) is the origin at (30, 0, 25); the axes stay', () => {
    const m = model();
    const r = regen().rebuild(doc({ origin: m.vertex([30, 0, 10]) }));
    expect(statuses(r).every((x) => x.endsWith('=ok'))).toBe(true);
    expect(close(frameOf(r).origin as V3, [30, 0, 25])).toBe(true);
    expect(frameOf(r).xDir).toEqual([1, 0, 0]);
    expect(close(at(r, -10, -5), [20, -5, 25])).toBe(true);
  });

  it('a reference point does the same, and follows the model when it is made wider (30 → 45): the vertex is the same one', () => {
    const wide = regen().rebuild(doc({ origin: model().vertex([30, 0, 10]) }, 45));
    expect(statuses(wide).every((x) => x.endsWith('=ok'))).toBe(true);
    expect(close(frameOf(wide).origin as V3, [45, 0, 25])).toBe(true);
  });
});

describe('x along an edge', () => {
  it('the hypotenuse is parallel to the plane: x = ±(−0.6, 0.8, 0), y = normal × x, right-handed; the origin stays', () => {
    const r = regen().rebuild(doc({ x: model().edgeAlong(HYP) }));
    expect(statuses(r).every((x) => x.endsWith('=ok'))).toBe(true);
    const f = frameOf(r);
    expect(Math.abs(dot(f.xDir as V3, HYP))).toBeCloseTo(1, 12);
    expect(close(cross(f.xDir as V3, f.yDir as V3), [0, 0, 1], 1e-12)).toBe(true);
    expect(close(f.origin as V3, [0, 0, 25])).toBe(true);
  });

  it('with the origin on one end of it, the other end is 50 along x and on the x axis (y = 0), both ends of the edge', () => {
    const m = model();
    const r = regen().rebuild(doc({ origin: m.vertex([0, 40, 10]), x: m.edgeAlong(HYP) }));
    expect(statuses(r).every((x) => x.endsWith('=ok'))).toBe(true);
    const f = frameOf(r);
    const local = (p: V3): [number, number] => [dot([p[0] - f.origin[0], p[1] - f.origin[1], p[2] - f.origin[2]], f.xDir as V3), dot([p[0] - f.origin[0], p[1] - f.origin[1], p[2] - f.origin[2]], f.yDir as V3)];
    const [ex, ey] = local([30, 0, 25]); // the other end of the hypotenuse, on the plane
    expect(Math.abs(ex)).toBeCloseTo(50, 9);
    expect(ey).toBeCloseTo(0, 9);
  });

  it('a flip turns x and y half a turn about the normal: the same origin and normal, the axes reversed, still right-handed', () => {
    const m = model();
    const plain = frameOf(regen().rebuild(doc({ x: m.edgeAlong(HYP) })));
    const flipped = frameOf(regen().rebuild(doc({ x: m.edgeAlong(HYP), flipX: true })));
    expect(close(flipped.xDir as V3, plain.xDir.map((v) => -v) as V3, 1e-12)).toBe(true);
    expect(close(flipped.yDir as V3, plain.yDir.map((v) => -v) as V3, 1e-12)).toBe(true);
    expect(close(flipped.normal as V3, plain.normal as V3, 1e-12)).toBe(true);
    expect(close(cross(flipped.xDir as V3, flipped.yDir as V3), [0, 0, 1], 1e-12)).toBe(true);
  });

  it('a flip alone is an attachment too: x and y of the plane, reversed', () => {
    const f = frameOf(regen().rebuild(doc({ flipX: true })));
    expect(f.xDir).toEqual([-1, -0, -0]);
    expect(f.yDir).toEqual([-0, -1, -0]);
  });

  it('an edge square to the plane has no projection and is refused, with the reason; the sketch is not drawn somewhere else instead', () => {
    const r = regen().rebuild(doc({ x: model().edgeAlong([0, 0, 1]) }));
    expect(sketchStatus(r).status).toBe('error');
    expect(sketchStatus(r).message).toBe(t('sketch.attachXSquare'));
  });

  it('a lost reference is said so: the sketch is in error, not silently attached to the default axes', () => {
    const r = regen().rebuild(doc({ origin: { kind: 'vertex', name: 'extrude1:nowhere' } }));
    expect(sketchStatus(r).status).toBe('error');
  });
});

describe('the command', () => {
  const base = () => build(...prism(), s2());
  let origin: Ref;
  let edge: Ref;
  beforeAll(() => {
    const m = model();
    origin = m.vertex([30, 0, 10]);
    edge = m.edgeAlong(HYP);
  });
  const attachOf = (d: PartDoc) => (d.features.find((f) => f.id === 's2') as SketchFeature).attach;

  it('sets, changes and takes away the attachment; false is not kept', () => {
    const a = applyCommand(base(), { type: 'setSketchAttach', featureId: 's2', attach: { origin, flipX: false } });
    expect(attachOf(a)).toEqual({ origin });
    const b = applyCommand(a, { type: 'setSketchAttach', featureId: 's2', attach: { origin, x: edge, flipX: true } });
    expect(attachOf(b)).toEqual({ origin, x: edge, flipX: true });
    expect(attachOf(applyCommand(b, { type: 'setSketchAttach', featureId: 's2', attach: null }))).toBeUndefined();
  });

  it('refuses an empty attachment (null takes it away), a face or an edge for the origin, a vertex or a face for x', () => {
    const run = (attach: SketchAttach) => () => applyCommand(base(), { type: 'setSketchAttach', featureId: 's2', attach });
    expect(run({})).toThrow(CommandError);
    expect(run({})).toThrow(t('cmd.sketchAttachEmpty'));
    expect(run({ origin: edge })).toThrow(t('cmd.mustPickPoint'));
    expect(run({ origin: { kind: 'face', name: 'e1:cap:end' } })).toThrow(CommandError);
    expect(run({ x: origin })).toThrow(t('cmd.axisMustBeStraightEdge'));
    expect(run({ x: { kind: 'face', name: 'e1:cap:end' } })).toThrow(CommandError);
  });

  it('a reference point or axis must be earlier than the sketch', () => {
    const late = applyCommand(base(), { type: 'insertFeature', index: 4, feature: { id: 'pt', type: 'refPoint', name: '點1', suppressed: false, def: { mode: 'coords', x: '1', y: '2', z: '3' } } as Feature });
    expect(() => applyCommand(late, { type: 'setSketchAttach', featureId: 's2', attach: { origin: { kind: 'datum', name: 'pt' } } })).toThrow(t('cmd.refPointMustBeEarlier'));
  });

  it('a new sketch with an attachment is checked the same way', () => {
    const bad = { ...sketch('s3', onPl), attach: {} } as Feature;
    expect(() => applyCommand(base(), { type: 'insertFeature', feature: bad, index: 4 })).toThrow(t('cmd.sketchAttachEmpty'));
  });

  it('only a sketch has one', () => {
    expect(() => applyCommand(base(), { type: 'setSketchAttach', featureId: 'e1', attach: { origin } })).toThrow(CommandError);
  });
});

describe('the dependency graph, the repair of references and the file', () => {
  let d: PartDoc;
  let sk: Feature;
  beforeAll(() => {
    const m = model();
    d = doc({ origin: m.vertex([30, 0, 10]), x: m.edgeAlong(HYP) });
    sk = d.features.find((f) => f.id === 's2')!;
  });

  it('the sketch is a child of the feature that made the vertex and the edge', () => {
    expect(parentsOf(sk, d)).toContain('e1');
    expect(parentsOf(sk, d)).toContain('pl');
  });

  it('a reference point of the history is a parent too', () => {
    const withPoint = build(...prism(), { id: 'pt', type: 'refPoint', name: '點1', suppressed: false, def: { mode: 'coords', x: '1', y: '2', z: '3' } } as Feature, s2({ origin: { kind: 'datum', name: 'pt' } }));
    expect(parentsOf(withPoint.features.find((f) => f.id === 's2')!, withPoint)).toContain('pt');
  });

  it('mapRefs reaches the references of an attachment (the repair of lost references)', () => {
    const seen: string[] = [];
    const out = mapRefs(sk, (r) => {
      seen.push(r.name);
      return r.kind === 'vertex' ? { ...r, name: 'moved' } : r;
    });
    expect(seen).toContain((sk as SketchFeature).attach!.origin!.name);
    expect(seen).toContain((sk as SketchFeature).attach!.x!.name);
    expect((out.feature as SketchFeature).attach!.origin!.name).toBe('moved');
    expect(out.replaced).toBe(1);
  });

  it('is written as the current version (73 or later) and read back with its attachment', () => {
    const file = serializePart(d);
    expect(JSON.parse(file).schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(73);
    expect((parsePart(file).features.find((f) => f.id === 's2') as SketchFeature).attach).toEqual((sk as SketchFeature).attach);
  });
});

describe('random attachments (AGENTS 3.4): never a crash, and the frame is square and right-handed or the reason is given', () => {
  // mulberry32: the same sequence every run
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  it('150 combinations of vertex, edge, flip and plane distance', () => {
    const w = 30;
    const r0 = regen().rebuild(build(...prism(w)));
    const { topology, names } = r0.body!;
    expect(topology.vertices.length).toBeGreaterThan(0);
    const lines = topology.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.curve === 'line' && e.dir);
    expect(lines.length).toBeGreaterThan(0);
    const next = rng(20261021);
    let refused = 0;
    let made = 0;
    for (let n = 0; n < 150; n++) {
      const attach: SketchAttach = {};
      if (next() < 0.7) attach.origin = { kind: 'vertex', name: names.vertices[Math.floor(next() * topology.vertices.length)]! };
      const pick = lines[Math.floor(next() * lines.length)]!;
      if (next() < 0.7) attach.x = { kind: 'edge', name: names.edges[pick.i]!, fingerprint: edgeFingerprint(topology, pick.i) };
      if (next() < 0.5) attach.flipX = true;
      if (!attach.origin && !attach.x && !attach.flipX) attach.flipX = true;
      const distance = 10 + Math.floor(next() * 60);
      const features = [triangle(w), extrude('e1', 's0', 'boss', { type: 'blind', depth: '10' }), pl(distance), s2(attach)];
      const r = regen().rebuild(build(...features));
      const s = sketchStatus(r);
      const squareEdge = attach.x && Math.abs(Math.abs((topology.edges[names.edges.indexOf(attach.x.name)]!.dir as V3)[2]) - 1) < 1e-9;
      if (squareEdge) {
        expect(s.status, `n=${n}`).toBe('error');
        expect(s.message).toBe(t('sketch.attachXSquare'));
        refused++;
      } else {
        expect(s.status, `n=${n} ${s.message ?? ''}`).toBe('ok');
        const f = frameOf(r);
        expect(Math.hypot(...(f.xDir as V3))).toBeCloseTo(1, 12);
        expect(Math.hypot(...(f.yDir as V3))).toBeCloseTo(1, 12);
        expect(dot(f.xDir as V3, f.yDir as V3)).toBeCloseTo(0, 12);
        expect(close(cross(f.xDir as V3, f.yDir as V3), f.normal as V3, 1e-12)).toBe(true);
        // the origin is on the plane z = distance
        expect(f.origin[2]).toBeCloseTo(distance, 9);
        made++;
      }
    }
    // both outcomes happened: a run that never refused or never built proves nothing
    expect(refused).toBeGreaterThan(0);
    expect(made).toBeGreaterThan(0);
  });
});
