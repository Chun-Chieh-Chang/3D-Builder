import type { DraftClass, DraftReport, ThicknessClass, ThicknessReport, UndercutClass, UndercutReport } from '@3db/kernel';

/** The colors of the draft classes, as SolidWorks shows them: green drafted the right way, red the wrong way, yellow to be given draft, orange where the mold parts. */
export const DRAFT_COLORS: Record<Exclude<DraftClass, 'unknown'>, string> = {
  positive: '#4caf50',
  negative: '#e04848',
  required: '#f2c230',
  straddle: '#f08a24',
};

/** The color of each face of the shape the report is of, in the order of its faces (a face that could not be sampled keeps the body's). */
export function draftColors(report: DraftReport): (string | null)[] {
  const colors: (string | null)[] = report.faces.map(() => null);
  for (const f of report.faces) if (f.kind !== 'unknown') colors[f.face] = DRAFT_COLORS[f.kind];
  return colors;
}

/** The colors of the undercut classes: blue seen from above only, teal from below only, light green from both (a wall), orange split, yellow partly blocked, red an undercut. */
export const UNDERCUT_COLORS: Record<Exclude<UndercutClass, 'unknown'>, string> = {
  up: '#4a90d9',
  down: '#2fa59a',
  both: '#a5d06a',
  split: '#f08a24',
  partial: '#f2c230',
  undercut: '#e04848',
};

/** The color of each face of the shape the report is of, in the order of its faces. */
export function undercutColors(report: UndercutReport): (string | null)[] {
  const colors: (string | null)[] = report.faces.map(() => null);
  for (const f of report.faces) if (f.kind !== 'unknown') colors[f.face] = UNDERCUT_COLORS[f.kind];
  return colors;
}

/** The colors of the thickness classes: red too thin, green within the limits, blue too thick, grey where there is nothing on the other side to measure to. */
export const THICKNESS_COLORS: Record<Exclude<ThicknessClass, 'unknown'>, string> = {
  thin: '#e04848',
  ok: '#4caf50',
  thick: '#4a90d9',
  open: '#9e9e9e',
};

/** The color of each face of the shape the report is of, in the order of its faces. */
export function thicknessColors(report: ThicknessReport): (string | null)[] {
  const colors: (string | null)[] = report.faces.map(() => null);
  for (const f of report.faces) if (f.kind !== 'unknown') colors[f.face] = THICKNESS_COLORS[f.kind];
  return colors;
}
