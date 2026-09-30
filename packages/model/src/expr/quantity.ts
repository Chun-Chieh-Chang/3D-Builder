import { t } from '@3db/i18n';

/**
 * A value with its units worked out: `v` in the internal units (mm, radians), `L` the power of length and
 * `A` the power of angle. 5 is (5, 0, 0); 5mm is (5, 1, 0); 30deg is (0.5236, 0, 1); 5mm·5mm is (25, 2, 0).
 */
export interface Quantity {
  v: number;
  L: number;
  A: number;
}

export const LENGTH_UNITS: Record<string, number> = { '': 1, mm: 1, cm: 10, m: 1000, in: 25.4, '"': 25.4 };
export const ANGLE_UNITS: Record<string, number> = { '': Math.PI / 180, deg: Math.PI / 180, '°': Math.PI / 180, rad: 1 };

export const isNumber = (q: Quantity) => q.L === 0 && q.A === 0;

/** What a quantity is, in words: 「長度」, 「角度」, 「無單位的數」. */
export function describe(q: Quantity): string {
  if (isNumber(q)) return t('expr.dim.none');
  if (q.L === 1 && q.A === 0) return t('expr.dim.length');
  if (q.L === 0 && q.A === 1) return t('expr.dim.angle');
  return t('expr.dim.other', { l: q.L, a: q.A });
}

/** A number in a length context is millimetres, in an angle context degrees (as before expressions existed). */
export const defaultUnit = (L: number, A: number): number => (L !== 0 ? 1 : A !== 0 ? Math.PI / 180 : 1);

const shown = (v: number) => String(Math.round(v * 1e6) / 1e6);

/** A value for the screen: 「6 mm」, 「45°」, 「2」; other units in words. */
export function formatQuantity(q: Quantity): string {
  if (isNumber(q)) return shown(q.v);
  if (q.L === 1 && q.A === 0) return `${shown(q.v)} mm`;
  if (q.L === 0 && q.A === 1) return `${shown((q.v * 180) / Math.PI)}°`;
  return `${shown(q.v)} (${describe(q)})`;
}
