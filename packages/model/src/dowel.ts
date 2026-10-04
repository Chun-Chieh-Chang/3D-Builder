/**
 * Dowel pin holes (C4.8, Phase 4a-3): the fits a hole for a dowel pin is made to, from ISO 286-1. The model makes the hole at its nominal diameter — as
 * every CAD does, and so that a press-fitted pin touches its hole instead of being reported as interfering with it — and keeps the fit with the feature, for
 * the drawing (Phase 5) and for the limits shown next to the diameter.
 *
 * The tables are the ISO 286-1 values for the size ranges 1–3 up to 80–120 mm (a size is in the range it is "over" the lower bound of and "up to and
 * including" the upper, the first range starting at 1). Check them against the standard of your company before relying on them.
 */

/** The fits of a dowel pin hole: H6 and H7 for a press or light press fit, H8 for a looser one. */
export type DowelFit = 'H6' | 'H7' | 'H8';
export const DOWEL_FITS: readonly DowelFit[] = ['H6', 'H7', 'H8'];

/** The pins that go in them (ISO 8734 type A is m6, type B h8; h6 slides). */
export type PinClass = 'm6' | 'h6' | 'h8';

export const DOWEL_STANDARD_SOURCE = 'ISO 286-1 / ISO 8734';

/** Nominal diameters of dowel pins (ISO 8734), mm. */
export const ISO_DOWEL_DIAMETERS: readonly number[] = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 25, 30, 40, 50];

/** The size ranges (over `from`, up to and including `to`, mm) and the fundamental tolerances IT6, IT7, IT8 in µm. */
const RANGES: readonly { from: number; to: number; it: { 6: number; 7: number; 8: number }; m6: number }[] = [
  { from: 0, to: 3, it: { 6: 6, 7: 10, 8: 14 }, m6: 2 },
  { from: 3, to: 6, it: { 6: 8, 7: 12, 8: 18 }, m6: 4 },
  { from: 6, to: 10, it: { 6: 9, 7: 15, 8: 22 }, m6: 6 },
  { from: 10, to: 18, it: { 6: 11, 7: 18, 8: 27 }, m6: 7 },
  { from: 18, to: 30, it: { 6: 13, 7: 21, 8: 33 }, m6: 8 },
  { from: 30, to: 50, it: { 6: 16, 7: 25, 8: 39 }, m6: 9 },
  { from: 50, to: 80, it: { 6: 19, 7: 30, 8: 46 }, m6: 11 },
  { from: 80, to: 120, it: { 6: 22, 7: 35, 8: 54 }, m6: 13 },
];

/** The smallest and the largest nominal diameter the tables cover, mm. */
export const DOWEL_RANGE = { min: 1, max: 120 } as const;

const rangeOf = (nominal: number) => (nominal >= DOWEL_RANGE.min && nominal <= DOWEL_RANGE.max ? RANGES.find((r) => nominal > r.from && nominal <= r.to) : undefined);
const mm = (um: number) => Math.round(um) / 1000;

/** The limits of a hole of this fit (mm): from the nominal size up by the tolerance. Undefined outside the tables. */
export function holeLimits(nominal: number, fit: DowelFit): { min: number; max: number } | undefined {
  const r = rangeOf(nominal);
  if (!r) return undefined;
  const grade = Number(fit.slice(1)) as 6 | 7 | 8;
  return { min: nominal, max: Math.round((nominal + mm(r.it[grade])) * 1e6) / 1e6 };
}

/** The limits of a pin of this class (mm): m6 from the fundamental deviation up by IT6, h6 and h8 from the nominal size down by their tolerance. */
export function pinLimits(nominal: number, cls: PinClass): { min: number; max: number } | undefined {
  const r = rangeOf(nominal);
  if (!r) return undefined;
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  if (cls === 'm6') return { min: round(nominal + mm(r.m6)), max: round(nominal + mm(r.m6 + r.it[6])) };
  return { min: round(nominal - mm(r.it[cls === 'h6' ? 6 : 8])), max: nominal };
}

/** How the pin of this class sits in the hole of this fit at the extremes: the loosest clearance and the tightest (negative: interference), mm. */
export function fitClearance(nominal: number, fit: DowelFit, cls: PinClass): { loosest: number; tightest: number } | undefined {
  const hole = holeLimits(nominal, fit);
  const pin = pinLimits(nominal, cls);
  if (!hole || !pin) return undefined;
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return { loosest: round(hole.max - pin.min), tightest: round(hole.min - pin.max) };
}
