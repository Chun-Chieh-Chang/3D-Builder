/**
 * Phase 2A (handoff §10): the assembly skeleton, with real files. The golden parts are laid out in a
 * project folder on disk; an assembly refers to them by path relative to its own folder (B9.4), keeps
 * finding them after it is saved into another folder, and places each component by its pose (A3.1).
 * The browser side (project folder, dialogs, worker cache, display) is covered by
 * tests/e2e/phase2-assembly.js.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAssemblyCommand,
  axisAngle,
  createEmptyAssembly,
  dirName,
  IDENTITY_ROTATION,
  joinPath,
  relocateAssembly,
  transformPoint,
  type AssemblyDoc,
  type Pose,
  type Vec3,
} from '@3db/model';
import { componentName, readDocumentFile, readPartFile, writeAssemblyFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';

let kernel: Kernel;
let solver: PlaneGcsSolver;
let project: string;
const golden = (name: string) => readFileSync(new URL(`../golden/${name}`, import.meta.url));

// Hand-computed volumes of the golden parts (tests/golden/README.md).
const PLATE = 137197.020703565;
const PIN = 2487.029228977;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  project = mkdtempSync(join(tmpdir(), '3db-project-'));
  const put = (path: string, bytes: Uint8Array) => {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), bytes);
  };
  put('定位板.3dbx', golden('locating-plate.3dbx'));
  put('零件/削邊銷.3dbx', golden('diamond-pin.3dbx'));
});

afterAll(() => rmSync(project, { recursive: true, force: true }));

const at = (position: Vec3, rotation = IDENTITY_ROTATION): Pose => ({ position, rotation: [...rotation] });
/** 90° about x: the part's y axis turns into z. */
const TURNED = axisAngle([1, 0, 0], Math.PI / 2);

/** 定位板 fixed at the origin, 削邊銷 twice: once lying down, once standing. Made in the project folder. */
function jig(): AssemblyDoc {
  let doc = applyAssemblyCommand(createEmptyAssembly(), {
    type: 'insertComponent',
    file: { id: 'file1', path: '定位板.3dbx' },
    component: { id: 'comp1', file: 'file1', instance: 1, fixed: true, placement: at([0, 0, 0]) },
  });
  doc = applyAssemblyCommand(doc, {
    type: 'insertComponent',
    file: { id: 'file2', path: '零件/削邊銷.3dbx' },
    component: { id: 'comp2', file: 'file2', instance: 1, fixed: false, placement: at([30, 15, 20], TURNED) },
  });
  return applyAssemblyCommand(doc, {
    type: 'insertComponent',
    component: { id: 'comp3', file: 'file2', instance: 2, fixed: false, placement: at([-30, 15, 20]) },
  });
}

/** Every component's part, read from disk by its path from the assembly's folder and rebuilt. */
async function components(doc: AssemblyDoc, folder: string) {
  const out = [];
  for (const c of doc.components) {
    const file = doc.files.find((f) => f.id === c.file)!;
    const path = joinPath(folder, file.path);
    const part = await readPartFile(new Uint8Array(readFileSync(join(project, path))));
    const regen = new Regenerator(kernel, solver, part.blobs);
    const r = regen.rebuild(part.doc);
    const mass = kernel.massProps(r.body!.shape);
    out.push({ name: componentName(file.path, c.instance), path, pose: c.placement, errors: r.features.filter((f) => f.status !== 'ok'), volume: mass.volume, center: mass.center });
    regen.dispose();
  }
  return out;
}

describe('an assembly of part files (B9.4)', () => {
  it('finds its parts by relative path, also after it was saved into another folder', async () => {
    const doc = jig();
    // Saved as 組合件/夾具.3dba: the paths now start from 組合件/.
    const saved = relocateAssembly(doc, '', '組合件');
    expect(saved.files.map((f) => f.path)).toEqual(['../定位板.3dbx', '../零件/削邊銷.3dbx']);
    mkdirSync(join(project, '組合件'), { recursive: true });
    writeFileSync(join(project, '組合件/夾具.3dba'), await writeAssemblyFile(saved));

    const file = await readDocumentFile(new Uint8Array(readFileSync(join(project, '組合件/夾具.3dba'))));
    expect(file.kind).toBe('assembly');
    if (file.kind !== 'assembly') return;
    expect(file.doc).toEqual(saved);
    const parts = await components(file.doc, dirName('組合件/夾具.3dba'));
    expect(parts.map((p) => [p.name, p.path])).toEqual([
      ['定位板<1>', '定位板.3dbx'],
      ['削邊銷<1>', '零件/削邊銷.3dbx'],
      ['削邊銷<2>', '零件/削邊銷.3dbx'],
    ]);
    for (const p of parts) expect(p.errors).toEqual([]);
    expect(parts.map((p) => p.volume)).toEqual([expect.closeTo(PLATE, 6), expect.closeTo(PIN, 6), expect.closeTo(PIN, 6)]);
  });

  it('places each component where its pose puts it (A3.1)', async () => {
    type Placed = Awaited<ReturnType<typeof components>>[number];
    const [plate, lying, standing] = (await components(jig(), '')) as [Placed, Placed, Placed];
    const world = (p: Placed) => transformPoint(p.pose, p.center);
    const close = (a: Vec3, b: Vec3) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k]!, 9));
    close(world(plate), plate.center); // fixed at the origin, unturned
    const [x, y, z] = standing.center;
    close(world(standing), [x - 30, y + 15, z + 20]);
    // 90° about x takes (x, y, z) to (x, −z, y), then the position is added.
    close(world(lying), [x + 30, -z + 15, y + 20]);
  });
});
