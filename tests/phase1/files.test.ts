/**
 * Phase 1E (handoff §9): the part file. Files written by older versions keep opening and rebuild to
 * the same geometry (B9.2); saving and opening again gives back the same document (B9.1, F7.1).
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDemoPart, FormatError, SCHEMA_VERSION, serializePart, type PartDoc } from '@3db/model';
import { partFileName, readPartFile, readZip, sha256Hex, writePartFile, writeZip } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, circle, extrude, face, front, rectangle, sketch, statuses } from './builders';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

const utf8 = (s: string) => new TextEncoder().encode(s);
const oldFile = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/old-versions/${name}`, import.meta.url)));

// Volumes worked out by hand.
/** The demo block, less what an R2 fillet removes along a 10 mm edge. */
const DEMO = 20 * 10 * 5 - (4 - Math.PI) * 10;
/** Plate, less an R4 through hole and a 2 × 2 chamfer along 30 mm, plus an R3 × 5 boss. */
const PLATE = 40 * 30 * 10 - Math.PI * 16 * 10 - 2 * 30 + Math.PI * 9 * 5;

/** Everything is read before the next rebuild releases this one's shapes. */
function measure(doc: PartDoc) {
  const r = regen.rebuild(doc);
  return { statuses: statuses(r), volume: kernel.massProps(r.body!.shape).volume, faces: r.body!.names.faces, edges: r.body!.names.edges };
}

/** A part using what schema v4 added: a post from an offset plane down to the plate. */
const withPlane = (): PartDoc =>
  build(
    sketch('s1', front, rectangle('a', 0, 0, 40, 30)),
    extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
    { id: 'p1', type: 'refPlane', name: '基準面1', suppressed: false, def: { mode: 'offset', plane: face('e1:cap:end'), distance: '15' } },
    sketch('s2', { kind: 'datum', name: 'p1' }, circle('k', 20, 15, 4)),
    extrude('e2', 's2', 'boss', { type: 'upToFace', face: face('e1:cap:end'), reverse: true }),
  );

describe('files written by older versions (B9.2)', () => {
  it.each([
    ['v1-demo.3db.json', 1, DEMO],
    ['v2-demo.3db.json', 2, DEMO],
    ['v3-demo.3db.json', 3, DEMO],
    ['v3-plate.3db.json', 3, PLATE],
  ])('opens %s (schema %i) and rebuilds it', async (name, version, volume) => {
    const bytes = oldFile(name);
    expect(JSON.parse(new TextDecoder().decode(bytes)).schemaVersion).toBe(version);
    const file = await readPartFile(bytes);
    expect(file.format).toBe('json');
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    const m = measure(file.doc);
    expect(m.statuses.filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(m.volume).toBeCloseTo(volume, 6);
  });
});

describe('the .3dbx file (B9.1, F7.1)', () => {
  const docs = async (): Promise<[string, PartDoc][]> => [
    ['the demo part', createDemoPart()],
    ['the v3 plate', (await readPartFile(oldFile('v3-plate.3db.json'))).doc],
    ['a part with a reference plane', withPlane()],
  ];

  it('saves the document text as it is and opens it back unchanged', async () => {
    for (const [what, doc] of await docs()) {
      const bytes = await writePartFile(doc);
      const entries = await readZip(bytes);
      expect(entries.map((e) => e.name), what).toEqual(['document.json']);
      expect(new TextDecoder().decode(entries[0]!.data), what).toBe(serializePart(doc));
      const file = await readPartFile(bytes);
      expect(file.format).toBe('3dbx');
      expect(file.doc, what).toEqual(doc);
      expect(file.warnings).toEqual([]);
      // The same document always makes the same file.
      expect(await writePartFile(file.doc), what).toEqual(bytes);
    }
  });

  it('rebuilds an opened part to the same model, names included', async () => {
    for (const [what, doc] of await docs()) {
      const before = measure(doc);
      const after = measure((await readPartFile(await writePartFile(doc))).doc);
      expect(after.statuses, what).toEqual(before.statuses);
      expect(after.faces, what).toEqual(before.faces);
      expect(after.edges, what).toEqual(before.edges);
      expect(after.volume, what).toBe(before.volume);
    }
    expect(measure(withPlane()).volume).toBeCloseTo(12000 + Math.PI * 16 * 15, 6);
  });

  it('keeps imported data with the document, once per content, and checks it', async () => {
    const step = utf8('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');
    const sha256 = await sha256Hex(step);
    const doc: PartDoc = { ...createDemoPart(), blobs: [{ id: 'blob1', sha256, kind: 'step' }, { id: 'blob2', sha256, kind: 'step' }] };
    const bytes = await writePartFile(doc, new Map([[sha256, step], ['0'.repeat(64), utf8('not referenced')]]));
    expect((await readZip(bytes)).map((e) => e.name)).toEqual(['document.json', `blobs/${sha256}.step`]);
    const file = await readPartFile(bytes);
    expect(file.blobs).toEqual(new Map([[sha256, step]]));
    expect(file.warnings).toEqual([]);

    // Missing data opens with a warning; the document still says what it imported.
    const missing = await readPartFile(await writePartFile(doc));
    expect(missing.blobs.size).toBe(0);
    expect(missing.warnings).toEqual([expect.stringContaining('缺少輸入的資料 blob1')]);

    // Data that no longer matches its hash is not used.
    const tampered = await writeZip([
      { name: 'document.json', data: utf8(serializePart(doc)) },
      { name: `blobs/${sha256}.step`, data: utf8('ISO-10303-21; changed') },
    ]);
    const checked = await readPartFile(tampered);
    expect(checked.blobs.size).toBe(0);
    expect(checked.warnings).toEqual([expect.stringContaining('雜湊值不符')]);
  });

  it('refuses what it cannot open, and says why', async () => {
    const newer = { ...JSON.parse(serializePart(createDemoPart())), schemaVersion: SCHEMA_VERSION + 1 };
    const cases: [Uint8Array, string][] = [
      [await writeZip([{ name: 'readme.txt', data: utf8('hello') }]), '缺少 document.json'],
      [await writeZip([{ name: 'document.json', data: utf8(JSON.stringify(newer)) }]), `比本程式支援的 ${SCHEMA_VERSION} 新`],
      [Uint8Array.from([0xff, 0xfe, 0x00, 0x81]), '不是 3D-Builder 零件檔'],
      [utf8('{"kind": "assembly"}'), '不是零件文件'],
    ];
    const damaged = await writePartFile(createDemoPart());
    damaged[30 + 'document.json'.length + 20]! ^= 0xff; // inside the compressed document
    cases.push([damaged, '已損毀']);
    for (const [bytes, reason] of cases) {
      const error = await readPartFile(bytes).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FormatError);
      expect((error as Error).message).toContain(reason);
    }
  });

  it('names a new file after the part', () => {
    expect(partFileName({ ...createDemoPart(), properties: { 零件名稱: '夾具/底板:A' } })).toBe('夾具_底板_A.3dbx');
    expect(partFileName({ ...createDemoPart(), properties: {} })).toBe('Part.3dbx');
  });
});
