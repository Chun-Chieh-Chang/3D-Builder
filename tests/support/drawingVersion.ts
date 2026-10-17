/**
 * A drawing file of an older schema, as a build of that version wrote it (B2.8, ADR 0154): up to v24 the document held the one sheet's set-up, the title block and the
 * drawing at its root; v25 gathers them into the first of `pages`. A test that hands `parseDrawing` an older file must hand it one of that shape — taking a file this
 * build wrote and only changing its version number is not an older file: the v25 migration looks for the sheet at the root, finds none, and the file is refused. The
 * empty lists appear only from the version that added them, so that the file is one the build of that version would really have written.
 */
import { serializeDrawing, type DrawingDoc } from '@3db/model';

export function olderDrawingFile(doc: DrawingDoc, version: number): Record<string, unknown> {
  const json = JSON.parse(serializeDrawing(doc)) as Record<string, unknown> & { pages?: Record<string, unknown>[] };
  const page = json.pages?.[0] ?? {};
  delete json.pages;
  return {
    ...json,
    schemaVersion: version,
    sheet: page.sheet,
    title: page.title,
    views: page.views,
    ...(version >= 3 ? { dimensions: page.dimensions } : {}),
    ...(version >= 4 ? { tables: page.tables } : {}),
    ...(version >= 10 ? { surfaceFinishes: page.surfaceFinishes } : {}),
    ...(version >= 12 ? { annotations: page.annotations } : {}),
  };
}
