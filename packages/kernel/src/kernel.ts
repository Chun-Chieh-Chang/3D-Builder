import { t } from '@3db/i18n';
import type { BRepBuilderAPI_MakeShape, NCollection_List_TopoDS_Shape, TopoDS_Shape, TopoDS_Wire } from 'libcascade/single/init';
import { Arena, loadOcct, ShapeIndex, type LoadOptions, type OC } from './occt';
import {
  KernelError,
  type CurveGeometry,
  type EdgeInfo,
  type FaceInfo,
  type FaceOrigin,
  type ImportDiagnostics,
  type ImportOptions,
  type ImportResult,
  type MassProps,
  type MeshData,
  type MeshOptions,
  type OpResult,
  type ShapeId,
  type Topology,
  type Vec3,
  type VertexInfo,
  type SurfaceGeometry,
} from './types';

/** Sketch-plane frame (structurally identical to @3db/model PlaneFrame; the kernel stays dependency-free). */
export interface Frame {
  origin: Vec3;
  xDir: Vec3;
  yDir: Vec3;
  normal: Vec3;
}

type P2 = [number, number];
export type Segment =
  | { kind: 'line'; a: P2; b: P2; source: string }
  | { kind: 'arc'; c: P2; r: number; from: P2; to: P2; ccw: boolean; source: string }
  | { kind: 'circle'; c: P2; r: number; source: string };

/** Counter-clockwise outer loop with clockwise holes (as produced by @3db/sketch findProfiles). */
export interface Region {
  outer: Segment[];
  holes: Segment[][];
}

/** What a sweep ends on besides its depth: a face of a shape (up to a face), or the surface of a whole body (up to a body). */
export type Until = { target: ShapeId; face: number } | { body: ShapeId };

/** One direction of an extrusion: where it goes, its draft (radians, positive narrows along it) and what it ends on. */
export interface SweepSpec {
  vector: Vec3;
  offset?: number;
  draft?: number;
  until?: Until;
}

const T = {
  FACE: 'TopAbs_FACE',
  EDGE: 'TopAbs_EDGE',
  VERTEX: 'TopAbs_VERTEX',
} as const;

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

/** Area-weighted vertex normals. Vertices are per face, so smoothing never crosses a face boundary. */
function smoothNormals(positions: number[], indices: number[], faceRanges: number[]): Float32Array {
  const n = new Float32Array(positions.length);
  for (let r = 0; r < faceRanges.length; r += 3) {
    const end = faceRanges[r]! + faceRanges[r + 1]!;
    for (let t = faceRanges[r]!; t < end; t += 3) {
      const [a, b, c] = [indices[t]! * 3, indices[t + 1]! * 3, indices[t + 2]! * 3];
      const ux = positions[b]! - positions[a]!, uy = positions[b + 1]! - positions[a + 1]!, uz = positions[b + 2]! - positions[a + 2]!;
      const vx = positions[c]! - positions[a]!, vy = positions[c + 1]! - positions[a + 1]!, vz = positions[c + 2]! - positions[a + 2]!;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const v of [a, b, c]) {
        n[v] = n[v]! + nx;
        n[v + 1] = n[v + 1]! + ny;
        n[v + 2] = n[v + 2]! + nz;
      }
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1;
    n[i] = n[i]! / len;
    n[i + 1] = n[i + 1]! / len;
    n[i + 2] = n[i + 2]! / len;
  }
  return n;
}

/**
 * Coarse-grained facade over OCCT (A1). Every operation reports face provenance so the naming
 * layer can build persistent names (A1.8). Callers own returned shapes and must release them.
 */
export class Kernel {
  private shapes = new Map<ShapeId, TopoDS_Shape>();
  private nextId = 1;
  private fileSeq = 0;

  private constructor(readonly oc: OC) {}

  static async load(options: LoadOptions = {}): Promise<Kernel> {
    return new Kernel(await loadOcct(options));
  }

  // ------------------------------------------------------------------ handles

  private put(shape: TopoDS_Shape): ShapeId {
    const id = this.nextId++ as ShapeId;
    this.shapes.set(id, shape);
    return id;
  }

  private get(id: ShapeId): TopoDS_Shape {
    const s = this.shapes.get(id);
    if (!s) throw new KernelError(`形狀控制代碼已釋放：${id}`);
    return s;
  }

  /** A second handle to the same shape: releasing either leaves the other intact. */
  copy(id: ShapeId): ShapeId {
    const s = this.get(id);
    return this.put(s.Oriented(s.Orientation()));
  }

  release(id: ShapeId): void {
    this.shapes.get(id)?.delete();
    this.shapes.delete(id);
  }

  get liveShapes(): number {
    return this.shapes.size;
  }

  // ------------------------------------------------------------------ helpers

  private errorText(e: unknown): string {
    if (typeof WebAssembly !== 'undefined' && 'Exception' in WebAssembly && e instanceof WebAssembly.Exception) {
      try {
        const [type, message] = this.oc.getExceptionMessage(e);
        return message ? `${type}：${message}` : type;
      } catch {
        return 'OCCT 例外';
      }
    }
    return e instanceof Error ? e.message : String(e);
  }

  private build(mk: BRepBuilderAPI_MakeShape, label: string, arena: Arena): TopoDS_Shape {
    try {
      mk.Build(arena.own(new this.oc.Message_ProgressRange()));
    } catch (e) {
      throw new KernelError(`${label}失敗：${this.errorText(e)}`);
    }
    if (!mk.IsDone()) throw new KernelError(`${label}失敗`);
    return mk.Shape();
  }

  /** Drains an OCCT list into an array (copy first: the list may alias algorithm-internal storage). */
  private list(list: NCollection_List_TopoDS_Shape): TopoDS_Shape[] {
    const copy = new this.oc.NCollection_List_TopoDS_Shape(list);
    const out: TopoDS_Shape[] = [];
    while (!copy.IsEmpty()) {
      out.push(copy.First());
      copy.RemoveFirst();
    }
    copy.delete();
    list.delete();
    return out;
  }

  private pnt(arena: Arena, p: Vec3) {
    return arena.own(new this.oc.gp_Pnt(p[0], p[1], p[2]));
  }

  private dir(arena: Arena, v: Vec3) {
    return arena.own(new this.oc.gp_Dir(arena.own(new this.oc.gp_Vec(v[0], v[1], v[2]))));
  }

  private xyz(p: { X(): number; Y(): number; Z(): number }): Vec3 {
    return [p.X(), p.Y(), p.Z()];
  }

  // ------------------------------------------------------------------ modelling

  private wire(arena: Arena, frame: Frame, loop: Segment[], hole: boolean, sources: Map<TopoDS_Shape, string>): TopoDS_Wire {
    const oc = this.oc;
    const at = (p: P2): Vec3 => add(add(frame.origin, frame.xDir, p[0]), frame.yDir, p[1]);
    const circ = (c: P2, r: number) =>
      arena.own(new oc.gp_Circ(arena.own(new oc.gp_Ax2(this.pnt(arena, at(c)), this.dir(arena, frame.normal), this.dir(arena, frame.xDir))), r));
    const mw = arena.own(new oc.BRepBuilderAPI_MakeWire());
    for (const seg of loop) {
      let edge;
      if (seg.kind === 'line') {
        edge = arena.own(arena.own(new oc.BRepBuilderAPI_MakeEdge(this.pnt(arena, at(seg.a)), this.pnt(arena, at(seg.b)))).Edge());
      } else if (seg.kind === 'circle') {
        edge = arena.own(arena.own(new oc.BRepBuilderAPI_MakeEdge(circ(seg.c, seg.r))).Edge());
        if (hole) edge = arena.own(oc.TopoDS.Edge(arena.own(edge.Reversed())));
      } else {
        const [p, q] = seg.ccw ? [seg.from, seg.to] : [seg.to, seg.from];
        edge = arena.own(arena.own(new oc.BRepBuilderAPI_MakeEdge(circ(seg.c, seg.r), this.pnt(arena, at(p)), this.pnt(arena, at(q)))).Edge());
        if (!seg.ccw) edge = arena.own(oc.TopoDS.Edge(arena.own(edge.Reversed())));
      }
      mw.Add(edge);
      if (!mw.IsDone()) throw new KernelError(`輪廓無法連成封閉線框（圖元 ${seg.source}）`);
      sources.set(arena.own(mw.Edge()), seg.source);
    }
    return arena.own(mw.Wire());
  }

  /** Faces (a compound when several) bounded by the sketch regions; `sources` maps wire edges to sketch entities. */
  private profile(arena: Arena, frame: Frame, regions: Region[], sources: Map<TopoDS_Shape, string>): TopoDS_Shape {
    const oc = this.oc;
    const plane = arena.own(
      new oc.gp_Pln(arena.own(new oc.gp_Ax3(this.pnt(arena, frame.origin), this.dir(arena, frame.normal), this.dir(arena, frame.xDir)))),
    );
    const faces = regions.map((r) => {
      const mf = arena.own(new oc.BRepBuilderAPI_MakeFace(plane, this.wire(arena, frame, r.outer, false, sources), true));
      for (const h of r.holes) mf.Add(this.wire(arena, frame, h, true, sources));
      if (!mf.IsDone()) throw new KernelError('無法由輪廓建立面');
      return arena.own(mf.Face());
    });
    if (faces.length === 1) return faces[0]!;
    const compound = arena.own(new oc.TopoDS_Compound());
    const builder = arena.own(new oc.TopoDS_Builder());
    builder.MakeCompound(compound);
    for (const face of faces) builder.Add(compound, face);
    return compound;
  }

  /** Provenance of a sweep (prism or revolution): side faces from profile edges, caps from the first/last profile. */
  /**
   * `swept` is the sweep's own record of what a profile edge generated. It is needed for full
   * revolutions: there BRepPrimAPI_MakeRevol.Generated returns nothing for edges square to the axis,
   * although the planar faces they sweep are in the result, and those faces would lose their names.
   */
  private sweepOrigins(
    mk: { Generated(s: TopoDS_Shape): NCollection_List_TopoDS_Shape; FirstShape(): TopoDS_Shape; LastShape(): TopoDS_Shape },
    out: TopoDS_Shape,
    sources: Map<TopoDS_Shape, string>,
    arena: Arena,
    swept?: (edge: TopoDS_Shape) => TopoDS_Shape | null,
  ): FaceOrigin[][] {
    const oc = this.oc;
    const outFaces = ShapeIndex.of(oc, out, T.FACE, arena);
    try {
      const origins: FaceOrigin[][] = outFaces.keys.map(() => []);
      const same = (a: FaceOrigin, b: FaceOrigin) => JSON.stringify(a) === JSON.stringify(b);
      const mark = (shapes: TopoDS_Shape[], origin: FaceOrigin) => {
        for (const s of shapes) {
          const i = outFaces.indexOf(s);
          if (i >= 0 && !origins[i]!.some((o) => same(o, origin))) origins[i]!.push(origin);
          s.delete();
        }
      };
      for (const [edge, source] of sources) {
        const origin: FaceOrigin = { rel: 'generated', kind: 'profileEdge', source };
        mark(this.list(mk.Generated(edge)), origin);
        const s = swept?.(edge);
        if (s) mark([s], origin);
      }
      const caps = (shape: TopoDS_Shape, which: 'start' | 'end') => {
        const idx = ShapeIndex.of(oc, shape, T.FACE, arena);
        mark(idx.keys.splice(0), { rel: 'cap', which });
        shape.delete();
      };
      caps(mk.FirstShape(), 'start');
      caps(mk.LastShape(), 'end');
      return origins;
    } finally {
      outFaces.dispose();
    }
  }

  /**
   * One sweep of the profile (C4.1): the tool shape (the caller deletes it) and the origins of its faces. Side faces originate from profile
   * edges (tagged with their sketch entity), caps from start/end. With a draft the side faces lean, then with `until` the sweep, made long
   * enough to pass it, ends on the surface of a face of `until.target` (up to a face) or of the whole body `until.body`
   * (up to a body); what it gains from that surface is the end cap.
   */
  private sweep(frame: Frame, regions: Region[], spec: SweepSpec, arena: Arena): { shape: TopoDS_Shape; origins: FaceOrigin[][] } {
    if (regions.length === 0) throw new KernelError('沒有可伸長的封閉輪廓');
    const oc = this.oc;
    const f: Frame = { ...frame, origin: add(frame.origin, frame.normal, spec.offset ?? 0) };
    const sources = new Map<TopoDS_Shape, string>();
    const profile = this.profile(arena, f, regions, sources);
    const vec = arena.own(new oc.gp_Vec(spec.vector[0], spec.vector[1], spec.vector[2]));
    const mk = arena.own(new oc.BRepPrimAPI_MakePrism(profile, vec, false, true));
    let out = this.build(mk, t('feature.extrude'), arena);
    let origins = this.sweepOrigins(mk, out, sources, arena);
    if (spec.draft) {
      const sides = origins.flatMap((o, i) => (o.some((x) => x.rel === 'generated' && x.kind === 'profileEdge') ? [i] : []));
      const drafted = this.draftFaces(out, origins, sides, spec.vector, { origin: f.origin, normal: f.normal }, spec.draft, arena);
      out.delete();
      out = drafted.shape;
      origins = drafted.origins;
    }
    if (!spec.until) return { shape: out, origins };
    try {
      return 'body' in spec.until ? this.trimAtBody(out, origins, spec.until.body, spec.vector, arena) : this.trimAtFace(out, origins, spec.until, spec.vector, arena);
    } finally {
      out.delete();
    }
  }

  /** Extrudes sketch regions along `vector`, starting `offset` along the plane normal; `draft` leans the walls (radians, positive narrows along the sweep). */
  extrude(frame: Frame, regions: Region[], vector: Vec3, offset = 0, until?: Until, draft?: number): OpResult {
    const arena = new Arena();
    try {
      const r = this.sweep(frame, regions, { vector, offset, ...(until ? { until } : {}), ...(draft ? { draft } : {}) }, arena);
      return { shape: this.put(r.shape), faceOrigins: r.origins };
    } finally {
      arena.dispose();
    }
  }

  /**
   * Two sweeps from the same profile, one each way (direction 2, C4.1): fused into one body, the plane they share gone, coplanar walls merged
   * (and so named by the profile edge both came from).
   */
  extrudeBoth(frame: Frame, regions: Region[], first: SweepSpec, second: SweepSpec): OpResult {
    const oc = this.oc;
    const arena = new Arena();
    const a = this.sweep(frame, regions, first, arena);
    let b: { shape: TopoDS_Shape; origins: FaceOrigin[][] } | null = null;
    try {
      b = this.sweep(frame, regions, second, arena);
      const fa = ShapeIndex.of(oc, a.shape, T.FACE, arena);
      const fb = ShapeIndex.of(oc, b.shape, T.FACE, arena);
      try {
        const mk = this.boolOp('fuse', a.shape, b.shape, t('feature.extrude'), arena);
        const raw = mk.Shape();
        try {
          const sources = this.faceSources(mk, [...fa.keys, ...fb.keys], raw, arena);
          // the second direction's far cap is the start of the feature, as seen from the first
          const swap = (o: FaceOrigin): FaceOrigin => (o.rel === 'cap' ? { rel: 'cap', which: o.which === 'end' ? 'start' : 'end' } : o);
          const all = [...a.origins, ...b.origins.map((o) => o.map(swap))];
          const unified = this.unify(raw, sources.map((s) => s.flatMap((i) => all[i]!)), arena);
          return { shape: this.put(unified.shape), faceOrigins: unified.origins };
        } finally {
          raw.delete();
        }
      } finally {
        fa.dispose();
        fb.dispose();
      }
    } finally {
      a.shape.delete();
      b?.shape.delete();
      arena.dispose();
    }
  }

  /**
   * Leans faces of a shape (draft, C5.5): each of `faces` about its intersection with the neutral plane, pulled along `pull`; a positive angle
   * makes the shape narrower further along `pull`. A face that cannot lean is an error, never skipped. The result is the caller's.
   */
  private draftFaces(
    shape: TopoDS_Shape,
    origins: FaceOrigin[][],
    faces: number[],
    pull: Vec3,
    neutral: { origin: Vec3; normal: Vec3 },
    angle: number,
    arena: Arena,
  ): { shape: TopoDS_Shape; origins: FaceOrigin[][] } {
    const oc = this.oc;
    const index = ShapeIndex.of(oc, shape, T.FACE, arena);
    try {
      const mk = arena.own(new oc.BRepOffsetAPI_DraftAngle(shape));
      const direction = this.dir(arena, pull);
      const plane = arena.own(new oc.gp_Pln(this.pnt(arena, neutral.origin), this.dir(arena, neutral.normal)));
      for (const i of faces) {
        const face = arena.own(oc.TopoDS.Face(index.keys[i]!));
        mk.Add(face, direction, angle, plane, true);
        if (!mk.AddDone()) throw new KernelError(t('feature.draftFailed', { index: i }));
      }
      const out = this.build(mk, t('feature.draft'), arena);
      if (!this.valid(out)) {
        out.delete();
        throw new KernelError(t('feature.draftInvalid'));
      }
      // a leaned face is a new face: ModifiedShape says which one it became
      const outFaces = ShapeIndex.of(oc, out, T.FACE, arena);
      try {
        const next: FaceOrigin[][] = outFaces.keys.map(() => []);
        index.keys.forEach((f, i) => {
          const m = mk.ModifiedShape(f);
          const j = Math.max(outFaces.indexOf(m), outFaces.indexOf(f));
          m.delete();
          if (j >= 0) next[j]!.push(...(origins[i] ?? []));
        });
        return { shape: out, origins: next };
      } finally {
        outFaces.dispose();
      }
    } finally {
      index.dispose();
    }
  }

  /** Cuts a sweep off at the (unbounded) surface of a target face; faces it gains from that surface are the end cap. */
  private trimAtFace(tool: TopoDS_Shape, origins: FaceOrigin[][], until: { target: ShapeId; face: number }, vector: Vec3, arena: Arena): { shape: TopoDS_Shape; origins: FaceOrigin[][] } {
    const oc = this.oc;
    const targetFaces = ShapeIndex.of(oc, this.get(until.target), T.FACE, arena);
    try {
      const key = targetFaces.keys[until.face];
      if (!key) throw new KernelError(`面索引超出範圍：${until.face}`);
      const face = arena.own(oc.TopoDS.Face(key));
      const props = arena.own(new oc.GProp_GProps());
      oc.BRepGProp.SurfaceProperties(face, props, false, false);
      const center = this.xyz(arena.own(props.CentreOfMass()));
      const len = Math.hypot(...vector) || 1;
      // A point just beyond the face along the extrusion: the half-space on that side is removed.
      const beyond = add(center, vector, Math.max(1e-3, 1e-5 * len) / len);
      // Bounded by the face's whole underlying surface (a plane is unbounded), not by the face itself:
      // a half-space made from the finite face would only trim profiles lying right under it.
      const surface = arena.own(oc.BRep_Tool.Surface(face));
      const unbounded = arena.own(arena.own(new oc.BRepBuilderAPI_MakeFace(surface, 1e-7)).Face());
      const halfSpace = arena.own(arena.own(new oc.BRepPrimAPI_MakeHalfSpace(unbounded, this.pnt(arena, beyond))).Solid());
      const toolFaces = ShapeIndex.of(oc, tool, T.FACE, arena);
      const cutterFaces = ShapeIndex.of(oc, halfSpace, T.FACE, arena);
      try {
        const cut = this.boolOp('cut', tool, halfSpace, '成形至某一面', arena);
        const out = cut.Shape();
        const n = toolFaces.size;
        const sources = this.faceSources(cut, [...toolFaces.keys, ...cutterFaces.keys], out, arena);
        if (!sources.some((s) => s.some((i) => i >= n))) {
          out.delete();
          throw new KernelError('伸長沒有到達選取的面（面在伸長方向的另一側，或與輪廓不相交）');
        }
        const trimmed = sources.map((s) => s.flatMap((i): FaceOrigin[] => (i < n ? origins[i]! : [{ rel: 'cap', which: 'end' }])));
        return { shape: out, origins: trimmed };
      } finally {
        toolFaces.dispose();
        cutterFaces.dispose();
      }
    } finally {
      targetFaces.dispose();
    }
  }

  /**
   * Cuts a sweep off at the surface of a whole body (up to a body): the sweep minus the body, and of what is left the piece the sketch is on.
   * What it gains from the body's surface is the end cap.
   */
  private trimAtBody(tool: TopoDS_Shape, origins: FaceOrigin[][], body: ShapeId, vector: Vec3, arena: Arena): { shape: TopoDS_Shape; origins: FaceOrigin[][] } {
    const oc = this.oc;
    const target = this.get(body);
    const toolFaces = ShapeIndex.of(oc, tool, T.FACE, arena);
    const bodyFaces = ShapeIndex.of(oc, target, T.FACE, arena);
    try {
      const cut = this.boolOp('cut', tool, target, t('feature.upToBody'), arena);
      const raw = cut.Shape();
      const n = toolFaces.size;
      const sources = this.faceSources(cut, [...toolFaces.keys, ...bodyFaces.keys], raw, arena);
      if (!sources.some((s) => s.some((i) => i >= n))) {
        raw.delete();
        throw new KernelError(t('feature.bodyNotReached'));
      }
      const all = sources.map((s) => s.flatMap((i): FaceOrigin[] => (i < n ? origins[i]! : [{ rel: 'cap', which: 'end' }])));
      // beyond the body the cut may leave more pieces: the one nearest the start of the sweep is the feature
      const whole = this.put(raw);
      const pieces = this.splitSolids({ shape: whole, faceOrigins: all });
      this.release(whole);
      const len = Math.hypot(...vector) || 1;
      const along = (id: ShapeId) => {
        const { min, max } = this.bounds(id);
        let near = Infinity;
        for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) near = Math.min(near, (x * vector[0] + y * vector[1] + z * vector[2]) / len);
        return near;
      };
      const chosen = pieces.reduce((best, p) => (along(p.shape) < along(best.shape) - 1e-9 ? p : best));
      for (const p of pieces) if (p !== chosen) this.release(p.shape);
      const piece = this.get(chosen.shape);
      this.shapes.delete(chosen.shape); // the shape is the caller's now
      return { shape: piece, origins: chosen.faceOrigins };
    } finally {
      toolFaces.dispose();
      bodyFaces.dispose();
    }
  }

  /**
   * The face of `target` a sweep meets first (up to the next face, ADR 0017 section 5): the sweep is intersected with the body, and of the faces the
   * intersection takes from the body's, the nearest one beyond the start. Null when there is none in the way.
   */
  nextFace(target: ShapeId, frame: Frame, regions: Region[], vector: Vec3): number | null {
    const oc = this.oc;
    const arena = new Arena();
    const swept = this.sweep(frame, regions, { vector }, arena);
    const body = this.get(target);
    const toolFaces = ShapeIndex.of(oc, swept.shape, T.FACE, arena);
    const bodyFaces = ShapeIndex.of(oc, body, T.FACE, arena);
    try {
      let raw: TopoDS_Shape;
      let sources: number[][];
      try {
        const common = this.boolOp('common', swept.shape, body, t('feature.upToNext'), arena);
        raw = common.Shape();
        sources = this.faceSources(common, [...toolFaces.keys, ...bodyFaces.keys], raw, arena);
      } catch (e) {
        if (e instanceof KernelError) return null; // nothing in common: nothing in the way
        throw e;
      }
      const outFaces = ShapeIndex.of(oc, raw, T.FACE, arena);
      try {
        const len = Math.hypot(...vector) || 1;
        const start = (frame.origin[0] * vector[0] + frame.origin[1] * vector[1] + frame.origin[2] * vector[2]) / len;
        let best: { face: number; at: number } | null = null;
        outFaces.keys.forEach((f, k) => {
          const fromBody = sources[k]!.filter((i) => i >= toolFaces.size).map((i) => i - toolFaces.size);
          if (fromBody.length === 0) return;
          const props = arena.own(new oc.GProp_GProps());
          oc.BRepGProp.SurfaceProperties(f, props, false, false);
          const c = this.xyz(arena.own(props.CentreOfMass()));
          const at = (c[0] * vector[0] + c[1] * vector[1] + c[2] * vector[2]) / len - start;
          if (at > 1e-6 && (!best || at < best.at)) best = { face: fromBody[0]!, at };
        });
        return (best as { face: number } | null)?.face ?? null;
      } finally {
        outFaces.dispose();
        raw.delete();
      }
    } finally {
      swept.shape.delete();
      toolFaces.dispose();
      bodyFaces.dispose();
      arena.dispose();
    }
  }

  /**
   * Revolves sketch regions about an axis by `angle` radians, counter-clockwise about `axis.dir` (C4.3).
   * Naming like an extrusion: side faces from profile edges, caps where the revolution starts and ends.
   */
  revolve(frame: Frame, regions: Region[], axis: { origin: Vec3; dir: Vec3 }, angle: number): OpResult {
    if (regions.length === 0) throw new KernelError('沒有可旋轉的封閉輪廓');
    const oc = this.oc;
    const arena = new Arena();
    try {
      const sources = new Map<TopoDS_Shape, string>();
      const profile = this.profile(arena, frame, regions, sources);
      const ax = arena.own(new oc.gp_Ax1(this.pnt(arena, axis.origin), this.dir(arena, axis.dir)));
      // Four arguments on purpose: with three, arity dispatch cannot tell (angle) from (copy).
      const mk = arena.own(new oc.BRepPrimAPI_MakeRevol(profile, ax, angle, false));
      const out = this.build(mk, '旋轉', arena);
      const sweep = arena.own(mk.Revol());
      const swept = (edge: TopoDS_Shape) => {
        const s = sweep.Shape(edge);
        if (!s.IsNull()) return s;
        s.delete();
        return null; // an edge on the axis sweeps nothing
      };
      return { shape: this.put(out), faceOrigins: this.sweepOrigins(mk, out, sources, arena, swept) };
    } finally {
      arena.dispose();
    }
  }

  /**
   * Sweeps sketch regions along a path of lines and arcs (C4.4, 掃出). `path` is in the plane of `pathFrame`, in the order it is walked; the
   * profile is where it is, on the plane of `frame` at the start of the path, and keeps its angle to the path ("follow path", a corrected Frenet
   * trihedron, which has no twist where the path turns the other way or runs straight). A side face is named for the profile edge and the path
   * edge that made it, `<profile source>@<path source>`; the ends are caps. A region with holes is its outer outline swept, less each hole swept.
   */
  sweepAlongPath(frame: Frame, regions: Region[], pathFrame: Frame, path: Segment[]): OpResult {
    if (regions.length === 0) throw new KernelError(t('feature.sweepNoProfile'));
    if (path.length === 0) throw new KernelError(t('feature.sweepNoPath'));
    const oc = this.oc;
    const arena = new Arena();
    try {
      const pathSources = new Map<TopoDS_Shape, string>();
      const spine = this.wire(arena, pathFrame, path, false, pathSources);
      const parts = regions.map((region) => this.sweepRegion(frame, region, spine, pathSources, arena));
      let whole = parts[0]!;
      if (parts.length > 1) {
        // separate regions are separate solids of one compound; a face keeps what its own sweep said it was
        const compound = arena.own(new oc.TopoDS_Compound());
        const builder = arena.own(new oc.TopoDS_Builder());
        builder.MakeCompound(compound);
        for (const p of parts) builder.Add(compound, p.shape);
        const index = ShapeIndex.of(oc, compound, T.FACE, arena);
        const origins: FaceOrigin[][] = index.keys.map(() => []);
        for (const p of parts) {
          const own = ShapeIndex.of(oc, p.shape, T.FACE, arena);
          own.keys.forEach((face, i) => {
            const j = index.indexOf(face);
            if (j >= 0) origins[j]!.push(...(p.origins[i] ?? []));
          });
          own.dispose();
        }
        index.dispose();
        whole = { shape: compound, origins };
      }
      if (!this.valid(whole.shape)) throw new KernelError(t('feature.sweepInvalid'));
      const id = this.put(whole.shape.Oriented(whole.shape.Orientation()));
      if (!(this.massProps(id).volume > 1e-9)) {
        this.release(id);
        throw new KernelError(t('feature.sweepInvalid'));
      }
      return { shape: id, faceOrigins: whole.origins };
    } finally {
      arena.dispose();
    }
  }

  /** One region swept along `spine`: its outline, less its holes (each swept in the same way). The shape is the arena's. */
  private sweepRegion(frame: Frame, region: Region, spine: TopoDS_Wire, pathSources: Map<TopoDS_Shape, string>, arena: Arena): { shape: TopoDS_Shape; origins: FaceOrigin[][] } {
    const oc = this.oc;
    const one = (loop: Segment[], hole: boolean) => {
      const sources = new Map<TopoDS_Shape, string>();
      const wire = this.wire(arena, frame, loop, hole, sources);
      const mk = arena.own(new oc.BRepOffsetAPI_MakePipeShell(spine));
      mk.SetMode(false); // corrected Frenet
      mk.Add(wire, false, false);
      try {
        mk.Build(arena.own(new oc.Message_ProgressRange()));
        if (!mk.IsReady() || !mk.MakeSolid()) throw new KernelError(t('feature.sweepFailed', { why: t('feature.sweepNoSolid') }));
      } catch (e) {
        if (e instanceof KernelError) throw e;
        throw new KernelError(t('feature.sweepFailed', { why: this.errorText(e) }));
      }
      const shape = arena.own(mk.Shape());
      return { shape, origins: this.pipeOrigins(mk, shape, sources, pathSources, arena) };
    };
    let acc = one(region.outer, false);
    for (const hole of region.holes) {
      const tool = one(hole, true);
      const fa = ShapeIndex.of(oc, acc.shape, T.FACE, arena);
      const fb = ShapeIndex.of(oc, tool.shape, T.FACE, arena);
      const mk = this.boolOp('cut', acc.shape, tool.shape, t('feature.sweep'), arena);
      const raw = arena.own(mk.Shape());
      const sources = this.faceSources(mk, [...fa.keys, ...fb.keys], raw, arena);
      const all = [...acc.origins, ...tool.origins];
      fa.dispose();
      fb.dispose();
      acc = { shape: raw, origins: sources.map((s) => s.flatMap((i) => all[i]!)) };
    }
    return acc;
  }

  /** Where the faces of a pipe shell came from: a side face from a profile edge and a path edge (both must have made it), the ends from the first and last sections. */
  private pipeOrigins(mk: { Generated(s: TopoDS_Shape): NCollection_List_TopoDS_Shape; FirstShape(): TopoDS_Shape; LastShape(): TopoDS_Shape }, out: TopoDS_Shape, profile: Map<TopoDS_Shape, string>, path: Map<TopoDS_Shape, string>, arena: Arena): FaceOrigin[][] {
    const oc = this.oc;
    const faces = ShapeIndex.of(oc, out, T.FACE, arena);
    const origins: FaceOrigin[][] = faces.keys.map(() => []);
    /** The faces of `out` an edge made. */
    const made = (edge: TopoDS_Shape): Set<number> => {
      const set = new Set<number>();
      for (const s of this.list(mk.Generated(edge))) {
        const i = faces.indexOf(s);
        if (i >= 0) set.add(i);
        s.delete();
      }
      return set;
    };
    const byPath = [...path].map(([edge, source]) => ({ source, faces: made(edge) }));
    for (const [edge, source] of profile) {
      const mine = made(edge);
      for (const i of mine) {
        const along = byPath.filter((p) => p.faces.has(i));
        // a face no path edge claims is named for its profile edge alone: never nameless
        if (along.length === 0) origins[i]!.push({ rel: 'generated', kind: 'profileEdge', source });
        for (const p of along) origins[i]!.push({ rel: 'generated', kind: 'profileEdge', source: `${source}@${p.source}` });
      }
    }
    for (const [shape, which] of [[mk.FirstShape(), 'start'], [mk.LastShape(), 'end']] as const) {
      const ends = ShapeIndex.of(oc, shape, T.FACE, arena);
      for (const f of ends.keys) {
        const i = faces.indexOf(f);
        if (i >= 0) origins[i]!.push({ rel: 'cap', which });
      }
      ends.dispose();
      shape.delete();
    }
    faces.dispose();
    return origins;
  }

  private boolOp(op: 'fuse' | 'cut' | 'common', a: TopoDS_Shape, b: TopoDS_Shape, label: string, arena: Arena) {
    const oc = this.oc;
    let mk;
    try {
      // The constructor with arguments performs the operation; Build() would run it again.
      const range = arena.own(new oc.Message_ProgressRange());
      mk = arena.own(op === 'fuse' ? new oc.BRepAlgoAPI_Fuse(a, b, range) : op === 'cut' ? new oc.BRepAlgoAPI_Cut(a, b, range) : new oc.BRepAlgoAPI_Common(a, b, range));
    } catch (e) {
      throw new KernelError(`${label}失敗：${this.errorText(e)}`);
    }
    if (mk.HasErrors() || !mk.IsDone()) throw new KernelError(`${label}失敗`);
    return mk;
  }

  /**
   * Boolean of `tool` into or out of `target` (A1.5), then coplanar faces are merged like SolidWorks
   * does. Face origins index the target's faces followed by the tool's (and likewise edges, vertices),
   * so the naming layer can inherit names from both inputs.
   */
  boolean(op: 'fuse' | 'cut' | 'common', target: ShapeId, tool: ShapeId): OpResult {
    const oc = this.oc;
    const arena = new Arena();
    const a = this.get(target);
    const b = this.get(tool);
    const index = (s: TopoDS_Shape) => ({ faces: ShapeIndex.of(oc, s, T.FACE, arena), edges: ShapeIndex.of(oc, s, T.EDGE, arena), verts: ShapeIndex.of(oc, s, T.VERTEX, arena) });
    const ia = index(a);
    const ib = index(b);
    try {
      const mk = this.boolOp(op, a, b, op === 'fuse' ? t('body.fuse') : op === 'cut' ? '除料' : t('body.common'), arena);
      const raw = mk.Shape();
      try {
        const origins = this.history(
          mk,
          { faces: [...ia.faces.keys, ...ib.faces.keys], edges: [...ia.edges.keys, ...ib.edges.keys], verts: [...ia.verts.keys, ...ib.verts.keys] },
          raw,
          arena,
        );
        const unified = this.unify(raw, origins, arena);
        return { shape: this.put(unified.shape), faceOrigins: unified.origins };
      } finally {
        raw.delete();
      }
    } finally {
      for (const i of [ia, ib]) for (const x of Object.values(i)) x.dispose();
      arena.dispose();
    }
  }

  /**
   * Merges faces lying on the same surface; a merged face keeps the origins of all its pieces (G4 in ADR 0003).
   * Faces are not merged across an edge in keep: an edit that touches a few faces of a large imported body must not
   * regroup the faces far from it, whose names others may be using.
   */
  private unify(shape: TopoDS_Shape, origins: FaceOrigin[][], arena: Arena, keep: TopoDS_Shape[] = []): { shape: TopoDS_Shape; origins: FaceOrigin[][] } {
    const oc = this.oc;
    const u = arena.own(new oc.ShapeUpgrade_UnifySameDomain(shape, true, true, false));
    for (const e of keep) u.KeepShape(e);
    u.Build();
    const out = u.Shape();
    const history = arena.own(u.History());
    const before = ShapeIndex.of(oc, shape, T.FACE, arena);
    const after = ShapeIndex.of(oc, out, T.FACE, arena);
    try {
      const merged: FaceOrigin[][] = after.keys.map(() => []);
      before.keys.forEach((f, i) => {
        const modified = this.list(history.Modified(f));
        const targets = modified.length > 0 ? modified.map((m) => after.indexOf(m)) : [after.indexOf(f)];
        for (const m of modified) m.delete();
        for (const j of targets) if (j >= 0) merged[j]!.push(...origins[i]!);
      });
      return { shape: out, origins: merged };
    } finally {
      before.dispose();
      after.dispose();
    }
  }

  // ------------------------------------------------------------------ bodies (C7)

  /** How many solids a shape holds: a result with more than one has come apart. */
  solidCount(id: ShapeId): number {
    const arena = new Arena();
    const solids = ShapeIndex.of(this.oc, this.get(id), 'TopAbs_SOLID', arena);
    try {
      return solids.size;
    } finally {
      solids.dispose();
      arena.dispose();
    }
  }

  /**
   * The solids of a result as separate shapes, each with the origins of its own faces and the numbers those faces have in the
   * whole result (aces; an imported face keeps its origin's number). Largest first, ties by position, so the order is
   * the same on every rebuild. The result itself stays the caller's.
   */
  splitSolids(result: OpResult): (OpResult & { faces: number[] })[] {
    const oc = this.oc;
    const arena = new Arena();
    const whole = this.get(result.shape);
    const faces = ShapeIndex.of(oc, whole, T.FACE, arena);
    const solids = ShapeIndex.of(oc, whole, 'TopAbs_SOLID', arena);
    try {
      const pieces = solids.keys.map((solid) => {
        const own = ShapeIndex.of(oc, solid, T.FACE, arena);
        const indices = own.keys.map((f) => faces.indexOf(f));
        const origins = indices.map((i) => result.faceOrigins[i] ?? []);
        own.dispose();
        const props = arena.own(new oc.GProp_GProps());
        oc.BRepGProp.VolumeProperties(solid, props, false, false, false);
        return { solid, origins, indices, volume: props.Mass(), center: this.xyz(arena.own(props.CentreOfMass())) };
      });
      pieces.sort((a, b) => b.volume - a.volume || a.center[0] - b.center[0] || a.center[1] - b.center[1] || a.center[2] - b.center[2]);
      return pieces.map((p) => ({ shape: this.put(p.solid.Oriented(p.solid.Orientation())), faceOrigins: p.origins, faces: p.indices }));
    } finally {
      faces.dispose();
      solids.dispose();
      arena.dispose();
    }
  }

  /** One shape holding all of the given shapes: for showing, measuring and writing several bodies together. */
  join(ids: ShapeId[]): ShapeId {
    const arena = new Arena();
    try {
      return this.put(this.compound(ids.map((id) => this.get(id)), arena));
    } finally {
      arena.dispose();
    }
  }

  /** A copy that shares nothing with the original: two bodies made from one imported file must not share faces. */
  clone(id: ShapeId): ShapeId {
    const arena = new Arena();
    try {
      return this.put(arena.own(new this.oc.BRepBuilderAPI_Copy(this.get(id), true, false)).Shape());
    } finally {
      arena.dispose();
    }
  }

  /** Constant-radius fillet on the given edges of `target` (C5.1). */
  fillet(target: ShapeId, edgeIndices: number[], radius: number): OpResult {
    if (edgeIndices.length === 0) throw new KernelError('圓角至少需要一條邊線');
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(target);
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    const edges = ShapeIndex.of(oc, shape, T.EDGE, arena);
    const verts = ShapeIndex.of(oc, shape, T.VERTEX, arena);
    try {
      const mk = arena.own(new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational));
      for (const i of edgeIndices) {
        const e = edges.keys[i];
        if (!e) throw new KernelError(`邊線索引超出範圍：${i}`);
        mk.Add(radius, arena.own(oc.TopoDS.Edge(e)));
      }
      const out = this.build(mk, '圓角', arena);
      return { shape: this.put(out), faceOrigins: this.history(mk, { faces: faces.keys, edges: edges.keys, verts: verts.keys }, out, arena) };
    } finally {
      faces.dispose();
      edges.dispose();
      verts.dispose();
      arena.dispose();
    }
  }

  /**
   * Chamfer (C5.3). Each edge names the adjacent face its first distance is measured on:
   * distance–distance takes two lengths, angle–distance a length and an angle (radians).
   */
  chamfer(target: ShapeId, specs: { edge: number; face: number }[], mode: 'distanceDistance' | 'angleDistance', d1: number, d2: number): OpResult {
    if (specs.length === 0) throw new KernelError('導角至少需要一條邊線');
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(target);
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    const edges = ShapeIndex.of(oc, shape, T.EDGE, arena);
    const verts = ShapeIndex.of(oc, shape, T.VERTEX, arena);
    try {
      const mk = arena.own(new oc.BRepFilletAPI_MakeChamfer(shape));
      for (const s of specs) {
        const e = edges.keys[s.edge];
        const f = faces.keys[s.face];
        if (!e || !f) throw new KernelError(`邊線或面索引超出範圍：${s.edge}/${s.face}`);
        const edge = arena.own(oc.TopoDS.Edge(e));
        const face = arena.own(oc.TopoDS.Face(f));
        if (mode === 'distanceDistance') mk.Add(d1, d2, edge, face);
        else mk.AddDA(d1, d2, edge, face);
      }
      const out = this.build(mk, '導角', arena);
      return { shape: this.put(out), faceOrigins: this.history(mk, { faces: faces.keys, edges: edges.keys, verts: verts.keys }, out, arena) };
    } finally {
      faces.dispose();
      edges.dispose();
      verts.dispose();
      arena.dispose();
    }
  }

  /**
   * Deletes faces and heals the gap (C10.2): the neighbours are extended until they meet, so a hole or a
   * fillet disappears and the body stays one valid solid (OCCT's defeaturing). Every face asked for must
   * really be gone afterwards; a face OCCT could not remove is an error, never a silent partial result.
   * Neighbours keep their origin ("modified"); no face is new.
   */
  deleteFaces(target: ShapeId, faceIndices: number[]): OpResult {
    if (faceIndices.length === 0) throw new KernelError(t('edit.noFacesToDelete'));
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(target);
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    try {
      const df = arena.own(new oc.BRepAlgoAPI_Defeaturing());
      df.SetShape(shape);
      df.SetToFillHistory(true);
      for (const i of new Set(faceIndices)) {
        const f = faces.keys[i];
        if (!f) throw new KernelError(t('edit.faceOutOfRange', { index: i }));
        df.AddFaceToRemove(f);
      }
      try {
        df.Build(arena.own(new oc.Message_ProgressRange()));
      } catch (e) {
        throw new KernelError(t('edit.deleteFailed', { reason: this.errorText(e) }));
      }
      if (df.HasErrors() || !df.IsDone()) throw new KernelError(t('edit.deleteFailed', { reason: t('edit.cannotFillGap') }));
      const stuck = [...new Set(faceIndices)].filter((i) => !df.IsDeleted(faces.keys[i]!));
      if (stuck.length > 0) throw new KernelError(t('edit.deleteFailed', { reason: t('edit.facesNotRemoved', { n: stuck.length }) }));
      const out = df.Shape();
      if (!this.valid(out)) {
        out.delete();
        throw new KernelError(t('edit.deleteInvalid'));
      }
      const edges = ShapeIndex.of(oc, shape, T.EDGE, arena);
      const verts = ShapeIndex.of(oc, shape, T.VERTEX, arena);
      try {
        return { shape: this.put(out), faceOrigins: this.history(df, { faces: faces.keys, edges: [], verts: [] }, out, arena) };
      } finally {
        edges.dispose();
        verts.dispose();
      }
    } finally {
      faces.dispose();
      arena.dispose();
    }
  }

  /**
   * Leans the picked faces of a body (draft feature, C5.5) by ngle about the neutral plane, pulled along pull; a positive angle narrows
   * them along pull. The faces keep their identity (modified), so their names do not change. A face that cannot lean is an error.
   */
  draft(target: ShapeId, faceIndices: number[], pull: Vec3, neutral: { origin: Vec3; normal: Vec3 }, angle: number): OpResult {
    if (faceIndices.length === 0) throw new KernelError(t('feature.draftNoFaces'));
    const arena = new Arena();
    const shape = this.get(target);
    const faces = ShapeIndex.of(this.oc, shape, T.FACE, arena);
    try {
      const origins = faces.keys.map((_, index): FaceOrigin[] => [{ rel: 'modified', kind: 'face', index }]);
      const r = this.draftFaces(shape, origins, [...new Set(faceIndices)], pull, neutral, angle, arena);
      return { shape: this.put(r.shape), faceOrigins: r.origins };
    } finally {
      faces.dispose();
      arena.dispose();
    }
  }

  /**
   * Hollows a body out (shell, C5.4): the faces asked for are taken away to open it, and the wall left is `thickness` thick, inside the old
   * surface or (`outward`) outside it. The faces that stay keep their origin; the inside of the wall is generated from the face it lies against;
   * a face that was opened is the rim of the wall. A shell OCCT cannot build (a wall thicker than the body allows) is an error.
   */
  shell(target: ShapeId, faceIndices: number[], thickness: number, outward: boolean): OpResult {
    if (faceIndices.length === 0) throw new KernelError(t('feature.shellNoFaces'));
    if (!(thickness > 0)) throw new KernelError(t('feature.shellThickness'));
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(target);
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    try {
      const closing = arena.own(new oc.NCollection_List_TopoDS_Shape());
      for (const i of new Set(faceIndices)) {
        const f = faces.keys[i];
        if (!f) throw new KernelError(t('edit.faceOutOfRange', { index: i }));
        closing.Append(f);
      }
      const mk = arena.own(new oc.BRepOffsetAPI_MakeThickSolid());
      try {
        mk.MakeThickSolidByJoin(shape, closing, outward ? thickness : -thickness, 1e-4, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Intersection, false, arena.own(new oc.Message_ProgressRange()));
        mk.Build(arena.own(new oc.Message_ProgressRange()));
      } catch (e) {
        throw new KernelError(t('feature.shellFailed', { reason: this.errorText(e) }));
      }
      if (!mk.IsDone()) throw new KernelError(t('feature.shellFailed', { reason: t('feature.shellTooThick') }));
      const out = mk.Shape();
      if (!this.valid(out)) {
        out.delete();
        throw new KernelError(t('feature.shellFailed', { reason: t('feature.shellTooThick') }));
      }
      const outFaces = ShapeIndex.of(oc, out, T.FACE, arena);
      try {
        const origins: FaceOrigin[][] = outFaces.keys.map(() => []);
        faces.keys.forEach((f, index) => {
          const modified = this.list(mk.Modified(f));
          if (modified.length > 0) {
            for (const m of modified) {
              const j = outFaces.indexOf(m);
              if (j >= 0) origins[j]!.push({ rel: 'modified', kind: 'face', index });
              m.delete();
            }
          } else if (!mk.IsDeleted(f)) {
            const j = outFaces.indexOf(f);
            if (j >= 0) origins[j]!.push({ rel: 'same', kind: 'face', index });
          }
          for (const g of this.list(mk.Generated(f))) {
            const j = outFaces.indexOf(g);
            if (j >= 0) origins[j]!.push({ rel: 'generated', kind: 'face', index });
            g.delete();
          }
        });
        // OCCT can answer "done" and hand back the body untouched (an opened face with a fillet along its edge does): nothing generated is a failure
        if (!origins.some((o) => o.some((x) => x.rel === 'generated'))) {
          out.delete();
          throw new KernelError(t('feature.shellFailed', { reason: t('feature.shellNothingMade') }));
        }
        return { shape: this.put(out), faceOrigins: origins };
      } finally {
        outFaces.dispose();
      }
    } finally {
      faces.dispose();
      arena.dispose();
    }
  }

  /**
   * Moves a planar face `distance` along its outward normal (C10.1, negative = into the material); its
   * neighbours stretch or shrink to follow. OCCT has no face-offset operation in this build, so the
   * change is made as a slab: a plate on the face's plane, `distance` thick, cut down by the surface of
   * every face next to it (each extended past its own boundary, on the side of the face) and then fused
   * to or cut from the body. A slanted wall therefore stays slanted. A neighbour that continues the
   * face smoothly (a fillet round its edge) has no such "side", so it is refused rather than guessed.
   * Origins index the body's faces: the moved face keeps its own, the slab's side faces take their neighbour's.
   */
  moveFace(target: ShapeId, faceIndex: number, distance: number): OpResult {
    if (!Number.isFinite(distance) || Math.abs(distance) < 1e-9) throw new KernelError(t('edit.distanceZero'));
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(target);
    const topo = this.topology(target);
    const info = topo.faces[faceIndex];
    if (!info) throw new KernelError(t('edit.faceOutOfRange', { index: faceIndex }));
    if (info.surface !== 'plane' || !info.normal) throw new KernelError(t('edit.planeOnly'));
    const n = info.normal;
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    const edges = ShapeIndex.of(oc, shape, T.EDGE, arena);
    const nTarget = faces.size;
    const slabFaces: ShapeIndex[] = [];
    try {
      const face = arena.own(oc.TopoDS.Face(faces.keys[faceIndex]!));
      const { min, max } = this.bounds(target);
      const reach = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 4 + Math.abs(distance) + 10;

      // The neighbours: every other face sharing an edge with this one, with those edges.
      const sharing = new Map<number, number[]>();
      topo.edges.forEach((e, ei) => {
        if (e.curve === 'degenerated' || !e.faces.includes(faceIndex)) return;
        for (const g of e.faces) if (g !== faceIndex) sharing.set(g, [...(sharing.get(g) ?? []), ei]);
      });

      /** Points along an edge (the middle, then near each end): where the neighbour's direction is looked at. */
      const along = (edge: TopoDS_Shape): Vec3[] => {
        const ad = arena.own(new oc.BRepAdaptor_Curve(arena.own(oc.TopoDS.Edge(edge))));
        const a = ad.FirstParameter();
        const b = ad.LastParameter();
        return [0.5, 0.15, 0.85].map((k) => this.xyz(arena.own(ad.EvalD0(a + (b - a) * k))));
      };

      /** The face's normal at a point of its surface under `p` (sign aside). */
      const normalAt = (g: TopoDS_Shape, p: Vec3): Vec3 => {
        const gFace = arena.own(oc.TopoDS.Face(g));
        const uv = oc.GeomLib_Tool.Parameters(arena.own(oc.BRep_Tool.Surface(gFace)), this.pnt(arena, p), 1e-3);
        if (!uv.returnValue) throw new KernelError(t('edit.noSurfacePoint'));
        const ad = arena.own(new oc.BRepAdaptor_Surface(gFace, true));
        const d1 = ad.EvalD1(uv.U, uv.V);
        const c = cross3(this.xyz(arena.own(d1.D1U)), this.xyz(arena.own(d1.D1V)));
        arena.own(d1.Point);
        const len = Math.hypot(...c) || 1;
        return [c[0] / len, c[1] / len, c[2] / len];
      };

      // A point of the face next to an edge, to tell on which side of the neighbour's surface the face lies.
      const insidePoint = (edge: TopoDS_Shape, ei: number): Vec3 => {
        const ad = arena.own(new oc.BRepAdaptor_Curve(arena.own(oc.TopoDS.Edge(edge))));
        const d1 = ad.EvalD1((ad.FirstParameter() + ad.LastParameter()) / 2);
        const tangent = this.xyz(arena.own(d1.D1));
        const m = this.xyz(arena.own(d1.Point));
        const w = cross3(n, tangent);
        const wl = Math.hypot(...w) || 1;
        const eps = Math.max(1e-5, Math.min(1e-3 * topo.edges[ei]!.length, 1e-2));
        for (const s of [1, -1]) {
          const p = add(m, w, (s * eps) / wl);
          const c = arena.own(new oc.BRepClass_FaceClassifier(face, this.pnt(arena, p), 1e-7, true, 0.1));
          if (c.State() === oc.TopAbs_State.TopAbs_IN) return p;
        }
        throw new KernelError(t('edit.noPointNearEdge'));
      };

      // How the neighbours stand to the face. Tangent to it: refused (no side to take). Square to it all along: the
      // face can simply be swept, whatever its shape. Anything else: the slab trimmed by the neighbours' surfaces.
      let square = true;
      for (const [g, via] of sharing) {
        for (const ei of via) {
          for (const p of along(edges.keys[ei]!)) {
            const ng = normalAt(faces.keys[g]!, p);
            const across = Math.abs(n[0] * ng[0] + n[1] * ng[1] + n[2] * ng[2]);
            if (across > 1 - 1e-6) throw new KernelError(t('edit.tangentNeighbour'));
            if (across > 1e-6) square = false;
          }
        }
      }

      const moved: FaceOrigin = { rel: 'modified', kind: 'face', index: faceIndex };
      const vector = arena.own(new oc.gp_Vec(n[0] * distance, n[1] * distance, n[2] * distance));
      interface Slab {
        shape: TopoDS_Shape;
        index: ShapeIndex;
        origins: FaceOrigin[][];
      }

      /** The face itself swept along its normal: its sides lie on the neighbours' planes already (all square to it). */
      const sweep = (): Slab => {
        const mkPrism = arena.own(new oc.BRepPrimAPI_MakePrism(face, vector, false, true));
        const shape = arena.own(this.build(mkPrism, t('edit.moveFace'), arena));
        const index = ShapeIndex.of(oc, shape, T.FACE, arena);
        slabFaces.push(index);
        const origins: FaceOrigin[][] = index.keys.map(() => []);
        for (const end of [mkPrism.FirstShape(), mkPrism.LastShape()]) {
          const i = index.indexOf(end);
          if (i >= 0) origins[i] = [moved];
          end.delete();
        }
        // a side of the sweep is named after the face across the edge it was swept from
        for (const ex = arena.own(new oc.TopExp_Explorer(face, T.EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE)); ex.More(); ex.Next()) {
          const edge = ex.Current();
          const ei = edges.indexOf(edge);
          const across = ei < 0 ? undefined : topo.edges[ei]!.faces.find((g) => g !== faceIndex);
          for (const s of this.list(mkPrism.Generated(edge))) {
            const i = index.indexOf(s);
            if (i >= 0 && across !== undefined) origins[i] = [{ rel: 'modified', kind: 'face', index: across }];
            s.delete();
          }
          edge.delete();
        }
        return { shape, index, origins };
      };

      /** A plate on the face's plane, `distance` along the normal, trimmed by each neighbour's surface. */
      const trim = (): Slab => {
        const plane = arena.own(new oc.gp_Pln(this.pnt(arena, info.center), this.dir(arena, n)));
        const plate = arena.own(arena.own(new oc.BRepBuilderAPI_MakeFace(plane, -reach, reach, -reach, reach)).Face());
        const mkPrism = arena.own(new oc.BRepPrimAPI_MakePrism(plate, vector, false, true));
        let shape = arena.own(this.build(mkPrism, t('edit.moveFace'), arena));
        let index = ShapeIndex.of(oc, shape, T.FACE, arena);
        slabFaces.push(index);
        let origins: FaceOrigin[][] = index.keys.map(() => []);
        const start = mkPrism.FirstShape();
        /** The face of the plate that lies on the face's own plane. */
        let base = index.indexOf(start);
        start.delete();
        for (const end of [mkPrism.FirstShape(), mkPrism.LastShape()]) {
          const i = index.indexOf(end);
          if (i >= 0) origins[i] = [moved];
          end.delete();
        }

        for (const [g, via] of sharing) {
          const gShape = faces.keys[g]!;
          const p = insidePoint(edges.keys[via[0]!]!, via[0]!);
          const surface = arena.own(oc.BRep_Tool.Surface(arena.own(oc.TopoDS.Face(gShape))));
          const unbounded = arena.own(arena.own(new oc.BRepBuilderAPI_MakeFace(surface, 1e-7)).Face());
          const half = arena.own(arena.own(new oc.BRepPrimAPI_MakeHalfSpace(unbounded, this.pnt(arena, p))).Solid());
          const halfIndex = ShapeIndex.of(oc, half, T.FACE, arena);
          slabFaces.push(halfIndex);
          const mk = this.boolOp('common', shape, half, t('edit.moveFace'), arena);
          const next = arena.own(mk.Shape());
          const sources = this.faceSources(mk, [...index.keys, ...halfIndex.keys], next, arena);
          const nSlab = index.size;
          const side: FaceOrigin = { rel: 'modified', kind: 'face', index: g };
          const before = origins;
          origins = sources.map((s) => s.flatMap((i): FaceOrigin[] => (i < nSlab ? before[i]! : [side])));
          shape = next;
          index = ShapeIndex.of(oc, shape, T.FACE, arena);
          slabFaces.push(index);
          if (index.size === 0) throw new KernelError(t('edit.noOverlap'));
          base = sources.findIndex((s) => s.includes(base));
        }
        // Each neighbour's surface cuts the whole plate, so a face that is not convex (an L, a ring) would lose its
        // far arms to the surface of an edge on the other arm. The slab's face on the plane must still be the face itself.
        const p = arena.own(new oc.GProp_GProps());
        oc.BRepGProp.SurfaceProperties(index.keys[base]!, p, false, false);
        if (Math.abs(p.Mass() - info.area) > 1e-6 * info.area) throw new KernelError(t('edit.notConvex'));
        return { shape, index, origins };
      };

      // Faces with curved neighbours (the wall of a hole) are trimmed when they can be: that keeps the wall one face with
      // its own name, where a sweep would leave a second face on the same cylinder. Square to every neighbour, a face
      // of any shape can be swept instead, and when every neighbour is a plane there is nothing to keep whole.
      const planarAround = [...sharing.keys()].every((g) => topo.faces[g]!.surface === 'plane');
      let made: Slab;
      if (square && planarAround) made = sweep();
      else if (!square) made = trim();
      else {
        try {
          made = trim();
        } catch (e) {
          if (!(e instanceof KernelError)) throw e;
          made = sweep();
        }
      }
      const slab = made.shape;
      const slabIndex = made.index;
      const slabOrigins = made.origins;

      const mk = this.boolOp(distance > 0 ? 'fuse' : 'cut', shape, slab, t('edit.moveFace'), arena);
      const raw = mk.Shape();
      try {
        const origins = this.history(mk, { faces: [...faces.keys, ...slabIndex.keys], edges: [], verts: [] }, raw, arena);
        // only the faces round the moved one may be regrouped (see unify)
        const touched = new Set([faceIndex, ...sharing.keys()]);
        const apart = topo.edges.flatMap((e, ei) => (e.faces.length > 0 && e.faces.every((g) => !touched.has(g)) ? [edges.keys[ei]!] : []));
        const unified = this.unify(raw, origins, arena, apart);
        if (!this.valid(unified.shape)) {
          unified.shape.delete();
          throw new KernelError(t('edit.moveInvalid'));
        }
        // A face of the slab is named after the face of the body it stands for.
        const same = (a: FaceOrigin, b: FaceOrigin) => JSON.stringify(a) === JSON.stringify(b);
        const faceOrigins = unified.origins.map((list) => {
          const out: FaceOrigin[] = [];
          for (const o of list) {
            const expanded = o.rel !== 'cap' && o.rel !== 'imported' && o.kind === 'face' && o.index >= nTarget ? slabOrigins[o.index - nTarget]! : [o];
            for (const x of expanded) if (!out.some((y) => same(x, y))) out.push(x);
          }
          return out;
        });
        const result = this.put(unified.shape);
        // Pushed into the material by more than the body is thick there, the sweep comes out of the far side:
        // what is taken away is then less than the face's area times the distance. Never hand that over as done.
        if (square && distance < 0) {
          // volumes of a body of thousands of faces are good to about 1e-6 of the whole, so only a clear shortfall counts
          const before = this.massProps(target).volume;
          const taken = before - this.massProps(result).volume;
          if (taken < info.area * -distance * (1 - 1e-3) - 1e-6 * before) {
            this.release(result);
            throw new KernelError(t('edit.moveTooFar'));
          }
        }
        return { shape: result, faceOrigins };
      } finally {
        raw.delete();
      }
    } finally {
      for (const s of slabFaces) s.dispose();
      faces.dispose();
      edges.dispose();
      arena.dispose();
    }
  }

  /** For each output face: the indices of the input faces it is (or was modified from). */
  private faceSources(mk: BRepBuilderAPI_MakeShape, inputs: TopoDS_Shape[], out: TopoDS_Shape, arena: Arena): number[][] {
    const outFaces = ShapeIndex.of(this.oc, out, T.FACE, arena);
    try {
      const sources: number[][] = outFaces.keys.map(() => []);
      inputs.forEach((f, index) => {
        if (mk.IsDeleted(f)) return;
        const modified = this.list(mk.Modified(f));
        const targets = modified.length > 0 ? modified.map((m) => outFaces.indexOf(m)) : [outFaces.indexOf(f)];
        for (const m of modified) m.delete();
        for (const j of targets) if (j >= 0) sources[j]!.push(index);
      });
      return sources;
    } finally {
      outFaces.dispose();
    }
  }

  /**
   * Generic provenance from a BRepBuilderAPI_MakeShape: same / modified faces and faces generated
   * from edges or vertices. Inputs are lists, so operations with two inputs pass them concatenated.
   */
  private history(
    mk: BRepBuilderAPI_MakeShape,
    inputs: { faces: TopoDS_Shape[]; edges: TopoDS_Shape[]; verts: TopoDS_Shape[] },
    out: TopoDS_Shape,
    arena: Arena,
  ): FaceOrigin[][] {
    const outFaces = ShapeIndex.of(this.oc, out, T.FACE, arena);
    try {
      const origins: FaceOrigin[][] = outFaces.keys.map(() => []);
      const mark = (shapes: TopoDS_Shape[], origin: FaceOrigin) => {
        for (const s of shapes) {
          const i = outFaces.indexOf(s);
          if (i >= 0) origins[i]!.push(origin);
          s.delete();
        }
      };
      inputs.faces.forEach((f, index) => {
        if (mk.IsDeleted(f)) return;
        const modified = this.list(mk.Modified(f));
        if (modified.length > 0) {
          mark(modified, { rel: 'modified', kind: 'face', index });
        } else {
          const i = outFaces.indexOf(f);
          if (i >= 0) origins[i]!.push({ rel: 'same', kind: 'face', index });
        }
      });
      inputs.edges.forEach((e, index) => mark(this.list(mk.Generated(e)), { rel: 'generated', kind: 'edge', index }));
      inputs.verts.forEach((v, index) => mark(this.list(mk.Generated(v)), { rel: 'generated', kind: 'vertex', index }));
      return origins;
    } finally {
      outFaces.dispose();
    }
  }

  // ------------------------------------------------------------------ queries

  topology(id: ShapeId): Topology {
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(id);
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    const edges = ShapeIndex.of(oc, shape, T.EDGE, arena);
    const verts = ShapeIndex.of(oc, shape, T.VERTEX, arena);
    try {
      const children = (s: TopoDS_Shape, type: string, index: ShapeIndex): number[] => {
        const found = new Set<number>();
        const ex = arena.own(new oc.TopExp_Explorer(s, type as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
        for (; ex.More(); ex.Next()) {
          const c = ex.Current();
          const i = index.indexOf(c);
          if (i >= 0) found.add(i);
          c.delete();
        }
        return [...found];
      };
      const edgeFaces: number[][] = edges.keys.map(() => []);
      const vertexFaces: number[][] = verts.keys.map(() => []);
      const faceInfos: FaceInfo[] = faces.keys.map((f, fi) => {
        for (const ei of children(f, T.EDGE, edges)) edgeFaces[ei]!.push(fi);
        for (const vi of children(f, T.VERTEX, verts)) vertexFaces[vi]!.push(fi);
        return this.faceInfo(f, arena);
      });
      const edgeInfos: EdgeInfo[] = edges.keys.map((e, ei) => ({
        ...this.edgeInfo(e, arena),
        faces: edgeFaces[ei]!,
        vertices: children(e, T.VERTEX, verts),
      }));
      const vertexInfos: VertexInfo[] = verts.keys.map((v, vi) => ({
        point: this.xyz(arena.own(oc.BRep_Tool.Pnt(arena.own(oc.TopoDS.Vertex(v))))),
        faces: vertexFaces[vi]!,
      }));
      return { faces: faceInfos, edges: edgeInfos, vertices: vertexInfos };
    } finally {
      faces.dispose();
      edges.dispose();
      verts.dispose();
      arena.dispose();
    }
  }

  private faceInfo(f: TopoDS_Shape, arena: Arena): FaceInfo {
    const oc = this.oc;
    const face = arena.own(oc.TopoDS.Face(f));
    const ad = arena.own(new oc.BRepAdaptor_Surface(face, true));
    const type = ad.GetType();
    const props = arena.own(new oc.GProp_GProps());
    oc.BRepGProp.SurfaceProperties(face, props, false, false);
    const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    const surface = String(type).replace('GeomAbs_', '').toLowerCase();
    const center = this.xyz(arena.own(props.CentreOfMass()));
    const xyz = (v: { X(): number; Y(): number; Z(): number; delete(): void }) => this.xyz(arena.own(v));
    // The face's outward normal at the middle of its parameter range: the surface's own normal
    // (∂u × ∂v), turned round on a reversed face. The frames that Plane(), Cylinder() … report do not
    // follow the parametrization for surfaces of revolution (a revolved line's plane may point either
    // way), so they give the axis and size, never the side.
    const d1 = ad.EvalD1((ad.FirstUParameter() + ad.LastUParameter()) / 2, (ad.FirstVParameter() + ad.LastVParameter()) / 2);
    const at = xyz(d1.Point);
    const n = cross3(xyz(d1.D1U), xyz(d1.D1V));
    const out: Vec3 = reversed ? [-n[0], -n[1], -n[2]] : n;
    /** Whether the outward normal points away from `from` (seen across `axis`, when given). */
    const away = (from: Vec3, axis?: Vec3) => {
      const v: Vec3 = [at[0] - from[0], at[1] - from[1], at[2] - from[2]];
      const r = axis ? sub3(v, scale3(axis, dot3(v, axis))) : v;
      return dot3(out, r) > 0;
    };
    let normal: Vec3 | null = null;
    let geometry: SurfaceGeometry | undefined;
    if (surface === 'plane') {
      const d = xyz(arena.own(arena.own(ad.Plane()).Axis()).Direction());
      normal = dot3(d, out) < 0 ? [-d[0], -d[1], -d[2]] : d;
      geometry = { type: 'plane', origin: center, normal };
    } else if (surface === 'cylinder') {
      const s = arena.own(ad.Cylinder());
      const axis = arena.own(s.Axis());
      const origin = xyz(axis.Location());
      const dir = xyz(axis.Direction());
      geometry = { type: 'cylinder', origin, axis: dir, radius: s.Radius(), convex: away(origin, dir) };
    } else if (surface === 'cone') {
      const s = arena.own(ad.Cone());
      const apex = xyz(s.Apex());
      const dir = xyz(arena.own(s.Axis()).Direction());
      geometry = { type: 'cone', apex, axis: dir, halfAngle: s.SemiAngle(), convex: away(apex, dir) };
    } else if (surface === 'sphere') {
      const s = arena.own(ad.Sphere());
      const c = xyz(s.Location());
      geometry = { type: 'sphere', center: c, radius: s.Radius(), convex: away(c) };
    } else if (surface === 'torus') {
      const s = arena.own(ad.Torus());
      const c = xyz(s.Location());
      const dir = xyz(arena.own(s.Axis()).Direction());
      // The tube's center line, where it passes the evaluated point.
      const v: Vec3 = [at[0] - c[0], at[1] - c[1], at[2] - c[2]];
      const radial = sub3(v, scale3(dir, dot3(v, dir)));
      const ring = scale3(radial, s.MajorRadius() / (Math.hypot(...radial) || 1));
      geometry = { type: 'torus', center: c, axis: dir, major: s.MajorRadius(), minor: s.MinorRadius(), convex: away([c[0] + ring[0], c[1] + ring[1], c[2] + ring[2]]) };
    }
    return { surface, area: props.Mass(), center, normal, ...(geometry ? { geometry } : {}) };
  }

  private edgeInfo(e: TopoDS_Shape, arena: Arena): Omit<EdgeInfo, 'faces' | 'vertices'> {
    const oc = this.oc;
    const edge = arena.own(oc.TopoDS.Edge(e));
    if (oc.BRep_Tool.Degenerated(edge)) return { curve: 'degenerated', length: 0, mid: [0, 0, 0], dir: null };
    const ad = arena.own(new oc.BRepAdaptor_Curve(edge));
    const type = String(ad.GetType()).replace('GeomAbs_', '').toLowerCase();
    const t0 = ad.FirstParameter();
    const t1 = ad.LastParameter();
    const props = arena.own(new oc.GProp_GProps());
    oc.BRepGProp.LinearProperties(edge, props, false, false);
    const p0 = this.xyz(arena.own(ad.EvalD0(t0)));
    const p1 = this.xyz(arena.own(ad.EvalD0(t1)));
    let dir: Vec3 | null = null;
    let geometry: CurveGeometry | undefined;
    if (type === 'line') {
      const d: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const n = Math.hypot(...d) || 1;
      dir = [d[0] / n, d[1] / n, d[2] / n];
      geometry = { type: 'line', origin: p0, dir };
    } else if (type === 'circle') {
      const c = arena.own(ad.Circle());
      const axis = arena.own(c.Axis());
      geometry = { type: 'circle', center: this.xyz(arena.own(axis.Location())), normal: this.xyz(arena.own(axis.Direction())), radius: c.Radius() };
    }
    return { curve: type, length: props.Mass(), mid: this.xyz(arena.own(ad.EvalD0((t0 + t1) / 2))), dir, ...(geometry ? { geometry } : {}) };
  }

  massProps(id: ShapeId): MassProps {
    const oc = this.oc;
    const arena = new Arena();
    try {
      const shape = this.get(id);
      const v = arena.own(new oc.GProp_GProps());
      oc.BRepGProp.VolumeProperties(shape, v, false, false, false);
      const s = arena.own(new oc.GProp_GProps());
      oc.BRepGProp.SurfaceProperties(shape, s, false, false);
      return { volume: v.Mass(), area: s.Mass(), center: this.xyz(arena.own(v.CentreOfMass())) };
    } finally {
      arena.dispose();
    }
  }

  /** Axis-aligned bounding box (sizes through-all and up-to-face extrusions). */
  bounds(id: ShapeId): { min: Vec3; max: Vec3 } {
    const arena = new Arena();
    try {
      const box = arena.own(new this.oc.Bnd_Box());
      this.oc.BRepBndLib.Add(this.get(id), box, false);
      return { min: this.xyz(arena.own(box.CornerMin())), max: this.xyz(arena.own(box.CornerMax())) };
    } finally {
      arena.dispose();
    }
  }

  isValid(id: ShapeId): boolean {
    return this.valid(this.get(id));
  }

  private valid(shape: TopoDS_Shape): boolean {
    const arena = new Arena();
    try {
      return arena.own(new this.oc.BRepCheck_Analyzer(shape, true, false, false)).IsValid();
    } finally {
      arena.dispose();
    }
  }

  // ------------------------------------------------------------------ tessellation (A4.1)

  /** A shape keeps the finest mesh it has had: BRepMesh refines one, never coarsens it. Mesh a shape once, with the setting it is to have. */
  mesh(id: ShapeId, options: MeshOptions = {}): MeshData {
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(id);
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    const edges = ShapeIndex.of(oc, shape, T.EDGE, arena);
    try {
      let tolerance = options.tolerance;
      if (tolerance === undefined) {
        const box = arena.own(new oc.Bnd_Box());
        oc.BRepBndLib.Add(shape, box, false);
        const a = this.xyz(arena.own(box.CornerMin()));
        const b = this.xyz(arena.own(box.CornerMax()));
        tolerance = Math.min(1, Math.max(0.002, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * (options.relative ?? 5e-4)));
      }
      const angular = options.angular ?? 0.25;
      arena.own(new oc.BRepMesh_IncrementalMesh(shape, tolerance, false, angular, false));

      // Faces: per-face vertices (crisp edges between faces), winding flipped on reversed faces.
      const positions: number[] = [];
      const indices: number[] = [];
      const faceRanges: number[] = [];
      faces.keys.forEach((f, fi) => {
        const face = arena.own(oc.TopoDS.Face(f));
        const loc = arena.own(new oc.TopLoc_Location());
        const tri = oc.BRep_Tool.Triangulation(face, loc, 0);
        if (!tri) return;
        arena.own(tri); // an owning handle copy: deleting it leaves the face's triangulation intact
        const trsf = arena.own(loc.Transformation());
        const base = positions.length / 3;
        for (let n = 1; n <= tri.NbNodes(); n++) {
          const p = arena.own(arena.own(tri.Node(n)).Transformed(trsf));
          positions.push(p.X(), p.Y(), p.Z());
        }
        const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
        const start = indices.length;
        for (let k = 1; k <= tri.NbTriangles(); k++) {
          const t = arena.own(tri.Triangle(k));
          const { theN1, theN2, theN3 } = t.Get();
          indices.push(base + theN1 - 1, base + (reversed ? theN3 : theN2) - 1, base + (reversed ? theN2 : theN3) - 1);
        }
        faceRanges.push(start, indices.length - start, fi);
      });

      // Edges: tangential-deflection polylines, independent of the face tessellation.
      const edgePoints: number[] = [];
      const edgeRanges: number[] = [];
      edges.keys.forEach((e, ei) => {
        const edge = arena.own(oc.TopoDS.Edge(e));
        if (oc.BRep_Tool.Degenerated(edge)) return;
        const curve = arena.own(new oc.BRepAdaptor_Curve(edge));
        // Exactly three arguments: with six, arity-based dispatch picks the (first, last parameter) overload.
        const pts = arena.own(new oc.GCPnts_TangentialDeflection(curve, angular, tolerance));
        const start = edgePoints.length / 3;
        for (let i = 1; i <= pts.NbPoints(); i++) {
          const p = arena.own(pts.Value(i));
          edgePoints.push(p.X(), p.Y(), p.Z());
        }
        edgeRanges.push(start, edgePoints.length / 3 - start, ei);
      });

      return {
        positions: Float32Array.from(positions),
        normals: smoothNormals(positions, indices, faceRanges),
        indices: Uint32Array.from(indices),
        faceRanges: Int32Array.from(faceRanges),
        edgePoints: Float32Array.from(edgePoints),
        edgeRanges: Int32Array.from(edgeRanges),
      };
    } finally {
      faces.dispose();
      edges.dispose();
      arena.dispose();
    }
  }

  // ------------------------------------------------------------------ exchange (F1, F2)

  /**
   * STEP AP214 through XCAF so the product carries the part name (F1.1). `Perform` is used instead of
   * `Transfer` + `Write`: the binding cannot pass a null "multi-file" prefix, and an empty string would
   * split geometry into external files.
   */
  exportStep(id: ShapeId, productName = 'Part', unit: 'MM' | 'INCH' = 'MM'): string {
    const oc = this.oc;
    const arena = new Arena();
    const path = `/export-${++this.fileSeq}.step`;
    const doc = new oc.TDocStd_Document(arena.own(new oc.TCollection_ExtendedString('XmlXCAF', false)));
    try {
      oc.Interface_Static.SetCVal('write.step.unit', unit);
      // Attribute and tool wrappers are owned by the document; only the document itself is deleted.
      const label = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main()).AddShape(this.get(id), false, true);
      oc.TDataStd_Name.Set(label, arena.own(new oc.TCollection_ExtendedString(productName, true)));
      const w = arena.own(new oc.STEPCAFControl_Writer());
      w.SetNameMode(true);
      w.SetColorMode(true);
      let ok: boolean;
      try {
        ok = w.Perform(doc, path, arena.own(new oc.Message_ProgressRange()));
      } catch (e) {
        throw new KernelError(`STEP 輸出失敗：${this.errorText(e)}`);
      }
      if (!ok) throw new KernelError('STEP 輸出失敗');
      return oc.FS.readFile(path, { encoding: 'utf8' }) as string;
    } finally {
      doc.delete();
      try {
        oc.FS.unlink(path);
      } catch {
        // not written
      }
      arena.dispose();
    }
  }

  /**
   * STEP AP214 of an assembly (F1.2): one product per part (`parts`, the shape and its name), one
   * component per instance placing a part by its pose (`instances`: an index of `parts`, the
   * instance's name, position and unit quaternion x y z w). One level; millimetres unless `unit` says.
   * A pose maps part coordinates to assembly coordinates, the same way `Component.placement` does.
   */
  exportAssemblyStep(
    name: string,
    parts: readonly { shape: ShapeId; name: string }[],
    instances: readonly { part: number; name: string; position: Vec3; rotation: [number, number, number, number] }[],
    unit: 'MM' | 'INCH' = 'MM',
  ): string {
    if (instances.length === 0) throw new KernelError('組合件沒有可輸出的零組件');
    const oc = this.oc;
    const arena = new Arena();
    const path = `/export-${++this.fileSeq}.step`;
    const doc = new oc.TDocStd_Document(arena.own(new oc.TCollection_ExtendedString('XmlXCAF', false)));
    const label = (l: { delete(): void }, text: string) => oc.TDataStd_Name.Set(l as never, arena.own(new oc.TCollection_ExtendedString(text, true)));
    try {
      oc.Interface_Static.SetCVal('write.step.unit', unit);
      const tool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
      const root = tool.NewShape();
      label(root, name);
      const prototypes = parts.map((p) => {
        const l = tool.AddShape(this.get(p.shape), false, true);
        label(l, p.name);
        return l;
      });
      for (const inst of instances) {
        const proto = prototypes[inst.part];
        if (!proto) throw new KernelError(`零組件「${inst.name}」的零件不存在`);
        // OCCT turns a quaternion that is not a unit one into a skewed matrix without a word.
        if (![...inst.position, ...inst.rotation].every(Number.isFinite) || Math.abs(Math.hypot(...inst.rotation) - 1) > 1e-9) {
          throw new KernelError(`零組件「${inst.name}」的位姿無效`);
        }
        // SetRotation and SetTranslationPart each have one gp_Trsf overload; SetTransformation(q, v) shares its arity with another.
        const trsf = arena.own(new oc.gp_Trsf());
        const [qx, qy, qz, qw] = inst.rotation;
        trsf.SetRotation(arena.own(new oc.gp_Quaternion(qx, qy, qz, qw)));
        trsf.SetTranslationPart(arena.own(new oc.gp_Vec(inst.position[0], inst.position[1], inst.position[2])));
        const component = tool.AddComponent(root, proto, arena.own(new oc.TopLoc_Location(trsf)));
        label(component, inst.name);
      }
      tool.UpdateAssemblies();
      const w = arena.own(new oc.STEPCAFControl_Writer());
      w.SetNameMode(true);
      w.SetColorMode(true);
      let ok: boolean;
      try {
        ok = w.Perform(doc, path, arena.own(new oc.Message_ProgressRange()));
      } catch (e) {
        throw new KernelError(`STEP 輸出失敗：${this.errorText(e)}`);
      }
      if (!ok) throw new KernelError('STEP 輸出失敗');
      return oc.FS.readFile(path, { encoding: 'utf8' }) as string;
    } finally {
      doc.delete();
      try {
        oc.FS.unlink(path);
      } catch {
        // not written
      }
      arena.dispose();
    }
  }

  /**
   * STEP import (F2.1, F2.2): the file's solids, in millimetres whatever unit the file uses. A shape that
   * fails the validity check is healed by ShapeFix; a valid one is left exactly as read, since ShapeFix
   * always touches something. A file with surfaces and no solid has them sewn together (within
   * `options.sewTolerance`) and closed into solids, or is refused with how many edges stayed open.
   * Faces keep their order in the shape, which is what imported faces are named by; faces that belong to
   * no solid, next to solids, are left out. `diagnostics` says what was found and done, in numbers.
   */
  importStep(data: Uint8Array | string, options: ImportOptions = {}): ImportResult {
    const oc = this.oc;
    const arena = new Arena();
    const path = `/import-${++this.fileSeq}.step`;
    try {
      oc.FS.writeFile(path, data);
      const r = arena.own(new oc.STEPControl_Reader());
      let status;
      try {
        status = r.ReadFile(path);
      } catch (e) {
        throw new KernelError(t('import.cannotRead', { reason: this.errorText(e) }));
      }
      if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new KernelError(t('import.notStep'));
      r.TransferRoots(arena.own(new oc.Message_ProgressRange()));
      if (r.NbShapes() === 0) throw new KernelError(t('import.noShapes'));
      return this.repairImport(arena.own(r.OneShape()), options);
    } finally {
      try {
        oc.FS.unlink(path);
      } catch {
        // not written
      }
      arena.dispose();
    }
  }

  /**
   * What `importStep` does with a shape once it is read: check it, heal it if it fails, sew surfaces into solids if
   * it has none, count what it found (F2.2). Public so that defects a STEP reader would already have mended can be
   * made in memory and tested; the shape passed in stays the caller's.
   */
  repairImport(read: TopoDS_Shape, options: ImportOptions = {}): ImportResult {
    const oc = this.oc;
    const arena = new Arena();
    const warnings: string[] = [];
    try {
      const count = (s: TopoDS_Shape, type: string) => {
        const index = ShapeIndex.of(oc, s, type, arena);
        const n = index.size;
        index.dispose();
        return n;
      };
      const diagnostics: ImportDiagnostics = {
        solids: count(read, 'TopAbs_SOLID'),
        faces: count(read, T.FACE),
        looseFaces: 0,
        validBefore: this.valid(read),
        healed: false,
        sewn: false,
        sewTolerance: null,
        freeEdges: null,
        validAfter: true,
      };
      let current = read;
      if (!diagnostics.validBefore) {
        const fix = arena.own(new oc.ShapeFix_Shape(read));
        fix.Perform(arena.own(new oc.Message_ProgressRange()));
        current = arena.own(fix.Shape());
        diagnostics.healed = true;
        warnings.push(t('import.healed'));
      }

      let result: TopoDS_Shape;
      if (count(current, 'TopAbs_SOLID') === 0) {
        result = this.sewIntoSolids(current, options.sewTolerance ?? DEFAULT_SEW_TOLERANCE, diagnostics, warnings, arena);
      } else {
        const solids = ShapeIndex.of(oc, current, 'TopAbs_SOLID', arena);
        try {
          if (solids.size === 1) result = solids.keys[0]!.Oriented(solids.keys[0]!.Orientation());
          else result = this.compound(solids.keys, arena);
        } finally {
          solids.dispose();
        }
        diagnostics.looseFaces = count(current, T.FACE) - count(result, T.FACE);
        if (diagnostics.looseFaces > 0) warnings.push(t('import.looseFaces', { n: diagnostics.looseFaces }));
      }
      const id = this.put(result);
      diagnostics.validAfter = this.isValid(id);
      if (!diagnostics.validAfter) warnings.push(t('import.stillInvalid'));
      const faces = count(result, T.FACE);
      return { shape: id, faceOrigins: Array.from({ length: faces }, (_, index) => [{ rel: 'imported', index }]), warnings, diagnostics };
    } finally {
      arena.dispose();
    }
  }

  /** One shape holding all of `shapes` (a compound is only made when there are several). */
  private compound(shapes: TopoDS_Shape[], arena: Arena): TopoDS_Shape {
    const compound = arena.own(new this.oc.TopoDS_Compound());
    const builder = arena.own(new this.oc.BRep_Builder());
    builder.MakeCompound(compound);
    for (const s of shapes) builder.Add(compound, s);
    return compound.Oriented(compound.Orientation());
  }

  /**
   * Sews every face of a shape that has no solid into shells and closes each into a solid (F2.2). If
   * some edge stays with one face the surfaces do not enclose anything: that is reported, with the
   * count, instead of guessing a solid out of an open shell.
   */
  private sewIntoSolids(shape: TopoDS_Shape, tolerance: number, diagnostics: ImportDiagnostics, warnings: string[], arena: Arena): TopoDS_Shape {
    const oc = this.oc;
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    try {
      if (faces.size === 0) throw new KernelError(t('import.noSolid'));
      const sewing = arena.own(new oc.BRepBuilderAPI_Sewing(tolerance, true, true, true, false));
      for (const f of faces.keys) sewing.Add(f);
      sewing.Perform(arena.own(new oc.Message_ProgressRange()));
      diagnostics.sewn = true;
      diagnostics.sewTolerance = tolerance;
      diagnostics.freeEdges = sewing.NbFreeEdges();
      if (diagnostics.freeEdges > 0) throw new KernelError(t('import.openSurfaces', { n: diagnostics.freeEdges, tolerance }));
      const sewn = arena.own(sewing.SewedShape());
      const shells = ShapeIndex.of(oc, sewn, 'TopAbs_SHELL', arena);
      try {
        const fix = arena.own(new oc.ShapeFix_Solid());
        const solids = shells.keys.map((s) => arena.own(fix.SolidFromShell(arena.own(oc.TopoDS.Shell(s)))));
        if (solids.length === 0) throw new KernelError(t('import.noSolid'));
        warnings.push(t('import.sewn', { faces: faces.size, solids: solids.length, tolerance }));
        return solids.length === 1 ? solids[0]!.Oriented(solids[0]!.Orientation()) : this.compound(solids, arena);
      } finally {
        shells.dispose();
      }
    } finally {
      faces.dispose();
    }
  }
}
/** Sewing tolerance when a file has surfaces and no solid, in mm: more than the gaps files leave between faces, less than any feature. */
const DEFAULT_SEW_TOLERANCE = 0.01;

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
