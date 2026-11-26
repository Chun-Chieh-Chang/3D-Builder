/**
 * An angle dimension written with a leader (ADR 0266): a small slant meets the plane it is measured against far off the view, and automatic dimensioning
 * dropped its angle (the arc's centre more than 8 mm outside the view; R1-10226's 1°–8° drafts, 2026-11-22). It now writes the angle at the end of a leader
 * from the slant: the same value, and the slant counts as determined. Before this change the four blocks below each had their slant listed as missing
 * (coverage 1 of 2), measured 2026-11-26 with the previous drawingSession.ts.
 *
 * The part: a block seen from the front as (0,0) (40,0) (40 + 30·tan θ, 30) (10,30) (0,20), 10 deep: its right side a slant of θ from the vertical, whose
 * line meets the left side's ~40/tan θ mm away (764 mm at 3°), and a 45° corner at the top left, whose lines meet on the view (the control: an arc).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyDrawingCommand, DRAWING_SCHEMA_VERSION, page, parseDrawing, serializeDrawing, type Command, type Dimension, type DrawingDoc } from '@3db/model';
import { toDxf, toSvg } from '@3db/drawing';
import { CadSession } from '../src/session';
import { callTool } from '../src/server';
import { drawingOf } from '../src/drawingTools';

let s: CadSession;
const root = mkdtempSync(join(tmpdir(), 'drawing-angle-leader-'));
beforeAll(async () => {
  s = await CadSession.create({ root, locale: 'en' });
});
afterAll(() => {
  s?.dispose();
  rmSync(root, { recursive: true, force: true });
});

const text = (r: Awaited<ReturnType<typeof callTool>>) => JSON.parse((r.content.find((c) => c.type === 'text') as { text: string }).text);
const ok = (r: Awaited<ReturnType<typeof callTool>>) => {
  expect(r.isError, JSON.stringify(r.content[0]).slice(0, 2000)).toBeFalsy();
  return r;
};
type Angle = Extract<Dimension, { kind: 'angle' }>;
const SLANT = 'e1:side:s1.l1';
const CORNER = 'e1:side:s1.l3';

/** The block with its right side `deg` off the vertical. */
function block(deg: number): Command[] {
  const top = 40 + 30 * Math.tan((deg * Math.PI) / 180);
  const pts: [string, number, number][] = [['p0', 0, 0], ['p1', 40, 0], ['p2', top, 30], ['p3', 10, 30], ['p4', 0, 20]];
  return [
    {
      type: 'insertFeature',
      index: 0,
      feature: {
        id: 's1', type: 'sketch', name: 'Profile', suppressed: false, plane: { kind: 'datum', name: 'plane:front' },
        entities: [
          ...pts.map(([id, x, y]) => ({ id, type: 'point' as const, x, y })),
          ...pts.map(([id], i) => ({ id: `l${i}`, type: 'line' as const, p1: id, p2: pts[(i + 1) % pts.length]![0] })),
        ],
        constraints: pts.map(([id]) => ({ id: `f${id}`, type: 'fix' as const, point: id })),
      },
    },
    { type: 'insertFeature', index: 1, feature: { id: 'e1', type: 'extrude', name: 'Block', suppressed: false, sketch: 's1', op: 'new', dir1: { type: 'blind', depth: '10' } } },
  ] as Command[];
}

/** The drawing automatic dimensioning makes of the block. */
async function drawn(deg: number): Promise<{ doc: DrawingDoc; slants: { total: number; determined: number; missing: string[] } }> {
  await s.newPart();
  const built = await s.apply(block(deg));
  expect(built.committed, JSON.stringify(built.error)).toBe(true);
  await s.save(`block-${deg}.3dbx`);
  const made = text(ok(await callTool(s, 'drawing_create', {})));
  return { doc: drawingOf(s).doc!, slants: made.drawing.checks.coverage.slants };
}

const angleOf = (doc: DrawingDoc, name: string) => page(doc).dimensions.find((d): d is Angle => d.kind === 'angle' && d.a.name === name);
const valueOf = (doc: DrawingDoc, id: string) => {
  const out = drawingOf(s).build(doc).outcomes.get(id);
  if (!out || 'error' in out) throw new Error(`no value for ${id}: ${JSON.stringify(out)}`);
  return out.value;
};
const set = (doc: DrawingDoc, id: string, patch: object) => applyDrawingCommand(doc, { type: 'setDimension', dimensionId: id, patch } as never);

describe.each([1, 3, 5, 8])('a slant of %i° on a block', (deg) => {
  it('is dimensioned with a leader, its value the angle the arc would write, and counts as determined; the 45° corner keeps its arc', async () => {
    const { doc, slants } = await drawn(deg);
    expect(slants).toEqual({ total: 2, determined: 2, missing: [] });
    const slant = angleOf(doc, SLANT);
    expect(slant, JSON.stringify(page(doc).dimensions)).toBeTruthy();
    expect(slant!.leader).toBeGreaterThan(0);
    expect(Number.isFinite(slant!.angle)).toBe(true);
    // the value, written with a leader and with the arc: the same number, and the slant's own angle
    const withLeader = valueOf(doc, slant!.id);
    const withArc = valueOf(set(doc, slant!.id, { leader: null }), slant!.id);
    expect(Math.abs(withLeader - withArc)).toBeLessThan(1e-9);
    expect(Math.abs(withLeader - deg)).toBeLessThan(1e-6);
    // the control: a corner whose lines meet on the view is written with its arc, as before
    const corner = angleOf(doc, CORNER);
    expect(corner).toBeTruthy();
    expect(corner!.leader).toBeUndefined();
    expect(corner!.angle).toBeUndefined();
  }, 300_000);
});

describe('the leader of an angle dimension, on the 3° block', () => {
  let doc: DrawingDoc;
  let id: string;
  beforeAll(async () => {
    doc = (await drawn(3)).doc;
    id = angleOf(doc, SLANT)!.id;
  }, 300_000);

  it('refuses a leader that is not a length, a direction that is not a number, and either without the other', () => {
    const arc = set(doc, id, { leader: null });
    for (const leader of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => set(doc, id, { leader }), String(leader)).toThrow(/longer than 0/);
    for (const angle of [Number.NaN, Number.POSITIVE_INFINITY]) expect(() => set(doc, id, { angle }), String(angle)).toThrow();
    // a direction alone, on one written with its arc
    expect(() => set(arc, id, { angle: 30 })).toThrow(/both the length of the leader and its direction/);
    // inserted whole: a leader without its direction
    const { leader: _l, angle: _a, ...bare } = angleOf(doc, SLANT)!;
    expect(() => applyDrawingCommand(arc, { type: 'insertDimensions', dimensions: [{ ...bare, id: 'dimX', leader: 8 } as Dimension] })).toThrow(/both the length of the leader and its direction/);
  });

  it('takes it away with null (back to the arc) and gives a leader alone a direction', () => {
    const arc = set(doc, id, { leader: null });
    expect(angleOf(arc, SLANT)!.leader).toBeUndefined();
    expect(angleOf(arc, SLANT)!.angle).toBeUndefined();
    const again = set(arc, id, { leader: 12 });
    expect(angleOf(again, SLANT)!.leader).toBe(12);
    expect(angleOf(again, SLANT)!.angle).toBe(45);
    expect(angleOf(set(again, id, { angle: 200 }), SLANT)!.angle).toBe(200);
  });

  it('is kept by a save and a read; a drawing of the version before reads as it was', () => {
    const kept = parseDrawing(serializeDrawing(doc));
    expect(kept.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    expect(DRAWING_SCHEMA_VERSION).toBeGreaterThanOrEqual(45);
    const a = angleOf(doc, SLANT)!;
    expect(angleOf(kept, SLANT)).toMatchObject({ leader: a.leader, angle: a.angle });
    // the version before: no leader, read unchanged
    const older = { ...JSON.parse(serializeDrawing(set(doc, id, { leader: null }))), schemaVersion: 44 };
    const read = parseDrawing(JSON.stringify(older));
    expect(read.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    expect(angleOf(read, SLANT)!.leader).toBeUndefined();
    expect(page(read).dimensions.length).toBe(page(doc).dimensions.length);
  });

  it('is drawn and written out: a leader to the slant with the value at its end, in the scene, the SVG and the DXF', () => {
    const built = drawingOf(s).build(doc);
    const out = built.outcomes.get(id)!;
    expect('error' in out).toBe(false);
    if ('error' in out) return;
    expect(out.handle?.kind).toBe('round');
    const own = built.scene.items.filter((x) => (x as { group?: string }).group === id);
    expect(own.some((x) => x.kind === 'polyline' && (x as { filled?: boolean }).filled), 'an arrowhead').toBe(true);
    expect(toSvg(built.scene)).toContain('3°');
    const lines = toDxf(built.scene).split(/\r?\n/).map((x) => x.trim());
    // a radial DIMENSION entity (70 = 4 + 32 + 128 = 164) carries the angle as its text
    const dims = lines.flatMap((x, i) => (x === 'DIMENSION' && lines[i - 1] === '0' ? [i] : []));
    const radial = dims.filter((i) => { const k = lines.indexOf('70', i); return k > 0 && lines[k + 1] === '164'; });
    const textOf = (i: number) => lines[lines.indexOf('1', i) + 1] ?? '';
    expect(radial.map(textOf).some((x) => /^3(°|%%[dD])$/.test(x)), radial.map(textOf).join(' | ')).toBe(true);
  });
});
