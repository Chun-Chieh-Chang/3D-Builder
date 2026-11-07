/// <reference lib="webworker" />
/** The worker of a job (`job.ts`): a kernel and a solver of its own, used once. See `store.recognizeFeatures`. */
import * as Comlink from 'comlink';
import { setLocale, t } from '@3db/i18n';
import occtWasm from 'libcascade/single/wasm?url';
import gcsWasm from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import { Kernel } from '@3db/kernel';
import { BudgetError, reconstructImported, RecognizeError, Regenerator } from '@3db/regen';
import { PlaneGcsSolver } from '@3db/sketch';
import type { JobApi } from './protocol';

let kernel: Kernel;
let solver: PlaneGcsSolver;

const api: JobApi = {
  async init(locale) {
    setLocale(locale);
    solver = await PlaneGcsSolver.create(gcsWasm);
    kernel = await Kernel.load({ wasmUrl: occtWasm });
  },
  async recognizeFeatures(doc, featureId, blobs) {
    const regen = new Regenerator(kernel, solver, blobs);
    try {
      const { commands, report } = reconstructImported(kernel, regen, doc, featureId, solver);
      return { commands, report };
    } catch (e) {
      // the reason itself is what the user is told; anything else came out of the kernel, in its own terms
      if (e instanceof RecognizeError || e instanceof BudgetError) throw new Error(e.message);
      throw new Error(t('job.crashed', { why: e instanceof Error ? e.message : String(e) }));
    }
  },
};

Comlink.expose(api);
