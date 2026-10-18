import { bodyFeature, defRefs, expressionParents, type Feature, type Id, type PartDoc, type Ref } from '@3db/model';
import { ownerFeatures } from '@3db/naming';

/**
 * Parent/child relations (B2.2) derived on demand from the references inside features.
 * They are never stored: a second copy would be a second source of truth.
 */
export function parentsOf(feature: Feature, doc: PartDoc): Id[] {
  const ids = new Set(doc.features.map((f) => f.id));
  // A datum reference names a default plane (no parent) or a reference plane feature (its id).
  const fromRefs = (refs: Ref[]) => refs.flatMap((r) => (r.kind === 'datum' ? [r.name] : ownerFeatures(r.name)));
  let parents: Id[];
  switch (feature.type) {
    case 'sketch':
      parents = fromRefs([feature.plane]);
      break;
    case 'extrude':
      parents = [
        feature.sketch,
        ...[feature.dir1, feature.dir2].flatMap((d) => (d?.type === 'upToFace' || d?.type === 'offsetFromFace' ? fromRefs([d.face]) : d?.type === 'upToVertex' ? fromRefs([d.vertex]) : d?.type === 'upToBody' && d.body.name ? [bodyFeature(d.body.name)] : [])),
      ];
      break;
    case 'revolve':
    case 'hole':
    case 'screwBoss':
    case 'baseFlange':
    case 'midBend':
    case 'snapHook':
    case 'snapCatch':
    case 'vent':
    case 'rib':
      parents = [feature.sketch];
      break;
    case 'sweep':
      parents = [feature.sketch, feature.path];
      break;
    case 'thread':
      parents = [...(feature.sketch ? [feature.sketch] : []), ...(typeof feature.axis === 'string' ? [] : fromRefs([feature.axis]))];
      break;
    case 'knurl':
      parents = fromRefs([feature.axis]);
      break;
    case 'loft':
      parents = [...feature.sections];
      break;
    case 'edgeFlange':
    case 'hem':
      parents = fromRefs([feature.edge]);
      break;
    case 'breakCorner':
      parents = fromRefs(feature.corners);
      break;
    case 'chamfer':
      parents = fromRefs([...feature.edges, ...(feature.faces ?? [])]);
      break;
    case 'fillet':
      parents = fromRefs([...feature.edges, ...(feature.faces ?? []), ...(feature.faces2 ?? []), ...(feature.center ?? [])]);
      break;
    case 'deleteFace':
    case 'offsetSurface':
      parents = fromRefs(feature.faces);
      break;
    case 'shell':
      parents = fromRefs([...feature.faces, ...(feature.faceThickness ?? []).map((x) => x.face)]);
      break;
    case 'moveFace':
    case 'lipGroove':
      parents = fromRefs([feature.face]);
      break;
    case 'splitLine':
    case 'trimSurface':
      parents = [feature.sketch, ...fromRefs([feature.face])];
      break;
    case 'knit':
      parents = feature.bodies.filter((r) => r.name).map((r) => bodyFeature(r.name));
      break;
    case 'mutualTrim':
      // the pieces to take away are faces of the bodies as the feature makes them, named after the faces they came from: whoever made those is a parent, the feature itself is not
      parents = [...[feature.a, feature.b].filter((r) => r.name).map((r) => bodyFeature(r.name)), ...fromRefs(feature.discard ?? []).filter((id) => id !== feature.id)];
      break;
    case 'thicken':
      parents = feature.body.name ? [bodyFeature(feature.body.name)] : [];
      break;
    case 'cutWithSurface':
      parents = [...[feature.target, feature.surface].filter((r) => r.name).map((r) => bodyFeature(r.name)), ...(feature.direction.kind === 'vector' ? [] : fromRefs([feature.direction]))];
      break;
    case 'fillSurface':
    case 'flatSurface':
    case 'extendSurface':
      parents = fromRefs(feature.edges);
      break;
    case 'draft':
      parents = fromRefs([feature.neutral, ...feature.faces]);
      break;
    case 'combine':
      // a body is named by the feature that made it (`extrude1`, or `cut1#2` for a piece a cut left)
      parents = [feature.main, ...feature.tools].filter((r) => r.name).map((r) => bodyFeature(r.name));
      break;
    case 'split': {
      const toolParents = feature.tool.kind === 'face' ? fromRefs([feature.tool]) : [];
      const targetParents = (feature.targets ?? []).filter((r) => r.name).map((r) => bodyFeature(r.name));
      parents = [...toolParents, ...targetParents];
      break;
    }
    case 'refPlane':
    case 'refAxis':
    case 'refPoint':
      parents = fromRefs(defRefs(feature.def));
      break;
    case 'pattern':
      parents = [...feature.seeds, ...fromRefs(defRefs(feature.def))];
      break;
    case 'mirror':
      // a body is named by the feature that made it
      parents = [...(feature.target === 'features' ? feature.seeds : feature.bodies.filter((r) => r.name).map((r) => bodyFeature(r.name))), ...fromRefs([feature.plane])];
      break;
    case 'coordSys':
      parents = fromRefs([...(feature.origin ? [feature.origin] : []), feature.x, feature.y]);
      break;
    case 'importedBody':
      parents = []; // it depends only on its data
      break;
    case 'cosmeticThread':
      parents = fromRefs([feature.targetFace, ...(feature.startEdge ? [feature.startEdge] : [])]);
      break;
    case 'derivedBody':
      parents = []; // it depends only on another file
      break;
  }
  // a dimension of another sketch used in an expression, directly or through a variable (B5.3)
  parents.push(...expressionParents(doc, feature));
  return [...new Set(parents)].filter((p) => p !== feature.id && ids.has(p));
}

export interface Dependencies {
  parents: Map<Id, Id[]>;
  children: Map<Id, Id[]>;
}

export function dependencies(doc: PartDoc): Dependencies {
  const parents = new Map<Id, Id[]>();
  const children = new Map<Id, Id[]>(doc.features.map((f) => [f.id, []]));
  for (const f of doc.features) {
    const ps = parentsOf(f, doc);
    parents.set(f.id, ps);
    for (const p of ps) children.get(p)?.push(f.id);
  }
  return { parents, children };
}

function reach(next: Map<Id, Id[]>, id: Id): Id[] {
  const out = new Set<Id>();
  const stack = [...(next.get(id) ?? [])];
  while (stack.length) {
    const c = stack.pop()!;
    if (out.has(c)) continue;
    out.add(c);
    stack.push(...(next.get(c) ?? []));
  }
  return [...out];
}

/** All features that (transitively) depend on `id` — what suppress/delete must consider (B2.6, B2.8). */
export function descendants(deps: Dependencies, id: Id): Id[] {
  return reach(deps.children, id);
}

/** All features `id` (transitively) depends on. */
export function ancestors(deps: Dependencies, id: Id): Id[] {
  return reach(deps.parents, id);
}

/** Keeps history order, so a command lists features the way the FeatureManager shows them. */
const inOrder = (doc: PartDoc, ids: Iterable<Id>) => {
  const set = new Set(ids);
  return doc.features.filter((f) => set.has(f.id)).map((f) => f.id);
};

export type SuppressAction = 'suppress' | 'unsuppress' | 'unsuppressWithDependents';

/**
 * Features whose suppression changes (B2.6), as in SolidWorks: suppressing a feature also
 * suppresses everything that depends on it; unsuppressing brings back the feature and whatever
 * it needs, and 「恢復抑制（含相依特徵）」 its dependents as well.
 */
export function suppressionTargets(doc: PartDoc, id: Id, action: SuppressAction): Id[] {
  const deps = dependencies(doc);
  const set = new Set<Id>([id]);
  if (action === 'suppress') for (const d of descendants(deps, id)) set.add(d);
  else {
    for (const a of ancestors(deps, id)) set.add(a);
    if (action === 'unsuppressWithDependents') for (const d of descendants(deps, id)) set.add(d);
  }
  const wanted = action === 'suppress';
  return inOrder(doc, [...set].filter((x) => doc.features.find((f) => f.id === x)?.suppressed !== wanted));
}

export interface Deletion {
  /** The features that will be deleted, in history order. */
  features: Id[];
  /** Features depending on the deleted ones (deleted only with `children`). */
  children: Id[];
  /** Sketches only the deleted features used (deleted only with `absorbed`). */
  absorbed: Id[];
}

/**
 * What deleting `id` involves (B2.8): its dependent features, and the sketches that would be left
 * unused ("absorbed" in SolidWorks). The dialog decides; the model only deletes what it is given.
 */
export function deletion(doc: PartDoc, id: Id, options: { children: boolean; absorbed: boolean }): Deletion {
  const deps = dependencies(doc);
  const children = descendants(deps, id);
  const doomed = new Set<Id>([id, ...(options.children ? children : [])]);
  const absorbed = doc.features
    .filter((f) => f.type === 'sketch' && !doomed.has(f.id))
    .filter((s) => {
      const users = deps.children.get(s.id) ?? [];
      return users.length > 0 && users.every((u) => doomed.has(u));
    })
    .map((s) => s.id);
  if (options.absorbed) for (const s of absorbed) doomed.add(s);
  return { features: inOrder(doc, doomed), children: inOrder(doc, children), absorbed: inOrder(doc, absorbed) };
}

/**
 * Whether the history may be put in this order (B2.5, "受 DAG 約束"): every feature has to come after what it is built on. Returns the first feature, in the new
 * order, that would come before one of its parents, with that parent; null when the order is fine. The parents are those of the document as it is (a move does
 * not change what refers to what).
 */
export function orderProblem(doc: PartDoc, order: Id[]): { feature: Id; parent: Id } | null {
  const at = new Map(order.map((id, i) => [id, i]));
  const { parents } = dependencies(doc);
  for (const id of order) {
    for (const p of parents.get(id) ?? []) if ((at.get(p) ?? -1) > at.get(id)!) return { feature: id, parent: p };
  }
  return null;
}
