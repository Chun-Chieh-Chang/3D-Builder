import type { ReactElement } from 'react';

type IconName = 'part' | 'assembly' | 'mates' | 'origin' | 'plane' | 'refPlane' | 'refAxis' | 'refPoint' | 'coordSys' | 'sketch' | 'extrude' | 'revolve' | 'sweep' | 'thread' | 'loft' | 'rib' | 'pattern' | 'mirror' | 'fillet' | 'chamfer' | 'importedBody' | 'derivedBody' | 'deleteFace' | 'moveFace' | 'shell' | 'draft' | 'hole' | 'combine' | 'offsetSurface' | 'splitLine' | 'knit' | 'fillSurface' | 'flatSurface' | 'trimSurface' | 'mutualTrim' | 'extendSurface' | 'thicken' | 'cutWithSurface' | 'lipGroove' | 'screwBoss' | 'baseFlange' | 'midBend' | 'edgeFlange' | 'breakCorner' | 'hem' | 'snapHook' | 'snapCatch' | 'vent' | 'body' | 'error' | 'warning' | 'ok' | 'cancel' | 'eye' | 'eyeOff';

/** Default planes and reference planes share one icon, as in SolidWorks. */
const PLANE = <path d="M4 4h10l-2 8H2z" />;

const PATHS: Record<IconName, ReactElement> = {
  part: <path d="M3 5l5-3 5 3v6l-5 3-5-3z M3 5l5 3 5-3 M8 8v6" />,
  assembly: <path d="M1.5 6l3.5-2 3.5 2v4l-3.5 2-3.5-2z M7.5 4l3.5-2 3.5 2v4l-3.5 2 M11 6v4 M8.5 6l2.5 1.5 3.5-2" />,
  mates: <path d="M2 5h5v6H2z M9 5h5v6H9z M7 8h2" />,
  origin: <path d="M8 2v12 M2 8h12 M8 8m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0" />,
  plane: PLANE,
  refPlane: PLANE,
  refAxis: <path d="M2 14L14 2 M10 2h4v4" />,
  refPoint: <path d="M8 8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M8 2v3 M8 11v3 M2 8h3 M11 8h3" />,
  coordSys: <path d="M4 12V3 M4 12h9 M4 12l5-4 M3 5l1-2 1 2 M11 11l2 1-2 1" />,
  sketch: <path d="M2 14l3-1 8-8-2-2-8 8z M10 4l2 2" />,
  extrude: <path d="M3 6h7v7H3z M3 6l3-3h7L10 6 M13 3v7l-3 3" />,
  revolve: <path d="M8 1.5v13 M3 6a5 2.5 0 1 0 10 0 M11.5 3.2l1.5 2.8-3 0.4" />,
  thread: <path d="M4 2v12 M12 2v12 M4 4l8 2 M4 7l8 2 M4 10l8 2" />,
  fillet: <path d="M3 13V3 M3 13h10 M3 7a6 6 0 0 0 6 6" />,
  chamfer: <path d="M3 13V7l4-4h6 M3 13h10V3" />,
  derivedBody: <path d="M3 5l5-3 5 3v6l-5 3-5-3z M8 5.5v5 M10.2 8.3L8 10.5 5.8 8.3" />,
  importedBody: <path d="M3 5l5-3 5 3v6l-5 3-5-3z M8 5.5v5 M5.8 8.3L8 10.5l2.2-2.2" />,
  deleteFace: <path d="M2 11l6 3 6-3V5L8 2 2 5z M5 6.5l6 4 M11 6.5l-6 4" />,
  moveFace: <path d="M3 13V6l5-3h5v7l-5 3z M8 3v7 M5.5 7.5L8 5l2.5 2.5" />,
  draft: <path d="M4 14L2 3h12l-2 11z M2 8h12" />,
  offsetSurface: <path d="M2 11c3-5 9-5 12 0 M2 6c3-5 9-5 12 0" />,
  splitLine: <path d="M2 12c3-6 9-6 12 0 M5 4l6 8" />,
  knit: <path d="M2 6c3-4 9-4 12 0 M2 11c3-4 9-4 12 0 M5 3v9 M11 3v9" />,
  fillSurface: <path d="M2 10c3-6 9-6 12 0 M4 9c2-3 6-3 8 0 M6 8h4" />,
  flatSurface: <path d="M2 11l3-6h9l-3 6z" />,
  trimSurface: <path d="M2 11c3-5 9-5 12 0 M4 3l8 10" />,
  mutualTrim: <path d="M2 11c3-5 9-5 12 0 M2 5c3 5 9 5 12 0" />,
  screwBoss: <path d="M5 13V6h6v7 M7 6V3h2v3 M2 13h12" />,
  midBend: <path d="M2 12h5l2-8h5" />,
  baseFlange: <path d="M2 12h7a4 4 0 0 0 4-4V3 M2 14h8a5 5 0 0 0 5-5V3" />,
  edgeFlange: <path d="M2 13h8 M10 13a3 3 0 0 0 3-3V3" />,
  breakCorner: <path d="M2 13h6l5-5V3 M8 13V9h4 M10 9l3 2 2-2" />,
  hem: <path d="M2 12h9a2.5 2.5 0 0 0 0-5H4" />,
  snapHook: <path d="M4 14V3h3v8h3l-3 3 M2 14h8" />,
  snapCatch: <path d="M2 3h12v10H2z M5 6h6v4H5z" />,
  vent: <path d="M3 3v10 M6.5 3v10 M10 3v10 M13.5 3v10" />,
  lipGroove: <path d="M2 12h12 M4 12V8h2v4 M10 12V8h2v4 M3 5h10" />,
  thicken: <path d="M2 7c3-4 9-4 12 0 M2 11c3-4 9-4 12 0 M2 7v4 M14 7v4" />,
  cutWithSurface: <path d="M3 4h10v8H3z M2 9c3-4 9-4 12 0" />,
  extendSurface: <path d="M2 11c3-5 6-5 8-3 M10 8l4-2 M12 6l2 0 M14 6l-1 2" />,
  sweep: <path d="M2 13c4 0 4-9 8-9h4 M2 11c4 0 4-9 8-9 M2 15c4 0 4-9 8-9" />,
  loft: <path d="M3 13h10l-2-4H5z M5 9h6l-1.5-4h-3z M6.5 5h3l-.5-3h-2z" />,
  mirror: <path d="M8 2v12 M5.5 5L2 11h3.5z M10.5 5L14 11h-3.5z" />,
  pattern: <path d="M2 9h3v4H2z M6.5 9h3v4h-3z M11 9h3v4h-3z M3.5 6V3 M8 6V3 M12.5 6V3" />,
  rib: <path d="M2 13h12 M8 13V3 M8 3h0 M5 13l3-5 3 5" />,
  hole: <path d="M2 4h12v8H2z M6 4v4h4V4 M8 8v4" />,
  shell: <path d="M2 5l6-3 6 3v6l-6 3-6-3z M5 6.5l3-1.5 3 1.5v3l-3 1.5-3-1.5z" />,
  combine: <path d="M2 6h6v6H2z M8 4h6v6H8z M8 6v4" />,
  body: <path d="M3 5l5-3 5 3v6l-5 3-5-3z M3 5l5 3 5-3 M8 8v6" />,
  error: <path d="M8 2l6.5 11h-13z M8 6v3.5 M8 11.5v0.5" />,
  warning: <path d="M8 2.5l6 10.5H2z M8 6.5v3 M8 11v0.5" />,
  ok: <path d="M3 8.5l3 3 7-7" />,
  cancel: <path d="M4 4l8 8 M12 4l-8 8" />,
  eye: <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z M8 8m-1.8 0a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0" />,
  eyeOff: <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z M2.5 13.5l11-11" />,
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
