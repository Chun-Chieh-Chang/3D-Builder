import type { Feature, FeatureType, SketchConstraint } from '@3db/model';
import type { SketchStatus } from '@3db/sketch';
import type { ToolId } from './sketcher/controller';
import type { PartStage } from './worker/protocol';

/** Where a part file is on its way in (2F): what the wait is for. STEP files are imported and named in 「重建幾何」, the longest stage. */
export const PART_STAGE_LABEL: Record<PartStage, string> = {
  reading: '讀取檔案',
  building: '重建幾何（STEP 檔要匯入，較久）',
  meshing: '產生網格',
};

/** UI wording in one place (SW 2010 Traditional Chinese terminology), ready for i18n (D9.1). */
export const FEATURE_LABEL: Record<FeatureType, string> = {
  sketch: '草圖',
  extrude: '伸長',
  revolve: '旋轉',
  fillet: '圓角',
  chamfer: '導角',
  refPlane: '基準面',
  importedBody: '輸入本體',
};

/** SolidWorks names cuts after what they cut with: 「除料-伸長」, 「除料-旋轉」. */
export function featureLabel(f: Feature): string {
  return (f.type === 'extrude' || f.type === 'revolve') && f.op === 'cut' ? `除料-${FEATURE_LABEL[f.type]}` : FEATURE_LABEL[f.type];
}

export const SKETCH_STATUS_LABEL: Record<SketchStatus, string> = {
  fully: '完全定義',
  under: '定義不足',
  over: '過多定義',
  failed: '無法求解',
};

/** SolidWorks prefixes under/over-defined sketches in the FeatureManager. */
export const SKETCH_STATUS_PREFIX: Record<SketchStatus, string> = {
  fully: '',
  under: '(-) ',
  over: '(+) ',
  failed: '(?) ',
};

export const DIMENSION_LABEL: Partial<Record<SketchConstraint['type'], string>> = {
  distance: '距離',
  distanceX: '水平距離',
  distanceY: '垂直距離',
  radius: '半徑',
  diameter: '直徑',
  angle: '角度',
};

/** Sketch relations (C1.26) as SolidWorks names them. */
export const RELATION_LABEL: Record<SketchConstraint['type'], string> = {
  coincident: '重合',
  horizontal: '水平',
  vertical: '垂直',
  collinear: '共線',
  parallel: '平行',
  perpendicular: '互相垂直',
  tangent: '相切',
  concentric: '同心',
  equal: '相等',
  midpoint: '中點',
  pointOnCurve: '重合',
  symmetric: '對稱',
  fix: '固定',
  distance: '距離',
  distanceX: '水平距離',
  distanceY: '垂直距離',
  radius: '半徑',
  diameter: '直徑',
  angle: '角度',
};

export const TOOL_LABEL: Record<ToolId, string> = {
  select: '選取',
  line: '直線',
  centerline: '中心線',
  rect: '邊角矩形',
  centerRect: '中心矩形',
  circle: '圓',
  perimeterCircle: '周邊圓',
  arc: '中心點圓弧',
  tangentArc: '切線弧',
  threePointArc: '三點定弧',
  point: '點',
  dimension: '智慧型尺寸',
};

/** How a reference plane is defined (C3.2). */
export const PLANE_MODE_LABEL = {
  offset: '偏移距離',
  angle: '角度',
  threePoint: '三點',
} as const;

export const DATUM_ITEMS = [
  { id: 'origin', label: '原點', icon: 'origin' },
  { id: 'plane:front', label: '前基準面', icon: 'plane' },
  { id: 'plane:top', label: '上基準面', icon: 'plane' },
  { id: 'plane:right', label: '右基準面', icon: 'plane' },
] as const;
