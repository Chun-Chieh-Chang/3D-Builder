/**
 * 4a-1 (docs/phase4a-plan.md): an assembly made from the bodies of a master model (C7.5), opened the way the app opens a project, mated on the faces
 * of the derived parts, and followed through a change of the master.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAssemblyCommand, buildBom, dirName, joinPath, type AssemblyDoc, type Mate, type PartDoc, type SourceTree } from '@3db/model';
import { derivedAssemblyFiles, readDocumentFile, writePartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, solveAssembly, type MatePart, type SourcePart } from '@3db/regen';
import { master } from '../support/derivedFixtures';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const BODIES = [
  { id: 'ew', name: '工件' },
  { id: 'eb', name: '基板' },
  { id: 'ec', name: '壓板' },
];

/** The project as a map of path → bytes: the master and what the assembly was made of. */
async function project(masterDoc: PartDoc) {
  const made = await derivedAssemblyFiles({ masterFile: '夾具.3dbx', stem: '夾具', bodies: BODIES });
  const files = new Map<string, Uint8Array>([['夾具.3dbx', await writePartFile(masterDoc)], ...made.files.map((f) => [f.path, f.bytes] as const)]);
  return { made, files };
}

/** A file of the project as another part reads it: its document, and a way to find the files it is derived from (paths relative to it). */
async function sourceAt(files: Map<string, Uint8Array>, path: string): Promise<SourcePart | undefined> {
  const bytes = files.get(path);
  if (!bytes) return undefined;
  const file = await readDocumentFile(bytes);
  if (file.kind !== 'part') return undefined;
  const loaded = new Map<string, SourcePart | undefined>();
  for (const f of file.doc.features) if (f.type === 'derivedBody') loaded.set(f.source, await sourceAt(files, joinPath(dirName(path), f.source)));
  return { key: path, doc: file.doc, blobs: file.blobs, sources: { get: (p) => loaded.get(p) } };
}

/** Each derived part of the project rebuilt, as the assembly's mates see it. */
async function open(files: Map<string, Uint8Array>, made: Awaited<ReturnType<typeof project>>['made']) {
  const out = new Map<string, { mate: MatePart; volume: number; reference: boolean[] }>();
  for (const path of made.parts.values()) {
    const src = (await sourceAt(files, path))!;
    const regen = new Regenerator(kernel, solver, src.blobs, src.sources);
    kept.push(regen);
    const r = regen.rebuild(src.doc);
    out.set(path, { mate: { topology: r.body!.topology, names: r.body!.names, frames: r.frames }, volume: kernel.massProps(r.body!.shape).volume, reference: r.bodies.map((b) => b.reference) });
  }
  const main = await readDocumentFile(files.get(made.main)!);
  if (main.kind !== 'assembly') throw new Error('main');
  return { parts: out, assembly: main.doc };
}

describe('an assembly from the bodies of a master model (4a-1)', () => {
  it('is one derived part file per body and an assembly with a component for each, in place and fixed', async () => {
    const { made, files } = await project(master());
    expect([...made.files.map((f) => f.path)].sort()).toEqual(['夾具 組合件.3dba', '零件/基板.3dbx', '零件/壓板.3dbx', '零件/工件.3dbx'].sort());
    expect(made.main).toBe('夾具 組合件.3dba');
    const part = await readDocumentFile(files.get('零件/基板.3dbx')!);
    if (part.kind !== 'part') throw new Error('part');
    // nothing but where it comes from: no shape, no sketches
    expect(part.doc.features).toEqual([{ id: 'derived1', type: 'derivedBody', name: '基板', suppressed: false, source: '../夾具.3dbx', body: 'eb' }]);
    const asm = await readDocumentFile(files.get(made.main)!);
    if (asm.kind !== 'assembly') throw new Error('assembly');
    expect(asm.doc.files.map((f) => f.path)).toEqual(['零件/工件.3dbx', '零件/基板.3dbx', '零件/壓板.3dbx']);
    expect(asm.doc.components.map((c) => [c.instance, c.fixed, c.placement.position, c.placement.rotation])).toEqual(Array(3).fill([1, true, [0, 0, 0], [0, 0, 0, 1]]));
  });

  it('keeps names that are taken: a second assembly from the same master does not write over the first', async () => {
    const second = await derivedAssemblyFiles({ masterFile: '夾具.3dbx', stem: '夾具', bodies: BODIES, taken: ['夾具 組合件.3dba', '零件/基板.3dbx'] });
    expect(second.main).toBe('夾具 組合件 (2).3dba');
    expect(second.parts.get('eb')).toBe('零件/基板 (2).3dbx');
    expect(second.parts.get('ew')).toBe('零件/工件.3dbx');
  });

  it('opens with every part the body of the master it was made from: the volumes, and the workpiece a reference body', async () => {
    const { made, files } = await project(master());
    const opened = await open(files, made);
    expect([...opened.parts].map(([path, p]) => [path, p.volume])).toEqual([['零件/工件.3dbx', 120000], ['零件/基板.3dbx', 144000], ['零件/壓板.3dbx', 6000]].map(([a, b]) => [a, expect.closeTo(b as number, 6)]));
    expect(opened.parts.get('零件/工件.3dbx')!.reference).toEqual([true]);
    expect(opened.parts.get('零件/基板.3dbx')!.reference).toEqual([false]);
  });

  it('holds a mate on the faces of derived parts, and after the base plate of the master is made 20 thick the mate holds and the clamp is 5 higher', async () => {
    const mate: Mate = {
      id: 'mate1',
      name: '結合1',
      type: 'coincident',
      a: { component: 'comp2', ref: { kind: 'face', name: 'eb:cap:end' } },
      b: { component: 'comp3', ref: { kind: 'face', name: 'ec:cap:start' } },
      align: 'antiAligned',
      suppressed: false,
    };
    const zOf = async (baseDepth: string) => {
      const { made, files } = await project(master(baseDepth));
      const opened = await open(files, made);
      let doc: AssemblyDoc = applyAssemblyCommand(opened.assembly, { type: 'setFixed', componentIds: ['comp3'], value: false });
      doc = applyAssemblyCommand(doc, { type: 'insertMate', mate });
      const pathOf = (fileId: string) => doc.files.find((f) => f.id === fileId)!.path;
      const solved = solveAssembly(doc, (id) => {
        const c = doc.components.find((x) => x.id === id);
        return c ? opened.parts.get(pathOf(c.file))!.mate : null;
      });
      expect([...solved.mates.values()].map((m) => m.status)).toEqual(['ok']);
      return solved.poses.get('comp3')!.position;
    };
    expect((await zOf('15'))[2]).toBeCloseTo(15, 6); // the clamp's underside (z = 0 in the master) onto the top of the base plate (z = 15)
    expect((await zOf('20'))[2]).toBeCloseTo(20, 6);
  });

  it('says so when the body is gone from the master, instead of making another one', async () => {
    const { made, files } = await project(master());
    const without = { ...master() };
    without.features = without.features.filter((f) => f.id !== 'ec' && f.id !== 'sc');
    files.set('夾具.3dbx', await writePartFile(without));
    const src = (await sourceAt(files, '零件/壓板.3dbx'))!;
    const regen = new Regenerator(kernel, solver, src.blobs, src.sources);
    kept.push(regen);
    const r = regen.rebuild(src.doc);
    expect(r.features[0]!.status).toBe('error');
    expect(r.features[0]!.message).toContain('ec');
    expect(r.features[0]!.message).toContain('ew, eb');
    expect(made.parts.get('ec')).toBe('零件/壓板.3dbx');
  });
});

describe('the parts list of an assembly from bodies (4a-1)', () => {
  it('lists the base plate and the clamp and leaves the workpiece out, a reference body being a design aid', async () => {
    const { made, files } = await project(master());
    const opened = await open(files, made);
    const trees: Record<string, SourceTree> = {};
    opened.assembly.components.forEach((c) => {
      const path = opened.assembly.files.find((f) => f.id === c.file)!.path;
      trees[c.id] = { kind: 'part', key: path, path };
    });
    const propsOf = () => ({});
    const all = buildBom({ doc: opened.assembly, trees, propsOf });
    expect(all.flat.map((r) => [r.name, r.qty])).toEqual([['工件', 1], ['基板', 1], ['壓板', 1]]);
    const without = buildBom({ doc: opened.assembly, trees, propsOf, isReference: (key) => opened.parts.get(key)!.reference.every(Boolean) });
    expect(without.flat.map((r) => [r.name, r.qty])).toEqual([['基板', 1], ['壓板', 1]]);
    expect(without.indented.map((r) => r.item)).toEqual(['1', '2']);
  });
});
