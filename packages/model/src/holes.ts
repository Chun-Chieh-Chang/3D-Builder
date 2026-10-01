/**
 * Standard hole sizes (C4.8), metric coarse threads M3 to M20: the tap drill of a threaded hole, the clearance hole (normal fit, ISO 273 medium
 * series, and close fit), the counterbore for a socket head cap screw (ISO 4762) and the countersink for a flat head screw (ISO 7046, 90°).
 * Reference values: check them against the standard of your company before relying on them. The CNS tables are the same as these.
 */
export interface HoleSize {
  name: string;
  tapDrill: number;
  close: number;
  normal: number;
  cbDiameter: number;
  cbDepth: number;
  csDiameter: number;
}

export const HOLE_STANDARD_SOURCE = 'ISO 273 / ISO 4762 / ISO 7046';

export const ISO_HOLE_SIZES: readonly HoleSize[] = [
  { name: 'M3', tapDrill: 2.5, close: 3.2, normal: 3.4, cbDiameter: 6.5, cbDepth: 3.4, csDiameter: 6.3 },
  { name: 'M4', tapDrill: 3.3, close: 4.3, normal: 4.5, cbDiameter: 8.0, cbDepth: 4.4, csDiameter: 9.4 },
  { name: 'M5', tapDrill: 4.2, close: 5.3, normal: 5.5, cbDiameter: 9.5, cbDepth: 5.4, csDiameter: 10.4 },
  { name: 'M6', tapDrill: 5.0, close: 6.4, normal: 6.6, cbDiameter: 11.0, cbDepth: 6.5, csDiameter: 12.6 },
  { name: 'M8', tapDrill: 6.8, close: 8.4, normal: 9.0, cbDiameter: 15.0, cbDepth: 8.6, csDiameter: 17.3 },
  { name: 'M10', tapDrill: 8.5, close: 10.5, normal: 11.0, cbDiameter: 18.0, cbDepth: 10.8, csDiameter: 20.0 },
  { name: 'M12', tapDrill: 10.2, close: 13.0, normal: 13.5, cbDiameter: 20.0, cbDepth: 13.0, csDiameter: 24.0 },
  { name: 'M16', tapDrill: 14.0, close: 17.0, normal: 17.5, cbDiameter: 26.0, cbDepth: 17.5, csDiameter: 30.0 },
  { name: 'M20', tapDrill: 17.5, close: 21.0, normal: 22.0, cbDiameter: 33.0, cbDepth: 21.5, csDiameter: 37.0 },
];

export const holeSize = (name: string): HoleSize | undefined => ISO_HOLE_SIZES.find((s) => s.name === name);