import type { BRepBuilderAPI_MakeShape, NCollection_List_TopoDS_Shape, TopoDS_Shape, TopoDS_Wire } from 'replicad-opencascadejs';
import { Arena, loadOcct, ShapeIndex, type LoadOptions, type OC } from './occt';
import {
  KernelError,
  type EdgeInfo,
  type FaceInfo,
  type FaceOrigin,
  type MassProps,
  type MeshData,
  type OpResult,
  type ShapeId,
  type Topology,
  type Vec3,
  type VertexInfo,
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

  /**
   * Extrudes sketch regions along `vector`, starting `offset` along the plane normal (C4.1).
   * Side faces originate from profile edges (tagged with their sketch entity), caps from start/end.
   */
  extrude(frame: Frame, regions: Region[], vector: Vec3, offset = 0): OpResult {
    if (regions.length === 0) throw new KernelError('沒有可伸長的封閉輪廓');
    const oc = this.oc;
    const arena = new Arena();
    try {
      const f: Frame = { ...frame, origin: add(frame.origin, frame.normal, offset) };
      const sources = new Map<TopoDS_Shape, string>();
      const plane = arena.own(
        new oc.gp_Pln(arena.own(new oc.gp_Ax3(this.pnt(arena, f.origin), this.dir(arena, f.normal), this.dir(arena, f.xDir)))),
      );
      const faces = regions.map((r) => {
        const mf = arena.own(new oc.BRepBuilderAPI_MakeFace(plane, this.wire(arena, f, r.outer, false, sources), true));
        for (const h of r.holes) mf.Add(this.wire(arena, f, h, true, sources));
        if (!mf.IsDone()) throw new KernelError('無法由輪廓建立面');
        return arena.own(mf.Face());
      });
      let profile: TopoDS_Shape = faces[0]!;
      if (faces.length > 1) {
        const compound = arena.own(new oc.TopoDS_Compound());
        const builder = arena.own(new oc.TopoDS_Builder());
        builder.MakeCompound(compound);
        for (const face of faces) builder.Add(compound, face);
        profile = compound;
      }
      const vec = arena.own(new oc.gp_Vec(vector[0], vector[1], vector[2]));
      const mk = arena.own(new oc.BRepPrimAPI_MakePrism(profile, vec, false, true));
      const out = this.build(mk, '伸長', arena);
      const outFaces = ShapeIndex.of(oc, out, T.FACE, arena);
      try {
        const origins: FaceOrigin[][] = outFaces.keys.map(() => []);
        const mark = (shapes: TopoDS_Shape[], origin: FaceOrigin) => {
          for (const s of shapes) {
            const i = outFaces.indexOf(s);
            if (i >= 0) origins[i]!.push(origin);
            s.delete();
          }
        };
        for (const [edge, source] of sources) mark(this.list(mk.Generated(edge)), { rel: 'generated', kind: 'profileEdge', source });
        const caps = (shape: TopoDS_Shape, which: 'start' | 'end') => {
          const idx = ShapeIndex.of(oc, shape, T.FACE, arena);
          mark(idx.keys.splice(0), { rel: 'cap', which });
          shape.delete();
        };
        caps(mk.FirstShape(), 'start');
        caps(mk.LastShape(), 'end');
        return { shape: this.put(out), faceOrigins: origins };
      } finally {
        outFaces.dispose();
      }
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
      return { shape: this.put(out), faceOrigins: this.history(mk, faces, edges, verts, out, arena) };
    } finally {
      faces.dispose();
      edges.dispose();
      verts.dispose();
      arena.dispose();
    }
  }

  /** Generic provenance from a BRepBuilderAPI_MakeShape: same / modified faces and faces generated from edges or vertices. */
  private history(mk: BRepBuilderAPI_MakeShape, faces: ShapeIndex, edges: ShapeIndex, verts: ShapeIndex, out: TopoDS_Shape, arena: Arena): FaceOrigin[][] {
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
      faces.keys.forEach((f, index) => {
        if (mk.IsDeleted(f)) return;
        const modified = this.list(mk.Modified(f));
        if (modified.length > 0) {
          mark(modified, { rel: 'modified', kind: 'face', index });
        } else {
          const i = outFaces.indexOf(f);
          if (i >= 0) origins[i]!.push({ rel: 'same', kind: 'face', index });
        }
      });
      edges.keys.forEach((e, index) => mark(this.list(mk.Generated(e)), { rel: 'generated', kind: 'edge', index }));
      verts.keys.forEach((v, index) => mark(this.list(mk.Generated(v)), { rel: 'generated', kind: 'vertex', index }));
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
    let normal: Vec3 | null = null;
    if (type === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
      const d = this.xyz(arena.own(arena.own(arena.own(ad.Plane()).Axis()).Direction()));
      const flip = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
      normal = [d[0] * flip, d[1] * flip, d[2] * flip];
    }
    return {
      surface: String(type).replace('GeomAbs_', '').toLowerCase(),
      area: props.Mass(),
      center: this.xyz(arena.own(props.CentreOfMass())),
      normal,
    };
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
    if (type === 'line') {
      const d: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const n = Math.hypot(...d) || 1;
      dir = [d[0] / n, d[1] / n, d[2] / n];
    }
    return { curve: type, length: props.Mass(), mid: this.xyz(arena.own(ad.EvalD0((t0 + t1) / 2))), dir };
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

  isValid(id: ShapeId): boolean {
    const arena = new Arena();
    try {
      return arena.own(new this.oc.BRepCheck_Analyzer(this.get(id), true, false, false)).IsValid();
    } finally {
      arena.dispose();
    }
  }

  // ------------------------------------------------------------------ tessellation (A4.1)

  mesh(id: ShapeId, options: { tolerance?: number; angular?: number } = {}): MeshData {
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
        tolerance = Math.min(1, Math.max(0.002, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 5e-4));
      }
      const angular = options.angular ?? 0.25;
      const mem = () => oc.wasmMemory.buffer;
      const md = arena.own(oc.ReplicadMeshExtractor.extract(shape, tolerance, angular, false));
      const positions = new Float32Array(mem(), md.getVerticesPtr(), md.getVerticesSize()).slice();
      const normals = new Float32Array(mem(), md.getNormalsPtr(), md.getNormalsSize()).slice();
      const indices = new Uint32Array(mem(), md.getTrianglesPtr(), md.getTrianglesSize()).slice();
      const fg = new Uint32Array(mem(), md.getFaceGroupsPtr(), md.getFaceGroupsSize()).slice();
      const ed = arena.own(oc.ReplicadEdgeMeshExtractor.extract(shape, tolerance, angular));
      const edgePoints = new Float32Array(mem(), ed.getLinesPtr(), ed.getLinesSize()).slice();
      const eg = new Uint32Array(mem(), ed.getEdgeGroupsPtr(), ed.getEdgeGroupsSize()).slice();
      return {
        positions,
        normals,
        indices,
        faceRanges: this.groups(fg, faces),
        edgePoints,
        edgeRanges: this.groups(eg, edges),
      };
    } finally {
      faces.dispose();
      edges.dispose();
      arena.dispose();
    }
  }

  /** Mesh groups are (start, count, hash) in explorer order; verify by hash, fall back to lookup. */
  private groups(raw: Uint32Array, index: ShapeIndex): Int32Array {
    const out = new Int32Array(raw.length);
    const byHash = new Map<number, number>();
    for (let i = 0; i < index.size; i++) byHash.set(index.hashAt(i), i);
    for (let g = 0; g * 3 < raw.length; g++) {
      const hash = raw[g * 3 + 2]!;
      const i = g < index.size && index.hashAt(g) === hash ? g : (byHash.get(hash) ?? -1);
      out[g * 3] = raw[g * 3]!;
      out[g * 3 + 1] = raw[g * 3 + 1]!;
      out[g * 3 + 2] = i;
    }
    return out;
  }

  // ------------------------------------------------------------------ exchange (F1, F2)

  /**
   * STEP AP214 through XCAF so the product carries the part name (F1.1). `Perform` is used instead of
   * `Transfer` + `Write`: the binding cannot pass a null "multi-file" prefix, and an empty string would
   * split geometry into external files.
   */
  exportStep(id: ShapeId, productName = 'Part'): string {
    const oc = this.oc;
    const arena = new Arena();
    const path = `/export-${++this.fileSeq}.step`;
    const doc = new oc.TDocStd_Document(arena.own(new oc.TCollection_ExtendedString('XmlXCAF', false)));
    try {
      oc.Interface_Static.SetCVal('write.step.unit', 'MM');
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

  importStep(text: string): ShapeId {
    const oc = this.oc;
    const arena = new Arena();
    const path = `/import-${++this.fileSeq}.step`;
    try {
      oc.FS.writeFile(path, text);
      const r = arena.own(new oc.STEPControl_Reader());
      if (r.ReadFile(path) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new KernelError('無法讀取 STEP 檔');
      r.TransferRoots(arena.own(new oc.Message_ProgressRange()));
      if (r.NbShapes() === 0) throw new KernelError('STEP 檔中沒有形狀');
      return this.put(r.OneShape());
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
