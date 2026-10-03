import type { DraftClass, DraftReport } from '@3db/kernel';

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
