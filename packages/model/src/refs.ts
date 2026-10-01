import type { Feature, Ref } from './schema';

const isRef = (v: unknown): v is Ref => typeof v === 'object' && v !== null && typeof (v as Ref).kind === 'string' && typeof (v as Ref).name === 'string';

/**
 * The references a definition of a reference plane, axis, point or coordinate system holds (C3.2–C3.5), in the order they are written. Every
 * property that is a `Ref` or a list of them counts, so a new mode with its own references needs nothing here.
 */
export function defRefs(def: object): Ref[] {
  return Object.values(def).flatMap((v) => (isRef(v) ? [v] : Array.isArray(v) ? v.filter(isRef) : []));
}

/** The same definition with each reference replaced by `map`'s answer; references in lists keep their place. */
export function mapDefRefs<D extends object>(def: D, map: (ref: Ref) => Ref): D {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(def)) out[k] = isRef(v) ? map(v) : Array.isArray(v) ? v.map((x) => (isRef(x) ? map(x) : x)) : v;
  return out as D;
}

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
    case 'refPlane':
    case 'refAxis':
    case 'refPoint':
      return { feature: { ...feature, def: mapDefRefs(feature.def, one) } as Feature, replaced };
    case 'coordSys':
      return { feature: { ...feature, ...(feature.origin ? { origin: one(feature.origin) } : {}), x: one(feature.x), y: one(feature.y) }, replaced };
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
    case 'loft':
    case 'rib':
    case 'hole':
    case 'importedBody':
      return { feature, replaced };
  }
}
