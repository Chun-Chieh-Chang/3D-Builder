/**
 * The geometry code stopping (a WebAssembly trap), as the page learns of it (ADR 0242). Comlink carries only the name, the message and the stack of an error across to the page, so the
 * name is what says it. This file holds no kernel: the page uses it, and the page loads no WASM.
 */

/** The name of `KernelCrash` in `@3db/kernel`; a test holds the two together. */
export const CRASH_NAME = 'KernelCrash';

/** Whether a call to the worker failed because the module in it can no longer be used. */
export function isWorkerCrash(e: unknown): e is Error {
  return e instanceof Error && e.name === CRASH_NAME;
}

/**
 * The worker's API with every trap that comes out of a call marked as a crash. The rebuild says which feature it was; a trap in anything else (a mesh, a measurement, an export) arrives
 * here as it was thrown, and is a crash all the same.
 */
export function reportingCrashes<T extends object>(api: T, isTrap: (e: unknown) => boolean): T {
  const out = {} as Record<string, unknown>;
  for (const [name, fn] of Object.entries(api)) {
    out[name] = typeof fn !== 'function' ? fn : async (...args: unknown[]) => {
      try {
        return await (fn as (...a: unknown[]) => unknown).apply(api, args);
      } catch (e) {
        if (!isTrap(e) || isWorkerCrash(e)) throw e;
        const crash = new Error(e instanceof Error ? e.message : String(e));
        crash.name = CRASH_NAME;
        throw crash;
      }
    };
  }
  return out as T;
}
