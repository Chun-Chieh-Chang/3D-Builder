import { labelsOf, t } from '@3db/i18n';
import type { Feature, FeatureType, SketchConstraint } from '@3db/model';
import type { SketchStatus } from '@3db/sketch';
import type { ToolId } from './sketcher/controller';
import type { PartStage } from './worker/protocol';

/**
 * UI wording (SW 2010 Traditional Chinese terminology): the texts live in `@3db/i18n`; these tables give
 * them their shape (by feature type, tool, relation …) and read them when asked, so they follow the
 * language (D9.1).
 */

/** Where a part file is on its way in (2F): what the wait is for. STEP files are imported and named in 「重建幾何」, the longest stage. */
export const PART_STAGE_LABEL: Record<PartStage, string> = labelsOf({
  reading: 'stage.reading',
  building: 'stage.building',
  meshing: 'stage.meshing',
});

export const FEATURE_LABEL: Record<FeatureType, string> = labelsOf({
  sketch: 'feature.sketch',
  extrude: 'feature.extrude',
  revolve: 'feature.revolve',
  fillet: 'feature.fillet',
  chamfer: 'feature.chamfer',
  refPlane: 'feature.refPlane',
  importedBody: 'feature.importedBody',
  deleteFace: 'feature.deleteFace',
  moveFace: 'feature.moveFace',
  combine: 'feature.combine',
});

/** SolidWorks names cuts after what they cut with: 「除料-伸長」, 「除料-旋轉」. */
export function featureLabel(f: Feature): string {
  return (f.type === 'extrude' || f.type === 'revolve') && f.op === 'cut' ? t('feature.cut', { name: FEATURE_LABEL[f.type] }) : FEATURE_LABEL[f.type];
}

export const SKETCH_STATUS_LABEL: Record<SketchStatus, string> = labelsOf({
  fully: 'sketchStatus.fully',
  under: 'sketchStatus.under',
  over: 'sketchStatus.over',
  failed: 'sketchStatus.failed',
});

/** SolidWorks prefixes under/over-defined sketches in the FeatureManager. */
export const SKETCH_STATUS_PREFIX: Record<SketchStatus, string> = {
  fully: '',
  under: '(-) ',
  over: '(+) ',
  failed: '(?) ',
};

export const DIMENSION_LABEL: Partial<Record<SketchConstraint['type'], string>> = labelsOf({
  distance: 'dimension.distance',
  distanceX: 'dimension.distanceX',
  distanceY: 'dimension.distanceY',
  radius: 'dimension.radius',
  diameter: 'dimension.diameter',
  arcLength: 'dimension.arcLength',
  angle: 'dimension.angle',
});

/** Sketch relations (C1.26) as SolidWorks names them. */
export const RELATION_LABEL: Record<SketchConstraint['type'], string> = labelsOf({
  coincident: 'relation.coincident',
  horizontal: 'relation.horizontal',
  vertical: 'relation.vertical',
  collinear: 'relation.collinear',
  parallel: 'relation.parallel',
  perpendicular: 'relation.perpendicular',
  tangent: 'relation.tangent',
  concentric: 'relation.concentric',
  coradial: 'relation.coradial',
  intersection: 'relation.intersection',
  equal: 'relation.equal',
  midpoint: 'relation.midpoint',
  pointOnCurve: 'relation.pointOnCurve',
  symmetric: 'relation.symmetric',
  fix: 'relation.fix',
  distance: 'dimension.distance',
  distanceX: 'dimension.distanceX',
  distanceY: 'dimension.distanceY',
  radius: 'dimension.radius',
  diameter: 'dimension.diameter',
  arcLength: 'dimension.arcLength',
  angle: 'dimension.angle',
});

export const TOOL_LABEL: Record<ToolId, string> = labelsOf({
  select: 'tool.select',
  line: 'tool.line',
  centerline: 'tool.centerline',
  rect: 'tool.rect',
  centerRect: 'tool.centerRect',
  circle: 'tool.circle',
  perimeterCircle: 'tool.perimeterCircle',
  arc: 'tool.arc',
  tangentArc: 'tool.tangentArc',
  threePointArc: 'tool.threePointArc',
  point: 'tool.point',
  dimension: 'tool.dimension',
  slot: 'tool.slot',
  polygon: 'tool.polygon',
  sketchFillet: 'tool.sketchFillet',
  sketchChamfer: 'tool.sketchChamfer',
  trim: 'tool.trim',
  extend: 'tool.extend',
  offset: 'tool.offset',
  mirror: 'tool.mirror',
  convert: 'tool.convert',
  pierce: 'tool.pierce',
});

/** How a reference plane is defined (C3.2). */
export const PLANE_MODE_LABEL = labelsOf({
  offset: 'planeMode.offset',
  angle: 'planeMode.angle',
  threePoint: 'planeMode.threePoint',
});

export const DATUM_ITEMS = [
  { id: 'origin', icon: 'origin', get label() { return t('datum.origin'); } },
  { id: 'plane:front', icon: 'plane', get label() { return t('datum.front'); } },
  { id: 'plane:top', icon: 'plane', get label() { return t('datum.top'); } },
  { id: 'plane:right', icon: 'plane', get label() { return t('datum.right'); } },
] as const;
