/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { setLocale as setWorkerLocale, t } from '@3db/i18n';
import occtWasm from 'libcascade/single/wasm?url';
import gcsWasm from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import { bodyKey, combineMass, isShown, mirrorKey, MESH_QUALITY, settingsOf, type AssemblyDoc, type Id, type MeasureReport, type PartDoc, type SourceTree } from '@3db/model';
import { findProfiles, PlaneGcsSolver } from '@3db/sketch';
import { COMPONENT_MESH, Kernel, type GeometryReport, type MassProps, type MeshData, type MeshOptions, type ShapeId } from '@3db/kernel';
import { drawingAnchors, projectDrawingView, elementFacts, viewFeatures, findClearance, findInterference, sweepClearance, measureTargets, convertEdges, edgeMateGeometry, exportFaces, faceColors, intoFrame, faceEdges, faceMateGeometry, followReferences, ReferenceProblem, Regenerator, solveAssemblyTree, type AssemblyResult, type AssemblySolveOptions, type BodyInfo, type RebuildResult } from '@3db/regen';
import { edgeFingerprint, faceFingerprint, vertexFingerprint } from '@3db/naming';
import { binaryStl, exportAssemblyStep, exportPartStep, readComponentFile, stepAssemblyPlan, type StepAssemblyPlan } from '@3db/io';
import type { SourcePart, SourceProvider } from '@3db/regen';
import { mergeMeshes } from './mergeMesh';
import type { AssemblyStepRequest, DrawingElementsResult, DrawingFeaturesResult, DrawingViewResult, ClearanceResult, CollisionResult, SweepOutcome, ConvertPayload, InterferenceResult, PartExportOptions, ConvertRequest, KernelApi, PartBuildPayload, PartStage, RebuildPayload, RebuildRequest, SketchSolvePayload, SketchSolveRequest, SourceFileData } from './protocol';

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

/** The master files of derived bodies (C7.5) read into documents, so that the regenerator can ask for them one after another without waiting. */
async function sourcesOf(data: SourceFileData[] | undefined): Promise<SourceProvider | undefined> {
  if (!data || data.length === 0) return undefined;
  const read = new Map<string, SourcePart>();
  for (const d of data) {
    const file = await readComponentFile(d.bytes, '');
    const sources = await sourcesOf(d.sources);
    read.set(d.ref, { key: d.path, doc: file.doc, blobs: file.blobs, ...(sources ? { sources } : {}) });
  }
  return { get: (ref) => read.get(ref) };
}

async function build(bytes: Uint8Array, sources?: SourceFileData[]): Promise<BuiltPart> {
  await api.init();
  const file = await readComponentFile(bytes, '');
  const regen = new Regenerator(kernel, solver, file.blobs, await sourcesOf(sources));
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

/** Mass of the part: its bodies except the reference ones (C7.1) and the surface bodies (4b), the centre weighted by volume. */
function massOf(r: RebuildResult): MassProps | null {
  if (!r.body) return null;
  const own = r.bodies.filter((b) => !b.reference && !b.surface).map((b) => kernel.massProps(b.shape));
  if (own.length === 0) return null;
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

/**
 * The shapes of the parts the components use, by their keys, as built for the assembly (null: not built). The surface bodies of a part (4b) are not the part: a
 * part that has some is given without them (joined, when several are left: the joined shape is added to `temp`, for the caller to release).
 */
async function shapesOf(components: readonly { parts: readonly { part: string }[] }[], temp: ShapeId[]): Promise<Map<string, ShapeId | null>> {
  const shapes = new Map<string, ShapeId | null>();
  for (const key of new Set(components.flatMap((c) => c.parts.map((p) => p.part)))) {
    const built = await parts.get(key)?.catch(() => null);
    const body = built?.result.body;
    if (!built || !body) {
      shapes.set(key, null);
      continue;
    }
    const own = built.result.bodies.filter((b) => !b.surface);
    if (own.length === built.result.bodies.length) shapes.set(key, body.shape);
    else if (own.length === 0) shapes.set(key, null);
    else if (own.length === 1) shapes.set(key, own[0]!.shape);
    else {
      const joined = kernel.join(own.map((b) => b.shape));
      temp.push(joined);
      shapes.set(key, joined);
    }
  }
  return shapes;
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

  async rebuild({ seq, doc, until, sources }: RebuildRequest): Promise<RebuildPayload> {
    await api.init();
    regen.useSources(await sourcesOf(sources));
    const r = regen.rebuild(doc, until === undefined ? {} : { until });
    const body = r.body;
    lastResult = r;
    lastModel = body ? { names: body.names, topology: body.topology, frames: r.frames } : null;
    const shown = r.bodies.map((b) => isShown(doc, bodyKey(b.id)));
    const mesh = meshOf(r, shown, MESH_QUALITY[settingsOf(doc).meshQuality]);
    const payload: RebuildPayload = {
      seq,
      features: r.features,
      bodies: r.bodies.map((b, i) => ({ id: b.id, name: b.name, reference: b.reference, surface: b.surface, shown: shown[i]!, face0: b.face0, faces: b.faces, volume: kernel.massProps(b.shape).volume })),
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

  async buildPart(key: string, bytes: Uint8Array, onStage?: (stage: PartStage) => void, sources?: SourceFileData[]): Promise<PartBuildPayload> {
    const t = performance.now();
    // A callback that cannot be reached (the page went away) must not fail the build.
    const stage = (s: PartStage) => void Promise.resolve(onStage?.(s)).catch(() => {});
    let entry = parts.get(key);
    const fresh = !entry;
    if (!entry) {
      stage('building');
      entry = build(bytes, sources);
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
      referenceOnly: part.result.bodies.length > 0 && part.result.bodies.every((b) => b.reference || b.surface),
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
    const original = await parts.get(partKey)?.catch(() => null);
    const body = original?.result.body;
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
        referenceOnly: original!.result.bodies.every((b) => b.reference || b.surface),
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

  async drawingViews(requests): Promise<DrawingViewResult[]> {
    await api.init();
    const out: DrawingViewResult[] = [];
    for (const r of requests) {
      const began = performance.now();
      const made: ShapeId[] = [];
      try {
        const viewParts = [];
        for (const p of r.parts) {
          const built = await parts.get(p.part)?.catch(() => null);
          const body = built?.result.body;
          if (!built || !body) throw new Error(t('drawing.noBody'));
          // what is drawn of a part is what it is made of: the reference bodies (a workpiece) are left out, unless they are all there is
          const own = built.result.bodies.filter((b) => !b.reference && !b.surface);
          let shape = body.shape;
          if (own.length > 0 && own.length < built.result.bodies.length) {
            shape = own.length === 1 ? own[0]!.shape : kernel.join(own.map((b) => b.shape));
            if (own.length > 1) made.push(shape);
          }
          viewParts.push({ shape, pose: p.pose, mirrored: p.mirrored });
        }
        const lines = projectDrawingView(kernel, viewParts, r.axes, r.cut);
        out.push({ lines, ...(r.anchors ? { anchors: drawingAnchors(kernel, viewParts, r.axes) } : {}), ms: performance.now() - began });
      } catch (e) {
        out.push({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        for (const id of made) kernel.release(id);
      }
    }
    return out;
  },

  async drawingFeatures(requests): Promise<DrawingFeaturesResult[]> {
    await api.init();
    const out: DrawingFeaturesResult[] = [];
    for (const r of requests) {
      try {
        const built = await parts.get(r.part)?.catch(() => null);
        const body = built?.result.body;
        if (!built || !body) throw new Error(t('drawing.noBody'));
        // the faces of a workpiece that is only there for reference are not the part's (as in the lines of its views)
        const own = built.result.bodies.filter((b) => !b.reference && !b.surface);
        const only = own.length > 0 && own.length < built.result.bodies.length;
        out.push({ features: viewFeatures(body.topology, body.names, r.axes, only ? (i) => own.some((b) => i >= b.face0 && i < b.face0 + b.faces) : undefined) });
      } catch (e) {
        out.push({ error: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  },

  async drawingElements(requests): Promise<DrawingElementsResult[]> {
    await api.init();
    const out: DrawingElementsResult[] = [];
    for (const r of requests) {
      try {
        const built = await parts.get(r.part)?.catch(() => null);
        const body = built?.result.body;
        if (!built || !body) throw new Error(t('drawing.noBody'));
        out.push({ elements: r.refs.map((ref) => elementFacts(body.topology, body.names, ref)) });
      } catch (e) {
        out.push({ error: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  },

  async clearance(components, least, only): Promise<ClearanceResult> {
    await api.init();
    const began = performance.now();
    const temp: ShapeId[] = [];
    try {
      const shapes = await shapesOf(components, temp);
      const found = findClearance(kernel, components, (key) => shapes.get(key) ?? null, least, only ? new Set(only) : undefined);
      return { ...found, ms: performance.now() - began };
    } finally {
      for (const s of temp) kernel.release(s);
    }
  },

  async sweep(components, mover, dir, length): Promise<SweepOutcome> {
    await api.init();
    const began = performance.now();
    const temp: ShapeId[] = [];
    try {
      const shapes = await shapesOf(components, temp);
      return { ...sweepClearance(kernel, components, mover, dir, length, (key) => shapes.get(key) ?? null), ms: performance.now() - began };
    } finally {
      for (const s of temp) kernel.release(s);
    }
  },

  async collisions(components, movers): Promise<CollisionResult> {
    await api.init();
    const began = performance.now();
    const temp: ShapeId[] = [];
    try {
      const shapes = await shapesOf(components, temp);
      const found = findInterference(kernel, components, (key) => shapes.get(key) ?? null, undefined, new Set(movers));
      for (const o of found.overlaps) kernel.release(o.shape);
      return { pairs: [...new Set(found.overlaps.map((o) => `${o.a}|${o.b}`))].map((k) => ({ a: k.split('|')[0]!, b: k.split('|')[1]! })), ms: performance.now() - began };
    } finally {
      for (const s of temp) kernel.release(s);
    }
  },

  async interference(components): Promise<InterferenceResult> {
    await api.init();
    const began = performance.now();
    const temp: ShapeId[] = [];
    const shapes = await shapesOf(components, temp);
    const found = findInterference(kernel, components, (key) => shapes.get(key) ?? null);
    try {
      const overlaps = found.overlaps.map((o) => ({ a: o.a, b: o.b, volume: o.volume, mesh: kernel.mesh(o.shape, COMPONENT_MESH) }));
      const result: InterferenceResult = { overlaps, checked: found.checked, unknown: found.unknown, failed: found.failed, ms: performance.now() - began };
      return Comlink.transfer(result, overlaps.flatMap((o) => [o.mesh.positions, o.mesh.normals, o.mesh.indices, o.mesh.faceRanges, o.mesh.edgePoints, o.mesh.edgeRanges].map((a) => a.buffer as ArrayBuffer)));
    } finally {
      for (const o of found.overlaps) kernel.release(o.shape);
      for (const s of temp) kernel.release(s);
    }
  },

  async checkGeometry(keys): Promise<(GeometryReport | null)[]> {
    await api.init();
    const out: (GeometryReport | null)[] = [];
    for (const key of keys) {
      const shape = key === null ? lastResult?.body?.shape : (await parts.get(key)?.catch(() => null))?.result.body?.shape;
      out.push(shape === undefined ? null : kernel.check(shape));
    }
    return out;
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
