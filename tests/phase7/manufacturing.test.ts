/**
 * 7-7 (docs/phase7-plan.md): the gauge table of a sheet metal part and its manufacturability checks (C11) — each rule with a plate that passes and one that does not, by hand.
 * Plate 100 × 50 × 1.5, inside radius 2 (1.33 thicknesses), flange 90° 30 long from the outside (a flat piece of 26.5 after a bend of allowance 4.32), K 0.5.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, SCHEMA_VERSION, type Feature, type PartDoc, type Ref } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { readPartFile, writePartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { DEFAULT_SHEET_LIMITS, Regenerator, sheetChecks, type RebuildResult, type SheetCheck, type SheetCheckLimits } from '@3db/regen';
import { build, circle, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const rebuild = (doc: PartDoc): RebuildResult => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  return regen.rebuild(doc);
};
const T = 1.5;
const BA = (Math.PI / 2) * 2.75;
const plate = (...extra: ReturnType<typeof circle>[]): Feature => sketch('sk', front, rectangle('r', 0, 0, 100, 50), ...extra) as Feature;
const baseFlange = (extra: Record<string, unknown> = {}): Feature => ({ id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5', ...extra }) as Feature;
let topEdge: Ref;
beforeAll(() => {
  const r = rebuild(build(plate(), baseFlange()));
  const i = r.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.hypot(e.mid[0] - 100, e.mid[1] - 25, e.mid[2] - T) < 1e-6);
  topEdge = { kind: 'edge', name: r.body!.names.edges[i]!, fingerprint: edgeFingerprint(r.body!.topology, i) };
});
const flange = (extra: Record<string, unknown> = {}): Feature => ({ id: 'ef', type: 'edgeFlange', name: 'ef', suppressed: false, edge: topEdge, length: '30', ...extra }) as Feature;

function checksOf(features: Feature[], limits: SheetCheckLimits = DEFAULT_SHEET_LIMITS): SheetCheck[] {
  const r = rebuild(build(...features));
  expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
  return sheetChecks(kernel, r.sheet!, limits);
}
const of = (checks: SheetCheck[], rule: SheetCheck['rule']) => checks.filter((c) => c.rule === rule);

describe('the gauge table', () => {
  it('rows are kept in the part and in its file; none to begin with; an empty list takes the table away', async () => {
    let d = build(plate(), baseFlange());
    expect(d.sheetGauges).toBeUndefined();
    d = applyCommand(d, { type: 'setSheetGauges', gauges: [{ name: '1.5 mm 軟鋼', thickness: 1.5, radius: 2, kFactor: 0.44 }, { name: '2.0 mm', thickness: 2, radius: 2, kFactor: 0.5 }] });
    expect(d.sheetGauges).toHaveLength(2);
    const back = await readPartFile(await writePartFile(d));
    expect(back.doc.sheetGauges).toEqual(d.sheetGauges);
    expect(back.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(40);
    expect(applyCommand(d, { type: 'setSheetGauges', gauges: [] }).sheetGauges).toBeUndefined();
  });

  it('a row applied to the base flange (its numbers copied) is what the sheet is made with', () => {
    let d = applyCommand(build(plate(), baseFlange()), { type: 'setSheetGauges', gauges: [{ name: '2.0 mm', thickness: 2, radius: 3, kFactor: 0.4 }] });
    const row = d.sheetGauges![0]!;
    d = applyCommand(d, { type: 'setBaseFlange', featureId: 'bf', flange: { thickness: String(row.thickness), radius: String(row.radius), kFactor: String(row.kFactor) } });
    const r = rebuild(d);
    expect(r.sheet).toMatchObject({ thickness: 2, radius: 3, kFactor: 0.4 });
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(100 * 50 * 2, 5);
  });

  it('refused: a row with no name, two rows with one name, a thickness or radius of 0, a K-factor outside 0 to 1', () => {
    const d = build(plate(), baseFlange());
    const row = { name: 'a', thickness: 1.5, radius: 2, kFactor: 0.5 };
    expect(() => applyCommand(d, { type: 'setSheetGauges', gauges: [{ ...row, name: '  ' }] })).toThrow();
    expect(() => applyCommand(d, { type: 'setSheetGauges', gauges: [row, row] })).toThrow();
    expect(() => applyCommand(d, { type: 'setSheetGauges', gauges: [{ ...row, thickness: 0 }] })).toThrow();
    expect(() => applyCommand(d, { type: 'setSheetGauges', gauges: [{ ...row, radius: 0 }] })).toThrow();
    expect(() => applyCommand(d, { type: 'setSheetGauges', gauges: [{ ...row, kFactor: 1.5 }] })).toThrow();
  });
});

describe('the inside radius of a bend', () => {
  it('2 against 1 thickness (1.5): it passes; a base flange of radius 1 does not; at 1.5 thicknesses (2.25) even 2 does not', () => {
    const ok = of(checksOf([plate(), baseFlange(), flange()]), 'bendRadius');
    expect(ok).toHaveLength(1);
    expect(ok[0]).toMatchObject({ ok: true, value: 2, limit: 1.5 });
    const bad = of(checksOf([plate(), baseFlange({ radius: '1' }), flange()]), 'bendRadius');
    expect(bad[0]).toMatchObject({ ok: false, value: 1, limit: 1.5 });
    expect(bad[0]!.message).toContain('1');
    const strict = of(checksOf([plate(), baseFlange(), flange()], { ...DEFAULT_SHEET_LIMITS, radius: 1.5 }), 'bendRadius');
    expect(strict[0]).toMatchObject({ ok: false, limit: 2.25 });
  });
});

describe('a hem', () => {
  it('has no radius to ask for (a hem is folded and pressed, not bent to a radius): of a hem with an inside radius of 0.5 against a plate of 1.5 only its flat piece is checked', () => {
    const hem = { id: 'hm', type: 'hem', name: 'hm', suppressed: false, edge: topEdge, length: '7', gap: '1' } as Feature;
    const checks = checksOf([plate(), baseFlange(), hem]);
    expect(of(checks, 'bendRadius')).toEqual([]);
    expect(of(checks, 'flangeLength')).toHaveLength(1);
    expect(of(checks, 'flangeLength')[0]).toMatchObject({ ok: true, value: 7, limit: 6 });
    // an ordinary bend of the same small radius is still caught
    expect(of(checksOf([plate(), baseFlange({ radius: '0.5' }), flange()]), 'bendRadius')[0]).toMatchObject({ ok: false, value: 0.5 });
  });
});

describe('the flat piece after a bend', () => {
  it('26.5 against 4 thicknesses (6): it passes; a flange 8 long from the outside, a flat piece of 4.5, does not', () => {
    const ok = of(checksOf([plate(), baseFlange(), flange()]), 'flangeLength');
    expect(ok[0]).toMatchObject({ ok: true, limit: 6 });
    expect(ok[0]!.value).toBeCloseTo(26.5, 9);
    const bad = of(checksOf([plate(), baseFlange(), flange({ length: '8' })]), 'flangeLength');
    expect(bad[0]).toMatchObject({ ok: false, limit: 6 });
    expect(bad[0]!.value).toBeCloseTo(4.5, 9);
  });
});

describe('a hole near a bend', () => {
  /** The gap from the edge of the hole to the zone of the bend: the bend line is at x = 96.5 + BA/2, the zone BA/2 each side. */
  const gap = (x: number, r: number) => 96.5 + BA / 2 - x - BA / 2 - r;

  it('a hole of Ø5 at x = 90 is 4.0 from the bend zone (6 needed at 2 thicknesses = 3): it passes; at x = 93 it is 1.0 from it, at x = 92 2.0: they do not', () => {
    for (const [x, ok] of [[90, true], [93, false], [92, false]] as const) {
      const c = of(checksOf([plate(circle('c', x, 25, 2.5)), baseFlange(), flange()]), 'holeToBend');
      expect(c).toHaveLength(1);
      expect(c[0]!.ok).toBe(ok);
      expect(c[0]!.value).toBeCloseTo(gap(x, 2.5), 4);
      expect(c[0]!.limit).toBeCloseTo(3, 9);
    }
    expect(gap(90, 2.5)).toBeCloseTo(4, 9);
  });

  it('each hole is checked against its nearest bend: a far hole passes by a long way, two holes make two checks', () => {
    const c = of(checksOf([plate(circle('c1', 30, 25, 5), circle('c2', 93, 10, 2.5)), baseFlange(), flange()]), 'holeToBend');
    expect(c).toHaveLength(2);
    expect(c.filter((x) => x.ok)).toHaveLength(1);
    expect(c.find((x) => x.ok)!.value).toBeCloseTo(gap(30, 5), 4);
  });

  it('the outline of a disc is not a hole', () => {
    const r = rebuild(build(sketch('sk', front, circle('c', 0, 0, 20)) as Feature, baseFlange()));
    expect(of(sheetChecks(kernel, r.sheet!), 'holeToBend')).toEqual([]);
  });
});

describe('a flange that stops short', () => {
  it('without a relief it is said; with one it passes; a flange the whole width has nothing to say', () => {
    const inset = { start: '10', end: '5' };
    const bad = of(checksOf([plate(), baseFlange(), flange({ inset })]), 'reliefMissing');
    expect(bad).toHaveLength(1);
    expect(bad[0]!.ok).toBe(false);
    const ok = of(checksOf([plate(), baseFlange(), flange({ inset, relief: { width: '1.5', depth: '1.5' } })]), 'reliefMissing');
    expect(ok[0]!.ok).toBe(true);
    expect(of(checksOf([plate(), baseFlange(), flange()]), 'reliefMissing')).toEqual([]);
  });
});

describe('a bent base flange', () => {
  it('its bends are checked against the radius (the legs are not flanges): the U channel at radius 2 passes, at 1 it does not', () => {
    const U = { ...sketch('sk', front), entities: [[0, 20], [0, 0], [60, 0], [60, 20]].flatMap(([x, y], i) => [{ id: `p${i}`, type: 'point', x, y }, ...(i > 0 ? [{ id: String.fromCharCode(96 + i), type: 'line', p1: `p${i - 1}`, p2: `p${i}` }] : [])]) } as Feature;
    const channel = (radius: string) => baseFlange({ radius, depth: '40' });
    expect(of(checksOf([U, channel('2')]), 'bendRadius').map((c) => c.ok)).toEqual([true, true]);
    expect(of(checksOf([U, channel('1')]), 'bendRadius').map((c) => c.ok)).toEqual([false, false]);
  });
});
