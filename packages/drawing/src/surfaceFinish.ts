import type { SurfaceFinish } from '@3db/model';
import { DIM_TEXT, formatNumber } from './dimension';
import { circlePolyline } from './geometry';
import { toSheet, type PlacedView } from './layout';
import type { SceneItem } from './scene';

/**
 * The symbol of a surface texture requirement (C16.5, ISO 1302): the V of 60° whose point touches the surface it marks, the bar that the values are written
 * over, and, by how the surface is made, the bar that closes the V (`machined`: the material is taken off) or the circle in it (`unmachined`: it is not).
 *
 * The Ra value is written over the bar in micrometres — the unit is not written, as ISO 1302 has it — and the method after it; a note goes under the bar. The
 * symbol is a fixed size on the sheet, as the text of a dimension is, whatever scale the view it stands on is drawn at; only where it stands follows the view.
 */

/** The height of the symbol's V (mm on the sheet): 1.4 times the text height, as ISO 1302 has it. */
export const FINISH_HEIGHT = 1.4 * DIM_TEXT;
/** The length of a leg of the V: the height over cos 30°, so that the two legs meet at 60°. */
const LEG = FINISH_HEIGHT / Math.cos(Math.PI / 6);
/** The half-width of the V, and its height. */
const HALF = LEG * Math.sin(Math.PI / 6);
const TOP = LEG * Math.cos(Math.PI / 6);
/** How far the bar reaches past the V (mm on the sheet): room for the value written over it. */
const BAR = 1.7 * DIM_TEXT;
/** The gap between the bar and what is written over and under it (mm on the sheet). */
const TEXT_GAP = 0.7;

/** How wide a text is (mm), estimated from its height: a Chinese character is as wide as the font is tall, any other about 0.62 of it. */
const charWidth = (text: string, height: number) => [...text].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 1.4 : 0.62) * height, 0);

/** What is written over the bar for a roughness: 「Ra 1.6」 (the value is in micrometres, so no unit is written). */
export const raText = (ra: number): string => `Ra ${formatNumber(ra, 3)}`;

type P = [number, number];

/**
 * The symbol of one surface finish, where the view it is on is placed: `at` is the point of the symbol in the view's coordinates (full size) and the symbol
 * leans away from the surface along `angle` (degrees counter-clockwise from the view's x axis, 90 being up the sheet, which is how it is drawn when it is
 * not said). A leader, when it has one, is a line from the surface up to the point of the symbol.
 */
function symbol(f: SurfaceFinish, placed: PlacedView): SceneItem[] {
  const items: SceneItem[] = [];
  const [sx, sy] = toSheet(placed, f.at[0], f.at[1]);
  const turn = ((f.angle ?? 90) - 90) * (Math.PI / 180);
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  /** A point of the symbol's own coordinates (its point at the origin, its V up) on the sheet. */
  const at = (p: P): P => [sx + p[0] * cos - p[1] * sin, sy + p[0] * sin + p[1] * cos];
  const leader = f.leader ?? 0;
  const apex = at([0, leader]);
  if (leader > 0) items.push({ kind: 'polyline', points: [sx, sy, ...apex], style: 'thin' });
  const left = at([-HALF, leader + TOP]);
  const right = at([HALF, leader + TOP]);
  const barEnd = at([HALF + BAR, leader + TOP]);
  items.push({ kind: 'polyline', points: [...apex, ...right], style: 'thin' });
  items.push({ kind: 'polyline', points: [...apex, ...left], style: 'thin' });
  items.push({ kind: 'polyline', points: [...right, ...barEnd], style: 'thin' });
  const kind = f.kind ?? 'machined';
  if (kind === 'machined') items.push({ kind: 'polyline', points: [...left, ...right], style: 'thin' });
  if (kind === 'unmachined') {
    // the circle in the V: its middle halfway up, its radius keeping it clear of the legs
    const r = 0.27 * TOP;
    items.push({ kind: 'polyline', points: circlePolyline(at([0, leader + TOP / 2]), r), style: 'thin', closed: true });
  }
  // what is written over the bar (the Ra and the method), and the note under it: the text stays upright whatever way the symbol leans
  const over = [f.ra !== undefined ? raText(f.ra) : '', f.method ?? ''].filter((s) => s !== '').join('  ');
  const under = f.note ?? '';
  if (over !== '') items.push({ kind: 'text', at: [right[0], right[1] + TEXT_GAP], text: over, height: DIM_TEXT });
  if (under !== '') items.push({ kind: 'text', at: [right[0], right[1] - TEXT_GAP - DIM_TEXT], text: under, height: DIM_TEXT });
  return items;
}

/** The symbols of the surface finishes of a view, on the sheet: all of them, in the order they are in the document. */
export function surfaceFinishItems(finishes: readonly SurfaceFinish[], placed: PlacedView): SceneItem[] {
  return finishes.flatMap((f) => symbol(f, placed));
}

/** How wide and how tall the symbol of a surface finish is on the sheet (mm): for keeping it off what it must not cover. */
export function surfaceFinishBox(f: SurfaceFinish): { w: number; h: number } {
  const over = [f.ra !== undefined ? raText(f.ra) : '', f.method ?? ''].filter((s) => s !== '').join('  ');
  const under = f.note ?? '';
  const w = Math.max(HALF + BAR, charWidth(over, DIM_TEXT), charWidth(under, DIM_TEXT));
  return { w, h: (f.leader ?? 0) + TOP + TEXT_GAP + DIM_TEXT * (1 + (under !== '' ? 1 : 0)) };
}
