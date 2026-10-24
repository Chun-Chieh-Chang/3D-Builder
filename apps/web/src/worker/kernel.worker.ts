/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { setLocale as setWorkerLocale, t } from '@3db/i18n';
import occtWasm from 'libcascade/single/wasm?url';
import gcsWasm from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import { bodyKey, combineMass, DATUM_PLANES, isDatumPlaneName, isShown, mirrorKey, modelRefOf, type PlaneFrame, MESH_QUALITY, placementRows, settingsOf, type ViewEdgeSet, type AssemblyDoc, type Id, type MeasureReport, type PartDoc, type SourceTree } from '@3db/model';
import { findProfiles, PlaneGcsSolver } from '@3db/sketch';
import { COMPONENT_MESH, Kernel, type ThicknessReport, type UndercutReport, type DraftReport, type GeometryReport, type MassProps, type MeshData, type MeshOptions, type ShapeId } from '@3db/kernel';
import { encodeShade, flatViewLines, rasterizeShade, withoutHiddenEdges, type ShadeImage, type ViewLines } from '@3db/drawing';
import { silhouetteProjector, silhouetteItems, drawingAnchors, holeFeatures, projectDrawingView, elementFacts, viewFeatures, viewEdges, findClearance, findInterference, flatPattern, FlatError, sheetChecks, sweepClearance, measureTargets, convertEdges, intersectFaces, modelSnapItems, edgeMateGeometry, exportFaces, faceColors, intoFrame, faceEdges, faceMateGeometry, followReferences, NO_NAMES, NO_TOPOLOGY, sketchEntityRefs, ReferenceProblem, Regenerator, type ReferenceScope, solveAssemblyTree, type AssemblyResult, type AssemblySolveOptions, type BodyInfo, type FlatReport, type HoleFeatures, type RebuildResult, type SheetCheck, type SheetCheckLimits } from '@3db/regen';
import { edgeFingerprint, faceFingerprint, vertexFingerprint } from '@3db/naming';
import { binaryStl, exportAssemblyStep, exportPartStep, portableShape, readComponentFile, stepAssemblyPlan, type StepAssemblyPlan } from '@3db/io';
import type { SourcePart, SourceProvider } from '@3db/regen';
import { mergeMeshes } from './mergeMesh';
import { heapOf } from './heap';
import { partFeatures } from './partOutline';
import type { AssemblyStepRequest, DrawingElementsResult, DrawingFeaturesResult, DrawingViewRequest, DrawingViewResult, ClearanceResult, CollisionResult, SweepOutcome, ConvertPayload, InterferenceResult, PartExportOptions, ConvertRequest, KernelApi, PartBuildPayload, PartStage, RebuildPayload, RebuildRequest, SketchSolvePayload, SketchSolveRequest, SourceFileData, StepOutput } from './protocol';

let kernel: Kernel;
let solver: PlaneGcsSolver;
let regen: Regenerator;
let ready: Promise<{ occtMs: number; gcsMs: number }> | null = null;
/** The model as the last rebuild saw it (before the sketch being edited, when a sketch is): what its projected edges are looked up in (C1.18). */
/**
 * The model as the last rebuild left it, which an edited sketch follows (C1.18): its names and shapes (empty while there is no body), the frames of the
 * sketches and planes, and the reference axes and points (ADR 0172). The rebuild stops at the edited sketch, so what is here is what is before it.
 */
let lastModel: { names: NonNullable<RebuildResult['body']>['names']; topology: NonNullable<RebuildResult['body']>['topology']; frames: RebuildResult['frames']; axes: RebuildResult['axes']; points: RebuildResult['points']; sketches: RebuildResult['sketches']; hasBody: boolean; shape?: ShapeId } | null = null;

/** Where an edited sketch looks its references up (C1.18, ADR 0172). */
function scopeOf(model: NonNullable<typeof lastModel>, frame: PlaneFrame): ReferenceScope {
  const origin = { 'axis:x': [1, 0, 0], 'axis:y': [0, 1, 0], 'axis:z': [0, 0, 1] } as const;
  return {
    names: model.names,
    topology: model.topology,
    frame,
    ...(model.shape !== undefined ? { silhouettes: silhouetteProjector(kernel,model.shape,model.names,model.topology,frame).branch } : {}),
    // a curved edge's crossings with the plane, from the kernel (ADR 0173): the shape is the last rebuild's, alive until the next one
    ...(model.shape !== undefined ? { curves: { crossings: (i: number) => kernel.edgePlaneCrossings(model.shape!, i, { origin: frame.origin, normal: frame.normal }) } } : {}),
    // the sketches the rebuild made before the edited one (it stops there): what its entities may follow (ADR 0175)
    sketches: (id) => {
      const s = model.sketches.get(id);
      return s && { frame: s.frame, geometry: s.solved.geometry };
    },
    datums: {
      axis: (name) => (name in origin ? { origin: [0, 0, 0], dir: [...origin[name as keyof typeof origin]] } : model.axes.get(name)),
      point: (name) => model.points.get(name),
      plane: (name) => (isDatumPlaneName(name) ? DATUM_PLANES[name] : model.frames.get(name)),
    },
  };
}
/** Imported data the document refers to by hash; the regenerator reads each file from here once. */
const blobs = new Map<string, Uint8Array>();
let solverReady: Promise<PlaneGcsSolver> | null = null;
/** What the last rebuild of the open part gave: the shape that measuring reads (E1.1). */
let lastResult: RebuildResult | null = null;
/** The kernel's Emscripten heap when it was loaded, before any geometry was built: what `HEAP_GROWTH_LIMIT` is measured from. */
let heapBase: number | null = null;

/** A part file of the open assembly, rebuilt once: its own regenerator keeps the model alive. */
interface BuiltPart {
  regen: Regenerator;
  result: RebuildResult;
  problems: string[];
  planes: PartBuildPayload['planes'];
  systems: PartBuildPayload['systems'];
  features: PartBuildPayload['features'];
  /** The color of each face of the part's body (C14.2), for the STEP of an assembly that uses it. */
  colors: (string | null)[];
  properties: Record<string, string>;
  density: number | null;
  /** The hole features of the part (the shape has no thread, and a chamfer is a countersink to it): what a drawing writes of its holes. */
  holes: HoleFeatures;
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
  const provider = await sourcesOf(sources);
  const regen = new Regenerator(kernel, solver, file.blobs, provider);
  await solver.fresh();
  const result = regen.rebuild(file.doc);
  const name = (id: string) => file.doc.features.find((f) => f.id === id)?.name ?? id;
  const failed = result.features.filter((f) => f.status === 'error').map((f) => `${name(f.id)}: ${f.message ?? t('worker.failedShort')}`);
  const planes = file.doc.features.flatMap((f) => {
    const frame = f.type === 'refPlane' ? result.frames.get(f.id) : undefined;
    return frame ? [{ id: f.id, name: f.name, frame }] : [];
  });
  const systems = file.doc.features.flatMap((f) => {
    const system = f.type === 'coordSys' ? result.systems.get(f.id) : undefined;
    return system ? [{ id: f.id, name: f.name, system }] : [];
  });
  return { regen, result, problems: [...file.warnings, ...failed], planes, systems, features: partFeatures(file.doc, result), colors: faceColors(file.doc, result), properties: { ...file.doc.properties }, density: file.doc.material?.density ?? null, holes: holeFeatures(file.doc, provider) };
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
  heapBase = heapOf(kernel.oc); // before any geometry: the size the leak is measured from
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

/** The mesh of each part as built, for the edges of its drawing views (D-I2): made once per part, gone with it. */
const edgeMeshes = new WeakMap<object, MeshData>();

/**
 * The edges and vertices of a drawing view, each by its persistent name, projected (B2.2): the same the view's features request makes, for the parts of
 * this view where they are. Only a view that hides edges asks for it.
 */
async function viewEdgesOf(r: DrawingViewRequest): Promise<ViewEdgeSet> {
  const set: ViewEdgeSet = { edges: [], vertices: [] };
  for (const p of r.parts) {
    const built = await parts.get(p.part)?.catch(() => null);
    const body = built?.result.body;
    if (!built || !body) throw new Error(t('drawing.noBody'));
    // what is drawn of a part is what it is made of: a workpiece kept for reference is left out
    const own = built.result.bodies.filter((b) => !b.reference && !b.surface);
    const only = own.length > 0 && own.length < built.result.bodies.length;
    const allowed = only ? (i: number) => own.some((b) => i >= b.face0 && i < b.face0 + b.faces) : undefined;
    let mesh = edgeMeshes.get(built);
    if (!mesh) {
      mesh = kernel.mesh(body.shape, { tolerance: 0.01, angular: 0.1 });
      edgeMeshes.set(built, mesh);
    }
    const one = viewEdges(kernel, body.shape, body.topology, body.names, r.axes, allowed, mesh, p.leaf ? { rows: placementRows(p.pose, p.mirrored), in: p.leaf } : undefined);
    set.edges.push(...one.edges);
    set.vertices.push(...one.vertices);
  }
  return set;
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
    await solver.fresh(); // the same numbers for the same document every time: see PlaneGcsSolver.fresh
    const r = regen.rebuild(doc, until === undefined ? {} : { until });
    const body = r.body;
    lastResult = r;
    lastModel = { names: body?.names ?? NO_NAMES, topology: body?.topology ?? NO_TOPOLOGY, frames: r.frames, axes: r.axes, points: r.points, sketches: r.sketches, hasBody: !!body, ...(body ? { shape: body.shape } : {}) };
    const shown = r.bodies.map((b) => isShown(doc, bodyKey(b.id)));
    const mesh = meshOf(r, shown, MESH_QUALITY[settingsOf(doc).meshQuality]);
    const payload: RebuildPayload = {
      seq,
      features: r.features,
      bodies: r.bodies.map((b, i) => ({ id: b.id, name: b.name, reference: b.reference, surface: b.surface, ...(b.curve ? { curve: true } : {}), shown: shown[i]!, face0: b.face0, faces: b.faces, volume: kernel.massProps(b.shape).volume })),
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
      cosmeticThreads: r.cosmeticThreads,
      mass: massOf(r),
      totalMs: r.totalMs,
      heapBytes: heapOf(kernel.oc),
      heapBase,
    };
    const arrays = mesh ? [mesh.positions, mesh.normals, mesh.indices, mesh.faceRanges, mesh.edgePoints, mesh.edgeRanges] : [];
    const buffers = [...arrays, payload.vertexPoints].map((a) => a.buffer as ArrayBuffer);
    return Comlink.transfer(payload, buffers);
  },

  async solveSketch({ seq, sketch, ...options }: SketchSolveRequest): Promise<SketchSolvePayload> {
    await loadSolver();
    const began = performance.now();
    let followed = sketch;
    if (sketch.entities.some((e) => modelRefOf(e))) {
      const frame = lastModel?.frames.get(sketch.id);
      try {
        // reference geometry needs no model (ADR 0172); an edge or a vertex does
        if (!lastModel || !frame || (!lastModel.hasBody && sketch.entities.some((e) => !['datum', 'sketch'].includes(modelRefOf(e)?.kind ?? 'datum')))) throw new ReferenceProblem(t('reference.noModel'));
        followed = followReferences(sketch, scopeOf(lastModel, frame));
      } catch (e) {
        if (!(e instanceof ReferenceProblem)) throw e;
        return { seq, geometry: new Map(), status: 'failed', dof: 0, conflicting: [], redundant: [], problems: [], message: e.message, ms: performance.now() - began };
      }
    }
    const r = solver.solve(followed, options);
    const problems = r.status === 'failed' ? [] : findProfiles(followed, r).problems;
    return { seq, ...r, problems, ms: performance.now() - began };
  },

  async convertReferences({ sketchId, edges, faces, mode, sketch }: ConvertRequest): Promise<ConvertPayload> {
    const frame = lastModel?.frames.get(sketchId);
    if (!lastModel || !frame) return { items: [], errors: [t('reference.noModel')] };
    const scope = scopeOf(lastModel, frame);
    try {
      if (mode === 'silhouette') {
        if(lastModel.shape===undefined)throw new Error(t('reference.noModel'));
        return {items:silhouetteItems(silhouetteProjector(kernel,lastModel.shape,lastModel.names,lastModel.topology,frame),faces),errors:[]};
      }
      if (mode === 'intersect') {
        const items = intersectFaces(scope, faces);
        return { items, errors: [] };
      }
      const outline = faces.flatMap((f) => faceEdges(scope, f, (i) => edgeFingerprint(scope.topology, i)));
      // a whole earlier sketch picked (ADR 0175): its curves and its free points
      const other = sketch ? lastModel.sketches.get(sketch)?.sketch : undefined;
      if (sketch && !other) return { items: [], errors: [t('reference.sketchMissing', { name: sketch })] };
      return convertEdges(scope, [...edges, ...outline, ...(other ? sketchEntityRefs(other) : [])], mode);
    } catch (e) {
      return { items: [], errors: [e instanceof Error ? e.message : String(e)] };
    }
  },

  async sketchSnapItems(sketchId, shown = []) {
    const frame = lastModel?.frames.get(sketchId);
    if (!lastModel || !frame) return [];
    const scope = scopeOf(lastModel, frame);
    const model = lastModel;
    const sketches = shown.flatMap((id) => (model.sketches.get(id)?.sketch ? [model.sketches.get(id)!.sketch] : []));
    return modelSnapItems(scope, (i) => edgeFingerprint(scope.topology, i), sketches);
  },

  async exportStep(doc: PartDoc, name: string, options: PartExportOptions = {}): Promise<StepOutput> {
    await api.init();
    await solver.fresh(); // the same numbers for the same document: see PlaneGcsSolver.fresh
    const r = regen.rebuild(doc);
    lastResult = r; // the regenerator lets go of what it made before (the shapes measuring reads)
    const { shapes, colors } = ownBodies(doc, r);
    const warnings: string[] = [];
    const text = exportPartStep(kernel, shapes, name, {
      schema: options.schema ?? 'AP214',
      ...(options.colors === false ? {} : { faceColors: colors }),
      ...placing(r, options),
      warnings,
    });
    return { text, warnings };
  },

  async exportStl(doc: PartDoc, name: string, options: PartExportOptions = {}): Promise<Uint8Array> {
    await api.init();
    await solver.fresh();
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
      edgeFaces: topo ? topo.edges.map(edge=>edge.faces) : [],
      vertexNames: body?.names.vertices ?? [],
      vertexPoints: Float32Array.from(topo?.vertices.flatMap((v) => v.point) ?? []),
      vertexFingerprints: topo ? topo.vertices.map((_, i) => vertexFingerprint(topo, i)) : [],
      planes: part.planes,
      systems: part.systems,
      features: part.features,
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

  async exportAssemblyStep({ name, parts: used, subs, instances }: AssemblyStepRequest): Promise<StepOutput> {
    await api.init();
    const shapes: { shape: ShapeId; name: string; faceColors: (string | null)[] }[] = [];
    const made: ShapeId[] = [];
    let stuck = 0;
    try {
      for (const u of used) {
        // a mirrored part (C15.13): the part's own shape mirrored in its x = 0 plane, as the screen shows it
        const mirrored = u.key.endsWith(mirrorKey(''));
        const part = await parts.get(mirrored ? u.key.slice(0, -mirrorKey('').length) : u.key)?.catch(() => null);
        const body = part?.result.body;
        if (!part || !body) throw new Error(t('worker.noBodyForPart', { name: u.name }));
        const placed = mirrored ? kernel.transformed(body.shape, [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]) : body.shape;
        if (mirrored) made.push(placed);
        const fit = portableShape(kernel, placed);
        if (fit.converted) made.push(fit.shape);
        if (fit.failed) stuck++;
        shapes.push({ shape: fit.shape, name: u.name, faceColors: part.colors }); // a mirror keeps the order of the faces, so the same colors
      }
      const text = exportAssemblyStep(kernel, name, shapes, instances, subs);
      return { text, warnings: stuck > 0 ? [t('export.offsetKept', { n: String(stuck) })] : [] };
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
        systems: original.systems,
        features: [],
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
        if (r.flat) {
          // the unfolded sheet metal part (S-1): worked out from the bend data of the part as built, not projected
          const built = await parts.get(r.parts[0]!.part)?.catch(() => null);
          if (!built) throw new Error(t('drawing.noBody'));
          if (!built.result.sheet) throw new Error(t('flat.noSheet'));
          const pattern = flatPattern(kernel, built.result.sheet);
          try {
            out.push({ lines: flatViewLines(pattern), ms: performance.now() - began });
          } finally {
            kernel.release(pattern.shape);
          }
          continue;
        }
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
        const { mesh, ...lines } = projectDrawingView(kernel, viewParts, r.axes, r.cut, !!r.shade);
        // the edges this view hides are not drawn (B2.2): their lines are taken out of what the view shows, by the view's own lines (withoutHiddenEdges)
        const drawn = r.hiddenEdges?.length ? withoutHiddenEdges(lines as ViewLines, await viewEdgesOf(r), r.hiddenEdges) : lines;
        // the faces drawn into an image (ADR 0146): a view whose shading fails keeps its lines, and says why it has no shading
        let shade: ShadeImage | { error: string } | undefined;
        if (r.shade) {
          try {
            const raster = mesh ? rasterizeShade(mesh, r.shade.px) : null;
            shade = raster ? await encodeShade(raster) : { error: t('drawing.noBody') };
          } catch (e) {
            shade = { error: e instanceof Error ? e.message : String(e) };
          }
        }
        out.push({ lines: drawn, ...(r.anchors ? { anchors: drawingAnchors(kernel, viewParts, r.axes) } : {}), ...(shade ? { shade } : {}), ms: performance.now() - began });
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
        const allowed = only ? (i: number) => own.some((b) => i >= b.face0 && i < b.face0 + b.faces) : undefined;
        // the edges and vertices by name (D-I2): the part's mesh is made once and kept with the part as built, for every view of it
        let mesh = edgeMeshes.get(built);
        if (!mesh) {
          mesh = kernel.mesh(body.shape, { tolerance: 0.01, angular: 0.1 });
          edgeMeshes.set(built, mesh);
        }
        out.push({ features: viewFeatures(body.topology, body.names, r.axes, allowed, built.holes, built.result.cosmeticThreads), edges: viewEdges(kernel, body.shape, body.topology, body.names, r.axes, allowed, mesh) });
      } catch (e) {
        out.push({ error: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  },

  async drawingAssemblyEdges(requests) {
    await api.init();
    const out: ({ edges: ViewEdgeSet } | { error: string })[] = [];
    for (const r of requests) {
      try {
        const edges: ViewEdgeSet = { edges: [], vertices: [] };
        for (const p of r.parts) {
          const built = await parts.get(p.part)?.catch(() => null);
          const body = built?.result.body;
          if (!built || !body) throw new Error(t('drawing.noBody'));
          // the reference bodies of a part (a workpiece) are not drawn, nor offered (as in its lines)
          const own = built.result.bodies.filter((b) => !b.reference && !b.surface);
          const only = own.length > 0 && own.length < built.result.bodies.length;
          const allowed = only ? (i: number) => own.some((b) => i >= b.face0 && i < b.face0 + b.faces) : undefined;
          let mesh = edgeMeshes.get(built);
          if (!mesh) {
            mesh = kernel.mesh(body.shape, { tolerance: 0.01, angular: 0.1 });
            edgeMeshes.set(built, mesh);
          }
          const one = viewEdges(kernel, body.shape, body.topology, body.names, r.axes, allowed, mesh, { rows: placementRows(p.pose, p.mirrored), in: p.leaf });
          edges.edges.push(...one.edges);
          edges.vertices.push(...one.vertices);
        }
        out.push({ edges });
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
        out.push({ elements: r.refs.map((ref) => elementFacts(body.topology, body.names, ref, built.holes, built.result.cosmeticThreads)) });
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
      const overlaps = found.overlaps.map((o) => ({ a: o.a, b: o.b, volume: o.volume, center: o.center, min: o.min, max: o.max, regions: o.regions, mesh: kernel.mesh(o.shape, COMPONENT_MESH) }));
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

  async analyzeDraft(pull, required): Promise<DraftReport> {
    await api.init();
    const shape = lastResult?.body?.shape;
    if (!shape) throw new Error(t('worker.noBodyExport'));
    return kernel.draftAnalysis(shape, pull, required);
  },

  async analyzeUndercut(pull): Promise<UndercutReport> {
    await api.init();
    const shape = lastResult?.body?.shape;
    if (!shape) throw new Error(t('worker.noBodyExport'));
    return kernel.undercutAnalysis(shape, pull);
  },

  async analyzeThickness(limits): Promise<ThicknessReport> {
    await api.init();
    const shape = lastResult?.body?.shape;
    if (!shape) throw new Error(t('worker.noBodyExport'));
    return kernel.thicknessAnalysis(shape, limits);
  },

  async flatPattern(limits: SheetCheckLimits): Promise<{ report: FlatReport | null; mesh: MeshData | null; error: string | null; checks: SheetCheck[] }> {
    await api.init();
    const sheet = lastResult?.sheet;
    if (!sheet) throw new FlatError(t('flat.noSheet'));
    let pattern: ReturnType<typeof flatPattern> | null = null;
    let error: string | null = null;
    try {
      pattern = flatPattern(kernel, sheet);
    } catch (e) {
      if (!(e instanceof FlatError)) throw e;
      error = e.message;
    }
    try {
      const checks = sheetChecks(kernel, sheet, limits, pattern);
      if (!pattern) return { report: null, mesh: null, error, checks };
      const { shape, ...report } = pattern;
      // the pattern as a solid, to be shown flat in the 3D view (ADR 0115)
      const mesh = kernel.mesh(shape);
      return Comlink.transfer({ report, mesh, error: null, checks }, [mesh.positions, mesh.normals, mesh.indices, mesh.faceRanges, mesh.edgePoints, mesh.edgeRanges].map((a) => a.buffer as ArrayBuffer));
    } finally {
      if (pattern) kernel.release(pattern.shape);
    }
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
