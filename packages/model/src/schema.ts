import type { Id } from './ids';

/**
 * SSOT document schema (B1, B2, B5, B8, B9).
 * Only design intent lives here. B-Rep, meshes, element maps, sketch solutions,
 * DOF status, mass properties and error lists are derived data and never stored.
 */

export const SCHEMA_VERSION = 31;

/** Value expression (B5.2, B5.3): "20", "25.4mm", "30deg", "wall_t*2", "D1@草圖1/2", "property('厚度')"; see `expr/`. */
export type Expr = string;

export type Vec3 = [number, number, number];

/** Geometric fallback used to disambiguate or repair a persistent-name reference (B4.3). */
export interface Fingerprint {
  /** Surface type for faces ("plane", "cylinder", …) or curve type for edges ("line", "circle", …). */
  type: string;
  /** Area for faces, length for edges. */
  size: number;
  center: Vec3;
  /** Plane normal for planar faces, direction for straight edges. */
  dir?: Vec3;
}

/** Reference = persistent name + fingerprint. Never a topology index (H3). */
export interface Ref {
  kind: 'face' | 'edge' | 'vertex' | 'datum' | 'body';
  name: string;
  fingerprint?: Fingerprint;
}

export type DatumPlaneName = 'plane:front' | 'plane:top' | 'plane:right';

// ---------------------------------------------------------------- sketch (C1)

/** Reserved id of the projected part origin inside every sketch (fixed at 0,0). */
export const SKETCH_ORIGIN: Id = '@origin';

/**
 * A `ref` on a line, circle or arc makes it the projection of a model edge onto the sketch plane (C1.18, v13): where it lies comes from the
 * model, never from the sketch, so it follows the edge when the model changes. A `pierce` on a point makes it the place where a straight model
 * edge passes through the sketch plane (「貫穿」, C1.26). Their points keep their stored places only as a first guess; the model fixes them.
 */
export type SketchEntity =
  | { id: Id; type: 'point'; x: number; y: number; construction?: boolean; pierce?: Ref }
  | { id: Id; type: 'line'; p1: Id; p2: Id; construction?: boolean; ref?: Ref }
  | { id: Id; type: 'circle'; center: Id; radius: number; construction?: boolean; ref?: Ref }
  | { id: Id; type: 'arc'; center: Id; start: Id; end: Id; construction?: boolean; ref?: Ref };

/**
 * Sketch relations and dimensions (C1.25–C1.28). Point coordinates stored on entities are the
 * initial guess and the intent for under-defined DOFs; solved positions are derived.
 */
export type SketchConstraint =
  | { id: Id; type: 'coincident'; a: Id; b: Id }
  /** One line, or two points aligned horizontally / vertically. */
  | { id: Id; type: 'horizontal'; a: Id; b?: Id }
  | { id: Id; type: 'vertical'; a: Id; b?: Id }
  | { id: Id; type: 'collinear'; a: Id; b: Id }
  | { id: Id; type: 'parallel'; a: Id; b: Id }
  | { id: Id; type: 'perpendicular'; a: Id; b: Id }
  | { id: Id; type: 'tangent'; a: Id; b: Id }
  | { id: Id; type: 'concentric'; a: Id; b: Id }
  /** Two circles or arcs with the same center and the same radius (SolidWorks 「同心同徑」, v11). */
  | { id: Id; type: 'coradial'; a: Id; b: Id }
  | { id: Id; type: 'equal'; a: Id; b: Id }
  | { id: Id; type: 'midpoint'; point: Id; line: Id }
  /** SolidWorks "coincident" between a point and a line, circle or arc (point–point is `coincident`). */
  | { id: Id; type: 'pointOnCurve'; point: Id; curve: Id }
  | { id: Id; type: 'symmetric'; a: Id; b: Id; axis: Id }
  /** A point where two curves cross (SolidWorks 「交錯」, v11). */
  | { id: Id; type: 'intersection'; point: Id; a: Id; b: Id }
  | { id: Id; type: 'fix'; point: Id }
  | { id: Id; type: 'distance'; a: Id; b?: Id; value: Expr; label?: string; driving?: boolean }
  | { id: Id; type: 'distanceX'; a: Id; b: Id; value: Expr; label?: string; driving?: boolean }
  | { id: Id; type: 'distanceY'; a: Id; b: Id; value: Expr; label?: string; driving?: boolean }
  | { id: Id; type: 'radius'; circle: Id; value: Expr; label?: string; driving?: boolean }
  | { id: Id; type: 'diameter'; circle: Id; value: Expr; label?: string; driving?: boolean }
  /** The length of an arc (v11); `circle` is the arc. */
  | { id: Id; type: 'arcLength'; circle: Id; value: Expr; label?: string; driving?: boolean }
  /**
   * The angle of the sector between two lines where the dimension was placed (SolidWorks). The sector
   * lies between the rays along the lines as drawn, each reversed where `flip` says so; seen from the
   * intersection, `b`'s ray is `value` counter-clockwise from `a`'s. Without `flip` (and in documents
   * before v6) the rays are the lines as drawn.
   */
  | { id: Id; type: 'angle'; a: Id; b: Id; value: Expr; label?: string; driving?: boolean; flip?: 'a' | 'b' | 'both' };

export type DimensionConstraint = Extract<SketchConstraint, { value: Expr }>;

export function isDimension(c: SketchConstraint): c is DimensionConstraint {
  return 'value' in c;
}

// ---------------------------------------------------------------- features (C3–C5)

interface FeatureBase {
  id: Id;
  name: string;
  suppressed: boolean;
  /** A note the user wrote on the feature (D1.7, v25). */
  comment?: string;
  /** A short label the tree can be filtered by (D1.7, v25). */
  tag?: string;
  /** The folder of the tree the feature is in (D1.7, v25); the features of one folder follow one another in the history. */
  folder?: string;
}

export interface SketchFeature extends FeatureBase {
  type: 'sketch';
  plane: Ref;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
}

/**
 * Extrude end conditions (C4.1). The direction is the sketch normal for a boss and the opposite
 * (into the material) for a cut, as in SolidWorks; `reverse` flips it.
 */
export type EndCondition =
  | { type: 'blind'; depth: Expr; reverse?: boolean }
  | { type: 'midPlane'; depth: Expr }
  | { type: 'throughAll'; reverse?: boolean }
  | { type: 'upToFace'; face: Ref; reverse?: boolean }
  /** Up to the first face in the way (成形到下一面, v14); which face is worked out from the geometry at every rebuild. */
  | { type: 'upToNext'; reverse?: boolean }
  /** Up to the plane through a vertex, parallel to the sketch (成形至頂點, v14). */
  | { type: 'upToVertex'; vertex: Ref; reverse?: boolean }
  /** Up to the surface of another body, which it takes the shape of (成形至本體, v14); ody is a kind: 'body' reference. */
  | { type: 'upToBody'; body: Ref; reverse?: boolean }
  /** To offset short of a face parallel to the sketch, or beyond it with eyond (從曲面偏移, v14). */
  | { type: 'offsetFromFace'; face: Ref; offset: Expr; beyond?: boolean; reverse?: boolean };

/** The walls of an extrusion lean by ngle (拔模, v14): away from the profile, or towards it with inward. */
export interface Draft {
  angle: Expr;
  inward?: boolean;
}

/** A thin feature (薄件, v14): the profile's outline thickened instead of its inside filled, one way, both ways equally, or by two thicknesses. */
export interface Thin {
  mode: 'one' | 'mid' | 'two';
  thickness: Expr;
  /** The other side's thickness, for 	wo. */
  thickness2?: Expr;
  /** One side: the other way round (to the outside of a closed profile, or the other side of an open one). */
  reverse?: boolean;
}

export interface ExtrudeFeature extends FeatureBase {
  type: 'extrude';
  sketch: Id;
  op: 'boss' | 'cut';
  /** A boss only (C7.1): `false` makes it a body of its own; absent (the default) merges it with the bodies it touches. */
  merge?: boolean;
  /** Which contours of the sketch it uses (C1.34, v12): each is the entities that bound one region; absent means all of them. */
  contours?: Id[][];
  dir1: EndCondition;
  /** Second direction, from the sketch plane the other way (v14). */
  dir2?: EndCondition;
  /** Draft of the walls of each direction (v14); not with 兩側對稱. */
  draft1?: Draft;
  draft2?: Draft;
  thin?: Thin;
}

/** Revolve end conditions (C4.3): an angle in one direction, or split evenly about the sketch plane. */
export type RevolveCondition = { type: 'blind'; angle: Expr; reverse?: boolean } | { type: 'midPlane'; angle: Expr };

/**
 * Hole wizard (異型孔, C4.8, v17): a hole of one of four kinds drilled into the material at every point of a sketch, from the sketch plane inward (against
 * the normal; 
everse the other way). size is only the label of the standard size the diameters were taken from; the values that count are the
 * expressions. 	apped is the tap-drill hole of a thread, which is not modelled.
 */
export interface HoleFeature extends FeatureBase {
  type: 'hole';
  sketch: Id;
  kind: 'straight' | 'counterbore' | 'countersink' | 'tapped' | 'dowel';
  /** The standard size the diameters came from, e.g. M6 (a label; custom or absent when typed). */
  size?: string;
  diameter: Expr;
  end: { type: 'blind'; depth: Expr } | { type: 'throughAll' };
  /** Counterbore: the wider part's diameter and depth. */
  cbDiameter?: Expr;
  cbDepth?: Expr;
  /** Countersink: the diameter at the surface and the included angle. */
  csDiameter?: Expr;
  csAngle?: Expr;
  /** Dowel pin hole (v27): the fit it is made to (ISO 286-1), kept with the feature; the hole itself is made at the nominal `diameter`. */
  fit?: 'H6' | 'H7' | 'H8';
  /** Dowel pin hole: the chamfer at the entrance (a length, 45°); absent is none. */
  chamfer?: Expr;
  reverse?: boolean;
}

/**
 * Sweep (掃出, C4.4, v18): the profile sketch's closed outlines carried along the path of another sketch, a single run of lines and arcs. One end of
 * the path is on the plane of the profile and the sweep starts there; the profile keeps the angle it has to the path ("follow path"). A boss
 * joins or becomes a body, a cut removes material, as for an extrusion.
 */
export interface SweepFeature extends FeatureBase {
  type: 'sweep';
  /** The sketch of the profile. */
  sketch: Id;
  /** The sketch of the path. */
  path: Id;
  op: 'boss' | 'cut';
  /** As for `ExtrudeFeature.merge`. */
  merge?: boolean;
  /** As for `ExtrudeFeature.contours`. */
  contours?: Id[][];
}

/**
 * Loft (疊層拉伸, C4.5, v19): a body through two or more sections, each the closed outline of a sketch, in the order listed. The faces are
 * smooth through all the sections (with two, they are ruled). Each section is one outline without holes; where the sections start and which way
 * round they go does not matter. A boss joins or becomes a body, a cut removes material, as for an extrusion.
 */
export interface LoftFeature extends FeatureBase {
  type: 'loft';
  /** The sketches of the sections, first to last. */
  sections: Id[];
  op: 'boss' | 'cut';
  /** As for `ExtrudeFeature.merge`. */
  merge?: boolean;
}

/**
 * Rib (肋材, C4.7, v20): one straight line of a sketch thickened into a wall and grown from the line, in the plane of the sketch and square to the line,
 * until it meets the body. `side` is where the thickness goes, to both sides of the sketch plane or to the one the normal points to or the other one;
 * the wall grows along (normal of the sketch × the way the line is drawn), `flip` the other way.
 */
export interface RibFeature extends FeatureBase {
  type: 'rib';
  sketch: Id;
  thickness: Expr;
  side: 'mid' | 'positive' | 'negative';
  flip?: boolean;
}

/** One direction of a linear pattern (C6.1): the instances lie `spacing` apart along the straight edge, axis or plane normal `ref` points, `count` of them counting the seed. */
export interface PatternDirection {
  ref: Ref;
  spacing: Expr;
  count: Expr;
  reverse?: boolean;
}

/**
 * How a pattern repeats its seed (v22). Linear: along one direction, or a grid of two. Circular: about a straight edge, a reference axis or the axis of a
 * cylindrical face, `count` instances counting the seed; with `equal` the `angle` is the whole sweep they share out (all the way round, 360°, puts the
 * last one one step short of the seed; less than that puts the last one at the end), without it `angle` is the step between neighbours.
 */
export type PatternDefinition =
  | { mode: 'linear'; dir1: PatternDirection; dir2?: PatternDirection }
  | { mode: 'circular'; axis: Ref; count: Expr; angle: Expr; equal: boolean; reverse?: boolean };

/**
 * Pattern (複製排列, C6.1, C6.2, v22): what the `seeds` (one feature, or a run of features that follow one another) added to the body and took away from
 * it, repeated. Each instance is a copy of that, moved, then joined to or cut from the bodies like the seed was. The seed itself is instance 0. `skip` names
 * instances to leave out (`"2"`, or `"2x3"` in a grid: column 2, row 3, counting the seed as 0).
 */
export interface PatternFeature extends FeatureBase {
  type: 'pattern';
  seeds: Id[];
  def: PatternDefinition;
  skip?: string[];
}

/**
 * Mirror (鏡射, C6.3, v23): across a plane (a default plane, a reference plane, or a planar face), either what the `seeds` (one feature, or a run of features)
 * added to the bodies and took from them (`target: 'features'`, joined and cut like the seed was), or whole `bodies` (`target: 'bodies'`: each mirrored into
 * a body of its own with `merge: false`, else joined to every body it touches, the original included).
 */
export interface MirrorFeature extends FeatureBase {
  type: 'mirror';
  target: 'features' | 'bodies';
  plane: Ref;
  seeds: Id[];
  bodies: Ref[];
  merge?: boolean;
}

export interface RevolveFeature extends FeatureBase {
  type: 'revolve';
  sketch: Id;
  /** A line of the same sketch, usually a centerline, to revolve about. */
  axis: Id;
  op: 'boss' | 'cut';
  /** As for `ExtrudeFeature.merge`. */
  merge?: boolean;
  /** As for `ExtrudeFeature.contours`. */
  contours?: Id[][];
  dir1: RevolveCondition;
  thin?: Thin;
}

export interface FilletFeature extends FeatureBase {
  type: 'fillet';
  edges: Ref[];
  radius: Expr;
}

/** Chamfer (C5.3): SolidWorks 「角度-距離」 or 「距離-距離」. */
export interface ChamferFeature extends FeatureBase {
  type: 'chamfer';
  edges: Ref[];
  mode: 'angleDistance' | 'distanceDistance';
  /** Measured on the first adjacent face of each edge (see `flip`). */
  distance: Expr;
  /** The second distance, or the angle for angleDistance. */
  second: Expr;
  /** Measure `distance` on the other adjacent face of each edge (「反轉方向」). */
  flip?: boolean;
}

/**
 * How a reference plane is defined (C3.2). `plane` is a default plane or another reference plane
 * (kind "datum", by name or feature id) or a planar model face; `axis` a straight model edge or a reference axis;
 * `points` three model vertices (or reference points); `point` a model vertex or a reference point; `face` a cylindrical face.
 * v21 adds `parallel`, `perpendicular`, `midplane` and `tangent` (C3.2, P1).
 */
export type PlaneDefinition =
  | { mode: 'offset'; plane: Ref; distance: Expr; reverse?: boolean }
  /** Through the axis, turned by `angle` from the plane (at 0° parallel to it). */
  | { mode: 'angle'; plane: Ref; axis: Ref; angle: Expr; reverse?: boolean }
  | { mode: 'threePoint'; points: Ref[]; reverse?: boolean }
  /** Through the point, parallel to the plane. */
  | { mode: 'parallel'; plane: Ref; point: Ref; reverse?: boolean }
  /** Through the point, square to the axis (a straight edge or a reference axis). */
  | { mode: 'perpendicular'; axis: Ref; point: Ref; reverse?: boolean }
  /** Halfway between two parallel planes. */
  | { mode: 'midplane'; plane: Ref; plane2: Ref; reverse?: boolean }
  /** Touching a cylindrical face along a line, parallel to the plane (`reverse`: on the other side of the cylinder). */
  | { mode: 'tangent'; face: Ref; plane: Ref; reverse?: boolean };

export interface RefPlaneFeature extends FeatureBase {
  type: 'refPlane';
  def: PlaneDefinition;
}

/**
 * How a reference axis (基準軸, C3.3, v21) is defined: a straight edge; the line through two points (model vertices or reference points);
 * the axis of a cylindrical or conical face; or the line two planes meet in.
 */
export type AxisDefinition =
  | { mode: 'edge'; edge: Ref }
  | { mode: 'twoPoints'; points: Ref[] }
  | { mode: 'cylinder'; face: Ref }
  | { mode: 'planes'; plane: Ref; plane2: Ref };

export interface RefAxisFeature extends FeatureBase {
  type: 'refAxis';
  def: AxisDefinition;
}

/**
 * How a reference point (參考點, C3.5, v21) is defined: by its coordinates from the part origin; the centre of an edge (the centre of a circle, else
 * its middle) or of a face (a sphere's centre, else the middle of the face); or where an axis meets a plane.
 */
export type PointDefinition =
  | { mode: 'coords'; x: Expr; y: Expr; z: Expr }
  | { mode: 'center'; element: Ref }
  | { mode: 'axisPlane'; axis: Ref; plane: Ref };

export interface RefPointFeature extends FeatureBase {
  type: 'refPoint';
  def: PointDefinition;
}

/**
 * Coordinate system (座標系統, C3.4, v21): at `origin` (a vertex or reference point; the part origin when absent) with X along `x` and Y as near `y`
 * as is square to X. `x` and `y` are straight edges, reference axes, or planes (their normal). `flipX` and `flipY` turn those two around; Z follows
 * (X × Y), so the system is always right-handed.
 */
export interface CoordSysFeature extends FeatureBase {
  type: 'coordSys';
  origin?: Ref;
  x: Ref;
  y: Ref;
  flipX?: boolean;
  flipY?: boolean;
}

/**
 * A solid read from a file (F2.1). The file's content is the document's blob `blob` and travels
 * inside the part file, so the part rebuilds without the original file.
 */
export interface ImportedBodyFeature extends FeatureBase {
  type: 'importedBody';
  blob: Id;
  /** As for `ExtrudeFeature.merge`: `false` keeps what is read a body (or bodies) of its own. */
  merge?: boolean;
  /**
   * How far apart (a length) the edges of two surfaces may be and still be joined, when the file has surfaces
   * and no solid and they are sewn into one (F2.2). Without it the program's own default is used.
   */
  sewTolerance?: Expr;
}

/**
 * A body of another part file (C7.5, v26): the derived part of a fixture's master model. `source` is the master's file, relative to this file
 * ("/" separated, as in an assembly's file references), and `body` the id of the body in the master (ADR 0022: the id of the feature that made it).
 * Nothing of the body is stored here: its shape comes from rebuilding the master, its faces keep the master's persistent names, so mates on them
 * survive a change of the master. One way: the master never reads this part.
 */
export interface DerivedBodyFeature extends FeatureBase {
  type: 'derivedBody';
  source: string;
  body: Id;
}

/**
 * Delete Face (C10.2): the faces go and their neighbours are extended until they meet, which is how a
 * hole or a fillet of an imported body is taken out (SolidWorks 「刪除面」 with 「刪除並修補」).
 */
export interface DeleteFaceFeature extends FeatureBase {
  type: 'deleteFace';
  faces: Ref[];
  /**
   * 「刪除鑽孔」: besides the faces picked, the faces that only they enclose (the bottom of a blind hole) go too.
   * Which they are is worked out from the model each time, so the intent is stored, not their names.
   */
  hole?: boolean;
}

/**
 * Move Face (C10.1): a planar face is pushed `distance` along its outward normal (negative: into the
 * material) and its neighbours follow (SolidWorks 「移動面」, 「偏移」).
 */
export interface MoveFaceFeature extends FeatureBase {
  type: 'moveFace';
  face: Ref;
  distance: Expr;
}

/**
 * Offset surface (偏移曲面, C9.2, v28): the picked faces of one body, sewn into a region and offset by `distance` along their normals (positive: outward), as a surface
 * body of its own (the body they are on is left as it is); the result is measured and refused when it is not `distance` from the faces (ADR 0067). `join` is how the offset
 * goes round a corner of the region: rounded (the default, every point is `distance` away) or sharp.
 */
export interface OffsetSurfaceFeature extends FeatureBase {
  type: 'offsetSurface';
  faces: Ref[];
  distance: Expr;
  join?: 'arc' | 'intersection';
}

/**
 * Split line (分割線, C8.1, v29): the closed outlines of a sketch projected onto one face and the face cut along them, so that the regions they enclose are faces of their own
 * (with persistent names, to be picked for an offset surface). The projection goes along the sketch normal, `reverse` the other way; only the nearest layer of the face is cut
 * unless `throughAll` (a line of sight that crosses the body twice then cuts both crossings).
 */
export interface SplitLineFeature extends FeatureBase {
  type: 'splitLine';
  sketch: Id;
  face: Ref;
  reverse?: boolean;
  throughAll?: boolean;
}

/**
 * Knit (縫織曲面, C9.3, v30): surface bodies sewn into one (edges closer than `tolerance`, 0.01 mm when absent); when what comes out is closed it is made the solid
 * it bounds unless `solid` is false. The result is the first body (the others are used up).
 */
export interface KnitFeature extends FeatureBase {
  type: 'knit';
  /** Bodies (kind `body`, the name is the body's id). */
  bodies: Ref[];
  tolerance?: Expr;
  /** `false` keeps a closed result a shell. */
  solid?: boolean;
}

/**
 * Fill surface (填補曲面, C9.2, v30): a patch over the boundary made of the picked edges of one body, as a surface body of its own. `continuity` is how it meets the
 * face beside each edge: tangent (the default; absent) or only touching.
 */
export interface FillSurfaceFeature extends FeatureBase {
  type: 'fillSurface';
  edges: Ref[];
  continuity?: 'contact';
}

/** Flat surface (平坦曲面, C9.2, v30): a flat face over a closed loop of edges of one body that lie in a plane, as a surface body of its own. */
export interface FlatSurfaceFeature extends FeatureBase {
  type: 'flatSurface';
  edges: Ref[];
}

/**
 * Trim surface (修剪曲面, C9.3, v30): the closed outlines of a sketch are projected onto a face of a surface body, as for a split line, and what is inside them is kept
 * (what is outside them with `keep: 'outside'`); the rest of that face is taken away.
 */
export interface TrimSurfaceFeature extends FeatureBase {
  type: 'trimSurface';
  sketch: Id;
  face: Ref;
  keep?: 'outside';
  reverse?: boolean;
  throughAll?: boolean;
}

/**
 * Extend surface (延伸曲面, C9.3, v30): a surface body of one face made `distance` longer past the picked edges (the face grows along its own parameters, so it
 * carries on the way it was going).
 */
export interface ExtendSurfaceFeature extends FeatureBase {
  type: 'extendSurface';
  edges: Ref[];
  distance: Expr;
}

/**
 * Thicken (厚面, C9.4, v31): a surface body made a solid `thickness` thick, toward the side its faces point to when positive, the other way when negative. The result is
 * the same body (its id), now a solid: the surface is used up.
 */
export interface ThickenFeature extends FeatureBase {
  type: 'thicken';
  /** The surface body (kind `body`, the name is the body's id). */
  body: Ref;
  thickness: Expr;
}

/**
 * Cut with surface (以曲面除料, C9.4, v31): the surface body `surface` is swept along the normal of `direction` (a plane, or a planar face) and what it sweeps through is
 * taken from the solid body `target`; `reverse` sweeps the other way, so the other side of the surface goes. The surface body is left as it is.
 */
export interface CutWithSurfaceFeature extends FeatureBase {
  type: 'cutWithSurface';
  target: Ref;
  surface: Ref;
  direction: Ref;
  reverse?: boolean;
}

/**
 * Shell (薄殼, C5.4, v15): the body hollowed out to a wall of 	hickness, the picked aces taken away to open it; the wall grows inward, or
 * outward with outward.
 */
export interface ShellFeature extends FeatureBase {
  type: 'shell';
  faces: Ref[];
  thickness: Expr;
  outward?: boolean;
}

/**
 * Draft (拔模, C5.5, v16): the walls aces lean by ngle about the neutral plane 
eutral (a planar face of the body, or a plane), so that they
 * narrow away from it; 
everse leans them the other way (they widen away from it).
 */
export interface DraftFeature extends FeatureBase {
  type: 'draft';
  neutral: Ref;
  faces: Ref[];
  angle: Expr;
  reverse?: boolean;
}

/**
 * Combine (C7.2): bodies added together, subtracted from the first, or reduced to what they share. `main` and `tools`
 * refer to bodies (kind `body`, the name is the body's id); the result is the main body, the tools are used up.
 */
export interface CombineFeature extends FeatureBase {
  type: 'combine';
  op: 'add' | 'subtract' | 'common';
  main: Ref;
  tools: Ref[];
}

export type Feature =
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | SweepFeature
  | LoftFeature
  | RibFeature
  | PatternFeature
  | MirrorFeature
  | OffsetSurfaceFeature
  | SplitLineFeature
  | KnitFeature
  | FillSurfaceFeature
  | FlatSurfaceFeature
  | TrimSurfaceFeature
  | ExtendSurfaceFeature
  | ThickenFeature
  | CutWithSurfaceFeature
  | FilletFeature
  | ChamferFeature
  | RefPlaneFeature
  | RefAxisFeature
  | RefPointFeature
  | CoordSysFeature
  | ImportedBodyFeature
  | DerivedBodyFeature
  | DeleteFaceFeature
  | MoveFaceFeature
  | ShellFeature
  | DraftFeature
  | HoleFeature
  | CombineFeature;
export type FeatureType = Feature['type'];

// ---------------------------------------------------------------- document

export interface Variable {
  id: Id;
  name: string;
  expr: Expr;
}

/** The material of the part (C14.1, v24): a name and a density in g/cm³; the mass is the volume of the bodies that count times it. */
export interface MaterialRef {
  /** The id of the built-in material it was taken from (see `MATERIALS`); absent for one the user typed. */
  id?: string;
  name: string;
  density: number;
}

/** Standards the drawings of a part follow, how many decimals a derived dimension shows, and how fine the meshes of the screen, STL and images are (B8.4, v24). */
export interface DocSettings {
  draftStandard: 'ISO' | 'CNS' | 'ANSI' | 'JIS' | 'GB';
  dimensionPrecision: number;
  meshQuality: 'coarse' | 'normal' | 'fine';
}

/**
 * What a color is for (C14.2, v24): the whole part, one body (by its id), the faces a feature made (by its id), or one face (by reference). Where
 * several apply to a face, the narrower wins: part < body < feature < face.
 */
export type AppearanceTarget = { kind: 'part' } | { kind: 'body'; id: Id } | { kind: 'feature'; id: Id } | { kind: 'face'; ref: Ref };

export interface AppearanceOverride {
  target: AppearanceTarget;
  /** "#rrggbb". */
  color: string;
}

/** Data a feature imports, identified by content (the part file stores it as blobs/<sha256>.<kind>). */
export interface BlobRef {
  id: Id;
  sha256: string;
  kind: 'step';
  /** Name of the file it was read from; shown only. */
  fileName?: string;
}

/**
 * What the user has said about a body (C7.1). Which bodies there are is derived (they come from the features); this is
 * kept by body id, so a body that has gone leaves an entry that does nothing.
 */
export interface BodyProps {
  name?: string;
  /** A reference body (the workpiece of a fixture): not counted in the mass or written to the part's STEP, not in a bill of materials. */
  reference?: boolean;
}

export interface PartDoc {
  kind: 'part';
  schemaVersion: number;
  displayUnits: { length: 'mm' | 'in'; angle: 'deg' };
  variables: Variable[];
  /** Ordered history = FeatureManager tree order (B2.1). */
  features: Feature[];
  /** Rollback bar position: number of features evaluated, or null for all (B2.4). */
  rollbackIndex: number | null;
  properties: Record<string, string>;
  appearances: AppearanceOverride[];
  /** C14.1 (v24): absent until one is chosen; the mass is then known. */
  material?: MaterialRef;
  /** B8.4 (v24): only what was chosen; see `settingsOf` for the rest. */
  settings?: Partial<DocSettings>;
  blobs: BlobRef[];
  /**
   * What the user chose to show or hide (D4.6), by feature id (sketches, reference planes), default
   * plane name ("plane:front" …) or "origin". Only choices are stored: an item without an entry is
   * shown or hidden by its default (see `isShown`). Like SolidWorks, it is saved with the part.
   */
  visibility: Record<string, boolean>;
  /** Names and reference flags of bodies, by body id (C7.1). Only what was chosen is stored. */
  bodies: Record<Id, BodyProps>;
  /**
   * Highest number issued so far per readable-id prefix ("l" → 4 means l1…l4 were issued).
   * Ids are never reused, so a stale reference can never silently bind to a new object (B1.3).
   */
  idCounters: Record<string, number>;
}

export function findFeature(doc: PartDoc, id: Id): Feature | undefined {
  return doc.features.find((f) => f.id === id);
}

// ---------------------------------------------------------------- assembly (C15, A3.1, B9.4)

/** Assemblies have their own version line: a part and an assembly change for different reasons. */
export const ASSEMBLY_SCHEMA_VERSION = 6;

/** Unit quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number];

/**
 * Where a component sits (A3.1): its part's origin at `position` (mm), its axes turned by `rotation`.
 * For a floating component this is where the user put it: the start and the intent for whatever its
 * mates leave free (2B). Solved positions are derived and never stored.
 */
export interface Pose {
  position: Vec3;
  rotation: Quat;
}

/**
 * A file the assembly uses (B9.4), by its path relative to the assembly file's folder, "/" separated
 * ("定位板.3dbx", "零件/削邊銷.3dbx", "../共用/銷.3dbx"). Every component of the file refers to this
 * one entry, so the path is stored once.
 */
export interface FileRef {
  id: Id;
  path: string;
}

export interface Component {
  id: Id;
  /**
   * The part file, or the assembly file of a sub-assembly (C15.4): a FileRef of the assembly. Several
   * components may use one file (C15.1). A sub-assembly is rigid in the assembly that holds it: its own
   * mates are solved in its own file, and here it moves as one body.
   */
  file: Id;
  /** SolidWorks' instance number, 「削邊銷<2>」: unique among the components of one file. */
  instance: number;
  /** A fixed component never moves (C15.2); a floating one is placed by the user and, from 2B, by its mates. */
  fixed: boolean;
  placement: Pose;
  /** Not shown and not pickable, but still placed and solved (C15.5). Absent = shown. */
  hidden?: boolean;
  /** Left out of the assembly: not solved, not exported, its mates suppressed (C15.5). Absent = in use. */
  suppressed?: boolean;
  /** Drawn see-through; display only (C15.5). Absent = opaque. */
  transparent?: boolean;
}

/** The standard mates of SolidWorks 2010 (C15.8). */
export type MateType = 'coincident' | 'parallel' | 'perpendicular' | 'tangent' | 'concentric' | 'lock' | 'distance' | 'angle' | 'width' | 'symmetric';

/**
 * An element a mate uses: of a component, by the persistent name in its part (a face, edge or vertex;
 * a default or reference plane as kind "datum"; the part's origin as kind "datum", name "origin"),
 * or of the assembly itself (`component` null: its default planes and origin, which never move).
 *
 * When `component` is a sub-assembly (C15.4), `path` says which part inside it the element belongs to:
 * the ids of the components to go through, outermost first, the last being the part itself (ids of the
 * sub-assembly's own file, not of this one). Without a path the element is the sub-assembly's own
 * default plane or origin.
 */
export interface MateRef {
  component: Id | null;
  /** Components inside `component`, outermost first. Only on a sub-assembly. */
  path?: Id[];
  ref: Ref;
}

/**
 * A mate (C15.8, C15.12). Only the design intent is stored: which elements, which relation, which
 * way round. Whether it holds, and where it puts the components, is solved and derived (2B).
 */
export interface Mate {
  id: Id;
  /** 「重合1」, 「同軸心2」 … */
  name: string;
  type: MateType;
  a: MateRef;
  b: MateRef;
  /** b's normal or axis runs with a's (SolidWorks 「同向對齊」) or against it (「反向對齊」). */
  align?: 'aligned' | 'antiAligned';
  /** Distance (length) or angle, for distance and angle mates. */
  value?: Expr;
  /** The distance on the other side, or the other angle (「反轉尺寸」). */
  flip?: boolean;
  /** Lock: b's pose relative to a's, as it was when locked. */
  relative?: Pose;
  /**
   * Further elements (C15.9, v6). Width: [the other width face, on a's component; the other tab face, on b's]: the tab (b's faces) is centred
   * between the width faces (a's). Symmetric: [the plane] a and b mirror each other in; a datum plane of the assembly or any plane of a component.
   */
  more?: MateRef[];
  /**
   * Limit (C15.9, v6), distance and angle mates only: the least and the greatest the value may be; `value` is where it starts. Within them the
   * mate holds nothing; outside, it pulls back to the nearer. Either may be left out.
   */
  min?: Expr;
  max?: Expr;
  suppressed: boolean;
}

/** A direction or axis of a component pattern (C15.13): one of the assembly's axes, or an element of a component (a straight edge, a cylinder's axis, a plane's normal). */
export type PatternAxis = { kind: 'axis'; axis: 'x' | 'y' | 'z' } | { kind: 'ref'; ref: MateRef };

/** The planes of the assembly a component can be mirrored about (C15.13). */
export type MirrorPlane = 'plane:front' | 'plane:top' | 'plane:right';

/**
 * A pattern of one component (C15.13): its definition only. The instances are derived — where they are comes from the seed's pose
 * and this definition, so they follow the seed and are never stored or mated. `linear`: `count1` instances (the seed included)
 * `spacing1` apart along `axis1`, and optionally `count2` rows `spacing2` apart along `axis2`. `circular`: `count1` instances
 * turned about `axis1`, `spacing1` degrees apart (or, with `equal`, spread over `spacing1` degrees). `mirror`: one instance, the seed
 * reflected in `plane` (a mirrored copy of its part, derived from it).
 */
export interface ComponentPattern {
  id: Id;
  /** 「線性複製排列1」 … */
  name: string;
  kind: 'linear' | 'circular' | 'mirror';
  seed: Id;
  axis1?: PatternAxis;
  count1?: number;
  /** Distance (length) for linear, angle for circular. */
  spacing1?: Expr;
  flip1?: boolean;
  axis2?: PatternAxis;
  count2?: number;
  spacing2?: Expr;
  flip2?: boolean;
  /** Circular: `spacing1` is the whole angle the instances are spread over. */
  equal?: boolean;
  plane?: MirrorPlane;
  /** Instances left out, by label: "2", "3", or "2x1" in a grid (the seed is "1" / "1x1" and cannot be left out). */
  skip?: string[];
}

/**
 * A step of the exploded view (C15.14): some components of the assembly moved distance along a direction. Only the intent is stored; the poses of the
 * components are never changed by it: the view shows each component where its own pose plus the steps that name it put it, and collapsing is not showing them.
 */
export interface ExplodeStep {
  id: Id;
  /** 「爆炸步驟1」 … */
  name: string;
  /** Components of the assembly (a sub-assembly moves as one, its parts with it; the instances of a pattern follow their seed). */
  components: Id[];
  /** The direction: one of the assembly's axes, or an element of a component (a straight edge, a cylinder's axis, a plane's normal), as for patterns. */
  axis: PatternAxis;
  /** How far (length). */
  distance: Expr;
  /** The other way along the direction. */
  flip?: boolean;
}

export interface AssemblyDoc {
  kind: 'assembly';
  schemaVersion: number;
  files: FileRef[];
  /** FeatureManager order. */
  components: Component[];
  /** The mates folder, in FeatureManager order: the order conflicts are judged in (A3.4). */
  mates: Mate[];
  properties: Record<string, string>;
  /** Patterns and mirrors of components, in FeatureManager order (C15.13). Absent: none. */
  patterns?: ComponentPattern[];
  /** The steps of the exploded view, in the order they were made (C15.14). Absent: none. */
  explosion?: ExplodeStep[];
  /** As in parts (B1.3): ids are never reused. */
  idCounters: Record<string, number>;
}
