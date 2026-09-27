import type { DatumPlaneName, Vec3 } from './schema';

/** Orthonormal frame of a sketch plane: sketch (x, y) maps to origin + x·xDir + y·yDir. */
export interface PlaneFrame {
  origin: Vec3;
  xDir: Vec3;
  yDir: Vec3;
  normal: Vec3;
}

/**
 * The three default planes (C3.1), oriented like SolidWorks (Y up):
 * Front = XY (+Z normal), Top = XZ (+Y normal, sketch y → −Z), Right = YZ (+X normal, sketch x → −Z).
 */
export const DATUM_PLANES: Record<DatumPlaneName, PlaneFrame> = {
  'plane:front': { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] },
  'plane:top': { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, -1], normal: [0, 1, 0] },
  'plane:right': { origin: [0, 0, 0], xDir: [0, 0, -1], yDir: [0, 1, 0], normal: [1, 0, 0] },
};

export function isDatumPlaneName(name: string): name is DatumPlaneName {
  return name in DATUM_PLANES;
}
