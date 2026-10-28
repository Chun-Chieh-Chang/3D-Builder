/**
 * A fillet whose result is "valid" but holds an edge of absurd tolerance (ADR 0214). The part is the one a user reported: a 20 mm cylinder with a 1 mm chamfer
 * on its top edge, two 1 mm wide ring slots cut through it (their floor at r = 9, exactly where the chamfer ends on the top face) and four 0.5 mm fillets
 * along the slot corners. OCCT answered "done", BRepCheck said valid, and the fillet came back with an edge of tolerance 18.09 mm; meshed, the fillet face had
 * holes. Truth: the oracle of a closed surface is a mesh in which every edge is shared by two triangles, counted here with its own welding of the vertices
 * (nothing of the kernel's), and the tolerance read off the shape with OCCT's own `BRep_Tool`.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { t } from '@3db/i18n';
import { readPartFile } from '@3db/io';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { PlaneGcsSolver } from '@3db/sketch';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

type Feature = Record<string, unknown> & { id: string };
const fixture = async () => (await readPartFile(new Uint8Array(readFileSync(new URL('../fixtures/fillet-chamfer-equals-wall.3dbx', import.meta.url))))).doc;

/** The edges of the mesh that one triangle alone uses, with the vertices welded by position: the holes of a surface that should be closed. */
function openEdges(shape: Parameters<Kernel['mesh']>[0]): number {
  const mesh = kernel.mesh(shape);
  const ids = new Map<string, number>();
  const vid = (k: number) => {
    const key = [0, 1, 2].map((c) => Math.round(mesh.positions[3 * k + c]! * 1e4)).join(',');
    if (!ids.has(key)) ids.set(key, ids.size);
    return ids.get(key)!;
  };
  const use = new Map<string, number>();
  for (let tr = 0; tr < mesh.indices.length / 3; tr++) {
    const v = [0, 1, 2].map((k) => vid(mesh.indices[3 * tr + k]!));
    for (let k = 0; k < 3; k++) {
      const [a, b] = [v[k]!, v[(k + 1) % 3]!];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      use.set(key, (use.get(key) ?? 0) + 1);
    }
  }
  return [...use.values()].filter((n) => n === 1).length;
}

/** The largest tolerance of any edge or vertex, read with OCCT's own functions. */
function maxTolerance(shape: Parameters<Kernel['mesh']>[0]): number {
  const oc = (kernel as unknown as { oc: any }).oc;
  const s = (kernel as unknown as { get(id: unknown): unknown }).get(shape);
  let max = 0;
  for (const type of [oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_VERTEX]) {
    for (const ex = new oc.TopExp_Explorer(s, type, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
      const v = type === oc.TopAbs_ShapeEnum.TopAbs_EDGE ? oc.BRep_Tool.Tolerance(oc.TopoDS.Edge(ex.Current())) : oc.BRep_Tool.Tolerance(oc.TopoDS.Vertex(ex.Current()));
      max = Math.max(max, v);
    }
  }
  return max;
}

async function rebuilt(chamfer: string, radius: string) {
  const doc = structuredClone(await fixture()) as unknown as { features: Feature[] };
  for (const f of doc.features) {
    if (f.id === 'chamfer1') f.distance = chamfer;
    if (f.id === 'fillet1') f.radius = radius;
  }
  const r = regen.rebuild(doc as never);
  return { r, fillet: r.features.find((f) => f.id === 'fillet1')! };
}

describe('the part of the report', () => {
  it('as saved (chamfer 1 = the wall of the ring, radius 0.5): the fillet is refused and says why, instead of coming back with holes', async () => {
    const { fillet } = await rebuilt('1', '0.5');
    expect(fillet.status).toBe('error');
    expect(fillet.message).toContain(t('feature.filletTolerance', { tolerance: '', radius: '' }).slice(0, 4));
    expect(fillet.message).toMatch(/18\.1/); // the tolerance it was refused for
    expect(fillet.message).toMatch(/0\.5 mm/); // against the radius
  });

  it('the shape before the fillet is sound: tolerances of 1e-7, a closed mesh (the fault is the fillet\'s)', async () => {
    const doc = structuredClone(await fixture()) as unknown as { features: Feature[] };
    doc.features = doc.features.filter((f) => f.id !== 'fillet1');
    const r = regen.rebuild(doc as never);
    expect(maxTolerance(r.body!.shape)).toBeLessThan(1e-5);
    expect(openEdges(r.body!.shape)).toBe(0);
  });

  it.each([['0.5'], ['1.1'], ['1.5']])('a chamfer of %s mm (not the wall): the fillet is made, valid, of a tolerance far below its radius, and its mesh has no hole', async (chamfer) => {
    const { r, fillet } = await rebuilt(chamfer, '0.5');
    expect(fillet.status).toBe('ok');
    const shape = r.body!.shape;
    expect(kernel.isValid(shape)).toBe(true);
    expect(maxTolerance(shape)).toBeLessThan(0.05 * 0.5);
    expect(openEdges(shape)).toBe(0);
  });

  it.each([['0.2'], ['0.3'], ['0.4'], ['0.6'], ['0.8']])('chamfer 1, radius %s: every radius meets the same coincidence and is refused', async (radius) => {
    const { fillet } = await rebuilt('1', radius);
    expect(fillet.status).toBe('error');
  });
});

describe('what the fillet hands back is never a body that meshes with a hole', () => {
  it('150 random chamfers and radii: a fillet that is made has a mesh with no hole and a small tolerance; one that is not says so', async () => {
    let seed = 20261028;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    let made = 0;
    let refused = 0;
    const holey: string[] = [];
    for (let i = 0; i < 150; i++) {
      // half of them on the coincidence (the chamfer of the wall, 1) with any radius, the rest anywhere
      const chamfer = rnd() < 0.5 ? '1' : (0.3 + rnd() * 1.3).toFixed(3);
      const radius = (0.1 + rnd() * 0.8).toFixed(3);
      const { r, fillet } = await rebuilt(chamfer, radius);
      if (fillet.status !== 'ok') {
        refused++;
        expect(fillet.message, `chamfer ${chamfer} radius ${radius}`).toBeTruthy();
        continue;
      }
      made++;
      const shape = r.body!.shape;
      const open = openEdges(shape);
      const tol = maxTolerance(shape);
      if (open > 0 || tol > 0.25 * Number(radius)) holey.push(`chamfer ${chamfer} radius ${radius}: ${open} open edges, tolerance ${tol}`);
    }
    expect(holey).toEqual([]);
    // not a run in which one side never happened
    expect(made).toBeGreaterThan(15);
    expect(refused).toBeGreaterThan(15);
  }, 600000);
});
