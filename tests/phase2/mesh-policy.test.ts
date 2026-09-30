/**
 * The mesh of a component in an assembly is coarser than the mesh of a part being edited (handoff §10,
 * 2F observations): a component is seen small, among others, and a 21 mm part with free-form faces
 * came to 44 000 triangles. The angle limit was the cause, more than the deflection. The real files this
 * was measured on are in tests/phase2/real-sample.test.ts.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { COMPONENT_MESH, Kernel, type MeshData } from '@3db/kernel';
import { Regenerator } from '@3db/regen';

let kernel: Kernel;
let solver: PlaneGcsSolver;
type Golden = 'locating-plate.3dbx' | 'v-block.3dbx' | 'diamond-pin.3dbx';

/** What editing a part shows, before the mesh policy was split: the sizes to keep. */
const PART_TRIANGLES: Record<Golden, number> = { 'locating-plate.3dbx': 1580, 'v-block.3dbx': 484, 'diamond-pin.3dbx': 1184 };

/** A fresh build of a golden part: a shape keeps the finest mesh it has had, so each mesh gets its own. */
async function build(file: Golden) {
  const doc = (await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${file}`, import.meta.url))))).doc;
  return new Regenerator(kernel, solver).rebuild(doc);
}
const triangles = (m: MeshData) => m.indices.length / 3;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

describe('mesh policy: a part being edited, a component in an assembly (2F)', () => {
  it('keeps the mesh of a part being edited exactly as it was', async () => {
    for (const f of Object.keys(PART_TRIANGLES) as Golden[]) {
      const r = await build(f);
      expect(triangles(kernel.mesh(r.body!.shape)), f).toBe(PART_TRIANGLES[f]);
    }
  });

  it('meshes a component with fewer triangles than the part has when it is edited', async () => {
    const sizes: string[] = [];
    for (const f of Object.keys(PART_TRIANGLES) as Golden[]) {
      const r = await build(f);
      const n = triangles(kernel.mesh(r.body!.shape, COMPONENT_MESH));
      sizes.push(`${f} ${PART_TRIANGLES[f]} → ${n}`);
      expect(n, f).toBeLessThan(PART_TRIANGLES[f]);
    }
    console.log('MESH ' + sizes.join(' | '));
  });

  it('is asked for as a tolerance relative to the size and an angle of 0.5 rad', () => {
    expect(COMPONENT_MESH).toEqual({ relative: 1e-3, angular: 0.5 });
  });

  it('keeps the chord error of a cylinder within the tolerance: the pin\'s R5 shank, midpoints of the mesh edges', async () => {
    const r = await build('diamond-pin.3dbx');
    const body = r.body!;
    const shank = body.topology.faces[body.names.faces.indexOf('revolve1:side:sketch1.l3#1')]!;
    expect(shank.geometry?.type).toBe('cylinder');
    const g = shank.geometry as { origin: number[]; axis: number[]; radius: number };
    const b = kernel.bounds(body.shape);
    const diag = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const tolerance = Math.min(1, Math.max(0.002, diag * (COMPONENT_MESH.relative ?? 0)));

    const mesh = kernel.mesh(body.shape, COMPONENT_MESH);
    const faceIndex = body.topology.faces.indexOf(shank);
    const range = [...mesh.faceRanges].reduce<number[] | null>((found, _, i, a) => (i % 3 === 0 && a[i + 2] === faceIndex ? [a[i]!, a[i + 1]!] : found), null)!;
    const distanceToAxis = (p: number[]) => {
      const d = [p[0]! - g.origin[0]!, p[1]! - g.origin[1]!, p[2]! - g.origin[2]!];
      const along = d[0]! * g.axis[0]! + d[1]! * g.axis[1]! + d[2]! * g.axis[2]!;
      return Math.hypot(d[0]! - along * g.axis[0]!, d[1]! - along * g.axis[1]!, d[2]! - along * g.axis[2]!);
    };
    const vertex = (i: number) => [mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!];
    let worst = 0;
    let edges = 0;
    for (let t = range[0]!; t < range[0]! + range[1]!; t += 3) {
      for (const [a, c] of [[0, 1], [1, 2], [2, 0]] as const) {
        const p = vertex(mesh.indices[t + a]!);
        const q = vertex(mesh.indices[t + c]!);
        expect(distanceToAxis(p)).toBeCloseTo(g.radius, 5); // the vertices are on the surface
        worst = Math.max(worst, g.radius - distanceToAxis([(p[0]! + q[0]!) / 2, (p[1]! + q[1]!) / 2, (p[2]! + q[2]!) / 2]));
        edges++;
      }
    }
    expect(edges).toBeGreaterThan(20);
    expect(worst).toBeGreaterThan(0); // it is a mesh of flat triangles, not the cylinder itself
    expect(worst).toBeLessThanOrEqual(tolerance * (1 + 1e-6));
  });
});
