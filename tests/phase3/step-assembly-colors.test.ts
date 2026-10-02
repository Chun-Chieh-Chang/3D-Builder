/**
 * 3b-3d: colors and time. The colors of the faces of a part survive an assembly STEP twice over: written into the file (the products of the
 * assembly carry them), read out of it into the part files of the import, and written again from those. And what the import costs for the golden jig of 15 components.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { dirName, joinPath, type SourceTree } from '@3db/model';
import { exportAssemblyStep, readDocumentFile, readPartFile, stepAssemblyFiles, stepAssemblyPlan, stepStructure } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { faceColors, Regenerator, solveAssemblyTree } from '@3db/regen';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const built = {} as Record<'plate' | 'pin' | 'vblock', ShapeId>;
const kept: Regenerator[] = [];
const FILES = { plate: 'locating-plate.3dbx', pin: 'diamond-pin.3dbx', vblock: 'v-block.3dbx' } as const;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  for (const k of Object.keys(FILES) as (keyof typeof FILES)[]) {
    const doc = (await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${FILES[k]}`, import.meta.url))))).doc;
    const regen = new Regenerator(kernel, solver);
    kept.push(regen);
    built[k] = regen.rebuild(doc).body!.shape;
  }
});

const near = (a: string, b: string) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 1);

/** The pin with two colored faces (2 and 5), in 定位組 which is used twice. */
function colored(): { text: string; colors: (string | null)[] } {
  const n = kernel.topology(built.pin).faces.length;
  const colors = Array.from({ length: n }, (_, i) => (i === 2 ? '#ff0000' : i === 5 ? '#00aa33' : null));
  const text = kernel.exportAssemblyStep(
    '夾具',
    [{ shape: built.plate, name: '定位板' }, { shape: built.pin, name: '削邊銷', faceColors: colors }],
    [{ sub: 0, name: '定位組<1>', position: [0, 0, 0], rotation: [0, 0, 0, 1] }, { sub: 0, name: '定位組<2>', position: [120, 0, 0], rotation: [0, 0, 0, 1] }],
    'MM',
    [{ name: '定位組', instances: [{ part: 0, name: '定位板<1>', position: [0, 0, 0], rotation: [0, 0, 0, 1] }, { part: 1, name: '削邊銷<1>', position: [-40, 0, 0], rotation: [0, 0, 0, 1] }] }],
  );
  return { text, colors };
}

describe('colors through an assembly STEP (3b-3d)', () => {
  it('the products of an assembly carry the colors of their faces, and an import keeps them as appearances of the part', async () => {
    const { text, colors } = colored();
    const plan = stepAssemblyPlan(kernel, text);
    const pin = plan.prototypes.find((p) => p.name === '削邊銷')!;
    expect(pin.part!.faceColors!.map((c, i) => [i, c]).filter(([, c]) => c)).toHaveLength(2);
    expect(plan.prototypes.find((p) => p.name === '定位板')!.part!.faceColors).toBeUndefined();
    const out = await stepAssemblyFiles(plan, '夾具');
    const part = await readPartFile(out.files.find((f) => f.path === '零件/削邊銷.3dbx')!.bytes);
    const found = part.doc.appearances.map((a) => [a.target.kind === 'face' ? a.target.ref.name : a.target.kind, a.color]);
    expect(found.map(([n]) => n)).toEqual(['import1:f3', 'import1:f6']);
    expect(near(found[0]![1]!, colors[2]!)).toBe(true);
    expect(near(found[1]![1]!, colors[5]!)).toBe(true);
  });

  it('written again from the files of the import, the colors are the same: out, in, out', async () => {
    const { text, colors } = colored();
    const out = await stepAssemblyFiles(stepAssemblyPlan(kernel, text), '夾具');
    const bytes = new Map(out.files.map((f) => [f.path, f.bytes]));
    const shapes = new Map<string, ShapeId>();
    const painted = new Map<string, (string | null)[]>();
    const treeOf = async (path: string): Promise<SourceTree> => {
      const file = await readDocumentFile(bytes.get(path)!);
      if (file.kind === 'part') {
        const regen = new Regenerator(kernel, solver, file.blobs);
        kept.push(regen);
        const r = regen.rebuild(file.doc);
        shapes.set(path, r.body!.shape);
        painted.set(path, faceColors(file.doc, r));
        return { kind: 'part', key: path };
      }
      const children: Record<string, SourceTree> = {};
      for (const c of file.doc.components) children[c.id] = await treeOf(joinPath(dirName(path), file.doc.files.find((f) => f.id === c.file)!.path));
      return { kind: 'assembly', doc: file.doc, children };
    };
    const top = (await treeOf('夾具.3dba')) as Extract<SourceTree, { kind: 'assembly' }>;
    const solved = solveAssemblyTree(top.doc, top.children, () => null);
    const s = stepStructure(top.doc, '', top.children, (id) => solved.poses.get(id) ?? null, solved.inner, () => '?');
    const again = exportAssemblyStep(kernel, '夾具', s.parts.map((p) => ({ shape: shapes.get(p.key)!, name: p.name, faceColors: painted.get(p.key)! })), s.instances, s.subs);
    const back = kernel.readAssemblyStep(again);
    const pin = back.prototypes.find((p) => p.name === '削邊銷')!.faceColors!;
    expect(pin).toHaveLength(colors.length);
    colors.forEach((c, i) => (c ? expect(near(pin[i]!, c), `face ${i}: ${pin[i]} vs ${c}`).toBe(true) : expect(pin[i]).toBeNull()));
    expect(back.prototypes.find((p) => p.name === '定位板')!.faceColors).toBeUndefined();
  });
});

describe('what an import costs (3b-3d)', () => {
  it('the golden jig of 15 components: read, written as files, opened again', async () => {
    const station = (x: number) => [
      { part: 0, name: '定位板<1>', position: [x, 0, 0] as [number, number, number] },
      { part: 1, name: '削邊銷<1>', position: [x - 40, 0, 0] as [number, number, number] },
      { part: 1, name: '削邊銷<2>', position: [x + 40, 0, 0] as [number, number, number] },
      { part: 2, name: 'V型塊<1>', position: [x, 15, 0] as [number, number, number] },
      { part: 2, name: 'V型塊<2>', position: [x, 55, 0] as [number, number, number] },
    ];
    const text = kernel.exportAssemblyStep(
      '金樣夾具',
      [{ shape: built.plate, name: '定位板' }, { shape: built.pin, name: '削邊銷' }, { shape: built.vblock, name: 'V型塊' }],
      [0, 120, 240].flatMap(station).map((c) => ({ ...c, rotation: [0, 0, 0, 1] as [number, number, number, number] })),
    );
    const t0 = performance.now();
    const plan = stepAssemblyPlan(kernel, text);
    const t1 = performance.now();
    const out = await stepAssemblyFiles(plan, '金樣夾具');
    const t2 = performance.now();
    const bytes = new Map(out.files.map((f) => [f.path, f.bytes]));
    for (const [path, b] of bytes) {
      if (!path.endsWith('.3dbx')) continue;
      const file = await readPartFile(b);
      const regen = new Regenerator(kernel, solver, file.blobs);
      kept.push(regen);
      expect(regen.rebuild(file.doc).body).toBeTruthy();
    }
    const t3 = performance.now();
    console.log(`匯入 15 個零組件（3 個原型）：讀取 ${(t1 - t0).toFixed(0)} ms、寫成檔案 ${(t2 - t1).toFixed(0)} ms、重新開啟三個零件 ${(t3 - t2).toFixed(0)} ms，共 ${(t3 - t0).toFixed(0)} ms；STEP ${(text.length / 1024).toFixed(0)} KB`);
    expect(out.files).toHaveLength(4);
    expect(out.parts).toBe(3);
    const main = await readDocumentFile(bytes.get('金樣夾具.3dba')!);
    expect(main.kind === 'assembly' && main.doc.components.length).toBe(15);
    expect(t3 - t0).toBeLessThan(15000);
  });
});
