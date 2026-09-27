import { countersFor } from './ids';
import { SCHEMA_VERSION, type PartDoc } from './schema';

/**
 * Text format of the SSOT (B9.1, B9.6): canonical JSON with sorted keys and 2-space indent,
 * so identical documents serialize byte-identically and Git diffs stay minimal.
 */
export function serializePart(doc: PartDoc): string {
  return JSON.stringify(sortKeys(doc), null, 2) + '\n';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}

type Json = Record<string, unknown>;

/** Every id in a raw (not yet validated) document: features and sketch entities/constraints. */
function rawIds(doc: Json): string[] {
  const features = Array.isArray(doc.features) ? (doc.features as Json[]) : [];
  return features.flatMap((f) => [
    f.id as string,
    ...((f.entities as Json[] | undefined) ?? []).map((e) => e.id as string),
    ...((f.constraints as Json[] | undefined) ?? []).map((c) => c.id as string),
  ]);
}

/** Forward migrations (B9.2): migrations[n] upgrades a version-n document to n+1. */
const migrations: Record<number, (doc: Json) => Json> = {
  // v2: point–line coincidence generalised to curves (pointOnCurve); horizontal/vertical also
  // between two points (line → a); id counters (B1.3).
  1: (doc) => {
    const upgrade = ({ line, ...c }: Json): Json => {
      if (c.type === 'pointOnLine') return { ...c, type: 'pointOnCurve', curve: line };
      if (c.type === 'horizontal' || c.type === 'vertical') return { ...c, a: line };
      return line === undefined ? c : { ...c, line };
    };
    const features = ((doc.features as Json[] | undefined) ?? []).map((f) =>
      f.type !== 'sketch' ? f : { ...f, constraints: ((f.constraints as Json[] | undefined) ?? []).map(upgrade) },
    );
    return { ...doc, features, idCounters: countersFor(rawIds(doc)) };
  },
};

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormatError';
  }
}

export function parsePart(text: string): PartDoc {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new FormatError('檔案不是有效的 JSON');
  }
  if (raw.kind !== 'part') throw new FormatError('不是零件文件');
  let version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new FormatError('缺少或無效的 schemaVersion');
  }
  if (version > SCHEMA_VERSION) {
    throw new FormatError(`檔案版本 ${version} 比本程式支援的 ${SCHEMA_VERSION} 新，請更新程式`);
  }
  while (version < SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) throw new FormatError(`缺少版本 ${version} 的遷移程序`);
    raw = step(raw);
    version += 1;
    raw.schemaVersion = version;
  }
  if (!Array.isArray(raw.features)) throw new FormatError('缺少特徵清單');
  // Counters cover every id in the file, even if the file was edited by hand or by a script.
  raw.idCounters = countersFor(rawIds(raw), { ...((raw.idCounters as Record<string, number> | undefined) ?? {}) });
  return raw as unknown as PartDoc;
}
