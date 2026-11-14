import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { applyAssemblyCommand, createEmptyAssembly, DATUM_PLANES, isFilePath, type AssemblyCommand, type AssemblyDoc } from '@3db/model';
import { readDocumentFile, readPartFile, writeAssemblyFile } from '@3db/io';
import { faceFingerprint } from '@3db/naming';
import { findInterference, faceMateGeometry, mateGeometry, Regenerator, solveAssembly, type MatePart, type ViewPart } from '@3db/regen';
import type { Kernel, ShapeId } from '@3db/kernel';
import { AgentError, type CadSession } from './session';
import { renderPlacedView, type RenderOptions } from './render';

type Source = MatePart & { shape: ShapeId };
type Options = { preview?: RenderOptions; interference?: boolean };
export const MAX_ASSEMBLY_COMPONENTS = 32;
export const MAX_ASSEMBLY_MATES = 64;

/** Stores only design intent. Native shapes belong to the per-call regenerators. */
export class AssemblySession {
  private doc = createEmptyAssembly();
  private dirty = false;

  constructor(private readonly session: CadSession) {}

  newAssembly() {
    if (this.dirty) throw new AgentError('save the current assembly before starting another');
    this.doc = createEmptyAssembly();
    return { components: [], mates: [] };
  }

  async open(path: string) {
    if (this.dirty) throw new AgentError('save the current assembly before opening another');
    if (!isFilePath(path) || !path.toLowerCase().endsWith('.3dba')) throw new AgentError('open path must be a workspace-relative .3dba file');
    const requested = await this.session.inside(path);
    const full = await this.session.inside(await realpath(requested));
    const file = await readDocumentFile(await readFile(full));
    if (file.kind !== 'assembly') throw new AgentError('expected an assembly document');
    const doc = file.doc;
    this.checkSize(doc);
    if (doc.patterns?.length || doc.explosions?.length || doc.components.some((c) => c.suppressed || c.hidden || c.transparent)
      || doc.mates.some((m) => !['coincident', 'concentric', 'distance'].includes(m.type) || m.suppressed || m.a.path?.length || m.b.path?.length)) {
      throw new AgentError('this assembly uses features outside the supported headless subset');
    }
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

  private async withSources<T>(action: (kernel: Kernel, load: (path: string) => Promise<Source>) => Promise<T>): Promise<T> {
    const { kernel, solver } = await this.session.assemblyGeometry();
    const owned: Regenerator[] = [];
    try {
      return await action(kernel, async (path) => {
        const file = await readPartFile(await readFile(await this.sourceFile(path)));
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
        return { shape: body.shape, names: body.names, topology: body.topology, frames: result.frames };
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
      const part = await load(path);
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

  private async evaluate(doc: AssemblyDoc, options: Options) {
    return this.withSources(async (kernel, load) => {
      const sources = new Map<string, Source>();
      const sourcesByPath = new Map<string, Source>();
      for (const file of doc.files) {
        const part = sourcesByPath.get(file.path) ?? await load(file.path);
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
      const report = { components, mates, valid };
      if (!valid) return { report };
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
    });
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
    const result = await this.evaluate(next, options);
    const committed = result.report.valid && !dryRun;
    if (committed) {
      this.doc = next;
      this.dirty = true;
    }
    return { report: { ...result.report, committed }, image: result.image };
  }

  async save(path: string) {
    if (!isFilePath(path) || !path.toLowerCase().endsWith('.3dba')) throw new AgentError('save path must be a workspace-relative .3dba file');
    const requested = await this.session.inside(path);
    // Require the directory to exist before resolving it, so a missing directory under a link cannot escape the workspace.
    const directory = await realpath(dirname(requested));
    const full = await this.session.inside(join(directory, basename(requested)));
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
