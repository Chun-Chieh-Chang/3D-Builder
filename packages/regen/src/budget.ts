/**
 * How far a long computation in the kernel may go (handoff §0b item 2). OCCT cannot be interrupted, so this is asked between its calls: it stops a computation made of many
 * of them, and names why, in any host. One single call that never returns is out of its reach: in the app the page's job limit (`worker/job.ts`) terminates the worker for
 * that.
 */
import { t } from '@3db/i18n';
import type { Kernel } from '@3db/kernel';

export interface BudgetLimits {
  /** Wall-clock time from the start. */
  ms: number;
  /** How much the Emscripten heap may grow from the start, in bytes. */
  heapGrowth: number;
}

/** A computation went past its limit. The message is for the user. */
export class BudgetError extends Error {
  constructor(
    readonly reason: 'time' | 'memory',
    message: string,
  ) {
    super(message);
    this.name = 'BudgetError';
  }
}

export interface Budget {
  /** Throws `BudgetError` once a limit is passed. */
  check(): void;
}

/** The only true measure of the heap (AGENTS §3.1). `null` when the module has none to read: then only the time is limited. */
function heapOf(kernel: Kernel): number | null {
  const bytes = (kernel.oc as unknown as { wasmMemory?: { buffer?: { byteLength?: number } } }).wasmMemory?.buffer?.byteLength;
  return typeof bytes === 'number' && bytes > 0 ? bytes : null;
}

/** Starts counting now. Limits that are not positive and finite are refused, not corrected. */
export function startBudget(kernel: Kernel, limits: BudgetLimits): Budget {
  for (const value of [limits.ms, limits.heapGrowth]) if (!Number.isFinite(value) || value <= 0) throw new Error('budget limits must be positive and finite');
  const started = Date.now();
  const base = heapOf(kernel);
  return {
    check() {
      if (Date.now() - started > limits.ms) throw new BudgetError('time', t('job.timedOut', { seconds: Math.round(limits.ms / 1000) }));
      const now = heapOf(kernel);
      if (now !== null && base !== null && now - base > limits.heapGrowth) throw new BudgetError('memory', t('job.outOfMemory', { mb: Math.round(limits.heapGrowth / 1048576) }));
    },
  };
}

/**
 * Feature recognition's limits. 2 minutes: the real and fuzz parts measured take seconds, so this is far from a legitimate run (machine dependent: measured, not proven).
 * 512 MiB: the same figure as the app's worker restart (ADR 0126), at about 1.1 MiB per section with a B-spline (AGENTS §3.5).
 */
export const RECOGNIZE_LIMITS: BudgetLimits = { ms: 120_000, heapGrowth: 512 * 1024 * 1024 };
