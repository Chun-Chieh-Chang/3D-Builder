/**
 * Standard thread specifications (ISO 261 / ISO 262 / ANSI B1.1 / ASME B1.1) and
 * profile geometry generators based on ISO 68-1 60° basic thread profile.
 *
 * Layer: @3db/model (pure domain model, zero engine/kernel dependency).
 */

export type StandardThreadSystem = 'metric-coarse' | 'metric-fine' | 'unc' | 'unf';

export interface StandardThreadEntry {
  /** Designation name, e.g. 'M6', 'M10x1.25', '1/4-20 UNC' */
  designation: string;
  /** Thread standard system */
  system: StandardThreadSystem;
  /** Nominal diameter in millimeters */
  nominalDia: number;
  /** Pitch in millimeters */
  pitch: number;
  /** Threads per inch (for inch series; undefined for metric) */
  tpi?: number;
  /** Minor diameter for external thread (bolt), mm */
  extMinorDia: number;
  /** Tap drill / minor diameter for internal thread (nut), mm */
  intMinorDia: number;
}

/**
 * Height of fundamental triangle: H = (sqrt(3) / 2) * P
 */
export const fundamentalTriangleHeight = (pitch: number): number => {
  return (Math.sqrt(3) / 2) * pitch;
};

/**
 * ISO 68-1 basic thread depth:
 * Engagement height H1 = 5/8 * H = 0.541266 * P
 * External thread height h3 = 17/24 * H ≈ 0.613435 * P
 */
export const threadEngagementHeight = (pitch: number): number => {
  return (5 / 8) * fundamentalTriangleHeight(pitch);
};

export const externalThreadDepth = (pitch: number): number => {
  return (17 / 24) * fundamentalTriangleHeight(pitch);
};

// -----------------------------------------------------------------------------
// 1. ISO Metric Coarse Pitch Threads (ISO 261 / ISO 262 / DIN 13-1)
// -----------------------------------------------------------------------------
const METRIC_COARSE: readonly StandardThreadEntry[] = [
  { designation: 'M2', system: 'metric-coarse', nominalDia: 2.0, pitch: 0.40, extMinorDia: 1.509, intMinorDia: 1.567 },
  { designation: 'M2.5', system: 'metric-coarse', nominalDia: 2.5, pitch: 0.45, extMinorDia: 1.948, intMinorDia: 2.013 },
  { designation: 'M3', system: 'metric-coarse', nominalDia: 3.0, pitch: 0.50, extMinorDia: 2.387, intMinorDia: 2.459 },
  { designation: 'M4', system: 'metric-coarse', nominalDia: 4.0, pitch: 0.70, extMinorDia: 3.141, intMinorDia: 3.242 },
  { designation: 'M5', system: 'metric-coarse', nominalDia: 5.0, pitch: 0.80, extMinorDia: 4.019, intMinorDia: 4.134 },
  { designation: 'M6', system: 'metric-coarse', nominalDia: 6.0, pitch: 1.00, extMinorDia: 4.773, intMinorDia: 4.917 },
  { designation: 'M8', system: 'metric-coarse', nominalDia: 8.0, pitch: 1.25, extMinorDia: 6.466, intMinorDia: 6.647 },
  { designation: 'M10', system: 'metric-coarse', nominalDia: 10.0, pitch: 1.50, extMinorDia: 8.160, intMinorDia: 8.376 },
  { designation: 'M12', system: 'metric-coarse', nominalDia: 12.0, pitch: 1.75, extMinorDia: 9.853, intMinorDia: 10.106 },
  { designation: 'M14', system: 'metric-coarse', nominalDia: 14.0, pitch: 2.00, extMinorDia: 11.546, intMinorDia: 11.835 },
  { designation: 'M16', system: 'metric-coarse', nominalDia: 16.0, pitch: 2.00, extMinorDia: 13.546, intMinorDia: 13.835 },
  { designation: 'M18', system: 'metric-coarse', nominalDia: 18.0, pitch: 2.50, extMinorDia: 14.933, intMinorDia: 15.294 },
  { designation: 'M20', system: 'metric-coarse', nominalDia: 20.0, pitch: 2.50, extMinorDia: 16.933, intMinorDia: 17.294 },
  { designation: 'M24', system: 'metric-coarse', nominalDia: 24.0, pitch: 3.00, extMinorDia: 20.319, intMinorDia: 20.752 },
  { designation: 'M30', system: 'metric-coarse', nominalDia: 30.0, pitch: 3.50, extMinorDia: 25.706, intMinorDia: 26.211 },
];

// -----------------------------------------------------------------------------
// 2. ISO Metric Fine Pitch Threads (ISO 261 / ISO 262 / DIN 13-2~11)
// -----------------------------------------------------------------------------
const METRIC_FINE: readonly StandardThreadEntry[] = [
  { designation: 'M8x1.0', system: 'metric-fine', nominalDia: 8.0, pitch: 1.00, extMinorDia: 6.773, intMinorDia: 6.917 },
  { designation: 'M10x1.0', system: 'metric-fine', nominalDia: 10.0, pitch: 1.00, extMinorDia: 8.773, intMinorDia: 8.917 },
  { designation: 'M10x1.25', system: 'metric-fine', nominalDia: 10.0, pitch: 1.25, extMinorDia: 8.466, intMinorDia: 8.647 },
  { designation: 'M12x1.25', system: 'metric-fine', nominalDia: 12.0, pitch: 1.25, extMinorDia: 10.466, intMinorDia: 10.647 },
  { designation: 'M12x1.5', system: 'metric-fine', nominalDia: 12.0, pitch: 1.50, extMinorDia: 10.160, intMinorDia: 10.376 },
  { designation: 'M14x1.5', system: 'metric-fine', nominalDia: 14.0, pitch: 1.50, extMinorDia: 12.160, intMinorDia: 12.376 },
  { designation: 'M16x1.5', system: 'metric-fine', nominalDia: 16.0, pitch: 1.50, extMinorDia: 14.160, intMinorDia: 14.376 },
  { designation: 'M18x1.5', system: 'metric-fine', nominalDia: 18.0, pitch: 1.50, extMinorDia: 16.160, intMinorDia: 16.376 },
  { designation: 'M20x1.5', system: 'metric-fine', nominalDia: 20.0, pitch: 1.50, extMinorDia: 18.160, intMinorDia: 18.376 },
  { designation: 'M24x2.0', system: 'metric-fine', nominalDia: 24.0, pitch: 2.00, extMinorDia: 21.546, intMinorDia: 21.835 },
];

// -----------------------------------------------------------------------------
// 3. Unified Inch Coarse Threads (ASME/ANSI B1.1 UNC)
// -----------------------------------------------------------------------------
const INCH_UNC: readonly StandardThreadEntry[] = [
  { designation: '#4-40 UNC', system: 'unc', nominalDia: 2.845, pitch: 25.4 / 40, tpi: 40, extMinorDia: 2.065, intMinorDia: 2.156 },
  { designation: '#6-32 UNC', system: 'unc', nominalDia: 3.505, pitch: 25.4 / 32, tpi: 32, extMinorDia: 2.532, intMinorDia: 2.647 },
  { designation: '#8-32 UNC', system: 'unc', nominalDia: 4.166, pitch: 25.4 / 32, tpi: 32, extMinorDia: 3.193, intMinorDia: 3.307 },
  { designation: '#10-24 UNC', system: 'unc', nominalDia: 4.826, pitch: 25.4 / 24, tpi: 24, extMinorDia: 3.528, intMinorDia: 3.680 },
  { designation: '1/4-20 UNC', system: 'unc', nominalDia: 6.350, pitch: 25.4 / 20, tpi: 20, extMinorDia: 4.793, intMinorDia: 4.976 },
  { designation: '5/16-18 UNC', system: 'unc', nominalDia: 7.938, pitch: 25.4 / 18, tpi: 18, extMinorDia: 6.205, intMinorDia: 6.408 },
  { designation: '3/8-16 UNC', system: 'unc', nominalDia: 9.525, pitch: 25.4 / 16, tpi: 16, extMinorDia: 7.577, intMinorDia: 7.805 },
  { designation: '7/16-14 UNC', system: 'unc', nominalDia: 11.112, pitch: 25.4 / 14, tpi: 14, extMinorDia: 8.887, intMinorDia: 9.149 },
  { designation: '1/2-13 UNC', system: 'unc', nominalDia: 12.700, pitch: 25.4 / 13, tpi: 13, extMinorDia: 10.302, intMinorDia: 10.584 },
  { designation: '5/8-11 UNC', system: 'unc', nominalDia: 15.875, pitch: 25.4 / 11, tpi: 11, extMinorDia: 13.045, intMinorDia: 13.378 },
  { designation: '3/4-10 UNC', system: 'unc', nominalDia: 19.050, pitch: 25.4 / 10, tpi: 10, extMinorDia: 15.933, intMinorDia: 16.299 },
];

// -----------------------------------------------------------------------------
// 4. Unified Inch Fine Threads (ASME/ANSI B1.1 UNF)
// -----------------------------------------------------------------------------
const INCH_UNF: readonly StandardThreadEntry[] = [
  { designation: '#10-32 UNF', system: 'unf', nominalDia: 4.826, pitch: 25.4 / 32, tpi: 32, extMinorDia: 3.853, intMinorDia: 3.967 },
  { designation: '1/4-28 UNF', system: 'unf', nominalDia: 6.350, pitch: 25.4 / 28, tpi: 28, extMinorDia: 5.237, intMinorDia: 5.367 },
  { designation: '5/16-24 UNF', system: 'unf', nominalDia: 7.938, pitch: 25.4 / 24, tpi: 24, extMinorDia: 6.640, intMinorDia: 6.792 },
  { designation: '3/8-24 UNF', system: 'unf', nominalDia: 9.525, pitch: 25.4 / 24, tpi: 24, extMinorDia: 8.227, intMinorDia: 8.379 },
  { designation: '7/16-20 UNF', system: 'unf', nominalDia: 11.112, pitch: 25.4 / 20, tpi: 20, extMinorDia: 9.555, intMinorDia: 9.738 },
  { designation: '1/2-20 UNF', system: 'unf', nominalDia: 12.700, pitch: 25.4 / 20, tpi: 20, extMinorDia: 11.143, intMinorDia: 11.326 },
];

/**
 * All supported standard threads in one table.
 */
export const ALL_STANDARD_THREADS: readonly StandardThreadEntry[] = [
  ...METRIC_COARSE,
  ...METRIC_FINE,
  ...INCH_UNC,
  ...INCH_UNF,
];

/**
 * Look up a standard thread by designation (e.g. 'M6' or '1/4-20 UNC').
 */
export const lookupThread = (designation: string): StandardThreadEntry | undefined => {
  const norm = designation.trim().toUpperCase();
  return ALL_STANDARD_THREADS.find((t) => t.designation.toUpperCase() === norm);
};

/**
 * List standard threads by system category.
 */
export const listThreadsBySystem = (system: StandardThreadSystem): readonly StandardThreadEntry[] => {
  switch (system) {
    case 'metric-coarse': return METRIC_COARSE;
    case 'metric-fine': return METRIC_FINE;
    case 'unc': return INCH_UNC;
    case 'unf': return INCH_UNF;
  }
};

// -----------------------------------------------------------------------------
// 5. ISO 68-1 60° Standard Profile Point Generator
// -----------------------------------------------------------------------------

export type Point2D = [number, number]; // [r, z]

export interface StandardProfileOptions {
  /** 'cut': tool profile cuts material from cylindrical body; 'boss': profile adds material */
  op: 'cut' | 'boss';
  /** 'external': on an outer shaft (e.g. bolt); 'internal': in an inner bore (e.g. nut) */
  target: 'external' | 'internal';
  /** Margin extending into clearance space to guarantee clean boolean intersection (default: 0.1 * P) */
  extensionMargin?: number;
}

/**
 * Generates an exact 2D closed polygon wire in (r, z) coordinates for a standard 60° thread tooth.
 *
 * Geometric Derivation (ISO 68-1 / ASME B1.1):
 * - Included flank angle: 60° (30° from radial plane).
 * - Symmetrical about z = 0.
 * - Pitch diameter d2 is at theoretical balance where tooth width = groove width = P / 2.
 * - External Cut:
 *   - At major diameter d: groove width = P - P/8 = 7/8 * P = 0.875 * P.
 *   - At minor diameter d3: groove root width = P / 4 = 0.25 * P.
 *   - Beyond major diameter (extension margin): side flanks extend straight outwards at width 7/8 * P
 *     so that the tool cleanly pierces the cylindrical boundary without ever exceeding pitch P.
 * - External Boss:
 *   - At minor diameter d3: tooth root width = P - P/4 = 0.75 * P.
 *   - At major diameter d: crest width = P / 8 = 0.125 * P.
 *   - Inside minor diameter (extension margin into core): extends straight inwards at width 0.75 * P.
 * - Internal Cut:
 *   - At minor bore diameter D1: groove entry width = P / 4 = 0.25 * P.
 *   - At major diameter D: groove root width = 7/8 * P = 0.875 * P.
 *   - Inside bore (extension margin into clearance): extends straight inwards at width P / 4.
 */
export const generateStandardThreadProfile = (
  entry: StandardThreadEntry,
  options: StandardProfileOptions
): Point2D[] => {
  const { nominalDia, pitch } = entry;
  const margin = options.extensionMargin ?? (0.15 * pitch);
  const tan30 = Math.tan(Math.PI / 6); // 1 / sqrt(3) ≈ 0.577350269

  const R_major = nominalDia / 2;
  const R_ext_minor = entry.extMinorDia / 2;
  const R_int_minor = entry.intMinorDia / 2;

  // External Cut: cutting groove into a solid shaft of radius R_major
  // ISO 68-1: crest opening at major diameter = 7/8 * P; 30° flanks down to minor radius.
  if (options.target === 'external' && options.op === 'cut') {
    const dr = R_major - R_ext_minor;
    const w_crest = (7 / 8) * pitch;
    // Exactly 30° flank: dz = dr * tan(30°)
    const w_root = w_crest - 2 * dr * tan30;

    const r_inner = R_ext_minor;
    const r_outer_nom = R_major;
    const r_outer_ext = R_major + margin;

    const z_root_half = w_root / 2;
    const z_crest_half = w_crest / 2;

    // Polygon: inner root flat -> 30° flank up to nominal cylinder -> parallel extension -> top root flat
    return [
      [r_outer_ext, -z_crest_half],
      [r_outer_nom, -z_crest_half],
      [r_inner, -z_root_half],
      [r_inner, z_root_half],
      [r_outer_nom, z_crest_half],
      [r_outer_ext, z_crest_half],
    ];
  }

  // External Boss: adding tooth onto a core cylinder of radius R_ext_minor
  // Tooth crest at major diameter = 1/8 * P; 30° flanks down to root at minor diameter.
  if (options.target === 'external' && options.op === 'boss') {
    const dr = R_major - R_ext_minor;
    const w_crest = (1 / 8) * pitch;
    const w_root = w_crest + 2 * dr * tan30;

    const r_inner_ext = R_ext_minor - margin;
    const r_inner_nom = R_ext_minor;
    const r_outer = R_major;

    const z_root_half = w_root / 2;
    const z_crest_half = w_crest / 2;

    return [
      [r_inner_ext, -z_root_half],
      [r_inner_nom, -z_root_half],
      [r_outer, -z_crest_half],
      [r_outer, z_crest_half],
      [r_inner_nom, z_root_half],
      [r_inner_ext, z_root_half],
    ];
  }

  // Internal Cut: cutting groove into a bore of radius R_int_minor
  // Bore entry opening = 1/4 * P; 30° flanks outward to major diameter groove root = 7/8 * P.
  if (options.target === 'internal' && options.op === 'cut') {
    const dr = R_major - R_int_minor;
    const w_entry = (1 / 4) * pitch;
    const w_root = w_entry + 2 * dr * tan30;

    const r_inner_ext = R_int_minor - margin;
    const r_inner_nom = R_int_minor;
    const r_outer = R_major;

    const z_entry_half = w_entry / 2;
    const z_root_half = w_root / 2;

    return [
      [r_inner_ext, -z_entry_half],
      [r_inner_nom, -z_entry_half],
      [r_outer, -z_root_half],
      [r_outer, z_root_half],
      [r_inner_nom, z_entry_half],
      [r_inner_ext, z_entry_half],
    ];
  }

  throw new Error(`Unsupported thread combination: target=${options.target}, op=${options.op}`);
};


