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

/** Forward migrations (B9.2): migrations[n] upgrades a version-n document to n+1. */
const migrations: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

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
  return raw as unknown as PartDoc;
}
