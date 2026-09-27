/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import occtWasm from 'libcascade/single/wasm?url';
import gcsWasm from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import type { PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { edgeFingerprint } from '@3db/naming';
import { exportPartStep } from '@3db/io';
import type { KernelApi, RebuildPayload, RebuildRequest } from './protocol';

let kernel: Kernel;
let regen: Regenerator;
let ready: Promise<{ occtMs: number; gcsMs: number }> | null = null;

async function boot() {
  let t = performance.now();
  kernel = await Kernel.load({ wasmUrl: occtWasm });
  const occtMs = performance.now() - t;
  t = performance.now();
  const solver = await PlaneGcsSolver.create(gcsWasm);
  const gcsMs = performance.now() - t;
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
      edgeNames: body?.names.edges ?? [],
      edgeFingerprints: body ? body.topology.edges.map((_, i) => edgeFingerprint(body.topology, i)) : [],
      mass: body ? kernel.massProps(body.shape) : null,
      totalMs: r.totalMs,
    };
    const buffers = mesh ? [mesh.positions, mesh.normals, mesh.indices, mesh.faceRanges, mesh.edgePoints, mesh.edgeRanges].map((a) => a.buffer as ArrayBuffer) : [];
    return Comlink.transfer(payload, buffers);
  },

  async exportStep(doc: PartDoc): Promise<string> {
    await api.init();
    const r = regen.rebuild(doc);
    if (!r.body) throw new Error('沒有可輸出的本體');
    return exportPartStep(kernel, r.body.shape, doc);
  },
};

Comlink.expose(api);
