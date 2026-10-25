import { t } from '@3db/i18n';
import { validThreadTolerance } from './threadTolerance';
import { current, produce, type Draft } from 'immer';
import { countersFor, type Id } from './ids';
import type { SpurGearFeature, RackFeature, SheetGauge, AppearanceTarget, DocSettings, MaterialRef, Variable, BlobRef, ChamferFeature, FilletKind, FilletVariablePoint, CombineFeature, SplitFeature, MoveCopyBodyFeature, JogFeature, HoleFeature, ScrewBossFeature, BaseFlangeFeature, MidBendFeature, EdgeFlangeFeature, HemFeature, BreakCornerFeature, SnapHookFeature, SnapCatchFeature, VentFeature, LoftFeature, RibFeature, SweepFeature, Draft as WallDraft, EndCondition, Thin, Expr, Feature, ImportedBodyFeature, AxisDefinition, CoordSysFeature, MirrorFeature, PartDoc, PatternDefinition, PatternFeature, PlaneDefinition, PointDefinition, Ref, RevolveCondition, SketchConstraint, SketchEntity, SketchFeature, SketchPicture, CutWithSurfaceFeature, ThreadFeature, KnurlFeature, CosmeticThreadFeature, HelixFeature, ProjectedCurveFeature, RuledSurfaceFeature, RadiatedSurfaceFeature, ReplaceFaceFeature, SketchAttach } from './schema';
import { isSketchAxis } from './schema';
import { isDatumPlaneName } from './datums';
import { canBeSeed } from './patterns';
import { colorOk, materialOk, sameTarget } from './materials';
import { isFilePath } from './paths';
import { DOWEL_FITS } from './dowel';
import { mapRefs } from './refs';
import { bodyFeature, isBodyKey, isHideable } from './visibility';
import { dimensionName, roleProblem, Parameters, renameInDoc, resolveDoc, variableUsers, type ExprKind } from './params';
import type { NameRef } from './expr';
import { isDimension } from './schema';
import { ExprError } from './expr';
import { idsInUse, removalSet, sketchError } from './sketch-rules';
import { pictureBlobs } from './picture';

/** The point references of a curve that an edit may change (an ellipse's `major` and a spline's `points` since ADR 0178). */
export type EntityRefs = Partial<Record<'p1' | 'p2' | 'start' | 'end' | 'center' | 'at' | 'major', Id>> & { points?: Id[] };
/** The references of a relation or dimension that an edit may change (`undefined` takes one away: the optional second reference). */
export type ConstraintRefs = Partial<Record<'a' | 'b' | 'point' | 'line' | 'curve' | 'axis' | 'circle' | 'entity', Id | undefined>> & {points?:Id[]};

/**
 * Where an entity now is (ADR 0178, 移動／旋轉／縮放圖元): a point's place, a circle's radius, an ellipse's minor radius, a text's size and turn (degrees).
 * Each field only for the entity that has it; the values are checked like any stored sketch.
 */
export interface SketchPlacement {
  id: Id;
  x?: number;
  y?: number;
  radius?: number;
  minorRadius?: number;
  size?: number;
  angle?: number;
}

/** What `editSketch` does to a sketch, in this order: `entities`, `constraints`, `place`, `add`, `remove`. */
export interface SketchEdit {
  /** Entities whose points change (a line that now ends elsewhere). */
  entities?: { id: Id; set: EntityRefs }[];
  /** Relations and dimensions that now refer to something else, or whose value changes. */
  constraints?: { id: Id; set: ConstraintRefs & { value?: Expr; majorRadius?:Expr; minorRadius?:Expr; labelPosition?: [number, number] } }[];
  /** Entities that are now somewhere else (ADR 0178). */
  place?: SketchPlacement[];
  /** Deleted together with whatever depends on them. */
  remove?: Id[];
  add?: { entities: SketchEntity[]; constraints: SketchConstraint[] };
}

export interface PointPosition {
  id: Id;
  x: number;
  y: number;
}

export interface CircleRadius {
  id: Id;
  radius: number;
}

/**
 * Document commands (B7.1): the only way to change the SSOT.
 * UI, scripts, macro recording and future collaboration all go through this layer.
 * New objects carry their ids in the command, so applying a command stays a pure function.
 */
export type Command =
  /** Inserts a feature at `index` (at or above the rollback bar), like SolidWorks inserting at the bar. */
  | { type: 'insertFeature'; feature: Feature; index: number }
  | { type:'applySketchFix'; featureId:Id; changes:{id:Id;kind:'delete'|'driven'}[] }
  | { type:'setEllipseAxes'; featureId:Id; constraintId:Id; majorRadius:Expr; minorRadius:Expr }
  | { type: 'setLengthRatio'; featureId:Id; constraintId:Id; ratio:Expr }
  | { type: 'setDimension'; featureId: Id; constraintId: Id; value: Expr }
  /** Moves only the displayed dimension text; it never changes the measured geometry or value. */
  | { type: 'setDimensionPosition'; featureId: Id; constraintId: Id; position: [number, number] | null }
  /** Makes a dimension driven (a reference that shows what is measured) or driving again; `value` is the new value when it drives again (C1.29). */
  | { type: 'setDimensionDriving'; featureId: Id; constraintId: Id; driving: boolean; value?: Expr }
  /** Measures a distance to or between circles and arcs to their nearest or farthest points, or from the center again (`null`); `value` is what is measured under the new condition, so the sketch stays where it is (ADR 0183). */
  | { type: 'setDistanceCondition'; featureId: Id; constraintId: Id; condition: 'min' | 'max' | null; value?: Expr }
  /** 
ull removes direction 2 (and its draft). */
  | { type: 'setEndCondition'; featureId: Id; dir: 'dir1' | 'dir2'; value: EndCondition | null }
  /** The draft of one direction of an extrusion; 
ull removes it. */
  | { type: 'setDraft'; featureId: Id; dir: 'dir1' | 'dir2'; draft: WallDraft | null }
  /** Makes an extrusion or a revolution a thin feature, or a solid one again (
ull). */
  | { type: 'setThin'; featureId: Id; thin: Thin | null }
  | { type: 'setRevolveCondition'; featureId: Id; value: RevolveCondition }
  | { type: 'setRevolveAxis'; featureId: Id; axis: Id }
  /** The sketch whose path a sweep follows (C4.4). */
  | { type: 'setSweepPath'; featureId: Id; path: Id }
  /** The sketches of a loft's sections, in order (C4.5). */
  | { type: 'setLoftSections'; featureId: Id; sections: Id[] }
  | {type:'setGear';featureId:Id;params:Partial<Omit<SpurGearFeature,'id'|'type'|'name'|'suppressed'>>|Partial<Omit<RackFeature,'id'|'type'|'name'|'suppressed'>>}
  | { type: 'setFilletRadius'; featureId: Id; value: Expr }
  /** Edges of an edge-based feature (fillet, chamfer). */
  | { type: 'setEdges'; featureId: Id; edges: Ref[]; faces?: Ref[] }
  /** The kind of a fillet and the groups of faces it takes (face fillet: two groups; full round: two sides and a center); each group left out or empty is taken away. */
  | { type: 'setFilletSets'; featureId: Id; kind: FilletKind; faces?: Ref[]; faces2?: Ref[]; center?: Ref[] }
  /** The control points of a variable-radius fillet (C5.2, ADR 0167); an empty list takes the feature back to its constant radius. */
  | { type: 'setFilletVariable'; featureId: Id; points: FilletVariablePoint[] }
  | { type: 'setChamfer'; featureId: Id; value: Pick<ChamferFeature, 'mode' | 'distance' | 'second' | 'flip'> }
  /** The hole wizard's settings (C4.8): everything but which sketch it drills at. */
  | { type: 'setHole'; featureId: Id; hole: Omit<HoleFeature, 'id' | 'type' | 'name' | 'suppressed' | 'sketch'> }
  /** A rib's thickness, where it goes, and which way it grows (C4.7). */
  | { type: 'setRib'; featureId: Id; rib: Omit<RibFeature, 'id' | 'type' | 'name' | 'suppressed' | 'sketch'> }
  /** A thread's parameters (C4.8). */
  | { type: 'setThread'; featureId: Id; params: Partial<Omit<ThreadFeature, 'id' | 'type' | 'name' | 'suppressed'>> }
  /** A knurl's parameters (ADR 0124): everything but which axis it is on. */
  | { type: 'setKnurl'; featureId: Id; knurl: Partial<Omit<KnurlFeature, 'id' | 'type' | 'name' | 'suppressed' | 'axis'>> & { axis?: Ref } }
  /** A cosmetic thread's parameters (C4.9, ADR 0156). */
  | { type: 'setCosmeticThread'; featureId: Id; params: Partial<Omit<CosmeticThreadFeature, 'id' | 'type' | 'name' | 'suppressed'>> }
  /** A helix/spiral curve's parameters (C8.3, ADR 0168). */
  | { type:'setSurfaceTools'; featureId:Id; params:Partial<Omit<RuledSurfaceFeature,'id'|'type'|'name'|'suppressed'>> | Partial<Omit<RadiatedSurfaceFeature,'id'|'type'|'name'|'suppressed'>> | Partial<Omit<ReplaceFaceFeature,'id'|'type'|'name'|'suppressed'>> }
  | { type: 'setProjectedCurve'; featureId: Id; params: Partial<Omit<ProjectedCurveFeature, 'id' | 'type' | 'name' | 'suppressed'>> }
  | { type: 'setHelix'; featureId: Id; params: Partial<Omit<HelixFeature, 'id' | 'type' | 'name' | 'suppressed'>> }
  /** What a draft leans and about which plane (C5.5). */
  | { type: 'setDraftFeature'; featureId: Id; neutral: Ref; faces: Ref[]; angle: Expr; reverse?: boolean }
  /** What a shell takes away and how thick the wall is (C5.4). */
  /** `faceThickness`: the walls of another thickness (C5.4); left as it is when absent, taken away when empty. */
  | { type: 'setShell'; featureId: Id; faces: Ref[]; thickness: Expr; outward?: boolean; faceThickness?: { face: Ref; thickness: Expr }[] }
  /** Changes an offset surface (C9.2): the faces, the distance, and how it goes round a corner of the region (absent: rounded). */
  | { type: 'setOffsetSurface'; featureId: Id; faces: Ref[]; distance: Expr; join?: 'arc' | 'intersection' }
  /** Changes a split line (C8.1): the sketch, the face it is projected on, the way round and whether it goes through all. */
  | { type: 'setSplitLine'; featureId: Id; sketch: Id; face: Ref; reverse?: boolean; throughAll?: boolean }
  /** Changes a knit (C9.3): the bodies sewn, the tolerance (absent: the default) and whether a closed result becomes a solid (absent: it does). */
  | { type: 'setKnit'; featureId: Id; bodies: Ref[]; tolerance?: Expr; solid?: boolean }
  /** Changes a fill surface (C9.2): the edges of the boundary and how the patch meets the faces beside them (absent: tangent). */
  | { type: 'setFillSurface'; featureId: Id; edges: Ref[]; continuity?: 'contact' }
  /** Changes a flat surface (C9.2): the edges of the loop. */
  | { type: 'setFlatSurface'; featureId: Id; edges: Ref[] }
  /** Changes a trim surface (C9.3): the sketch, the face, what is kept (absent: the inside), the way round and whether through all. */
  | { type: 'setTrimSurface'; featureId: Id; sketch: Id; face: Ref; keep?: 'outside'; reverse?: boolean; throughAll?: boolean }
  /** Changes an extend surface (C9.3): the edges to extend past and by how much. */
  | { type: 'setExtendSurface'; featureId: Id; edges: Ref[]; distance: Expr }
  /** The screw boss's settings (C4.11): everything but which sketch it stands at. */
  | { type: 'setScrewBoss'; featureId: Id; boss: Omit<ScrewBossFeature, 'id' | 'type' | 'name' | 'suppressed' | 'sketch'> }
  /** The base flange's settings (C11.1): everything but which sketch it is made from. */
  /** Changes a mid bend (S-3): the angle, the radius, which side stays and which way it folds. */
  | { type: 'setMidBend'; featureId: Id; midBend: Omit<MidBendFeature, 'id' | 'type' | 'name' | 'suppressed' | 'sketch'> }
  /** Changes a jog (C11.3, ADR 0159): the offset, the angle, the radius, which side stays and which way it folds. */
  | { type: 'setJog'; featureId: Id; jog: Omit<JogFeature, 'id' | 'type' | 'name' | 'suppressed' | 'sketch'> }
  | { type: 'setBaseFlange'; featureId: Id; flange: Omit<BaseFlangeFeature, 'id' | 'type' | 'name' | 'suppressed' | 'sketch'> }
  /** The edge flange's settings (C11.2): the edge and everything else. */
  | { type: 'setEdgeFlange'; featureId: Id; flange: Omit<EdgeFlangeFeature, 'id' | 'type' | 'name' | 'suppressed'> }
  | { type: 'setBreakCorner'; featureId: Id; corners: Ref[]; kind: BreakCornerFeature['kind']; size: Expr }
  /** The hem's settings (C11.2): the edge and everything else. */
  | { type: 'setHem'; featureId: Id; hem: Omit<HemFeature, 'id' | 'type' | 'name' | 'suppressed'> }
  /** The snap hook's, the catch window's and the vent's settings (C4.11): everything but which sketch they stand at. */
  | { type: 'setSnapHook'; featureId: Id; hook: Omit<SnapHookFeature, 'id' | 'type' | 'name' | 'suppressed' | 'sketch'> }
  | { type: 'setSnapCatch'; featureId: Id; window: Omit<SnapCatchFeature, 'id' | 'type' | 'name' | 'suppressed' | 'sketch'> }
  | { type: 'setVent'; featureId: Id; vent: Omit<VentFeature, 'id' | 'type' | 'name' | 'suppressed' | 'sketch'> }
  /** Changes a lip or groove (C4.11): the planar face, which of the two, how far in from the edge, how wide and how high (deep). */
  | { type: 'setLipGroove'; featureId: Id; face: Ref; kind: 'lip' | 'groove'; offset: Expr; width: Expr; height: Expr }
  /** Changes a thicken (C9.4): the surface body and the thickness (negative: the other way). */
  /** Changes a mutual trim (P-3): the two surface bodies and the pieces taken away (absent: none). */
  | { type: 'setMutualTrim'; featureId: Id; a: Ref; b: Ref; discard?: Ref[] }
  | { type: 'setThicken'; featureId: Id; body: Ref; thickness: Expr; both?: boolean; keepSurface?: boolean }
  /** Changes a cut with surface (C9.4): the solid, the surface, the plane whose normal is the way of the sweep, and whether it goes the other way. */
  | { type: 'setCutWithSurface'; featureId: Id; target: Ref; surface: Ref; direction: CutWithSurfaceFeature['direction']; reverse?: boolean; keep?: 'behind' | 'ahead' }
  /** Faces of a Delete Face feature (C10.2), and whether the rest of a hole goes with them. */
  | { type: 'setFaces'; featureId: Id; faces: Ref[]; hole?: boolean }
  /** How an imported body's surfaces are sewn (F2.2); without `sewTolerance` the default is used again. */
  | { type: 'setImportOptions'; featureId: Id; sewTolerance?: Expr }
  /** How a boss joins the bodies it touches (C7.1): merged with them (the default), or a body of its own. */
  | { type: 'setMerge'; featureId: Id; merge: boolean }
  /** The contours of its sketch a boss or cut uses (C1.34): each is the ids of the entities bounding one region; `null` is all of them. */
  | { type: 'setContours'; featureId: Id; contours: Id[][] | null }
  /** What a Combine feature does to which bodies (C7.2). */
  | { type: 'setCombine'; featureId: Id; op: CombineFeature['op']; main: Ref; tools: Ref[] }
  /** The cutting tool and target bodies of a Split feature (C7.4, v59). */
  | { type: 'setSplit'; featureId: Id; tool: Ref; targets?: Ref[] }
  /** The targets, displacement and rotation of a Move/Copy Body feature (C7.3, v63). */
  | { type: 'setMoveCopyBody'; featureId: Id; targets: Ref[]; dx?: Expr; dy?: Expr; dz?: Expr; rotationAxis?: Ref | 'x' | 'y' | 'z'; rotationAngle?: Expr; copy?: boolean }
  /** The operation mode and target bodies of a Delete/Keep Body feature (C7.3, v64). */
  | { type: 'setDeleteKeepBody'; featureId: Id; mode: 'delete' | 'keep'; targets: Ref[] }
  /** The name and the reference flag of a body (C7.1); an empty name or `false` takes the choice back. */
  | { type: 'setBody'; bodyId: Id; name?: string; reference?: boolean }
  /** The face and the distance of a Move Face feature (C10.1). */
  | { type: 'setMoveFace'; featureId: Id; face: Ref; distance: Expr }
  | { type: 'setRefPlane'; featureId: Id; def: PlaneDefinition }
  /** How a reference axis (C3.3), a reference point (C3.5) or a coordinate system (C3.4) is defined. */
  | { type: 'setRefAxis'; featureId: Id; def: AxisDefinition }
  | { type: 'setRefPoint'; featureId: Id; def: PointDefinition }
  /** What a pattern repeats and how (C6.1, C6.2); `skip` names the instances to leave out. */
  | { type: 'setPattern'; featureId: Id; seeds: Id[]; def: PatternDefinition; skip?: string[] }
  /** What a mirror reflects and across what (C6.3). */
  | { type: 'setMirror'; featureId: Id; value: Pick<MirrorFeature, 'target' | 'plane' | 'seeds' | 'bodies' | 'merge'> }
  | { type: 'setCoordSys'; featureId: Id; value: Pick<CoordSysFeature, 'origin' | 'x' | 'y' | 'flipX' | 'flipY'> }
  /** Adds imported data and the feature that uses it, as one step (F2.1). */
  | { type: 'importBody'; blob: BlobRef; feature: ImportedBodyFeature; index: number }
  /** A picture laid in a sketch (ADR 0116): its image data comes with it (a blob of kind png or jpg, the same one for pictures with the same bytes). */
  | { type: 'addSketchPicture'; featureId: Id; blob: BlobRef; picture: SketchPicture }
  /** Changes the placement of a picture of a sketch. */
  | { type: 'setSketchPicture'; featureId: Id; pictureId: Id; picture: Partial<Omit<SketchPicture, 'id' | 'blob'>> }
  /** Takes a picture out of a sketch (its data goes with it when nothing else uses it). */
  | { type: 'removeSketchPicture'; featureId: Id; pictureId: Id }
  /** Suppresses or unsuppresses several features at once; which ones follows from their dependencies (B2.6). */
  | { type: 'setSuppressed'; featureIds: Id[]; value: boolean }
  /** Deletes features (B2.8). Their ids stay issued; references to them become missing, never rebound. */
  | { type: 'deleteFeatures'; featureIds: Id[] }
  | { type: 'renameFeature'; featureId: Id; name: string }
  /**
   * The history put in another order (B2.5), and, at the same time, which features are in which folder (D1.7; `null` takes a feature out). `order` has every
   * feature once; those before the rollback bar stay before it. Whether a feature still comes after the ones it depends on is for the caller to see
   * (`orderProblem`): the rebuild reports what is left wrong.
   */
  | { type: 'arrange'; order: Id[]; folders?: Record<Id, string | null> }
  /** A note and a label on a feature (D1.7); an empty text takes it away. */
  | { type: 'setFeatureNote'; featureId: Id; comment?: string; tag?: string }
  | { type: 'setRollback'; index: number | null }
  /** Changes the plane or planar face a sketch lies in (SolidWorks 「編輯草圖基準面」). */
  | { type: 'redefineSketchPlane'; featureId: Id; plane: Ref }
  /** Takes the origin and the x direction of a sketch from the model (ADR 0181); `null` takes the attachment away. */
  | { type: 'setSketchAttach'; featureId: Id; attach: SketchAttach | null }
  /** Sketch editing (C1): add geometry together with its relations and dimensions. */
  | { type: 'addSketchItems'; featureId: Id; entities: SketchEntity[]; constraints: SketchConstraint[] }
  /**
   * One edit of a sketch that changes things already there (a fillet shortens two lines, a trim moves the end of one): the
   * references of existing entities and relations are changed, then `remove` is deleted with what depends on it
   * (see removalSet), then `add` is added. One command, so one undo step.
   */
  | ({ type: 'editSketch'; featureId: Id } & SketchEdit)
  /** Deletes entities, relations or dimensions, and whatever depends on them (see removalSet). */
  | { type: 'removeSketchItems'; featureId: Id; ids: Id[] }
  /** Stores placement intent: where points are and how big circles are (e.g. after a drag). */
  | { type: 'setSketchGeometry'; featureId: Id; points: PointPosition[]; radii?: CircleRadius[] }
  /** Changes the properties of a sketch text entity (text, size, angle, align, bold, italic). */
  | { type: 'setSketchText'; featureId: Id; entityId: Id; text?: string; size?: number; angle?: number; align?: 'left' | 'center' | 'right'; bold?: boolean; italic?: boolean; font?: string; construction?: boolean }
  | { type: 'setConstruction'; featureId: Id; ids: Id[]; value: boolean }
  /** Shows or hides sketches, reference planes, default planes or the origin (D4.6). */
  | { type: 'setVisibility'; keys: string[]; value: boolean }
  /**
   * Points the reference `from` of a feature at another element `to` of the same kind (B4.3), after it
   * stopped resolving. Only that reference changes; the feature is not rebuilt differently in any other way.
   */
  | { type: 'replaceRef'; featureId: Id; from: Ref; to: Ref }
  /** Global variables (B5.2): a name and an expression. New ids come in the command, as everywhere. */
  | { type: 'addVariable'; variable: Variable }
  /** Renaming rewrites every expression that uses the name; a new expression must not make a cycle. */
  | { type: 'setVariable'; id: Id; name?: string; expr?: Expr }
  /** Refused while an expression still uses the variable. */
  | { type: 'deleteVariable'; id: Id }
  /** File properties (B8.3): free text by name, e.g. a vendor or a part number. */
  | { type: 'setProperty'; name: string; value: string }
  /** The material of the part (C14.1); `null` takes it away. */
  | { type: 'setMaterial'; material: MaterialRef | null }
  /** The gauge table of a sheet metal part (C11.1): all its rows; an empty list takes it away. */
  | { type: 'setSheetGauges'; gauges: SheetGauge[] }
  /** The color of a part, body, feature or face (C14.2); `null` takes the color of that target away. */
  | { type: 'setAppearance'; target: AppearanceTarget; color: string | null }
  /** Document settings (B8.4): the ones given are changed. */
  | { type: 'setSettings'; settings: Partial<DocSettings> }
  | { type: 'deleteProperty'; name: string }
  /** Names a dimension of a sketch (`寬度@草圖1`); expressions that used the old name follow. An empty label goes back to `D<n>`. */
  | { type: 'setDimensionLabel'; featureId: Id; constraintId: Id; label: string };

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

function feature(draft: Draft<PartDoc>, id: Id): Draft<Feature> {
  const f = draft.features.find((x) => x.id === id);
  if (!f) throw new CommandError(t('cmd.featureNotFound', { id }));
  return f;
}

function sketchOf(draft: Draft<PartDoc>, id: Id): Draft<SketchFeature> {
  const f = feature(draft, id);
  if (f.type !== 'sketch') throw new CommandError(t('cmd.onlySketchEditable'));
  return f;
}

/** The number an expression stands for in this document; what is wrong with it is the command's error. */
function valueOf(p: Parameters, expr: Expr, kind: ExprKind): number {
  try {
    return p.evaluate(expr, kind);
  } catch (e) {
    throw new CommandError(e instanceof ExprError ? e.message : String(e));
  }
}

const positive = (p: Parameters, expr: Expr) => {
  if (!(valueOf(p, expr, 'length') > 0)) throw new CommandError(t('cmd.mustBePositive', { value: expr }));
};

/**
 * Every expression a feature holds must evaluate in this document (variables, dimensions of other sketches,
 * file properties, no cycle) and be a sensible value: the checks a value had before expressions existed,
 * now on what the expression comes to. `only` limits a sketch to some of its dimensions.
 */
function checkExprs(doc: PartDoc, f: Feature, only?: Set<Id>): void {
  const p = new Parameters(doc);
  switch (f.type) {
    case 'sketch':
      for (const c of f.constraints) {
        if(only&&!only.has(c.id))continue;
        if(c.type==='ellipseAxes'){const a=valueOf(p,c.majorRadius,'length'),b=valueOf(p,c.minorRadius,'length');if(!(Number.isFinite(a)&&Number.isFinite(b)&&b>=1e-6&&a>b+1e-6&&a<=1e6&&a/b<=1e4))throw new CommandError(t('sketch.ellipseAxesInvalid'));continue;}
        if(c.type==='lengthRatio'){const v=valueOf(p,c.ratio,'count'),problem=roleProblem(v,'lengthRatio',c.ratio);if(problem)throw new CommandError(problem);continue;}
        if (!isDimension(c)) continue;
        if (c.type === 'angle') valueOf(p, c.value, 'angle');
        else positive(p, c.value);
      }
      return;
    default: {
      const { problem } = p.resolve(f);
      if (problem) throw new CommandError(problem);
    }
  }
}

function endCondition(value: EndCondition): void {
  if ((value.type === 'upToFace' || value.type === 'offsetFromFace') && value.face.kind !== 'face') throw new CommandError(t('cmd.upToFaceNeedsFace'));
  if (value.type === 'upToVertex' && value.vertex.kind !== 'vertex') throw new CommandError(t('cmd.upToVertexNeedsVertex'));
  if (value.type === 'upToBody' && value.body.kind !== 'body') throw new CommandError(t('cmd.upToBodyNeedsBody'));
}

/** The feature's sketch must come earlier in the history. */
function sketchBefore(doc: PartDoc, sketchId: Id, index: number, label: string): SketchFeature {
  const at = doc.features.findIndex((x) => x.id === sketchId);
  const s = doc.features[at];
  if (at < 0 || at >= index || s?.type !== 'sketch') throw new CommandError(t('cmd.needsEarlierSketch', { feature: label }));
  return s;
}

/** A reference to a feature of the history that makes `type` of datum (a plane, an axis, a point), made before the one at `index`. */
function datumFeature(doc: PartDoc, ref: Ref, index: number, type: 'refPlane' | 'refAxis' | 'refPoint' | 'coordSys'): void {
  const at = doc.features.findIndex((f) => f.id === ref.name);
  if (at < 0 || at >= index || doc.features[at]!.type !== type) throw new CommandError(t(`cmd.${type}MustBeEarlier`));
}

/** A plane reference names a default plane, a reference plane or a coordinate system earlier in the history, or a model face. */
function planeRef(doc: PartDoc, ref: Ref, index: number): void {
  if (ref.kind === 'face') return;
  if (ref.kind !== 'datum') throw new CommandError(t('cmd.mustPickPlane'));
  if (isDatumPlaneName(ref.name)) return;
  const at = doc.features.findIndex((f) => f.id === ref.name);
  if (at >= 0 && doc.features[at]!.type === 'coordSys') return datumFeature(doc, ref, index, 'coordSys');
  datumFeature(doc, ref, index, 'refPlane');
}

/** An axis reference names a straight model edge or a reference axis earlier in the history. The box may still be empty while the user picks. */
function axisRef(doc: PartDoc, ref: Ref, index: number): void {
  if (ref.kind === 'edge') return;
  if (ref.kind !== 'datum') throw new CommandError(t('cmd.axisMustBeStraightEdge'));
  datumFeature(doc, ref, index, 'refAxis');
}

/** A point reference names a model vertex or a reference point earlier in the history. */
function pointRef(doc: PartDoc, ref: Ref, index: number): void {
  if (ref.kind === 'vertex') return;
  if (ref.kind !== 'datum') throw new CommandError(t('cmd.mustPickPoint'));
  datumFeature(doc, ref, index, 'refPoint');
}

/**
 * What a sketch takes its origin and x direction from (ADR 0181): a model vertex or a reference point, a straight model edge or a reference axis, the
 * datums made before the sketch. An attachment holds something: `null` takes it away, an empty one is refused rather than kept as nothing.
 */
function sketchAttachRefs(doc: PartDoc, a: SketchAttach, index: number): void {
  if (!a.origin && !a.x && !a.flipX) throw new CommandError(t('cmd.sketchAttachEmpty'));
  if (a.origin) pointRef(doc, a.origin, index);
  if (a.x) axisRef(doc, a.x, index);
}

/**
 * Structure of a reference plane definition (C3.2). References may still be empty while the user
 * picks them in the PropertyManager; the rebuild reports what is missing.
 */
function planeDefinition(doc: PartDoc, def: PlaneDefinition, index: number): void {
  switch (def.mode) {
    case 'offset':
      planeRef(doc, def.plane, index);
      return;
    case 'angle':
      planeRef(doc, def.plane, index);
      axisRef(doc, def.axis, index);
      return;
    case 'threePoint':
      if (def.points.length > 3) throw new CommandError(t('cmd.threePointNeedsVertices'));
      for (const p of def.points) pointRef(doc, p, index);
      return;
    case 'parallel':
      planeRef(doc, def.plane, index);
      pointRef(doc, def.point, index);
      return;
    case 'perpendicular':
      axisRef(doc, def.axis, index);
      pointRef(doc, def.point, index);
      return;
    case 'midplane':
      planeRef(doc, def.plane, index);
      planeRef(doc, def.plane2, index);
      return;
    case 'tangent':
      planeRef(doc, def.plane, index);
      if (def.face.kind !== 'face') throw new CommandError(t('cmd.tangentNeedsFace'));
      return;
    case 'normalToCurve':
      if (def.curve.kind !== 'edge') throw new CommandError(t('cmd.normalToCurveNeedsEdge'));
      pointRef(doc, def.point, index);
      return;
  }
}

/** Structure of a reference axis definition (C3.3). */
function axisDefinition(doc: PartDoc, def: AxisDefinition, index: number): void {
  switch (def.mode) {
    case 'edge':
      if (def.edge.kind !== 'edge') throw new CommandError(t('cmd.axisMustBeStraightEdge'));
      return;
    case 'twoPoints':
      if (def.points.length > 2) throw new CommandError(t('cmd.twoPointsNeedsTwo'));
      for (const p of def.points) pointRef(doc, p, index);
      return;
    case 'cylinder':
      if (def.face.kind !== 'face') throw new CommandError(t('cmd.axisNeedsFace'));
      return;
    case 'planes':
      planeRef(doc, def.plane, index);
      planeRef(doc, def.plane2, index);
      return;
  }
}

/** Structure of a reference point definition (C3.5). */
function pointDefinition(doc: PartDoc, def: PointDefinition, index: number): void {
  switch (def.mode) {
    case 'coords':
      return;
    case 'center':
      if (def.element.kind !== 'edge' && def.element.kind !== 'face') throw new CommandError(t('cmd.centerNeedsEdgeOrFace'));
      return;
    case 'axisPlane':
      axisRef(doc, def.axis, index);
      planeRef(doc, def.plane, index);
      return;
  }
}

/** A direction is a straight edge, a reference axis, or a plane (its normal): a model face, a default plane, or a reference plane or axis earlier in the history. */
function directionRef(doc: PartDoc, ref: Ref, index: number): void {
  if (ref.kind === 'face' || (ref.kind === 'datum' && isDatumPlaneName(ref.name))) return;
  if (ref.kind === 'datum') {
    const at = doc.features.find((g) => g.id === ref.name);
    if (!at || doc.features.indexOf(at) >= index || (at.type !== 'refAxis' && at.type !== 'refPlane')) throw new CommandError(t('cmd.datumMustBeEarlier'));
  } else if (ref.kind !== 'edge') throw new CommandError(t('cmd.coordSysDirection'));
}

/** A coordinate system's origin is a point, its two directions are axes or planes (their normals). */
function coordSysRefs(doc: PartDoc, f: Pick<CoordSysFeature, 'origin' | 'x' | 'y'>, index: number): void {
  if (f.origin) pointRef(doc, f.origin, index);
  directionRef(doc, f.x, index);
  directionRef(doc, f.y, index);
}

/** A circular pattern turns about a straight edge, a reference axis, or the axis of a cylindrical face. */
function rotationAxisRef(doc: PartDoc, ref: Ref, index: number): void {
  if (ref.kind === 'face') return;
  axisRef(doc, ref, index);
}

/** A mirror reflects features that are earlier in the history and can be repeated, or bodies; across a plane. */
function mirrorRefs(doc: PartDoc, f: Pick<MirrorFeature, 'target' | 'plane' | 'seeds' | 'bodies'>, index: number): void {
  planeRef(doc, f.plane, index);
  if (f.bodies.some((r) => r.kind !== 'body')) throw new CommandError(t('cmd.combineOnlyBodies'));
  if (f.target === 'features') patternSeeds(doc, f.seeds, index);
}

/** A pattern repeats features that are earlier in the history and can be repeated; which direction and where it turns is for the rebuild to check. */
function patternSeeds(doc: PartDoc, seeds: Id[], index: number): void {
  if (new Set(seeds).size !== seeds.length) throw new CommandError(t('cmd.patternSeedTwice'));
  for (const id of seeds) {
    const at = doc.features.findIndex((g) => g.id === id);
    if (at < 0 || at >= index) throw new CommandError(t('cmd.patternSeedEarlier'));
    if (!canBeSeed(doc.features[at]!)) throw new CommandError(t('cmd.patternSeedType', { name: doc.features[at]!.name }));
  }
}

function patternRefs(doc: PartDoc, f: Pick<PatternFeature, 'seeds' | 'def'>, index: number): void {
  patternSeeds(doc, f.seeds, index);
  if (f.def.mode === 'linear') {
    directionRef(doc, f.def.dir1.ref, index);
    if (f.def.dir2) directionRef(doc, f.def.dir2.ref, index);
  } else if (f.def.mode === 'circular') {
    rotationAxisRef(doc, f.def.axis, index);
  } else if (f.def.mode === 'curve') {
    curvePathRef(doc, f.def.path, index);
  }
}

function curvePathRef(doc: PartDoc, ref: Ref, index: number): void {
  if (ref.kind === 'edge') return;
  if (ref.kind === 'datum') {
    const at = doc.features.find((g) => g.id === ref.name);
    if (!at || doc.features.indexOf(at) >= index || at.type !== 'sketch') throw new CommandError(t('cmd.curvePathMustBeEarlier'));
    return;
  }
  throw new CommandError(t('cmd.curvePathInvalid'));
}

/** A Combine takes bodies, and its main body is not one of its tools. The boxes may still be empty while the user picks. */
function combineRefs(main: Ref, tools: Ref[]): void {
  if ((main.name && main.kind !== 'body') || tools.some((r) => r.kind !== 'body')) throw new CommandError(t('cmd.combineOnlyBodies'));
  if (main.name && tools.some((r) => r.name === main.name)) throw new CommandError(t('cmd.combineMainIsTool'));
}

/** A sweep's profile and path are two different sketches, both earlier in the history. */
function sweepSketches(doc: PartDoc, f: SweepFeature, index: number): void {
  const label = t('feature.sweep');
  sketchBefore(doc, f.sketch, index, label);
  // the path is another sketch, or a helix curve (C8.3) made before the sweep
  const at = doc.features.findIndex((x) => x.id === f.path);
  if (doc.features[at]?.type === 'helix' && at < index) return;
  sketchBefore(doc, f.path, index, label);
  if (f.path === f.sketch) throw new CommandError(t('cmd.sweepPathIsProfile'));
}

/** A loft's sections are different sketches, all earlier in the history (how many is for the rebuild to say: the PropertyManager adds them one by one). */
function loftSections(doc: PartDoc, f: LoftFeature, index: number): void {
  const label = t('feature.loft');
  for (const id of f.sections) sketchBefore(doc, id, index, label);
  if (new Set(f.sections).size !== f.sections.length) throw new CommandError(t('cmd.loftSectionTwice'));
}

/** A line of the sketch, or one of its two axes (ADR 0170). */
/**
 * The reference geometry a sketch's entities follow (ADR 0172) must be earlier in the history than the sketch at `index` (or a default plane or axis of the
 * part), and of a kind the entity can follow: a point a reference point or an axis (where it passes through the plane), a line an axis or a plane.
 */
/**
 * The entities of other sketches a sketch's entities follow (ADR 0175) must be in a sketch earlier than the one at `index`, be there, and be of a kind the
 * entity can follow: a point a point (or, a pierce, a line, circle or arc), a line a line, a circle or an arc a circle or an arc.
 */
function sketchSketchRefs(doc: PartDoc, entities: readonly SketchEntity[], index: number): void {
  for (const e of entities) {
    for (const [ref, pierce] of [[e.type === 'point' ? e.pierce : undefined, true], ['ref' in e ? e.ref : undefined, false]] as const) {
      if (ref?.kind !== 'sketch') continue;
      const [sketchId, entityId] = ref.name.split(':');
      const at = doc.features.findIndex((f) => f.id === sketchId);
      const other = at >= 0 && at < index ? doc.features[at] : undefined;
      const target = other?.type === 'sketch' ? other.entities.find((x) => x.id === entityId) : undefined;
      if (!target) throw new CommandError(t('cmd.sketchRefNotEarlier', { id: e.id, name: ref.name }));
      const curve = target.type === 'line' || target.type === 'circle' || target.type === 'arc';
      const fits = e.type === 'point' ? (pierce ? curve : target.type === 'point') : e.type === 'line' ? target.type === 'line' : (e.type === 'circle' || e.type === 'arc') && (target.type === 'circle' || target.type === 'arc');
      if (!fits) throw new CommandError(t('cmd.sketchRefWrongKind', { id: e.id, name: ref.name }));
    }
  }
}

function sketchDatums(doc: PartDoc, entities: readonly SketchEntity[], index: number): void {
  sketchSketchRefs(doc, entities, index);
  for (const e of entities) {
    const ref = 'ref' in e ? e.ref : undefined;
    if (ref?.kind !== 'datum') continue;
    const at = doc.features.findIndex((f) => f.id === ref.name);
    const type = isDatumPlaneName(ref.name) ? 'refPlane' : /^axis:[xyz]$/.test(ref.name) ? 'refAxis' : at >= 0 && at < index ? doc.features[at]!.type : null;
    if (type !== 'refPlane' && type !== 'refAxis' && type !== 'refPoint' && type !== 'coordSys') throw new CommandError(t('cmd.sketchDatumNotEarlier', { id: e.id, name: ref.name }));
    const fits = e.type === 'point' ? type === 'refPoint' || type === 'refAxis' : type !== 'refPoint';
    if (!fits) throw new CommandError(t('cmd.sketchDatumWrongKind', { id: e.id, name: ref.name }));
  }
}

function revolveAxis(sketch: SketchFeature, axis: Id): void {
  if (!isSketchAxis(axis) && sketch.entities.find((e) => e.id === axis)?.type !== 'line') throw new CommandError(t('cmd.revolveAxisMustBeLine'));
}

/** Ids a feature brings into the document: its own and, for a sketch, those of its contents. */
function featureIds(f: Feature): Id[] {
  return f.type === 'sketch' ? [f.id, ...f.entities.map((e) => e.id), ...f.constraints.map((c) => c.id)] : [f.id];
}

/** A picture has a size, an angle and an opacity that mean something. */
function pictureValues(p: SketchPicture): void {
  if (![p.x, p.y, p.width, p.height, p.angle, p.opacity].every(Number.isFinite)) throw new CommandError(t('cmd.pictureNumbers'));
  if (!(p.width > 0 && p.height > 0)) throw new CommandError(t('cmd.pictureSize'));
  if (!(p.opacity >= 0 && p.opacity <= 1)) throw new CommandError(t('cmd.pictureOpacity'));
}

function assertFresh(doc: PartDoc, ids: Id[]): void {
  const inUse = new Set(idsInUse(doc));
  const seen = new Set<Id>();
  for (const id of ids) {
    if (inUse.has(id) || seen.has(id)) throw new CommandError(t('cmd.idInUse', { id }));
    seen.add(id);
  }
}

function validateNewFeature(doc: PartDoc, f: Feature, index: number): void {
  if (!f.name.trim()) throw new CommandError(t('cmd.nameEmpty'));
  switch (f.type) {
    case 'sketch': {
      if (f.plane.kind !== 'datum' && f.plane.kind !== 'face') throw new CommandError(t('cmd.sketchNeedsPlane'));
      planeRef(doc, f.plane, index);
      if (f.attach) sketchAttachRefs(doc, f.attach, index);
      const err = sketchError(f);
      if (err) throw new CommandError(err);
      sketchDatums(doc, f.entities, index);
      return;
    }
    case 'extrude':
      sketchBefore(doc, f.sketch, index, t('feature.extrude'));
      endCondition(f.dir1);
      if (f.dir2) endCondition(f.dir2);
      return;
    case 'revolve':
      revolveAxis(sketchBefore(doc, f.sketch, index, t('feature.revolve')), f.axis);
      return;
    case 'sweep':
      sweepSketches(doc, f, index);
      return;
    case 'loft':
      loftSections(doc, f, index);
      return;
    case 'rib':
      sketchBefore(doc, f.sketch, index, t('feature.rib'));
      return;
    case 'fillet':
      if (f.edges.some((r) => r.kind !== 'edge') || (f.faces ?? []).some((r) => r.kind !== 'face')) throw new CommandError(t('cmd.filletOnlyEdges'));
      return;
    case 'chamfer':
      if (f.edges.some((r) => r.kind !== 'edge') || (f.faces ?? []).some((r) => r.kind !== 'face')) throw new CommandError(t('cmd.chamferOnlyEdges'));
      return;
    case 'refPlane':
      planeDefinition(doc, f.def, index);
      return;
    case 'refAxis':
      axisDefinition(doc, f.def, index);
      return;
    case 'refPoint':
      pointDefinition(doc, f.def, index);
      return;
    case 'coordSys':
      coordSysRefs(doc, f, index);
      return;
    case 'pattern':
      patternRefs(doc, f, index);
      return;
    case 'mirror':
      mirrorRefs(doc, f, index);
      return;
    case 'deleteFace':
      if (f.faces.some((r) => r.kind !== 'face')) throw new CommandError(t('cmd.deleteFaceOnlyFaces'));
      return;
    case 'offsetSurface':
      if (f.faces.some((r) => r.kind !== 'face')) throw new CommandError(t('cmd.offsetSurfaceOnlyFaces'));
      return;
    case 'moveFace':
      if (f.face.kind !== 'face') throw new CommandError(t('cmd.moveFaceOnlyFace'));
      return;
    case 'splitLine':
      sketchBefore(doc, f.sketch, index, t('feature.splitLine'));
      if (f.face.kind !== 'face') throw new CommandError(t('cmd.splitLineOnlyFace'));
      return;
    case 'trimSurface':
      sketchBefore(doc, f.sketch, index, t('feature.trimSurface'));
      if (f.face.kind !== 'face') throw new CommandError(t('cmd.splitLineOnlyFace'));
      return;
    case 'knit':
      if (f.bodies.some((r) => r.kind !== 'body')) throw new CommandError(t('cmd.knitOnlyBodies'));
      return;
    case 'mutualTrim':
      if (f.a.kind !== 'body' || f.b.kind !== 'body') throw new CommandError(t('cmd.mutualTrimOnlyBodies'));
      if ((f.discard ?? []).some((r) => r.kind !== 'face')) throw new CommandError(t('cmd.mutualTrimOnlyFaces'));
      return;
    case 'lipGroove':
      if (f.face.kind !== 'face') throw new CommandError(t('cmd.lipOnlyFace'));
      return;
    case 'thicken':
      if (f.body.kind !== 'body') throw new CommandError(t('cmd.surfaceOnlyBodies'));
      return;
    case 'cutWithSurface':
      if (f.target.kind !== 'body' || f.surface.kind !== 'body') throw new CommandError(t('cmd.surfaceOnlyBodies'));
      if (f.keep !== undefined && f.keep !== 'behind' && f.keep !== 'ahead') throw new CommandError(t('cmd.cutKeepInvalid'));
      if (f.direction.kind === 'vector') {
        const [x, y, z] = f.direction.value;
        if (![x, y, z].every(Number.isFinite) || Math.hypot(x, y, z) === 0) throw new CommandError(t('cmd.cutDirectionVector'));
      } else if (f.direction.kind !== 'datum' && f.direction.kind !== 'face') throw new CommandError(t('cmd.cutDirectionKind'));
      return;
    case 'fillSurface':
    case 'flatSurface':
    case 'extendSurface':
      if (f.edges.some((r) => r.kind !== 'edge')) throw new CommandError(t('cmd.surfaceOnlyEdges'));
      return;
    case 'combine':
      combineRefs(f.main, f.tools);
      return;
    case 'importedBody':
      if (!doc.blobs.some((b) => b.id === f.blob)) throw new CommandError(t('cmd.importDataNotFound', { id: f.blob }));
      return;
    case 'hole':
      if (!validThreadTolerance(f.toleranceClass, f.kind === 'tapped' ? f.size : undefined, 'internal')) throw new CommandError(t('cmd.badThreadTolerance'));
      checkDowel(f);
      return;
    case 'screwBoss':
      sketchBefore(doc, f.sketch, index, t('feature.screwBoss'));
      return;
    case 'hem':
    case 'edgeFlange':
      if (f.edge.kind !== 'edge') throw new CommandError(t('cmd.flangeOnlyEdge'));
      return;
    case 'breakCorner':
      if (f.corners.length === 0 || f.corners.some((r) => r.kind !== 'edge')) throw new CommandError(t('cmd.flangeOnlyEdge'));
      if (f.kind !== 'chamfer' && f.kind !== 'fillet') throw new CommandError(t('cmd.featureTypeInvalid'));
      return;
    case 'sheetUnfold': return;
    case 'sheetRefold': {
      const source = doc.features.findIndex(x => x.id === f.unfold);
      if (source < 0 || source >= index || doc.features[source]!.type !== 'sheetUnfold') throw new CommandError(t('sheetState.noUnfold'));
      return;
    }
    case 'baseFlange':
      sketchBefore(doc, f.sketch, index, t('feature.baseFlange'));
      return;
    case 'midBend':
      sketchBefore(doc, f.sketch, index, t('feature.midBend'));
      return;
    case 'jog':
      sketchBefore(doc, f.sketch, index, t('feature.jog'));
      return;
    case 'snapHook':
      sketchBefore(doc, f.sketch, index, t('feature.snapHook'));
      return;
    case 'snapCatch':
      sketchBefore(doc, f.sketch, index, t('feature.snapCatch'));
      return;
    case 'vent':
      sketchBefore(doc, f.sketch, index, t('feature.vent'));
      return;
    case 'thread':
      if (f.profileMode === 'standard' && !f.sketch) {
        if (typeof f.axis !== 'string' && f.axis.kind !== 'datum' && f.axis.kind !== 'face' && f.axis.kind !== 'edge') {
          throw new CommandError(t('cmd.threadOnlyAxis'));
        }
      } else {
        if (typeof f.axis === 'string') revolveAxis(sketchBefore(doc, f.sketch!, index, t('feature.thread')), f.axis);
        else {
          sketchBefore(doc, f.sketch!, index, t('feature.thread'));
          if (f.axis.kind !== 'datum' && f.axis.kind !== 'face' && f.axis.kind !== 'edge') throw new CommandError(t('cmd.threadOnlyAxis'));
        }
      }
      return;

    case 'knurl':
      // the grooves are cut into the surface the axis names: no sketch is involved, and a line of one cannot be the axis
      if (f.axis.kind !== 'datum' && f.axis.kind !== 'face' && f.axis.kind !== 'edge') throw new CommandError(t('cmd.knurlOnlyAxis'));
      return;

    case 'cosmeticThread':
      if (!validThreadTolerance(f.toleranceClass, f.standardMode === 'standard' ? f.standardDesignation : undefined, f.threadType)) throw new CommandError(t('cmd.badThreadTolerance'));
      if (f.targetFace.kind !== 'face') throw new CommandError(t('cmd.cosmeticThreadOnlyFace'));
      if (f.startEdge && f.startEdge.kind !== 'edge' && f.startEdge.kind !== 'face') throw new CommandError(t('cmd.cosmeticThreadOnlyEdge'));
      return;

    case 'gear':
    case 'rack': planeRef(doc,f.plane,index);return;
    case 'ruledSurface':
      if(f.first.kind!=='edge'||f.second.kind!=='edge')throw new CommandError(t('surfaceTools.pickEdges'));
      if(f.first.name && f.first.name===f.second.name)throw new CommandError(t('surfaceTools.crossing'));
      return;
    case 'radiatedSurface':
      if(f.edge.kind!=='edge')throw new CommandError(t('surfaceTools.pickEdges'));
      planeRef(doc,f.plane,index);return;
    case 'replaceFace':
      if(f.face.kind!=='face')throw new CommandError(t('projection.faces'));
      planeRef(doc,f.replacement,index);return;
    case 'projectedCurve':
      sketchBefore(doc, f.sketch, index, t('feature.projectedCurve'));
      if (f.mode === 'sketchOnSketch') {
        if (!f.secondSketch || f.secondSketch === f.sketch) throw new CommandError(t('projection.twoSketches'));
        sketchBefore(doc, f.secondSketch, index, t('feature.projectedCurve'));
      } else if (f.mode === 'sketchOnFaces') {
        if (f.faces?.some(r=>r.kind !== 'face')) throw new CommandError(t('projection.faces'));
        if (f.direction) directionRef(doc, f.direction, index);
      } else throw new CommandError(t('projection.mode'));
      return;

    case 'helix':
      if (f.circle.kind !== 'edge' && f.circle.kind !== 'datum') throw new CommandError(t('cmd.helixNeedsCircle'));
      if (f.definedBy !== 'pitchAndRev' && f.definedBy !== 'heightAndRev' && f.definedBy !== 'heightAndPitch' && f.definedBy !== 'spiral') {
        throw new CommandError(t('cmd.helixModeInvalid'));
      }
      return;

    case 'split':
      if (f.tool.kind !== 'datum' && f.tool.kind !== 'face') throw new CommandError(t('cmd.splitToolNeedsDatumOrFace'));
      if (f.targets && f.targets.some((r) => r.kind !== 'body')) throw new CommandError(t('cmd.splitTargetsOnlyBodies'));
      return;

    case 'moveCopyBody':
      if (!f.targets || f.targets.length === 0) throw new CommandError(t('cmd.moveCopyBodyNeedsTargets'));
      if (f.targets.some((r) => r.kind !== 'body')) throw new CommandError(t('cmd.moveCopyBodyOnlyBodies'));
      if (f.rotationAxis && typeof f.rotationAxis === 'object') {
        if (f.rotationAxis.kind !== 'datum' && f.rotationAxis.kind !== 'edge' && f.rotationAxis.kind !== 'face') {
          throw new CommandError(t('cmd.moveCopyBodyAxisKind'));
        }
      }
      return;

    case 'deleteKeepBody':
      if (!f.targets || f.targets.length === 0) throw new CommandError(t('cmd.deleteKeepBodyNeedsTargets'));
      if (f.targets.some((r) => r.kind !== 'body')) throw new CommandError(t('cmd.deleteKeepBodyOnlyBodies'));
      if (f.mode !== 'delete' && f.mode !== 'keep') throw new CommandError(t('cmd.deleteKeepBodyModeInvalid'));
      return;

    case 'derivedBody':
      if (!isFilePath(f.source)) throw new CommandError(t('cmd.derivedSourceInvalid', { path: f.source }));
      if (f.body.trim() === '') throw new CommandError(t('cmd.derivedBodyEmpty'));
      return;
  }
}

/** What a dowel pin hole (C4.8, v27) needs to be well formed: a fit that is in the tables; only that kind has one or an entrance chamfer. */
function checkDowel(f: HoleFeature): void {
  if (f.kind !== 'dowel') {
    if (f.fit !== undefined || f.chamfer !== undefined) throw new CommandError(t('cmd.holeDowelOnly'));
    return;
  }
  if (f.fit !== undefined && !DOWEL_FITS.includes(f.fit)) throw new CommandError(t('cmd.holeFitUnknown', { fit: String(f.fit) }));
}

/** Inserts a feature at `index` (at or above the rollback bar) after checking it. */
function insert(draft: Draft<PartDoc>, feature: Feature, index: number): void {
  const limit = draft.rollbackIndex ?? draft.features.length;
  if (!Number.isInteger(index) || index < 0 || index > limit) throw new CommandError(t('cmd.insertOutOfRange', { index }));
  const ids = featureIds(feature);
  assertFresh(draft as PartDoc, ids);
  validateNewFeature(draft as PartDoc, feature, index);
  draft.features.splice(index, 0, feature as Draft<Feature>);
  checkExprs(draft as PartDoc, feature); // in place, so a sketch's own dimensions can refer to each other
  if (draft.rollbackIndex !== null) draft.rollbackIndex += 1;
  countersFor(ids, draft.idCounters);
}

/** A name an expression can use bare: letters, digits and underscores, not starting with a digit. */
const NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/** Rewrites the names in every expression of the document (variables' and features'). */
function rewriteNames(draft: Draft<PartDoc>, map: (ref: NameRef) => NameRef | null): void {
  const next = renameInDoc(current(draft) as PartDoc, map);
  draft.variables = next.variables as Draft<PartDoc['variables']>;
  draft.features = next.features as Draft<PartDoc['features']>;
}

/** A variable must evaluate: no unknown name, no cycle through it. */
function checkVariable(doc: PartDoc, id: Id): void {
  const v = doc.variables.find((x) => x.id === id)!;
  const r = new Parameters(doc).variableValue(v);
  if ('error' in r) throw new CommandError(r.error);
}

/** Immer recipe: mutates the draft or throws CommandError (the document is then left untouched). */
export function mutate(draft: Draft<PartDoc>, cmd: Command): void {
  switch (cmd.type) {
    case 'insertFeature':
      return insert(draft, cmd.feature, cmd.index);
    case 'importBody': {
      const { blob, feature } = cmd;
      if (!/^[0-9a-f]{64}$/.test(blob.sha256)) throw new CommandError(t('cmd.importHashInvalid'));
      if (feature.blob !== blob.id) throw new CommandError(t('cmd.importBodyMustUseData'));
      assertFresh(draft as PartDoc, [blob.id]);
      draft.blobs.push(blob);
      countersFor([blob.id], draft.idCounters);
      return insert(draft, feature, cmd.index); // throws before anything is kept if the feature is wrong
    }
    case 'addSketchPicture': {
      const f = sketchOf(draft, cmd.featureId);
      const { blob, picture } = cmd;
      if (!/^[0-9a-f]{64}$/.test(blob.sha256)) throw new CommandError(t('cmd.importHashInvalid'));
      if (blob.kind !== 'png' && blob.kind !== 'jpg') throw new CommandError(t('cmd.pictureKind'));
      if (picture.blob !== blob.id && !draft.blobs.some((b) => b.id === picture.blob)) throw new CommandError(t('cmd.pictureNeedsData'));
      pictureValues(picture);
      const known = draft.blobs.find((b) => b.sha256 === blob.sha256 && b.kind === blob.kind);
      // the same image used twice is one blob
      const use = known ?? blob;
      if (!known) {
        assertFresh(draft as PartDoc, [blob.id]);
        draft.blobs.push(blob);
        countersFor([blob.id], draft.idCounters);
      }
      assertFresh(draft as PartDoc, [picture.id]);
      (f.pictures ??= []).push({ ...picture, blob: use.id });
      countersFor([picture.id], draft.idCounters);
      return;
    }
    case 'setSketchPicture': {
      const f = sketchOf(draft, cmd.featureId);
      const p = f.pictures?.find((x) => x.id === cmd.pictureId);
      if (!p) throw new CommandError(t('cmd.pictureNotFound', { id: cmd.pictureId }));
      const next = { ...p, ...cmd.picture };
      pictureValues(next);
      Object.assign(p, next);
      return;
    }
    case 'removeSketchPicture': {
      const f = sketchOf(draft, cmd.featureId);
      const i = f.pictures?.findIndex((x) => x.id === cmd.pictureId) ?? -1;
      if (i < 0) throw new CommandError(t('cmd.pictureNotFound', { id: cmd.pictureId }));
      const [gone] = f.pictures!.splice(i, 1);
      if (f.pictures!.length === 0) delete f.pictures;
      countersFor([gone!.id], draft.idCounters);
      // the data stays in the file only while a picture still uses it
      if (!pictureBlobs(draft.features as never).has(gone!.blob)) draft.blobs = draft.blobs.filter((b) => b.id !== gone!.blob);
      return;
    }
    case 'applySketchFix': {
      const f=sketchOf(draft,cmd.featureId);if(!Array.isArray(cmd.changes)||cmd.changes.length<1||cmd.changes.length>2||new Set(cmd.changes.map(c=>c.id)).size!==cmd.changes.length)throw new CommandError(t('sketch.fixInvalid'));
      const removed=new Set<Id>();for(const change of cmd.changes){const c=f.constraints.find(c=>c.id===change.id);if(!c||!['delete','driven'].includes(change.kind)||change.kind==='driven'&&!isDimension(c)||change.kind==='delete'&&isDimension(c))throw new CommandError(t('sketch.fixInvalid'));if(change.kind==='delete')removed.add(c.id);else if(isDimension(c))c.driving=false;}
      f.constraints=f.constraints.filter(c=>!removed.has(c.id));countersFor(removed,draft.idCounters);return;
    }
    case 'setEllipseAxes': {
      const f=sketchOf(draft,cmd.featureId),c=f.constraints.find(x=>x.id===cmd.constraintId);if(c?.type!=='ellipseAxes')throw new CommandError(t('cmd.sketchItemNotFound',{id:cmd.constraintId}));c.majorRadius=cmd.majorRadius;c.minorRadius=cmd.minorRadius;checkExprs(draft as PartDoc,f as Feature,new Set([c.id]));return;
    }
    case 'setLengthRatio': {
      const f=sketchOf(draft,cmd.featureId),c=f.constraints.find(x=>x.id===cmd.constraintId);
      if(c?.type!=='lengthRatio')throw new CommandError(t('cmd.sketchItemNotFound',{id:cmd.constraintId}));
      c.ratio=cmd.ratio;checkExprs(draft as PartDoc,f as Feature,new Set([c.id]));return;
    }
    case 'setDimension': {
      const f = sketchOf(draft, cmd.featureId);
      const c = f.constraints.find((x) => x.id === cmd.constraintId);
      if (!c || !isDimension(c)) throw new CommandError(t('cmd.dimensionNotFound', { id: cmd.constraintId }));
      c.value = cmd.value;
      checkExprs(draft as PartDoc, f as Feature, new Set([c.id])); // after the change, so a cycle through it is seen
      return;
    }
    case 'setDimensionPosition': {
      const f = sketchOf(draft, cmd.featureId);
      const c = f.constraints.find((x) => x.id === cmd.constraintId);
      if (!c || !isDimension(c)) throw new CommandError(t('cmd.dimensionNotFound', { id: cmd.constraintId }));
      if (cmd.position === null) {
        delete c.labelPosition;
        return;
      }
      const [x, y] = cmd.position;
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new CommandError(t('cmd.dimensionPositionNotFinite'));
      c.labelPosition = [x, y];
      return;
    }
    case 'setDistanceCondition': {
      const f = sketchOf(draft, cmd.featureId);
      const c = f.constraints.find((x) => x.id === cmd.constraintId);
      if (!c || c.type !== 'distance') throw new CommandError(t('cmd.dimensionNotFound', { id: cmd.constraintId }));
      if (cmd.condition === null) delete c.condition;
      else c.condition = cmd.condition;
      if (cmd.value !== undefined) c.value = cmd.value;
      const err = sketchError(f as SketchFeature);
      if (err) throw new CommandError(err);
      checkExprs(draft as PartDoc, f as Feature, new Set([c.id]));
      return;
    }
    case 'setDimensionDriving': {
      const f = sketchOf(draft, cmd.featureId);
      const c = f.constraints.find((x) => x.id === cmd.constraintId);
      if (!c || !isDimension(c)) throw new CommandError(t('cmd.dimensionNotFound', { id: cmd.constraintId }));
      if (cmd.driving) {
        delete c.driving;
        if (cmd.value !== undefined) c.value = cmd.value;
        checkExprs(draft as PartDoc, f as Feature, new Set([c.id]));
        return;
      }
      // a driven dimension has no value of its own, so nothing may still use it
      const before = resolveDoc(current(draft) as PartDoc).problems;
      c.driving = false;
      const after = resolveDoc(current(draft) as PartDoc).problems;
      for (const id of after.keys()) if (!before.has(id)) throw new CommandError(t('cmd.dimensionStillUsed', { name: dimensionName(c) }));
      return;
    }
    case 'setEndCondition': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'extrude') throw new CommandError(t('cmd.onlyExtrudeHasEnd'));
      if (cmd.value === null) {
        if (cmd.dir === 'dir1') throw new CommandError(t('cmd.dir1Stays'));
        delete f.dir2;
        delete f.draft2;
        return;
      }
      endCondition(cmd.value);
      f[cmd.dir] = cmd.value;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setDraft': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'extrude') throw new CommandError(t('cmd.onlyExtrudeHasEnd'));
      const key = cmd.dir === 'dir1' ? 'draft1' : 'draft2';
      if (cmd.draft === null) delete f[key];
      else f[key] = { angle: cmd.draft.angle, ...(cmd.draft.inward ? { inward: true } : {}) };
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setThin': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'extrude' && f.type !== 'revolve') throw new CommandError(t('cmd.onlyExtrudeRevolveThin'));
      if (cmd.thin === null) delete f.thin;
      else f.thin = { mode: cmd.thin.mode, thickness: cmd.thin.thickness, ...(cmd.thin.thickness2 === undefined ? {} : { thickness2: cmd.thin.thickness2 }), ...(cmd.thin.reverse ? { reverse: true } : {}) };
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setRevolveCondition': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'revolve') throw new CommandError(t('cmd.onlyRevolveHasAngle'));
      f.dir1 = cmd.value;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setRevolveAxis': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'revolve') throw new CommandError(t('cmd.onlyRevolveHasAxis'));
      const sketch = draft.features.find((x) => x.id === f.sketch);
      if (sketch?.type !== 'sketch') throw new CommandError(t('cmd.revolveSketchNotFound'));
      revolveAxis(sketch as SketchFeature, cmd.axis);
      f.axis = cmd.axis;
      return;
    }
    case 'setSweepPath': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'sweep') throw new CommandError(t('cmd.onlySweepHasPath'));
      sweepSketches(draft as PartDoc, { ...(f as SweepFeature), path: cmd.path }, draft.features.findIndex((x) => x.id === f.id));
      f.path = cmd.path;
      return;
    }
    case 'setLoftSections': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'loft') throw new CommandError(t('cmd.onlyLoftHasSections'));
      loftSections(draft as PartDoc, { ...(f as LoftFeature), sections: cmd.sections }, draft.features.findIndex((x) => x.id === f.id));
      f.sections = [...cmd.sections];
      return;
    }
    case 'setRefPlane': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'refPlane') throw new CommandError(t('cmd.onlyRefPlaneHasParams'));
      planeDefinition(draft as PartDoc, cmd.def, draft.features.findIndex((x) => x.id === f.id));
      f.def = cmd.def;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setRefAxis': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'refAxis') throw new CommandError(t('cmd.onlyRefAxisHasParams'));
      axisDefinition(draft as PartDoc, cmd.def, draft.features.findIndex((x) => x.id === f.id));
      f.def = cmd.def;
      return;
    }
    case 'setRefPoint': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'refPoint') throw new CommandError(t('cmd.onlyRefPointHasParams'));
      pointDefinition(draft as PartDoc, cmd.def, draft.features.findIndex((x) => x.id === f.id));
      f.def = cmd.def;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setMirror': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'mirror') throw new CommandError(t('cmd.onlyMirrorHasParams'));
      mirrorRefs(draft as PartDoc, cmd.value, draft.features.findIndex((x) => x.id === f.id));
      f.target = cmd.value.target;
      f.plane = cmd.value.plane;
      f.seeds = [...cmd.value.seeds];
      f.bodies = [...cmd.value.bodies];
      if (cmd.value.merge === false) f.merge = false;
      else delete f.merge;
      return;
    }
    case 'setPattern': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'pattern') throw new CommandError(t('cmd.onlyPatternHasParams'));
      patternRefs(draft as PartDoc, cmd, draft.features.findIndex((x) => x.id === f.id));
      f.seeds = [...cmd.seeds];
      f.def = cmd.def;
      if (cmd.skip && cmd.skip.length > 0) f.skip = [...cmd.skip];
      else delete f.skip;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setCoordSys': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'coordSys') throw new CommandError(t('cmd.onlyCoordSysHasParams'));
      coordSysRefs(draft as PartDoc, cmd.value, draft.features.findIndex((x) => x.id === f.id));
      const v = cmd.value;
      if (v.origin) f.origin = v.origin;
      else delete f.origin;
      f.x = v.x;
      f.y = v.y;
      if (v.flipX) f.flipX = true;
      else delete f.flipX;
      if (v.flipY) f.flipY = true;
      else delete f.flipY;
      return;
    }
    case 'setChamfer': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'chamfer') throw new CommandError(t('cmd.onlyChamferHasParams'));
      f.mode = cmd.value.mode;
      f.distance = cmd.value.distance;
      f.second = cmd.value.second;
      if (cmd.value.flip) f.flip = true;
      else delete f.flip;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setFilletRadius': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'fillet') throw new CommandError(t('cmd.onlyFilletHasRadius'));
      f.radius = cmd.value;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setFilletSets': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'fillet') throw new CommandError(t('cmd.onlyFilletHasKind'));
      const groups = [cmd.faces, cmd.faces2, cmd.center];
      if (groups.some((g) => (g ?? []).some((r) => r.kind !== 'face'))) throw new CommandError(t('cmd.filletSetsFaces'));
      if (cmd.kind === 'constant') {
        if (cmd.faces2?.length || cmd.center?.length) throw new CommandError(t('cmd.filletSetsFaces'));
        delete f.kind;
      } else f.kind = cmd.kind;
      for (const [key, value] of [['faces', cmd.faces], ['faces2', cmd.faces2], ['center', cmd.center]] as const) {
        if (value && value.length > 0) f[key] = value;
        else delete f[key];
      }
      // a face fillet or a full round has no per-edge radius to evolve: its control points would be words without a meaning
      if (f.kind) delete f.variable;
      return;
    }
    case 'setFilletVariable': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'fillet') throw new CommandError(t('cmd.onlyFilletHasRadius'));
      if (f.kind) throw new CommandError(t('cmd.filletVariableConstantOnly'));
      const picked = new Set(f.edges.map((e) => e.name));
      const byEdge = new Map<string, FilletVariablePoint[]>();
      const p = new Parameters(draft as PartDoc);
      for (const point of cmd.points) {
        if (!picked.has(point.edge)) throw new CommandError(t('cmd.filletVariableEdge', { edge: point.edge }));
        if (!(point.t >= 0 && point.t <= 1)) throw new CommandError(t('cmd.filletVariablePosition', { t: String(point.t) }));
        if ((byEdge.get(point.edge) ?? []).some((x) => x.t === point.t)) throw new CommandError(t('cmd.filletVariableSame', { t: String(point.t) }));
        positive(p, point.radius);
        byEdge.set(point.edge, [...(byEdge.get(point.edge) ?? []), point]);
      }
      // the radius law is only defined between the first and the last point: an edge's points run from one end of it to the other
      for (const points of byEdge.values()) {
        const sorted = [...points].sort((a, b) => a.t - b.t);
        if (sorted[0]!.t !== 0 || sorted[sorted.length - 1]!.t !== 1) throw new CommandError(t('cmd.filletVariableEnds'));
      }
      if (cmd.points.length === 0) delete f.variable;
      else f.variable = cmd.points;
      return;
    }
    case 'setEdges': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'fillet' && f.type !== 'chamfer') throw new CommandError(t('cmd.onlyEdgeFeaturesPickEdges'));
      if (cmd.edges.some((r) => r.kind !== 'edge') || (cmd.faces ?? []).some((r) => r.kind !== 'face')) throw new CommandError(t('cmd.mustPickEdges'));
      f.edges = cmd.edges;
      // an edge taken out lets go of the variable-radius control points bound to it: they say where along it, and it is gone (ADR 0167)
      if (f.type === 'fillet' && f.variable?.length) {
        const left = f.variable.filter((x) => f.edges.some((e) => e.name === x.edge));
        if (left.length === 0) delete f.variable;
        else if (left.length !== f.variable.length) f.variable = left;
      }
      if (cmd.faces !== undefined) {
        if (cmd.faces.length > 0) f.faces = cmd.faces;
        else delete f.faces;
      }
      return;
    }
    case 'setFaces': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'deleteFace') throw new CommandError(t('cmd.onlyDeleteFaceHasFaces'));
      if (cmd.faces.some((r) => r.kind !== 'face')) throw new CommandError(t('cmd.deleteFaceOnlyFaces'));
      f.faces = cmd.faces;
      if (cmd.hole) f.hole = true;
      else delete f.hole;
      return;
    }
    case 'setHole': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'hole') throw new CommandError(t('cmd.onlyHoleHasParams'));
      const keep = { id: f.id, type: f.type, name: f.name, suppressed: f.suppressed, sketch: f.sketch } as const;
      for (const k of Object.keys(f)) delete (f as unknown as Record<string, unknown>)[k];
      Object.assign(f, keep, cmd.hole);
      if (!validThreadTolerance(f.toleranceClass, f.kind === 'tapped' ? f.size : undefined, 'internal')) throw new CommandError(t('cmd.badThreadTolerance'));
      checkDowel(f as HoleFeature);
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setRib': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'rib') throw new CommandError(t('cmd.onlyRibHasParams'));
      const keep = { id: f.id, type: f.type, name: f.name, suppressed: f.suppressed, sketch: f.sketch } as const;
      for (const k of Object.keys(f)) delete (f as unknown as Record<string, unknown>)[k];
      Object.assign(f, keep, cmd.rib);
      if (f.flip === undefined) delete f.flip;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setThread': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'thread') throw new CommandError(t('cmd.onlyThreadHasParams'));
      const next = { ...f, ...cmd.params };
      validateNewFeature(draft as PartDoc, next as Feature, draft.features.findIndex((x) => x.id === f.id));
      Object.assign(f, cmd.params);
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setKnurl': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'knurl') throw new CommandError(t('cmd.onlyKnurlHasParams'));
      const next = { ...f, ...cmd.knurl };
      if (next.axis.kind !== 'datum' && next.axis.kind !== 'face' && next.axis.kind !== 'edge') throw new CommandError(t('cmd.knurlOnlyAxis'));
      validateNewFeature(draft as PartDoc, next as Feature, draft.features.findIndex((x) => x.id === f.id));
      Object.assign(f, cmd.knurl);
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setCosmeticThread': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'cosmeticThread') throw new CommandError(t('cmd.onlyCosmeticThreadHasParams'));
      const next = { ...f, ...cmd.params };
      if (next.targetFace && next.targetFace.kind !== 'face') throw new CommandError(t('cmd.cosmeticThreadOnlyFace'));
      if (next.startEdge && next.startEdge.kind !== 'edge' && next.startEdge.kind !== 'face') throw new CommandError(t('cmd.cosmeticThreadOnlyEdge'));
      validateNewFeature(draft as PartDoc, next as Feature, draft.features.findIndex((x) => x.id === f.id));
      Object.assign(f, cmd.params);
      if ('startEdge' in cmd.params && cmd.params.startEdge === undefined) delete f.startEdge;
      if ('reverse' in cmd.params && !cmd.params.reverse) delete f.reverse;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setDraftFeature': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'draft') throw new CommandError(t('cmd.onlyDraftHasParams'));
      if (cmd.neutral.kind !== 'face' && cmd.neutral.kind !== 'datum') throw new CommandError(t('cmd.draftNeutralKind'));
      if (cmd.faces.some((r) => r.kind !== 'face')) throw new CommandError(t('cmd.draftOnlyFaces'));
      f.neutral = cmd.neutral;
      f.faces = cmd.faces;
      f.angle = cmd.angle;
      if (cmd.reverse) f.reverse = true;
      else delete f.reverse;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setOffsetSurface': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'offsetSurface') throw new CommandError(t('cmd.onlyOffsetSurfaceHasParams'));
      if (cmd.faces.some((r) => r.kind !== 'face')) throw new CommandError(t('cmd.offsetSurfaceOnlyFaces'));
      f.faces = cmd.faces;
      f.distance = cmd.distance;
      if (cmd.join && cmd.join !== 'arc') f.join = cmd.join;
      else delete f.join;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setSplitLine': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'splitLine') throw new CommandError(t('cmd.onlySplitLineHasParams'));
      if (cmd.face.kind !== 'face') throw new CommandError(t('cmd.splitLineOnlyFace'));
      sketchBefore(draft as PartDoc, cmd.sketch, draft.features.findIndex((x) => x.id === f.id), t('feature.splitLine'));
      f.sketch = cmd.sketch;
      f.face = cmd.face;
      if (cmd.reverse) f.reverse = true;
      else delete f.reverse;
      if (cmd.throughAll) f.throughAll = true;
      else delete f.throughAll;
      return;
    }
    case 'setScrewBoss': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'screwBoss') throw new CommandError(t('cmd.onlyBossHasParams'));
      const keep = { id: f.id, type: f.type, name: f.name, suppressed: f.suppressed, sketch: f.sketch } as const;
      for (const k of Object.keys(f)) delete (f as unknown as Record<string, unknown>)[k];
      Object.assign(f, keep, cmd.boss);
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setHem': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'hem') throw new CommandError(t('cmd.onlyThisHasParams', { what: t('feature.hem') }));
      const keep = { id: f.id, type: f.type, name: f.name, suppressed: f.suppressed } as const;
      for (const k of Object.keys(f)) delete (f as unknown as Record<string, unknown>)[k];
      Object.assign(f, keep, cmd.hem);
      checkExprs(draft as PartDoc, f as Feature);
      if ((f as HemFeature).edge.kind !== 'edge') throw new CommandError(t('cmd.flangeOnlyEdge'));
      return;
    }
    case 'setEdgeFlange': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'edgeFlange') throw new CommandError(t('cmd.onlyThisHasParams', { what: t('feature.edgeFlange') }));
      const keep = { id: f.id, type: f.type, name: f.name, suppressed: f.suppressed } as const;
      for (const k of Object.keys(f)) delete (f as unknown as Record<string, unknown>)[k];
      Object.assign(f, keep, cmd.flange);
      checkExprs(draft as PartDoc, f as Feature);
      if ((f as EdgeFlangeFeature).edge.kind !== 'edge') throw new CommandError(t('cmd.flangeOnlyEdge'));
      return;
    }
    case 'setBreakCorner': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'breakCorner') throw new CommandError(t('cmd.onlyThisHasParams', { what: t('feature.breakCorner') }));
      if (cmd.corners.length === 0 || cmd.corners.some((r) => r.kind !== 'edge')) throw new CommandError(t('cmd.flangeOnlyEdge'));
      if (cmd.kind !== 'chamfer' && cmd.kind !== 'fillet') throw new CommandError(t('cmd.featureTypeInvalid'));
      f.corners = cmd.corners;
      f.kind = cmd.kind;
      f.size = cmd.size;
      checkExprs(draft as PartDoc, f);
      return;
    }
    case 'setMidBend': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'midBend') throw new CommandError(t('cmd.onlyThisHasParams', { what: t('feature.midBend') }));
      const keep = { id: f.id, type: f.type, name: f.name, suppressed: f.suppressed, sketch: f.sketch } as const;
      for (const k of Object.keys(f)) delete (f as unknown as Record<string, unknown>)[k];
      Object.assign(f, keep, cmd.midBend);
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setJog': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'jog') throw new CommandError(t('cmd.onlyThisHasParams', { what: t('feature.jog') }));
      const keep = { id: f.id, type: f.type, name: f.name, suppressed: f.suppressed, sketch: f.sketch } as const;
      for (const k of Object.keys(f)) delete (f as unknown as Record<string, unknown>)[k];
      Object.assign(f, keep, cmd.jog);
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setBaseFlange': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'baseFlange') throw new CommandError(t('cmd.onlyThisHasParams', { what: t('feature.baseFlange') }));
      const keep = { id: f.id, type: f.type, name: f.name, suppressed: f.suppressed, sketch: f.sketch } as const;
      for (const k of Object.keys(f)) delete (f as unknown as Record<string, unknown>)[k];
      Object.assign(f, keep, cmd.flange);
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setSnapHook':
    case 'setSnapCatch':
    case 'setVent': {
      const f = feature(draft, cmd.featureId);
      const [type, params] = cmd.type === 'setSnapHook' ? (['snapHook', cmd.hook] as const) : cmd.type === 'setSnapCatch' ? (['snapCatch', cmd.window] as const) : (['vent', cmd.vent] as const);
      if (f.type !== type) throw new CommandError(t('cmd.onlyThisHasParams', { what: t(`feature.${type}`) }));
      const keep = { id: f.id, type: f.type, name: f.name, suppressed: f.suppressed, sketch: f.sketch } as const;
      for (const k of Object.keys(f)) delete (f as unknown as Record<string, unknown>)[k];
      Object.assign(f, keep, params);
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setThread': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'thread') throw new CommandError(t('cmd.onlyThisHasParams', { what: t('feature.thread') }));
      Object.assign(f, cmd.params);
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setLipGroove': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'lipGroove') throw new CommandError(t('cmd.onlyLipHasParams'));
      if (cmd.face.kind !== 'face') throw new CommandError(t('cmd.lipOnlyFace'));
      f.face = cmd.face;
      f.kind = cmd.kind;
      f.offset = cmd.offset;
      f.width = cmd.width;
      f.height = cmd.height;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setThicken': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'thicken') throw new CommandError(t('cmd.onlyThickenHasParams'));
      if (cmd.body.kind !== 'body') throw new CommandError(t('cmd.surfaceOnlyBodies'));
      f.body = cmd.body;
      f.thickness = cmd.thickness;
      if (cmd.both) f.both = true;
      else delete f.both;
      if (cmd.keepSurface) f.keepSurface = true;
      else delete f.keepSurface;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setCutWithSurface': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'cutWithSurface') throw new CommandError(t('cmd.onlyCutHasParams'));
      if (cmd.target.kind !== 'body' || cmd.surface.kind !== 'body') throw new CommandError(t('cmd.surfaceOnlyBodies'));
      if (cmd.keep !== undefined && cmd.keep !== 'behind' && cmd.keep !== 'ahead') throw new CommandError(t('cmd.cutKeepInvalid'));
      if (cmd.direction.kind === 'vector') {
        const [x, y, z] = cmd.direction.value;
        if (![x, y, z].every(Number.isFinite) || Math.hypot(x, y, z) === 0) throw new CommandError(t('cmd.cutDirectionVector'));
      } else if (cmd.direction.kind !== 'datum' && cmd.direction.kind !== 'face') throw new CommandError(t('cmd.cutDirectionKind'));
      f.target = cmd.target;
      f.surface = cmd.surface;
      f.direction = cmd.direction;
      if (cmd.reverse) f.reverse = true;
      else delete f.reverse;
      if (cmd.keep === 'ahead') f.keep = 'ahead';
      else delete f.keep;
      return;
    }
    case 'setMutualTrim': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'mutualTrim') throw new CommandError(t('cmd.onlyMutualTrimHasParams'));
      if (cmd.a.kind !== 'body' || cmd.b.kind !== 'body') throw new CommandError(t('cmd.mutualTrimOnlyBodies'));
      if ((cmd.discard ?? []).some((r) => r.kind !== 'face')) throw new CommandError(t('cmd.mutualTrimOnlyFaces'));
      f.a = cmd.a;
      f.b = cmd.b;
      if (cmd.discard && cmd.discard.length > 0) f.discard = cmd.discard;
      else delete f.discard;
      return;
    }
    case 'setKnit': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'knit') throw new CommandError(t('cmd.onlyKnitHasParams'));
      if (cmd.bodies.some((r) => r.kind !== 'body')) throw new CommandError(t('cmd.knitOnlyBodies'));
      f.bodies = cmd.bodies;
      if (cmd.tolerance === undefined) delete f.tolerance;
      else f.tolerance = cmd.tolerance;
      if (cmd.solid === false) f.solid = false;
      else delete f.solid;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setFillSurface': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'fillSurface') throw new CommandError(t('cmd.onlyFillHasParams'));
      if (cmd.edges.some((r) => r.kind !== 'edge')) throw new CommandError(t('cmd.surfaceOnlyEdges'));
      f.edges = cmd.edges;
      if (cmd.continuity === 'contact') f.continuity = 'contact';
      else delete f.continuity;
      return;
    }
    case 'setFlatSurface': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'flatSurface') throw new CommandError(t('cmd.onlyFlatHasParams'));
      if (cmd.edges.some((r) => r.kind !== 'edge')) throw new CommandError(t('cmd.surfaceOnlyEdges'));
      f.edges = cmd.edges;
      return;
    }
    case 'setTrimSurface': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'trimSurface') throw new CommandError(t('cmd.onlyTrimHasParams'));
      if (cmd.face.kind !== 'face') throw new CommandError(t('cmd.splitLineOnlyFace'));
      sketchBefore(draft as PartDoc, cmd.sketch, draft.features.findIndex((x) => x.id === f.id), t('feature.trimSurface'));
      f.sketch = cmd.sketch;
      f.face = cmd.face;
      if (cmd.keep === 'outside') f.keep = 'outside';
      else delete f.keep;
      if (cmd.reverse) f.reverse = true;
      else delete f.reverse;
      if (cmd.throughAll) f.throughAll = true;
      else delete f.throughAll;
      return;
    }
    case 'setExtendSurface': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'extendSurface') throw new CommandError(t('cmd.onlyExtendHasParams'));
      if (cmd.edges.some((r) => r.kind !== 'edge')) throw new CommandError(t('cmd.surfaceOnlyEdges'));
      f.edges = cmd.edges;
      f.distance = cmd.distance;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setShell': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'shell') throw new CommandError(t('cmd.onlyShellHasParams'));
      if (cmd.faces.some((r) => r.kind !== 'face')) throw new CommandError(t('cmd.shellOnlyFaces'));
      f.faces = cmd.faces;
      f.thickness = cmd.thickness;
      if (cmd.outward) f.outward = true;
      else delete f.outward;
      if (cmd.faceThickness !== undefined) {
        if (cmd.faceThickness.some((x) => x.face.kind !== 'face')) throw new CommandError(t('cmd.shellOnlyFaces'));
        if (cmd.faceThickness.length > 0) f.faceThickness = cmd.faceThickness;
        else delete f.faceThickness;
      }
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setImportOptions': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'importedBody') throw new CommandError(t('cmd.onlyImportHasOptions'));
      if (cmd.sewTolerance === undefined) delete f.sewTolerance;
      else f.sewTolerance = cmd.sewTolerance;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setMerge': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'extrude' && f.type !== 'revolve' && f.type !== 'sweep' && f.type !== 'loft' && f.type !== 'importedBody') throw new CommandError(t('cmd.onlyBossMerges'));
      if (cmd.merge) delete f.merge;
      else f.merge = false;
      return;
    }
    case 'setContours': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'extrude' && f.type !== 'revolve' && f.type !== 'sweep') throw new CommandError(t('cmd.onlyExtrudeRevolveContours'));
      if (cmd.contours === null) {
        delete f.contours;
        return;
      }
      if (cmd.contours.length === 0 || cmd.contours.some((c) => c.length === 0 || c.some((id) => typeof id !== 'string' || id === ''))) throw new CommandError(t('cmd.contoursEmpty'));
      f.contours = cmd.contours.map((c) => [...c]);
      return;
    }
    case 'setCombine': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'combine') throw new CommandError(t('cmd.onlyCombineHasBodies'));
      combineRefs(cmd.main, cmd.tools);
      f.op = cmd.op;
      f.main = cmd.main;
      f.tools = cmd.tools;
      return;
    }
    case 'setSplit': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'split') throw new CommandError(t('cmd.onlySplit'));
      if (cmd.tool.kind !== 'datum' && cmd.tool.kind !== 'face') throw new CommandError(t('cmd.splitToolNeedsDatumOrFace'));
      if (cmd.targets && cmd.targets.some((r) => r.kind !== 'body')) throw new CommandError(t('cmd.splitTargetsOnlyBodies'));
      f.tool = cmd.tool;
      if (cmd.targets && cmd.targets.length > 0) f.targets = cmd.targets;
      else delete f.targets;
      return;
    }
    case 'setMoveCopyBody': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'moveCopyBody') throw new CommandError(t('cmd.onlyMoveCopyBody'));
      if (!cmd.targets || cmd.targets.length === 0) throw new CommandError(t('cmd.moveCopyBodyNeedsTargets'));
      if (cmd.targets.some((r) => r.kind !== 'body')) throw new CommandError(t('cmd.moveCopyBodyOnlyBodies'));
      if (cmd.rotationAxis && typeof cmd.rotationAxis === 'object') {
        if (cmd.rotationAxis.kind !== 'datum' && cmd.rotationAxis.kind !== 'edge' && cmd.rotationAxis.kind !== 'face') {
          throw new CommandError(t('cmd.moveCopyBodyAxisKind'));
        }
      }
      f.targets = cmd.targets;
      if (cmd.dx !== undefined && cmd.dx.trim() !== '') f.dx = cmd.dx; else delete f.dx;
      if (cmd.dy !== undefined && cmd.dy.trim() !== '') f.dy = cmd.dy; else delete f.dy;
      if (cmd.dz !== undefined && cmd.dz.trim() !== '') f.dz = cmd.dz; else delete f.dz;
      if (cmd.rotationAxis !== undefined) f.rotationAxis = cmd.rotationAxis; else delete f.rotationAxis;
      if (cmd.rotationAngle !== undefined && cmd.rotationAngle.trim() !== '') f.rotationAngle = cmd.rotationAngle; else delete f.rotationAngle;
      if (cmd.copy) f.copy = true; else delete f.copy;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setDeleteKeepBody': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'deleteKeepBody') throw new CommandError(t('cmd.onlyDeleteKeepBody'));
      if (!cmd.targets || cmd.targets.length === 0) throw new CommandError(t('cmd.deleteKeepBodyNeedsTargets'));
      if (cmd.targets.some((r) => r.kind !== 'body')) throw new CommandError(t('cmd.deleteKeepBodyOnlyBodies'));
      if (cmd.mode !== 'delete' && cmd.mode !== 'keep') throw new CommandError(t('cmd.deleteKeepBodyModeInvalid'));
      f.mode = cmd.mode;
      f.targets = cmd.targets;
      return;
    }
    case 'setGear': {
      const f=feature(draft,cmd.featureId);
      if(f.type!=='gear'&&f.type!=='rack')throw new CommandError(t('gear.invalid'));
      const allowed=['plane','module','teeth','pressureAngle','width','backlash',f.type==='gear'?'bore':'baseHeight'];
      if(Object.keys(cmd.params).some(key=>!allowed.includes(key)))throw new CommandError(t('gear.invalid'));
      const next={...f,...cmd.params} as Feature;validateNewFeature(draft as PartDoc,next,draft.features.indexOf(f));Object.assign(f,cmd.params);checkExprs(draft as PartDoc,f as Feature);return;
    }
    case 'setSurfaceTools': {
      const f=feature(draft,cmd.featureId);
      if(f.type!=='ruledSurface'&&f.type!=='radiatedSurface'&&f.type!=='replaceFace')throw new CommandError(t('surfaceTools.invalid'));
      const next={...f,...cmd.params} as typeof f;
      const allowed=f.type==='ruledSurface'?['first','second','reverseSecond']:f.type==='radiatedSurface'?['edge','plane','distance','reverse']:['face','replacement'];
      if(Object.keys(cmd.params).some(k=>!allowed.includes(k)))throw new CommandError(t('surfaceTools.invalid'));
      validateNewFeature(draft as PartDoc,next,draft.features.indexOf(f));Object.assign(f,cmd.params);checkExprs(draft as PartDoc,f as Feature);return;
    }
    case 'setProjectedCurve': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'projectedCurve') throw new CommandError(t('projection.mode'));
      const next = { ...f, ...cmd.params };
      validateNewFeature(draft as PartDoc, next, draft.features.indexOf(f));
      Object.assign(f, cmd.params);
      return;
    }
    case 'setHelix': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'helix') throw new CommandError(t('cmd.onlyHelix'));
      if (cmd.params.circle) {
        if (cmd.params.circle.kind !== 'edge' && cmd.params.circle.kind !== 'datum') {
          throw new CommandError(t('cmd.helixNeedsCircle'));
        }
        f.circle = cmd.params.circle;
      }
      if (cmd.params.definedBy !== undefined) {
        if (cmd.params.definedBy !== 'pitchAndRev' && cmd.params.definedBy !== 'heightAndRev' && cmd.params.definedBy !== 'heightAndPitch' && cmd.params.definedBy !== 'spiral') {
          throw new CommandError(t('cmd.helixModeInvalid'));
        }
        f.definedBy = cmd.params.definedBy;
      }
      if (cmd.params.pitch !== undefined) f.pitch = cmd.params.pitch;
      if (cmd.params.revolutions !== undefined) f.revolutions = cmd.params.revolutions;
      if (cmd.params.height !== undefined) f.height = cmd.params.height;
      if (cmd.params.startAngle !== undefined) f.startAngle = cmd.params.startAngle;
      if (cmd.params.clockwise !== undefined) f.clockwise = cmd.params.clockwise;
      if (cmd.params.reverse !== undefined) f.reverse = cmd.params.reverse;
      if (cmd.params.taperAngle !== undefined) f.taperAngle = cmd.params.taperAngle;
      if (cmd.params.taperOutward !== undefined) f.taperOutward = cmd.params.taperOutward;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setBody': {
      if (!cmd.bodyId) throw new CommandError(t('cmd.bodyIdEmpty'));
      const props = { ...(draft.bodies[cmd.bodyId] ?? {}) };
      if (cmd.name !== undefined) {
        const name = cmd.name.trim();
        if (name) props.name = name;
        else delete props.name;
      }
      if (cmd.reference !== undefined) {
        if (cmd.reference) props.reference = true;
        else delete props.reference;
      }
      if (Object.keys(props).length === 0) delete draft.bodies[cmd.bodyId];
      else draft.bodies[cmd.bodyId] = props;
      return;
    }
    case 'setMoveFace': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'moveFace') throw new CommandError(t('cmd.onlyMoveFaceHasParams'));
      if (cmd.face.kind !== 'face') throw new CommandError(t('cmd.moveFaceOnlyFace'));
      f.face = cmd.face;
      f.distance = cmd.distance;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setSuppressed': {
      const targets = cmd.featureIds.map((id) => feature(draft, id)); // all exist, or nothing changes
      for (const f of targets) f.suppressed = cmd.value;
      return;
    }
    case 'deleteFeatures': {
      const ids = new Set(cmd.featureIds);
      for (const id of ids) feature(draft, id);
      if (ids.size === 0) return;
      const doomed = draft.features.filter((f) => ids.has(f.id)) as Feature[];
      countersFor(doomed.flatMap(featureIds), draft.idCounters); // deleted ids are never handed out again
      if (draft.rollbackIndex !== null) {
        draft.rollbackIndex -= draft.features.slice(0, draft.rollbackIndex).filter((f) => ids.has(f.id)).length;
      }
      draft.features = draft.features.filter((f) => !ids.has(f.id));
      for (const id of ids) delete draft.visibility[id];
      // what was said about the bodies a deleted feature made goes with it (their ids are the feature's, `<id>#2` …)
      for (const body of Object.keys(draft.bodies)) if (ids.has(bodyFeature(body))) delete draft.bodies[body];
      for (const key of Object.keys(draft.visibility)) if (isBodyKey(key) && ids.has(bodyFeature(key.slice('body:'.length)))) delete draft.visibility[key];
      if (draft.rollbackIndex !== null && draft.rollbackIndex >= draft.features.length) draft.rollbackIndex = null;
      // Imported data no feature uses any more is dropped too (its id stays issued).
      const used = new Set(draft.features.flatMap((f) => (f.type === 'importedBody' ? [f.blob] : [])));
      draft.blobs = draft.blobs.filter((b) => used.has(b.id));
      return;
    }
    case 'renameFeature': {
      const name = cmd.name.trim();
      if (!name) throw new CommandError(t('cmd.nameEmpty'));
      const target = feature(draft, cmd.featureId);
      const old = target.name;
      target.name = name;
      if (target.type === 'sketch' && old !== name) rewriteNames(draft, (r) => (r.kind === 'dimension' && r.owner === old ? { ...r, owner: name } : null));
      return;
    }
    case 'arrange': {
      const old = draft.features.map((f) => f.id);
      if (cmd.order.length !== old.length || new Set(cmd.order).size !== old.length || cmd.order.some((id) => !old.includes(id))) throw new CommandError(t('cmd.arrangeNotAll'));
      const bar = draft.rollbackIndex ?? old.length;
      if (cmd.order.slice(0, bar).some((id) => !old.slice(0, bar).includes(id))) throw new CommandError(t('cmd.arrangeAcrossBar'));
      const byId = new Map(draft.features.map((f) => [f.id, f]));
      const next = cmd.order.map((id) => byId.get(id)!);
      for (const [id, folder] of Object.entries(cmd.folders ?? {})) {
        const target = byId.get(id);
        if (!target) throw new CommandError(t('cmd.featureNotFound', { id }));
        if (folder === null || folder.trim() === '') delete target.folder;
        else target.folder = folder.trim();
      }
      // the features of a folder follow one another
      const seen = new Set<string>();
      let before: string | undefined;
      for (const f of next) {
        if (f.folder !== before && f.folder !== undefined) {
          if (seen.has(f.folder)) throw new CommandError(t('cmd.folderApart', { folder: f.folder }));
          seen.add(f.folder);
        }
        before = f.folder;
      }
      draft.features = next;
      return;
    }
    case 'setFeatureNote': {
      const target = feature(draft, cmd.featureId);
      for (const key of ['comment', 'tag'] as const) {
        const value = cmd[key];
        if (value === undefined) continue;
        if (value.trim() === '') delete target[key];
        else target[key] = key === 'tag' ? value.trim() : value;
      }
      return;
    }
    case 'setRollback': {
      const n = draft.features.length;
      if (cmd.index !== null && (!Number.isInteger(cmd.index) || cmd.index < 0 || cmd.index > n)) {
        throw new CommandError(t('cmd.rollbackOutOfRange', { index: cmd.index }));
      }
      draft.rollbackIndex = cmd.index === n ? null : cmd.index;
      return;
    }
    case 'addSketchItems': {
      const f = sketchOf(draft, cmd.featureId);
      const ids = [...cmd.entities.map((e) => e.id), ...cmd.constraints.map((c) => c.id)];
      if (ids.length === 0) return;
      assertFresh(draft as PartDoc, ids);
      const err = sketchError({ entities: [...f.entities, ...cmd.entities], constraints: [...f.constraints, ...cmd.constraints] });
      if (err) throw new CommandError(err);
      sketchDatums(draft as PartDoc, cmd.entities, draft.features.findIndex((x) => x.id === cmd.featureId));
      f.entities.push(...(cmd.entities as Draft<SketchEntity>[]));
      f.constraints.push(...(cmd.constraints as Draft<SketchConstraint>[]));
      checkExprs(draft as PartDoc, f as Feature, new Set(ids));
      countersFor(ids, draft.idCounters);
      return;
    }
    case 'editSketch': {
      const f = sketchOf(draft, cmd.featureId);
      for (const patch of cmd.entities ?? []) {
        const e = f.entities.find((x) => x.id === patch.id);
        if (!e) throw new CommandError(t('cmd.sketchItemNotFound', { id: patch.id }));
        for (const [field, value] of Object.entries(patch.set)) {
          if (!(field in e)) throw new CommandError(t('cmd.sketchEditField', { id: patch.id, field }));
          (e as unknown as Record<string, Id | Id[]>)[field] = Array.isArray(value) ? [...value] : value;
        }
      }
      for (const at of cmd.place ?? []) {
        const e = f.entities.find((x) => x.id === at.id);
        if (!e) throw new CommandError(t('cmd.sketchItemNotFound', { id: at.id }));
        const fields: Record<SketchEntity['type'], readonly string[]> = { point: ['x', 'y'], circle: ['radius'], ellipse: ['minorRadius'], text: ['size', 'angle'], line: [], arc: [], spline: [] };
        for (const [field, value] of Object.entries(at)) {
          if (field === 'id' || value === undefined) continue;
          if (!fields[e.type].includes(field)) throw new CommandError(t('cmd.sketchEditField', { id: at.id, field }));
          (e as unknown as Record<string, number>)[field] = value as number;
        }
      }
      for (const patch of cmd.constraints ?? []) {
        const c = f.constraints.find((x) => x.id === patch.id);
        if (!c) throw new CommandError(t('cmd.sketchItemNotFound', { id: patch.id }));
        for (const [field, value] of Object.entries(patch.set)) {
          if (value === undefined) delete (c as unknown as Record<string, unknown>)[field];
          else (c as unknown as Record<string, unknown>)[field] = value;
        }
      }
      // Order: patch, add, then remove — so what the new entities use is not taken for an orphan by the removal.
      const added = cmd.add ?? { entities: [], constraints: [] };
      const ids = [...added.entities.map((e) => e.id), ...added.constraints.map((c) => c.id)];
      if (ids.length > 0) assertFresh(draft as PartDoc, ids);
      f.entities.push(...(added.entities as Draft<SketchEntity>[]));
      f.constraints.push(...(added.constraints as Draft<SketchConstraint>[]));
      if (cmd.remove && cmd.remove.length > 0) {
        const present = new Set<Id>([...f.entities.map((e) => e.id), ...f.constraints.map((c) => c.id)]);
        for (const id of cmd.remove) if (!present.has(id)) throw new CommandError(t('cmd.sketchItemNotFound', { id }));
        const removed = removalSet(f as SketchFeature, cmd.remove);
        countersFor(removed, draft.idCounters);
        f.entities = f.entities.filter((e) => !removed.has(e.id));
        f.constraints = f.constraints.filter((c) => !removed.has(c.id));
      }
      const err = sketchError(f as SketchFeature);
      if (err) throw new CommandError(err);
      sketchDatums(draft as PartDoc, f.entities as SketchEntity[], draft.features.findIndex((x) => x.id === cmd.featureId));
      checkExprs(draft as PartDoc, f as Feature);
      countersFor(ids, draft.idCounters);
      return;
    }
    case 'redefineSketchPlane': {
      const f = sketchOf(draft, cmd.featureId);
      // the same rule as placing a sketch: a plane that exists, earlier in the history than the sketch (a later one would be a cycle in the DAG)
      planeRef(draft as PartDoc, cmd.plane, draft.features.findIndex((x) => x.id === f.id));
      f.plane = cmd.plane;
      return;
    }
    case 'setSketchAttach': {
      const f = sketchOf(draft, cmd.featureId);
      if (cmd.attach === null) {
        delete f.attach;
        return;
      }
      sketchAttachRefs(draft as PartDoc, cmd.attach, draft.features.findIndex((x) => x.id === f.id));
      const { origin, x, flipX } = cmd.attach;
      f.attach = { ...(origin ? { origin } : {}), ...(x ? { x } : {}), ...(flipX ? { flipX: true } : {}) };
      return;
    }
    case 'removeSketchItems': {
      const f = sketchOf(draft, cmd.featureId);
      const present = new Set<Id>([...f.entities.map((e) => e.id), ...f.constraints.map((c) => c.id)]);
      for (const id of cmd.ids) if (!present.has(id)) throw new CommandError(t('cmd.sketchItemNotFound', { id }));
      if (cmd.ids.length === 0) return;
      const removed = removalSet(f as SketchFeature, cmd.ids);
      countersFor(removed, draft.idCounters); // deleted ids stay issued and are never handed out again
      f.entities = f.entities.filter((e) => !removed.has(e.id));
      f.constraints = f.constraints.filter((c) => !removed.has(c.id));
      return;
    }
    case 'setSketchGeometry': {
      const f = sketchOf(draft, cmd.featureId);
      const byId = new Map(f.entities.map((e) => [e.id, e]));
      for (const p of cmd.points) {
        const e = byId.get(p.id);
        if (e?.type !== 'point') throw new CommandError(t('cmd.notSketchPoint', { id: p.id }));
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new CommandError(t('cmd.pointCoordinateInvalid', { id: p.id }));
        e.x = p.x;
        e.y = p.y;
      }
      for (const r of cmd.radii ?? []) {
        const e = byId.get(r.id);
        if (e?.type !== 'circle') throw new CommandError(t('cmd.notCircle', { id: r.id }));
        if (!(Number.isFinite(r.radius) && r.radius > 0)) throw new CommandError(t('cmd.radiusMustBePositive', { id: r.id }));
        e.radius = r.radius;
      }
      return;
    }
    case 'setSketchText': {
      const f = sketchOf(draft, cmd.featureId);
      const e = f.entities.find((x) => x.id === cmd.entityId);
      if (!e) throw new CommandError(t('cmd.sketchItemNotFound', { id: cmd.entityId }));
      if (e.type !== 'text') throw new CommandError(t('cmd.sketchItemNotText', { id: cmd.entityId }));
      if (cmd.text !== undefined) e.text = cmd.text;
      if (cmd.size !== undefined) e.size = cmd.size;
      if (cmd.angle !== undefined) e.angle = cmd.angle;
      if (cmd.align !== undefined) e.align = cmd.align;
      if (cmd.bold !== undefined) e.bold = cmd.bold;
      if (cmd.italic !== undefined) e.italic = cmd.italic;
      if (cmd.font !== undefined) e.font = cmd.font;
      if (cmd.construction !== undefined) e.construction = cmd.construction;
      const err = sketchError(f as SketchFeature);
      if (err) throw new CommandError(err);
      return;
    }
    case 'setVisibility': {
      for (const key of cmd.keys) if (!isHideable(draft as PartDoc, key)) throw new CommandError(t('cmd.cannotHide', { key }));
      for (const key of cmd.keys) draft.visibility[key] = cmd.value;
      return;
    }
    case 'replaceRef': {
      const at = draft.features.findIndex((f) => f.id === cmd.featureId);
      if (at < 0) throw new CommandError(t('cmd.featureNotFound', { id: cmd.featureId }));
      const { from, to } = cmd;
      if (from.kind !== 'face' && from.kind !== 'edge' && from.kind !== 'vertex') throw new CommandError(t('cmd.replaceOnlyElements'));
      if (to.kind !== from.kind) throw new CommandError(t('cmd.replaceSameKind'));
      const { feature: next, replaced } = mapRefs(current(draft.features[at]!) as Feature, (r) => (r.kind === from.kind && r.name === from.name ? to : r));
      if (replaced === 0) throw new CommandError(t('cmd.replaceRefMissing', { name: from.name }));
      // Two edges of a fillet may now name the same edge: keep one.
      if (next.type === 'fillet' || next.type === 'chamfer') {
        next.edges = next.edges.filter((r, i) => next.edges.findIndex((x) => x.kind === r.kind && x.name === r.name) === i);
        if (next.faces) next.faces = next.faces.filter((r, i) => next.faces!.findIndex((x) => x.name === r.name) === i);
        if (next.type === 'fillet') {
          for (const key of ['faces2', 'center'] as const) {
            const list = next[key];
            if (list) next[key] = list.filter((r, i) => list.findIndex((x) => x.name === r.name) === i);
          }
          // two edges that now name the same edge also bring their control points together: the edge that stayed keeps its own
          if (next.variable?.length) {
            const kept = new Map<string, FilletVariablePoint>();
            for (const p of next.variable) {
              const key = `${p.edge}:${p.t}`;
              if (!kept.has(key)) kept.set(key, p);
            }
            next.variable = [...kept.values()];
          }
        }
      }
      if (next.type === 'deleteFace') next.faces = next.faces.filter((r, i) => next.faces.findIndex((x) => x.name === r.name) === i);
      draft.features[at] = next as Draft<Feature>;
      return;
    }
    case 'addVariable': {
      const { variable } = cmd;
      if (!NAME.test(variable.name)) throw new CommandError(t('cmd.variableNameInvalid', { name: variable.name }));
      if (draft.variables.some((v) => v.name === variable.name)) throw new CommandError(t('cmd.variableNameTaken', { name: variable.name }));
      assertFresh(draft as PartDoc, [variable.id]);
      draft.variables.push(variable as Draft<Variable>);
      countersFor([variable.id], draft.idCounters);
      checkVariable(draft as PartDoc, variable.id);
      return;
    }
    case 'setVariable': {
      const at = draft.variables.findIndex((v) => v.id === cmd.id);
      if (at < 0) throw new CommandError(t('cmd.variableNotFound', { id: cmd.id }));
      const old = draft.variables[at]!.name;
      if (cmd.name !== undefined && cmd.name !== old) {
        if (!NAME.test(cmd.name)) throw new CommandError(t('cmd.variableNameInvalid', { name: cmd.name }));
        if (draft.variables.some((v) => v.name === cmd.name)) throw new CommandError(t('cmd.variableNameTaken', { name: cmd.name }));
        const name = cmd.name;
        draft.variables[at]!.name = name;
        rewriteNames(draft, (r) => (r.kind === 'variable' && r.name === old ? { kind: 'variable', name } : null));
      }
      if (cmd.expr !== undefined) draft.variables[at]!.expr = cmd.expr;
      checkVariable(draft as PartDoc, cmd.id);
      return;
    }
    case 'deleteVariable': {
      const v = draft.variables.find((x) => x.id === cmd.id);
      if (!v) throw new CommandError(t('cmd.variableNotFound', { id: cmd.id }));
      const users = variableUsers(draft as PartDoc, v.name);
      const names = [...users.variables, ...users.features.map((id) => draft.features.find((f) => f.id === id)?.name ?? id)];
      if (names.length > 0) throw new CommandError(t('cmd.variableInUse', { name: v.name, users: names.join(t('cmd.listSeparator')) }));
      countersFor([v.id], draft.idCounters);
      draft.variables = draft.variables.filter((x) => x.id !== cmd.id);
      return;
    }
    case 'setProperty': {
      const name = cmd.name.trim();
      if (!name) throw new CommandError(t('cmd.propertyNameEmpty'));
      draft.properties[name] = cmd.value;
      return;
    }
    case 'setMaterial': {
      if (cmd.material === null) delete draft.material;
      else {
        if (!materialOk(cmd.material)) throw new CommandError(t('cmd.materialInvalid'));
        draft.material = { ...(cmd.material.id ? { id: cmd.material.id } : {}), name: cmd.material.name.trim(), density: cmd.material.density };
      }
      return;
    }
    case 'setSheetGauges': {
      const seen = new Set<string>();
      for (const g of cmd.gauges) {
        const name = g.name.trim();
        if (name === '') throw new CommandError(t('cmd.gaugeName'));
        if (seen.has(name)) throw new CommandError(t('cmd.gaugeDuplicate', { name }));
        seen.add(name);
        if (!(g.thickness > 0) || !(g.radius > 0) || !Number.isFinite(g.thickness + g.radius) || !(g.kFactor >= 0 && g.kFactor <= 1)) throw new CommandError(t('cmd.gaugeSizes', { name }));
      }
      if (cmd.gauges.length === 0) delete draft.sheetGauges;
      else draft.sheetGauges = cmd.gauges.map((g) => ({ name: g.name.trim(), thickness: g.thickness, radius: g.radius, kFactor: g.kFactor }));
      return;
    }
    case 'setAppearance': {
      if (cmd.color !== null && !colorOk(cmd.color)) throw new CommandError(t('cmd.colorInvalid'));
      const target = cmd.target;
      if (target.kind === 'feature' && !draft.features.some((f) => f.id === target.id)) throw new CommandError(t('cmd.appearanceFeatureGone'));
      if (target.kind === 'face' && target.ref.kind !== 'face') throw new CommandError(t('cmd.appearanceNeedsFace'));
      const rest = draft.appearances.filter((a) => !sameTarget(a.target, target));
      draft.appearances = cmd.color === null ? rest : [...rest, { target, color: cmd.color.toLowerCase() }];
      return;
    }
    case 'setSettings': {
      const s = cmd.settings;
      if (s.dimensionPrecision !== undefined && !(Number.isInteger(s.dimensionPrecision) && s.dimensionPrecision >= 0 && s.dimensionPrecision <= 6)) throw new CommandError(t('cmd.precisionRange'));
      draft.settings = { ...draft.settings, ...s };
      return;
    }
    case 'deleteProperty': {
      if (!(cmd.name in draft.properties)) throw new CommandError(t('cmd.propertyNotFound', { name: cmd.name }));
      delete draft.properties[cmd.name];
      return;
    }
    case 'setDimensionLabel': {
      const f = sketchOf(draft, cmd.featureId);
      const c = f.constraints.find((x) => x.id === cmd.constraintId);
      if (!c || !isDimension(c)) throw new CommandError(t('cmd.dimensionNotFound', { id: cmd.constraintId }));
      const before = dimensionName(c);
      const label = cmd.label.trim();
      if (label) {
        if (!NAME.test(label)) throw new CommandError(t('cmd.dimensionLabelInvalid', { name: label }));
        if (f.constraints.some((x) => x.id !== c.id && isDimension(x) && dimensionName(x) === label)) throw new CommandError(t('cmd.dimensionLabelTaken', { name: label }));
        c.label = label;
      } else delete c.label;
      const after = dimensionName(c as SketchConstraint);
      if (after !== before) rewriteNames(draft, (r) => (r.kind === 'dimension' && r.name === before && r.owner === f.name ? { ...r, name: after } : null));
      return;
    }
    case 'setConstruction': {
      const f = sketchOf(draft, cmd.featureId);
      for (const id of cmd.ids) {
        const e = f.entities.find((x) => x.id === id);
        if (!e || e.type === 'point') throw new CommandError(t('cmd.constructionOnlyCurves', { id }));
        if (cmd.value) e.construction = true;
        else delete e.construction;
      }
      return;
    }
  }
}

/** Pure command application: returns a new document, the input is never modified. */
export function applyCommand(doc: PartDoc, cmd: Command): PartDoc {
  return produce(doc, (d) => mutate(d, cmd));
}
