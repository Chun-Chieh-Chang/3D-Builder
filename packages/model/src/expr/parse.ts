import { t } from '@3db/i18n';
import type { Expr } from '../schema';
import { ExprError } from './error';
import { ANGLE_UNITS, LENGTH_UNITS, type Quantity } from './quantity';

/**
 * A name an expression uses (B5.2, B5.3): a global variable, or a driving dimension of a sketch
 * ("D3@草圖1", as SolidWorks writes it).
 */
export type NameRef = { kind: 'variable'; name: string } | { kind: 'dimension'; name: string; owner: string };

export type Node =
  | { t: 'num'; q: Quantity }
  | { t: 'str'; s: string }
  | { t: 'ref'; ref: NameRef; span: [number, number] }
  | { t: 'un'; op: '-' | '+' | '!'; a: Node }
  | { t: 'bin'; op: BinOp; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] };

export type BinOp = '+' | '-' | '*' | '/' | '%' | '^' | '<' | '>' | '<=' | '>=' | '==' | '!=' | '&&' | '||';

type Tok =
  | { k: 'num'; v: number; unit: string | null; at: number; end: number }
  | { k: 'id'; s: string; at: number; end: number }
  | { k: 'qname'; s: string; at: number; end: number }
  | { k: 'str'; s: string; at: number; end: number }
  | { k: 'op'; s: string; at: number; end: number }
  | { k: 'eof'; at: number; end: number };

const ID_START = /[\p{L}_]/u;
const ID_PART = /[\p{L}\p{N}_]/u;
const UNITS = new Set([...Object.keys(LENGTH_UNITS), ...Object.keys(ANGLE_UNITS)].filter((u) => u !== ''));
const TWO = new Set(['<=', '>=', '==', '!=', '&&', '||']);

function syntax(expr: Expr, at: number): never {
  throw new ExprError(expr, t('expr.syntax', { pos: at + 1, near: expr.slice(at, at + 8) }));
}

function lex(expr: Expr): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    const at = i;
    const num = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(expr.slice(i));
    if (num) {
      i += num[0].length;
      // a unit right after the number: "25.4mm", "2 in", 30deg, 5", 90°
      const unit = /^\s*(?:([\p{L}]+)|(["°]))/u.exec(expr.slice(i));
      let name: string | null = null;
      if (unit) {
        const candidate = unit[1] ?? unit[2]!;
        // a quote or degree sign must touch the number; a word unit may follow a space
        if (UNITS.has(candidate.toLowerCase()) && (unit[1] !== undefined || unit[0] === candidate)) {
          name = candidate.toLowerCase();
          i += unit[0].length;
        }
      }
      out.push({ k: 'num', v: Number(num[0]), unit: name, at, end: i });
      continue;
    }
    if (ID_START.test(c)) {
      while (i < expr.length && ID_PART.test(expr[i]!)) i += 1;
      out.push({ k: 'id', s: expr.slice(at, i), at, end: i });
      continue;
    }
    if (c === '"' || c === "'") {
      const close = expr.indexOf(c, i + 1);
      if (close < 0) syntax(expr, at);
      out.push({ k: c === '"' ? 'qname' : 'str', s: expr.slice(i + 1, close), at, end: close + 1 });
      i = close + 1;
      continue;
    }
    const two = expr.slice(i, i + 2);
    if (TWO.has(two)) {
      out.push({ k: 'op', s: two, at, end: i + 2 });
      i += 2;
      continue;
    }
    if ('+-*/%^()<>,!@'.includes(c)) {
      out.push({ k: 'op', s: c, at, end: i + 1 });
      i += 1;
      continue;
    }
    syntax(expr, at);
  }
  out.push({ k: 'eof', at: expr.length, end: expr.length });
  return out;
}

function quantityOf(v: number, unit: string | null): Quantity {
  if (unit === null) return { v, L: 0, A: 0 };
  const len = LENGTH_UNITS[unit];
  if (len !== undefined) return { v: v * len, L: 1, A: 0 };
  return { v: v * ANGLE_UNITS[unit]!, L: 0, A: 1 };
}

/** Parses an expression into a tree; throws `ExprError` at the first thing that is not one. */
export function parseExpr(expr: Expr): Node {
  const toks = lex(expr);
  let p = 0;
  const peek = () => toks[p]!;
  const isOp = (s: string) => peek().k === 'op' && (peek() as { s: string }).s === s;
  const take = () => toks[p++]!;
  const fail = (tok: Tok): never => {
    if (tok.k === 'eof') throw new ExprError(expr, t('expr.incomplete', { expr }));
    return syntax(expr, tok.at);
  };
  const expect = (s: string) => {
    if (!isOp(s)) fail(peek());
    take();
  };

  const binary = (ops: string[], next: () => Node): Node => {
    let a = next();
    while (peek().k === 'op' && ops.includes((peek() as { s: string }).s)) {
      const op = (take() as { s: string }).s as BinOp;
      a = { t: 'bin', op, a, b: next() };
    }
    return a;
  };

  const primary = (): Node => {
    const tok = take();
    switch (tok.k) {
      case 'num':
        return { t: 'num', q: quantityOf(tok.v, tok.unit) };
      case 'str':
        return { t: 'str', s: tok.s };
      case 'qname': {
        const at = tok.s.lastIndexOf('@');
        const ref: NameRef = at < 0 ? { kind: 'variable', name: tok.s } : { kind: 'dimension', name: tok.s.slice(0, at), owner: tok.s.slice(at + 1) };
        return { t: 'ref', ref, span: [tok.at, tok.end] };
      }
      case 'id': {
        if (isOp('(')) {
          take();
          const args: Node[] = [];
          if (!isOp(')')) {
            do args.push(orExpr());
            while (isOp(',') && take());
          }
          expect(')');
          return { t: 'call', name: tok.s, args };
        }
        if (isOp('@')) {
          take();
          const owner = take();
          if (owner.k !== 'id' && owner.k !== 'qname') return fail(owner);
          return { t: 'ref', ref: { kind: 'dimension', name: tok.s, owner: owner.s }, span: [tok.at, owner.end] };
        }
        return { t: 'ref', ref: { kind: 'variable', name: tok.s }, span: [tok.at, tok.end] };
      }
      case 'op':
        if (tok.s === '(') {
          const inner = orExpr();
          expect(')');
          return inner;
        }
        return fail(tok);
      default:
        return fail(tok);
    }
  };
  // ^ binds tighter than a unary minus on its left (-2^2 is -4) and groups to the right
  const power = (): Node => {
    const a = primary();
    if (isOp('^')) {
      take();
      return { t: 'bin', op: '^', a, b: unary() };
    }
    return a;
  };
  const unary = (): Node => {
    if (peek().k === 'op' && ['-', '+', '!'].includes((peek() as { s: string }).s)) {
      const op = (take() as { s: string }).s as '-' | '+' | '!';
      return { t: 'un', op, a: unary() };
    }
    return power();
  };
  const multiplicative = () => binary(['*', '/', '%'], unary);
  const additive = () => binary(['+', '-'], multiplicative);
  const comparison = () => binary(['<', '>', '<=', '>=', '==', '!='], additive);
  const andExpr = () => binary(['&&'], comparison);
  const orExpr = () => binary(['||'], andExpr);

  const tree = orExpr();
  if (peek().k !== 'eof') fail(peek());
  return tree;
}

/** Every name an expression uses, in order of appearance (with repeats removed). */
export function referencesOf(node: Node): NameRef[] {
  const out: NameRef[] = [];
  const seen = new Set<string>();
  const walk = (n: Node) => {
    switch (n.t) {
      case 'ref': {
        const key = n.ref.kind === 'variable' ? n.ref.name : `${n.ref.name}@${n.ref.owner}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(n.ref);
        }
        return;
      }
      case 'un':
        return walk(n.a);
      case 'bin':
        walk(n.a);
        return walk(n.b);
      case 'call':
        return n.args.forEach(walk);
      default:
    }
  };
  walk(node);
  return out;
}

/** How a name is written so it can be read back: bare when it can be, else in double quotes. */
export function formatRef(ref: NameRef): string {
  const bare = (s: string) => s.length > 0 && ID_START.test(s[0]!) && [...s].every((ch) => ID_PART.test(ch));
  if (ref.kind === 'variable') return bare(ref.name) ? ref.name : `"${ref.name}"`;
  return bare(ref.name) && bare(ref.owner) ? `${ref.name}@${ref.owner}` : `"${ref.name}@${ref.owner}"`;
}

/**
 * Rewrites the names in an expression (B5.3: renaming a variable, a sketch or a dimension must not break
 * what refers to it): `map` returns the name to write instead, or null to keep it. The rest of the text,
 * spaces included, stays as typed. An expression that does not parse is returned unchanged.
 */
export function rewriteRefs(expr: Expr, map: (ref: NameRef) => NameRef | null): Expr {
  let tree: Node;
  try {
    tree = parseExpr(expr);
  } catch {
    return expr;
  }
  const edits: { span: [number, number]; text: string }[] = [];
  const walk = (n: Node) => {
    if (n.t === 'ref') {
      const next = map(n.ref);
      if (next) edits.push({ span: n.span, text: formatRef(next) });
    } else if (n.t === 'un') walk(n.a);
    else if (n.t === 'bin') (walk(n.a), walk(n.b));
    else if (n.t === 'call') n.args.forEach(walk);
  };
  walk(tree);
  let out = expr;
  for (const e of edits.sort((a, b) => b.span[0] - a.span[0])) out = out.slice(0, e.span[0]) + e.text + out.slice(e.span[1]);
  return out;
}
