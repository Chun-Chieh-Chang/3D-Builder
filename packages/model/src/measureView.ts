import { t } from '@3db/i18n';
import type { MeasureDistance, MeasureReport, Relation } from './measure';
import type { Vec3 } from './schema';
import { formatAngle, formatLength, type AngleUnit, type LengthFormat, type LengthUnit } from './units';

/**
 * How a measurement is shown (as eDrawings does): the lines and the labels drawn on the model, and what the result says in words. Pure: the viewer draws what this says.
 */

/** The ways two round elements can be measured: from centre to centre, the shortest way, the farthest. */
export type RoundMode = 'centre' | 'min' | 'max';

export interface MeasureOptions {
  unit: LengthUnit;
  /** Inches as fractions of an inch. */
  fraction: boolean;
  /** The finest part of the fraction (a power of two from 2 to 128). */
  denominator: number;
  /** Take the nearest fraction instead of showing a decimal where the number is not one. */
  nearest: boolean;
  angle: AngleUnit;
  /** What two round elements are measured by. */
  round: RoundMode;
  /** The coordinate system the differences along the axes (dX, dY, dZ) are taken in: `world` (the part's or the assembly's own) or the id of a coordinate system of the open part. */
  frame: string;
}

export const DEFAULT_MEASURE_OPTIONS: MeasureOptions = { unit: 'mm', fraction: false, denominator: 16, nearest: false, angle: 'deg', round: 'centre', frame: 'world' };

/** A coordinate system to take the differences in: where its origin is and the way its three axes run (unit vectors, square to each other). */
export interface MeasureFrame {
  origin: Vec3;
  axes: [Vec3, Vec3, Vec3];
}

/** What a drawing of a measurement may be told besides the options: the coordinate system, a prefix for the keys of its labels (several are kept at once), and how far the user has moved each label (pixels). */
export interface MeasureContext {
  frame?: MeasureFrame | null;
  prefix?: string;
  offsets?: Record<string, [number, number]>;
}

const dotV = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The differences of a distance along the axes of a coordinate system (the world's when none): what dX, dY and dZ are. */
export function components(delta: Vec3, frame?: MeasureFrame | null): Vec3 {
  return frame ? [dotV(delta, frame.axes[0]), dotV(delta, frame.axes[1]), dotV(delta, frame.axes[2])] : delta;
}

/** The colours of the three axes in the drawing of a measurement, and of the distance. */
export const MEASURE_COLORS = { x: '#e03131', y: '#2f9e44', z: '#1c4eca', distance: '#111111' } as const;
const HEX = { x: 0xe03131, y: 0x2f9e44, z: 0x1c4eca, distance: 0x111111 } as const;

export interface MeasureDrawing {
  lines: { a: [number, number, number]; b: [number, number, number]; color: number }[];
  points: [number, number, number][];
  /** `offset`: pixels on the screen from the point, so that labels on one spot do not lie on each other. */
  labels: { key: string; at: [number, number, number]; name: string; value: string; color: string; offset?: [number, number] }[];
}

export interface MeasureView {
  /** The distance that is drawn and written: the shortest, or for two round elements the one the mode asks for. */
  distance: MeasureDistance | null;
  /** The modes the pair can be measured by (more than the shortest only for two round elements). */
  modes: RoundMode[];
  /** The mode in use (the shortest when the pair is not round, or the one asked for is not defined). */
  mode: RoundMode;
  drawing: MeasureDrawing | null;
  /** What the result says, line by line, as eDrawings words it. */
  text: string[];
}

const fmt = (o: MeasureOptions): LengthFormat => ({ unit: o.unit, fraction: o.fraction, denominator: o.denominator, nearest: o.nearest });

/** A length as it is written with its unit. */
export const lengthText = (mm: number, o: MeasureOptions): string => formatLength(mm, fmt(o));

const RELATION: Record<Relation, 'measure.relation.parallel' | 'measure.relation.perpendicular' | 'measure.relation.angle'> = {
  parallel: 'measure.relation.parallel',
  perpendicular: 'measure.relation.perpendicular',
  angle: 'measure.relation.angle',
};

/** What there is to draw and say of a report with these options. */
export function viewMeasure(report: MeasureReport | null, o: MeasureOptions, ctx: MeasureContext = {}): MeasureView {
  if (!report || !report.distance) return { distance: null, modes: ['min'], mode: 'min', drawing: null, text: [] };
  const modes: RoundMode[] = report.round ? (report.round.max ? ['centre', 'min', 'max'] : ['centre', 'min']) : ['min'];
  const mode: RoundMode = modes.includes(o.round) ? o.round : modes[0]!;
  const distance = mode === 'centre' && report.round ? report.round.centre : mode === 'max' && report.round?.max ? report.round.max : report.distance;
  const text: string[] = [];
  if (report.relation) text.push(t(RELATION[report.relation], { angle: formatAngle(report.angle ?? 0, o.angle) }));
  text.push(`${t('measure.distanceName')}: ${lengthText(distance.value, o)}`);
  if (distance.value > 1e-9) {
    const c = components(distance.delta, ctx.frame);
    text.push(`  Delta X: ${lengthText(Math.abs(c[0]), o)}`, `  Delta Y: ${lengthText(Math.abs(c[1]), o)}`, `  Delta Z: ${lengthText(Math.abs(c[2]), o)}`);
    text.push(`${t('measure.total')}: ${lengthText(Math.abs(c[0]) + Math.abs(c[1]) + Math.abs(c[2]), o)}`);
  }
  return { distance, modes, mode, drawing: drawingOf(distance, o, ctx), text };
}

/**
 * The lines and labels of a distance: the straight line between the two points in black with the distance on it, and along the axes from the one point to the other, one
 * after the other (x, then y, then z), the legs that are not nothing, each in the colour of its axis with its length beside it.
 */
export function drawingOf(d: MeasureDistance, o: MeasureOptions, ctx: MeasureContext = {}): MeasureDrawing {
  const [a, b] = [d.a, d.b];
  const prefix = ctx.prefix ?? '';
  /** A label where the point is, moved the way the user moved it, from where it is put by default. */
  const label = (key: string, at: [number, number, number], name: string, value: string, color: string, by: [number, number]) => {
    const moved = ctx.offsets?.[prefix + key] ?? [0, 0];
    return { key: prefix + key, at, name, value, color, offset: [by[0] + moved[0], by[1] + moved[1]] as [number, number] };
  };
  const mid = (p: [number, number, number], q: [number, number, number]): [number, number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  const drawing: MeasureDrawing = { lines: [], points: [a, b], labels: [] };
  if (d.value <= 1e-9) return drawing;
  drawing.lines.push({ a, b, color: HEX.distance });
  drawing.labels.push(label('distance', mid(a, b), `${t('measure.distanceName')}:`, lengthText(d.value, o), MEASURE_COLORS.distance, [0, 16]));
  // along the axes of the coordinate system, one after the other: x, then y, then z, to the other point
  const frame = ctx.frame;
  const axes: [Vec3, Vec3, Vec3] = frame ? frame.axes : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const comp = components(d.delta, frame);
  let at: [number, number, number] = [a[0], a[1], a[2]];
  for (const [k, axis] of [[0, 'x'], [1, 'y'], [2, 'z']] as const) {
    const len = comp[k]!;
    if (Math.abs(len) <= 1e-9) continue;
    const next: [number, number, number] = [at[0] + axes[k][0] * len, at[1] + axes[k][1] * len, at[2] + axes[k][2] * len];
    drawing.lines.push({ a: at, b: next, color: HEX[axis] });
    drawing.labels.push(label(`d${axis}`, mid(at, next), `d${axis.toUpperCase()}:`, lengthText(Math.abs(len), o), MEASURE_COLORS[axis], [0, -10]));
    at = next;
  }
  return drawing;
}
