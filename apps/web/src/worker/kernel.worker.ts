/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { setLocale as setWorkerLocale, t } from '@3db/i18n';
import occtWasm from 'libcascade/single/wasm?url';
import gcsWasm from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import { bodyKey, combineMass, isShown, mirrorKey, MESH_QUALITY, settingsOf, type AssemblyDoc, type Id, type MeasureReport, type PartDoc, type SourceTree } from '@3db/model';
import { findProfiles, PlaneGcsSolver } from '@3db/sketch';
import { COMPONENT_MESH, Kernel, type MassProps, type MeshData, type MeshOptions, type ShapeId } from '@3db/kernel';
import { measureTargets, convertEdges, edgeMateGeometry, exportFaces, faceColors, intoFrame, faceEdges, faceMateGeometry, followReferences, ReferenceProblem, Regenerator, solveAssemblyTree, type AssemblyResult, type AssemblySolveOptions, type BodyInfo, type RebuildResult } from '@3db/regen';
import { edgeFingerprint, faceFingerprint, vertexFingerprint } from '@3db/naming';
import { binaryStl, exportAssemblyStep, exportPartStep, readComponentFile, stepAssemblyPlan, type StepAssemblyPlan } from '@3db/io';
import { mergeMeshes } from './mergeMesh';
import type { AssemblyStepRequest, ConvertPayload, PartExportOptions, ConvertRequest, KernelApi, PartBuildPayload, PartStage, RebuildPayload, RebuildRequest, SketchSolvePayload, SketchSolveRequest } from './protocol';

let kernel: Kernel;
let solver: PlaneGcsSolver;
let regen: Regenerator;
let ready: Promise<{ occtMs: number; gcsMs: number }> | null = null;
/** The model as the last rebuild saw it (before the sketch being edited, when a sketch is): what its projected edges are looked up in (C1.18). */
let lastModel: { names: NonNullable<RebuildResult['body']>['names']; topology: NonNullable<RebuildResult['body']>['topology']; frames: RebuildResult['frames'] } | null = null;
/** Imported data the document refers to by hash; the regenerator reads each file from here once. */
const blobs = new Map<string, Uint8Array>();
let solverReady: Promise<PlaneGcsSolver> | null = null;
/** What the last rebuild of the open part gave: the shape that measuring reads (E1.1). */
let lastResult: RebuildResult | null = null;

/** A part file of the open assembly, rebuilt once: its own regenerator keeps the model alive. */
interface BuiltPart {
  regen: Regenerator;
  result: RebuildResult;
  problems: string[];
  planes: PartBuildPayload['planes'];
  /** The color of each face of the part's body (C14.2), for the STEP of an assembly that uses it. */
  colors: (string | null)[];
  properties: Record<string, string>;
  density: number | null;
}
/** By content: an unchanged file is never rebuilt again, a changed one is a new entry (B9.4). */
const parts = new Map<string, Promise<BuiltPart>>();

async function build(bytes: Uint8Array): Promise<BuiltPart> {
  await api.init();
  const file = await readComponentFile(bytes, '');
  const regen = new Regenerator(kernel, solver, file.blobs);
  const result = regen.rebuild(file.doc);
  const name = (id: string) => file.doc.features.find((f) => f.id === id)?.name ?? id;
  const failed = result.features.filter((f) => f.status === 'error').map((f) => `${name(f.id)}: ${f.message ?? t('worker.failedShort')}`);
  const planes = file.doc.features.flatMap((f) => {
    const frame = f.type === 'refPlane' ? result.frames.get(f.id) : undefined;
    return frame ? [{ id: f.id, name: f.name, frame }] : [];
  });
  return { regen, result, problems: [...file.warnings, ...failed], planes, colors: faceColors(file.doc, result), properties: { ...file.doc.properties }, density: file.doc.material?.density ?? null };
}

/**
 * What is drawn of the bodies (D4.6): the whole view when every body is shown, else each shown body meshed on its own and put together,
 * so that a hidden body has no triangles to see or pick. Faces and edges keep their numbers in the names either way.
 */
function meshOf(r: RebuildResult, shown: boolean[], quality: MeshOptions = {}): MeshData | null {
  const body = r.body;
  if (!body) return null;
  if (shown.every(Boolean)) return kernel.mesh(body.shape, quality);
  const parts = r.bodies.flatMap((b: BodyInfo, i) => (shown[i] ? [{ mesh: kernel.mesh(b.shape, quality), face0: b.face0, edge0: b.edge0 }] : []));
  return parts.length > 0 ? mergeMeshes(parts) : null;
}

/** Mass of the part: its bodies except the reference ones (C7.1), the centre weighted by volume. */
function massOf(r: RebuildResult): MassProps | null {
  if (!r.body) return null;
  const own = r.bodies.filter((b) => !b.reference).map((b) => kernel.massProps(b.shape));
  if (own.length === r.bodies.length && own.length === 1) return own[0]!;
  // the bodies as one: for a density of one the mass is the volume (see combineMass)
  const whole = combineMass(own.map((m) => ({ mass: m.volume, center: m.center, inertia: m.inertia })));
  return { volume: whole.mass, area: own.reduce((n, m) => n + m.area, 0), center: whole.center, inertia: whole.inertia };
}

/** The bodies of the result that go into a file, and the color of each of their faces: a reference body is a design aid, not part of the part (C7.1). */
function ownBodies(doc: PartDoc, r: RebuildResult) {
  if (!r.body) throw new Error(t('worker.noBodyExport'));
  const own = exportFaces(doc, r);
  if (own.shapes.length === 0) throw new Error(t('body.exportNone'));
  return own;
}

/** The motion that writes the part in the coordinate system chosen (C3.4), or nothing. */
function placing(r: RebuildResult, options: PartExportOptions): { place?: number[] } {
  if (!options.coordSys) return {};
  const system = r.systems.get(options.coordSys);
  if (!system) throw new Error(t('export.coordSysMissing'));
  return { place: intoFrame(system) };
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
    lastResult = r;
    lastModel = body ? { names: body.names, topology: body.topology, frames: r.frames } : null;
    const shown = r.bodies.map((b) => isShown(doc, bodyKey(b.id)));
    const mesh = meshOf(r, shown, MESH_QUALITY[settingsOf(doc).meshQuality]);
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
      faceColors: faceColors(doc, r),
      frames: r.frames,
      axes: r.axes,
      points: r.points,
      systems: r.systems,
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

  async exportStep(doc: PartDoc, name: string, options: PartExportOptions = {}): Promise<string> {
    await api.init();
    const r = regen.rebuild(doc);
    lastResult = r; // the regenerator lets go of what it made before (the shapes measuring reads)
    const { shapes, colors } = ownBodies(doc, r);
    return exportPartStep(kernel, shapes, name, {
      schema: options.schema ?? 'AP214',
      ...(options.colors === false ? {} : { faceColors: colors }),
      ...placing(r, options),
    });
  },

  async exportStl(doc: PartDoc, name: string, options: PartExportOptions = {}): Promise<Uint8Array> {
    await api.init();
    const r = regen.rebuild(doc);
    lastResult = r; // the regenerator lets go of what it made before (the shapes measuring reads)
    const { shapes } = ownBodies(doc, r);
    const joined = shapes.length === 1 ? shapes[0]! : kernel.join(shapes);
    const place = placing(r, options).place;
    const moved = place ? kernel.transformed(joined, place) : joined;
    try {
      const mesh = kernel.mesh(moved, MESH_QUALITY[settingsOf(doc).meshQuality]);
      return binaryStl([mesh], name);
    } finally {
      if (moved !== joined) kernel.release(moved);
      if (joined !== shapes[0]) kernel.release(joined);
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
      properties: part.properties,
      mass: (() => {
        const m = massOf(part.result);
        return m ? { ...m, density: part.density } : null;
      })(),
      ms: performance.now() - t,
    };
    const arrays = mesh ? [mesh.positions, mesh.normals, mesh.indices, mesh.faceRanges, mesh.edgePoints, mesh.edgeRanges] : [];
    return Comlink.transfer(payload, [...arrays, payload.vertexPoints].map((a) => a.buffer as ArrayBuffer));
  },

  async solveAssembly(doc: AssemblyDoc, trees: Record<Id, SourceTree>, options: AssemblySolveOptions = {}): Promise<AssemblyResult> {
    await api.init();
    const built = new Map<string, BuiltPart>();
    const want = (tree: SourceTree): string[] => (tree.kind === 'part' ? [tree.key] : Object.values(tree.children).flatMap(want));
    for (const key of new Set(Object.values(trees).flatMap(want))) {
      const part = await parts.get(key)?.catch(() => null);
      if (part) built.set(key, part);
    }
    return solveAssemblyTree(
      doc,
      trees,
      (key) => {
        const part = built.get(key);
        const body = part?.result.body;
        return body ? { topology: body.topology, names: body.names, frames: part!.result.frames } : null;
      },
      options,
    );
  },

  async exportAssemblyStep({ name, parts: used, subs, instances }: AssemblyStepRequest): Promise<string> {
    await api.init();
    const shapes: { shape: ShapeId; name: string; faceColors: (string | null)[] }[] = [];
    const made: ShapeId[] = [];
    try {
      for (const u of used) {
        // a mirrored part (C15.13): the part's own shape mirrored in its x = 0 plane, as the screen shows it
        const mirrored = u.key.endsWith(mirrorKey(''));
        const part = await parts.get(mirrored ? u.key.slice(0, -mirrorKey('').length) : u.key)?.catch(() => null);
        const body = part?.result.body;
        if (!part || !body) throw new Error(t('worker.noBodyForPart', { name: u.name }));
        const shape = mirrored ? kernel.transformed(body.shape, [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]) : body.shape;
        if (mirrored) made.push(shape);
        shapes.push({ shape, name: u.name, faceColors: part.colors }); // a mirror keeps the order of the faces, so the same colors
      }
      return exportAssemblyStep(kernel, name, shapes, instances, subs);
    } finally {
      for (const id of made) kernel.release(id);
    }
  },

  async buildMirrorPart(partKey: string): Promise<PartBuildPayload | null> {
    await api.init();
    const body = (await parts.get(partKey)?.catch(() => null))?.result.body;
    if (!body) return null;
    const t0 = performance.now();
    // the part's own x → −x: faces, edges and vertices keep their order, so the mesh's face and edge numbers still mean the same names
    const mirrored = kernel.transformed(body.shape, [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    try {
      const mesh = kernel.mesh(mirrored, COMPONENT_MESH);
      const payload: PartBuildPayload = {
        key: mirrorKey(partKey),
        mesh,
        problems: [],
        faceNames: [],
        faceFingerprints: [],
        faceGeometry: [],
        edgeNames: [],
        edgeFingerprints: [],
        edgeGeometry: [],
        vertexNames: [],
        vertexPoints: new Float32Array(0),
        vertexFingerprints: [],
        planes: [],
        properties: {},
        mass: null,
        ms: performance.now() - t0,
      };
      return Comlink.transfer(payload, [mesh.positions, mesh.normals, mesh.indices, mesh.faceRanges, mesh.edgePoints, mesh.edgeRanges].map((a) => a.buffer as ArrayBuffer));
    } finally {
      kernel.release(mirrored);
    }
  },
  async readStepAssembly(bytes: Uint8Array): Promise<StepAssemblyPlan> {
    await api.init();
    return stepAssemblyPlan(kernel, bytes);
  },

  async measure(targets): Promise<MeasureReport> {
    await api.init();
    const shapes = new Map<string, ShapeId | null>();
    for (const key of new Set(targets.flatMap((x) => (x.part === null ? [] : [x.part])))) shapes.set(key, (await parts.get(key)?.catch(() => null))?.result.body?.shape ?? null);
    return measureTargets(kernel, (x) => (x.part === null ? (lastResult?.body?.shape ?? null) : (shapes.get(x.part) ?? null)), targets);
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
