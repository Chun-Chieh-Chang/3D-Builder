import { countersFor } from './ids';
import { ASSEMBLY_SCHEMA_VERSION, SCHEMA_VERSION, type AssemblyDoc, type PartDoc } from './schema';

/**
 * Text format of the SSOT (B9.1, B9.6): canonical JSON with sorted keys and 2-space indent,
 * so identical documents serialize byte-identically and Git diffs stay minimal.
 */
export function serializePart(doc: PartDoc): string {
  return canonical(doc);
}

export function serializeAssembly(doc: AssemblyDoc): string {
  return canonical(doc);
}

const canonical = (doc: object) => JSON.stringify(sortKeys(doc), null, 2) + '\n';

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

/** Every id in a raw (not yet validated) document: features, sketch entities/constraints, blobs. */
function rawIds(doc: Json): string[] {
  const features = Array.isArray(doc.features) ? (doc.features as Json[]) : [];
  const blobs = Array.isArray(doc.blobs) ? (doc.blobs as Json[]) : [];
  return [
    ...features.flatMap((f) => [
      f.id as string,
      ...((f.entities as Json[] | undefined) ?? []).map((e) => e.id as string),
      ...((f.constraints as Json[] | undefined) ?? []).map((c) => c.id as string),
    ]),
    ...blobs.map((b) => b.id as string),
  ];
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
  // v3: revolve and chamfer features. Nothing to convert; the version keeps older programs from
  // opening documents with feature types they do not know.
  2: (doc) => doc,
  // v4: reference planes (C3.2). Nothing to convert, as for v3.
  3: (doc) => doc,
  // v5: imported bodies (F2.1) and their data in `blobs`. Nothing to convert.
  4: (doc) => doc,
  // v6: angle dimensions may measure another sector between their lines (`flip`). Nothing to convert:
  // an angle without `flip` keeps its meaning, and older programs must not open a `flip` they ignore.
  5: (doc) => doc,
  // v7: what is shown or hidden (D4.6) is stored in `visibility`. A version-6 document has no choices,
  // so everything is at its default.
  6: (doc) => ({ ...doc, visibility: {} }),
  // v8: values are expressions: variables (`variables`), other dimensions, file properties (B5.2, B5.3). Nothing to
  // convert: a plain number is still an expression. The version keeps older programs from opening a
  // document whose values they would not understand.
  7: (doc) => doc,
  // v9: direct editing of a body's faces (C10.1, C10.2): `deleteFace` and `moveFace` features. Nothing to convert;
  // the version keeps older programs from opening features they would skip.
  8: (doc) => doc,
  // v10: several bodies in a part (C7): `bodies` holds their names and reference flags, `merge` the way a boss joins
  // them, and there is a `combine` feature. A version-9 part has one body whatever it does: nothing to convert.
  9: (doc) => ({ ...doc, bodies: {} }),
  // v11: sketch relations `coradial` and `intersection` and the `arcLength` dimension (C1.26, C1.28). Nothing to convert; the version
  // keeps older programs from opening a sketch whose relations they would not know.
  10: (doc) => doc,
  // v12: a boss or cut may use only some of its sketch's contours (`contours`, C1.34). Without it a feature uses them all, as before: nothing to
  // convert. The version keeps older programs from extruding every contour of a feature that chose some.
  11: (doc) => doc,
  // v13: sketch entities may be projections of model edges (`ref`) and points may be where an edge pierces the sketch plane (`pierce`)
  // (C1.18, C1.26). Nothing to convert; the version keeps older programs from reading such an entity as a plain one that ignores the model.
  12: (doc) => doc,
  // v14: more end conditions, a second direction, draft and thin features (C4.1–C4.3). Nothing to convert; the version keeps older programs from
  // building such a feature as a plain extrusion.
  13: (doc) => doc,
  // v15: the shell feature (C5.4). Nothing to convert; the version keeps older programs from opening a part with a feature they would skip.
  14: (doc) => doc,
  // v16: the draft feature (C5.5). Nothing to convert; the version keeps older programs from opening a part with a feature they would skip.
  15: (doc) => doc,
  // v17: the hole wizard (C4.8). Nothing to convert; the version keeps older programs from opening a part with a feature they would skip.
  16: (doc) => doc,
  // v18: the sweep (C4.4). Nothing to convert; the version keeps older programs from opening a part with a feature they would skip.
  17: (doc) => doc,
  // v19: the loft (C4.5). Nothing to convert; the version keeps older programs from opening a part with a feature they would skip.
  18: (doc) => doc,
  // v20: the rib (C4.7). Nothing to convert; the version keeps older programs from opening a part with a feature they would skip.
  19: (doc) => doc,
  // v21: reference axes, points and coordinate systems and the other reference planes (C3.2–C3.5). Nothing to convert; the version keeps older programs
  // from opening a part with a feature they would skip.
  20: (doc) => doc,
  // v22: the pattern (C6.1, C6.2). Nothing to convert; the version keeps older programs from opening a part with a feature they would skip.
  21: (doc) => doc,
  // v23: the mirror (C6.3). Nothing to convert; the version keeps older programs from opening a part with a feature they would skip.
  22: (doc) => doc,
  // v24: material and document settings (C14.1, B8.4), absent until chosen, and the targets of appearances (C14.2). Nothing to convert: no earlier
  // version could store an appearance.
  23: (doc) => doc,
};

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormatError';
  }
}

function parseJson(text: string): Json {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FormatError('檔案不是有效的 JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FormatError('檔案不是 3D-Builder 文件');
  return raw as Json;
}

/** Brings a document of an older version up to `current` (B9.2); newer versions are refused. */
function upgrade(raw: Json, current: number, steps: Record<number, (doc: Json) => Json>): Json {
  let version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new FormatError('缺少或無效的 schemaVersion');
  }
  if (version > current) {
    throw new FormatError(`檔案版本 ${version} 比本程式支援的 ${current} 新，請更新程式`);
  }
  while (version < current) {
    const step = steps[version];
    if (!step) throw new FormatError(`缺少版本 ${version} 的遷移程序`);
    raw = step(raw);
    version += 1;
    raw.schemaVersion = version;
  }
  return raw;
}

/** What a document text holds, from its `kind`, without checking the rest. */
export function documentKind(text: string): 'part' | 'assembly' {
  const kind = parseJson(text).kind;
  if (kind === 'part' || kind === 'assembly') return kind;
  throw new FormatError('不是 3D-Builder 文件（不明的文件類型）');
}

export function parsePart(text: string): PartDoc {
  let raw = parseJson(text);
  if (raw.kind !== 'part') throw new FormatError('不是零件文件');
  raw = upgrade(raw, SCHEMA_VERSION, migrations);
  if (!Array.isArray(raw.features)) throw new FormatError('缺少特徵清單');
  // Counters cover every id in the file, even if the file was edited by hand or by a script.
  raw.idCounters = countersFor(rawIds(raw), { ...((raw.idCounters as Record<string, number> | undefined) ?? {}) });
  return raw as unknown as PartDoc;
}

/** Forward migrations of assemblies (B9.2): assemblyMigrations[n] upgrades version n to n+1. */
const assemblyMigrations: Record<number, (doc: Json) => Json> = {
  // v2: mates (C15.8). A version-1 assembly has none.
  1: (doc) => ({ ...doc, mates: [] }),
};

export function parseAssembly(text: string): AssemblyDoc {
  let raw = parseJson(text);
  if (raw.kind !== 'assembly') throw new FormatError('不是組合件文件');
  raw = upgrade(raw, ASSEMBLY_SCHEMA_VERSION, assemblyMigrations);
  if (!Array.isArray(raw.files) || !Array.isArray(raw.components)) throw new FormatError('缺少零組件清單');
  if (!Array.isArray(raw.mates)) throw new FormatError('缺少結合清單');
  const ids = [...(raw.files as Json[]), ...(raw.components as Json[]), ...(raw.mates as Json[])].map((x) => x.id as string);
  // As for parts: counters cover every id in the file, even one edited by hand or by a script.
  raw.idCounters = countersFor(ids, { ...((raw.idCounters as Record<string, number> | undefined) ?? {}) });
  raw.properties ??= {};
  return raw as unknown as AssemblyDoc;
}
