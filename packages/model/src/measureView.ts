import { t } from '@3db/i18n';
import type { MeasureDistance, MeasureReport, Relation } from './measure';
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
}

export const DEFAULT_MEASURE_OPTIONS: MeasureOptions = { unit: 'mm', fraction: false, denominator: 16, nearest: false, angle: 'deg', round: 'centre' };

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
export function viewMeasure(report: MeasureReport | null, o: MeasureOptions): MeasureView {
  if (!report || !report.distance) return { distance: null, modes: ['min'], mode: 'min', drawing: null, text: [] };
  const modes: RoundMode[] = report.round ? (report.round.max ? ['centre', 'min', 'max'] : ['centre', 'min']) : ['min'];
  const mode: RoundMode = modes.includes(o.round) ? o.round : modes[0]!;
  const distance = mode === 'centre' && report.round ? report.round.centre : mode === 'max' && report.round?.max ? report.round.max : report.distance;
  const text: string[] = [];
  if (report.relation) text.push(t(RELATION[report.relation], { angle: formatAngle(report.angle ?? 0, o.angle) }));
  text.push(`${t('measure.distanceName')}: ${lengthText(distance.value, o)}`);
  if (distance.value > 1e-9) {
    text.push(`  Delta X: ${lengthText(Math.abs(distance.delta[0]), o)}`, `  Delta Y: ${lengthText(Math.abs(distance.delta[1]), o)}`, `  Delta Z: ${lengthText(Math.abs(distance.delta[2]), o)}`);
    text.push(`${t('measure.total')}: ${lengthText(Math.abs(distance.delta[0]) + Math.abs(distance.delta[1]) + Math.abs(distance.delta[2]), o)}`);
  }
  return { distance, modes, mode, drawing: drawingOf(distance, o), text };
}

/**
 * The lines and labels of a distance: the straight line between the two points in black with the distance on it, and along the axes from the one point to the other, one
 * after the other (x, then y, then z), the legs that are not nothing, each in the colour of its axis with its length beside it.
 */
export function drawingOf(d: MeasureDistance, o: MeasureOptions): MeasureDrawing {
  const [a, b] = [d.a, d.b];
  const mid = (p: [number, number, number], q: [number, number, number]): [number, number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  const drawing: MeasureDrawing = { lines: [], points: [a, b], labels: [] };
  if (d.value <= 1e-9) return drawing;
  drawing.lines.push({ a, b, color: HEX.distance });
  drawing.labels.push({ key: 'distance', at: mid(a, b), name: `${t('measure.distanceName')}:`, value: lengthText(d.value, o), color: MEASURE_COLORS.distance, offset: [0, 16] });
  let at: [number, number, number] = [a[0], a[1], a[2]];
  for (const [k, axis] of [[0, 'x'], [1, 'y'], [2, 'z']] as const) {
    const len = d.delta[k]!;
    if (Math.abs(len) <= 1e-9) continue;
    const next: [number, number, number] = [at[0], at[1], at[2]];
    next[k] += len;
    drawing.lines.push({ a: at, b: next, color: HEX[axis] });
    drawing.labels.push({ key: `d${axis}`, at: mid(at, next), name: `d${axis.toUpperCase()}:`, value: lengthText(Math.abs(len), o), color: MEASURE_COLORS[axis], offset: [0, -10] });
    at = next;
  }
  return drawing;
}
