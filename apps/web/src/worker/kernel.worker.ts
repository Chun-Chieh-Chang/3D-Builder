/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { setLocale as setWorkerLocale } from '@3db/i18n';
import occtWasm from 'libcascade/single/wasm?url';
import gcsWasm from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import type { AssemblyDoc, Id, PartDoc } from '@3db/model';
import { findProfiles, PlaneGcsSolver } from '@3db/sketch';
import { COMPONENT_MESH, Kernel, type ShapeId } from '@3db/kernel';
import { edgeMateGeometry, faceMateGeometry, Regenerator, solveAssembly, type AssemblyResult, type AssemblySolveOptions, type RebuildResult } from '@3db/regen';
import { edgeFingerprint, faceFingerprint, vertexFingerprint } from '@3db/naming';
import { exportAssemblyStep, exportPartStep, readComponentFile } from '@3db/io';
import type { AssemblyStepRequest, KernelApi, PartBuildPayload, PartStage, RebuildPayload, RebuildRequest, SketchSolvePayload, SketchSolveRequest } from './protocol';

let kernel: Kernel;
let solver: PlaneGcsSolver;
let regen: Regenerator;
let ready: Promise<{ occtMs: number; gcsMs: number }> | null = null;
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
    const mesh = body ? kernel.mesh(body.shape) : null;
    const payload: RebuildPayload = {
      seq,
      features: r.features,
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
      mass: body ? kernel.massProps(body.shape) : null,
      totalMs: r.totalMs,
    };
    const arrays = mesh ? [mesh.positions, mesh.normals, mesh.indices, mesh.faceRanges, mesh.edgePoints, mesh.edgeRanges] : [];
    const buffers = [...arrays, payload.vertexPoints].map((a) => a.buffer as ArrayBuffer);
    return Comlink.transfer(payload, buffers);
  },

  async solveSketch({ seq, sketch, ...options }: SketchSolveRequest): Promise<SketchSolvePayload> {
    await loadSolver();
    const t = performance.now();
    const r = solver.solve(sketch, options);
    const problems = r.status === 'failed' ? [] : findProfiles(sketch, r).problems;
    return { seq, ...r, problems, ms: performance.now() - t };
  },

  async exportStep(doc: PartDoc, name: string): Promise<string> {
    await api.init();
    const r = regen.rebuild(doc);
    if (!r.body) throw new Error('沒有可輸出的本體');
    return exportPartStep(kernel, r.body.shape, name);
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
