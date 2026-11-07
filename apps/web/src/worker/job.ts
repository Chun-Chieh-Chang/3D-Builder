/**
 * A long computation in a worker used once and thrown away (handoff §0b item 2). OCCT cannot be interrupted, so stopping it is terminating its worker. The part on screen
 * lives in another worker and is not touched by any of this: not by a cancel, a time limit, a crash, or the heap the job grew, which goes with its worker.
 */

/** Why a job stopped without an answer. A refusal by the job itself is an ordinary rejection with its own message. */
export class JobStopped extends Error {
  constructor(
    readonly reason: 'cancelled' | 'time' | 'crashed',
    message: string = reason,
  ) {
    super(message);
    this.name = 'JobStopped';
  }
}

/** The part of a `Worker` a job uses. */
export interface JobWorker {
  terminate(): void;
  onerror: ((e: ErrorEvent) => unknown) | null;
}

export interface RunningJob<T> {
  answer: Promise<T>;
  cancel(): void;
}

/**
 * Runs `work` in the worker `create` makes, once `boot` has loaded its kernel: loading 43 MB of WASM is not the job's time, so the limit `limitMs` starts after it. The
 * worker is terminated however it ends, and an answer that comes after is ignored.
 */
export function startJob<W extends JobWorker, T>(create: () => W, boot: (worker: W) => Promise<unknown>, work: (worker: W) => Promise<T>, limitMs: number): RunningJob<T> {
  let stop!: (e: JobStopped) => void;
  const stopped = new Promise<never>((_, reject) => (stop = reject));
  // nothing may be left unhandled when the answer has already come
  stopped.catch(() => undefined);
  const worker = create();
  worker.onerror = (e) => stop(new JobStopped('crashed', e.message));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    await boot(worker);
    timer = setTimeout(() => stop(new JobStopped('time')), limitMs);
    return work(worker);
  };
  const answer = (async () => {
    try {
      return await Promise.race([run(), stopped]);
    } finally {
      clearTimeout(timer);
      worker.terminate();
    }
  })();
  return { answer, cancel: () => stop(new JobStopped('cancelled')) };
}
