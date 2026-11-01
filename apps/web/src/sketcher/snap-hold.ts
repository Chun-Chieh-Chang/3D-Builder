/**
 * Candidate holding for snapping (G04, ADR 0223). Measured without it: a hand tremor on a tie flipped the candidate 8 times in 200 moves between two
 * points 0.15 mm apart, 40 times between two parallel lines 0.1 mm apart, and 7 times between two concentric circles. Holding the candidate that is
 * already shown turns those into one choice that stays.
 *
 * The rules are these, and nothing else:
 *  - a candidate is held while the cursor stays within `tol` of it;
 *  - a candidate of a higher class takes over at once — a point over a midpoint, a midpoint over anywhere on a curve (SolidWorks' own order), and a
 *    crossing, a quarter point or a place on the model over anywhere on a curve (they name a place, not a stretch of curve);
 *  - within one class another candidate takes over only when it is nearer by 40 % (`HOLD_HANDOVER`), so a tie does not flicker while walking from one
 *    point to the next still hands over normally;
 *  - the hold ends when the caller says so: Ctrl (snap off), another tool, Esc, a change to the document, or the element no longer being there.
 *
 * Pure, so the rules are tested without the controller or a browser.
 */
import type { Id } from '@3db/model';

/** The snaps that can be held, and the order they win in: a point, then a midpoint, then anywhere on a curve. */
export const HOLD_RANK = { point: 3, midpoint: 2, curve: 1 } as const;
export type HoldKind = keyof typeof HOLD_RANK;

/** A candidate that can be held: what it is, and how far the cursor is from it now. */
export interface HoldCandidate {
  kind: HoldKind;
  id: Id;
  d: number;
}

/**
 * A snap that is not held itself because it names one place beside the cursor rather than a curve to stay on: a crossing, a quarter point, a place on the
 * model. It sits between a midpoint and a curve, as those snaps sit in the order the controller tries them (point, midpoint, crossing, … curve).
 */
export interface OtherCandidate {
  kind: 'other';
}

export const OTHER_RANK = 1.5;

/** Within one class, another candidate takes over only when the cursor is this fraction of the way to it (40 % nearer than the held one). */
export const HOLD_HANDOVER = 0.6;

/** What to show: keep the held candidate, take the fresh one, or drop the hold (and take the fresh one, if any). */
export type HoldDecision = 'hold' | 'adopt' | 'release';

export function snapHold(held: HoldCandidate | null, fresh: HoldCandidate | OtherCandidate | null, tol: number): HoldDecision {
  if (!held || !(held.d <= tol)) return 'release';
  if (!fresh) return 'hold';
  if (fresh.kind === 'other') return OTHER_RANK > HOLD_RANK[held.kind] ? 'adopt' : 'hold';
  if (fresh.kind === held.kind && fresh.id === held.id) return 'hold';
  if (HOLD_RANK[fresh.kind] > HOLD_RANK[held.kind]) return 'adopt';
  if (HOLD_RANK[fresh.kind] < HOLD_RANK[held.kind]) return 'hold';
  return fresh.d < held.d * HOLD_HANDOVER ? 'adopt' : 'hold';
}
