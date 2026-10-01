/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { setLocale as setWorkerLocale, t } from '@3db/i18n';
import occtWasm from 'libcascade/single/wasm?url';
import gcsWasm from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import { bodyKey, isShown, type AssemblyDoc, type Id, type PartDoc } from '@3db/model';
import { findProfiles, PlaneGcsSolver } from '@3db/sketch';
import { COMPONENT_MESH, Kernel, type MassProps, type MeshData, type ShapeId } from '@3db/kernel';
import { convertEdges, edgeMateGeometry, faceEdges, faceMateGeometry, followReferences, ReferenceProblem, Regenerator, solveAssembly, type AssemblyResult, type AssemblySolveOptions, type BodyInfo, type RebuildResult } from '@3db/regen';
import { edgeFingerprint, faceFingerprint, vertexFingerprint } from '@3db/naming';
import { exportAssemblyStep, exportPartStep, readComponentFile } from '@3db/io';
import { mergeMeshes } from './mergeMesh';
import type { AssemblyStepRequest, ConvertPayload, ConvertRequest, KernelApi, PartBuildPayload, PartStage, RebuildPayload, RebuildRequest, SketchSolvePayload, SketchSolveRequest } from './protocol';

let kernel: Kernel;
let solver: PlaneGcsSolver;
let regen: Regenerator;
let ready: Promise<{ occtMs: number; gcsMs: number }> | null = null;
/** The model as the last rebuild saw it (before the sketch being edited, when a sketch is): what its projected edges are looked up in (C1.18). */
let lastModel: { names: NonNullable<RebuildResult['body']>['names']; topology: NonNullable<RebuildResult['body']>['topology']; frames: RebuildResult['frames'] } | null = null;
/** Imported data the document refers to by hash; the regenerator reads each file from here once. */
const blobs = new Map<string, Uint8Array>();
let solverReady: Promise<PlaneGcsSolver> | null = null;

/** A part file of the open assembly, rebuilt once: its own regenerator keeps the model alive. */
interface BuiltPart {
  regen: Regenerator;
  result: RebuildResult;
  problems: string[];
  planes: PartBuildPayload['planes'];
}
/** By content: an unchanged file is never rebuilt again, a changed one is a new entry (B9.4). */
const parts = new Map<string, Promise<BuiltPart>>();

async function build(bytes: Uint8Array): Promise<BuiltPart> {
  await api.init();
  const file = await readComponentFile(bytes, '');
  const regen = new Regenerator(kernel, solver, file.blobs);
  const result = regen.rebuild(file.doc);
  const name = (id: string) => file.doc.features.find((f) => f.id === id)?.name ?? id;
  const failed = result.features.filter((f) => f.status === 'error').map((f) => `${name(f.id)}：${f.message ?? '失敗'}`);
  const planes = file.doc.features.flatMap((f) => {
    const frame = f.type === 'refPlane' ? result.frames.get(f.id) : undefined;
    return frame ? [{ id: f.id, name: f.name, frame }] : [];
  });
  return { regen, result, problems: [...file.warnings, ...failed], planes };
}

/**
 * What is drawn of the bodies (D4.6): the whole view when every body is shown, else each shown body meshed on its own and put together,
 * so that a hidden body has no triangles to see or pick. Faces and edges keep their numbers in the names either way.
 */
function meshOf(r: RebuildResult, shown: boolean[]): MeshData | null {
  const body = r.body;
  if (!body) return null;
  if (shown.every(Boolean)) return kernel.mesh(body.shape);
  const parts = r.bodies.flatMap((b: BodyInfo, i) => (shown[i] ? [{ mesh: kernel.mesh(b.shape), face0: b.face0, edge0: b.edge0 }] : []));
  return parts.length > 0 ? mergeMeshes(parts) : null;
}

/** Mass of the part: its bodies except the reference ones (C7.1), the centre weighted by volume. */
function massOf(r: RebuildResult): MassProps | null {
  if (!r.body) return null;
  const own = r.bodies.filter((b) => !b.reference).map((b) => kernel.massProps(b.shape));
  if (own.length === r.bodies.length && own.length === 1) return own[0]!;
  const volume = own.reduce((n, m) => n + m.volume, 0);
  const centre = (k: number) => (volume > 0 ? own.reduce((n, m) => n + m.center[k]! * m.volume, 0) / volume : 0);
  return { volume, area: own.reduce((n, m) => n + m.area, 0), center: [centre(0), centre(1), centre(2)] };
}

/** The sketch solver loads first and on its own: sketching does not wait for the 43 MB geometry kernel. */
function loadSolver(): Promise<PlaneGcsSolver> {
  solverReady ??= PlaneGcsSolver.create(gcsWasm).then((s) => (solver = s));
  return solverReady;
}

async function boot() {
  let t = performance.now();
  await loadSolver();
  const gcsMs = performance.now() - t;
  t = performance.now();
  kernel = await Kernel.load({ wasmUrl: occtWasm });
  const occtMs = performance.now() - t;
  regen = new Regenerator(kernel, solver, blobs);
  return { occtMs, gcsMs };
}

const api: KernelApi = {
  async setLocale(locale) {
    setWorkerLocale(locale);
  },

  init() {
    ready ??= boot();
    return ready;
  },

  async setBlobs(next) {
    blobs.clear();
    for (const [sha256, data] of next) blobs.set(sha256, data);
  },

  async addBlob(sha256, data) {
    blobs.set(sha256, data);
  },

  async rebuild({ seq, doc, until }: RebuildRequest): Promise<RebuildPayload> {
    await api.init();
    const r = regen.rebuild(doc, until === undefined ? {} : { until });
    const body = r.body;
    lastModel = body ? { names: body.names, topology: body.topology, frames: r.frames } : null;
    const shown = r.bodies.map((b) => isShown(doc, bodyKey(b.id)));
    const mesh = meshOf(r, shown);
    const payload: RebuildPayload = {
      seq,
      features: r.features,
      bodies: r.bodies.map((b, i) => ({ id: b.id, name: b.name, reference: b.reference, shown: shown[i]!, face0: b.face0, faces: b.faces, volume: kernel.massProps(b.shape).volume })),
      mesh,
      faceNames: body?.names.faces ?? [],
      faceFingerprints: body ? body.topology.faces.map((_, i) => faceFingerprint(body.topology, i)) : [],
      edgeNames: body?.names.edges ?? [],
      edgeFingerprints: body ? body.topology.edges.map((_, i) => edgeFingerprint(body.topology, i)) : [],
      vertexNames: body?.names.vertices ?? [],
      vertexPoints: Float32Array.from(body?.topology.vertices.flatMap((v) => v.point) ?? []),
      vertexFingerprints: body ? body.topology.vertices.map((_, i) => vertexFingerprint(body.topology, i)) : [],
      frames: r.frames,
      sketchGeometry: new Map([...r.sketches].map(([id, s]) => [id, s.solved.geometry])),
      mass: massOf(r),
      totalMs: r.totalMs,
    };
    const arrays = mesh ? [mesh.positions, mesh.normals, mesh.indices, mesh.faceRanges, mesh.edgePoints, mesh.edgeRanges] : [];
    const buffers = [...arrays, payload.vertexPoints].map((a) => a.buffer as ArrayBuffer);
    return Comlink.transfer(payload, buffers);
  },

  async solveSketch({ seq, sketch, ...options }: SketchSolveRequest): Promise<SketchSolvePayload> {
    await loadSolver();
    const began = performance.now();
    let followed = sketch;
    if (sketch.entities.some((e) => (e.type === 'point' ? e.pierce : e.ref))) {
      const frame = lastModel?.frames.get(sketch.id);
      try {
        if (!lastModel || !frame) throw new ReferenceProblem(t('reference.noModel'));
        followed = followReferences(sketch, { names: lastModel.names, topology: lastModel.topology, frame });
      } catch (e) {
        if (!(e instanceof ReferenceProblem)) throw e;
        return { seq, geometry: new Map(), status: 'failed', dof: 0, conflicting: [], redundant: [], problems: [], message: e.message, ms: performance.now() - began };
      }
    }
    const r = solver.solve(followed, options);
    const problems = r.status === 'failed' ? [] : findProfiles(followed, r).problems;
    return { seq, ...r, problems, ms: performance.now() - began };
  },

  async convertReferences({ sketchId, edges, faces, mode }: ConvertRequest): Promise<ConvertPayload> {
    const frame = lastModel?.frames.get(sketchId);
    if (!lastModel || !frame) return { items: [], errors: [t('reference.noModel')] };
    const scope = { names: lastModel.names, topology: lastModel.topology, frame };
    try {
      const outline = faces.flatMap((f) => faceEdges(scope, f, (i) => edgeFingerprint(scope.topology, i)));
      return convertEdges(scope, [...edges, ...outline], mode);
    } catch (e) {
      return { items: [], errors: [e instanceof Error ? e.message : String(e)] };
    }
  },

  async exportStep(doc: PartDoc, name: string): Promise<string> {
    await api.init();
    const r = regen.rebuild(doc);
    if (!r.body) throw new Error('沒有可輸出的本體');
    // a reference body is a design aid, not part of the part (C7.1)
    const own = r.bodies.filter((b) => !b.reference);
    if (own.length === 0) throw new Error(t('body.exportNone'));
    if (own.length === r.bodies.length) return exportPartStep(kernel, r.body.shape, name);
    const joined = kernel.join(own.map((b) => b.shape));
    try {
      return exportPartStep(kernel, joined, name);
    } finally {
      kernel.release(joined);
    }
  },

  async buildPart(key: string, bytes: Uint8Array, onStage?: (stage: PartStage) => void): Promise<PartBuildPayload> {
    const t = performance.now();
    // A callback that cannot be reached (the page went away) must not fail the build.
    const stage = (s: PartStage) => void Promise.resolve(onStage?.(s)).catch(() => {});
    let entry = parts.get(key);
    const fresh = !entry;
    if (!entry) {
      stage('building');
      entry = build(bytes);
      parts.set(key, entry);
      entry.catch(() => parts.delete(key)); // a file that cannot be read is tried again next time
    }
    const part = await entry;
    const body = part.result.body;
    if (fresh) stage('meshing');
    const mesh = body ? kernel.mesh(body.shape, COMPONENT_MESH) : null;
    const topo = body?.topology;
    const payload: PartBuildPayload = {
      key,
      mesh,
      problems: part.problems,
      faceNames: body?.names.faces ?? [],
      faceFingerprints: topo ? topo.faces.map((_, i) => faceFingerprint(topo, i)) : [],
      faceGeometry: topo ? topo.faces.map(faceMateGeometry) : [],
      edgeNames: body?.names.edges ?? [],
      edgeFingerprints: topo ? topo.edges.map((_, i) => edgeFingerprint(topo, i)) : [],
      edgeGeometry: topo ? topo.edges.map(edgeMateGeometry) : [],
      vertexNames: body?.names.vertices ?? [],
      vertexPoints: Float32Array.from(topo?.vertices.flatMap((v) => v.point) ?? []),
      vertexFingerprints: topo ? topo.vertices.map((_, i) => vertexFingerprint(topo, i)) : [],
      planes: part.planes,
      ms: performance.now() - t,
    };
    const arrays = mesh ? [mesh.positions, mesh.normals, mesh.indices, mesh.faceRanges, mesh.edgePoints, mesh.edgeRanges] : [];
    return Comlink.transfer(payload, [...arrays, payload.vertexPoints].map((a) => a.buffer as ArrayBuffer));
  },

  async solveAssembly(doc: AssemblyDoc, keys: Record<Id, string>, options: AssemblySolveOptions = {}): Promise<AssemblyResult> {
    await api.init();
    const built = new Map<Id, BuiltPart>();
    for (const [component, key] of Object.entries(keys)) {
      const part = await parts.get(key)?.catch(() => null);
      if (part) built.set(component, part);
    }
    return solveAssembly(
      doc,
      (id) => {
        const body = built.get(id)?.result.body;
        return body ? { topology: body.topology, names: body.names, frames: built.get(id)!.result.frames } : null;
      },
      options,
    );
  },

  async exportAssemblyStep({ name, parts: used, instances }: AssemblyStepRequest): Promise<string> {
    await api.init();
    const shapes: { shape: ShapeId; name: string }[] = [];
    for (const u of used) {
      const body = (await parts.get(u.key)?.catch(() => null))?.result.body;
      if (!body) throw new Error(`零件「${u.name}」沒有可輸出的本體`);
      shapes.push({ shape: body.shape, name: u.name });
    }
    return exportAssemblyStep(kernel, name, shapes, instances);
  },

  async retainParts(keys: string[]): Promise<void> {
    const keep = new Set(keys);
    for (const [key, entry] of parts) {
      if (keep.has(key)) continue;
      parts.delete(key);
      entry.then(
        (p) => p.regen.dispose(),
        () => {},
      );
    }
  },
};

Comlink.expose(api);
