import { beforeAll, expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { applyCommand, createEmptyPart, parsePart, SCHEMA_VERSION, serializePart, type Feature, type PartDoc, type SectionClearanceFeature } from '@3db/model';
import { dependencies, Regenerator } from '@3db/regen';
import { PlaneGcsSolver } from '@3db/sketch';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

function insert(doc: PartDoc, feature: Feature): PartDoc {
  return applyCommand(doc, { type: 'insertFeature', feature, index: doc.features.length });
}

function cylinder(): PartDoc {
  const sketch: Feature = {
    id: 'sketch1', type: 'sketch', name: 'Circle', suppressed: false, plane: { kind: 'datum', name: 'plane:front' },
    entities: [{ type: 'point', id: 'center', x: 0, y: 0 }, { type: 'circle', id: 'circle', center: 'center', radius: 6 }],
    constraints: [],
  };
  return insert(insert(createEmptyPart(), sketch), {
    id: 'extrude1', type: 'extrude', name: 'Cylinder', suppressed: false, op: 'boss', sketch: sketch.id, dir1: { type: 'blind', depth: '10' },
  });
}

const clearance: SectionClearanceFeature = {
  id: 'sectionClearance1', type: 'sectionClearance', name: 'Clearance', suppressed: false,
  body: { kind: 'body', name: 'extrude1' }, plane: { kind: 'datum', name: 'plane:front' },
  planeOffset: '3', gap: '0.5', side: 'out', result: 'newBody', dir1: { type: 'blind', depth: '2' },
};

it('saves, resolves, rebuilds and edits a section clearance with persistent body and plane references', () => {
  const plane: Feature = {
    id: 'refPlane1', type: 'refPlane', name: 'Slice', suppressed: false,
    def: { mode: 'offset', plane: { kind: 'datum', name: 'plane:front' }, distance: '1' },
  };
  const doc = insert(insert(cylinder(), plane), { ...clearance, plane: { kind: 'datum', name: plane.id } });
  expect(dependencies(doc).parents.get(clearance.id)).toEqual([clearance.body.name, plane.id]);
  const restored = parsePart(serializePart(doc));
  expect(restored.schemaVersion).toBe(SCHEMA_VERSION);
  expect(restored.features).toEqual(doc.features);
  const regen = new Regenerator(kernel, solver, new Map());
  try {
    for (const [gap, radius] of [['0.5', 6.5], ['0.25mm + 0.75mm', 7]] as const) {
      const edited = applyCommand(restored, { type: 'setSectionClearance', featureId: clearance.id, params: { gap } });
      const result = regen.rebuild(edited);
      expect(result.features.at(-1)).toMatchObject({ status: 'ok' });
      const body = result.bodies.find((b) => b.id === clearance.id)!;
      expect(kernel.check(body.shape).valid).toBe(true);
      const props = kernel.massProps(body.shape);
      expect(props.volume).toBeCloseTo(2 * Math.PI * radius ** 2, 7);
      expect(props.center[2]).toBeCloseTo(5, 7);
    }
  } finally {
    regen.dispose();
  }
});

it.each(['cut', 'merge'] as const)('reuses extrusion termination and the %s result', (result) => {
  const doc = insert(cylinder(), {
    ...clearance, result, side: result === 'cut' ? 'in' : 'out',
    dir1: result === 'cut' ? { type: 'throughAll' } : { type: 'blind', depth: '10' },
  });
  const regen = new Regenerator(kernel, solver, new Map());
  try {
    const rebuilt = regen.rebuild(doc);
    expect(rebuilt.features.at(-1)).toMatchObject({ status: 'ok' });
    expect(rebuilt.bodies).toHaveLength(1);
    const shape = rebuilt.bodies[0]!.shape;
    expect(kernel.check(shape).valid).toBe(true);
    const volume = result === 'cut' ? Math.PI * (6 ** 2 * 10 - 5.5 ** 2 * 3) : Math.PI * (6 ** 2 * 3 + 6.5 ** 2 * 10);
    expect(kernel.massProps(shape).volume).toBeCloseTo(volume, 7);
  } finally {
    regen.dispose();
  }
});

it('persists a stopped feature, rebuilds its preceding geometry and can resume', () => {
  const doc = insert(cylinder(), clearance);
  const stop = applyCommand(doc, { type: 'setSectionClearance', featureId: clearance.id, params: { incomplete: true } });
  const regen = new Regenerator(kernel, solver, new Map());
  try {
    const reopened = parsePart(serializePart(stop));
    const result = regen.rebuild(reopened);
    expect(result.features.at(-1)).toMatchObject({ id: clearance.id, status: 'incomplete' });
    expect(result.bodies.map((b) => b.id)).toEqual([clearance.body.name]);
    const retry = applyCommand(reopened, { type: 'setSectionClearance', featureId: clearance.id, params: { incomplete: undefined } });
    expect(regen.rebuild(retry).features.at(-1)).toMatchObject({ status: 'ok' });
  } finally {
    regen.dispose();
  }
});

it('resolves a model-plane and a distinct end face after a source dimension changes', () => {
  const doc = cylinder();
  const regen = new Regenerator(kernel, solver, new Map());
  try {
    const body = regen.rebuild(doc).body!;
    const cap = (z: number) => ({
      kind: 'face' as const,
      name: body.names.faces[body.topology.faces.findIndex((face) => face.surface === 'plane' && Math.abs(face.center[2] - z) < 1e-7)]!,
    });
    const f: SectionClearanceFeature = {
      ...clearance, plane: cap(0), planeOffset: '-2',
      dir1: { type: 'upToFace', face: cap(10), reverse: true },
    };
    const withClearance = insert(doc, f);
    expect(dependencies(withClearance).parents.get(f.id)).toContain('extrude1');
    const sketch = withClearance.features[0]!;
    if (sketch.type !== 'sketch') throw new Error('missing cylinder sketch');
    const edited: PartDoc = { ...withClearance, features: [
      { ...sketch, entities: sketch.entities.map((entity) => entity.type === 'circle' ? { ...entity, radius: 5 } : entity) },
      ...withClearance.features.slice(1),
    ] };
    for (const [part, radius] of [[withClearance, 6.5], [edited, 5.5]] as const) {
      const result = regen.rebuild(part);
      expect(result.features.at(-1)).toMatchObject({ status: 'ok' });
      const shape = result.bodies.find((b) => b.id === f.id)!.shape;
      expect(kernel.check(shape).valid).toBe(true);
      expect(kernel.massProps(shape).volume).toBeCloseTo(8 * Math.PI * radius ** 2, 7);
      expect(kernel.massProps(shape).center[2]).toBeCloseTo(6, 7);
    }
  } finally {
    regen.dispose();
  }
});
