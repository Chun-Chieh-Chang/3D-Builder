import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeId } from '@3db/kernel';

const sample = (name: string) => readFileSync(new URL(`../fixtures/public-cad/osf-sheet-press/${name}`, import.meta.url), 'utf8');
let kernel: Kernel;
const shapes: ShapeId[] = [];

beforeAll(async () => {
  kernel = await Kernel.load();
});
afterAll(() => shapes.forEach((shape) => kernel.release(shape)));

describe('external OSF sheet-press STEP samples', () => {
  it.each([
    'mounting-bracket.step',
    'upper-sheet-metal-enclosure.step',
    'upper-sheet-metal-enclosure-flat-pattern.step',
    'astm-d695-mold.step',
    'astm-d638-mold.step',
  ])(
    'imports %s as a solid with nonempty topology',
    (name) => {
      const shape = kernel.importStep(sample(name)).shape;
      shapes.push(shape);
      expect(kernel.massProps(shape).volume).toBeGreaterThan(0);
      expect(kernel.topology(shape).faces.length).toBeGreaterThan(0);
    },
  );

  it('reads the external sheet-press assembly STEP with a root product and component structure', () => {
    const assembly = kernel.readAssemblyStep(sample('sheet-press-assembly.step'));
    const root = assembly.prototypes[assembly.root]!;
    expect(root.shape).toBeUndefined();
    expect(root.children?.length).toBeGreaterThan(1);
    expect(assembly.prototypes.filter((p) => p.shape).length).toBeGreaterThan(1);
  }, 120000);
});
