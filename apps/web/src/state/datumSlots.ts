import { t } from '@3db/i18n';
import { findFeature, isDatumPlaneName, type AxisDefinition, type Command, type Feature, type Id, type PartDoc, type PatternDefinition, type PlaneDefinition, type PointDefinition, type Ref } from '@3db/model';

/**
 * The selection boxes of reference geometry (C3.2–C3.5): a plane, axis, point or coordinate system is defined by references, and what is clicked in
 * the graphics area or the PropertyManager's buttons goes to the first box that wants that kind of element. One table here says which boxes each kind of
 * definition has, patterns' directions and axis too, so the PropertyManager, the picking in the graphics area and the tree clicks cannot disagree.
 */

/** What a box takes: a planar face or plane; a straight edge or axis; a vertex or point; a cylindrical face; a cylindrical or conical face; an edge or face; a direction; a curve path (3D edge or sketch); or a circle (a circular edge or a sketch with one circle). */
export type SlotType = 'plane' | 'axis' | 'point' | 'cylinder' | 'revolved' | 'element' | 'direction' | 'rotationAxis' | 'curvePath' | 'circle';

export interface Slot {
  /** The property of the definition (or of the coordinate system) the box fills. */
  key: string;
  label: string;
  type: SlotType;
  /** What is in the box; for a list the elements (up to `list` of them); an empty reference counts as nothing. */
  refs: Ref[];
  list?: number;
  /** A coordinate system's origin may stay empty (the part origin). */
  optional?: boolean;
}

/** What kind of datum a name is: a plane (a default plane, a reference plane or a coordinate system), an axis or a point. */
const datumType = (doc: PartDoc, name: string): 'plane' | 'axis' | 'point' | null => {
  if (isDatumPlaneName(name)) return 'plane';
  const type = findFeature(doc, name)?.type;
  return type === 'refPlane' || type === 'coordSys' ? 'plane' : type === 'refAxis' ? 'axis' : type === 'refPoint' ? 'point' : null;
};

/** Does a box of this type take this element? Faces and edges are told apart by the fingerprint they were picked with. */
export function accepts(type: SlotType, ref: Ref, doc: PartDoc): boolean {
  const fp = ref.fingerprint?.type;
  const datum = ref.kind === 'datum' ? datumType(doc, ref.name) : null;
  const planar = (ref.kind === 'face' && fp === 'plane') || datum === 'plane';
  const straight = (ref.kind === 'edge' && fp === 'line') || datum === 'axis';
  switch (type) {
    case 'plane':
      return planar;
    case 'axis':
      return straight;
    case 'point':
      return ref.kind === 'vertex' || datum === 'point';
    case 'cylinder':
      return ref.kind === 'face' && fp === 'cylinder';
    case 'revolved':
      return ref.kind === 'face' && (fp === 'cylinder' || fp === 'cone');
    case 'element':
      return ref.kind === 'edge' || ref.kind === 'face';
    case 'direction':
      return planar || straight;
    case 'rotationAxis':
      return straight || (ref.kind === 'face' && (fp === 'cylinder' || fp === 'cone'));
    case 'curvePath':
      return ref.kind === 'edge' || (ref.kind === 'datum' && findFeature(doc, ref.name)?.type === 'sketch');
    case 'circle':
      // how many circles the sketch has is the rebuild's to say (it names the count); here only the kind is checked
      return (ref.kind === 'edge' && fp === 'circle') || (ref.kind === 'datum' && findFeature(doc, ref.name)?.type === 'sketch');
  }
}

/** A box not filled in yet, as a reference of the kind the model accepts there. */
export function emptyRef(type: SlotType): Ref {
  return { kind: type === 'plane' || type === 'cylinder' || type === 'revolved' ? 'face' : type === 'point' ? 'vertex' : 'edge', name: '' };
}

const one = (key: string, label: string, type: SlotType, ref: Ref | undefined, optional = false): Slot => ({ key, label, type, refs: ref ? [ref] : [], ...(optional ? { optional } : {}) });
const many = (key: string, label: string, type: SlotType, refs: Ref[], list: number): Slot => ({ key, label, type, refs, list });

const planeSlot = (d: { plane: Ref }) => one('plane', t('slot.plane'), 'plane', d.plane);

/** The boxes of a reference plane, in the order they are asked for. */
function planeSlots(d: PlaneDefinition): Slot[] {
  switch (d.mode) {
    case 'offset':
      return [planeSlot(d)];
    case 'angle':
      return [planeSlot(d), one('axis', t('slot.rotationAxis'), 'axis', d.axis)];
    case 'threePoint':
      return [many('points', t('slot.points'), 'point', d.points, 3)];
    case 'parallel':
      return [planeSlot(d), one('point', t('slot.throughPoint'), 'point', d.point)];
    case 'perpendicular':
      return [one('axis', t('slot.perpendicularAxis'), 'axis', d.axis), one('point', t('slot.throughPoint'), 'point', d.point)];
    case 'midplane':
      return [planeSlot(d), one('plane2', t('slot.secondPlane'), 'plane', d.plane2)];
    case 'tangent':
      return [one('face', t('slot.cylinderFace'), 'cylinder', d.face), planeSlot(d)];
  }
}

function axisSlots(d: AxisDefinition): Slot[] {
  switch (d.mode) {
    case 'edge':
      return [one('edge', t('slot.edgeOrAxis'), 'axis', d.edge)];
    case 'twoPoints':
      return [many('points', t('slot.points'), 'point', d.points, 2)];
    case 'cylinder':
      return [one('face', t('slot.revolvedFace'), 'revolved', d.face)];
    case 'planes':
      return [planeSlot(d), one('plane2', t('slot.secondPlane'), 'plane', d.plane2)];
  }
}

function pointSlots(d: PointDefinition): Slot[] {
  switch (d.mode) {
    case 'coords':
      return [];
    case 'center':
      return [one('element', t('slot.edgeOrFace'), 'element', d.element)];
    case 'axisPlane':
      return [one('axis', t('slot.axis'), 'axis', d.axis), planeSlot(d)];
  }
}

/** The boxes of a reference geometry feature (none for any other feature). */
export function slotsOf(f: Feature | undefined): Slot[] {
  switch (f?.type) {
    case 'refPlane':
      return planeSlots(f.def);
    case 'refAxis':
      return axisSlots(f.def);
    case 'refPoint':
      return pointSlots(f.def);
    case 'mirror':
      return [one('plane', t('slot.mirrorPlane'), 'plane', f.plane)];
    case 'pattern':
      return f.def.mode === 'linear'
        ? [one('dir1.ref', t('slot.direction1'), 'direction', f.def.dir1.ref), ...(f.def.dir2 ? [one('dir2.ref', t('slot.direction2'), 'direction', f.def.dir2.ref)] : [])]
        : f.def.mode === 'circular'
          ? [one('axis', t('slot.rotationAxis'), 'rotationAxis', f.def.axis)]
          : [one('path', t('slot.curvePath'), 'curvePath', f.def.path)];
    case 'helix':
      return [one('circle', t('pm.helix.circle'), 'circle', f.circle)];
    case 'coordSys':
      return [one('origin', t('slot.origin'), 'point', f.origin, true), one('x', t('slot.xDirection'), 'direction', f.x), one('y', t('slot.yDirection'), 'direction', f.y)];
    default:
      return [];
  }
}

/** The references in a box that are filled in. */
export const filled = (slot: Slot): Ref[] => slot.refs.filter((r) => r.name);

/** The command that puts `refs` in the box `key` of the feature (an empty list empties the box). */
export function fill(f: Feature, key: string, refs: Ref[]): Command {
  const slot = slotsOf(f).find((s) => s.key === key)!;
  const value = slot.list ? refs : (refs[0] ?? emptyRef(slot.type));
  switch (f.type) {
    case 'refPlane':
      return { type: 'setRefPlane', featureId: f.id, def: { ...f.def, [key]: value } as PlaneDefinition };
    case 'refAxis':
      return { type: 'setRefAxis', featureId: f.id, def: { ...f.def, [key]: value } as AxisDefinition };
    case 'refPoint':
      return { type: 'setRefPoint', featureId: f.id, def: { ...f.def, [key]: value } as PointDefinition };
    case 'mirror':
      return { type: 'setMirror', featureId: f.id, value: { target: f.target, plane: value as Ref, seeds: f.seeds, bodies: f.bodies, ...(f.merge === false ? { merge: false } : {}) } };
    case 'pattern': {
      const d = f.def;
      const ref = value as Ref;
      const def: PatternDefinition =
        d.mode === 'circular'
          ? { ...d, axis: ref }
          : d.mode === 'curve'
            ? { ...d, path: ref }
            : key === 'dir2.ref'
              ? { ...d, dir2: { ...d.dir2!, ref } }
              : { ...d, dir1: { ...d.dir1, ref } };
      return { type: 'setPattern', featureId: f.id, seeds: f.seeds, def, ...(f.skip ? { skip: f.skip } : {}) };
    }
    case 'helix':
      return { type: 'setHelix', featureId: f.id, params: { circle: value as Ref } };
    case 'coordSys': {
      const { origin, x, y } = f;
      const next = { origin, x, y, [key]: key === 'origin' ? refs[0] : value } as { origin?: Ref; x: Ref; y: Ref };
      return { type: 'setCoordSys', featureId: f.id, value: { ...(next.origin ? { origin: next.origin } : {}), x: next.x, y: next.y, ...(f.flipX ? { flipX: true } : {}), ...(f.flipY ? { flipY: true } : {}) } };
    }
    default:
      throw new Error('not a reference geometry feature');
  }
}

export type Put = { command: Command } | { message: string } | null;

/**
 * Where a clicked element goes: the first box that takes it and is still empty; a box that holds a list takes it too (and gives it back when it is
 * clicked again); when every box that would take it is full the last one is replaced. Nothing takes it: null.
 */
export function put(f: Feature, doc: PartDoc, ref: Ref): Put {
  const slots = slotsOf(f).filter((s) => accepts(s.type, ref, doc));
  if (slots.length === 0) return null;
  for (const slot of slots) {
    if (slot.list && filled(slot).some((r) => r.name === ref.name)) return { command: fill(f, slot.key, filled(slot).filter((r) => r.name !== ref.name)) };
  }
  const open = slots.find((s) => (s.list ? filled(s).length < s.list : filled(s).length === 0));
  if (open) return { command: fill(f, open.key, [...(open.list ? filled(open) : []), ref]) };
  const last = slots[slots.length - 1]!;
  if (last.list) return { message: t('slot.listFull', { n: last.list }) };
  return { command: fill(f, last.key, [ref]) };
}

/** The datum reference a feature of the tree stands for (a default or reference plane, a reference axis or point), or null. */
export function treeRef(doc: PartDoc, id: Id): Ref | null {
  return datumType(doc, id) ? { kind: 'datum', name: id } : null;
}

/** What a click on the tree gives the feature being defined: a datum, or a sketch when one of its boxes takes sketches (a curve path, a helix's circle). */
export function treePick(f: Feature, doc: PartDoc, id: Id): Ref | null {
  const datum = treeRef(doc, id);
  if (datum) return datum;
  const sketch: Ref = { kind: 'datum', name: id };
  return findFeature(doc, id)?.type === 'sketch' && slotsOf(f).some((s) => accepts(s.type, sketch, doc)) ? sketch : null;
}

/** What the graphics area picks while this feature is being defined: the kinds of element the empty boxes take. */
export function pickable(f: Feature | undefined): { edges: boolean; faces: boolean; vertices: boolean; planes: boolean } {
  const out = { edges: false, faces: false, vertices: false, planes: false };
  for (const s of slotsOf(f)) {
    if (s.type === 'axis' || s.type === 'direction' || s.type === 'element' || s.type === 'rotationAxis' || s.type === 'curvePath' || s.type === 'circle') out.edges = true;
    if (s.type === 'plane' || s.type === 'cylinder' || s.type === 'revolved' || s.type === 'direction' || s.type === 'element' || s.type === 'rotationAxis') out.faces = true;
    if (s.type === 'point') out.vertices = true;
    if (s.type === 'plane' || s.type === 'direction') out.planes = true;
  }
  return out;
}

/** What to tell the user to click next: the first box that must be filled and is not. */
export function prompt(f: Feature | undefined): string | null {
  const next = slotsOf(f).find((s) => !s.optional && (s.list ? filled(s).length < s.list : filled(s).length === 0));
  return next ? t('slot.pick', { what: next.label }) : null;
}

/** The elements already chosen, for highlighting them in the graphics area (default and reference planes and axes are drawn by their own). */
export function chosen(f: Feature | undefined): { edges: Ref[]; faces: Ref[]; vertices: Ref[]; datums: string[] } {
  const refs = slotsOf(f).flatMap(filled);
  return {
    edges: refs.filter((r) => r.kind === 'edge'),
    faces: refs.filter((r) => r.kind === 'face'),
    vertices: refs.filter((r) => r.kind === 'vertex'),
    datums: refs.filter((r) => r.kind === 'datum').map((r) => r.name),
  };
}

// ------------------------------------------------------------------ definitions by kind

const FRONT: Ref = { kind: 'datum', name: 'plane:front' };

/** A definition of the given kind, taking over the plane the old one had (the front plane when it had none). */
export function planeDefinitionFor(mode: PlaneDefinition['mode'], old: PlaneDefinition): PlaneDefinition {
  const plane = 'plane' in old ? old.plane : FRONT;
  switch (mode) {
    case 'offset':
      return { mode, plane, distance: '10' };
    case 'angle':
      return { mode, plane, axis: emptyRef('axis'), angle: '45' };
    case 'threePoint':
      return { mode, points: [] };
    case 'parallel':
      return { mode, plane, point: emptyRef('point') };
    case 'perpendicular':
      return { mode, axis: emptyRef('axis'), point: emptyRef('point') };
    case 'midplane':
      return { mode, plane, plane2: emptyRef('plane') };
    case 'tangent':
      return { mode, face: emptyRef('cylinder'), plane };
  }
}

export function axisDefinitionFor(mode: AxisDefinition['mode']): AxisDefinition {
  switch (mode) {
    case 'edge':
      return { mode, edge: emptyRef('axis') };
    case 'twoPoints':
      return { mode, points: [] };
    case 'cylinder':
      return { mode, face: emptyRef('revolved') };
    case 'planes':
      return { mode, plane: emptyRef('plane'), plane2: emptyRef('plane') };
  }
}

export function pointDefinitionFor(mode: PointDefinition['mode']): PointDefinition {
  switch (mode) {
    case 'coords':
      return { mode, x: '0', y: '0', z: '0' };
    case 'center':
      return { mode, element: emptyRef('element') };
    case 'axisPlane':
      return { mode, axis: emptyRef('axis'), plane: emptyRef('plane') };
  }
}
