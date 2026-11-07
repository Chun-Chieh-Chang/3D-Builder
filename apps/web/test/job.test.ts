import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobStopped, startJob, type JobWorker } from '../src/worker/job';

function fake() {
  const worker: JobWorker & { terminated: number } = {
    terminated: 0,
    onerror: null,
    terminate() {
      this.terminated++;
    },
  };
  return worker;
}
/** A promise settled by hand. */
function later<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('startJob', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('gives the answer and terminates its worker', async () => {
    const w = fake();
    await expect(startJob(() => w, async () => undefined, async () => 42, 100).answer).resolves.toBe(42);
    expect(w.terminated).toBe(1);
  });

  it('passes a refusal by the job on as it is, not as a stop', async () => {
    const w = fake();
    const refused = new Error('not the same solid');
    await expect(startJob(() => w, async () => undefined, async () => Promise.reject(refused), 100).answer).rejects.toBe(refused);
    expect(w.terminated).toBe(1);
  });

  it('does not count the loading of the kernel against the limit', async () => {
    const w = fake();
    const boot = later<void>();
    const work = vi.fn(async () => 'done');
    const job = startJob(() => w, () => boot.promise, work, 100);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(work).not.toHaveBeenCalled();
    expect(w.terminated).toBe(0);
    boot.resolve();
    await expect(job.answer).resolves.toBe('done');
  });

  it('stops on the time limit, counted from the end of the loading, and ignores a late answer', async () => {
    const w = fake();
    const work = later<string>();
    const job = startJob(() => w, async () => undefined, () => work.promise, 100);
    const outcome = job.answer.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(99);
    expect(w.terminated).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    const e = await outcome;
    expect(e).toBeInstanceOf(JobStopped);
    expect((e as JobStopped).reason).toBe('time');
    expect(w.terminated).toBe(1);
    work.resolve('too late');
    await flush();
    expect(w.terminated).toBe(1);
  });

  it('cancels at once, in the middle of the work or of the loading', async () => {
    for (const during of ['work', 'boot'] as const) {
      const w = fake();
      const pending = later<string>();
      const job = startJob(() => w, during === 'boot' ? () => pending.promise : async () => undefined, () => pending.promise, 100);
      const outcome = job.answer.catch((e: unknown) => e);
      await flush();
      job.cancel();
      const e = await outcome;
      expect(e).toBeInstanceOf(JobStopped);
      expect((e as JobStopped).reason).toBe('cancelled');
      expect(w.terminated).toBe(1);
    }
  });

  it('reports a worker that dies, with what it said', async () => {
    const w = fake();
    const job = startJob(() => w, async () => undefined, () => later<string>().promise, 100);
    const outcome = job.answer.catch((e: unknown) => e);
    await flush();
    w.onerror!({ message: 'unreachable' } as ErrorEvent);
    const e = await outcome;
    expect(e).toBeInstanceOf(JobStopped);
    expect((e as JobStopped).reason).toBe('crashed');
    expect((e as JobStopped).message).toBe('unreachable');
    expect(w.terminated).toBe(1);
  });

  it('leaves nothing running or unhandled when cancelled after it ended', async () => {
    const w = fake();
    const job = startJob(() => w, async () => undefined, async () => 1, 100);
    await job.answer;
    job.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(w.terminated).toBe(1);
  });
});
