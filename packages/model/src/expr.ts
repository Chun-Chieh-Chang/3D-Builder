import type { Expr } from './schema';

export class ExprError extends Error {
  constructor(
    readonly expr: Expr,
    message: string,
  ) {
    super(message);
    this.name = 'ExprError';
  }
}

const LENGTH_UNITS: Record<string, number> = { '': 1, mm: 1, cm: 10, m: 1000, in: 25.4, '"': 25.4 };
const ANGLE_UNITS: Record<string, number> = { '': Math.PI / 180, deg: Math.PI / 180, '°': Math.PI / 180, rad: 1 };

function parse(expr: Expr, units: Record<string, number>, kind: string): number {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z"°]*)\s*$/i.exec(expr);
  if (!m) throw new ExprError(expr, `無法解析${kind}：「${expr}」`);
  const factor = units[(m[2] ?? '').toLowerCase()];
  if (factor === undefined) throw new ExprError(expr, `不支援的${kind}單位：「${m[2]}」`);
  return Number(m[1]) * factor;
}

/** Length expression → millimetres (internal unit, B8.1). */
export function evalLength(expr: Expr): number {
  return parse(expr, LENGTH_UNITS, '長度');
}

/** Angle expression (degrees by default) → radians (internal unit, B8.1). */
export function evalAngle(expr: Expr): number {
  return parse(expr, ANGLE_UNITS, '角度');
}
