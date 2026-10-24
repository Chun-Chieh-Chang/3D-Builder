import { lookupThread } from './threadStandards';

/** Supported specification annotations, not geometric limit calculations. No default is invented. */
export function threadToleranceClasses(designation: string | undefined, type: 'internal' | 'external'): readonly string[] {
  if (!designation || !lookupThread(designation)) return [];
  if (designation && /^M\d/.test(designation)) return type === 'internal' ? ['4H', '5H', '6H', '7H'] : ['4g', '5g', '6g', '6h'];
  if (designation && /\bUN(?:C|F|EF)?\b/i.test(designation)) return type === 'internal' ? ['1B', '2B', '3B'] : ['1A', '2A', '3A'];
  return [];
}

export const validThreadTolerance = (value: unknown, designation: string | undefined, type: 'internal' | 'external'): boolean =>
  value === undefined || (typeof value === 'string' && threadToleranceClasses(designation, type).includes(value));
