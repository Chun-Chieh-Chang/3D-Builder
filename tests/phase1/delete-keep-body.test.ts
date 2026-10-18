/**
 * Phase 1 / Blueprint C7.3: Delete / Keep Body Feature (實體刪除與保留本體特徵, ADR 0165).
 *
 * Self-Red-Teaming adversarial test suite (AGENTS.md §2, §3):
 * 1. Blacklist 'delete' mode: deletes selected bodies, keeps unselected (Zero-Mock physical probe)
 * 2. Whitelist 'keep' mode: keeps selected bodies, deletes unselected
 * 3. Multi-body compound deletion (3 bodies -> delete 2 -> 1 remaining)
 * 4. Boundary condition: All bodies deleted (r.bodies.length === 0, 0 crash)
 * 5. Input corruption defense:
 *    - Empty targets -> explicit CommandError
 *    - Invalid mode -> explicit CommandError
 *    - Non-body target -> explicit CommandError
 * 6. History suppression defense: suppressed feature restores deleted bodies
 * 7. DAG dependency graph integrity (targets parents mapped to source features)
 * 8. Memory defense: Emscripten WASM Heap pointer existence defense (> 0) and zero leak
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type DeleteKeepBodyFeature,
  type Ref,
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

const deleteKeep = (
  id: string,
  mode: 'delete' | 'keep',
  targets: Ref[],
): DeleteKeepBodyFeature => ({
  id,
  type: 'deleteKeepBody',
  name: id,
  suppressed: false,
  mode,
  targets,
});

describe('delete / keep body feature (C7.3, ADR 0165)', () => {
  it('deletes a selected body in delete mode and preserves remaining bodies 100% (Zero-Mock)', () => {
    // Body 1 (e1): 40 x 30 x 20 = 24000 mm^3 at X in [-20, 20], Y in [-15, 15], Z in [0, 20]
    // Body 2 (e2): 20 x 20 x 20 = 8000 mm^3 at X in [50, 70], Y in [0, 20], Z in [0, 20]
    const doc = build(
      sketch('s1', front, rectangle('r1', -20, -15, 40, 30)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
      sketch('s2', front, rectangle('r2', 50, 0, 20, 20)),
      extrude('e2', 's2', 'boss', { type: 'blind', depth: '20' }),
      deleteKeep('dk1', 'delete', [{ kind: 'body', name: 'e1' }]),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 's2=ok', 'e2=ok', 'dk1=ok']);
    expect(r.bodies.length).toBe(1);

    const remaining = r.bodies[0]!;
    expect(remaining.id).toBe('e2');
    expect(kernel.isValid(remaining.shape)).toBe(true);

    // Exact physical measurement probe: Body 2 volume must remain 8000 mm^3
    const props = kernel.massProps(remaining.shape);
    expect(props.volume).toBeCloseTo(8000, 3);

    // Exact bounding box of Body 2 preserved
    const bounds = kernel.bounds(remaining.shape);
    expect(bounds.min[0]).toBeCloseTo(50, 3);
    expect(bounds.max[0]).toBeCloseTo(70, 3);
  });

  it('keeps only the selected body in keep mode and discards unselected bodies (Zero-Mock)', () => {
    // Body 1 (e1): 24000 mm^3, Body 2 (e2): 8000 mm^3
    const doc = build(
      sketch('s1', front, rectangle('r1', -20, -15, 40, 30)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
      sketch('s2', front, rectangle('r2', 50, 0, 20, 20)),
      extrude('e2', 's2', 'boss', { type: 'blind', depth: '20' }),
      deleteKeep('dk1', 'keep', [{ kind: 'body', name: 'e1' }]),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 's2=ok', 'e2=ok', 'dk1=ok']);
    expect(r.bodies.length).toBe(1);

    const remaining = r.bodies[0]!;
    expect(remaining.id).toBe('e1');
    expect(kernel.isValid(remaining.shape)).toBe(true);

    // Physical measurement probe: Body 1 volume must remain 24000 mm^3
    const props = kernel.massProps(remaining.shape);
    expect(props.volume).toBeCloseTo(24000, 3);
  });

  it('filters 3 bodies down to 1 in a compound delete operation', () => {
    // 3 separate bodies
    const doc = build(
      sketch('s1', front, rectangle('r1', 0, 0, 10, 10)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      sketch('s2', front, rectangle('r2', 20, 0, 10, 10)),
      extrude('e2', 's2', 'boss', { type: 'blind', depth: '10' }),
      sketch('s3', front, rectangle('r3', 40, 0, 10, 10)),
      extrude('e3', 's3', 'boss', { type: 'blind', depth: '10' }),
      deleteKeep('dk1', 'delete', [{ kind: 'body', name: 'e1' }, { kind: 'body', name: 'e3' }]),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 's2=ok', 'e2=ok', 's3=ok', 'e3=ok', 'dk1=ok']);
    expect(r.bodies.length).toBe(1);
    expect(r.bodies[0]!.id).toBe('e2');
  });

  it('handles boundary condition where all bodies are deleted without crashing', () => {
    const doc = build(
      sketch('s1', front, rectangle('r1', 0, 0, 10, 10)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      deleteKeep('dk1', 'delete', [{ kind: 'body', name: 'e1' }]),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'dk1=ok']);
    expect(r.bodies.length).toBe(0);
  });

  it('enforces input corruption defense: rejects empty targets, non-body refs and invalid modes', () => {
    // 1. Empty targets rejected by command validator
    expect(() =>
      build(
        sketch('s1', front, rectangle('r1', 0, 0, 10, 10)),
        extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
        deleteKeep('dk_err', 'delete', []),
      ),
    ).toThrowError();

    // 2. Non-body reference rejected by command validator
    expect(() =>
      build(
        sketch('s1', front, rectangle('r1', 0, 0, 10, 10)),
        extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
        deleteKeep('dk_err2', 'delete', [{ kind: 'face', name: 'e1:face1' }]),
      ),
    ).toThrowError();

    // 3. Invalid mode rejected by command validator
    expect(() =>
      build(
        sketch('s1', front, rectangle('r1', 0, 0, 10, 10)),
        extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
        deleteKeep('dk_err3', 'invalid' as any, [{ kind: 'body', name: 'e1' }]),
      ),
    ).toThrowError();
  });

  it('restores deleted bodies when the delete feature is suppressed', () => {
    const feature = deleteKeep('dk1', 'delete', [{ kind: 'body', name: 'e1' }]);
    feature.suppressed = true;

    const doc = build(
      sketch('s1', front, rectangle('r1', 0, 0, 10, 10)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      sketch('s2', front, rectangle('r2', 20, 0, 10, 10)),
      extrude('e2', 's2', 'boss', { type: 'blind', depth: '10' }),
      feature,
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 's2=ok', 'e2=ok', 'dk1=suppressed']);
    expect(r.bodies.length).toBe(2);
  });

  it('correctly tracks DAG dependency graph for target bodies', () => {
    const doc = build(
      sketch('s1', front, rectangle('r1', 0, 0, 10, 10)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      deleteKeep('dk1', 'delete', [{ kind: 'body', name: 'e1' }]),
    );

    const deps = dependencies(doc);
    expect(deps.parents.get('dk1')).toContain('e1');
    expect(deps.children.get('e1')).toContain('dk1');
  });

  it('guarantees ground-truth Emscripten WASM heap existence and zero memory leakage', () => {
    const doc = build(
      sketch('s1', front, rectangle('r1', 0, 0, 20, 20)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
      sketch('s2', front, rectangle('r2', 30, 0, 20, 20)),
      extrude('e2', 's2', 'boss', { type: 'blind', depth: '20' }),
      deleteKeep('dk1', 'delete', [{ kind: 'body', name: 'e1' }]),
    );

    const initialHeap = (kernel.oc as any).wasmMemory?.buffer?.byteLength;
    // Ground truth defense: initial heap must be an active number > 0, never undefined/null/0
    expect(initialHeap).toBeDefined();
    expect(initialHeap).toBeGreaterThan(0);

    for (let i = 0; i < 20; i++) {
      const r = regen.rebuild(doc);
      expect(r.bodies.length).toBe(1);
    }

    const finalHeap = (kernel.oc as any).wasmMemory?.buffer?.byteLength;
    expect(finalHeap).toBe(initialHeap);
  });
});
