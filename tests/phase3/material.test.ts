/**
 * Phase 3a-8a (C14.1, B8.4): the material and the mass it gives, the document settings and what they change (ADR 0037).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DEFAULT_SETTINGS, formatMass, massGrams, MATERIALS, materialById, MESH_QUALITY, parsePart, serializePart, settingsOf } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, circle, extrude, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

describe('materials (C14.1)', () => {
  it('the table has every material once, with a density a metal or a plastic can have', () => {
    expect(new Set(MATERIALS.map((m) => m.id)).size).toBe(MATERIALS.length);
    for (const m of MATERIALS) expect(m.density).toBeGreaterThan(0.8);
    expect(materialById('steel')?.density).toBe(7.85);
    expect(materialById('aluminium6061')?.density).toBe(2.7);
    expect(materialById('nope')).toBeUndefined();
  });

  it('mass is volume times density: a steel plate of 60 × 20 × 5 mm weighs 47.1 g; a kilogram is written in kilograms', () => {
    expect(massGrams(6000, 7.85)).toBeCloseTo(47.1, 9);
    expect(massGrams(1000 * 1000, 1)).toBeCloseTo(1000, 9); // a litre of water
    expect(formatMass(47.1)).toBe('47.10 g');
    expect(formatMass(1234.56)).toBe('1.235 kg');
  });

  it('the mass follows the model: a plate of the volume the kernel measures', () => {
    const doc = build(sketch('s1', front, rectangle('p', 0, 0, 60, 20)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }));
    const r = new Regenerator(kernel, solver, new Map()).rebuild(doc);
    expect(massGrams(kernel.massProps(r.body!.shape).volume, materialById('steel')!.density)).toBeCloseTo(47.1, 6);
  });

  it('setMaterial takes a material from the table or one typed, and takes it away; a name or a density that makes no sense is refused', () => {
    let doc = createEmptyPart();
    doc = applyCommand(doc, { type: 'setMaterial', material: { id: 'steel', name: '碳鋼', density: 7.85 } });
    expect(doc.material).toEqual({ id: 'steel', name: '碳鋼', density: 7.85 });
    doc = applyCommand(doc, { type: 'setMaterial', material: { name: ' 我的合金 ', density: 3.3 } });
    expect(doc.material).toEqual({ name: '我的合金', density: 3.3 });
    expect(() => applyCommand(doc, { type: 'setMaterial', material: { name: 'x', density: 0 } })).toThrow('密度');
    expect(() => applyCommand(doc, { type: 'setMaterial', material: { name: 'x', density: 31 } })).toThrow('密度');
    expect(() => applyCommand(doc, { type: 'setMaterial', material: { name: ' ', density: 1 } })).toThrow('名稱');
    expect(applyCommand(doc, { type: 'setMaterial', material: null }).material).toBeUndefined();
  });

  it('the material is saved with the part and read back', () => {
    const doc = applyCommand(createEmptyPart(), { type: 'setMaterial', material: { id: 'abs', name: 'ABS', density: 1.04 } });
    expect(parsePart(serializePart(doc)).material).toEqual({ id: 'abs', name: 'ABS', density: 1.04 });
  });
});

describe('document settings (B8.4)', () => {
  it('only what was chosen is stored; the rest is the default', () => {
    const doc = applyCommand(createEmptyPart(), { type: 'setSettings', settings: { meshQuality: 'fine' } });
    expect(doc.settings).toEqual({ meshQuality: 'fine' });
    expect(settingsOf(doc)).toEqual({ ...DEFAULT_SETTINGS, meshQuality: 'fine' });
    const more = applyCommand(doc, { type: 'setSettings', settings: { draftStandard: 'CNS', dimensionPrecision: 2 } });
    expect(settingsOf(more)).toEqual({ draftStandard: 'CNS', dimensionPrecision: 2, meshQuality: 'fine' });
    expect(parsePart(serializePart(more)).settings).toEqual(more.settings);
  });

  it('the number of decimals is a whole number from 0 to 6', () => {
    for (const bad of [-1, 7, 2.5]) expect(() => applyCommand(createEmptyPart(), { type: 'setSettings', settings: { dimensionPrecision: bad } })).toThrow('小數位數');
  });

  it('the mesh quality changes how many triangles a cylinder is made of: fine has more than normal, normal more than coarse', () => {
    const doc = build(sketch('s1', front, circle('k', 0, 0, 10)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }));
    // a shape keeps the finest mesh it has been given, so each quality meshes a shape of its own
    const triangles = (q: keyof typeof MESH_QUALITY) => {
      const r = new Regenerator(kernel, solver, new Map()).rebuild(doc);
      return kernel.mesh(r.body!.shape, MESH_QUALITY[q]).indices.length / 3;
    };
    expect(triangles('fine')).toBeGreaterThan(triangles('normal'));
    expect(triangles('normal')).toBeGreaterThan(triangles('coarse'));
  });
});
