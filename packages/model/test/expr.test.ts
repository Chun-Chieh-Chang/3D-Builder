import { describe, expect, it } from 'vitest';
import { evalAngle, evalLength, evalNumber, ExprError, formatRef, NO_ENV, parseExpr, referencesOf, rewriteRefs, type Env } from '../src/expr';

const env = (vars: Record<string, string>, dims: Record<string, string> = {}, props: Record<string, string> = {}): Env => ({
  variable: (name) => (name in vars ? { v: Number(vars[name]), L: 1, A: 0 } : undefined),
  dimension: (name, owner) => (`${name}@${owner}` in dims ? { v: Number(dims[`${name}@${owner}`]), L: 1, A: 0 } : undefined),
  property: (name) => props[name],
});

describe('numbers and units', () => {
  it('reads what it always read', () => {
    expect(evalLength('20')).toBe(20);
    expect(evalLength('1in')).toBeCloseTo(25.4);
    expect(evalLength(' 2.5 cm ')).toBeCloseTo(25);
    expect(evalLength('2 m')).toBe(2000);
    expect(evalLength('1e2mm')).toBe(100);
    expect(evalLength('5"')).toBeCloseTo(127);
    expect(evalAngle('90')).toBeCloseTo(Math.PI / 2);
    expect(evalAngle('1rad')).toBe(1);
    expect(evalAngle('45°')).toBeCloseTo(Math.PI / 4);
    expect(evalAngle('30 deg')).toBeCloseTo(Math.PI / 6);
  });
  it('rejects a unit of the wrong kind and words it does not know', () => {
    expect(() => evalLength('30deg')).toThrow(ExprError);
    expect(() => evalAngle('5mm')).toThrow(ExprError);
    expect(() => evalLength('10 furlong')).toThrow(ExprError);
    expect(() => evalLength('')).toThrow(ExprError);
    expect(() => evalLength('abc')).toThrow(ExprError);
  });
});

describe('arithmetic', () => {
  it('has the usual precedence, and ^ before a unary minus', () => {
    expect(evalNumber('1+2*3')).toBe(7);
    expect(evalNumber('(1+2)*3')).toBe(9);
    expect(evalNumber('2^3^2')).toBe(512);
    expect(evalNumber('-2^2')).toBe(-4);
    expect(evalNumber('10 % 4')).toBe(2);
    expect(evalNumber('2*-3')).toBe(-6);
  });
  it('works out units: a length times a number is a length, a length over a length is a number', () => {
    expect(evalLength('3mm*2')).toBe(6);
    expect(evalNumber('10mm/2mm')).toBe(5);
    expect(evalLength('1in + 5mm')).toBeCloseTo(30.4);
    expect(() => evalLength('3mm*3mm')).toThrow(/長度\^2/);
    expect(evalNumber('(3mm*3mm)/(1mm*1mm)')).toBe(9);
  });
  it('lets a bare number take the unit of what it is added to', () => {
    expect(evalLength('3mm + 5')).toBe(8);
    expect(evalAngle('30deg + 15')).toBeCloseTo(Math.PI / 4);
    expect(() => evalLength('3mm + 30deg')).toThrow(/單位不符/);
  });
  it('refuses a result that is not a number', () => {
    expect(() => evalLength('1/0')).toThrow(/不是有限/);
    expect(() => evalNumber('ln(-1)')).toThrow(ExprError);
  });
});

describe('functions and conditions', () => {
  it('has the math functions, with degrees for a bare angle', () => {
    expect(evalNumber('sin(30)')).toBeCloseTo(0.5);
    expect(evalNumber('cos(60deg)')).toBeCloseTo(0.5);
    expect(evalNumber('sin(pi/2 * 1rad)')).toBeCloseTo(1);
    expect(evalAngle('atan(1)')).toBeCloseTo(Math.PI / 4);
    expect(evalLength('sqrt(4mm*9mm)')).toBeCloseTo(6);
    expect(evalLength('abs(-3mm)')).toBe(3);
    expect(evalLength('min(5, 2mm, 9)')).toBe(2);
    expect(evalLength('max(5mm, 2in)')).toBeCloseTo(50.8);
    expect(evalNumber('round(2.6)')).toBe(3);
    expect(evalNumber('pow(2, 10)')).toBe(1024);
    expect(evalNumber('pi')).toBeCloseTo(Math.PI);
  });
  it('checks the arguments', () => {
    expect(() => evalNumber('sin(1, 2)')).toThrow(/需要 1 個參數/);
    expect(() => evalNumber('sin(3mm)')).toThrow(/需要角度/);
    expect(() => evalNumber('nope(1)')).toThrow(/不支援的函數/);
    expect(() => evalNumber('sqrt(4mm)')).toThrow(ExprError);
  });
  it('compares, combines and chooses', () => {
    expect(evalNumber('3 < 4')).toBe(1);
    expect(evalNumber('3mm >= 3')).toBe(1);
    expect(evalNumber('1 && 0 || 1')).toBe(1);
    expect(evalNumber('!0')).toBe(1);
    expect(evalLength('if(3mm > 2, 10, 20)')).toBe(10);
    expect(evalLength('if(0, 10mm, 20)')).toBe(20);
  });
  it('looks only at the branch it takes', () => {
    expect(evalNumber('if(0, 1/0, 7)')).toBe(7);
  });
});

describe('names', () => {
  it('reads variables, quoted names and dimensions of a sketch', () => {
    const e = env({ wall_t: '3', 'my width': '40', 厚度: '2' }, { 'D1@草圖1': '25', 'w@Sketch 2': '10' });
    expect(evalLength('wall_t*2', e)).toBe(6);
    expect(evalLength('"my width" / 2', e)).toBe(20);
    expect(evalLength('厚度 + 1', e)).toBe(3);
    expect(evalLength('D1@草圖1 + wall_t', e)).toBe(28);
    expect(evalLength('"w@Sketch 2" * 2', e)).toBe(20);
  });
  it('says which name is missing', () => {
    expect(() => evalLength('nope + 1', NO_ENV)).toThrow('找不到變數「nope」');
    expect(() => evalLength('D9@草圖1', NO_ENV)).toThrow('找不到尺寸「D9@草圖1」');
  });
  it('reads a file property as a number with its units', () => {
    const e = env({}, {}, { 厚度: '2.5mm', 數量: '4' });
    expect(evalLength("property('厚度') * 2", e)).toBe(5);
    expect(evalNumber("property('數量')", e)).toBe(4);
    expect(() => evalLength("property('沒有')", e)).toThrow('找不到檔案屬性「沒有」');
    expect(() => evalLength("property('厚度'", e)).toThrow(ExprError);
    expect(() => evalLength('property(3)', e)).toThrow(/單引號/);
    const bad = env({}, {}, { 料號: 'A-12' });
    expect(() => evalLength("property('料號')", bad)).toThrow(/不是數值/);
  });
});

describe('syntax errors', () => {
  it('point at where the expression stops making sense', () => {
    expect(() => evalNumber('1 +')).toThrow(/不完整/);
    expect(() => evalNumber('(1')).toThrow(/不完整/);
    expect(() => evalNumber('1 2')).toThrow(/第 3 個字元/);
    expect(() => evalNumber('1 $ 2')).toThrow(/第 3 個字元/);
    expect(() => evalNumber("'text'")).toThrow(ExprError);
  });
});

describe('references and renaming', () => {
  it('lists each name once, in order', () => {
    expect(referencesOf(parseExpr('a + D1@草圖1 * a + sin(b)'))).toEqual([
      { kind: 'variable', name: 'a' },
      { kind: 'dimension', name: 'D1', owner: '草圖1' },
      { kind: 'variable', name: 'b' },
    ]);
  });
  it('rewrites the names and leaves the rest as typed', () => {
    const out = rewriteRefs('  wall_t *  2 + D1@草圖1', (r) => (r.kind === 'variable' && r.name === 'wall_t' ? { kind: 'variable', name: 'wall' } : r.kind === 'dimension' && r.owner === '草圖1' ? { ...r, owner: 'Base Sketch' } : null));
    expect(out).toBe('  wall *  2 + "D1@Base Sketch"');
    expect(evalLength(out, env({ wall: '3' }, { 'D1@Base Sketch': '5' }))).toBe(11);
  });
  it('leaves an expression that does not parse alone', () => {
    expect(rewriteRefs('1 +', () => ({ kind: 'variable', name: 'x' }))).toBe('1 +');
  });
  it('writes a name so it can be read back', () => {
    expect(formatRef({ kind: 'variable', name: 'a_1' })).toBe('a_1');
    expect(formatRef({ kind: 'variable', name: 'a b' })).toBe('"a b"');
    expect(formatRef({ kind: 'dimension', name: 'D3', owner: '草圖1' })).toBe('D3@草圖1');
    expect(formatRef({ kind: 'dimension', name: 'D3', owner: 'Sketch 1' })).toBe('"D3@Sketch 1"');
  });
});
