import { describe, expect, it } from 'vitest';
import { createDemoPart, dimensionName, expressionParents, exprsOf, Parameters, renameInDoc, resolveDoc, variableUsers, type Feature, type PartDoc, type SketchFeature, type Variable } from '../src/index';

/** The demo block (20 × 10 sketch on Top, extruded 5, fillet R2) with variables and a second sketch added. */
function part(variables: Variable[] = [], edit: (doc: PartDoc) => void = () => {}): PartDoc {
  const doc = createDemoPart();
  doc.variables = variables;
  edit(doc);
  return doc;
}
const v = (id: string, name: string, expr: string): Variable => ({ id, name, expr });
const sketch1 = (doc: PartDoc) => doc.features[0] as SketchFeature;
const setDim = (doc: PartDoc, id: string, value: string) => {
  const c = sketch1(doc).constraints.find((x) => x.id === id)!;
  if ('value' in c) c.value = value;
};

describe('dimension names', () => {
  it('are the label, else D and the number of the id', () => {
    const s = sketch1(createDemoPart());
    expect(dimensionName(s.constraints.find((c) => c.id === 'd1')!)).toBe('寬度');
    expect(dimensionName({ id: 'd7', type: 'distance', a: 'l1', value: '5' })).toBe('D7');
    expect(dimensionName({ id: 'x9', type: 'radius', circle: 'c', value: '5' })).toBe('x9');
  });
});

describe('evaluating parameters', () => {
  it('a dimension can be a variable and an expression', () => {
    const doc = part([v('var1', 'w', '15'), v('var2', 'k', 'w*2')], (d) => setDim(d, 'd1', 'k + 3'));
    const p = new Parameters(doc);
    const c = sketch1(doc).constraints.find((x) => x.id === 'd1')!;
    expect(p.dimensionValue(sketch1(doc), c)).toEqual({ value: 33 });
    expect(p.variableValue(doc.variables[1]!)).toMatchObject({ value: { v: 30 } });
  });

  it('a bare name inside a sketch is a dimension of that sketch, and a variable of that name wins', () => {
    const doc = part([], (d) => setDim(d, 'd2', '寬度 / 2'));
    const p = new Parameters(doc);
    expect(p.dimensionValue(sketch1(doc), sketch1(doc).constraints.find((x) => x.id === 'd2')!)).toEqual({ value: 10 });
    const shadowed = part([v('var1', '寬度', '4')], (d) => setDim(d, 'd2', '寬度 * 2'));
    expect(new Parameters(shadowed).dimensionValue(sketch1(shadowed), sketch1(shadowed).constraints.find((x) => x.id === 'd2')!)).toEqual({ value: 8 });
  });

  it('a dimension of another sketch is written 名稱@草圖', () => {
    const doc = part([], (d) => {
      d.features[1]!.type === 'extrude' && ((d.features[1] as { dir1: unknown }).dir1 = { type: 'blind', depth: '寬度@草圖1 / 4' });
    });
    expect(resolveDoc(doc).doc.features[1]).toMatchObject({ dir1: { depth: '5' } });
  });

  it('reads file properties', () => {
    const doc = part([], (d) => {
      d.properties = { 板厚: '3mm' };
      (d.features[1] as { dir1: unknown }).dir1 = { type: 'blind', depth: "property('板厚') * 2" };
    });
    expect(resolveDoc(doc).doc.features[1]).toMatchObject({ dir1: { depth: '6' } });
  });

  it('reports a cycle between variables with its path, and nothing that depends on it evaluates', () => {
    const doc = part([v('var1', 'a', 'b + 1'), v('var2', 'b', 'a + 1'), v('var3', 'c', 'a * 2')]);
    const p = new Parameters(doc);
    expect(p.variableValue(doc.variables[0]!)).toEqual({ error: '循環引用：a → b → a' });
    expect(p.variableValue(doc.variables[1]!)).toMatchObject({ error: expect.stringContaining('循環引用') });
    expect(p.variableValue(doc.variables[2]!)).toMatchObject({ error: expect.stringContaining('循環引用') });
  });

  it('reports a cycle between dimensions', () => {
    const doc = part([], (d) => {
      setDim(d, 'd1', '高度@草圖1');
      setDim(d, 'd2', '寬度@草圖1');
    });
    const p = new Parameters(doc);
    const r = p.dimensionValue(sketch1(doc), sketch1(doc).constraints.find((x) => x.id === 'd1')!);
    expect(r).toEqual({ error: '循環引用：寬度@草圖1 → 高度@草圖1 → 寬度@草圖1' });
  });

  it('an unknown name, a duplicate name and a reference dimension are errors, not zeros', () => {
    const doc = part([v('var1', 'a', 'nope + 1'), v('var2', 'dup', '1'), v('var3', 'dup', '2')]);
    const p = new Parameters(doc);
    expect(p.variableValue(doc.variables[0]!)).toEqual({ error: '找不到變數「nope」' });
    expect(p.variableValue(doc.variables[2]!)).toEqual({ error: '變數名稱「dup」重複' });
    const ref = part([], (d) => {
      (sketch1(d).constraints.find((x) => x.id === 'd2') as { driving?: boolean }).driving = false;
      (d.features[1] as { dir1: unknown }).dir1 = { type: 'blind', depth: '高度@草圖1' };
    });
    expect(resolveDoc(ref).problems.get('extrude1')).toBe('「高度@草圖1」是參考尺寸，不能被引用');
  });
});

describe('resolving a document', () => {
  it('replaces every expression by its number, and leaves plain numbers and unchanged features alone', () => {
    const doc = part([v('var1', 'depth', '2 * 3mm')], (d) => {
      (d.features[1] as { dir1: unknown }).dir1 = { type: 'blind', depth: 'depth' };
      (d.features[2] as { radius: string }).radius = '2mm';
    });
    const { doc: resolved, problems } = resolveDoc(doc);
    expect(problems.size).toBe(0);
    expect(resolved.features[1]).toMatchObject({ dir1: { depth: '6' } });
    expect(resolved.features[0]).toBe(doc.features[0]); // nothing to resolve: the same object
    expect(resolved.features[2]).toBe(doc.features[2]);
    expect(doc.features[1]).toMatchObject({ dir1: { depth: 'depth' } }); // the document itself is not touched
  });

  it('writes an angle so it reads back exactly', () => {
    const doc = part([v('var1', 'a', '30deg + 15')], (d) => {
      d.features.push({ id: 'rp1', type: 'refPlane', name: '基準面1', suppressed: false, def: { mode: 'offset', plane: { kind: 'datum', name: 'plane:top' }, distance: '1' } } as Feature);
      d.features.push({ id: 'rp2', type: 'refPlane', name: '基準面2', suppressed: false, def: { mode: 'angle', plane: { kind: 'datum', name: 'plane:top' }, axis: { kind: 'edge', name: 'x' }, angle: 'a' } } as Feature);
    });
    const angle = (resolveDoc(doc).doc.features[4] as { def: { angle: string } }).def.angle;
    expect(angle.endsWith('rad')).toBe(true);
    expect(parseFloat(angle)).toBeCloseTo(Math.PI / 4, 12);
  });

  it('names the feature that cannot be evaluated, with the reason', () => {
    const doc = part([], (d) => {
      (d.features[2] as { radius: string }).radius = 'nope';
    });
    expect(resolveDoc(doc).problems.get('fillet1')).toBe('找不到變數「nope」');
  });
});

describe('who depends on whom', () => {
  const two = () =>
    part([v('var1', 'w', '寬度@草圖1 / 2')], (d) => {
      d.features.push({ id: 'sketch2', type: 'sketch', name: '草圖2', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [{ id: 'd9', type: 'radius', circle: 'c', value: 'w + 1' }] } as Feature);
    });

  it('a feature depends on the sketch whose dimension it uses, through variables too', () => {
    const doc = two();
    expect(expressionParents(doc, doc.features[3]!)).toEqual(['sketch1']);
    expect(expressionParents(doc, doc.features[0]!)).toEqual([]);
  });

  it('lists what uses a variable', () => {
    const doc = two();
    expect(variableUsers(doc, 'w')).toEqual({ variables: [], features: ['sketch2'] });
    expect(variableUsers(doc, 'zzz')).toEqual({ variables: [], features: [] });
  });

  it('renaming rewrites the expressions that use the name', () => {
    const doc = two();
    const renamed = renameInDoc(doc, (r) => (r.kind === 'variable' && r.name === 'w' ? { kind: 'variable', name: 'half' } : null));
    expect(exprsOf(renamed.features[3]!)[0]!.expr).toBe('half + 1');
    const sketchRenamed = renameInDoc(doc, (r) => (r.kind === 'dimension' && r.owner === '草圖1' ? { ...r, owner: '底板草圖' } : null));
    expect(sketchRenamed.variables[0]!.expr).toBe('寬度@底板草圖 / 2');
  });
});
