import type { Feature, Ref } from './schema';

/**
 * Rewrites every reference of a feature (B4.3): `map` gets each `Ref` and returns the one to keep.
 * Returns a copy of the feature and how many references were replaced (a returned ref that is the
 * same object counts as unchanged). Lists of references (edges, three-point planes) keep their order.
 */
export function mapRefs(feature: Feature, map: (ref: Ref) => Ref): { feature: Feature; replaced: number } {
  let replaced = 0;
  const one = (ref: Ref): Ref => {
    const next = map(ref);
    if (next !== ref) replaced += 1;
    return next;
  };
  switch (feature.type) {
    case 'sketch': {
      // the model edges that projected entities and pierce points follow (C1.18)
      const entities = feature.entities.map((e) => {
        if (e.type === 'point') return e.pierce ? { ...e, pierce: one(e.pierce) } : e;
        return e.ref ? { ...e, ref: one(e.ref) } : e;
      });
      return { feature: { ...feature, plane: one(feature.plane), entities }, replaced };
    }
    case 'extrude': {
      const cond = <C extends { type: string }>(c: C): C => {
        const d = c as unknown as { face?: Ref; vertex?: Ref; body?: Ref };
        if (c.type === 'upToFace' || c.type === 'offsetFromFace') return { ...c, face: one(d.face!) } as C;
        if (c.type === 'upToVertex') return { ...c, vertex: one(d.vertex!) } as C;
        if (c.type === 'upToBody') return { ...c, body: one(d.body!) } as C;
        return c;
      };
      const next = { ...feature, dir1: cond(feature.dir1), ...(feature.dir2 ? { dir2: cond(feature.dir2) } : {}) };
      return { feature: next, replaced };
    }
    case 'fillet':
    case 'chamfer':
      return { feature: { ...feature, edges: feature.edges.map(one) }, replaced };
    case 'refPlane': {
      const d = feature.def;
      const def = d.mode === 'threePoint' ? { ...d, points: d.points.map(one) } : d.mode === 'angle' ? { ...d, plane: one(d.plane), axis: one(d.axis) } : { ...d, plane: one(d.plane) };
      return { feature: { ...feature, def }, replaced };
    }
    case 'deleteFace':
    case 'shell':
      return { feature: { ...feature, faces: feature.faces.map(one) }, replaced };
    case 'draft':
      return { feature: { ...feature, neutral: one(feature.neutral), faces: feature.faces.map(one) }, replaced };
    case 'moveFace':
      return { feature: { ...feature, face: one(feature.face) }, replaced };
    case 'combine':
      return { feature: { ...feature, main: one(feature.main), tools: feature.tools.map(one) }, replaced };
    case 'revolve':
    case 'sweep':
    case 'hole':
    case 'importedBody':
      return { feature, replaced };
  }
}
