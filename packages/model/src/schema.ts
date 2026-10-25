import type { Id } from './ids';

/**
 * SSOT document schema (B1, B2, B5, B8, B9).
 * Only design intent lives here. B-Rep, meshes, element maps, sketch solutions,
 * DOF status, mass properties and error lists are derived data and never stored.
 */

export const SCHEMA_VERSION = 84;

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

/**
 * Reference = persistent name + fingerprint. Never a topology index (H3). Kind `sketch` (v72, ADR 0175) names an entity of an earlier sketch:
 * `<sketch id>:<entity id>`, held by the sketch entities that follow it.
 */
export interface Ref {
  kind: 'face' | 'edge' | 'vertex' | 'datum' | 'body' | 'sketch';
  name: string;
  fingerprint?: Fingerprint;
  /** An apparent contour branch of the referenced face, viewed along the sketch normal (v78). */
  silhouette?: number;
}

export type DatumPlaneName = 'plane:front' | 'plane:top' | 'plane:right';

// ---------------------------------------------------------------- sketch (C1)

/** Reserved id of the projected part origin inside every sketch (fixed at 0,0). */
export const SKETCH_ORIGIN: Id = '@origin';

/**
 * Reserved ids of the two axes of every sketch (FreeCAD's H_Axis and V_Axis, ADR 0170, v68): infinite lines through the origin along the sketch's x and y.
 * Like the origin they are never stored among the entities; relations and dimensions, a revolve and a mirror may refer to them.
 */
export const SKETCH_AXIS_H: Id = '@axisH';
export const SKETCH_AXIS_V: Id = '@axisV';

export const isSketchAxis = (id: Id): boolean => id === SKETCH_AXIS_H || id === SKETCH_AXIS_V;

/** The direction of a sketch axis (a unit vector in sketch coordinates), or undefined for any other id. */
export function sketchAxisDir(id: Id): [number, number] | undefined {
  return id === SKETCH_AXIS_H ? [1, 0] : id === SKETCH_AXIS_V ? [0, 1] : undefined;
}

/**
 * A `ref` on a line, circle or arc makes it the projection of a model edge onto the sketch plane (C1.18, v13): where it lies comes from the
 * model, never from the sketch, so it follows the edge when the model changes. A `pierce` on a point makes it the place where a straight model
 * edge passes through the sketch plane (「貫穿」, C1.26); a `ref` on a point (v69, ADR 0171) makes it a model vertex projected onto the plane along its
 * normal. A point has one or the other, never both. A `ref` of kind 'datum' (v70, ADR 0172) follows reference geometry earlier in the history: a point a
 * reference point (or an axis square to the plane, where it passes through), a line a reference axis (`axis:x|y|z` too, projected) or a plane (where it
 * crosses the sketch plane): such a line is construction, never part of a profile. A `ref` (or a point's `pierce`) of kind 'sketch' (v72, ADR 0175)
 * follows a point, line, circle or arc of an earlier sketch, projected onto this plane (or, a pierce, where that curve passes through it). Their points keep their stored places only as a first guess; the model fixes them.
 */
export type SketchEntity =
  | { id: Id; type: 'point'; x: number; y: number; construction?: boolean; pierce?: Ref; ref?: Ref }
  | { id: Id; type: 'line'; p1: Id; p2: Id; construction?: boolean; ref?: Ref }
  | { id: Id; type: 'circle'; center: Id; radius: number; construction?: boolean; ref?: Ref }
  | { id: Id; type: 'arc'; center: Id; start: Id; end: Id; construction?: boolean; ref?: Ref }
  | { id: Id; type: 'ellipse'; center: Id; major: Id; minorRadius: number; construction?: boolean; ref?: Ref }
  | { id: Id; type: 'spline'; points: Id[]; closed?: boolean; bezier?: boolean; construction?: boolean; ref?: Ref }
  | {
      id: Id;
      type: 'text';
      text: string;
      at: Id;
      size: number;
      angle?: number;
      font?: string;
      bold?: boolean;
      italic?: boolean;
      align?: 'left' | 'center' | 'right';
      construction?: boolean;
    };

/**
 * Sketch relations and dimensions (C1.25–C1.28). Point coordinates stored on entities are the
 * initial guess and the intent for under-defined DOFs; solved positions are derived.
 */
export type SketchConstraint =
  | { id:Id; type:'ellipseAxes'; entity:Id; majorRadius:Expr; minorRadius:Expr }
  | { id: Id; type: 'coincident'; a: Id; b: Id }
  /** One line, or two points aligned horizontally / vertically. */
  | { id: Id; type: 'horizontal'; a: Id; b?: Id }
  | { id: Id; type: 'vertical'; a: Id; b?: Id }
  | { id: Id; type: 'collinear'; a: Id; b: Id }
  | { id: Id; type: 'parallel'; a: Id; b: Id }
  | { id: Id; type: 'perpendicular'; a: Id; b: Id }
  | { id: Id; type: 'tangent'; a: Id; b: Id }
  | { id:Id; type:'tangentExternal'|'tangentInternal'; a:Id; b:Id }
  | { id:Id; type:'endpointTangent'; a:Id; b:Id; aEnd:'start'|'end'; bEnd:'start'|'end'; opposed:boolean }
  | { id: Id; type: 'concentric'; a: Id; b: Id }
  /** Two circles or arcs with the same center and the same radius (SolidWorks 「同心同徑」, v11). */
  | { id: Id; type: 'coradial'; a: Id; b: Id }
  /** Equal unsigned curvature for circular entities (1/r); spline curvature is not supported by PlaneGCS. */
  /** A pattern copy point follows a rigid transform of its seed (v80); signed offsets and an angle about a fixed sketch-space center. */
  | { id: Id; type:'patternPoint'; a:Id; b:Id; dx:Expr; dy:Expr; angle:Expr; center:[number,number] }
  | { id: Id; type: 'equalCurvature'; a: Id; b: Id }
  | { id:Id; type:'symmetricEntity'; a:Id; b:Id; axis:Id; reverse?:boolean }
  | { id:Id; type:'symmetricEntityPoint'; a:Id; b:Id; point:Id; reverse?:boolean }
  | { id: Id; type: 'symmetricPoint'; a: Id; b: Id; point: Id }
  /** Length(a) = ratio × length(b); dimensionless positive expression (v82). */
  | { id: Id; type: 'lengthRatio'; a: Id; b: Id; ratio: Expr }
  /** Ordered anchors (points or circle/arc centers), equally spaced from first to last. */
  | { id: Id; type: 'equalSpacing'; points: Id[] }
  | { id: Id; type: 'equal'; a: Id; b: Id }
  /** `point` at the middle of `line`, a line or (schema 56) an arc: the middle of its sweep. */
  | { id: Id; type: 'midpoint'; point: Id; line: Id }
  /** SolidWorks "coincident" between a point and a line, circle or arc (point–point is `coincident`). */
  | { id: Id; type: 'pointOnCurve'; point: Id; curve: Id }
  | { id: Id; type: 'symmetric'; a: Id; b: Id; axis: Id }
  /** A point where two curves cross (SolidWorks 「交錯」, v11). */
  | { id: Id; type: 'intersection'; point: Id; a: Id; b: Id }
  | { id: Id; type: 'fix'; point: Id }
  /**
   * All of a line, circle or arc held where it is (v74, ADR 0182; FreeCAD 「Block」, SolidWorks 「固定」 on a curve): a line's two ends, a circle's center and
   * radius, an arc's center, start and the way its end lies. Taken from the positions stored in the sketch, as `fix` is.
   */
  | { id: Id; type: 'block'; entity: Id }
  | { id: Id; type: 'distance'; a: Id; b?: Id; value: Expr; label?: string; /** Position of the dimension text in sketch coordinates; absent uses automatic layout. */ labelPosition?: [number, number]; driving?: boolean; /** Between a circle or arc and a point, line, circle or arc (v75, ADR 0183): absent is from its center, `min` the nearest points of the two, `max` the farthest. */ condition?: 'min' | 'max' }
  | { id: Id; type: 'distanceX'; a: Id; b: Id; value: Expr; label?: string; /** Position of the dimension text in sketch coordinates; absent uses automatic layout. */ labelPosition?: [number, number]; driving?: boolean }
  | { id: Id; type: 'distanceY'; a: Id; b: Id; value: Expr; label?: string; /** Position of the dimension text in sketch coordinates; absent uses automatic layout. */ labelPosition?: [number, number]; driving?: boolean }
  | { id: Id; type: 'radius'; circle: Id; value: Expr; label?: string; /** Position of the dimension text in sketch coordinates; absent uses automatic layout. */ labelPosition?: [number, number]; driving?: boolean }
  | { id: Id; type: 'diameter'; circle: Id; value: Expr; label?: string; /** Position of the dimension text in sketch coordinates; absent uses automatic layout. */ labelPosition?: [number, number]; driving?: boolean }
  /** The length of an arc (v11); `circle` is the arc. */
  | { id: Id; type: 'arcLength'; circle: Id; value: Expr; label?: string; /** Position of the dimension text in sketch coordinates; absent uses automatic layout. */ labelPosition?: [number, number]; driving?: boolean }
  /**
   * The angle of the sector between two lines where the dimension was placed (SolidWorks). The sector
   * lies between the rays along the lines as drawn, each reversed where `flip` says so; seen from the
   * intersection, `b`'s ray is `value` counter-clockwise from `a`'s. Without `flip` (and in documents
   * before v6) the rays are the lines as drawn.
   */
  | { id: Id; type: 'angle'; a: Id; b: Id; value: Expr; label?: string; /** Position of the dimension text in sketch coordinates; absent uses automatic layout. */ labelPosition?: [number, number]; driving?: boolean; flip?: 'a' | 'b' | 'both' };

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

/**
 * Where the axes of a sketch sit in its plane (v73, ADR 0181): the plane stays the sketch's `plane`, this only moves the origin and turns x. Absent is what
 * every sketch had before: the origin where the part origin falls on the plane, x as the plane gives it.
 */
export interface SketchAttach {
  /** A model vertex or a reference point: the origin goes where it lies, moved along the plane's normal onto the plane. */
  origin?: Ref;
  /** A straight model edge or a reference axis: x runs along it, as drawn, projected onto the plane. */
  x?: Ref;
  /** x and y turned half a turn about the normal (the normal, and the way the sketch is seen from, stay). */
  flipX?: boolean;
}

export interface SketchFeature extends FeatureBase {
  type: 'sketch';
  plane: Ref;
  /** Origin and x direction taken from the model (v73, ADR 0181). */
  attach?: SketchAttach;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  /** Images laid in the plane to be traced from (v49, ADR 0116): only looked at while the sketch is edited. */
  pictures?: SketchPicture[];
}

/**
 * A picture of a sketch (草圖圖片, v49): an image (a blob of kind `png` or `jpg`) in the plane of the sketch, centred at (`x`, `y`), `width` × `height` mm, turned `angle` degrees about its centre,
 * drawn with `opacity` (0 to 1). Plain numbers, not expressions: it is a reference to trace, not a dimension of the part, and takes no part in the profiles, relations or dimensions.
 */
export interface SketchPicture {
  id: Id;
  blob: Id;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  opacity: number;
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
  /** Up to the surface of another body, which it takes the shape of (成形至本體, v14); body is a kind: 'body' reference. */
  | { type: 'upToBody'; body: Ref; reverse?: boolean }
  /** To offset short of a face parallel to the sketch, or beyond it with beyond (從曲面偏移, v14). */
  | { type: 'offsetFromFace'; face: Ref; offset: Expr; beyond?: boolean; reverse?: boolean };

/** The walls of an extrusion lean by angle (拔模, v14): away from the profile, or towards it with inward. */
export interface Draft {
  angle: Expr;
  inward?: boolean;
}

/** A thin feature (薄件, v14): the profile's outline thickened instead of its inside filled, one way, both ways equally, or by two thicknesses. */
export interface Thin {
  mode: 'one' | 'mid' | 'two';
  thickness: Expr;
  /** The other side's thickness, for two. */
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
 * expressions. tapped is the tap-drill hole of a thread, which is not modelled.
 */
export interface HoleFeature extends FeatureBase {
  type: 'hole';
  sketch: Id;
  kind: 'straight' | 'counterbore' | 'countersink' | 'tapped' | 'dowel';
  /** The standard size the diameters came from, e.g. M6 (a label; custom or absent when typed). */
  size?: string;
  /** Explicit thread specification; only valid on a standard tapped hole. */
  toleranceClass?: string;
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
  /**
   * The path: a sketch, or a helix curve feature (C8.3, ADR 0169). Along a helix the profile keeps its place relative to the helix's axis (a screw
   * motion, as a thread is made) rather than following the path's curvature.
   */
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
 * Real Thread feature (真實螺牙, C4.8, v53): helical sweep of a profile sketch along an axis.
 * Profile sketch lies on a plane containing the axis. The tool cuts from or fuses onto the body.
 */
export interface ThreadFeature extends FeatureBase {
  type: 'thread';
  /** 'standard' uses built-in library (Metric/UNC); 'custom' uses sketch wire profile. Default: 'custom'. */
  profileMode?: 'standard' | 'custom';
  /** Designation for standard thread, e.g. 'M6', '1/4-20 UNC'. Required if profileMode === 'standard'. */
  standardDesignation?: string;
  /** Standard thread target: 'external' (shaft/bolt) or 'internal' (bore/nut). Default: 'external'. */
  standardTarget?: 'external' | 'internal';
  /** The sketch of the tooth profile (closed wire on a plane containing the axis). Required if profileMode === 'custom'. */
  sketch?: Id;
  /**
   * The axis: a line of the profile sketch, by its id (as a revolve's axis; a centerline is the usual one), or a reference: a cylindrical or conical
   * face (its axis), a straight model edge, or a reference axis (`axis:x`, `axis:y`, `axis:z` are the axes of the origin).
   */
  axis: Ref | Id;
  /** 'cut' removes thread material from body; 'boss' adds thread material. */
  op: 'boss' | 'cut';
  /** Compatibility alias for op */
  operation?: 'boss' | 'cut';
  pitch?: Expr;
  starts?: Expr;
  hand: 'right' | 'left';
  length: Expr;
  taper?: Expr;
  phase?: Expr;
  reverse?: boolean;
  /** Optional fade transitions at start and end */
  fadeTurnsIn?: Expr;
  fadeTurnsOut?: Expr;
}

/**
 * Knurl (壓花, ADR 0124): the grooves of a straight, helical or diamond pattern cut into a cylinder about an axis. The blank is the cylinder of
 * `diameter`; a groove is a V `depth` deep with `included` between its flanks, and `count` of them go round the circumference, so the pattern closes
 * on itself. `pattern` says which way they run: along the axis, at `angle` to it (one `hand`), or both hands at once, crossing.
 *
 * The grooves are cut from the body, which must already be at `diameter` on that axis: this is how a drawing gives a knurl (its diameter is the
 * knurled outside diameter, the ridges reach it and the grooves cut in from it).
 */
export interface KnurlFeature extends FeatureBase {
  type: 'knurl';
  /** The axis of the surface to knurl: a cylindrical or conical face of the body (its axis), a straight model edge, or a reference axis. */
  axis: Ref;
  /** The blank's outside diameter: the surface the grooves are cut into. */
  diameter: Expr;
  /** How far along the axis the knurl runs, from the end `axis` names (the far end when `reverse`). */
  length: Expr;
  /** How many grooves go round the circumference: a whole number from 3, so that the pattern closes on itself. */
  count: Expr;
  /** How deep a groove cuts in from `diameter`. */
  depth: Expr;
  /** 'straight' grooves run along the axis; 'helical' runs at `angle` to it, one hand; 'diamond' runs both hands, crossing. */
  pattern: 'straight' | 'helical' | 'diamond';
  /** The angle of a groove to the axis, for 'helical' and 'diamond'. Default 30°. */
  angle?: Expr;
  /** The full angle between a groove's two flanks. Default 90°. */
  included?: Expr;
  /** Which way a 'helical' groove winds. Default 'right'. */
  hand?: 'right' | 'left';
  /** The whole pattern turned about the axis. */
  phase?: Expr;
  /** The knurl runs the other way along the axis from where `axis` puts it. */
  reverse?: boolean;
}

/**
 * Cosmetic Thread (裝飾螺紋線, C4.9, ADR 0156, v57): a lightweight annotation representing a threaded shaft or hole.
 * Does NOT generate 3D helical boolean geometry (0.00 MiB WASM Heap overhead).
 * Renders lightweight cosmetic curves in 3D and generates ISO 6410-1 standard 3/4-circle arcs and thread lines in 2D drawings.
 */
export interface CosmeticThreadFeature extends FeatureBase {
  type: 'cosmeticThread';
  /** Target cylindrical surface: outer cylinder for external thread, inner hole wall for internal thread. */
  targetFace: Ref;
  /** Optional circular edge or end face indicating start position; if omitted, defaults to cylinder end. */
  startEdge?: Ref;
  /** External thread (shaft/bolt) or internal thread (bore/nut). */
  threadType: 'external' | 'internal';
  /** 'standard' uses built-in library (Metric/UNC); 'custom' uses user-entered diameters/pitch. */
  standardMode?: 'standard' | 'custom';
  /** Designation for standard thread, e.g. 'M8', 'M8x1.25', '1/4-20 UNC'. */
  standardDesignation?: string;
  /** Explicit metric or unified tolerance class, never an assumed default. */
  toleranceClass?: string;
  /** Major diameter (crest for external, root for internal). */
  majorDiameter: Expr;
  /** Minor diameter (root for external, tap drill for internal). */
  minorDiameter: Expr;
  /** Thread pitch in mm. */
  pitch: Expr;
  /** End condition: 'blind' or 'through'. */
  endCondition: 'blind' | 'through';
  /** Thread length/depth along axis. */
  depth: Expr;
  /** Reverse direction along cylinder axis. */
  reverse?: boolean;
}

/**
 * Helix and Spiral Curve (螺旋曲線與渦捲線, C8.3, ADR 0168, v67): 3D space curve or flat spiral curve
 * driven by a reference circular sketch entity or circular model edge.
 */
/** C8.2 projected 3D curve body, v77. Faces are trimmed targets; direction defaults to the first sketch normal. */
/** C9.2: linear interpolation between two model edges. */
interface ToothedBase extends FeatureBase {
  plane:Ref; module:Expr; teeth:Expr; pressureAngle:Expr; width:Expr; backlash:Expr;
}
/** Unshifted involute external spur gear; simplified root transitions, v81. */
export interface SpurGearFeature extends ToothedBase { type:'gear'; bore:Expr }
/** Straight rack, X along pitch line, Y toward tooth tips, v81. */
export interface RackFeature extends ToothedBase { type:'rack'; baseHeight:Expr }
export interface RuledSurfaceFeature extends FeatureBase { type:'ruledSurface'; first:Ref; second:Ref; reverseSecond?:boolean }
/** C9.2: planar line/circular rail extended perpendicular to its tangent, in a reference plane. */
export interface RadiatedSurfaceFeature extends FeatureBase { type:'radiatedSurface'; edge:Ref; plane:Ref; distance:Expr; reverse?:boolean }
/** Replacement by a parallel planar face or datum plane; neighbouring faces extend/trim with the target. */
export interface ReplaceFaceFeature extends FeatureBase { type:'replaceFace'; face:Ref; replacement:Ref }

export interface ProjectedCurveFeature extends FeatureBase {
  type: 'projectedCurve';
  mode: 'sketchOnSketch' | 'sketchOnFaces';
  sketch: Id;
  secondSketch?: Id;
  faces?: Ref[];
  direction?: Ref;
}

export type HelixDefinedBy = 'pitchAndRev' | 'heightAndRev' | 'heightAndPitch' | 'spiral';

export interface HelixFeature extends FeatureBase {
  type: 'helix';
  /** Reference circular sketch (circle/arc) or circular model edge. */
  circle: Ref;
  /** Definition mode: 'pitchAndRev' | 'heightAndRev' | 'heightAndPitch' | 'spiral'. Default: 'pitchAndRev'. */
  definedBy: HelixDefinedBy;
  /** Pitch in mm (used in pitchAndRev, heightAndPitch, spiral). */
  pitch?: Expr;
  /** Revolutions count (used in pitchAndRev, heightAndRev, spiral). */
  revolutions?: Expr;
  /** Total height in mm (used in heightAndRev, heightAndPitch). */
  height?: Expr;
  /** Starting angle (e.g. '0deg', '90deg'). Default '0deg'. */
  startAngle?: Expr;
  /** Whether winding is clockwise. Default true. */
  clockwise?: boolean;
  /** Reverse along axis direction. Default false. */
  reverse?: boolean;
  /** Optional taper angle (e.g. '5deg'). */
  taperAngle?: Expr;
  /** Taper expands outward (true) or narrows inward (false). Default false. */
  taperOutward?: boolean;
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
 * A pattern along a 3D model edge or sketch curve (C6.4, v65, ADR 0166).
 * Instances follow the curve by equal spacing or a specified distance step,
 * and either rotate to stay tangent to the curve or keep the seed's orientation.
 */
export interface CurvePatternDefinition {
  mode: 'curve';
  /** Path reference: a 3D model edge or a sketch. */
  path: Ref;
  /** Number of instances counting the seed (>= 2). */
  count: Expr;
  /** Spacing along curve in mm (used when equal is false). */
  spacing?: Expr;
  /** Equal spacing along curve: divides curve length equally. Default true. */
  equal: boolean;
  /** Alignment method: 'tangent' rotates with curve tangent; 'parallel' keeps seed orientation. Default 'tangent'. */
  alignment?: 'tangent' | 'parallel';
  /** Reverse travel direction along curve. */
  reverse?: boolean;
}

/**
 * How a pattern repeats its seed (v22, v65). Linear: along one direction, or a grid of two. Circular: about a straight edge, a reference axis or the axis of a
 * cylindrical face, `count` instances counting the seed; with `equal` the `angle` is the whole sweep they share out (all the way round, 360°, puts the
 * last one one step short of the seed; less than that puts the last one at the end), without it `angle` is the step between neighbours. Curve: along a 3D
 * model edge or sketch curve, equally spaced or by step distance, optionally tangent-aligned.
 */
export type PatternDefinition =
  | { mode: 'linear'; dir1: PatternDirection; dir2?: PatternDirection }
  | { mode: 'circular'; axis: Ref; count: Expr; angle: Expr; equal: boolean; reverse?: boolean }
  | CurvePatternDefinition;

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
  /**
   * Faces whose every edge is rounded as well (v43, 選面): the edges are worked out from the faces each time the model is rebuilt, not kept, so an edge the
   * face gains later is rounded too. The seam of a round or a cylinder and an edge the faces beside continue smoothly are left out.
   */
  faces?: Ref[];
  /**
   * What kind of fillet (v43): absent is the usual one (constant radius, `edges` and `faces`). `face` (面圓角) rounds the edges where a face of `faces` meets a
   * face of `faces2`; `full` (完整圓角) takes the faces of `center` away and rounds across them, tangent to `faces` on one side and `faces2` on the other.
   * For those two `edges` is not used.
   */
  kind?: FilletKind;
  faces2?: Ref[];
  center?: Ref[];
  radius: Expr;
  /**
   * The control points of a variable-radius fillet (C5.2, v66, ADR 0167): present means the radius evolves along `edge`, interpolating (t, radius) linearly
   * between a point and the next. `t` is where along the edge, 0 at its first vertex and 1 at its last, so a variable edge's points start at t = 0 and end
   * at t = 1. Only a picked edge (`edges`) carries points: an edge worked out from `faces` is not known until the model is rebuilt, and none exists to say
   * where the radius would change. Absent (or empty) is a constant radius, as every file before v66.
   */
  variable?: FilletVariablePoint[];
}

/**
 * A control point of a variable-radius fillet (C5.2, v66, ADR 0167): the radius `radius` at the position `t` along the edge of persistent name `edge`,
 * one of the fillet feature's own `edges`. Between two points the radius is linear, so the two ends of an edge can be points themselves (t = 0 and t = 1)
 * and that is what a fillet opened as variable starts with.
 */
export interface FilletVariablePoint {
  edge: string;
  t: number;
  radius: Expr;
}

export type FilletKind = 'constant' | 'face' | 'full';

/** Chamfer (C5.3): SolidWorks 「角度-距離」 or 「距離-距離」. */
export interface ChamferFeature extends FeatureBase {
  type: 'chamfer';
  edges: Ref[];
  /** As for a fillet (v43): the edges of these faces, with the first distance measured on the face the edge comes from. */
  faces?: Ref[];
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
  | { mode: 'tangent'; face: Ref; plane: Ref; reverse?: boolean }
  /**
   * Square to a curve where `point` lies on it (v71, ADR 0174): `curve` a model edge (a curve body's too, a helix), `point` a model vertex or a reference
   * point on that curve; the normal is the curve's tangent there, the way its parameter grows (`reverse`: the other way). A point off the curve is refused.
   */
  | { mode: 'normalToCurve'; curve: Ref; point: Ref; reverse?: boolean };

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
 * Mutual trim (互相修剪曲面, P-3, v46): two surface bodies cut at the curves where they cross, each into the pieces it is made of, in the place of the bodies (their ids). The
 * pieces keep the names of the faces they came from; a face that falls into several is told apart by `#k`. `discard` names the pieces taken away (faces of the result); a piece
 * that is not named stays. It has to leave at least one piece of each body.
 */
export interface MutualTrimFeature extends FeatureBase {
  type: 'mutualTrim';
  /** The two surface bodies (kind `body`, the name is the body's id). */
  a: Ref;
  b: Ref;
  discard?: Ref[];
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
  /** Both sides (v45): `thickness` is the total, half of it each side of the surface. */
  both?: boolean;
  /** Keep the surface (v45): the surface body stays as it is, and the solid is a new body (the id of the feature). */
  keepSurface?: boolean;
}

/**
 * Cut with surface (以曲面除料, C9.4, v31; fixed vectors and kept side v52): the surface body `surface` is swept along a plane normal or fixed XYZ direction
 * and what it sweeps through is removed from the solid body `target`; `keep` chooses the side that remains. The surface body is left as it is.
 */
export interface CutWithSurfaceFeature extends FeatureBase {
  type: 'cutWithSurface';
  target: Ref;
  surface: Ref;
  direction: Ref | { kind: 'vector'; value: Vec3 };
  reverse?: boolean;
  keep?: 'behind' | 'ahead';
}

/**
 * Lip or groove (唇與溝槽, C4.11, v33): on the planar face `face` (the rim of a shell, say) a ring that follows its outer outline: from `offset` in from the edge, `width` wide
 * (the outline offset inward twice, the ring between). A lip grows out of the face `height` along its outward normal; a groove is cut into the body `height` deep. The
 * ring has to lie on the face. The cover's groove is the same feature with the width and depth the fit calls for.
 */
export interface LipGrooveFeature extends FeatureBase {
  type: 'lipGroove';
  face: Ref;
  kind: 'lip' | 'groove';
  /** How far in from the edge of the face the ring starts (0 or more). */
  offset: Expr;
  width: Expr;
  height: Expr;
}

/**
 * Screw boss (螺柱, C4.11, v34): at the free points of a sketch (as for the hole wizard), standing on the sketch plane and growing `height` along its normal (`reverse`: the
 * other way), a column of outside diameter `diameter` with a pilot hole of `holeDiameter` that goes `holeDepth` down from the top (the height when absent: down to the plane).
 * `draft` leans the outside wall (narrowing toward the top), as a molded boss has it. `ribs` are triangular gussets round the foot, `count` of them, from the angle `angle`
 * (0° is the sketch's x), each `thickness` thick, reaching `length` out from the wall and `height` up it. The column runs a little into the body it stands on so that it joins.
 */
export interface ScrewBossFeature extends FeatureBase {
  type: 'screwBoss';
  sketch: Id;
  diameter: Expr;
  holeDiameter: Expr;
  height: Expr;
  holeDepth?: Expr;
  draft?: Expr;
  /** The draft of the pilot hole (v41): the hole narrows toward its bottom by this angle, `holeDiameter` being the diameter at the opening; absent: a straight hole. */
  holeDraft?: Expr;
  ribs?: { count: Expr; thickness: Expr; length: Expr; height: Expr; angle?: Expr };
  reverse?: boolean;
}

/**
 * Base flange (基材凸緣, C11.1, v36): the first feature of a sheet metal part and the one that holds its parameters: the sheet is `thickness` thick, its bends have the
 * inner radius `radius`, and `kFactor` (0 to 1, where in the thickness the length stays the same: 0.5 is the middle) gives the bend allowance of every bend of the part.
 * A closed profile of the sketch is a plate that grows `thickness` along the sketch normal (`reverse`: the other way). An open profile (a polyline of lines) is a sheet that
 * follows it, bent at every corner, `depth` wide along the normal (`reverse`: the other way) and `thickness` thick to the left of the way the path is walked (`flipSide`: the
 * right); the sketch is one face of the sheet.
 */
export interface BaseFlangeFeature extends FeatureBase {
  type: 'baseFlange';
  sketch: Id;
  thickness: Expr;
  radius: Expr;
  kFactor: Expr;
  /** An open profile only: how wide the sheet is. */
  depth?: Expr;
  reverse?: boolean;
  flipSide?: boolean;
}

/** Editable manufacturing state; refold explicitly names its earlier unfold feature. */
export interface SheetUnfoldFeature extends FeatureBase { type: 'sheetUnfold'; bends?: Id[] }
export interface SheetRefoldFeature extends FeatureBase { type: 'sheetRefold'; unfold: Id }

/**
 * Mid bend (中間折彎, S-3, v48): the plate of a sheet metal part bent along the one line of a sketch, in the middle of the plate. The line divides the plate; the side to the left of the
 * way the line is drawn stays (`flipSide`: the right), the other side turns by `angle` about an axis parallel to the line, `radius` from the face the plate folds toward (the
 * sheet's when absent). It folds toward the sketch normal (`reverse`: against it). The bend is centred on the line: its zone is as wide as the bend allowance, so the flat pattern is
 * the plate as it was drawn. Each new bend zone must be one planar strip free of holes, notches or earlier curved zones. Sequential bends can be mixed with ordinary edge
 * flanges, hems and jogs on a closed-profile sheet base; a rigid panel mapping keeps their manufacturing coordinates.
 */
export interface MidBendFeature extends FeatureBase {
  type: 'midBend';
  sketch: Id;
  angle: Expr;
  radius?: Expr;
  reverse?: boolean;
  flipSide?: boolean;
}

/**
 * Jog feature (鈑金凸折, C11.3, v60, ADR 0159): steps a plate along a sketched line with two opposite bends and an intermediate web.
 * The side to the left of the sketched line vector stays fixed by default (`flipSide`: the right), while the other side is translated
 * by `offset` height and re-aligned parallel to the original plate.
 */
export interface JogFeature extends FeatureBase {
  type: 'jog';
  sketch: Id;
  offset: Expr;
  angle?: Expr;
  radius?: Expr;
  reverse?: boolean;
  flipSide?: boolean;
}

/**
 * Edge flange (邊線凸緣, C11.2, v37): on a straight edge of the sheet (the edge between a face of the sheet and its end face), a bend and a flat flange along the whole edge. It bends
 * toward the side of the face the edge is on (`flip`: the other side) by `angle` (90° when absent), with the inside radius `radius` (the base flange's when absent). `length` is
 * measured from the outside virtual sharp of the bend (`outer`, the default), from the inside one (`inner`), or is the flat piece after the bend (`tangent`). With
 * `materialInside` (the default) the outside virtual sharp is on the edge: the sheet is cut back by the bend so the flange is flush with the edge; with `bendOutside`
 * the bend starts at the edge and the sheet is left as it is.
 */
export interface EdgeFlangeFeature extends FeatureBase {
  type: 'edgeFlange';
  edge: Ref;
  length: Expr;
  angle?: Expr;
  lengthFrom?: 'outer' | 'inner' | 'tangent';
  position?: 'materialInside' | 'bendOutside';
  radius?: Expr;
  flip?: boolean;
  /**
   * Closed corner (封閉角落, C11.4, v42): at the start and/or the end of the flange (as for `inset`), its flat piece goes on past the end of the bend toward the flange next to it,
   * stopping the `gap` given from the inside of that flange: the bend itself stays clear of the neighbouring bend (by the inset), so the corner is closed by the flat pieces. An end
   * with no flange to close against is said.
   */
  corner?: { start?: Expr; end?: Expr };
  /**
   * Mitre (斜接, C11.4, v47): at the start and/or the end of the flange (as for `corner`) the flange and the one next to it, made before it, meet on the vertical plane that halves the angle
   * between their outer faces, instead of leaving the corner open. The value is the `gap` left between the two cut faces (0: they touch). Both flanges are 90°, with the same radius,
   * on edges at right angles, bent the same way, with the material inside, and the neighbour reaches the corner (no inset at that end).
   */
  miter?: { start?: Expr; end?: Expr };
  /**
   * The flange stops short of the ends of the edge (v39, C11.4): `start` from the end where the edge begins when it is walked with the face it is on in front of you and the outside
   * on your right, `end` from the other. Where it stops short, `relief` cuts a rectangular notch into the sheet beside it, `width` along the edge and `depth` deeper than the bend starts,
   * so that the bend can form without tearing the sheet next to it. The notch is a rectangle (`shape` absent or `rect`), an obround (`obround`: the closed end is a half circle,
   * `depth` is to the bottom of it, so it must be at least half the `width`), or a tear (`tear`: a slit as wide as `TEAR_RELIEF_WIDTH`, `width` is not used).
   */
  inset?: { start: Expr; end: Expr };
  relief?: { width: Expr; depth: Expr; shape?: ReliefShape };
}

/** Break corner (斷開角落, C11.4, v51): chamfer or fillet selected external free-end corners of sheet-metal flanges. */
export interface BreakCornerFeature extends FeatureBase {
  type: 'breakCorner';
  corners: Ref[];
  kind: 'chamfer' | 'fillet';
  size: Expr;
}

/** The shape of the notch of a relief (v50). */
export type ReliefShape = 'rect' | 'obround' | 'tear';
export const RELIEF_SHAPES: readonly ReliefShape[] = ['rect', 'obround', 'tear'];
/** The width of the slit of a tear relief (mm): a tear has no width of its own, a solid cannot have none. */
export const TEAR_RELIEF_WIDTH = 0.05;

/**
 * Hem (摺邊, C11.2, v38): on a straight edge of the sheet (as for the edge flange) a bend of 180° and a flat piece folded back over the sheet, `length` long after the bend, with
 * `gap` between the two layers (so the inside radius of the bend is half of it); a closed hem is a small gap. `position` and `flip` as for the edge flange.
 */
export interface HemFeature extends FeatureBase {
  type: 'hem';
  edge: Ref;
  length: Expr;
  gap: Expr;
  position?: 'materialInside' | 'bendOutside';
  flip?: boolean;
  /**
   * The flange stops short of the ends of the edge (v39, C11.4): `start` from the end where the edge begins when it is walked with the face it is on in front of you and the outside
   * on your right, `end` from the other. Where it stops short, `relief` cuts a rectangular notch into the sheet beside it, `width` along the edge and `depth` deeper than the bend starts,
   * so that the bend can form without tearing the sheet next to it (`shape` as for the edge flange).
   */
  inset?: { start: Expr; end: Expr };
  relief?: { width: Expr; depth: Expr; shape?: ReliefShape };
}

/**
 * Snap hook (卡榫, C4.11, v35): at the free points of a sketch, a cantilever beam standing on the sketch plane and growing `length` along its normal (`reverse`: the other
 * way), `thickness` thick in the direction `angle` (0° is the sketch's x) and `width` wide across it, with a wedge at its free end: `hookHeight` of the beam's end, standing
 * out `hookDepth` from its front, flat on the side toward the base (the catch face), sloped on the tip side (the lead-in). The beam runs a little into the body it stands on.
 */
export interface SnapHookFeature extends FeatureBase {
  type: 'snapHook';
  sketch: Id;
  width: Expr;
  thickness: Expr;
  length: Expr;
  hookHeight: Expr;
  hookDepth: Expr;
  angle?: Expr;
  reverse?: boolean;
  /**
   * The window under the hook (v44), as an option of the hook: a rectangle in the body it stands on, from the front of the beam as far as the tip of the hook and `windowClearance`
   * beyond it, `windowClearance` beyond each side of the hook, cut `windowDepth` into the body from the sketch plane. Both are present, or neither (no window).
   */
  windowClearance?: Expr;
  windowDepth?: Expr;
}

/**
 * Snap catch (卡榫的窗, C4.11, v35): at the free points of a sketch, a rectangular window `length` long in the direction `angle` and `width` across it, cut `depth` into the body
 * from the sketch plane (against its normal; `reverse`: along it). The size is typed in (the hook's width and depth plus the clearance the process needs).
 */
export interface SnapCatchFeature extends FeatureBase {
  type: 'snapCatch';
  sketch: Id;
  length: Expr;
  width: Expr;
  depth: Expr;
  angle?: Expr;
  reverse?: boolean;
}

/**
 * Vent (排氣口, C4.11, v35): at the free points of a sketch, a row of `count` slots, each `length` long in the direction `angle` and `width` across it (round-ended with
 * `rounded`), `pitch` apart from center to center across `angle`, the row centered on the point; cut `depth` into the body from the sketch plane.
 */
export interface VentFeature extends FeatureBase {
  type: 'vent';
  sketch: Id;
  count: Expr;
  pitch: Expr;
  length: Expr;
  width: Expr;
  depth: Expr;
  angle?: Expr;
  rounded?: boolean;
  reverse?: boolean;
}

/**
 * Shell (薄殼, C5.4, v15): the body hollowed out to a wall of thickness, the picked faces taken away to open it; the wall grows inward, or
 * outward with outward.
 */
export interface ShellFeature extends FeatureBase {
  type: 'shell';
  faces: Ref[];
  thickness: Expr;
  outward?: boolean;
  /**
   * Walls of another thickness (不等殼厚, C5.4, v32): a face of the body that stays, and how thick the wall behind it is instead of `thickness`. A planar face only. It is made
   * as a shell of `thickness` and then the inner face that lies against that face moved (`Kernel.moveFace`), so the wall there is `thickness` of this list; a thicker one
   * must still fit in the body.
   */
  faceThickness?: { face: Ref; thickness: Expr }[];
}

/**
 * Draft (拔模, C5.5, v16): the walls' faces lean by angle about the neutral plane 
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

/**
 * Split feature (分割實體, C7.4, v59): splits bodies by a datum plane or planar face.
 */
export interface SplitFeature extends FeatureBase {
  type: 'split';
  /** The cutting tool: a datum plane or planar face reference. */
  tool: Ref;
  /** Target bodies to split. When absent or empty, splits all intersecting bodies. */
  targets?: Ref[];
}

/**
 * Move/Copy Body feature (移動/複製本體, C7.3, v63): translates or rotates bodies, optionally copying them.
 */
export interface MoveCopyBodyFeature extends FeatureBase {
  type: 'moveCopyBody';
  /** Target bodies to move or copy. */
  targets: Ref[];
  /** Translation vector along X in mm (expression string). */
  dx?: Expr;
  /** Translation vector along Y in mm (expression string). */
  dy?: Expr;
  /** Translation vector along Z in mm (expression string). */
  dz?: Expr;
  /** Rotation axis: principal axis ('x' | 'y' | 'z') or reference. */
  rotationAxis?: Ref | 'x' | 'y' | 'z';
  /** Rotation angle expression string (e.g. '90deg'). */
  rotationAngle?: Expr;
  /** Whether to copy the body (true = keep original and produce copy; false = move original). Default false. */
  copy?: boolean;
}

/**
 * Delete/Keep Body feature (刪除/保留本體, C7.3, v64): deletes or keeps specified bodies.
 */
export interface DeleteKeepBodyFeature extends FeatureBase {
  type: 'deleteKeepBody';
  /** Operation mode: 'delete' (blacklist) or 'keep' (whitelist). Default 'delete'. */
  mode: 'delete' | 'keep';
  /** Target bodies to delete or keep. */
  targets: Ref[];
}

export type Feature =
  | SpurGearFeature
  | RackFeature
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
  | MutualTrimFeature
  | ExtendSurfaceFeature
  | ThickenFeature
  | LipGrooveFeature
  | ScrewBossFeature
  | SheetUnfoldFeature
  | SheetRefoldFeature
  | BaseFlangeFeature
  | MidBendFeature
  | EdgeFlangeFeature
  | BreakCornerFeature
  | HemFeature
  | SnapHookFeature
  | SnapCatchFeature
  | VentFeature
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
  | CombineFeature
  | SplitFeature
  | MoveCopyBodyFeature
  | DeleteKeepBodyFeature
  | JogFeature
  | ThreadFeature
  | KnurlFeature
  | CosmeticThreadFeature
  | HelixFeature
  | ProjectedCurveFeature
  | RuledSurfaceFeature
  | RadiatedSurfaceFeature
  | ReplaceFaceFeature;
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
  kind: 'step' | 'png' | 'jpg';
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

/**
 * One row of the gauge table of a sheet metal part (量規表, C11.1, v40): a name, the thickness, the inside bend radius and the K-factor (mm, and a number) the shop uses for it.
 * Applying a row to a base flange copies its numbers into the base flange; they are not linked (a row changed later changes no feature).
 */
export interface SheetGauge {
  name: string;
  thickness: number;
  radius: number;
  kFactor: number;
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
  /** The gauge table of a sheet metal part (C11.1, v40): absent until a row is added. */
  sheetGauges?: SheetGauge[];
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
export const ASSEMBLY_SCHEMA_VERSION = 7;

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

/**
 * One exploded view of the assembly (C15.14, v7): a name and its steps in the order they were made. An assembly can have several (one to show how it goes together,
 * one to take it apart …); the one that is `activeExplosion` is the one the view shows when it is exploded and the one the steps are made in.
 */
export interface ExplodeView {
  id: Id;
  /** 「爆炸視圖1」 … */
  name: string;
  steps: ExplodeStep[];
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
  /** The exploded views (C15.14, v7), each with its steps in the order they were made. Absent: none. (Before v7 there was one list of steps, `explosion`; it is the first view of an older file.) */
  explosions?: ExplodeView[];
  /** The one of `explosions` that is shown and made; absent when there is none (or, as a file written by hand, the first). */
  activeExplosion?: Id;
  /** As in parts (B1.3): ids are never reused. */
  idCounters: Record<string, number>;
}
