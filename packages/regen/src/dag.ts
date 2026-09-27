import type { Feature, Id, PartDoc, Ref } from '@3db/model';
import { ownerFeatures } from '@3db/naming';

/**
 * Parent/child relations (B2.2) derived on demand from the references inside features.
 * They are never stored: a second copy would be a second source of truth.
 */
export function parentsOf(feature: Feature, doc: PartDoc): Id[] {
  const ids = new Set(doc.features.map((f) => f.id));
  const fromRefs = (refs: Ref[]) => refs.flatMap((r) => (r.kind === 'datum' ? [] : ownerFeatures(r.name)));
  let parents: Id[];
  switch (feature.type) {
    case 'sketch':
      parents = fromRefs([feature.plane]);
      break;
    case 'extrude':
      parents = [feature.sketch, ...[feature.dir1, feature.dir2].flatMap((d) => (d?.type === 'upToFace' ? fromRefs([d.face]) : []))];
      break;
    case 'fillet':
      parents = fromRefs(feature.edges);
      break;
  }
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

/** All features that (transitively) depend on `id` — what suppress/delete must consider (B2.6, B2.8). */
export function descendants(deps: Dependencies, id: Id): Id[] {
  const out = new Set<Id>();
  const stack = [...(deps.children.get(id) ?? [])];
  while (stack.length) {
    const c = stack.pop()!;
    if (out.has(c)) continue;
    out.add(c);
    stack.push(...(deps.children.get(c) ?? []));
  }
  return [...out];
}
