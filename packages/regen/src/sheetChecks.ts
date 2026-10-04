import { t } from '@3db/i18n';
import type { Kernel } from '@3db/kernel';
import type { Id } from '@3db/model';
import type { SheetInfo } from './engine';
import { flatPattern, FlatError, type FlatPattern } from './flatPattern';

/**
 * The manufacturability checks of a sheet metal part (C11, ADR 0090): rules of thumb about what a shop can make, worked out from the bend data and the flat pattern. The limits
 * are the user's (they are not standards: they are where to start, and the window changes them): the inside radius of a bend as a multiple of the thickness, the flat piece after
 * a bend as a multiple of the thickness, and the distance from a hole to the nearest bend as a multiple of the thickness. Every check that was made is given, passed or not.
 */

export interface SheetCheckLimits {
  /** The least inside bend radius, in thicknesses. */
  radius: number;
  /** The least flat piece after a bend, in thicknesses. */
  flange: number;
  /** The least distance from the edge of a hole to the zone of the nearest bend, in thicknesses. */
  hole: number;
}

export const DEFAULT_SHEET_LIMITS: SheetCheckLimits = { radius: 1, flange: 4, hole: 2 };

export type SheetCheckRule = 'bendRadius' | 'flangeLength' | 'holeToBend' | 'reliefMissing';

export interface SheetCheck {
  rule: SheetCheckRule;
  feature: Id;
  /** The bend or the hole it is about. */
  name: string;
  /** What there is, and what is least allowed (mm); both 0 for the relief rule. */
  value: number;
  limit: number;
  ok: boolean;
  message: string;
}

const num = (v: number) => String(Math.round(v * 1000) / 1000);

/** The distance from `p` to the segment `a`–`b`. */
function distance(p: [number, number], a: [number, number], b: [number, number]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + k * dx), p[1] - (a[1] + k * dy));
}

/** `made` is the pattern when the caller has it (it is not released here); `null` when it could not be made; absent, it is made here. */
export function sheetChecks(kernel: Kernel, sheet: SheetInfo, limits: SheetCheckLimits = DEFAULT_SHEET_LIMITS, made?: FlatPattern | null): SheetCheck[] {
  const T = sheet.thickness;
  const checks: SheetCheck[] = [];
  for (const b of sheet.bends) {
    const limit = limits.radius * T;
    const ok = b.radius >= limit - 1e-9;
    checks.push({ rule: 'bendRadius', feature: b.feature, name: b.name, value: b.radius, limit, ok, message: t('sheetCheck.bendRadius', { feature: b.feature, name: b.name, value: num(b.radius), limit: num(limit) }) });
  }
  for (const f of sheet.flanges) {
    const limit = limits.flange * T;
    const ok = f.straight >= limit - 1e-9;
    checks.push({ rule: 'flangeLength', feature: f.feature, name: f.feature, value: f.straight, limit, ok, message: t('sheetCheck.flangeLength', { feature: f.feature, value: num(f.straight), limit: num(limit) }) });
    if (f.inset[0] > 1e-9 || f.inset[1] > 1e-9) {
      const ok2 = f.relief !== null;
      checks.push({ rule: 'reliefMissing', feature: f.feature, name: f.feature, value: Math.max(f.inset[0], f.inset[1]), limit: 0, ok: ok2, message: t(ok2 ? 'sheetCheck.reliefThere' : 'sheetCheck.reliefMissing', { feature: f.feature }) });
    }
  }
  // the holes of the pattern against the zone of the bend nearest to each
  let pattern: FlatPattern | null | undefined = made;
  if (pattern === undefined) {
    try {
      pattern = flatPattern(kernel, sheet);
    } catch (e) {
      if (e instanceof FlatError) return checks;
      throw e;
    }
  }
  if (!pattern) return checks;
  try {
    const holes = pattern.outline.flatMap((s) => (s.kind === 'circle' && 2 * s.r < Math.min(pattern.width, pattern.height) - 1e-6 ? [s] : []));
    for (const h of holes) {
      let best: { name: string; feature: Id; gap: number } | null = null;
      for (const b of pattern.bends) {
        const gap = distance(h.c, b.a, b.b) - b.allowance / 2 - h.r;
        if (!best || gap < best.gap) best = { name: b.name, feature: b.feature, gap };
      }
      if (!best) continue;
      const limit = limits.hole * T;
      const at = `(${num(h.c[0])}, ${num(h.c[1])})`;
      checks.push({ rule: 'holeToBend', feature: best.feature, name: `${at} Ø${num(2 * h.r)}`, value: best.gap, limit, ok: best.gap >= limit - 1e-9, message: t('sheetCheck.holeToBend', { at, d: num(2 * h.r), feature: best.feature, value: num(best.gap), limit: num(limit) }) });
    }
  } finally {
    if (made === undefined) kernel.release(pattern.shape);
  }
  return checks;
}
