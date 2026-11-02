import * as THREE from 'three';

export type P2 = [number, number];
type V3 = [number, number, number];

/** A plane in the scene: 2D (x, y) maps to origin + x·xDir + y·yDir (structural copy of the model's PlaneFrame). */
export interface PlaneFrame {
  origin: V3;
  xDir: V3;
  yDir: V3;
  normal: V3;
}

export interface OverlayCurve {
  points: P2[];
  color: number;
  dashed?: boolean;
  /**
   * `false` for what is drawn to the edges of what is on screen (the grid, the sketch's axes, ADR 0170): it is left out of 「全部顯示」. Counted, it is as
   * large as the view, so a fit takes in the whole view — and the next drawing, of the wider view, is larger again: each fit zoomed further out.
   */
  fit?: false;
}

export interface OverlayPoint {
  p: P2;
  color: number;
  /** Screen pixels. */
  size?: number;
}

export interface OverlayLabel {
  key: string;
  p: P2;
  text: string;
  /** CSS class for styling (dimension, relation, hint …). */
  className?: string;
  /** Receives clicks (reported through ViewerEvents); otherwise the label is transparent to the mouse. */
  interactive?: boolean;
  title?: string;
}

/**
 * A see-through area on the plane, drawn under the overlay's lines (G10, P3): a closed region a boss or cut can use, the one
 * the cursor is over, or the chosen ones.
 */
export interface OverlayFill {
  /** The outer boundary and the holes cut out of it, in the plane's 2D coordinates. */
  outer: P2[];
  holes: P2[][];
  color: number;
  /** 0..1. */
  opacity: number;
}

/**
 * 2D drawing on a plane, shown on top of the model (A4.2): the sketch being edited with its
 * previews, dimensions and relation symbols. Colours and layout are decided by the caller.
 */
export interface SketchOverlay {
  frame: PlaneFrame;
  curves: OverlayCurve[];
  points: OverlayPoint[];
  labels: OverlayLabel[];
  /** Areas filled under the lines, when closed regions are shown (G10, P3). */
  fills?: OverlayFill[];
}

export function toWorld(frame: PlaneFrame, p: P2): THREE.Vector3 {
  const [o, x, y] = [frame.origin, frame.xDir, frame.yDir];
  return new THREE.Vector3(o[0] + x[0] * p[0] + y[0] * p[1], o[1] + x[1] * p[0] + y[1] * p[1], o[2] + x[2] * p[0] + y[2] * p[1]);
}

/** A plane's basis as a matrix: a point (x, y, 0) maps to origin + x·xDir + y·yDir. */
function planeMatrix(frame: PlaneFrame): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...frame.xDir), new THREE.Vector3(...frame.yDir), new THREE.Vector3(...frame.normal));
  m.setPosition(new THREE.Vector3(...frame.origin));
  return m;
}

/** Lines and points of an overlay; `px` (world units per pixel) keeps dashes a constant size on screen. */
export function buildOverlayObjects(overlay: SketchOverlay, px: number): THREE.Group {
  const group = new THREE.Group();
  // A fill is see-through, and three draws every opaque object before any see-through one — so with fills present the lines and
  // points are made see-through too (at full opacity, so they look exactly as before) and put after the fills by their order.
  const layered = (overlay.fills?.length ?? 0) > 0;
  const materials = new Map<string, THREE.LineBasicMaterial>();
  const material = (color: number, dashed: boolean) => {
    const key = `${color}:${dashed}:${layered}`;
    let m = materials.get(key);
    if (!m) {
      m = dashed
        ? new THREE.LineDashedMaterial({ color, dashSize: 6 * px, gapSize: 4 * px, depthTest: false, transparent: layered })
        : new THREE.LineBasicMaterial({ color, depthTest: false, transparent: layered });
      materials.set(key, m);
    }
    return m;
  };
  const matrix = planeMatrix(overlay.frame);
  for (const f of overlay.fills ?? []) {
    if (f.outer.length < 3) continue;
    const shape = new THREE.Shape(f.outer.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const h of f.holes) if (h.length >= 3) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    const g = new THREE.ShapeGeometry(shape);
    g.applyMatrix4(matrix);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: f.color, transparent: true, opacity: f.opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    mesh.renderOrder = -1;
    group.add(mesh);
  }
  for (const c of overlay.curves) {
    if (c.points.length < 2) continue;
    const g = new THREE.BufferGeometry().setFromPoints(c.points.map((p) => toWorld(overlay.frame, p)));
    const line = new THREE.Line(g, material(c.color, c.dashed ?? false));
    if (c.dashed) line.computeLineDistances();
    if (c.fit === false) line.userData.noFit = true;
    group.add(line);
  }
  const bySize = new Map<number, OverlayPoint[]>();
  for (const p of overlay.points) bySize.set(p.size ?? 5, [...(bySize.get(p.size ?? 5) ?? []), p]);
  for (const [size, pts] of bySize) {
    const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => toWorld(overlay.frame, p.p)));
    const colors = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => new THREE.Color(p.color).toArray(colors, i * 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    group.add(new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: layered })));
  }
  return group;
}

/** What of the overlay 「全部顯示」 takes in: everything but what is drawn to the edges of the view (`OverlayCurve.fit`). */
export function overlayFitBox(group: THREE.Group): THREE.Box3 {
  const box = new THREE.Box3();
  for (const child of group.children) if (!child.userData.noFit) box.expandByObject(child);
  return box;
}

export function disposeGroup(group: THREE.Group): void {
  group.traverse((o) => {
    if ('geometry' in o && (o as { geometry?: THREE.BufferGeometry }).geometry?.dispose) {
      (o as { geometry: THREE.BufferGeometry }).geometry.dispose();
    }
    if ('material' in o && (o as { material?: THREE.Material | THREE.Material[] }).material) {
      const mat = (o as { material: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat?.dispose) mat.dispose();
    }
  });
}
