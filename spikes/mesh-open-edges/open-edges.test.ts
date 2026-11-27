/**
 * Before the open-edge gate of part_verify_against_2d (2026-11-26): how many open edges `openMeshEdges` counts on parts that are sound, and on ADR 0214's
 * torn fillet. A gate that fires on a sound part is worse than none, so every kind of face that squeezes or meets itself is in: a sphere's poles, a cone's
 * apex, a torus, a cylinder's seam, a thread, the rolling-ball fuzz's spline walls with their exact rounds, and the repository's part files.
 * Writes spikes/mesh-open-edges/data/open-edges.json.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readPartFile } from '@3db/io';
import { Kernel, KernelError, type Frame, type Region, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { PlaneGcsSolver } from '@3db/sketch';
import { openMeshEdges } from '../../apps/mcp/src/verify2d';
import { sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';

const XZ: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
const Z = { origin: [0, 0, 0] as [number, number, number], dir: [0, 0, 1] as [number, number, number] };
const poly = (pts: [number, number][]): Region => ({ outer: pts.map((a, i) => ({ kind: 'line', a, b: pts[(i + 1) % pts.length]!, source: `p${i}` })), holes: [] }) as Region;

it('counts open edges on sound parts and on the torn fillet', async () => {
  const kernel = await Kernel.load();
  const regen = new Regenerator(kernel, await PlaneGcsSolver.create());
  const rows: { part: string; faces: number; triangles: number; open: number }[] = [];
  const measure = (part: string, shape: ShapeId) => {
    const mesh = kernel.mesh(shape);
    rows.push({ part, faces: kernel.topology(shape).faces.length, triangles: mesh.indices.length / 3, open: openMeshEdges(mesh) });
  };
  // primitives whose faces squeeze to a point or meet themselves
  const sphereHalf: Region = { outer: [{ kind: 'arc', c: [0, 0], r: 8, from: [0, -8], to: [0, 8], ccw: true, source: 'a' }, { kind: 'line', a: [0, 8], b: [0, -8], source: 'l' }], holes: [] } as unknown as Region;
  measure('sphere (revolved half disc)', kernel.revolve(XZ, [sphereHalf], Z, 2 * Math.PI).shape);
  measure('cone with an apex', kernel.revolve(XZ, [poly([[0, 0], [6, 0], [0, 12]])], Z, 2 * Math.PI).shape);
  const torusDisc: Region = { outer: [{ kind: 'arc', c: [10, 0], r: 3, from: [13, 0], to: [7, 0], ccw: true, source: 'a1' }, { kind: 'arc', c: [10, 0], r: 3, from: [7, 0], to: [13, 0], ccw: true, source: 'a2' }], holes: [] } as unknown as Region;
  measure('torus', kernel.revolve(XZ, [torusDisc], Z, 2 * Math.PI).shape);
  measure('cylinder (seam)', kernel.revolve(XZ, [poly([[0, 0], [5, 0], [5, 20], [0, 20]])], Z, 2 * Math.PI).shape);
  const tube = kernel.revolve(XZ, [poly([[3.6, 0], [7, 0], [7, 12], [3.6, 12]])], Z, 2 * Math.PI).shape;
  const tool = kernel.thread(XZ, [poly([[3.5, -0.75], [4.3, -0.35], [4.3, 0.35], [3.5, 0.75]])], { axis: Z, pitch: 2.5, starts: 1, hand: 'right', from: 0, to: 8 } as never).shape;
  measure('threaded bore', kernel.boolean('cut', tube, tool).shape);
  // spline walls with their exact rounds (the rolling-ball fuzz's parts)
  for (let seed = 1; seed <= 20; seed++) {
    const s = sample(seed);
    const m = splineBoss(kernel, s.top, s.h);
    try { measure(`rolling-ball seed ${seed}`, kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true).shape); }
    catch (e) { if (!(e instanceof KernelError)) throw e; measure(`rolling-ball seed ${seed} (no round)`, m.shape); }
  }
  // the repository's part files
  for (const dir of ['tests/golden', 'tests/fixtures', 'tests/fixtures/parts']) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.3dbx'))) {
      const doc = (await readPartFile(new Uint8Array(readFileSync(join(dir, f))))).doc;
      const r = regen.rebuild(doc);
      if (r.body) measure(`${dir}/${f}`, r.body.shape);
    }
  }
  // ADR 0214's torn fillet: the tolerance gate let through (maxTolerance read as 0), so the fillet comes back as OCCT made it
  const k = kernel as unknown as { maxTolerance(...a: unknown[]): number };
  const real = k.maxTolerance;
  k.maxTolerance = () => 0;
  try {
    const doc = (await readPartFile(new Uint8Array(readFileSync('tests/fixtures/fillet-chamfer-equals-wall.3dbx')))).doc;
    const r = regen.rebuild(doc);
    expect(r.features.find((f) => f.id === 'fillet1')!.status).toBe('ok');
    measure('ADR 0214 torn fillet (gate off)', r.body!.shape);
  } finally {
    k.maxTolerance = real;
  }
  mkdirSync('spikes/mesh-open-edges/data', { recursive: true });
  writeFileSync('spikes/mesh-open-edges/data/open-edges.json', JSON.stringify(rows, null, 1));
  expect(rows.length).toBeGreaterThan(30);
}, 600_000);
