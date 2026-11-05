/**
 * ADR 0236 「設計配合件…」: a locked body is changed by no feature. A boss beside it is a body of its own (「配合件1」), a cut leaves it as it is, a
 * combine cannot change it but may subtract it, and any other feature that would change or remove it fails and keeps nothing it made. Each case has
 * its control without the lock, so the test shows the lock is what makes the difference. Volumes are measured by the kernel.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, parsePart, SCHEMA_VERSION, serializePart, type CombineFeature, type Feature, type PartDoc, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, fillet, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failed = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volumeOf = (r: RebuildResult, id: string) => {
  const b = r.bodies.find((x) => x.id === id);
  if (!b) throw new Error(`no body ${id} in ${r.bodies.map((x) => x.id).join(', ')}`);
  return kernel.massProps(b.shape).volume;
};
const add = (doc: PartDoc, ...features: Feature[]) => features.reduce((d, feature) => applyCommand(d, { type: 'insertFeature', feature, index: d.features.length }), doc);
const lock = (doc: PartDoc, id: string) => applyCommand(doc, { type: 'setBody', bodyId: id, reference: true, locked: true });
const combine = (id: string, op: CombineFeature['op'], main: string, ...tools: string[]): Feature => ({ id, type: 'combine', name: id, suppressed: false, op, main: { kind: 'body', name: main }, tools: tools.map((name) => ({ kind: 'body', name })) });

/** A block x0..x1 × 0..10, 10 high: (x1 − x0) × 100 mm³. */
const block = (n: number, x0: number, x1: number): Feature[] => [
  sketch(`s${n}`, front, rectangle(`r${n}`, x0, 0, x1 - x0, 10)),
  extrude(`e${n}`, `s${n}`, 'boss', { type: 'blind', depth: '10' }),
];
/** A slot through everything, x0..x1 across the full width. */
const slot = (n: number, x0: number, x1: number): Feature[] => [
  sketch(`t${n}`, front, rectangle(`q${n}`, x0, -5, x1 - x0, 20)),
  extrude(`c${n}`, `t${n}`, 'cut', { type: 'throughAll', reverse: true }),
];

/** The reference: a block 0..30 (3000 mm³), locked; a mating block 20..40 overlaps it by 10. */
const reference = () => lock(build(...block(1, 0, 30)), 'e1');
const unchanged = (v: number, expected: number) => expect(Math.abs(v - expected) / expected).toBeLessThan(1e-9);

describe('locking an already machined body', () => {
  it('keeps v90 locks unchanged and clears the boundary when unlocked', () => {
    const legacy = build(...block(1, 0, 30));
    const raw = JSON.parse(serializePart(legacy));
    raw.schemaVersion = 90;
    raw.bodies.e1 = { locked: true, reference: true };
    const migrated = parsePart(JSON.stringify(raw));
    expect(migrated.bodies.e1).toEqual({ locked: true, reference: true });
    expect(failed(rebuild(add(migrated, ...slot(1, 5, 10))))).not.toEqual([]);
    const locked = lock(legacy, 'e1');
    const renamed = applyCommand(locked, { type: 'setBody', bodyId: 'e1', name: 'reference', locked: true });
    expect(renamed.bodies.e1!.lockedAfter).toBe('e1');
    const unlocked = applyCommand(renamed, { type: 'setBody', bodyId: 'e1', locked: false });
    expect(unlocked.bodies.e1).not.toHaveProperty('lockedAfter');
    expect(failed(rebuild(add(unlocked, ...slot(1, 5, 10))))).toEqual([]);
  });
  it('preserves an existing fillet and serializes its protection boundary', () => {
    const base = build(...block(1, 0, 30));
    const original = rebuild(base);
    const edge: Ref = { kind: 'edge', name: original.body!.names.edges[0]! };
    const rounded = add(base, fillet('f0', [edge], '1'));
    const before = rebuild(rounded);
    expect(failed(before)).toEqual([]);
    const locked = parsePart(serializePart(lock(rounded, 'e1')));
    expect(locked.bodies.e1!.lockedAfter).toBe('f0');
    const after = rebuild(locked);
    expect(failed(after)).toEqual([]);
    unchanged(volumeOf(after, 'e1'), volumeOf(before, 'e1'));
  });

  it('preserves cuts made before locking and rejects cuts added after locking', () => {
    const machined = build(...block(1, 0, 30), ...slot(1, 5, 10));
    const before = rebuild(machined);
    expect(failed(before)).toEqual([]);
    const volume = volumeOf(before, 'e1');
    expect(volume).toBeLessThan(3000);
    const locked = lock(machined, 'e1');
    const after = rebuild(locked);
    expect(failed(after)).toEqual([]);
    unchanged(volumeOf(after, 'e1'), volume);
    const later = rebuild(add(locked, ...slot(2, 15, 20)));
    expect(later.features.find(f => f.id === 'c2')?.status).toBe('error');
    unchanged(volumeOf(later, 'e1'), volume);
  });
});

describe('AC4: a boss beside a locked body is a body of its own', () => {
  it('is 「配合件1」, the locked body keeps its volume, and a second boss joins the mating part', () => {
    const r1 = rebuild(add(reference(), ...block(2, 20, 40)));
    expect(failed(r1)).toEqual([]);
    expect(r1.bodies.map((b) => b.id)).toEqual(['e1', 'e2']);
    unchanged(volumeOf(r1, 'e1'), 3000);
    unchanged(volumeOf(r1, 'e2'), 2000); // the whole boss: nothing of it went into the reference
    expect(r1.bodies.map((b) => b.name)).toEqual(['e1', '配合件1']);
    expect(r1.bodies.map((b) => !!b.locked)).toEqual([true, false]);

    const r2 = rebuild(add(reference(), ...block(2, 20, 40), ...block(3, 35, 50)));
    expect(failed(r2)).toEqual([]);
    expect(r2.bodies.map((b) => b.id)).toEqual(['e1', 'e2']); // the third block joined the mating part, not the reference
    unchanged(volumeOf(r2, 'e1'), 3000);
    unchanged(volumeOf(r2, 'e2'), 3000); // x20..50
  });

  it('control: without the lock the boss joins the reference (one body)', () => {
    const r = rebuild(add(build(...block(1, 0, 30)), ...block(2, 20, 40)));
    expect(failed(r)).toEqual([]);
    expect(r.bodies.map((b) => b.id)).toEqual(['e1']);
    unchanged(volumeOf(r, 'e1'), 4000);
  });
});

describe('AC5: a cut through a locked body leaves it as it is', () => {
  it('cuts the mating part only', () => {
    const r = rebuild(add(reference(), ...block(2, 20, 40), ...slot(1, 10, 25)));
    expect(failed(r)).toEqual([]);
    unchanged(volumeOf(r, 'e1'), 3000);
    unchanged(volumeOf(r, 'e2'), 1500); // x25..40
  });

  it('control: without the lock the cut takes from both', () => {
    const r = rebuild(add(build(...block(1, 0, 30)), ...block(2, 50, 70), ...slot(1, 10, 25)));
    expect(failed(r)).toEqual([]);
    expect(volumeOf(r, 'e1')).toBeLessThan(3000 - 1);
  });

  it('a cut that reaches only the locked body removed nothing, and says so', () => {
    const r = rebuild(add(reference(), ...block(2, 50, 70), ...slot(1, 10, 25)));
    expect(r.features.find((f) => f.id === 'c1')?.status).toBe('error');
    unchanged(volumeOf(r, 'e1'), 3000);
  });
});

describe('AC6: combine', () => {
  it('cannot change a locked main body, and says why', () => {
    const r = rebuild(add(reference(), ...block(2, 20, 40), combine('k1', 'subtract', 'e1', 'e2')));
    const k1 = r.features.find((f) => f.id === 'k1')!;
    expect(k1.status).toBe('error');
    expect(k1.message).toContain('已鎖定');
    expect(k1.message).toContain('e1');
    unchanged(volumeOf(r, 'e1'), 3000);
  });

  it('may subtract a locked tool, which stays as it is (a socket)', () => {
    const r = rebuild(add(reference(), ...block(2, 20, 40), combine('k1', 'subtract', 'e2', 'e1')));
    expect(failed(r)).toEqual([]);
    expect(r.bodies.map((b) => b.id)).toEqual(['e1', 'e2']);
    unchanged(volumeOf(r, 'e1'), 3000);
    unchanged(volumeOf(r, 'e2'), 1000); // x30..40
  });

  it('cannot add a locked tool (that would use it up)', () => {
    const r = rebuild(add(reference(), ...block(2, 20, 40), combine('k1', 'add', 'e2', 'e1')));
    expect(r.features.find((f) => f.id === 'k1')?.status).toBe('error');
    unchanged(volumeOf(r, 'e1'), 3000);
  });
});

describe('every other feature: one that would change a locked body fails', () => {
  const edgeOf = (r: RebuildResult, id: string): Ref => {
    const b = r.bodies.find((x) => x.id === id)!;
    return { kind: 'edge', name: r.body!.names.edges[b.edge0]! };
  };

  it('a fillet on its edge fails with the lock message and the body is as it was', () => {
    const base = reference();
    const r0 = rebuild(base);
    const r = rebuild(add(base, fillet('f1', [edgeOf(r0, 'e1')], '1')));
    const f1 = r.features.find((f) => f.id === 'f1')!;
    expect(f1.status).toBe('error');
    expect(f1.message).toContain('已鎖定');
    unchanged(volumeOf(r, 'e1'), 3000);
  });

  it('control: without the lock the same fillet works', () => {
    const base = build(...block(1, 0, 30));
    const r0 = rebuild(base);
    const r = rebuild(add(base, fillet('f1', [edgeOf(r0, 'e1')], '1')));
    expect(failed(r)).toEqual([]);
    expect(volumeOf(r, 'e1')).toBeLessThan(3000);
  });
});

describe('names', () => {
  it('a body made before the locked one keeps its own name; one the user named keeps that name', () => {
    let doc = lock(build(...block(1, 0, 10), ...block(2, 50, 60)), 'e2');
    doc = add(doc, ...block(3, 100, 110), ...block(4, 150, 160));
    doc = applyCommand(doc, { type: 'setBody', bodyId: 'e4', name: '蓋' });
    const r = rebuild(doc);
    expect(failed(r)).toEqual([]);
    expect(r.bodies.map((b) => b.name)).toEqual(['e1', 'e2', '配合件1', '蓋']);
  });
});

describe('AC9: documents without the lock are as before', () => {
  it('a reference body that is not locked is still joined by a boss beside it', () => {
    const doc = add(applyCommand(build(...block(1, 0, 30)), { type: 'setBody', bodyId: 'e1', reference: true }), ...block(2, 20, 40));
    const r = rebuild(doc);
    expect(failed(r)).toEqual([]);
    expect(r.bodies.map((b) => b.id)).toEqual(['e1']);
    unchanged(volumeOf(r, 'e1'), 4000);
    expect(r.bodies[0]!.name).toBe('e1');
  });

  it('unlocking takes the lock away entirely, and the part behaves as before', () => {
    const doc = applyCommand(add(reference(), ...block(2, 20, 40)), { type: 'setBody', bodyId: 'e1', locked: false });
    expect(doc.bodies.e1).toEqual({ reference: true });
    const r = rebuild(doc);
    expect(r.bodies.map((b) => b.id)).toEqual(['e1']);
  });
});

describe('the file', () => {
  it('keeps the lock, written at the current schema version (≥ 90, where it came in)', () => {
    const doc = add(reference(), ...block(2, 20, 40));
    const text = serializePart(doc);
    const back = parsePart(text);
    expect(back.bodies.e1).toEqual({ reference: true, locked: true, lockedAfter: 'e1' });
    expect(JSON.parse(text).schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(90);
  });
});

describe('AC11: shapes', () => {
  it('rebuilds keep the shape count, also when a feature fails on the locked body', () => {
    const good = add(reference(), ...block(2, 20, 40), ...slot(1, 10, 25), combine('k1', 'subtract', 'e2', 'e1'));
    const r1 = new Regenerator(kernel, solver);
    r1.rebuild(good);
    const live = kernel.liveShapes;
    expect(live).toBeGreaterThan(0);
    for (let n = 0; n < 5; n++) r1.rebuild(good);
    expect(kernel.liveShapes).toBe(live);
    r1.dispose();

    const bad = add(reference(), ...block(2, 20, 40), combine('k1', 'subtract', 'e1', 'e2'));
    const r2 = new Regenerator(kernel, solver);
    r2.rebuild(bad);
    const before = kernel.liveShapes;
    for (let n = 0; n < 5; n++) r2.rebuild(bad);
    expect(kernel.liveShapes).toBe(before);
    r2.dispose();
  });
});
