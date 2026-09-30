import { t } from '@3db/i18n';
import type { Expr } from '../schema';
import { ExprError } from './error';
import { parseExpr, type BinOp, type Node } from './parse';
import { defaultUnit, describe, isNumber, type Quantity } from './quantity';

/**
 * What an expression can look up (B5.2, B5.3). An implementation answers `undefined` for a name it does not
 * have, and may throw an `ExprError` of its own (a variable that cannot be evaluated, a cycle).
 */
export interface Env {
  variable(name: string): Quantity | undefined;
  /** A driving dimension of the sketch called `owner`. */
  dimension(name: string, owner: string): Quantity | undefined;
  /** The text of a file property (B8.3). */
  property(name: string): string | undefined;
}

/** Nothing to look up: expressions made of numbers, units, operators and functions only. */
export const NO_ENV: Env = { variable: () => undefined, dimension: () => undefined, property: () => undefined };

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

const num = (v: number): Quantity => ({ v, L: 0, A: 0 });

function needNumber(expr: Expr, q: Quantity): number {
  if (!isNumber(q)) throw new ExprError(expr, t('expr.expectedNumber', { got: describe(q) }));
  return q.v;
}

/** Two quantities to be added, compared or picked between: a bare number takes the other's default unit (5 + 3mm is 8mm). */
function align(expr: Expr, a: Quantity, b: Quantity): [Quantity, Quantity] {
  if (a.L === b.L && a.A === b.A) return [a, b];
  if (isNumber(a)) return [{ v: a.v * defaultUnit(b.L, b.A), L: b.L, A: b.A }, b];
  if (isNumber(b)) return [a, { v: b.v * defaultUnit(a.L, a.A), L: a.L, A: a.A }];
  throw new ExprError(expr, t('expr.unitMismatch', { left: describe(a), right: describe(b) }));
}

function power(expr: Expr, a: Quantity, b: Quantity): Quantity {
  const n = needNumber(expr, b);
  if (isNumber(a)) return num(a.v ** n);
  if (!Number.isInteger(n)) throw new ExprError(expr, t('expr.badPower'));
  return { v: a.v ** n, L: a.L * n, A: a.A * n };
}

function angleArg(expr: Expr, q: Quantity): number {
  if (isNumber(q)) return (q.v * Math.PI) / 180; // sin(30) is sin of 30 degrees, as in SolidWorks
  if (q.L === 0 && q.A === 1) return q.v;
  throw new ExprError(expr, t('expr.expectedAngle', { got: describe(q) }));
}

const arity = (expr: Expr, name: string, args: unknown[], count: number) => {
  if (args.length !== count) throw new ExprError(expr, t('expr.arity', { name, count }));
};

function call(expr: Expr, node: Extract<Node, { t: 'call' }>, env: Env): Quantity {
  const name = node.name.toLowerCase();
  const args = node.args;
  if (name === 'property') {
    arity(expr, node.name, args, 1);
    const key = args[0]!;
    if (key.t !== 'str') throw new ExprError(expr, t('expr.needsString', { name: node.name }));
    const text = env.property(key.s);
    if (text === undefined) throw new ExprError(expr, t('expr.propertyMissing', { name: key.s }));
    try {
      return evaluate(parseExpr(text), NO_ENV, text);
    } catch {
      throw new ExprError(expr, t('expr.propertyNotNumber', { name: key.s, value: text }));
    }
  }
  // if() looks only at the branch it takes, so if(x==0, 0, 1/x) is safe
  if (name === 'if') {
    arity(expr, node.name, args, 3);
    const test = needNumber(expr, evaluate(args[0]!, env, expr));
    const [yes, no] = align(expr, evaluate(args[1]!, env, expr), evaluate(args[2]!, env, expr));
    return test !== 0 ? yes : no;
  }
  const values = args.map((a) => evaluate(a, env, expr));
  const one = () => {
    arity(expr, node.name, values, 1);
    return values[0]!;
  };
  switch (name) {
    case 'sin':
      return num(Math.sin(angleArg(expr, one())));
    case 'cos':
      return num(Math.cos(angleArg(expr, one())));
    case 'tan':
      return num(Math.tan(angleArg(expr, one())));
    case 'asin':
      return { v: Math.asin(needNumber(expr, one())), L: 0, A: 1 };
    case 'acos':
      return { v: Math.acos(needNumber(expr, one())), L: 0, A: 1 };
    case 'atan':
      return { v: Math.atan(needNumber(expr, one())), L: 0, A: 1 };
    case 'atan2': {
      arity(expr, node.name, values, 2);
      const [y, x] = align(expr, values[0]!, values[1]!);
      return { v: Math.atan2(y.v, x.v), L: 0, A: 1 };
    }
    case 'sqrt': {
      const q = one();
      if (q.L % 2 !== 0 || q.A % 2 !== 0) throw new ExprError(expr, t('expr.badPower'));
      return { v: Math.sqrt(q.v), L: q.L / 2, A: q.A / 2 };
    }
    case 'abs':
      return { ...one(), v: Math.abs(one().v) };
    case 'round':
      return { ...one(), v: Math.round(one().v) };
    case 'floor':
      return { ...one(), v: Math.floor(one().v) };
    case 'ceil':
      return { ...one(), v: Math.ceil(one().v) };
    case 'sign':
      return num(Math.sign(one().v));
    case 'exp':
      return num(Math.exp(needNumber(expr, one())));
    case 'ln':
    case 'log':
      return num(Math.log(needNumber(expr, one())));
    case 'log10':
      return num(Math.log10(needNumber(expr, one())));
    case 'pow': {
      arity(expr, node.name, values, 2);
      return power(expr, values[0]!, values[1]!);
    }
    case 'min':
    case 'max': {
      if (values.length === 0) throw new ExprError(expr, t('expr.arity', { name: node.name, count: 1 }));
      return values.reduce((best, q) => {
        const [a, b] = align(expr, best, q);
        return (name === 'min' ? b.v < a.v : b.v > a.v) ? b : a;
      });
    }
    default:
      throw new ExprError(expr, t('expr.unknownFunction', { name: node.name }));
  }
}

function binary(expr: Expr, op: BinOp, a: Quantity, b: Quantity): Quantity {
  switch (op) {
    case '+':
    case '-': {
      const [x, y] = align(expr, a, b);
      return { ...x, v: op === '+' ? x.v + y.v : x.v - y.v };
    }
    case '*':
      return { v: a.v * b.v, L: a.L + b.L, A: a.A + b.A };
    case '/':
      return { v: a.v / b.v, L: a.L - b.L, A: a.A - b.A };
    case '%': {
      const [x, y] = align(expr, a, b);
      return { ...x, v: x.v % y.v };
    }
    case '^':
      return power(expr, a, b);
    case '<':
    case '>':
    case '<=':
    case '>=':
    case '==':
    case '!=': {
      const [x, y] = align(expr, a, b);
      const r = op === '<' ? x.v < y.v : op === '>' ? x.v > y.v : op === '<=' ? x.v <= y.v : op === '>=' ? x.v >= y.v : op === '==' ? x.v === y.v : x.v !== y.v;
      return num(r ? 1 : 0);
    }
    case '&&':
      return num(needNumber(expr, a) !== 0 && needNumber(expr, b) !== 0 ? 1 : 0);
    case '||':
      return num(needNumber(expr, a) !== 0 || needNumber(expr, b) !== 0 ? 1 : 0);
  }
}

function evaluate(node: Node, env: Env, expr: Expr): Quantity {
  switch (node.t) {
    case 'num':
      return node.q;
    case 'str':
      throw new ExprError(expr, t('expr.syntax', { pos: 1, near: `'${node.s}'` }));
    case 'ref': {
      const r = node.ref;
      if (r.kind === 'variable') {
        const q = env.variable(r.name);
        if (q) return q;
        const c = CONSTANTS[r.name.toLowerCase()];
        if (c !== undefined) return num(c);
        throw new ExprError(expr, t('expr.unknownVariable', { name: r.name }));
      }
      const q = env.dimension(r.name, r.owner);
      if (!q) throw new ExprError(expr, t('expr.unknownDimension', { name: r.name, owner: r.owner }));
      return q;
    }
    case 'un': {
      const a = evaluate(node.a, env, expr);
      if (node.op === '!') return num(needNumber(expr, a) === 0 ? 1 : 0);
      return node.op === '-' ? { ...a, v: -a.v } : a;
    }
    case 'bin':
      return binary(expr, node.op, evaluate(node.a, env, expr), evaluate(node.b, env, expr));
    case 'call':
      return call(expr, node, env);
  }
}

/** The value of an expression with its units (B5.3). */
export function evalQuantity(expr: Expr, env: Env = NO_ENV): Quantity {
  const q = evaluate(parseExpr(expr), env, expr);
  if (!Number.isFinite(q.v)) throw new ExprError(expr, t('expr.notFinite', { expr }));
  return q;
}

/** Length expression → millimetres (internal unit, B8.1). A number without a unit is millimetres. */
export function evalLength(expr: Expr, env: Env = NO_ENV): number {
  const q = evalQuantity(expr, env);
  if (q.A === 0 && (q.L === 1 || q.L === 0)) return q.v;
  throw new ExprError(expr, t('expr.expectedLength', { got: describe(q) }));
}

/** Angle expression → radians (internal unit, B8.1). A number without a unit is degrees. */
export function evalAngle(expr: Expr, env: Env = NO_ENV): number {
  const q = evalQuantity(expr, env);
  if (q.L === 0 && q.A === 0) return (q.v * Math.PI) / 180;
  if (q.L === 0 && q.A === 1) return q.v;
  throw new ExprError(expr, t('expr.expectedAngle', { got: describe(q) }));
}

/** A number without units. */
export function evalNumber(expr: Expr, env: Env = NO_ENV): number {
  return needNumber(expr, evalQuantity(expr, env));
}
