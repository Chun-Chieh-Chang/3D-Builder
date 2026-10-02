import type { Translation } from '../index';

/** bom: the parts list of an assembly (C15.16). */
export const bom: Translation = {
  'bom.title': 'Bill of Materials',
  'bom.item': 'Item No.',
  'bom.name': 'Name',
  'bom.qty': 'Qty.',
  'bom.vendor': 'Vendor',
  'bom.partNo': 'Part Number',
  'bom.file': 'File',
  'bom.fileSuffix': '-BOM',
  'bom.flat': 'Parts only',
  'bom.indented': 'Indented (with sub-assemblies)',
  'bom.exportCsv': 'Export CSV',
  'bom.empty': 'The assembly has no components.',
  'bom.hint': 'Suppressed components are not listed, hidden ones are; the instances of patterns and mirrored components count. Vendor and part number come from the custom properties "Vendor" and "Part Number" in the part file properties.',
  'bom.act': 'Bill of Materials…',
  'bom.total': '{rows} lines, {qty} parts',
};