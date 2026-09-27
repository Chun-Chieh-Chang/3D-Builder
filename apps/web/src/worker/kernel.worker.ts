/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import occtWasm from 'libcascade/single/wasm?url';
import gcsWasm from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import type { PartDoc } from '@3db/model';
import { findProfiles, PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { edgeFingerprint, faceFingerprint } from '@3db/naming';
import { exportPartStep } from '@3db/io';
import type { KernelApi, RebuildPayload, RebuildRequest, SketchSolvePayload, SketchSolveRequest } from './protocol';

let kernel: Kernel;
let solver: PlaneGcsSolver;
let regen: Regenerator;
let ready: Promise<{ occtMs: number; gcsMs: number }> | null = null;
let solverReady: Promise<PlaneGcsSolver> | null = null;

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
  regen = new Regenerator(kernel, solver);
  return { occtMs, gcsMs };
}

const api: KernelApi = {
  init() {
    ready ??= boot();
    return ready;
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
      frames: r.frames,
      mass: body ? kernel.massProps(body.shape) : null,
      totalMs: r.totalMs,
    };
    const buffers = mesh ? [mesh.positions, mesh.normals, mesh.indices, mesh.faceRanges, mesh.edgePoints, mesh.edgeRanges].map((a) => a.buffer as ArrayBuffer) : [];
    return Comlink.transfer(payload, buffers);
  },

  async solveSketch({ seq, sketch, ...options }: SketchSolveRequest): Promise<SketchSolvePayload> {
    await loadSolver();
    const t = performance.now();
    const r = solver.solve(sketch, options);
    const problems = r.status === 'failed' ? [] : findProfiles(sketch, r).problems;
    return { seq, ...r, problems, ms: performance.now() - t };
  },

  async exportStep(doc: PartDoc): Promise<string> {
    await api.init();
    const r = regen.rebuild(doc);
    if (!r.body) throw new Error('沒有可輸出的本體');
    return exportPartStep(kernel, r.body.shape, doc);
  },
};

Comlink.expose(api);
