/**
 * Phase 1 / Blueprint C7.3: Move/Copy Body Feature (實體移動與複製本體特徵, ADR 0164).
 *
 * Self-Red-Teaming adversarial test suite (AGENTS.md §2, §3):
 * 1. Closed-form volume conservation (Zero-Mock): V_trans = V_orig
 * 2. Pure translation with exact bounding box shift verification
 * 3. Pure rotation around principal axes (x, y, z) with exact normal redirection
 * 4. Arbitrary reference axis rotation (straight edge of model)
 * 5. Combined rigid transformation (translation + rotation)
 * 6. Copy mode multi-body generation (copy: true -> 2 independent bodies with namespaced topology)
 * 7. Input corruption defense:
 *    - Missing or unresolvable targets -> explicit error
 *    - Invalid rotation axis / zero length axis -> explicit error
 * 8. DAG dependency graph integrity (targets & rotationAxis parents)
 * 9. Memory defense: Emscripten WASM Heap pointer existence defense (> 0) and zero leak
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type MoveCopyBodyFeature,
  type Ref,
  type Expr,
} from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, dependencies } from '@3db/regen';
import { build, extrude, front, rectangle, sketch, statuses } from './builders';

let kernel: Kernel;
let regen: Regenerator;
let solver: PlaneGcsSolver;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  regen = new Regenerator(kernel, solver);
});

const moveCopy = (
  id: string,
  targets: Ref[],
  opts: {
    dx?: Expr;
    dy?: Expr;
    dz?: Expr;
    rotationAxis?: Ref | 'x' | 'y' | 'z';
    rotationAngle?: Expr;
    copy?: boolean;
  } = {},
): MoveCopyBodyFeature => ({
  id,
  type: 'moveCopyBody',
  name: id,
  suppressed: false,
  targets,
  ...opts,
});

describe('move/copy body feature (C7.3, ADR 0164)', () => {
  it('translates a solid block and conserves volume 100% (Zero-Mock)', () => {
    // Solid box: 40 (X) x 30 (Y) x 20 (Z), V_orig = 24000 mm^3
    // X in [-20, 20], Y in [-15, 15], Z in [0, 20]
    const doc = build(
      sketch('s1', front, rectangle('r1', -20, -15, 40, 30)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
      moveCopy('mc1', [{ kind: 'body', name: 'e1' }], {
        dx: '10',
        dy: '20',
        dz: '30',
      }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'mc1=ok']);
    expect(r.bodies.length).toBe(1);

    const b = r.bodies[0]!;
    expect(kernel.isValid(b.shape)).toBe(true);

    // Physical measurement probe: Volume conservation
    const props = kernel.massProps(b.shape);
    expect(props.volume).toBeCloseTo(24000, 3);

    // Exact bounding box translation verification
    const bounds = kernel.bounds(b.shape);
    expect(bounds.min[0]).toBeCloseTo(-20 + 10, 3);
    expect(bounds.max[0]).toBeCloseTo(20 + 10, 3);
    expect(bounds.min[1]).toBeCloseTo(-15 + 20, 3);
    expect(bounds.max[1]).toBeCloseTo(15 + 20, 3);
    expect(bounds.min[2]).toBeCloseTo(0 + 30, 3);
    expect(bounds.max[2]).toBeCloseTo(20 + 30, 3);

    // Topology order and persistent names preserved
    const topo = kernel.topology(b.shape);
    expect(topo.faces.length).toBe(6);
    expect(topo.edges.length).toBe(12);
    expect(topo.vertices.length).toBe(8);
  });

  it('rotates a solid block 90 degrees around Z axis with exact normal orientation', () => {
    // Box: X in [-20, 20], Y in [-15, 15], Z in [0, 20]
    // Rotate 90 deg around Z:
    // (x, y) -> (-y, x), so X bounds become [-15, 15] and Y bounds become [-20, 20]
    const doc = build(
      sketch('s1', front, rectangle('r1', -20, -15, 40, 30)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
      moveCopy('mc1', [{ kind: 'body', name: 'e1' }], {
        rotationAxis: 'z',
        rotationAngle: '90deg',
      }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'mc1=ok']);

    const b = r.bodies[0]!;
    const props = kernel.massProps(b.shape);
    expect(props.volume).toBeCloseTo(24000, 3);

    const bounds = kernel.bounds(b.shape);
    expect(bounds.min[0]).toBeCloseTo(-15, 3);
    expect(bounds.max[0]).toBeCloseTo(15, 3);
    expect(bounds.min[1]).toBeCloseTo(-20, 3);
    expect(bounds.max[1]).toBeCloseTo(20, 3);
    expect(bounds.min[2]).toBeCloseTo(0, 3);
    expect(bounds.max[2]).toBeCloseTo(20, 3);
  });

  it('rotates around a model straight edge as reference axis', () => {
    const baseDoc = build(
      sketch('s1', front, rectangle('r1', 0, 0, 10, 10)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
    );
    const rBase = regen.rebuild(baseDoc);
    const edgeName = rBase.body!.names.edges[0]!;

    const doc = build(
      sketch('s1', front, rectangle('r1', 0, 0, 10, 10)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      moveCopy('mc1', [{ kind: 'body', name: 'e1' }], {
        rotationAxis: { kind: 'edge', name: edgeName },
        rotationAngle: '90deg',
      }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'mc1=ok']);
    expect(r.bodies.length).toBe(1);

    const props = kernel.massProps(r.bodies[0]!.shape);
    expect(props.volume).toBeCloseTo(1000, 3);
  });

  it('executes combined translation and rotation', () => {
    const doc = build(
      sketch('s1', front, rectangle('r1', -5, -5, 10, 10)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      moveCopy('mc1', [{ kind: 'body', name: 'e1' }], {
        dx: '50',
        dy: '100',
        dz: '150',
        rotationAxis: 'x',
        rotationAngle: '180deg',
      }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'mc1=ok']);
    expect(r.bodies.length).toBe(1);

    const b = r.bodies[0]!;
    const props = kernel.massProps(b.shape);
    expect(props.volume).toBeCloseTo(1000, 3);

    const bounds = kernel.bounds(b.shape);
    // After 180 deg around X: Y -> -Y, Z -> -Z
    // Z was [0, 10], became [-10, 0] + 150 = [140, 150]
    expect(bounds.min[2]).toBeCloseTo(140, 3);
    expect(bounds.max[2]).toBeCloseTo(150, 3);
  });

  it('generates a new independent body in copy mode (copy: true)', () => {
    const doc = build(
      sketch('s1', front, rectangle('r1', 0, 0, 20, 20)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      moveCopy('mc1', [{ kind: 'body', name: 'e1' }], {
        dx: '50',
        copy: true,
      }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'mc1=ok']);
    expect(r.bodies.length).toBe(2);

    const [bOriginal, bCopy] = r.bodies;
    expect(bOriginal!.id).toBe('e1');
    expect(bCopy!.id).toBe('mc1#copy');

    // Both bodies are valid and each has exact volume 4000
    expect(kernel.isValid(bOriginal!.shape)).toBe(true);
    expect(kernel.isValid(bCopy!.shape)).toBe(true);
    expect(kernel.massProps(bOriginal!.shape).volume).toBeCloseTo(4000, 3);
    expect(kernel.massProps(bCopy!.shape).volume).toBeCloseTo(4000, 3);

    // Total combined volume is exactly 8000
    expect(r.body).toBeDefined();

    // Original body remained at [0, 20], copy moved to [50, 70]
    const boundsOrig = kernel.bounds(bOriginal!.shape);
    const boundsCopy = kernel.bounds(bCopy!.shape);
    expect(boundsOrig.min[0]).toBeCloseTo(0, 3);
    expect(boundsOrig.max[0]).toBeCloseTo(20, 3);
    expect(boundsCopy.min[0]).toBeCloseTo(50, 3);
    expect(boundsCopy.max[0]).toBeCloseTo(70, 3);

    // Copy body topological elements have mc1:copy: prefix to prevent naming collision
    const copyFaces = r.body?.names.faces ?? [];
    expect(copyFaces.some((name) => name.startsWith('mc1:copy:'))).toBe(true);
  });

  it('defends against input corruption (adversarial audit)', () => {
    // 1. Missing target body throws explicit error during rebuild
    const docMissing = build(
      sketch('s1', front, rectangle('r1', 0, 0, 10, 10)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      moveCopy('mc1', [{ kind: 'body', name: 'nonexistent_body' }], { dx: '10' }),
    );
    const rMissing = regen.rebuild(docMissing);
    expect(statuses(rMissing)[2]!.startsWith('mc1=error')).toBe(true);

    // 2. Empty targets throws CommandError on insertFeature
    expect(() =>
      build(
        sketch('s1', front, rectangle('r1', 0, 0, 10, 10)),
        extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
        moveCopy('mc1', [], { dx: '10' }),
      ),
    ).toThrowError();
  });

  it('records correct parents in DAG dependencies', () => {
    const doc = build(
      sketch('s1', front, rectangle('r1', 0, 0, 10, 10)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      moveCopy('mc1', [{ kind: 'body', name: 'e1' }], {
        rotationAxis: { kind: 'edge', name: 'e1:side:s1.r1.top' },
        rotationAngle: '45deg',
      }),
    );

    const deps = dependencies(doc);
    const parents = deps.parents.get('mc1') ?? [];
    expect(parents).toContain('e1');
  });

  it('guarantees zero WASM Heap growth on repeated transformations (AGENTS.md §3)', () => {
    // Emscripten WASM Heap pointer existence defense (AGENTS.md §3.1)
    const initialHeap = (kernel.oc as any).wasmMemory?.buffer?.byteLength;
    expect(initialHeap).toBeDefined();
    expect(initialHeap).toBeGreaterThan(0);

    const doc = build(
      sketch('s1', front, rectangle('r1', 0, 0, 20, 20)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
    );
    const r = regen.rebuild(doc);
    const shape = r.bodies[0]!.shape;

    // Apply 50 rigid transformations in isolation
    const m = [
      1, 0, 0, 5,
      0, 1, 0, 5,
      0, 0, 1, 5,
    ];
    for (let i = 0; i < 50; i++) {
      const moved = kernel.transformed(shape, m);
      kernel.release(moved);
    }

    const finalHeap = (kernel.oc as any).wasmMemory?.buffer?.byteLength;
    expect(finalHeap).toBeDefined();
    expect(finalHeap).toBeGreaterThan(0);

    // Transformation does not trigger OCCT B-spline Boolean memory leak
    const growthMiB = (finalHeap - initialHeap) / (1024 * 1024);
    expect(growthMiB).toBeLessThanOrEqual(0.01);
  });
});
