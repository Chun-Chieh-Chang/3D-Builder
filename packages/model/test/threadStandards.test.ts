import { describe, expect, it } from 'vitest';
import {
  ALL_STANDARD_THREADS,
  fundamentalTriangleHeight,
  generateStandardThreadProfile,
  listThreadsBySystem,
  lookupThread,
} from '../src/threadStandards';

describe('Standard Thread Library & ISO 68-1 Profile (T-6)', () => {
  it('includes standard metric coarse threads with exact ISO 261 / ISO 262 dimensions', () => {
    const m6 = lookupThread('M6');
    expect(m6).toBeDefined();
    expect(m6?.nominalDia).toBe(6.0);
    expect(m6?.pitch).toBe(1.0);
    expect(m6?.extMinorDia).toBeCloseTo(4.773, 3);
    expect(m6?.intMinorDia).toBeCloseTo(4.917, 3);

    const m10 = lookupThread('m10'); // case-insensitive check
    expect(m10).toBeDefined();
    expect(m10?.nominalDia).toBe(10.0);
    expect(m10?.pitch).toBe(1.5);
  });

  it('includes metric fine threads with specific pitch designations', () => {
    const m10fine = lookupThread('M10x1.25');
    expect(m10fine).toBeDefined();
    expect(m10fine?.nominalDia).toBe(10.0);
    expect(m10fine?.pitch).toBe(1.25);
    expect(m10fine?.system).toBe('metric-fine');

    const m8fine = lookupThread('M8X1.0');
    expect(m8fine).toBeDefined();
    expect(m8fine?.nominalDia).toBe(8.0);
    expect(m8fine?.pitch).toBe(1.0);
  });

  it('includes ANSI B1.1 UNC and UNF unified inch series converted to mm', () => {
    const uncQuarter = lookupThread('1/4-20 UNC');
    expect(uncQuarter).toBeDefined();
    expect(uncQuarter?.nominalDia).toBeCloseTo(6.350, 3);
    expect(uncQuarter?.pitch).toBeCloseTo(25.4 / 20, 5);
    expect(uncQuarter?.tpi).toBe(20);

    const unfQuarter = lookupThread('1/4-28 UNF');
    expect(unfQuarter).toBeDefined();
    expect(unfQuarter?.nominalDia).toBeCloseTo(6.350, 3);
    expect(unfQuarter?.pitch).toBeCloseTo(25.4 / 28, 5);
    expect(unfQuarter?.tpi).toBe(28);
  });

  it('categorizes threads properly across systems', () => {
    const coarse = listThreadsBySystem('metric-coarse');
    const fine = listThreadsBySystem('metric-fine');
    const unc = listThreadsBySystem('unc');
    const unf = listThreadsBySystem('unf');

    expect(coarse.length).toBeGreaterThanOrEqual(15);
    expect(fine.length).toBeGreaterThanOrEqual(10);
    expect(unc.length).toBeGreaterThanOrEqual(11);
    expect(unf.length).toBeGreaterThanOrEqual(6);
    expect(ALL_STANDARD_THREADS.length).toBe(coarse.length + fine.length + unc.length + unf.length);
  });

  it('calculates fundamental triangle height H = sqrt(3)/2 * P', () => {
    const P = 1.0;
    const H = fundamentalTriangleHeight(P);
    expect(H).toBeCloseTo((Math.sqrt(3) / 2) * 1.0, 8);
  });

  it('generates 2D tooth profile for external thread cut with flank angle 30° and safe width < pitch', () => {
    const m6 = lookupThread('M6')!;
    const profile = generateStandardThreadProfile(m6, { op: 'cut', target: 'external' });

    // Profile is a closed polygon with 6 vertices (inner root flat + 30° flanks + parallel margin extension)
    expect(profile.length).toBe(6);

    const zs = profile.map((p) => p[1]);
    const rs = profile.map((p) => p[0]);

    // Outer radius > nominalDia / 2 due to extension margin
    expect(Math.max(...rs)).toBeGreaterThan(6.0 / 2);
    // Inner radius matches minor radius
    expect(Math.min(...rs)).toBeCloseTo(m6.extMinorDia / 2, 4);

    // Flank angle check between r_inner (vertex 3) and r_outer_nom (vertex 4)
    const pInner = profile[3]!;
    const pOuter = profile[4]!;
    const dr = pOuter[0] - pInner[0];
    const dz = pOuter[1] - pInner[1];
    const flankAngle = Math.atan2(dz, dr) * (180 / Math.PI);
    expect(flankAngle).toBeCloseTo(30, 2);

    // Total tooth axial span zMax - zMin must be strictly smaller than pitch (defense against WASM fuse overlap)
    const zSpan = Math.max(...zs) - Math.min(...zs);
    expect(zSpan).toBeLessThan(m6.pitch);
  });

  it('generates 2D tooth profile for external thread boss', () => {
    const m10 = lookupThread('M10')!;
    const profile = generateStandardThreadProfile(m10, { op: 'boss', target: 'external' });
    expect(profile.length).toBe(6);

    const zs = profile.map((p) => p[1]);
    const zSpan = Math.max(...zs) - Math.min(...zs);
    expect(zSpan).toBeLessThan(m10.pitch);
  });

  it('generates 2D tooth profile for internal thread cut in bore', () => {
    const unc = lookupThread('1/4-20 UNC')!;
    const profile = generateStandardThreadProfile(unc, { op: 'cut', target: 'internal' });
    expect(profile.length).toBe(6);

    const zs = profile.map((p) => p[1]);
    const zSpan = Math.max(...zs) - Math.min(...zs);
    expect(zSpan).toBeLessThan(unc.pitch);
  });


  it('preserves geometric invariants across ALL 42 standard threads (Zero-Crash, 30° flank, zSpan < pitch)', () => {
    expect(ALL_STANDARD_THREADS.length).toBeGreaterThanOrEqual(40);

    for (const thread of ALL_STANDARD_THREADS) {
      // 1. External Cut
      const extCut = generateStandardThreadProfile(thread, { op: 'cut', target: 'external' });
      expect(extCut.length).toBe(6);
      const zsCut = extCut.map((p) => p[1]);
      const spanCut = Math.max(...zsCut) - Math.min(...zsCut);
      expect(spanCut).toBeLessThan(thread.pitch);

      // Flank angle check
      const pInCut = extCut[3]!;
      const pOutCut = extCut[4]!;
      const angleCut = Math.atan2(pOutCut[1] - pInCut[1], pOutCut[0] - pInCut[0]) * (180 / Math.PI);
      expect(angleCut).toBeCloseTo(30, 2);

      // 2. External Boss
      const extBoss = generateStandardThreadProfile(thread, { op: 'boss', target: 'external' });
      expect(extBoss.length).toBe(6);
      const zsBoss = extBoss.map((p) => p[1]);
      const spanBoss = Math.max(...zsBoss) - Math.min(...zsBoss);
      expect(spanBoss).toBeLessThan(thread.pitch);

      // 3. Internal Cut
      const intCut = generateStandardThreadProfile(thread, { op: 'cut', target: 'internal' });
      expect(intCut.length).toBe(6);
      const zsInt = intCut.map((p) => p[1]);
      const spanInt = Math.max(...zsInt) - Math.min(...zsInt);
      expect(spanInt).toBeLessThan(thread.pitch);

      // Invariant: no NaN / Infinity anywhere
      for (const p of [...extCut, ...extBoss, ...intCut]) {
        expect(Number.isFinite(p[0])).toBe(true);
        expect(Number.isFinite(p[1])).toBe(true);
      }
    }
  });

  it('returns undefined for non-existent thread designation without throw', () => {
    expect(lookupThread('M999')).toBeUndefined();
    expect(lookupThread('')).toBeUndefined();
  });
});

