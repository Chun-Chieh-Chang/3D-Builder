import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { applyAssemblyCommand, buildBom, createEmptyAssembly, DATUM_PLANES, isFilePath, type AssemblyCommand, type AssemblyDoc, type Id, type SourceTree } from '@3db/model';
import { bomCsv, exportAssemblyStep, portableShape, readDocumentFile, readPartFile, stepStructure, writeAssemblyFile } from '@3db/io';
import { t } from '@3db/i18n';
import { faceFingerprint } from '@3db/naming';
import { faceColors, findInterference, faceMateGeometry, mateGeometry, Regenerator, solveAssembly, type MatePart, type ViewPart } from '@3db/regen';
import type { Kernel, ShapeId } from '@3db/kernel';
import { AgentError, type CadSession } from './session';
import { renderPlacedView, type RenderOptions } from './render';

/** A source part as rebuilt for one call: what mates and drawing need, and what a delivery file needs (face colors, the part's properties). */
type Source = MatePart & { shape: ShapeId; colors: (string | null)[]; properties: Record<string, string> };
export type ExportFormat = 'step' | 'bom_csv';
type Options = { preview?: RenderOptions; interference?: boolean };

/**
 * The open app's side of an assembly the agent works on through the live link (ADR 0253): the part files it has sent, by hash; a part file read
 * from it by its path from the assembly's folder; and a batch or an undo sent to it, which rejects (with the reason, for the agent) when it refuses.
 */
export interface LiveAssembly {
  blobs: ReadonlyMap<string, Uint8Array>;
  read(path: string): Promise<{ sha: string; data: Uint8Array }>;
  apply(commands: AssemblyCommand[]): Promise<void>;
  undo(): Promise<void>;
}

/** Why the headless solve cannot take an assembly (the subset of ADR 0253 and of the first assembly tools), or null when it can. */
export function subsetProblem(doc: AssemblyDoc): string | null {
  if (doc.patterns?.length) return 'it has component patterns';
  if (doc.explosions?.length) return 'it has exploded views';
  if (doc.components.some((c) => c.suppressed || c.hidden || c.transparent)) return 'some components are suppressed, hidden or transparent';
  if (doc.mates.some((m) => m.suppressed)) return 'some mates are suppressed';
  const other = doc.mates.find((m) => !['coincident', 'concentric', 'distance'].includes(m.type));
  if (other) return `it has a ${other.type} mate (only coincident, concentric and distance are solved here)`;
  if (doc.mates.some((m) => m.a.path?.length || m.b.path?.length)) return 'some mates refer to parts inside sub-assemblies';
  const file = doc.files.find((item) => !item.path.toLowerCase().endsWith('.3dbx'));
  if (file) return `it uses ${file.path}, which is not a .3dbx part file`;
  return null;
}
export const MAX_ASSEMBLY_COMPONENTS = 32;
export const MAX_ASSEMBLY_MATES = 64;
/** While the app's assembly is followed, which document is open is the user's choice, and so is saving it (ADR 0253). */
export const LIVE_ONLY = 'the app is connected and shows an assembly: you work on that assembly. The user opens, starts or saves assemblies in the app, or ends the link.';

/** Stores only design intent. Native shapes belong to the per-call regenerators. */
export class AssemblySession {
  private doc = createEmptyAssembly();
  private dirty = false;
  /**
   * The assembly open in the app, while the live link has it (ADR 0253): `doc` is then the app's, each file's bytes come from the app (`sources`:
   * the hash of each file id's content), and `before` is the assembly before the agent's last batch, while undo may still take it back.
   */
  private live: { link: LiveAssembly; sources: Map<Id, string>; before: AssemblyDoc | null } | null = null;

  constructor(private readonly session: CadSession) {}

  get linked(): boolean {
    return this.live !== null;
  }

  /**
   * Follows the live link: `open` is the assembly open in the app (`fresh`: as it just sent it), or null when no assembly of the app is followed.
   * A fresh one replaces the assembly here; leaving the link drops the app's assembly, whose paths are the app's, not the workspace's.
   */
  follow(link: LiveAssembly | null, open: { doc: AssemblyDoc; sources: Record<Id, string>; fresh: boolean } | null) {
    if (!link || !open) {
      if (this.live) {
        this.live = null;
        this.doc = createEmptyAssembly();
        this.dirty = false;
      }
      return;
    }
    if (open.fresh || !this.live) {
      this.live = { link, sources: new Map(Object.entries(open.sources)), before: null };
      this.doc = open.doc;
      this.dirty = false;
    }
  }

  newAssembly() {
    if (this.live) throw new AgentError(LIVE_ONLY);
    if (this.dirty) throw new AgentError('save the current assembly before starting another');
    this.doc = createEmptyAssembly();
    return { components: [], mates: [] };
  }

  async open(path: string) {
    if (this.live) throw new AgentError(LIVE_ONLY);
    if (this.dirty) throw new AgentError('save the current assembly before opening another');
    if (!isFilePath(path) || !path.toLowerCase().endsWith('.3dba')) throw new AgentError('open path must be a workspace-relative .3dba file');
    const requested = await this.session.inside(path);
    const full = await this.session.inside(await realpath(requested));
    const file = await readDocumentFile(await readFile(full));
    if (file.kind !== 'assembly') throw new AgentError('expected an assembly document');
    const doc = file.doc;
    this.checkSize(doc);
    const problem = subsetProblem(doc);
    if (problem) throw new AgentError(`this assembly uses features outside the supported headless subset: ${problem}`);
    const files = await Promise.all(doc.files.map(async (entry) => ({
      ...entry, path: await this.session.workspaceRelative(resolve(dirname(requested), entry.path)),
    })));
    const next = { ...doc, files };
    const { report } = await this.evaluate(next, {});
    if (report.valid) this.doc = next;
    return { ...report, opened: report.valid, path };
  }

  private checkSize(doc: AssemblyDoc) {
    if (doc.components.length > MAX_ASSEMBLY_COMPONENTS || doc.mates.length > MAX_ASSEMBLY_MATES || doc.files.length > MAX_ASSEMBLY_COMPONENTS) {
      throw new AgentError(`assembly limits: ${MAX_ASSEMBLY_COMPONENTS} components and files, ${MAX_ASSEMBLY_MATES} mates`);
    }
  }

  private async sourceFile(path: string) {
    if (!isFilePath(path) || !path.toLowerCase().endsWith('.3dbx')) throw new AgentError('assembly sources must be workspace-relative .3dbx paths');
    const full = await this.session.inside(path);
    // Validate the resolved file as well as its parent, including file symlinks.
    return this.session.inside(await realpath(full));
  }

  /**
   * A part file's bytes in the app's assembly: those the app sent for the file id, or (a file the assembly does not use yet) read from the app by
   * its path. `fetched`: the hash of each path read in this call, so that a batch that is kept knows each new file's content.
   */
  private async liveBytes(file: { id?: Id; path: string }, fetched: Map<string, string>): Promise<Uint8Array> {
    const live = this.live!;
    const known = file.id !== undefined ? live.sources.get(file.id) : undefined;
    if (known) {
      const data = live.link.blobs.get(known);
      if (!data) throw new AgentError(`the app did not send the content of ${file.path}`);
      return data;
    }
    if (!isFilePath(file.path) || !file.path.toLowerCase().endsWith('.3dbx')) throw new AgentError("assembly sources must be .3dbx paths relative to the assembly's folder");
    const sha = fetched.get(file.path);
    const had = sha !== undefined ? live.link.blobs.get(sha) : undefined;
    if (had) return had;
    let read;
    try {
      read = await live.link.read(file.path);
    } catch (e) {
      throw new AgentError(`the app could not read ${file.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
    fetched.set(file.path, read.sha);
    return read.data;
  }

  private async withSources<T>(action: (kernel: Kernel, load: (file: { id?: Id; path: string }) => Promise<Source>) => Promise<T>, fetched = new Map<string, string>()): Promise<T> {
    const { kernel, solver } = await this.session.assemblyGeometry();
    const owned: Regenerator[] = [];
    try {
      return await action(kernel, async ({ id, path }) => {
        const bytes = this.live ? await this.liveBytes({ ...(id !== undefined ? { id } : {}), path }, fetched) : await readFile(await this.sourceFile(path));
        const file = await readPartFile(bytes);
        const regen = new Regenerator(kernel, solver, file.blobs);
        owned.push(regen);
        await solver.fresh();
        const result = regen.rebuild(file.doc);
        const body = result.body;
        if (result.features.some((feature) => feature.status === 'error' || feature.status === 'incomplete')) {
          throw new AgentError(`could not rebuild assembly source ${path}`);
        }
        if (!body || result.bodies.some((piece) => piece.reference || piece.surface || piece.curve)) {
          throw new AgentError(`assembly source ${path} must contain solid bodies only`);
        }
        return {
          shape: body.shape, names: body.names, topology: body.topology, frames: result.frames,
          colors: faceColors(file.doc, result), properties: { ...file.doc.properties },
        };
      });
    } finally {
      for (const regen of owned) regen.dispose();
    }
  }

  async queryElements(query: { path: string } | { component: string }) {
    const component = 'component' in query ? this.doc.components.find((item) => item.id === query.component) : undefined;
    const path = 'path' in query ? query.path : this.doc.files.find((file) => file.id === component?.file)?.path;
    if (!path) throw new AgentError('unknown assembly component');
    return this.withSources(async (_kernel, load) => {
      const part = await load({ ...(component ? { id: component.file } : {}), path });
      const planes = [...new Set([...Object.keys(DATUM_PLANES), ...part.frames.keys()])].map((name) => {
        const ref = { kind: 'datum' as const, name };
        return { ref, geometry: mateGeometry(ref, part) };
      });
      const faces = part.topology.faces.flatMap((face, index) => {
        const geometry = faceMateGeometry(face);
        if (geometry?.kind !== 'plane' && geometry?.kind !== 'cylinder') return [];
        const ref = { kind: 'face' as const, name: part.names.faces[index]!, fingerprint: faceFingerprint(part.topology, index) };
        return [{ ref, geometry, center: face.center, area: face.area }];
      });
      return { path, ...(component ? { component: component.id } : {}), elements: [...planes, ...faces] };
    });
  }

  private async evaluate(doc: AssemblyDoc, options: Options, fetched?: Map<string, string>) {
    this.checkLive(doc);
    return this.withSources(async (kernel, load) => {
      const { sources, solved, report } = await this.solve(doc, load);
      if (!report.valid) return { report };
      const placed = doc.components.map((component) => ({
        part: component.file, component: component.id, pose: solved.poses.get(component.id)!, mirrored: false,
      }));
      let interference;
      if (options.interference) {
        const result = findInterference(kernel, placed.map((item) => ({ id: item.component, parts: [item] })), (id) => sources.get(id)?.shape ?? null);
        try {
          interference = {
            ...result,
            status: result.unknown.length || result.failed.length ? 'incomplete' : result.overlaps.length ? 'overlap' : 'clear',
            overlaps: result.overlaps.map(({ shape: _shape, ...overlap }) => overlap),
          };
        } finally {
          for (const overlap of result.overlaps) kernel.release(overlap.shape);
        }
      }
      let image;
      if (options.preview) {
        if (placed.length === 0) throw new AgentError('the assembly has no components to preview');
        const parts: ViewPart[] = placed.map((item) => ({ ...item, shape: sources.get(item.part)!.shape }));
        image = await renderPlacedView(kernel, parts, options.preview);
      }
      return { report: { ...report, ...(interference ? { interference } : {}) }, image };
    }, fetched);
  }

  /** The app's assembly must be one the solve here takes; the user can still work on any other in the app. */
  private checkLive(doc: AssemblyDoc) {
    if (!this.live) return;
    this.checkSize(doc);
    const problem = subsetProblem(doc);
    if (problem) throw new AgentError(`the assembly open in the app cannot be solved here: ${problem}. The user can still work on it in the app.`);
  }

  /** Loads every source of `doc` (by file id), checks each mate's references and solves: the poses and the report every tool answers with. */
  private async solve(doc: AssemblyDoc, load: (file: { id?: Id; path: string }) => Promise<Source>) {
    const sources = new Map<string, Source>();
    const sourcesByPath = new Map<string, Source>();
    for (const file of doc.files) {
      const part = sourcesByPath.get(file.path) ?? await load(file);
      sourcesByPath.set(file.path, part);
      sources.set(file.id, part);
    }
    const sourceOf = (id: string) => sources.get(doc.components.find((item) => item.id === id)?.file ?? '') ?? null;
    for (const mate of doc.mates) {
      const kind = mate.type === 'concentric' ? 'cylinder' : 'plane';
      for (const end of [mate.a, mate.b]) {
        const part = end.component === null ? null : sourceOf(end.component);
        // The queried persistent name must still exist. A different matching face needs a new selection.
        if (end.ref.kind === 'face' && !part?.names.faces.includes(end.ref.name)) throw new AgentError(`mate ${mate.id}: missing face ${end.ref.name}`);
        const geometry = mateGeometry(end.ref, part);
        if (typeof geometry === 'string') throw new AgentError(`mate ${mate.id}: ${geometry}`);
        if (geometry.kind !== kind) throw new AgentError(`mate ${mate.id}: ${mate.type} requires two ${kind} references`);
      }
    }
    const solved = solveAssembly(doc, sourceOf);
    const mates = Array.from(solved.mates, ([id, state]) => ({ id, ...state }));
    const components = doc.components.map((component) => ({
      id: component.id, file: component.file, pose: solved.poses.get(component.id), ...solved.components.get(component.id),
    }));
    const valid = mates.every((mate) => mate.status === 'ok');
    return { sources, solved, report: { components, mates, valid } };
  }

  /**
   * Writes the committed assembly as a delivery file, by the same functions the app's own exports use: a STEP with each source part once and each
   * component where the mates put it (`stepStructure`, `exportAssemblyStep`), or the flat parts list as CSV (`buildBom`, `bomCsv`). Refuses an empty
   * assembly, unresolved mates, a path whose extension is not the format's, and a file that is already there.
   */
  async export(path: string, format: ExportFormat) {
    const lower = typeof path === 'string' ? path.toLowerCase() : '';
    const fits = format === 'step' ? lower.endsWith('.step') || lower.endsWith('.stp') : format === 'bom_csv' && lower.endsWith('.csv');
    if (!isFilePath(path) || !fits) {
      throw new AgentError(format === 'step' ? 'a step export path must be a workspace-relative .step or .stp file' : 'a bom_csv export path must be a workspace-relative .csv file');
    }
    const doc = this.doc;
    if (doc.components.length === 0) throw new AgentError('the assembly has no components to export');
    this.checkLive(doc);
    const full = await this.destination(path);
    const out = await this.withSources(async (kernel, load) => {
      const { sources, solved, report } = await this.solve(doc, load);
      if (!report.valid) throw new AgentError('assembly has unresolved mates and cannot be exported');
      // Every component is a part here (the headless subset has no sub-assemblies, patterns or mirrors); the file id is the key to its source.
      const trees: Record<Id, SourceTree> = {};
      for (const component of doc.components) {
        const file = doc.files.find((item) => item.id === component.file);
        if (file) trees[component.id] = { kind: 'part', key: file.id, path: file.path };
      }
      if (format === 'bom_csv') {
        const rows = buildBom({ doc, trees, propsOf: (key) => sources.get(key)?.properties }).flat;
        return { bytes: bomCsv(rows), detail: { rows: rows.map(({ item, name, qty, vendor, partNo, path: file }) => ({ item, name, qty, vendor, partNo, file })) } };
      }
      const structure = stepStructure(doc, '', trees, (id) => solved.poses.get(id) ?? null, undefined, () => 'not loaded');
      if (structure.unreadable.length) throw new AgentError(`cannot export: ${structure.unreadable.map((item) => item.path).join(', ')}`);
      const made: ShapeId[] = [];
      try {
        let stuck = 0;
        const parts = structure.parts.map((part) => {
          const source = sources.get(part.key)!;
          const fit = portableShape(kernel, source.shape);
          if (fit.converted) made.push(fit.shape);
          if (fit.failed) stuck++;
          return { shape: fit.shape, name: part.name, faceColors: source.colors };
        });
        const warnings = stuck > 0 ? [t('export.offsetKept', { n: String(stuck) })] : [];
        const text = exportAssemblyStep(kernel, basename(path).replace(/\.(step|stp)$/i, ''), parts, structure.instances, structure.subs, warnings);
        return { bytes: new TextEncoder().encode(text), detail: { parts: parts.length, instances: structure.instances.length, warnings } };
      } finally {
        for (const id of made) kernel.release(id);
      }
    });
    await writeFile(full, out.bytes, { flag: 'wx' });
    return { path: full, format, bytes: out.bytes.length, ...out.detail };
  }

  /** A new file's place: inside the workspace, in a folder that exists (resolved first, so a missing folder under a link cannot lead outside). */
  private async destination(path: string) {
    const requested = await this.session.inside(path);
    const directory = await realpath(dirname(requested));
    return this.session.inside(join(directory, basename(requested)));
  }

  inspect(options: Options) {
    return this.evaluate(this.doc, options);
  }

  async apply(commands: AssemblyCommand[], dryRun: boolean, options: Options) {
    let next = this.doc;
    for (const command of commands) {
      next = applyAssemblyCommand(next, command);
      this.checkSize(next);
    }
    const fetched = new Map<string, string>();
    const result = await this.evaluate(next, options, fetched);
    const committed = result.report.valid && !dryRun;
    if (committed && this.live) {
      const live = this.live;
      // kept only when the app has applied it too: a refusal comes back as the tool's error, and the assembly here stays the app's
      await live.link.apply(commands);
      for (const file of next.files) if (!live.sources.has(file.id) && fetched.has(file.path)) live.sources.set(file.id, fetched.get(file.path)!);
      live.before = this.doc;
      this.doc = next;
    } else if (committed) {
      this.doc = next;
      this.dirty = true;
    }
    return { report: { ...result.report, committed }, image: result.image };
  }

  /** Takes back the agent's last batch in the app's assembly (the `undo` tool while the app shows an assembly). */
  async undoLive() {
    const live = this.live;
    if (!live) throw new AgentError('no assembly of the app is open');
    if (!live.before) throw new AgentError('there is no batch of yours to take back since the user last changed the assembly');
    await live.link.undo();
    this.doc = live.before;
    live.before = null;
    return { undone: true, components: this.doc.components.length, mates: this.doc.mates.length };
  }

  async save(path: string) {
    if (this.live) throw new AgentError(LIVE_ONLY);
    if (!isFilePath(path) || !path.toLowerCase().endsWith('.3dba')) throw new AgentError('save path must be a workspace-relative .3dba file');
    const full = await this.destination(path);
    const files = [];
    for (const file of this.doc.files) {
      const source = await this.sourceFile(file.path);
      files.push({ ...file, path: relative(dirname(full), source).split(sep).join('/') });
    }
    const result = await this.evaluate(this.doc, {});
    if (!result.report.valid) throw new AgentError('assembly has unresolved mates and cannot be saved');
    const bytes = await writeAssemblyFile({ ...this.doc, files });
    await writeFile(full, bytes, { flag: 'wx' });
    this.dirty = false;
    return { path: full, files, bytes: bytes.length };
  }
}
