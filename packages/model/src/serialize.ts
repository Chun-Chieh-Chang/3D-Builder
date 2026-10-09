import { t } from '@3db/i18n';
import { countersFor } from './ids';
import { DRAWING_SCHEMA_VERSION, type DrawingDoc } from './drawing';
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

export function serializeDrawing(doc: DrawingDoc): string {
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
  // v25: comment, tag and folder on a feature (D1.7), all optional. Nothing to convert.
  24: (doc) => doc,
  // v26: the derived body (C7.5), a body of another part file. Nothing to convert; the version keeps older programs from opening a part with a feature they would skip.
  25: (doc) => doc,
  // v27: the dowel pin hole (C4.8): `kind: 'dowel'` with a fit and an entrance chamfer. Nothing to convert; the version keeps older programs from opening a part with a hole they would make wrongly.
  26: (doc) => doc,
  // v28: the offset surface feature (C9.2, Phase 4b) and surface bodies (bodies with no solid). Nothing to convert; the version keeps older programs from opening a feature they would skip.
  27: (doc) => doc,
  // v29: the split line feature (C8.1, Phase 4b). Nothing to convert; the version keeps older programs from opening a feature they would skip.
  28: (doc) => doc,
  // v30: knit, fill, flat, trim and extend surface (C9.2, C9.3, Phase 4b). Nothing to convert; the version keeps older programs from opening features they would skip.
  29: (doc) => doc,
  // v31: thicken and cut with surface (C9.4, Phase 4b). Nothing to convert; the version keeps older programs from opening features they would skip.
  30: (doc) => doc,
  // v32: walls of another thickness on a shell (C5.4, Phase 6). Nothing to convert; the version keeps older programs from opening a shell they would make evenly.
  31: (doc) => doc,
  // v33: the lip and groove feature (C4.11, Phase 6). Nothing to convert; the version keeps older programs from opening a feature they would skip.
  32: (doc) => doc,
  // v34: the screw boss (C4.11, Phase 6). Nothing to convert; the version keeps older programs from opening a feature they would skip.
  33: (doc) => doc,
  // v35: the snap hook, its catch window and the vent (C4.11, Phase 6). Nothing to convert; the version keeps older programs from opening a feature they would skip.
  34: (doc) => doc,
  // v36: the base flange of a sheet metal part (C11.1, Phase 7). Nothing to convert; the version keeps older programs from opening a feature they would skip.
  35: (doc) => doc,
  // v37: the edge flange (C11.2, Phase 7). Nothing to convert; the version keeps older programs from opening a feature they would skip.
  36: (doc) => doc,
  // v38: the hem (C11.2, Phase 7). Nothing to convert; the version keeps older programs from opening a feature they would skip.
  37: (doc) => doc,
  // v39: insets and reliefs on the edge flange and the hem (C11.4, Phase 7). Nothing to convert; the version keeps older programs from opening what they would make too wide.
  38: (doc) => doc,
  // v40: the gauge table of a sheet metal part (C11.1, Phase 7). Absent until a row is added; nothing to convert.
  39: (doc) => doc,
  // v41: the draft of the pilot hole of a screw boss (C4.11, hardening H-4). Absent means a straight hole, as before; nothing to convert.
  40: (doc) => doc,
  // v42: the closed corner of the edge flange (C11.4, hardening). Absent means an open corner, as before; nothing to convert.
  41: (doc) => doc,
  // v43: faces of a fillet or a chamfer (fillet and chamfer by face). Absent until a face is picked; nothing to convert.
  42: (doc) => doc,
  // v44: the window under a snap hook (`windowClearance`, `windowDepth`). Absent means no window, as before; nothing to convert.
  43: (doc) => doc,
  // v45: thicken on both sides, and keeping the surface (`both`, `keepSurface`). Absent means as before; nothing to convert.
  44: (doc) => doc,
  // v46: the mutual trim of two surface bodies (`mutualTrim`). A new kind of feature; nothing to convert, the version keeps older programs from opening what they would skip.
  45: (doc) => doc,
  // v47: the mitre of the edge flange (`miter`). Absent means an open corner, as before; nothing to convert.
  46: (doc) => doc,
  // v48: the mid bend of a plate (`midBend`). A new kind of feature; nothing to convert.
  47: (doc) => doc,
  // v49: the pictures of a sketch (`pictures`, and blobs of kind png or jpg). Absent means none, as before; nothing to convert.
  48: (doc) => doc,
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
    throw new FormatError(t('format.notJson'));
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FormatError(t('format.notDocument'));
  return raw as Json;
}

/** Brings a document of an older version up to `current` (B9.2); newer versions are refused. */
function upgrade(raw: Json, current: number, steps: Record<number, (doc: Json) => Json>): Json {
  let version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new FormatError(t('format.noVersion'));
  }
  if (version > current) {
    throw new FormatError(t('format.newer', { version, current }));
  }
  while (version < current) {
    const step = steps[version];
    if (!step) throw new FormatError(t('format.noMigration', { version }));
    raw = step(raw);
    version += 1;
    raw.schemaVersion = version;
  }
  return raw;
}

/** What a document text holds, from its `kind`, without checking the rest. */
export function documentKind(text: string): 'part' | 'assembly' | 'drawing' {
  const kind = parseJson(text).kind;
  if (kind === 'part' || kind === 'assembly' || kind === 'drawing') return kind;
  throw new FormatError(t('format.unknownKind'));
}

export function parsePart(text: string): PartDoc {
  let raw = parseJson(text);
  if (raw.kind !== 'part') throw new FormatError(t('format.notPart'));
  raw = upgrade(raw, SCHEMA_VERSION, migrations);
  if (!Array.isArray(raw.features)) throw new FormatError(t('format.noFeatures'));
  // Counters cover every id in the file, even if the file was edited by hand or by a script.
  raw.idCounters = countersFor(rawIds(raw), { ...((raw.idCounters as Record<string, number> | undefined) ?? {}) });
  return raw as unknown as PartDoc;
}

/** Forward migrations of assemblies (B9.2): assemblyMigrations[n] upgrades version n to n+1. */
const assemblyMigrations: Record<number, (doc: Json) => Json> = {
  // v2: mates (C15.8). A version-1 assembly has none.
  1: (doc) => ({ ...doc, mates: [] }),
  // v3: sub-assemblies (C15.4, `MateRef.path`) and component flags (C15.5). All optional, so nothing in a version-2 file changes.
  2: (doc) => doc,
  // v4: patterns and mirrors of components (C15.13): an optional list, absent in older files.
  3: (doc) => doc,
  // v5: the steps of the exploded view (C15.14): an optional list, absent in older files.
  4: (doc) => doc,
  // v6: width and symmetric mates (`Mate.more`) and limits (`Mate.min`, `Mate.max`, C15.9): optional, absent in older files.
  5: (doc) => doc,
  // v7: several exploded views (C15.14): the one list of steps `explosion` is the first of `explosions`, and the active one.
  6: (doc) => {
    const { explosion, ...rest } = doc as { explosion?: Json[] } & Json;
    return Array.isArray(explosion) && explosion.length > 0 ? { ...rest, explosions: [{ id: 'explosion1', name: t('explode.viewName', { n: 1 }), steps: explosion }], activeExplosion: 'explosion1' } : rest;
  },
};

export function parseAssembly(text: string): AssemblyDoc {
  let raw = parseJson(text);
  if (raw.kind !== 'assembly') throw new FormatError(t('format.notAssembly'));
  raw = upgrade(raw, ASSEMBLY_SCHEMA_VERSION, assemblyMigrations);
  if (!Array.isArray(raw.files) || !Array.isArray(raw.components)) throw new FormatError(t('format.noComponents'));
  if (!Array.isArray(raw.mates)) throw new FormatError(t('format.noMates'));
  const ids = [...(raw.files as Json[]), ...(raw.components as Json[]), ...(raw.mates as Json[]), ...((raw.patterns as Json[] | undefined) ?? []), ...((raw.explosions as { id: string; steps?: Json[] }[] | undefined) ?? []).flatMap((v) => [v as Json, ...(v.steps ?? [])])].map((x) => x.id as string);
  // As for parts: counters cover every id in the file, even one edited by hand or by a script.
  raw.idCounters = countersFor(ids, { ...((raw.idCounters as Record<string, number> | undefined) ?? {}) });
  raw.properties ??= {};
  return raw as unknown as AssemblyDoc;
}

/** Forward migrations of drawings (B9.2): drawingMigrations[n] upgrades version n to n+1. 1 → 2 added the projected, section and detail kinds of view (a version-1 view is a model view as it is); 2 → 3 added the dimensions; 3 → 4 the tables; 4 → 5 the angle dimension; 5 → 6 the flat pattern; 6 → 7 the shift and the slide of views; 7 → 8 the text and the place of a dimension. */
const drawingMigrations: Record<number, (doc: Json) => Json> = {
  // v2: projected, section and detail views (C16.3), each with its own fields; a version-1 drawing has only the views of a model. Nothing to convert.
  1: (doc) => doc,
  // v3: dimensions (C16.4): a list, empty in an older file.
  2: (doc) => ({ ...doc, dimensions: doc.dimensions ?? [] }),
  // v4: tables (C16.6) and the centre marks of a view (`centre`): a list, empty in an older file.
  3: (doc) => ({ ...doc, tables: doc.tables ?? [] }),
  // v5: the angle dimension (C16.4). A new kind of dimension; nothing to convert, the version keeps older programs from opening what they would not know how to draw.
  4: (doc) => doc,
  // v6: the flat pattern of a sheet metal part as a view (`direction: 'flat'`).
  5: (doc) => doc,
  // v7: the shift of the arrangement of views (`sheet.shift`) and the slide of a view along its line (`slide`): both optional, nothing to convert; the version keeps older programs
  // from opening a drawing whose views they would put in the wrong place.
  6: (doc) => doc,
  // v8: how a dimension's text is written (`precision`, `prefix`, `suffix`, `text`) and where it is drawn (`slide`, `leader`): all optional, nothing to convert.
  7: (doc) => doc,
};

export function parseDrawing(text: string): DrawingDoc {
  let raw = parseJson(text);
  if (raw.kind !== 'drawing') throw new FormatError(t('format.notDrawing'));
  raw = upgrade(raw, DRAWING_SCHEMA_VERSION, drawingMigrations);
  if (!Array.isArray(raw.views) || !raw.sheet || typeof raw.sheet !== 'object') throw new FormatError(t('format.noViews'));
  raw.dimensions ??= [];
  raw.tables ??= [];
  const ids = [...(raw.views as Json[]), ...(raw.dimensions as Json[]), ...(raw.tables as Json[])].map((v) => v.id as string);
  // As for parts: counters cover every id in the file, even one edited by hand or by a script.
  raw.idCounters = countersFor(ids, { ...((raw.idCounters as Record<string, number> | undefined) ?? {}) });
  raw.properties ??= {};
  raw.title ??= {};
  return raw as unknown as DrawingDoc;
}

