import type { BRepBuilderAPI_MakeShape, NCollection_List_TopoDS_Shape, TopoDS_Shape, TopoDS_Wire } from 'libcascade/single/init';
import { Arena, loadOcct, ShapeIndex, type LoadOptions, type OC } from './occt';
import {
  KernelError,
  type CurveGeometry,
  type EdgeInfo,
  type FaceInfo,
  type FaceOrigin,
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
   * Extrudes sketch regions along `vector`, starting `offset` along the plane normal (C4.1).
   * Side faces originate from profile edges (tagged with their sketch entity), caps from start/end.
   * With `until`, the extrusion (long enough to pass it) ends on the surface of a face of `until.target`
   * (「成形至某一面」); the face it ends on becomes the end cap.
   */
  extrude(frame: Frame, regions: Region[], vector: Vec3, offset = 0, until?: { target: ShapeId; face: number }): OpResult {
    if (regions.length === 0) throw new KernelError('沒有可伸長的封閉輪廓');
    const oc = this.oc;
    const arena = new Arena();
    try {
      const f: Frame = { ...frame, origin: add(frame.origin, frame.normal, offset) };
      const sources = new Map<TopoDS_Shape, string>();
      const profile = this.profile(arena, f, regions, sources);
      const vec = arena.own(new oc.gp_Vec(vector[0], vector[1], vector[2]));
      const mk = arena.own(new oc.BRepPrimAPI_MakePrism(profile, vec, false, true));
      const out = this.build(mk, '伸長', arena);
      const origins = this.sweepOrigins(mk, out, sources, arena);
      if (!until) return { shape: this.put(out), faceOrigins: origins };
      try {
        return this.trimAtFace(out, origins, until, vector, arena);
      } finally {
        out.delete();
      }
    } finally {
      arena.dispose();
    }
  }

  /** Cuts a sweep off at the (unbounded) surface of a target face; faces it gains from that surface are the end cap. */
  private trimAtFace(tool: TopoDS_Shape, origins: FaceOrigin[][], until: { target: ShapeId; face: number }, vector: Vec3, arena: Arena): OpResult {
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
        return { shape: this.put(out), faceOrigins: trimmed };
      } finally {
        toolFaces.dispose();
        cutterFaces.dispose();
      }
    } finally {
      targetFaces.dispose();
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

  private boolOp(op: 'fuse' | 'cut', a: TopoDS_Shape, b: TopoDS_Shape, label: string, arena: Arena) {
    const oc = this.oc;
    let mk;
    try {
      // The constructor with arguments performs the operation; Build() would run it again.
      const range = arena.own(new oc.Message_ProgressRange());
      mk = arena.own(op === 'fuse' ? new oc.BRepAlgoAPI_Fuse(a, b, range) : new oc.BRepAlgoAPI_Cut(a, b, range));
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
  boolean(op: 'fuse' | 'cut', target: ShapeId, tool: ShapeId): OpResult {
    const oc = this.oc;
    const arena = new Arena();
    const a = this.get(target);
    const b = this.get(tool);
    const index = (s: TopoDS_Shape) => ({ faces: ShapeIndex.of(oc, s, T.FACE, arena), edges: ShapeIndex.of(oc, s, T.EDGE, arena), verts: ShapeIndex.of(oc, s, T.VERTEX, arena) });
    const ia = index(a);
    const ib = index(b);
    try {
      const mk = this.boolOp(op, a, b, op === 'fuse' ? '合併' : '除料', arena);
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

  /** Merges faces lying on the same surface; a merged face keeps the origins of all its pieces (G4 in ADR 0003). */
  private unify(shape: TopoDS_Shape, origins: FaceOrigin[][], arena: Arena): { shape: TopoDS_Shape; origins: FaceOrigin[][] } {
    const oc = this.oc;
    const u = arena.own(new oc.ShapeUpgrade_UnifySameDomain(shape, true, true, false));
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
   * STEP import (F2.1): the file's solids, in millimetres whatever unit the file uses. A shape that
   * fails the validity check is healed by ShapeFix (F2.2, basic); a valid one is left exactly as
   * read, since ShapeFix always touches something. Faces keep their order in the shape, which is
   * what imported faces are named by; anything that is not part of a solid is left out.
   */
  importStep(data: Uint8Array | string): ImportResult {
    const oc = this.oc;
    const arena = new Arena();
    const path = `/import-${++this.fileSeq}.step`;
    const warnings: string[] = [];
    try {
      oc.FS.writeFile(path, data);
      const r = arena.own(new oc.STEPControl_Reader());
      let status;
      try {
        status = r.ReadFile(path);
      } catch (e) {
        throw new KernelError(`無法讀取 STEP 檔：${this.errorText(e)}`);
      }
      if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new KernelError('無法讀取 STEP 檔（格式錯誤，或不是 STEP 檔）');
      r.TransferRoots(arena.own(new oc.Message_ProgressRange()));
      if (r.NbShapes() === 0) throw new KernelError('STEP 檔中沒有形狀');
      let healed = arena.own(r.OneShape());
      if (!this.valid(healed)) {
        const fix = arena.own(new oc.ShapeFix_Shape(healed));
        fix.Perform(arena.own(new oc.Message_ProgressRange()));
        healed = arena.own(fix.Shape());
        warnings.push('輸入的幾何有缺陷，已自動修復');
      }

      // Solids only: surfaces cannot take part in solid features yet (sewing them is F2.2, P1).
      const solids = ShapeIndex.of(oc, healed, 'TopAbs_SOLID', arena);
      let result: TopoDS_Shape;
      try {
        if (solids.size === 0) throw new KernelError('STEP 檔中沒有實體（可能只有曲面或線架構），目前只能輸入實體');
        if (solids.size === 1) result = solids.keys[0]!.Oriented(solids.keys[0]!.Orientation());
        else {
          const compound = new oc.TopoDS_Compound();
          const builder = arena.own(new oc.BRep_Builder());
          builder.MakeCompound(compound);
          for (const solid of solids.keys) builder.Add(compound, solid);
          result = compound;
        }
      } finally {
        solids.dispose();
      }
      const id = this.put(result);
      const count = (s: TopoDS_Shape) => {
        const faces = ShapeIndex.of(oc, s, T.FACE, arena);
        const n = faces.size;
        faces.dispose();
        return n;
      };
      const faces = count(result);
      const loose = count(healed) - faces;
      if (loose > 0) warnings.push(`略過 ${loose} 個不屬於實體的面`);
      if (!this.isValid(id)) warnings.push('輸入的幾何沒有通過有效性檢查，後續特徵可能失敗');
      return { shape: id, faceOrigins: Array.from({ length: faces }, (_, index) => [{ rel: 'imported', index }]), warnings };
    } finally {
      try {
        oc.FS.unlink(path);
      } catch {
        // not written
      }
      arena.dispose();
    }
  }
}

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
