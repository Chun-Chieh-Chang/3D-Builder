/**
 * Phase 1B exit criterion (handoff §9): persistent naming survives booleans.
 * References stored by name must keep landing on the same geometric edge while the model changes,
 * including faces split by a cut ("#k" in geometric order).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, edge, face, faceNamed, front, rectangle, sketch, statuses } from './builders';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

describe('names through boss, cut, fillet and chamfer', () => {
  interface V {
    W: number; D: number; T: number; // plate
    bx: number; by: number; w: number; d: number; h: number; // boss
    r: number; R: number; // hole radius, fillet radius
  }
  const FILLET = 'f1:fillet:{e2:cap:end|e2:side:s2.bl0}';
  const CHAMFER = 'ch1:chamfer:{e1:cap:end|e1:side:s1.al1}';

  /**
   * Plate → boss sketched on the plate's top face → hole through both, sketched on the boss's top →
   * fillet on the boss's top front edge → chamfer on the plate's top right edge. Every reference is a name.
   */
  function part(v: V): PartDoc {
    return build(
      sketch('s1', front, rectangle('a', 0, 0, v.W, v.D)),
      { id: 'e1', type: 'extrude', name: 'e1', suppressed: false, sketch: 's1', op: 'boss', dir1: { type: 'blind', depth: String(v.T) } },
      sketch('s2', face('e1:cap:end'), rectangle('b', v.bx, v.by, v.w, v.d)),
      { id: 'e2', type: 'extrude', name: 'e2', suppressed: false, sketch: 's2', op: 'boss', dir1: { type: 'blind', depth: String(v.h) } },
      sketch('s3', face('e2:cap:end'), {
        entities: [
          { id: 'kc', type: 'point', x: v.bx + v.w / 2, y: v.by + v.d / 2 },
          { id: 'k', type: 'circle', center: 'kc', radius: v.r },
        ],
        constraints: [
          { id: 'kr', type: 'radius', circle: 'k', value: String(v.r) },
          { id: 'kx', type: 'distanceX', a: '@origin', b: 'kc', value: String(v.bx + v.w / 2) },
          { id: 'ky', type: 'distanceY', a: '@origin', b: 'kc', value: String(v.by + v.d / 2) },
        ],
      }),
      { id: 'c1', type: 'extrude', name: 'c1', suppressed: false, sketch: 's3', op: 'cut', dir1: { type: 'throughAll' } },
      { id: 'f1', type: 'fillet', name: 'f1', suppressed: false, edges: [edge('{e2:cap:end|e2:side:s2.bl0}')], radius: String(v.R) },
      { id: 'ch1', type: 'chamfer', name: 'ch1', suppressed: false, edges: [edge('{e1:cap:end|e1:side:s1.al1}')], mode: 'distanceDistance', distance: '1', second: '1' },
    );
  }

  const base: V = { W: 60, D: 40, T: 10, bx: 10, by: 10, w: 30, d: 20, h: 15, r: 4, R: 3 };
  const variations: V[] = [
    base,
    { ...base, W: 80 },
    { ...base, D: 50, by: 15 },
    { ...base, T: 12 },
    { ...base, bx: 20 },
    { ...base, w: 20, d: 25 },
    { ...base, h: 25 },
    { ...base, r: 6 },
    { ...base, R: 5 },
    { W: 90, D: 70, T: 8, bx: 25, by: 30, w: 40, d: 30, h: 20, r: 7, R: 4 },
  ];

  it.each(variations.map((v, i) => [i + 1, v] as const))('variation %i keeps the fillet and the chamfer on their edges with exact volume', (_, v) => {
    const r = regen.rebuild(part(v));
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 's2=ok', 'e2=ok', 's3=ok', 'c1=ok', 'f1=ok', 'ch1=ok']);
    const top = v.T + v.h;
    // The fillet runs along the boss's top front edge: y just above by, z just below the boss top.
    const fillet = faceNamed(r, FILLET);
    expect(fillet.surface).toBe('cylinder');
    expect(fillet.center[0]).toBeCloseTo(v.bx + v.w / 2, 6);
    expect(fillet.center[1]).toBeGreaterThan(v.by);
    expect(fillet.center[1]).toBeLessThan(v.by + v.R);
    expect(fillet.center[2]).toBeGreaterThan(top - v.R);
    expect(fillet.center[2]).toBeLessThan(top);
    // The chamfer runs along the plate's top right edge (x = W, z = T).
    const chamfer = faceNamed(r, CHAMFER);
    expect(chamfer.center[0]).toBeGreaterThan(v.W - 1);
    expect(chamfer.center[2]).toBeGreaterThan(v.T - 1);
    const expected = v.W * v.D * v.T + v.w * v.d * v.h - Math.PI * v.r ** 2 * top - (1 - Math.PI / 4) * v.R ** 2 * v.w - 0.5 * v.D;
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(expected, 5);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
  });
});

describe('faces split by a cut', () => {
  /** A 60 × 40 × 10 plate with a through slot across it at x = s … s + 6, and a fillet on the right piece's outer edge. */
  function slotted(s: number): PartDoc {
    return build(
      sketch('s1', front, rectangle('a', 0, 0, 60, 40)),
      { id: 'e1', type: 'extrude', name: 'e1', suppressed: false, sketch: 's1', op: 'boss', dir1: { type: 'blind', depth: '10' } },
      sketch('s2', face('e1:cap:end'), rectangle('s', s, -5, 6, 50)),
      { id: 'c1', type: 'extrude', name: 'c1', suppressed: false, sketch: 's2', op: 'cut', dir1: { type: 'throughAll' } },
      { id: 'f1', type: 'fillet', name: 'f1', suppressed: false, edges: [edge('{e1:cap:end#2|e1:side:s1.al1}')], radius: '2' },
    );
  }

  it.each([10, 20, 27, 40])('names the two pieces of the top face in geometric order (slot at x = %i)', (s) => {
    const r = regen.rebuild(slotted(s));
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 's2=ok', 'c1=ok', 'f1=ok']);
    const left = faceNamed(r, 'e1:cap:end#1');
    const right = faceNamed(r, 'e1:cap:end#2');
    expect(left.center[0]).toBeLessThan(s);
    expect(right.center[0]).toBeGreaterThan(s + 6);
    // the fillet referenced the right piece's edge on the plate's right side and stays there
    const fillet = faceNamed(r, 'f1:fillet:{e1:cap:end#2|e1:side:s1.al1}');
    expect(fillet.center[0]).toBeGreaterThan(58);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(60 * 40 * 10 - 6 * 40 * 10 - (1 - Math.PI / 4) * 4 * 40, 5);
  });

  it('keeps a reference made before a cut that is inserted earlier and splits its face', () => {
    // The fillet is made on the whole plate; then the slot is inserted above it in the history.
    const plate = build(
      sketch('s1', front, rectangle('a', 0, 0, 60, 40)),
      { id: 'e1', type: 'extrude', name: 'e1', suppressed: false, sketch: 's1', op: 'boss', dir1: { type: 'blind', depth: '10' } },
      { id: 'f1', type: 'fillet', name: 'f1', suppressed: false, edges: [edge('{e1:cap:end|e1:side:s1.al1}')], radius: '2' },
    );
    expect(statuses(regen.rebuild(plate))).toEqual(['s1=ok', 'e1=ok', 'f1=ok']);
    const withSlot = [
      sketch('s2', face('e1:cap:end'), rectangle('s', 20, -5, 6, 50)),
      { id: 'c1', type: 'extrude', name: 'c1', suppressed: false, sketch: 's2', op: 'cut', dir1: { type: 'throughAll' } } as Feature,
    ].reduce((doc, feature, i) => applyCommand(doc, { type: 'insertFeature', feature, index: 2 + i }), plate);
    const r = regen.rebuild(withSlot);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 's2=ok', 'c1=ok', 'f1=ok']);
    // the edge now borders the right piece, "{e1:cap:end#2|…}", and the fillet followed it
    expect(faceNamed(r, 'f1:fillet:{e1:cap:end#2|e1:side:s1.al1}').center[0]).toBeGreaterThan(58);
  });

  it('reports a reference that matches nothing instead of guessing', () => {
    const bad = applyCommand(slotted(20), { type: 'setEdges', featureId: 'f1', edges: [edge('{e1:cap:end|e1:side:s1.al9}')] });
    expect(regen.rebuild(bad).features.at(-1)).toMatchObject({ status: 'error', unresolved: [{ reason: 'missing' }] });
  });
});
