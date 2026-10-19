import type { Feature, Ref } from './schema';

const isRef = (v: unknown): v is Ref => typeof v === 'object' && v !== null && typeof (v as Ref).kind === 'string' && typeof (v as Ref).name === 'string';

/**
 * The references a definition of a reference plane, axis, point, coordinate system or pattern holds (C3.2–C3.5, C6), in the order they are written. Every
 * property that is a `Ref`, a list of them, or an object holding some (a direction of a pattern) counts, so a new mode with its own references needs
 * nothing here.
 */
export function defRefs(def: object): Ref[] {
  return Object.values(def).flatMap((v) => (isRef(v) ? [v] : Array.isArray(v) ? v.filter(isRef) : typeof v === 'object' && v !== null ? defRefs(v) : []));
}

/** The same definition with each reference replaced by `map`'s answer; references in lists keep their place. */
export function mapDefRefs<D extends object>(def: D, map: (ref: Ref) => Ref): D {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(def)) out[k] = isRef(v) ? map(v) : Array.isArray(v) ? v.map((x) => (isRef(x) ? map(x) : x)) : typeof v === 'object' && v !== null ? mapDefRefs(v, map) : v;
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
        if ('ref' in e && e.ref) return { ...e, ref: one(e.ref) };
        return e;
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
    case 'chamfer':
      return { feature: { ...feature, edges: feature.edges.map(one), ...(feature.faces ? { faces: feature.faces.map(one) } : {}) }, replaced };
    case 'fillet':
      return {
        feature: {
          ...feature,
          edges: feature.edges.map(one),
          ...(feature.faces ? { faces: feature.faces.map(one) } : {}),
          ...(feature.faces2 ? { faces2: feature.faces2.map(one) } : {}),
          ...(feature.center ? { center: feature.center.map(one) } : {}),
          // the control points of a variable radius (C5.2) follow the edge they are on: that edge holds their names
          ...(feature.variable ? { variable: feature.variable.map((p) => ({ ...p, edge: map({ kind: 'edge', name: p.edge }).name })) } : {}),
        },
        replaced,
      };
    case 'refPlane':
    case 'refAxis':
    case 'refPoint':
      return { feature: { ...feature, def: mapDefRefs(feature.def, one) } as Feature, replaced };
    case 'pattern':
      return { feature: { ...feature, def: mapDefRefs(feature.def, one) }, replaced };
    case 'mirror':
      return { feature: { ...feature, plane: one(feature.plane), bodies: feature.bodies.map(one) }, replaced };
    case 'coordSys':
      return { feature: { ...feature, ...(feature.origin ? { origin: one(feature.origin) } : {}), x: one(feature.x), y: one(feature.y) }, replaced };
    case 'deleteFace':
    case 'offsetSurface':
      return { feature: { ...feature, faces: feature.faces.map(one) }, replaced };
    case 'shell':
      return { feature: { ...feature, faces: feature.faces.map(one), ...(feature.faceThickness ? { faceThickness: feature.faceThickness.map((x) => ({ ...x, face: one(x.face) })) } : {}) }, replaced };
    case 'draft':
      return { feature: { ...feature, neutral: one(feature.neutral), faces: feature.faces.map(one) }, replaced };
    case 'moveFace':
    case 'splitLine':
    case 'trimSurface':
    case 'lipGroove':
      return { feature: { ...feature, face: one(feature.face) }, replaced };
    case 'edgeFlange':
    case 'hem':
      return { feature: { ...feature, edge: one(feature.edge) }, replaced };
    case 'breakCorner':
      return { feature: { ...feature, corners: feature.corners.map(one) }, replaced };
    case 'knit':
      return { feature: { ...feature, bodies: feature.bodies.map(one) }, replaced };
    case 'mutualTrim':
      return { feature: { ...feature, a: one(feature.a), b: one(feature.b), ...(feature.discard ? { discard: feature.discard.map(one) } : {}) }, replaced };
    case 'thicken':
      return { feature: { ...feature, body: one(feature.body) }, replaced };
    case 'cutWithSurface':
      return { feature: { ...feature, target: one(feature.target), surface: one(feature.surface), direction: feature.direction.kind === 'vector' ? feature.direction : one(feature.direction) }, replaced };
    case 'fillSurface':
    case 'flatSurface':
    case 'extendSurface':
      return { feature: { ...feature, edges: feature.edges.map(one) }, replaced };
    case 'combine':
      return { feature: { ...feature, main: one(feature.main), tools: feature.tools.map(one) }, replaced };
    case 'split':
      return {
        feature: {
          ...feature,
          tool: one(feature.tool),
          ...(feature.targets ? { targets: feature.targets.map(one) } : {}),
        },
        replaced,
      };
    case 'moveCopyBody':
      return {
        feature: {
          ...feature,
          targets: feature.targets.map(one),
          ...(feature.rotationAxis && typeof feature.rotationAxis === 'object'
            ? { rotationAxis: one(feature.rotationAxis) }
            : {}),
        },
        replaced,
      };
    case 'deleteKeepBody':
      return {
        feature: {
          ...feature,
          targets: feature.targets.map(one),
        },
        replaced,
      };
    case 'thread':
      return typeof feature.axis === 'string' ? { feature, replaced } : { feature: { ...feature, axis: one(feature.axis) }, replaced };
    case 'knurl':
      return { feature: { ...feature, axis: one(feature.axis) }, replaced };
    case 'cosmeticThread':
      return {
        feature: {
          ...feature,
          targetFace: one(feature.targetFace),
          ...(feature.startEdge ? { startEdge: one(feature.startEdge) } : {}),
        },
        replaced,
      };
    case 'revolve':
    case 'sweep':
    case 'loft':
    case 'rib':
    case 'hole':
    case 'screwBoss':
    case 'baseFlange':
    case 'midBend':
    case 'jog':
    case 'snapHook':
    case 'snapCatch':
    case 'vent':
    case 'importedBody':
    case 'derivedBody':
      return { feature, replaced };
  }
}
