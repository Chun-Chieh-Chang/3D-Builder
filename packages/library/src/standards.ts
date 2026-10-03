import { t } from '@3db/i18n';
import { applyCommand, BOM_PART_NO_NAMES, createEmptyPart, type Feature, type PartDoc, type SketchFeature } from '@3db/model';

/**
 * The standard parts library (F6.1, Phase 4a-4): parametric parts made on demand — the socket head cap screw (ISO 4762), the dowel pin (ISO 8734) and the
 * plain washer (ISO 7089) — each a part file whose dimensions are variables, so a size can be edited like any part's. They are made from the main
 * dimensions of the standards (the thread is not modelled; the screw's tip and the pin's ends are as the tables give them).
 *
 * Every part is a profile revolved about the y axis, so its faces are named after the lines of the profile and a mate can ask for them by name
 * (`STANDARD_FACES`). The origin is where the part is mated or placed from: a screw's head underside, a washer's underside, a dowel pin's top.
 *
 * Reference values: check them against the standard of your company before relying on them.
 */

export type StandardKind = 'socketScrew' | 'dowelPin' | 'washer';
export const STANDARD_KINDS: readonly StandardKind[] = ['socketScrew', 'dowelPin', 'washer'];

export interface StandardSpec {
  kind: StandardKind;
  /** The size: "M6" for a screw or a washer, the nominal diameter ("6") for a dowel pin. */
  size: string;
  /** Screws and dowel pins: the length (mm). */
  length?: number;
}

export const STANDARD_NUMBER: Record<StandardKind, string> = { socketScrew: 'ISO 4762', dowelPin: 'ISO 8734', washer: 'ISO 7089' };

/** ISO 4762: thread diameter, head diameter (largest), head height, hex socket across flats, socket depth (least), mm. */
export const SOCKET_SCREWS: Readonly<Record<string, { d: number; dk: number; k: number; s: number; t: number }>> = {
  M3: { d: 3, dk: 5.5, k: 3, s: 2.5, t: 1.3 },
  M4: { d: 4, dk: 7, k: 4, s: 3, t: 2 },
  M5: { d: 5, dk: 8.5, k: 5, s: 4, t: 2.5 },
  M6: { d: 6, dk: 10, k: 6, s: 5, t: 3 },
  M8: { d: 8, dk: 13, k: 8, s: 6, t: 4 },
  M10: { d: 10, dk: 16, k: 10, s: 8, t: 5 },
  M12: { d: 12, dk: 18, k: 12, s: 10, t: 6 },
};

/** ISO 7089 (normal series): inner diameter, outer diameter, thickness, mm. */
export const WASHERS: Readonly<Record<string, { d1: number; d2: number; h: number }>> = {
  M3: { d1: 3.2, d2: 7, h: 0.5 },
  M4: { d1: 4.3, d2: 9, h: 0.8 },
  M5: { d1: 5.3, d2: 10, h: 1 },
  M6: { d1: 6.4, d2: 12, h: 1.6 },
  M8: { d1: 8.4, d2: 16, h: 1.6 },
  M10: { d1: 10.5, d2: 20, h: 2 },
  M12: { d1: 13, d2: 24, h: 2.5 },
};

/** ISO 8734: the nominal diameter (mm) and the chamfer at each end, mm. */
export const DOWEL_PINS: Readonly<Record<string, { d: number; c: number }>> = {
  '2': { d: 2, c: 0.35 },
  '3': { d: 3, c: 0.5 },
  '4': { d: 4, c: 0.63 },
  '5': { d: 5, c: 0.8 },
  '6': { d: 6, c: 1 },
  '8': { d: 8, c: 1.2 },
  '10': { d: 10, c: 1.6 },
};

const SCREW_LENGTHS = [6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80];
const PIN_LENGTHS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 35, 40, 45, 50, 55, 60, 70, 80];

/** The sizes of a kind, in order. */
export const standardSizes = (kind: StandardKind): string[] => Object.keys(kind === 'socketScrew' ? SOCKET_SCREWS : kind === 'washer' ? WASHERS : DOWEL_PINS);

/** The lengths a kind comes in (empty for a washer, which has none). */
export const standardLengths = (kind: StandardKind): number[] => (kind === 'socketScrew' ? SCREW_LENGTHS : kind === 'dowelPin' ? PIN_LENGTHS : []);

/** 「ISO 4762 M6x20」, 「ISO 8734 6m6x20」, 「ISO 7089 M6」: what the part is called, its file name and its part number. */
export function standardName(spec: StandardSpec): string {
  const n = STANDARD_NUMBER[spec.kind];
  if (spec.kind === 'socketScrew') return `${n} ${spec.size}x${spec.length}`;
  if (spec.kind === 'dowelPin') return `${n} ${spec.size}m6x${spec.length}`;
  return `${n} ${spec.size}`;
}

/** The faces of each part by their persistent names, for mates (`concentric` on a shank, `coincident` on an underside …). */
export const STANDARD_FACES = {
  socketScrew: { tip: 'revolve1:side:sketch1.tip', shank: 'revolve1:side:sketch1.shank', under: 'revolve1:side:sketch1.under', headSide: 'revolve1:side:sketch1.headSide', top: 'revolve1:side:sketch1.top' },
  dowelPin: { top: 'revolve1:side:sketch1.top', chamferTop: 'revolve1:side:sketch1.chamferTop', side: 'revolve1:side:sketch1.side', chamferBottom: 'revolve1:side:sketch1.chamferBottom', bottom: 'revolve1:side:sketch1.bottom' },
  washer: { bottom: 'revolve1:side:sketch1.bottom', outer: 'revolve1:side:sketch1.outer', top: 'revolve1:side:sketch1.top', bore: 'revolve1:side:sketch1.bore' },
} as const;

/** A point of a profile: where it is as expressions of the variables, and (numerically) where it starts. */
interface Pt {
  id: string;
  x: string;
  y: string;
  at: [number, number];
}

/** Pins a sketch point to the origin the way SolidWorks does: coincident, aligned with it, or at a (positive) distance. */
function pin(id: string, p: Pt): SketchFeature['constraints'] {
  const [x, y] = p.at;
  if (x === 0 && y === 0) return [{ id: `${id}o`, type: 'coincident', a: p.id, b: '@origin' }];
  return [
    x === 0 ? { id: `${id}x`, type: 'vertical', a: p.id, b: '@origin' } : { id: `${id}x`, type: 'distanceX', a: '@origin', b: p.id, value: p.x },
    y === 0 ? { id: `${id}y`, type: 'horizontal', a: p.id, b: '@origin' } : { id: `${id}y`, type: 'distanceY', a: '@origin', b: p.id, value: p.y },
  ];
}

/** A closed polygon of lines, every point pinned by dimensions that are expressions of the variables, so the sketch is fully defined and follows them. */
function polygon(prefix: string, points: Pt[], lines: string[]): Pick<SketchFeature, 'entities' | 'constraints'> {
  return {
    entities: [
      ...points.map((p) => ({ id: p.id, type: 'point' as const, x: p.at[0], y: p.at[1] })),
      ...lines.map((id, i) => ({ id, type: 'line' as const, p1: points[i]!.id, p2: points[(i + 1) % points.length]!.id })),
    ],
    constraints: points.flatMap((p) => pin(`${prefix}${p.id}`, p)),
  };
}

const sketchOn = (id: string, name: string, plane: SketchFeature['plane'], parts: Pick<SketchFeature, 'entities' | 'constraints'>): SketchFeature => ({ id, type: 'sketch', name, suppressed: false, plane, ...parts });

/** The profile sketch and its revolve: the profile on the front plane with a centerline up the y axis, turned a full circle. */
function revolved(points: Pt[], lines: string[], axisTop: Pt): Feature[] {
  const axis = { entities: [{ id: 'ax1', type: 'point' as const, x: 0, y: 0 }, { id: axisTop.id, type: 'point' as const, x: 0, y: axisTop.at[1] }, { id: 'axis', type: 'line' as const, p1: 'ax1', p2: axisTop.id, construction: true }], constraints: [{ id: 'axo', type: 'coincident' as const, a: 'ax1', b: '@origin' }, ...pin('ax', axisTop)] };
  const profile = polygon('p', points, lines);
  return [
    sketchOn('sketch1', `${t('feature.sketch')}1`, { kind: 'datum', name: 'plane:front' }, { entities: [...profile.entities, ...axis.entities], constraints: [...profile.constraints, ...axis.constraints] }),
    { id: 'revolve1', type: 'revolve', name: `${t('feature.revolve')}1`, suppressed: false, sketch: 'sketch1', axis: 'axis', op: 'boss', dir1: { type: 'blind', angle: '360' } },
  ];
}

/** A variable of the part, by name. */
const variable = (doc: PartDoc, name: string, value: number): PartDoc => applyCommand(doc, { type: 'addVariable', variable: { id: `var_${name}`, name, expr: String(value) } });

function screw(spec: StandardSpec): { vars: [string, number][]; features: Feature[] } {
  const row = SOCKET_SCREWS[spec.size]!;
  const L = spec.length!;
  const { d, dk, k, s } = row;
  const points: Pt[] = [
    { id: 'q0', x: '0', y: 'L', at: [0, -L] },
    { id: 'q1', x: 'd/2', y: 'L', at: [d / 2, -L] },
    { id: 'q2', x: 'd/2', y: '0', at: [d / 2, 0] },
    { id: 'q3', x: 'dk/2', y: '0', at: [dk / 2, 0] },
    { id: 'q4', x: 'dk/2', y: 'k', at: [dk / 2, k] },
    { id: 'q5', x: '0', y: 'k', at: [0, k] },
  ];
  const lines = ['tip', 'shank', 'under', 'headSide', 'top', 'axisEdge'];
  // the hex socket: a hexagon of s across the flats about the axis, cut into the head from its top
  const R = s / Math.sqrt(3);
  const hx = (i: number): Pt => {
    const a = (Math.PI / 3) * i;
    const x = R * Math.cos(a);
    const y = R * Math.sin(a);
    const half = 's/(2*sqrt(3))';
    const xs = [`s/sqrt(3)`, half, half, `s/sqrt(3)`, half, half];
    return { id: `h${i}`, x: xs[i]!, y: i === 0 || i === 3 ? '0' : 's/2', at: [Math.abs(x) < 1e-12 ? 0 : x, Math.abs(y) < 1e-12 ? 0 : y] };
  };
  const hexagon = polygon('h', [0, 1, 2, 3, 4, 5].map(hx), ['hl0', 'hl1', 'hl2', 'hl3', 'hl4', 'hl5']);
  return {
    vars: [['d', d], ['dk', dk], ['k', k], ['L', L], ['s', s], ['t', row.t]],
    features: [
      ...revolved(points, lines, { id: 'ax2', x: '0', y: 'k', at: [0, k] }),
      sketchOn('sketch2', `${t('feature.sketch')}2`, { kind: 'face', name: STANDARD_FACES.socketScrew.top }, hexagon),
      { id: 'cut1', type: 'extrude', name: `${t('feature.extrude')}2`, suppressed: false, sketch: 'sketch2', op: 'cut', dir1: { type: 'blind', depth: 't' } },
    ],
  };
}

function pinPart(spec: StandardSpec): { vars: [string, number][]; features: Feature[] } {
  const row = DOWEL_PINS[spec.size]!;
  const L = spec.length!;
  const { d, c } = row;
  const points: Pt[] = [
    { id: 'q0', x: '0', y: '0', at: [0, 0] },
    { id: 'q1', x: 'd/2-c', y: '0', at: [d / 2 - c, 0] },
    { id: 'q2', x: 'd/2', y: 'c', at: [d / 2, -c] },
    { id: 'q3', x: 'd/2', y: 'L-c', at: [d / 2, -(L - c)] },
    { id: 'q4', x: 'd/2-c', y: 'L', at: [d / 2 - c, -L] },
    { id: 'q5', x: '0', y: 'L', at: [0, -L] },
  ];
  const lines = ['top', 'chamferTop', 'side', 'chamferBottom', 'bottom', 'axisEdge'];
  return { vars: [['d', d], ['c', c], ['L', L]], features: revolved(points, lines, { id: 'ax2', x: '0', y: 'L', at: [0, -L] }) };
}

function washer(spec: StandardSpec): { vars: [string, number][]; features: Feature[] } {
  const { d1, d2, h } = WASHERS[spec.size]!;
  const points: Pt[] = [
    { id: 'q0', x: 'd1/2', y: '0', at: [d1 / 2, 0] },
    { id: 'q1', x: 'd2/2', y: '0', at: [d2 / 2, 0] },
    { id: 'q2', x: 'd2/2', y: 'h', at: [d2 / 2, h] },
    { id: 'q3', x: 'd1/2', y: 'h', at: [d1 / 2, h] },
  ];
  return { vars: [['d1', d1], ['d2', d2], ['h', h]], features: revolved(points, ['bottom', 'outer', 'top', 'bore'], { id: 'ax2', x: '0', y: 'h', at: [0, h] }) };
}

/** Why a spec cannot be made, or null when it can. */
export function standardProblem(spec: StandardSpec): string | null {
  const table = spec.kind === 'socketScrew' ? SOCKET_SCREWS : spec.kind === 'washer' ? WASHERS : DOWEL_PINS;
  if (!table[spec.size]) return t('library.badSize', { kind: t(`library.kind.${spec.kind}`), size: spec.size });
  if (spec.kind !== 'washer' && !(typeof spec.length === 'number' && spec.length > 0 && Number.isFinite(spec.length))) return t('library.badLength', { length: String(spec.length) });
  return null;
}

/**
 * The part of a standard size (F6.1): the variables, the profile and its revolve (and the screw's hex socket), the steel it is made of, and its name and
 * standard as the properties the parts list reads (料號, `Standard`). Nothing is stored that the standard's table gives again: the dimensions are the variables.
 */
export function standardPartDoc(spec: StandardSpec): PartDoc {
  const problem = standardProblem(spec);
  if (problem) throw new Error(problem);
  const made = spec.kind === 'socketScrew' ? screw(spec) : spec.kind === 'dowelPin' ? pinPart(spec) : washer(spec);
  let doc = createEmptyPart();
  for (const [name, value] of made.vars) doc = variable(doc, name, value);
  made.features.forEach((feature, index) => {
    doc = applyCommand(doc, { type: 'insertFeature', feature, index });
  });
  doc = applyCommand(doc, { type: 'setProperty', name: BOM_PART_NO_NAMES[0]!, value: standardName(spec) });
  doc = applyCommand(doc, { type: 'setProperty', name: 'Standard', value: STANDARD_NUMBER[spec.kind] });
  return applyCommand(doc, { type: 'setMaterial', material: { id: 'steel', name: t('material.steel'), density: 7.85 } });
}
