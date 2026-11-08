/**
 * One part, open for an AI agent (ADR 0237). The agent changes the part only with the commands of `@3db/model` (`Command`), the same commands the app
 * sends: there is no way to run code. A batch of commands is one transaction: every command must apply, and the rebuild must not break a feature that
 * was not broken before; otherwise nothing is kept. Every answer gives the real figures of the part as built (status of each feature, volume, area,
 * box), so the agent checks its work on the geometry and not on a picture alone.
 */
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { setLocale, type Locale } from '@3db/i18n';
import { applyCommand, createEmptyPart, parsePart, type Command, type PartDoc, type Ref } from '@3db/model';
import { Kernel, isTrap, type MassProps, type ShapeId } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { BudgetError, exportFaces, reconstructImported, RecognizeError, Regenerator, type FeatureResult, type RebuildResult, type ReconstructReport } from '@3db/regen';
import { edgeFingerprint, faceFingerprint } from '@3db/naming';
import { exportPartStep, readPartFile, writePartFile, writeStl, writeThreeMf } from '@3db/io';
import { heapOf, shouldRestartHeap, HEAP_GROWTH_LIMIT } from '../../web/src/worker/heap';
import { isCommandType } from './commandTypes';

/** A refusal the agent can act on: what was wrong, said plainly. The part is not changed. */
export class AgentError extends Error {
  override readonly name = 'AgentError';
}

export interface SessionOptions {
  /** The only folder whose files the agent may read or write. */
  root: string;
  locale?: Locale;
  /** How much the kernel heap may grow before the kernel is loaded again (ADR 0126); a parameter so that a test can reach it. */
  heapLimit?: number;
}

export interface FeatureRow {
  id: string;
  type: string;
  name: string;
  status: FeatureResult['status'];
  message?: string;
  warnings?: string[];
  /** A sketch: how it is defined (`fully`, `under`, `over`, …) and its degrees of freedom. */
  sketch?: { status: string; dof: number; problems: string[] };
}

export interface BodyRow {
  id: string;
  name: string;
  kind: 'solid' | 'surface' | 'curve';
  reference: boolean;
  faces: number;
  volume: number;
  area: number;
}

export interface PartSummary {
  path: string | null;
  features: FeatureRow[];
  bodies: BodyRow[];
  /** The bodies that make the part (no reference and no surface bodies), as one; null when there is none. */
  mass: { volume: number; area: number; center: [number, number, number] } | null;
  /** The box round all bodies (from a mesh, within 0.01 mm); null when there is no body. */
  box: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] } | null;
  rebuildMs: number;
}

export interface ApplyReport {
  /** True when the batch is kept. */
  committed: boolean;
  dryRun: boolean;
  /** Why the batch was refused, with the index of the command when one command was the cause. */
  error?: { message: string; command?: number };
  /** Features that the batch made fail (new features, or features that were ok before). */
  broken: FeatureRow[];
  /** The part as the batch would leave it (also when refused or a dry run: what the agent would get). */
  after: PartSummary;
  /** Volume after minus volume before, of the part's own bodies. */
  volumeChange: number;
}

export interface ElementQuery {
  kind: 'face' | 'edge' | 'vertex';
  /** Only faces of this surface type (`plane`, `cylinder`, …) or edges of this curve type (`line`, `circle`, …). */
  type?: string;
  /** Only planar faces whose outward normal is within 1° of this direction, or straight edges parallel to it. */
  direction?: [number, number, number];
  /** Only elements of this body. */
  body?: string;
  limit?: number;
}

export interface ElementRow {
  /** The reference to give a command (`setEdges`, `setShell`, a sketch plane, …), as is. */
  ref: Ref;
  body: string;
  type?: string;
  area?: number;
  length?: number;
  center?: number[];
  normal?: number[] | null;
  dir?: number[] | null;
  radius?: number;
  /** An edge with the same face on both sides (a cylinder's seam): not a corner between two faces. */
  seam?: boolean;
}

/** One rebuild of the part, as the agent is told of it (ADR 0237): what caused it, whether it was kept, and how it ended. */
export interface RebuildEvent {
  seq: number;
  at: string;
  /** `sync`: the open app sent its part (ADR 0238). */
  cause: 'new' | 'open' | 'apply' | 'undo' | 'sync';
  committed: boolean;
  dryRun?: boolean;
  features: number;
  failed: string[];
  volume: number | null;
  ms: number;
}

export type ExportFormat = 'step' | 'stl' | '3mf';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['step', 'stl', '3mf'];

const MAX_COMMANDS = 200;
const MAX_EVENTS = 50;
const ANGLE_1_DEG = Math.cos((1 * Math.PI) / 180);

export class CadSession {
  private kernel!: Kernel;
  private solver!: PlaneGcsSolver;
  private regen!: Regenerator;
  private heapBase: number | null = null;
  /** How many times the kernel was loaded again because its heap grew (ADR 0126). */
  restarts = 0;
  private readonly blobs = new Map<string, Uint8Array>();
  doc: PartDoc = createEmptyPart();
  path: string | null = null;
  private result!: RebuildResult;
  private readonly undoStack: PartDoc[] = [];
  private readonly root: string;
  private readonly heapLimit: number;
  /** The last rebuilds, newest last. */
  readonly events: RebuildEvent[] = [];
  private eventSeq = 0;
  /** Told of every rebuild event (the server sends it to the agent as a notification). */
  onEvent: ((e: RebuildEvent) => void) | null = null;

  private constructor(options: SessionOptions) {
    this.root = resolve(options.root);
    this.heapLimit = options.heapLimit ?? HEAP_GROWTH_LIMIT;
    setLocale(options.locale ?? 'zh-TW');
  }

  static async create(options: SessionOptions): Promise<CadSession> {
    const s = new CadSession(options);
    s.solver = await PlaneGcsSolver.create();
    await s.loadKernel();
    await s.rebuild(s.doc);
    return s;
  }

  private async loadKernel(): Promise<void> {
    this.kernel = await Kernel.load();
    this.heapBase = heapOf(this.kernel.oc);
    this.regen = new Regenerator(this.kernel, this.solver, this.blobs);
  }

  /** The kernel heap now (the only true measure, AGENTS.md §3.1), or null when it cannot be read. */
  heapBytes(): number | null {
    return heapOf(this.kernel.oc);
  }

  /** Shapes the kernel holds for this session: what the session must give back (not the OCCT heap, see AGENTS.md §3.5). */
  liveShapes(): number {
    return this.kernel.liveShapes;
  }

  dispose(): void {
    this.regen.dispose();
  }

  /** Builds `doc` and keeps the result. The heap of OCCT only grows (AGENTS.md §3.5): past the limit, a new kernel takes the work (ADR 0126). */
  private async rebuild(doc: PartDoc): Promise<RebuildResult> {
    // past the limit, or once the module has trapped, even if that was taken as a refusal (ADR 0242)
    if (shouldRestartHeap(this.heapBytes(), this.heapBase, this.heapLimit) || this.kernel.trapsAbsorbed > 0) {
      this.regen.dispose();
      await this.loadKernel();
      this.restarts++;
    }
    await this.solver.fresh(); // the same numbers for the same document every time (see PlaneGcsSolver.fresh)
    try {
      this.result = this.regen.rebuild(doc);
    } catch (e) {
      if (isTrap(e)) await this.replaceKernel();
      throw e;
    }
    return this.result;
  }

  /** The module stopped (a WebAssembly trap, ADR 0242): whatever it says from now on cannot be trusted, and every shape it held is gone with it. */
  private async replaceKernel(): Promise<void> {
    await this.loadKernel();
    this.restarts++;
  }

  /** After a trap out of anything but a rebuild, which sees to its own: a new kernel, and the part built again in it so that what is asked next has something to answer from. */
  async recoverFromCrash(): Promise<void> {
    await this.replaceKernel();
    await this.rebuild(this.doc);
  }

  private record(cause: RebuildEvent['cause'], committed: boolean, summary: PartSummary, dryRun?: boolean): void {
    const e: RebuildEvent = {
      seq: ++this.eventSeq,
      at: new Date().toISOString(),
      cause,
      committed,
      ...(dryRun ? { dryRun } : {}),
      features: summary.features.length,
      failed: summary.features.filter((f) => f.status === 'error' || f.status === 'incomplete').map((f) => f.id),
      volume: summary.mass?.volume ?? null,
      ms: summary.rebuildMs,
    };
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    this.onEvent?.(e);
  }

  // ------------------------------------------------------------------ files

  /** A path inside the root folder, or a refusal: the agent reads and writes nowhere else. */
  async inside(path: string): Promise<string> {
    if (typeof path !== 'string' || path.trim() === '') throw new AgentError('path must be a file name inside the workspace folder');
    const full = resolve(this.root, path);
    const check = (p: string) => {
      const rel = relative(this.root, p);
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) throw new AgentError(`path ${path} is outside the workspace folder ${this.root}`);
    };
    check(full);
    // a link inside the folder may point outside it: the folder that holds the file must really be inside
    const parent = await realpath(dirname(full)).catch(() => null);
    if (parent !== null) {
      const root = await realpath(this.root);
      const rel = relative(root, parent);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new AgentError(`path ${path} is outside the workspace folder ${this.root}`);
    }
    return full;
  }

  async newPart(): Promise<PartSummary> {
    this.undoStack.length = 0;
    this.blobs.clear();
    this.doc = createEmptyPart();
    this.path = null;
    await this.rebuild(this.doc);
    const summary = this.summary();
    this.record('new', true, summary);
    return summary;
  }

  /**
   * Takes the part the open app has (ADR 0238): checked and brought up to date as a file would be (`parsePart`), with its imported data. The agent's
   * undo history starts again: the app's own history is the one that counts.
   */
  async load(doc: unknown, blobs: ReadonlyMap<string, Uint8Array>): Promise<PartSummary> {
    const checked = parsePart(JSON.stringify(doc));
    this.undoStack.length = 0;
    this.blobs.clear();
    for (const [k, v] of blobs) this.blobs.set(k, v);
    this.doc = checked;
    this.path = null;
    await this.rebuild(this.doc);
    const summary = this.summary();
    this.record('sync', true, summary);
    return summary;
  }

  /** Adds imported data the app sent after the part (ADR 0238). */
  addBlobs(blobs: ReadonlyMap<string, Uint8Array>): void {
    for (const [k, v] of blobs) this.blobs.set(k, v);
  }

  async open(path: string): Promise<PartSummary & { warnings: string[] }> {
    const full = await this.inside(path);
    const file = await readPartFile(new Uint8Array(await readFile(full)));
    this.undoStack.length = 0;
    this.blobs.clear();
    for (const [k, v] of file.blobs) this.blobs.set(k, v);
    this.doc = file.doc;
    this.path = full;
    await this.rebuild(this.doc);
    const summary = this.summary();
    this.record('open', true, summary);
    return { ...summary, warnings: file.warnings };
  }

  async save(path?: string): Promise<{ path: string; bytes: number }> {
    const target = path ?? this.path;
    if (!target) throw new AgentError('the part has no file yet: give a path ending in .3dbx');
    if (!target.toLowerCase().endsWith('.3dbx')) throw new AgentError(`a part file name ends in .3dbx, not ${target}`);
    const full = await this.inside(target);
    const bytes = await writePartFile(this.doc, this.blobs);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
    this.path = full;
    return { path: full, bytes: bytes.length };
  }

  /** Writes the part's own bodies (not the reference bodies, C7.1) as STEP AP214 with colors, binary STL in mm, or 3MF (one object a body). */
  async exportFile(path: string, format: ExportFormat): Promise<{ path: string; bytes: number; warnings: string[] }> {
    if (!EXPORT_FORMATS.includes(format)) throw new AgentError(`format must be ${EXPORT_FORMATS.join(', ')}, not ${JSON.stringify(format)}`);
    const ext = format === 'step' ? ['.step', '.stp'] : [`.${format}`];
    if (!ext.some((e) => path.toLowerCase().endsWith(e))) throw new AgentError(`a ${format.toUpperCase()} file name ends in ${ext.join(' or ')}`);
    const full = await this.inside(path);
    if (!this.result.body) throw new AgentError('the part has no body to export');
    const own = exportFaces(this.doc, this.result);
    if (own.shapes.length === 0) throw new AgentError('the part has only reference bodies: nothing to export');
    const warnings: string[] = [];
    let data: Uint8Array;
    if (format === 'step') {
      data = new TextEncoder().encode(exportPartStep(this.kernel, own.shapes, this.partName(full), { schema: 'AP214', faceColors: own.colors, warnings }));
    } else {
      const meshes = own.shapes.map((shape) => this.kernel.mesh(shape, { relative: 0.001, angular: 0.25 }));
      const name = this.partName(full);
      data = format === 'stl' ? writeStl(meshes, name, { format: 'binary', unit: 'mm' }) : await writeThreeMf(meshes.map((mesh, i) => ({ name: meshes.length > 1 ? `${name}-${i + 1}` : name, mesh })));
    }
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
    return { path: full, bytes: data.length, warnings };
  }

  private partName(full: string): string {
    return full.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
  }

  // ------------------------------------------------------------------ commands

  /**
   * 「辨識特徵」 (F2.4, ADR 0239): imported body `featureId` replaced by sketches, extrusions, revolves, holes, fillets and chamfers that rebuild the same solid
   * (checked against it), applied as one batch through `apply` (so the same transaction, undo and app gate). A body that cannot be rebuilt the same is
   * refused with the reason and the part is not changed.
   */
  async recognize(featureId: unknown, options: { gate?: (commands: Command[]) => Promise<void>; approximateSplines?: boolean } = {}): Promise<ApplyReport & { recognized: ReconstructReport }> {
    if (typeof featureId !== 'string' || featureId === '') throw new AgentError('feature must be the id of an imported body (part_summary lists the features)');
    // a regenerator of its own: the rebuilds of the recognition must not release the shapes of the part as built
    const own = new Regenerator(this.kernel, this.solver, this.blobs);
    let found: { commands: Command[]; report: ReconstructReport };
    try {
      found = reconstructImported(this.kernel, own, this.doc, featureId, this.solver, undefined, { approximateSplines: options.approximateSplines === true });
    } catch (e) {
      if (e instanceof RecognizeError || e instanceof BudgetError) throw new AgentError(e.message);
      throw e;
    } finally {
      own.dispose();
    }
    const applied = await this.apply(found.commands, options);
    return { ...applied, recognized: found.report };
  }

  /**
   * Applies `commands` in order as one transaction. A command that is not an object with a known `type` is refused before anything is applied
   * (`mutate` would ignore an unknown type and say nothing). The batch is kept only when every command applies and no feature that was ok before
   * (or is new) fails to rebuild; a dry run is never kept. When it is not kept, the part is as it was.
   */
  async apply<P = never>(commands: unknown, options: { dryRun?: boolean; preview?: () => Promise<P>; gate?: (commands: Command[]) => Promise<void> } = {}): Promise<ApplyReport & { preview?: P | { error: string } }> {
    const dryRun = options.dryRun === true;
    if (!Array.isArray(commands) || commands.length === 0) throw new AgentError('commands must be a non-empty array of command objects');
    if (commands.length > MAX_COMMANDS) throw new AgentError(`at most ${MAX_COMMANDS} commands in one batch, not ${commands.length}`);
    commands.forEach((c, i) => {
      if (typeof c !== 'object' || c === null || Array.isArray(c)) throw new AgentError(`command ${i} is not an object`);
      const type = (c as { type?: unknown }).type;
      if (!isCommandType(type)) throw new AgentError(`command ${i}: unknown type ${JSON.stringify(type)} (see the command reference)`);
    });

    const before = this.doc;
    const statusBefore = new Map(this.result.features.map((f) => [f.id, f.status]));
    const volumeBefore = this.ownVolume();

    let next = before;
    for (let i = 0; i < commands.length; i++) {
      try {
        next = applyCommand(next, commands[i] as Command);
      } catch (e) {
        return { committed: false, dryRun, error: { message: messageOf(e), command: i }, broken: [], after: this.summary(), volumeChange: 0 };
      }
    }

    let r: RebuildResult;
    try {
      r = await this.rebuild(next);
    } catch (e) {
      // a rebuild that throws is a fault of the program, not of the agent: the part goes back as it was, and the agent is told
      await this.rebuild(before);
      return { committed: false, dryRun, error: { message: `rebuild failed: ${messageOf(e)}` }, broken: [], after: this.summary(), volumeChange: 0 };
    }
    const broken = r.features.filter((f) => (f.status === 'error' || f.status === 'incomplete') && statusBefore.get(f.id) !== f.status).map((f) => this.row(next, f));
    const after = this.summary(next);
    const volumeChange = this.ownVolume() - volumeBefore;
    // the preview sees the part as the batch leaves it, before it is kept or put back (a refused batch too: the picture shows what went wrong)
    let preview: P | { error: string } | undefined;
    if (options.preview) {
      try {
        preview = await options.preview();
      } catch (e) {
        preview = { error: messageOf(e) };
      }
    }
    let keep = !dryRun && broken.length === 0;
    // the open app has the last word (ADR 0238): a batch it refuses is not kept here either
    let refused: string | undefined;
    if (keep && options.gate) {
      try {
        await options.gate(commands as Command[]);
      } catch (e) {
        keep = false;
        refused = messageOf(e);
      }
    }
    this.record('apply', keep, after, dryRun);
    if (keep) {
      this.undoStack.push(before);
      this.doc = next;
    } else {
      await this.rebuild(before);
    }
    return {
      committed: keep,
      dryRun,
      ...(broken.length ? { error: { message: `${broken.length} feature(s) fail to rebuild: ${broken.map((b) => `${b.name}: ${b.message ?? b.status}`).join('; ')}` } } : refused ? { error: { message: `the app refused the batch: ${refused}` } } : {}),
      broken,
      after,
      volumeChange,
      ...(preview !== undefined ? { preview } : {}),
    };
  }

  /** Takes back the last batch that was kept. */
  async undo(gate?: () => Promise<void>): Promise<PartSummary> {
    const prev = this.undoStack.at(-1);
    if (!prev) throw new AgentError('nothing to undo');
    if (gate) await gate(); // the app takes it back first (ADR 0238); a refusal leaves both as they are
    this.undoStack.pop();
    this.doc = prev;
    await this.rebuild(prev);
    const summary = this.summary();
    this.record('undo', true, summary);
    return summary;
  }

  // ------------------------------------------------------------------ what the part is

  private row(doc: PartDoc, f: FeatureResult): FeatureRow {
    const feature = doc.features.find((x) => x.id === f.id);
    return {
      id: f.id,
      type: feature?.type ?? '?',
      name: feature?.name ?? f.id,
      status: f.status,
      ...(f.message ? { message: f.message } : {}),
      ...(f.warnings?.length ? { warnings: f.warnings } : {}),
      ...(f.sketch ? { sketch: { status: f.sketch.status, dof: f.sketch.dof, problems: f.sketch.problems } } : {}),
    };
  }

  private ownBodies() {
    return this.result.bodies.filter((b) => !b.reference && !b.surface);
  }

  private ownVolume(): number {
    return this.ownBodies().reduce((n, b) => n + this.kernel.massProps(b.shape).volume, 0);
  }

  /** What is answered after every batch, quickly; `exact` integrates the centre too, in seconds on spline faces, for when the summary itself is asked for (ADR 0241). */
  summary(doc: PartDoc = this.doc, exact = false): PartSummary {
    const r = this.result;
    const masses = this.ownBodies().map((b) => (exact ? this.kernel.massPropsExact(b.shape) : this.kernel.massProps(b.shape)));
    return {
      path: this.path,
      features: r.features.map((f) => this.row(doc, f)),
      bodies: r.bodies.map((b) => {
        const m: MassProps | null = b.curve ? null : this.kernel.massProps(b.shape);
        return { id: b.id, name: b.name, kind: b.curve ? 'curve' : b.surface ? 'surface' : 'solid', reference: b.reference, faces: b.faces, volume: b.surface ? 0 : (m?.volume ?? 0), area: m?.area ?? 0 };
      }),
      mass: masses.length ? combine(masses) : null,
      box: r.body ? this.box(r.body.shape) : null,
      rebuildMs: Math.round(r.totalMs),
    };
  }

  private box(shape: ShapeId): PartSummary['box'] {
    const mesh = this.kernel.mesh(shape, { tolerance: 0.01, angular: 0.25 });
    const p = mesh.positions;
    const e = mesh.edgePoints;
    if (p.length === 0 && e.length === 0) return null;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const arr of [p, e]) {
      for (let i = 0; i < arr.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k]!, arr[i + k]!);
          max[k] = Math.max(max[k]!, arr[i + k]!);
        }
      }
    }
    const r3 = (v: number[]) => v.map((x) => Math.round(x * 1e4) / 1e4) as [number, number, number];
    return { min: r3(min), max: r3(max), size: r3(max.map((x, k) => x - min[k]!)) };
  }

  /** Faces, edges or vertices of the part as built, each with the reference a command takes: the agent cannot click, so it asks by geometry. */
  elements(q: ElementQuery): ElementRow[] {
    if (!['face', 'edge', 'vertex'].includes(q.kind)) throw new AgentError(`kind must be face, edge or vertex, not ${JSON.stringify(q.kind)}`);
    if (q.limit !== undefined && !(Number.isInteger(q.limit) && q.limit > 0)) throw new AgentError(`limit must be a positive whole number, not ${q.limit}`);
    let dir: number[] | null = null;
    if (q.direction !== undefined) {
      if (!Array.isArray(q.direction) || q.direction.length !== 3 || !q.direction.every(Number.isFinite)) throw new AgentError('direction must be three finite numbers');
      const n = Math.hypot(...q.direction);
      if (!(n > 0)) throw new AgentError('direction must not be zero');
      dir = q.direction.map((x) => x / n);
    }
    const body = this.result.body;
    if (!body) return [];
    const parts = body.parts.length ? body.parts : [{ id: this.result.bodies[0]?.id ?? '', face0: 0, faces: body.topology.faces.length, edge0: 0, edges: body.topology.edges.length, vertex0: 0, vertices: body.topology.vertices.length }];
    if (q.body !== undefined && !parts.some((p) => p.id === q.body)) throw new AgentError(`no body ${q.body}: the bodies are ${parts.map((p) => p.id).join(', ')}`);
    const bodyOf = (kind: 'face' | 'edge' | 'vertex', i: number) => parts.find((p) => (kind === 'face' ? i >= p.face0 && i < p.face0 + p.faces : kind === 'edge' ? i >= p.edge0 && i < p.edge0 + p.edges : i >= p.vertex0 && i < p.vertex0 + p.vertices))?.id ?? '';
    const r4 = (v: readonly number[]) => v.map((x) => Math.round(x * 1e4) / 1e4);
    const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    const rows: ElementRow[] = [];
    if (q.kind === 'face') {
      body.topology.faces.forEach((f, i) => {
        if (q.type && f.surface !== q.type) return;
        if (dir && !(f.normal && dot(f.normal, dir) >= ANGLE_1_DEG)) return;
        const b = bodyOf('face', i);
        if (q.body !== undefined && b !== q.body) return;
        const radius = (f.geometry as { radius?: number } | undefined)?.radius;
        rows.push({ ref: { kind: 'face', name: body.names.faces[i]!, fingerprint: faceFingerprint(body.topology, i) }, body: b, type: f.surface, area: round(f.area), center: r4(f.center), normal: f.normal && r4(f.normal), ...(radius !== undefined ? { radius: round(radius) } : {}) });
      });
    } else if (q.kind === 'edge') {
      body.topology.edges.forEach((e, i) => {
        if (q.type && e.curve !== q.type) return;
        if (dir && !(e.dir && Math.abs(dot(e.dir, dir)) >= ANGLE_1_DEG)) return;
        const b = bodyOf('edge', i);
        if (q.body !== undefined && b !== q.body) return;
        const radius = (e.geometry as { radius?: number } | undefined)?.radius;
        // a seam (the edge where a closed face such as a cylinder meets itself) has the same face on both sides: it is not a corner to round
        const seam = new Set(e.faces).size === 1;
        rows.push({ ref: { kind: 'edge', name: body.names.edges[i]!, fingerprint: edgeFingerprint(body.topology, i) }, body: b, type: e.curve, length: round(e.length), center: r4(e.mid), dir: e.dir && r4(e.dir), ...(radius !== undefined ? { radius: round(radius) } : {}), ...(seam ? { seam: true } : {}) });
      });
    } else {
      if (q.type !== undefined || dir) throw new AgentError('type and direction apply to faces and edges, not to vertices');
      body.topology.vertices.forEach((v, i) => {
        const b = bodyOf('vertex', i);
        if (q.body !== undefined && b !== q.body) return;
        rows.push({ ref: { kind: 'vertex', name: body.names.vertices[i]! }, body: b, center: r4(v.point) });
      });
    }
    return q.limit ? rows.slice(0, q.limit) : rows;
  }

  /** The shape of the part's own bodies for a picture (the reference bodies too when there is nothing else), and the shapes made for it to release. */
  shapeForView(): { shape: ShapeId; made: ShapeId[] } | null {
    const body = this.result.body;
    if (!body) return null;
    const own = this.ownBodies();
    if (own.length > 0 && own.length < this.result.bodies.length) {
      if (own.length === 1) return { shape: own[0]!.shape, made: [] };
      const joined = this.kernel.join(own.map((b) => b.shape));
      return { shape: joined, made: [joined] };
    }
    return { shape: body.shape, made: [] };
  }

  get kernelForView(): Kernel {
    return this.kernel;
  }
}

function combine(masses: MassProps[]): PartSummary['mass'] {
  const volume = masses.reduce((n, m) => n + m.volume, 0);
  const area = masses.reduce((n, m) => n + m.area, 0);
  const center = [0, 1, 2].map((k) => (volume > 0 ? masses.reduce((n, m) => n + m.center[k]! * m.volume, 0) / volume : 0)) as [number, number, number];
  return { volume: round(volume), area: round(area), center: center.map(round) as [number, number, number] };
}

const round = (x: number) => Math.round(x * 1e4) / 1e4;

export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
