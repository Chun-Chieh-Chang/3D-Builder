/**
 * STL export and import (F4.1, F2.3, ADR 0221) on real parts. What this program writes is read back by OCCT's own STL reader (RWStl, not this program's
 * reader), and what OCCT's STL writer writes is read by this program's reader: the same triangles and the volume of the solid. An STL in a part is a
 * reference mesh: it is never a body, so the bodies, their volume and the parts list are what they are without it.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, CommandError, createEmptyPart, parseStl, SCHEMA_VERSION, type BlobRef, type Feature, type PartDoc } from '@3db/model';
import { placedParts, placeMesh, readPartFile, sha256Hex, stlEntryNames, writePartFile, writeStl } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const made: ShapeId[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => made.forEach((id) => kernel.release(id)));

async function golden(name: string): Promise<{ doc: PartDoc; shape: ShapeId }> {
  const file = await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${name}`, import.meta.url))));
  const regen = new Regenerator(kernel, solver);
  const shape = kernel.copy(regen.rebuild(file.doc).body!.shape);
  regen.dispose();
  made.push(shape);
  return { doc: file.doc, shape };
}

/** An STL read by OCCT's reader (RWStl): its triangles' corners, and the volume they enclose. */
function readByOcct(bytes: Uint8Array): { triangles: number; volume: number } {
  const oc = kernel.oc;
  const path = '/stl-independent.stl';
  oc.FS.writeFile(path, bytes);
  const tri = oc.RWStl.ReadFile(path, new oc.Message_ProgressRange());
  try {
    let volume = 0;
    const p = (i: number) => {
      const n = tri.Node(i);
      const xyz = [n.X(), n.Y(), n.Z()];
      n.delete();
      return xyz;
    };
    for (let k = 1; k <= tri.NbTriangles(); k++) {
      const t = tri.Triangle(k);
      const { theN1, theN2, theN3 } = t.Get();
      t.delete();
      const [a, b, c] = [p(theN1), p(theN2), p(theN3)] as number[][];
      volume += (a![0]! * (b![1]! * c![2]! - b![2]! * c![1]!) - a![1]! * (b![0]! * c![2]! - b![2]! * c![0]!) + a![2]! * (b![0]! * c![1]! - b![1]! * c![0]!)) / 6;
    }
    return { triangles: tri.NbTriangles(), volume };
  } finally {
    tri.delete();
    oc.FS.unlink(path);
  }
}

describe('STL written by this program, read by OCCT (F4.1)', () => {
  for (const part of ['locating-plate.3dbx', 'v-block.3dbx', 'diamond-pin.3dbx']) {
    for (const format of ['binary', 'ascii'] as const) {
      it(`${part}, ${format}: OCCT reads every triangle, and the volume is the solid's to the mesh's chord error`, async () => {
        const { shape } = await golden(part);
        const mesh = kernel.mesh(shape, { relative: 1e-4, angular: 0.1 });
        const bytes = writeStl([mesh], part, { format });
        const occt = readByOcct(bytes);
        const own = parseStl(bytes);
        expect(occt.triangles).toBe(mesh.indices.length / 3);
        expect(own.indices.length / 3 + own.degenerate).toBe(mesh.indices.length / 3);
        expect(own.closed).toBe(true);
        const solid = kernel.massProps(shape).volume;
        // a fine mesh of curved faces lies inside or across them by the chord error: a few parts in ten thousand of the volume, not more
        expect(Math.abs(occt.volume / solid - 1)).toBeLessThan(2e-3);
        expect(Math.abs(own.volume / occt.volume - 1)).toBeLessThan(1e-6);
      });
    }
  }

  it('inches: OCCT reads numbers 25.4 times smaller; read back as inches the volume is the solid\'s', async () => {
    const { shape } = await golden('locating-plate.3dbx');
    const mesh = kernel.mesh(shape);
    const mm = readByOcct(writeStl([mesh], 'p', { format: 'binary', unit: 'mm' })).volume;
    const inch = writeStl([mesh], 'p', { format: 'binary', unit: 'inch' });
    expect(readByOcct(inch).volume * 25.4 ** 3 / mm).toBeCloseTo(1, 5);
    expect(parseStl(inch, 'inch').volume / mm).toBeCloseTo(1, 5);
  });

  it('the example of the help (help.exportStl): a 40 × 30 × 20 block is 12 triangles and 24000 mm³; in inches its numbers are 1/25.4', () => {
    const block = kernel.extrude({ origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] }, [{ outer: [{ kind: 'line', a: [0, 0], b: [40, 0], source: 'a' }, { kind: 'line', a: [40, 0], b: [40, 30], source: 'b' }, { kind: 'line', a: [40, 30], b: [0, 30], source: 'c' }, { kind: 'line', a: [0, 30], b: [0, 0], source: 'd' }], holes: [] }], [0, 0, 20]).shape;
    made.push(block);
    const mesh = kernel.mesh(block);
    const read = parseStl(writeStl([mesh], 'block'));
    expect(read.indices.length / 3).toBe(12);
    expect(read.volume).toBeCloseTo(24000, 6);
    const inch = parseStl(writeStl([mesh], 'block', { unit: 'inch' }), 'mm');
    expect(inch.max).toEqual([40, 30, 20].map((x) => expect.closeTo(x / 25.4, 6)));
  });

  it('refuses a format or a unit it does not know, instead of writing something else', () => {
    const mesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
    expect(() => writeStl([mesh], 'x', { format: 'obj' as never })).toThrow();
    expect(() => writeStl([mesh], 'x', { unit: 'cm' as never })).toThrow();
  });
});

describe('STL written by OCCT, read by this program (F2.3)', () => {
  it('OCCT\'s ASCII writer: every triangle read, closed, the volume OCCT\'s own reader finds', async () => {
    const { shape } = await golden('v-block.3dbx');
    const oc = kernel.oc;
    kernel.mesh(shape); // StlAPI_Writer writes the triangulation the faces have
    const path = '/occt-written.stl';
    const writer = new oc.StlAPI_Writer();
    try {
      expect(writer.ASCIIMode()).toBe(true);
      expect(writer.Write((kernel as unknown as { get(id: ShapeId): never }).get(shape), path, new oc.Message_ProgressRange())).toBe(true);
    } finally {
      writer.delete();
    }
    const bytes = oc.FS.readFile(path) as Uint8Array;
    oc.FS.unlink(path);
    const m = parseStl(bytes);
    const occt = readByOcct(bytes);
    expect(m.format).toBe('ascii');
    expect(m.indices.length / 3 + m.degenerate).toBe(occt.triangles);
    expect(m.closed).toBe(true);
    expect(Math.abs(m.volume / occt.volume - 1)).toBeLessThan(1e-6);
  });
});

describe('an STL in a part (F2.3)', () => {
  let stl: Uint8Array;
  let sha: string;
  let meshVolume: number;
  beforeAll(async () => {
    const { shape } = await golden('locating-plate.3dbx');
    stl = writeStl([kernel.mesh(shape)], 'plate');
    sha = await sha256Hex(stl);
    meshVolume = parseStl(stl).volume;
  });
  const blob = (kind: BlobRef['kind'] = 'stl'): BlobRef => ({ id: 'blob1', sha256: sha, kind, fileName: 'plate.stl' });
  const mesh: Extract<Feature, { type: 'importedMesh' }> = { id: 'mesh1', type: 'importedMesh', name: '網格1', suppressed: false, blob: 'blob1' };
  const withMesh = (base: PartDoc = createEmptyPart(), unit?: 'mm' | 'inch'): PartDoc => applyCommand(base, { type: 'importBody', blob: blob(), feature: unit ? { ...mesh, unit } : mesh, index: base.features.length });

  it('is a mesh and never a body: a part of only a mesh has no body; next to a solid, the solid is what it was', async () => {
    const regen = new Regenerator(kernel, solver, new Map([[sha, stl]]));
    const only = regen.rebuild(withMesh());
    expect(only.features.map((f) => f.status)).toEqual(['ok']);
    expect(only.body).toBeNull();
    expect(only.bodies).toEqual([]);
    expect(only.meshes).toHaveLength(1);
    expect(only.meshes[0]!.mesh.volume).toBeCloseTo(meshVolume, 6);
    expect(only.features[0]!.info).toMatch(/封閉|closed/);

    const { doc: plate } = await golden('v-block.3dbx');
    const alone = regen.rebuild(plate);
    const volume = kernel.massProps(alone.body!.shape).volume;
    const bodies = alone.bodies.length;
    const both = regen.rebuild(withMesh(plate));
    expect(both.features.every((f) => f.status === 'ok')).toBe(true);
    expect(both.bodies).toHaveLength(bodies);
    expect(kernel.massProps(both.body!.shape).volume).toBe(volume);
    expect(both.meshes.map((m) => m.featureId)).toEqual(['mesh1']);
    regen.dispose();
  });

  it('reads its numbers in the unit chosen, and the unit can be chosen again', () => {
    const regen = new Regenerator(kernel, solver, new Map([[sha, stl]]));
    const inch = regen.rebuild(withMesh(undefined, 'inch'));
    expect(inch.meshes[0]!.mesh.volume / meshVolume).toBeCloseTo(25.4 ** 3, 3);
    const back = applyCommand(withMesh(undefined, 'inch'), { type: 'setMeshUnit', featureId: 'mesh1', unit: 'mm' });
    expect((back.features[0] as typeof mesh).unit).toBeUndefined();
    expect(regen.rebuild(back).meshes[0]!.mesh.volume).toBeCloseTo(meshVolume, 6);
    expect(() => applyCommand(back, { type: 'setMeshUnit', featureId: 'mesh1', unit: 'cm' as never })).toThrow(CommandError);
    regen.dispose();
  });

  it('a file that cannot be read is the feature\'s error, and the features after it are still built', async () => {
    const broken = stl.slice(0, stl.length - 7);
    const brokenSha = await sha256Hex(broken);
    const { doc: plate } = await golden('v-block.3dbx');
    const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { ...blob(), sha256: brokenSha }, feature: mesh, index: 0 });
    const regen = new Regenerator(kernel, solver, new Map([[brokenSha, broken]]));
    const r = regen.rebuild({ ...plate, blobs: doc.blobs, features: [...doc.features, ...plate.features] });
    expect(r.features[0]!.status).toBe('error');
    expect(r.features[0]!.message).toMatch(/84 \+ 50/);
    expect(r.features.slice(1).every((f) => f.status === 'ok')).toBe(true);
    expect(r.meshes).toEqual([]);
    regen.dispose();
  });

  it('says what is wrong with an open mesh', async () => {
    const open = writeStl([{ positions: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10], indices: [0, 2, 1, 0, 1, 3, 1, 2, 3] }], 'open');
    const openSha = await sha256Hex(open);
    const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { ...blob(), sha256: openSha }, feature: mesh, index: 0 });
    const regen = new Regenerator(kernel, solver, new Map([[openSha, open]]));
    const r = regen.rebuild(doc);
    expect(r.features[0]!.status).toBe('ok');
    expect(r.features[0]!.warnings?.join(' ')).toMatch(/3/);
    expect(r.features[0]!.info).toMatch(/未封閉|not closed/);
    regen.dispose();
  });

  it('takes STL data only, and STL data only as a mesh', () => {
    const body: Extract<Feature, { type: 'importedBody' }> = { id: 'imp1', type: 'importedBody', name: '輸入1', suppressed: false, blob: 'blob1' };
    expect(() => applyCommand(createEmptyPart(), { type: 'importBody', blob: blob('stl'), feature: body, index: 0 })).toThrow(CommandError);
    expect(() => applyCommand(createEmptyPart(), { type: 'importBody', blob: blob('step'), feature: mesh, index: 0 })).toThrow(CommandError);
    expect(() => applyCommand(createEmptyPart(), { type: 'importBody', blob: blob(), feature: { ...mesh, unit: 'cm' as never }, index: 0 })).toThrow(CommandError);
  });

  it('keeps the data in the part file at this version; deleting the feature drops it, and keeps the pictures of the sketches', async () => {
    const bytes = await writePartFile(withMesh(), new Map([[sha, stl]]));
    const file = await readPartFile(bytes);
    expect(file.warnings).toEqual([]);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.schemaVersion).toBeGreaterThanOrEqual(87); // the version that brought STL meshes
    expect(file.doc.blobs).toEqual([blob()]);
    expect(file.blobs.get(sha)).toEqual(stl);
    const regen = new Regenerator(kernel, solver, file.blobs);
    expect(regen.rebuild(file.doc).meshes[0]!.mesh.volume).toBeCloseTo(meshVolume, 6);
    regen.dispose();

    const gone = applyCommand(file.doc, { type: 'deleteFeatures', featureIds: ['mesh1'] });
    expect(gone.blobs).toEqual([]);
    // a picture's data stays when another feature is deleted (it was dropped with any deletion before)
    const picture: BlobRef = { id: 'pic1', sha256: 'a'.repeat(64), kind: 'png' };
    const sketch: Feature = { ...(createEmptyPart().features[0] ?? {}), id: 'sk1', type: 'sketch', name: '草圖1', suppressed: false, plane: 'front', entities: [], constraints: [], pictures: [{ id: 'p1', blob: 'pic1', center: [0, 0], width: 10, height: 10, angle: 0 }] } as never;
    const withPicture = { ...withMesh(), blobs: [blob(), picture], features: [sketch, mesh] } as PartDoc;
    expect(applyCommand(withPicture, { type: 'deleteFeatures', featureIds: ['mesh1'] }).blobs).toEqual([picture]);
  });
});

describe('an assembly as STL (F4.1)', () => {
  it('places each part where its component is, down through a sub-assembly', () => {
    const turn = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as [number, number, number, number]; // 90° about z
    const placed = placedParts(
      [
        { part: 0, name: '板<1>', pose: { position: [100, 0, 0], rotation: [0, 0, 0, 1] } },
        { sub: 0, name: '子<1>', pose: { position: [0, 50, 0], rotation: turn } },
      ],
      [{ name: '子', instances: [{ part: 0, name: '板<2>', pose: { position: [10, 0, 0], rotation: [0, 0, 0, 1] } }] }],
    );
    expect(placed.map((p) => p.path.join('/'))).toEqual(['板<1>', '子<1>/板<2>']);
    const box = { positions: [0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0, 0, 0, 1, 2, 0, 1, 2, 1, 1, 0, 1, 1], indices: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7] };
    const read = parseStl(writeStl(placed.map((p) => placeMesh(box, p.pose)), 'asm'));
    expect(read.volume).toBeCloseTo(4, 5);
    // the second: turned 90° about z, then moved to (0, 50, 0) + turn(10, 0, 0) = (0, 60, 0): x from -1 to 0, y from 60 to 62
    expect(read.min).toEqual([-1, 0, 0].map((x, i) => (i === 0 ? expect.closeTo(-1, 5) : x)));
    expect(read.max[1]).toBeCloseTo(62, 5);
    expect(read.max[0]).toBeCloseTo(102, 5);
    expect(stlEntryNames(['板<1>', '板<1>', 'a/b'])).toEqual(['板_1_.stl', '板_1_ (2).stl', 'a_b.stl']);
  });
});
