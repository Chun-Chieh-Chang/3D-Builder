import { t } from '@3db/i18n';
import type { BomRow } from '@3db/model';

/** The columns of a parts list as a file has them, with their headings (in the user's language). */
export function bomColumns(): { heading: string; of: (r: BomRow) => string }[] {
  return [
    { heading: t('bom.item'), of: (r) => r.item },
    { heading: t('bom.name'), of: (r) => r.name },
    { heading: t('bom.qty'), of: (r) => String(r.qty) },
    { heading: t('bom.vendor'), of: (r) => r.vendor },
    { heading: t('bom.partNo'), of: (r) => r.partNo },
    { heading: t('bom.file'), of: (r) => r.path },
  ];
}

const field = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * The parts list as CSV (C15.16): a byte order mark first so that Excel reads it as UTF-8, one line for the headings and one for each row, lines ended
 * as Windows does, fields with commas, quotes or line breaks in quotes. Bytes, ready to be saved.
 */
export function bomCsv(rows: readonly BomRow[]): Uint8Array {
  const columns = bomColumns();
  const lines = [columns.map((c) => field(c.heading)).join(','), ...rows.map((r) => columns.map((c) => field(c.of(r))).join(','))];
  return new TextEncoder().encode(`﻿${lines.join('\r\n')}\r\n`);
}

/** The name a parts list file is offered under: the assembly's name and 「零件表」. */
export const bomFileName = (assemblyName: string): string => `${assemblyName.replace(/[\\/:*?"<>|]+/g, '_')}${t('bom.fileSuffix')}.csv`;
