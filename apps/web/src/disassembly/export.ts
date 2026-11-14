import { getLocale, t } from '@3db/i18n';
import type { MeshData } from '@3db/kernel';
import type { BomRow, Pose } from '@3db/model';
import script from 'virtual:disassembly-viewer';
import template from './template.html?raw';

type MeshField = 'positions' | 'normals' | 'indices' | 'edgePoints' | 'edgeRanges';

export interface DisassemblySnapshot {
  name: string;
  meshes: Pick<MeshData, MeshField>[];
  parts: { id: string; label: string; mesh: number; item?: string; transparent: boolean }[];
  bom: Pick<BomRow, 'item' | 'name' | 'qty' | 'partNo'>[];
  stages: { name: string; poses: Record<string, Pose> }[];
}

export function disassemblyHtml({ meshes, ...snapshot }: DisassemblySnapshot): string {
  const labels = {
    title: t('export.disassemblyTitle'),
    iso: t('export.disassemblyIso'),
    bom: t('bom.title'),
    hint: t('export.disassemblyHint'),
    previous: t('export.disassemblyPrevious'),
    next: t('export.disassemblyNext'),
    assembled: t('export.disassemblyAssembled'),
    reset: t('export.disassemblyReset'),
    selection: t('export.disassemblySelection', { shown: '{shown}', total: '{total}', name: '{name}' }),
    webgl: t('export.disassemblyWebgl'),
  };
  // JSON goes inside a raw-text script element. Escape '<' before interpolation, even in names and part numbers.
  const data = JSON.stringify({ ...snapshot, locale: getLocale(), labels, meshes: meshes.map((mesh) => ({
    positions: Array.from(mesh.positions), normals: Array.from(mesh.normals), indices: Array.from(mesh.indices),
    edgePoints: Array.from(mesh.edgePoints), edgeRanges: Array.from(mesh.edgeRanges),
  })) }).replaceAll('<', '\\u003c');
  return template.replace('FIXTURE_JSON', () => data).replace('VIEWER_JS', () => script.replace(/<\/script/gi, '<\\/script'));
}
