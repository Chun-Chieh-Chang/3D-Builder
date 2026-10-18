import type { CircleRadius, Id, PointPosition, SketchFeature } from '@3db/model';

export type P2 = [number, number];

/** Solved sketch geometry (derived data, never stored in the document). */
export type SolvedGeometry =
  | { type: 'point'; p: P2 }
  | { type: 'line'; a: P2; b: P2; p1: Id; p2: Id; construction: boolean }
  | { type: 'circle'; c: P2; r: number; center: Id; construction: boolean }
  /** Counter-clockwise from angle a0 to a1 (radians). */
  | { type: 'arc'; c: P2; r: number; a0: number; a1: number; center: Id; start: Id; end: Id; construction: boolean }
  | { type: 'ellipse'; c: P2; major: P2; majorRadius: number; minorRadius: number; angle: number; center: Id; majorId: Id; construction: boolean };

/** SolidWorks sketch status (C1.31): black = fully, blue = under, red = over. */
export type SketchStatus = 'fully' | 'under' | 'over' | 'failed';

/** Definition state of one entity (C1.31 colours each entity, not only the whole sketch). */
export type EntityStatus = 'fully' | 'under' | 'over';

export interface SolvedSketch {
  geometry: Map<Id, SolvedGeometry>;
  status: SketchStatus;
  dof: number;
  /** Constraint ids reported as conflicting / redundant by the solver (for D7.2 diagnostics). */
  conflicting: Id[];
  redundant: Id[];
  /** Present when the solve was asked to analyze (see SolveOptions.analyze). */
  entityStatus?: Map<Id, EntityStatus>;
  message?: string;
}

export interface SolveOptions {
  /** Starting values that override the stored ones, e.g. the previous drag frame (A2.6 minimal change). */
  initial?: { points?: PointPosition[]; radii?: CircleRadius[] };
  /** Drag targets: the dragged points and radii follow them as closely as the constraints allow (A2.6). */
  drag?: { points?: PointPosition[]; radii?: CircleRadius[] };
  /** Also classify every entity as fully / under / over defined (C1.31). */
  analyze?: boolean;
}

export interface SketchSolver {
  solve(sketch: SketchFeature, options?: SolveOptions): SolvedSketch;
}

export type Segment2 =
  | { kind: 'line'; a: P2; b: P2; source: Id }
  | { kind: 'arc'; c: P2; r: number; from: P2; to: P2; ccw: boolean; source: Id }
  | { kind: 'circle'; c: P2; r: number; source: Id }
  | { kind: 'ellipse'; c: P2; rx: number; ry: number; angle: number; source: Id };

export type Loop2 = Segment2[];

/** A face-to-be: counter-clockwise outer loop with clockwise holes. */
export interface Region2 {
  outer: Loop2;
  holes: Loop2[];
}

export interface ProfileResult {
  regions: Region2[];
  /** Human-readable problems that prevent a closed profile (C1.35). */
  problems: string[];
}
