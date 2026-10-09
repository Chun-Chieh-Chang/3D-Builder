/**
 * Units of length and angle as they are written for the person (measuring, the dimensions of a drawing). Everything the model holds is in millimetres and degrees; a unit
 * only changes how a number is shown. Inches are decimal (`1.693in`) or, when asked, fractions of an inch (`1 11/16in`), as eDrawings shows them.
 */
export type LengthUnit = 'mm' | 'in';
export type AngleUnit = 'deg' | 'rad';

export const MM_PER_INCH = 25.4;

export const LENGTH_UNITS: readonly LengthUnit[] = ['mm', 'in'];

/** How a length is written. */
export interface LengthFormat {
  unit: LengthUnit;
  /** Decimals (default 3 for millimetres, 4 for inches). */
  places?: number;
  /** Inches only: as a fraction of an inch (with `denominator` as the finest part) instead of a decimal. */
  fraction?: boolean;
  /** The denominator of the fraction, a power of two from 2 to 128 (default 16). */
  denominator?: number;
  /**
   * With `fraction`: take the nearest fraction (a number that is not one is rounded to it). Without it, a number that is a fraction is written as one, and any other as a
   * decimal, so that nothing is said that is not so.
   */
  nearest?: boolean;
}

export const DEFAULT_PLACES: Record<LengthUnit, number> = { mm: 3, in: 4 };
export const DENOMINATORS: readonly number[] = [2, 4, 8, 16, 32, 64, 128];

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** A number to `places` decimals without the zeros that do not matter (and no −0). */
export function decimal(v: number, places: number): string {
  const k = 10 ** places;
  const s = (Math.round(v * k) / k + 0).toFixed(places).replace(/\.?0+$/, '');
  return s === '-0' || s === '' ? '0' : s;
}

/** A length of `mm` millimetres in inches. */
export const toInches = (mm: number): number => mm / MM_PER_INCH;

/** The length in the unit, as a number. */
export const inUnit = (mm: number, unit: LengthUnit): number => (unit === 'in' ? toInches(mm) : mm);

/** A length in the unit, as a number with the decimals of `places` and no more. */
export function valueIn(mm: number, unit: LengthUnit, places = DEFAULT_PLACES[unit]): string {
  return decimal(inUnit(mm, unit), places);
}

/** The whole inches and the fraction of a length in inches at `denominator`, reduced: `{ whole: 1, num: 11, den: 16 }` for 1.6875. Null when it is not that fraction (and `nearest` is not asked). */
function fractionOf(inches: number, denominator: number, nearest: boolean): { sign: string; whole: number; num: number; den: number } | null {
  const sign = inches < 0 ? '-' : '';
  const a = Math.abs(inches);
  const parts = Math.round(a * denominator);
  if (!nearest && Math.abs(parts / denominator - a) > 1e-6) return null;
  const whole = Math.floor(parts / denominator);
  const rest = parts - whole * denominator;
  const g = rest === 0 ? 1 : gcd(rest, denominator);
  return { sign: parts === 0 ? '' : sign, whole, num: rest / g, den: denominator / g };
}

/** A length of `mm` millimetres as it is written: `43mm`, `1.693in`, `1 11/16in`. */
export function formatLength(mm: number, f: LengthFormat): string {
  if (f.unit === 'mm') return `${decimal(mm, f.places ?? DEFAULT_PLACES.mm)}mm`;
  const inches = toInches(mm);
  if (f.fraction) {
    const x = fractionOf(inches, f.denominator ?? 16, !!f.nearest);
    if (x) {
      const frac = x.num === 0 ? '' : `${x.num}/${x.den}`;
      const text = x.whole === 0 && frac ? frac : x.num === 0 ? String(x.whole) : `${x.whole} ${frac}`;
      return `${x.sign}${text}in`;
    }
  }
  return `${decimal(inches, f.places ?? DEFAULT_PLACES.in)}in`;
}

/** An angle of `deg` degrees as it is written: `45°`, `0.7854rad`. */
export function formatAngle(deg: number, unit: AngleUnit, places = 3): string {
  return unit === 'rad' ? `${decimal((deg * Math.PI) / 180, places + 1)}rad` : `${decimal(deg, places)}°`;
}
