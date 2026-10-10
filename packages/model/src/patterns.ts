import type { Feature } from './schema';

/**
 * The features a pattern can repeat (C6.1, C6.2): the ones that add to or take away from the bodies at one place. A pattern repeats what a feature did to
 * the bodies, not the feature, so the ones that change the whole body (a shell, a draft, a moved or deleted face, a combine, an imported body) have no
 * single place to repeat.
 */
export const SEED_TYPES = ['extrude', 'revolve', 'sweep', 'loft', 'rib', 'hole', 'fillet', 'chamfer', 'thread'] as const;
export const canBeSeed = (f: Feature): boolean => (SEED_TYPES as readonly string[]).includes(f.type);

/** An instance of a pattern: its name (what `skip` holds and what the face names carry) and its place in the grid, the seed being (0, 0). */
export interface Instance {
  label: string;
  i: number;
  j: number;
}

/** The instances after the seed: `n1` in a row, and `n2` rows of them in a grid (the row and column of the seed are 0). Labels are `i` in a row and `ixj` in a grid. */
export function patternInstances(n1: number, n2: number | null): Instance[] {
  const out: Instance[] = [];
  for (let j = 0; j < (n2 ?? 1); j++) {
    for (let i = 0; i < n1; i++) {
      if (i === 0 && j === 0) continue;
      out.push({ label: n2 === null ? `${i}` : `${i}x${j}`, i, j });
    }
  }
  return out;
}

