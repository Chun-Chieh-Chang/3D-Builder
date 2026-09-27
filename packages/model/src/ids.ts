/**
 * Permanent object identifier (B1.3): unique within its document, never reused, never derived from
 * position or rebuild order. Issued ids are readable ("sketch2", "l5") because they appear inside
 * persistent names and in the diffable text format (B9.6); any other unique string is also valid.
 */
export type Id = string;

const READABLE = /^([a-z]+)(\d+)$/i;

/** Splits a readable id ("l12" → ["l", 12]); returns null for ids that do not follow the pattern. */
export function splitId(id: Id): [string, number] | null {
  const m = READABLE.exec(id);
  return m ? [m[1]!, Number(m[2])] : null;
}

/** Counters that cover every given id: prefix → highest number seen. */
export function countersFor(ids: Iterable<Id>, into: Record<string, number> = {}): Record<string, number> {
  for (const id of ids) {
    const s = splitId(id);
    if (s && s[1] > (into[s[0]] ?? 0)) into[s[0]] = s[1];
  }
  return into;
}

/**
 * Issues fresh readable ids above both the document's counters and every id still in use,
 * so ids from older files (without counters) are never handed out twice either.
 */
export class IdAllocator {
  private readonly last: Record<string, number>;

  constructor(counters: Record<string, number>, inUse: Iterable<Id>) {
    this.last = countersFor(inUse, { ...counters });
  }

  take(prefix: string): Id {
    const n = (this.last[prefix] ?? 0) + 1;
    this.last[prefix] = n;
    return `${prefix}${n}`;
  }
}
