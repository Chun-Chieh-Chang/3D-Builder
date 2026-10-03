/**
 * Limits and fits (ISO 286-1, C16.4): the deviations of a hole or a shaft of a nominal size and a tolerance class such as 「H7」 or 「m6」, in mm. A class is a
 * letter (the position of the tolerance zone) and a grade (its width). Supported: grades IT5 to IT12, nominal sizes over 0 up to 500 mm; holes D E F G H JS K M N P,
 * shafts d e f g h js k m n p. Reference values from the standard's tables (µm): check them against your company's standard before relying on them.
 */

/** The upper limits of the nominal size ranges (mm): a size is in the first range whose limit it does not exceed (over a up to and including b). */
const RANGE_LIMITS = [3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500];

/** Fundamental tolerances (µm) of IT4 to IT12 for each range. */
const IT: Record<number, number[]> = {
  4: [3, 4, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20],
  5: [4, 5, 6, 8, 9, 11, 13, 15, 18, 20, 23, 25, 27],
  6: [6, 8, 9, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40],
  7: [10, 12, 15, 18, 21, 25, 30, 35, 40, 46, 52, 57, 63],
  8: [14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97],
  9: [25, 30, 36, 43, 52, 62, 74, 87, 100, 115, 130, 140, 155],
  10: [40, 48, 58, 70, 84, 100, 120, 140, 160, 185, 210, 230, 250],
  11: [60, 75, 90, 110, 130, 160, 190, 220, 250, 290, 320, 360, 400],
  12: [100, 120, 150, 180, 210, 250, 300, 350, 400, 460, 520, 570, 630],
};

/** Fundamental deviations of the shafts (µm): the upper deviation es of d e f g (negative), the lower deviation ei of k m n p (positive). */
const SHAFT: Record<string, number[]> = {
  d: [-20, -30, -40, -50, -65, -80, -100, -120, -145, -170, -190, -210, -230],
  e: [-14, -20, -25, -32, -40, -50, -60, -72, -85, -100, -110, -125, -135],
  f: [-6, -10, -13, -16, -20, -25, -30, -36, -43, -50, -56, -62, -68],
  g: [-2, -4, -5, -6, -7, -9, -10, -12, -14, -15, -17, -18, -20],
  m: [2, 4, 6, 7, 8, 9, 11, 13, 15, 17, 20, 21, 23],
  n: [4, 8, 10, 12, 15, 17, 20, 23, 27, 31, 34, 37, 40],
  p: [6, 12, 15, 18, 22, 26, 32, 37, 43, 50, 56, 62, 68],
};
/** k is 0 outside IT4 to IT7. */
const K: number[] = [0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5];

export interface FitClass {
  letter: string;
  grade: number;
  /** An upper-case letter is a hole's, a lower-case a shaft's. */
  hole: boolean;
}

const LETTERS = {
  hole: ['D', 'E', 'F', 'G', 'H', 'JS', 'K', 'M', 'N', 'P'],
  shaft: ['d', 'e', 'f', 'g', 'h', 'js', 'k', 'm', 'n', 'p'],
};

/** Reads a tolerance class (「H7」, 「m6」, 「JS9」); null when it is not one this module knows. */
export function parseFit(fit: string): FitClass | null {
  const m = /^([A-Za-z]{1,2})(\d{1,2})$/.exec(fit.trim());
  if (!m) return null;
  const letter = m[1]!;
  const grade = Number(m[2]);
  const hole = letter === letter.toUpperCase();
  if (!(hole ? LETTERS.hole : LETTERS.shaft).includes(letter)) return null;
  if (!(grade >= 5 && grade <= 12)) return null;
  return { letter, grade, hole };
}

const rangeOf = (nominal: number): number => (nominal > 0 && nominal <= 500 ? RANGE_LIMITS.findIndex((limit) => nominal <= limit) : -1);

/** The fundamental tolerance of a grade for a nominal size (mm); null outside what the table covers. */
export function standardTolerance(nominal: number, grade: number): number | null {
  const r = rangeOf(nominal);
  const row = IT[grade];
  return r < 0 || !row ? null : row[r]! / 1000;
}

export interface Deviations {
  /** mm, signed. */
  upper: number;
  lower: number;
}

/**
 * The upper and lower deviations (mm) of a hole or shaft of the class at the nominal size, or null when the class or the size is not covered. For K M N P of a
 * hole the deviation is that of the shaft of the same letter, mirrored, with Δ (the step from the grade below) added in the grades the standard says (special rule).
 */
export function fitDeviations(nominal: number, fit: string): Deviations | null {
  const c = parseFit(fit);
  const r = rangeOf(nominal);
  if (!c || r < 0) return null;
  const it = IT[c.grade]![r]!;
  const delta = it - IT[c.grade - 1]![r]!;
  const key = c.letter.toLowerCase();
  let upper: number;
  let lower: number;
  if (key === 'h') {
    [upper, lower] = c.hole ? [it, 0] : [0, -it];
  } else if (key === 'js') {
    [upper, lower] = [it / 2, -it / 2];
  } else if (key === 'k' || key === 'm' || key === 'n' || key === 'p') {
    // the shaft k is 0 outside IT4 to IT7; the hole K keeps its value up to IT8 (above that its ES is 0)
    const ei = key === 'k' ? (c.grade <= (c.hole ? 8 : 7) ? K[r]! : 0) : SHAFT[key]![r]!;
    if (c.hole) {
      // ES = −ei, plus Δ in the grades up to IT8 (K M N) or IT7 (P)
      upper = -ei + (c.grade <= (key === 'p' ? 7 : 8) ? delta : 0);
      lower = upper - it;
    } else {
      [lower, upper] = [ei, ei + it];
    }
  } else {
    // d e f g: the shaft's es is negative; a hole's EI is the same, mirrored
    const es = SHAFT[key]![r]!;
    if (c.hole) {
      lower = -es;
      upper = lower + it;
    } else {
      [upper, lower] = [es, es - it];
    }
  }
  return { upper: upper / 1000, lower: lower / 1000 };
}
