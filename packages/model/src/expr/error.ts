import type { Expr } from '../schema';

export class ExprError extends Error {
  constructor(
    readonly expr: Expr,
    message: string,
  ) {
    super(message);
    this.name = 'ExprError';
  }
}
