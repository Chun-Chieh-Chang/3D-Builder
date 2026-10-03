/**
 * 4a-0 / 4a-1 (docs/phase4a-plan.md): a body of another part file (C7.5). The derived part holds only where its body comes from; its shape is the
 * master's body, cloned, and its faces keep the names the master's have.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type Feature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type SourcePart, type SourceProvider } from '@3db/regen';
import { build, circle, extrude, front, rectangle, sketch, statuses } from '../phase1/builders';
import { symmetricDifference } from '../support/acceptance';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const own = (e: Feature): Feature => ({ ...e, merge: false }) as Feature;

/** A fixture's master model: the workpiece (a reference body, 100 × 60 × 20), the base plate (120 × 80 × 15) and a clamp (30 × 20 × 10), apart. */
function master(baseDepth = '15'): PartDoc {
  let doc = build(
    sketch('sw', front, rectangle('a', 0, 0, 100, 60)),
    own(extrude('ew', 'sw', 'boss', { type: 'blind', depth: '20' })),
    sketch('sb', front, rectangle('b', -10, -100, 120, 80)),
    own(extrude('eb', 'sb', 'boss', { type: 'blind', depth: baseDepth })),
    sketch('sc', front, rectangle('c', 0, 80, 30, 20)),
    own(extrude('ec', 'sc', 'boss', { type: 'blind', depth: '10' })),
  );
  doc = applyCommand(doc, { type: 'setBody', bodyId: 'ew', name: '工件', reference: true });
  doc = applyCommand(doc, { type: 'setBody', bodyId: 'eb', name: '基板' });
  return doc;
}

const derived = (source: string, body: string, id = 'd1'): PartDoc =>
  applyCommand(createEmptyPart(), { type: 'insertFeature', feature: { id, type: 'derivedBody', name: '衍生本體1', suppressed: false, source, body }, index: 0 });

const provider = (files: Record<string, SourcePart>): SourceProvider => ({ get: (path) => files[path] });
const file = (key: string, doc: PartDoc, sources?: SourceProvider): SourcePart => ({ key, doc, blobs: new Map(), ...(sources ? { sources } : {}) });
const regen = (sources?: SourceProvider) => {
  const r = new Regenerator(kernel, solver, new Map(), sources);
  kept.push(r);
  return r;
};

describe('a derived body (C7.5)', () => {
  const masterDoc = master();
  const sources = provider({ '夾具.3dbx': file('夾具.3dbx', masterDoc) });

  it("is the master's body: its volume, its faces, the names of its faces", () => {
    const m = regen().rebuild(masterDoc);
    for (const [id, volume] of [['ew', 120000], ['eb', 144000], ['ec', 6000]] as const) {
      const info = m.bodies.find((b) => b.id === id)!;
      const r = regen(sources).rebuild(derived('夾具.3dbx', id));
      expect(statuses(r)).toEqual(['d1=ok']);
      expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(volume, 6);
      expect(r.body!.topology.faces.length).toBe(info.faces);
      expect(r.body!.names.faces).toEqual(m.body!.names.faces.slice(info.face0, info.face0 + info.faces));
      expect(r.body!.names.edges).toEqual(m.body!.names.edges.slice(info.edge0, info.edge0 + info.edges));
      expect(r.body!.names.vertices).toEqual(m.body!.names.vertices.slice(info.vertex0, info.vertex0 + info.vertices));
      // the faces are where the master has them: same surface, area and centre, face by face
      const a = kernel.topology(info.shape).faces;
      r.body!.topology.faces.forEach((f, i) => {
        expect(f.surface).toBe(a[i]!.surface);
        f.center.forEach((v, k) => expect(v).toBeCloseTo(a[i]!.center[k]!, 9));
        expect(f.area).toBeCloseTo(a[i]!.area, 9);
      });
    }
    // the names are the master's own: the base plate's top is where the master's extrusion made it
    expect(regen(sources).rebuild(derived('夾具.3dbx', 'eb')).body!.names.faces).toContain('eb:cap:end');
  });

  it('takes its name and whether it is a reference body from the master; its own name wins, and the reference flag stays as the master has it', () => {
    expect(regen(sources).rebuild(derived('夾具.3dbx', 'ew')).bodies.map((b) => [b.name, b.reference])).toEqual([['工件', true]]);
    expect(regen(sources).rebuild(derived('夾具.3dbx', 'ec')).bodies.map((b) => [b.name, b.reference])).toEqual([['ec', false]]);
    const overridden = applyCommand(derived('夾具.3dbx', 'ew'), { type: 'setBody', bodyId: 'd1', name: '毛胚', reference: false });
    // a reference body of the master stays one: to be a part of the fixture it has to be one in the master
    expect(regen(sources).rebuild(overridden).bodies.map((b) => [b.name, b.reference])).toEqual([['毛胚', true]]);
  });

  it('follows the master: the base plate 20 thick is the base plate built 20 thick from nothing, and the names of its faces are the same', () => {
    const before = regen(sources).rebuild(derived('夾具.3dbx', 'eb'));
    const namesBefore = [...before.body!.names.faces];
    const after = regen(provider({ '夾具.3dbx': file('夾具.3dbx', master('20')) })).rebuild(derived('夾具.3dbx', 'eb'));
    expect(kernel.massProps(after.body!.shape).volume).toBeCloseTo(120 * 80 * 20, 6);
    expect(after.body!.names.faces).toEqual(namesBefore);
    const scratch = regen().rebuild(build(sketch('s', front, rectangle('a', -10, -100, 120, 80)), extrude('e', 's', 'boss', { type: 'blind', depth: '20' })));
    expect(symmetricDifference(kernel, after.body!.shape, scratch.body!.shape)).toBeLessThan(1e-6);
  });

  it('can have more features on it: a hole cut into the derived base plate, which the master does not get', () => {
    let doc = derived('夾具.3dbx', 'eb');
    const hole = circle('h', 50, -60, 5);
    doc = applyCommand(doc, { type: 'insertFeature', index: 1, feature: { id: 'sh', type: 'sketch', name: 'sh', suppressed: false, plane: { kind: 'face', name: 'eb:cap:end' }, entities: hole.entities, constraints: hole.constraints } });
    doc = applyCommand(doc, { type: 'insertFeature', index: 2, feature: extrude('cut1', 'sh', 'cut', { type: 'blind', depth: '5' }) });
    const r = regen(sources).rebuild(doc);
    expect(statuses(r).every((s) => s.endsWith('=ok'))).toBe(true);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(144000 - Math.PI * 25 * 5, 6);
    expect(kernel.massProps(regen(sources).rebuild(derived('夾具.3dbx', 'eb')).body!.shape).volume).toBeCloseTo(144000, 6);
  });

  it('does not leak shapes, however often it is rebuilt', () => {
    const r = regen(sources);
    const doc = derived('夾具.3dbx', 'eb');
    r.rebuild(doc);
    r.rebuild(doc);
    const live = kernel.liveShapes;
    for (let i = 0; i < 3; i++) r.rebuild(doc);
    expect(kernel.liveShapes).toBe(live);
  });
});

describe('what a derived body says when it cannot be made', () => {
  const sources = provider({ '夾具.3dbx': file('夾具.3dbx', master()) });
  const message = (r: ReturnType<Regenerator['rebuild']>) => r.features[0]!.message;

  it('without a way to read files', () => {
    expect(message(regen().rebuild(derived('夾具.3dbx', 'eb')))).toContain('沒有提供讀取');
  });
  it('without the master file', () => {
    expect(message(regen(sources).rebuild(derived('不存在.3dbx', 'eb')))).toContain('不存在.3dbx');
  });
  it('without the body, naming the bodies the master has', () => {
    const m = message(regen(sources).rebuild(derived('夾具.3dbx', 'e99')))!;
    expect(m).toContain('e99');
    expect(m).toContain('ew, eb, ec');
  });
  it('from a master that derives from this part (a cycle)', () => {
    const a = derived('b.3dbx', 'd1');
    const b = derived('a.3dbx', 'd1');
    const toA: SourceProvider = { get: (p) => (p === 'a.3dbx' ? file('a', a, toB) : undefined) };
    const toB: SourceProvider = { get: (p) => (p === 'b.3dbx' ? file('b', b, toA) : undefined) };
    const r = regen(toB).rebuild(a);
    expect(r.features[0]!.status).toBe('error');
    expect(r.body).toBeNull();
  });
  it('through a chain: a part derived from a part that is derived from the master', () => {
    const middle = derived('夾具.3dbx', 'eb');
    const chain = provider({ 'mid.3dbx': file('mid', middle, sources) });
    const r = regen(chain).rebuild(derived('mid.3dbx', 'd1'));
    expect(statuses(r)).toEqual(['d1=ok']);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(144000, 6);
  });
});
