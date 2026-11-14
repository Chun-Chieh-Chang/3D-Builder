/**
 * The solver's fixed heap made larger at load (2026-11-13, nightly #189/#194/#198). planegcs 1.2.0 declares a memory of 256 pages (16 MiB) as its
 * initial and maximum size and aborts on growth; `withHeap` declares it `SOLVER_HEAP_PAGES` instead. What is checked: the bytes are changed where
 * they should be and only there, a module laid out otherwise is refused, the solver's module really has the larger heap, and a sketch that the
 * shipped 16 MiB cannot hold (a control on the same system, measured to abort) is solved, fully defined, with every size exact.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Algorithm, GcsWrapper, init_planegcs_module, type SketchPrimitive } from '@salusoft89/planegcs';
import type { SketchConstraint, SketchEntity } from '@3db/model';
import { PlaneGcsSolver, SOLVER_HEAP_PAGES, withHeap } from '../src/index';
import { heapBytes, sketchOf } from './large-sketch';

const shipped = new Uint8Array(readFileSync(createRequire(import.meta.url).resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')));

/** The memory section's bytes, read independently of `withHeap`: [flags, initial, maximum] in pages. */
function memoryOf(b: Uint8Array): [number, number, number] {
  const leb = (i: number): [number, number] => {
    let n = 0;
    for (let s = 0; ; s += 7) {
      const c = b[i++]!;
      n += (c & 127) * 2 ** s;
      if (!(c & 128)) return [n, i];
    }
  };
  let i = 8;
  while (i < b.length) {
    const id = b[i++]!;
    const [size, body] = leb(i);
    if (id === 5) {
      const [count, a] = leb(body);
      expect(count).toBe(1);
      const flags = b[a]!;
      const [initial, c] = leb(a + 1);
      const [maximum] = leb(c);
      return [flags, initial, maximum];
    }
    i = body + size;
  }
  throw new Error('no memory section');
}

/** A module of planegcs from given bytes, outside the solver: the control. */
async function moduleOf(bytes: Uint8Array): Promise<GcsWrapper> {
  const m = await init_planegcs_module({ wasmBinary: bytes, printErr: () => {} } as Parameters<typeof init_planegcs_module>[0]);
  return new GcsWrapper(new m.GcsSystem(), m);
}

const R = 30;
const OFF = 0.1;
/** A closed chain of `n` arcs between points on a circle of radius 30, each arc's centre 0.6 R towards its middle. */
function ring(n: number) {
  const at = (k: number): [number, number] => {
    const a = OFF + (2 * Math.PI * k) / n;
    return [R * Math.cos(a), R * Math.sin(a)];
  };
  return Array.from({ length: n }, (_, k) => {
    const am = OFF + (2 * Math.PI * (k + 0.5)) / n;
    const c: [number, number] = [0.6 * R * Math.cos(am), 0.6 * R * Math.sin(am)];
    const s = at(k);
    const e = at(k + 1);
    return { c, s, e, r: Math.hypot(s[0] - c[0], s[1] - c[1]) };
  });
}

/** The ring as the model's sketch: the arcs share their ends, each has its radius and its centre's place from the origin. 0 freedoms. */
function ringSketch(n: number) {
  const arcs = ring(n);
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  arcs.forEach((a, k) => {
    entities.push({ id: `e${k}`, type: 'point', x: a.s[0], y: a.s[1] }, { id: `c${k}`, type: 'point', x: a.c[0], y: a.c[1] });
  });
  arcs.forEach((a, k) => {
    entities.push({ id: `a${k}`, type: 'arc', center: `c${k}`, start: `e${k}`, end: `e${(k + 1) % n}` });
    constraints.push(
      { id: `r${k}`, type: 'radius', circle: `a${k}`, value: String(a.r) },
      { id: `x${k}`, type: 'distanceX', a: '@origin', b: `c${k}`, value: String(Math.abs(a.c[0])) },
      { id: `y${k}`, type: 'distanceY', a: '@origin', b: `c${k}`, value: String(Math.abs(a.c[1])) },
    );
  });
  return { sketch: sketchOf(entities, constraints), arcs };
}

/** The same ring as planegcs primitives, for the control module. */
function ringPrims(n: number): SketchPrimitive[] {
  const arcs = ring(n);
  const prims: Record<string, unknown>[] = [{ id: 'o', type: 'point', x: 0, y: 0, fixed: true }];
  arcs.forEach((a, k) => prims.push({ id: `e${k}`, type: 'point', x: a.s[0], y: a.s[1], fixed: false }));
  arcs.forEach((a, k) => {
    const e = arcs[(k + 1) % n]!.s;
    prims.push(
      { id: `c${k}`, type: 'point', x: a.c[0], y: a.c[1], fixed: false },
      { id: `a${k}`, type: 'arc', c_id: `c${k}`, start_id: `e${k}`, end_id: `e${(k + 1) % n}`, radius: a.r, start_angle: Math.atan2(a.s[1] - a.c[1], a.s[0] - a.c[0]), end_angle: Math.atan2(e[1] - a.c[1], e[0] - a.c[0]) },
      { id: `ar${k}`, type: 'arc_rules', a_id: `a${k}` },
      { id: `rr${k}`, type: 'arc_radius', a_id: `a${k}`, radius: a.r },
      { id: `dx${k}`, type: 'difference', param1: { o_id: 'o', prop: 'x' }, param2: { o_id: `c${k}`, prop: 'x' }, difference: a.c[0] },
      { id: `dy${k}`, type: 'difference', param1: { o_id: 'o', prop: 'y' }, param2: { o_id: `c${k}`, prop: 'y' }, difference: a.c[1] },
    );
  });
  return prims as unknown as SketchPrimitive[];
}

describe('withHeap', () => {
  it('declares the memory 512 pages (32 MiB), initial and maximum, and changes no other byte', () => {
    expect(SOLVER_HEAP_PAGES).toBe(512);
    expect(memoryOf(shipped)).toEqual([1, 256, 256]);
    const out = withHeap(shipped);
    expect(memoryOf(out)).toEqual([1, 512, 512]);
    const changed = [...out.keys()].filter((i) => out[i] !== shipped[i]);
    expect(changed).toHaveLength(2);
    expect(shipped).toEqual(new Uint8Array(readFileSync(createRequire(import.meta.url).resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm'))));
    expect(() => new WebAssembly.Module(out)).not.toThrow();
  });

  it.each([100, 255, 300, 128 * 128, Number.NaN])('refuses %d pages (not a multiple of 128 from 256 that keeps two bytes)', (pages) => {
    expect(() => withHeap(shipped, pages)).toThrow(/multiple of 128/);
  });

  it('refuses a module whose memory is not the one measured (here: already made larger), rather than write over it', () => {
    expect(() => withHeap(withHeap(shipped))).toThrow(/not the one measured/);
    expect(() => withHeap(shipped.slice(0, 8))).toThrow(/no memory section/);
  });
});

describe('the solver with the larger heap', () => {
  it('has 32 MiB to work in', async () => {
    const solver = await PlaneGcsSolver.create();
    const bytes = heapBytes(solver);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBe(SOLVER_HEAP_PAGES * 65536);
  });

  it('solves a ring of 120 arcs, fully defined and every arc where it is, that the shipped 16 MiB aborts on', async () => {
    // control: the same system on the module as shipped aborts (measured: 94 arcs is the most it holds), and on the larger one solves
    const control = await moduleOf(shipped);
    expect(() => {
      control.push_primitives_and_params(ringPrims(120));
      control.solve(Algorithm.DogLeg);
    }).toThrow(/OOM/);
    const larger = await moduleOf(withHeap(shipped));
    larger.push_primitives_and_params(ringPrims(120));
    larger.solve(Algorithm.DogLeg);
    expect(larger.gcs.dof()).toBe(0);
    // the product's path: the model's sketch through PlaneGcsSolver
    const solver = await PlaneGcsSolver.create();
    const { sketch, arcs } = ringSketch(120);
    const r = solver.solve(sketch);
    expect(r.message).toBeUndefined();
    expect(r.tooLarge).toBeUndefined();
    expect(r.status).toBe('fully');
    expect(r.dof).toBe(0);
    arcs.forEach((a, k) => {
      for (const [id, p] of [[`c${k}`, a.c], [`e${k}`, a.s]] as const) {
        const g = r.geometry.get(id);
        if (g?.type !== 'point') throw new Error(`${id} not solved`);
        expect(Math.hypot(g.p[0] - p[0], g.p[1] - p[1]), id).toBeLessThan(1e-6);
      }
    });
  }, 120_000);

  it('a sketch too large for it still comes back refused, marked tooLarge, and the solver goes on', async () => {
    const solver = await PlaneGcsSolver.create();
    const r = solver.solve(ringSketch(400).sketch);
    expect(r.status).toBe('failed');
    expect(r.tooLarge).toBe(true);
    expect(solver.available).toBe(true);
    expect(solver.solve(ringSketch(20).sketch).status).toBe('fully');
  }, 120_000);
});
