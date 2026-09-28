import * as THREE from 'three';
import { ViewControls } from './controls';
import { buildOverlayObjects, disposeGroup, toWorld, type P2, type PlaneFrame, type SketchOverlay } from './overlay';

/** Mesh payload produced by the kernel worker (same layout as @3db/kernel MeshData). */
export interface ViewMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faceRanges: Int32Array;
  edgePoints: Float32Array;
  edgeRanges: Int32Array;
}

export type StandardView = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'iso';

const VIEW_DIRS: Record<StandardView, [THREE.Vector3, THREE.Vector3]> = {
  front: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
  back: [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
  top: [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1)],
  bottom: [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1)],
  left: [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
  right: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
  iso: [new THREE.Vector3(1, 1, 1).normalize(), new THREE.Vector3(0, 1, 0)],
};

const COLORS = {
  body: 0xb8c4d0,
  edge: 0x1d232b,
  edgeHover: 0xf08c00,
  edgeSelected: 0x1864ab,
  background: 0xf3f5f8,
};

/** A reference plane to show (D4.6): drawn as a translucent square around the model. */
export interface PlaneDisplay {
  key: string;
  frame: PlaneFrame;
  highlighted?: boolean;
}

/** Pointer input on the graphics area while a tool (e.g. a sketch tool) owns the left button. */
export interface ToolPointerEvent {
  type: 'down' | 'move' | 'up' | 'dblclick' | 'leave';
  clientX: number;
  clientY: number;
  ctrl: boolean;
  shift: boolean;
  /** Left button held (for moves). */
  pressed: boolean;
}

export interface ViewerEvents {
  /** Edge under the cursor changed (index into the mesh's edges, or -1). */
  onEdgeHover?: (edge: number) => void;
  /** Left click on an edge (or -1 on empty space / faces). */
  onEdgeClick?: (edge: number, additive: boolean) => void;
  /** Face under the cursor changed (index into the mesh's faces, or -1). */
  onFaceHover?: (face: number) => void;
  /** Left click on a face (or -1 on empty space). */
  onFaceClick?: (face: number, additive: boolean) => void;
  /** Vertex under the cursor changed (index into the vertices given to setVertices, or -1). */
  onVertexHover?: (vertex: number) => void;
  onVertexClick?: (vertex: number, additive: boolean) => void;
  /** The camera moved, zoomed or the viewport was resized (screen-sized overlays need a new layout). */
  onViewChange?: () => void;
  onLabelClick?: (key: string, additive: boolean) => void;
  onLabelDoubleClick?: (key: string) => void;
}

/**
 * Framework-agnostic viewport (A4.2, A5.1, D4): shaded body with black edges, orthographic
 * camera like SolidWorks, a headlight, edge picking and highlighting, a reference triad, and an
 * on-top 2D overlay for the sketch being edited.
 */
export class Viewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly overlayScene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly controls: ViewControls;
  private readonly triadScene = new THREE.Scene();
  private readonly triadCamera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
  private readonly labelLayer: HTMLDivElement;
  private body: THREE.Mesh | null = null;
  private edges: THREE.LineSegments | null = null;
  /** segmentEdge[s] = edge index owning line segment s. */
  private segmentEdge = new Int32Array(0);
  private hovered = -1;
  private selected = new Set<number>();
  private pickEdges = false;
  private pickFaces = false;
  private mesh: ViewMesh | null = null;
  /** triangleFace[t] = face index owning triangle t. */
  private triangleFace = new Int32Array(0);
  private hoveredFace = -1;
  private selectedFaces = new Set<number>();
  private faceHighlight: THREE.Mesh | null = null;
  private pickVertices = false;
  /** Model vertices, xyz per vertex (for picking and highlighting). */
  private vertices: Float32Array = new Float32Array(0);
  private hoveredVertex = -1;
  private selectedVertices = new Set<number>();
  private vertexHighlight: THREE.Points | null = null;
  private planes: PlaneDisplay[] = [];
  private planeGroup: THREE.Group | null = null;
  private overlay: SketchOverlay | null = null;
  private overlayGroup: THREE.Group | null = null;
  private labels = new Map<string, { el: HTMLElement; world: THREE.Vector3 }>();
  private toolHandler: ((e: ToolPointerEvent) => void) | null = null;
  private pendingFit = false;
  private frame = 0;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    private readonly events: ViewerEvents = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(COLORS.background);
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'overlay-labels';
    container.appendChild(this.labelLayer);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e5, 1e5);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const headlight = new THREE.DirectionalLight(0xffffff, 1.8);
    headlight.position.set(0.3, 0.4, 1);
    this.camera.add(headlight);
    this.scene.add(this.camera);
    this.buildTriad();

    this.controls = new ViewControls(this.camera, this.renderer.domElement, () => this.viewChanged());
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointerleave', this.onPointerLeave);
    dom.addEventListener('click', this.onClick);
    dom.addEventListener('dblclick', this.onDoubleClick);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.setView('iso');
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clear();
    this.setOverlay(null);
    this.setPlanes([]);
    this.setVertices(new Float32Array(0));
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }

  // ---------------------------------------------------------------- content

  setMesh(mesh: ViewMesh | null, fit = false): void {
    this.clear();
    if (mesh) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
      g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      const material = new THREE.MeshStandardMaterial({
        color: COLORS.body,
        metalness: 0.15,
        roughness: 0.55,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      this.body = new THREE.Mesh(g, material);
      this.scene.add(this.body);
      this.buildEdges(mesh);
      const owner = new Int32Array(mesh.indices.length / 3);
      for (let r = 0; r < mesh.faceRanges.length; r += 3) owner.fill(mesh.faceRanges[r + 2]!, mesh.faceRanges[r]! / 3, (mesh.faceRanges[r]! + mesh.faceRanges[r + 1]!) / 3);
      this.triangleFace = owner;
    }
    this.mesh = mesh;
    this.hovered = -1;
    this.hoveredFace = -1;
    this.selected.clear();
    this.selectedFaces.clear();
    this.paintFaces();
    if (this.planes.length > 0) this.paintPlanes(); // sized to the body
    if (fit) this.fitAll();
    this.requestRender();
  }

  private buildEdges(mesh: ViewMesh): void {
    const segs: number[] = [];
    const owner: number[] = [];
    for (let g = 0; g < mesh.edgeRanges.length; g += 3) {
      const start = mesh.edgeRanges[g]!;
      const count = mesh.edgeRanges[g + 1]!;
      const edge = mesh.edgeRanges[g + 2]!;
      for (let p = start; p < start + count - 1; p++) {
        segs.push(...mesh.edgePoints.subarray(p * 3, p * 3 + 6));
        owner.push(edge);
      }
    }
    this.segmentEdge = Int32Array.from(owner);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    const colors = new Float32Array((segs.length / 3) * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.edges = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.scene.add(this.edges);
    this.paintEdges();
  }

  private clear(): void {
    for (const obj of [this.body, this.edges]) {
      if (!obj) continue;
      this.scene.remove(obj);
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
    this.body = null;
    this.edges = null;
  }

  // ---------------------------------------------------------------- 2D overlay (sketch editing)

  /** Replaces the overlay; labels keep their DOM nodes by key so edits in progress are not disturbed. */
  setOverlay(overlay: SketchOverlay | null): void {
    if (this.overlayGroup) {
      this.overlayScene.remove(this.overlayGroup);
      disposeGroup(this.overlayGroup);
      this.overlayGroup = null;
    }
    this.overlay = overlay;
    if (overlay) {
      this.overlayGroup = buildOverlayObjects(overlay, this.pixelSize());
      this.overlayScene.add(this.overlayGroup);
    }
    const keep = new Set<string>();
    for (const l of overlay?.labels ?? []) {
      keep.add(l.key);
      let entry = this.labels.get(l.key);
      if (!entry) {
        const el = document.createElement('div');
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        el.addEventListener('click', (e) => this.events.onLabelClick?.(l.key, e.ctrlKey || e.shiftKey));
        el.addEventListener('dblclick', () => this.events.onLabelDoubleClick?.(l.key));
        this.labelLayer.appendChild(el);
        entry = { el, world: new THREE.Vector3() };
        this.labels.set(l.key, entry);
      }
      entry.world.copy(toWorld(overlay!.frame, l.p));
      entry.el.className = `overlay-label ${l.className ?? ''} ${l.interactive ? 'interactive' : ''}`;
      if (entry.el.textContent !== l.text) entry.el.textContent = l.text;
      entry.el.title = l.title ?? '';
    }
    for (const [key, entry] of this.labels) {
      if (keep.has(key)) continue;
      entry.el.remove();
      this.labels.delete(key);
    }
    this.requestRender();
  }

  /** Routes left-button input to a tool instead of edge picking (null restores normal selection). */
  setToolHandler(handler: ((e: ToolPointerEvent) => void) | null): void {
    this.toolHandler = handler;
    if (handler) this.setHovered(-1);
  }

  /** Size of one screen pixel in world units (orthographic camera). */
  pixelSize(): number {
    return (this.camera.right - this.camera.left) / this.camera.zoom / this.canvasSize().w;
  }

  /** The drawing surface in CSS pixels: every screen↔world conversion uses this one size. */
  private canvasSize(): { w: number; h: number } {
    const el = this.renderer.domElement;
    return { w: el.clientWidth || 1, h: el.clientHeight || 1 };
  }

  /** Where a screen position hits a plane, in the plane's 2D coordinates; null if the view is edge-on. */
  planePoint(clientX: number, clientY: number, frame: PlaneFrame): P2 | null {
    const ray = this.rayAt(clientX, clientY);
    const n = new THREE.Vector3(...frame.normal);
    const o = new THREE.Vector3(...frame.origin);
    const denom = ray.direction.dot(n);
    if (Math.abs(denom) < 1e-9) return null;
    const t = o.clone().sub(ray.origin).dot(n) / denom;
    const w = ray.origin.clone().addScaledVector(ray.direction, t).sub(o);
    return [w.dot(new THREE.Vector3(...frame.xDir)), w.dot(new THREE.Vector3(...frame.yDir))];
  }

  /** Screen position (relative to the viewport) of a point on a plane. */
  screenOf(frame: PlaneFrame, p: P2): { x: number; y: number } {
    this.syncCamera();
    const v = toWorld(frame, p).project(this.camera);
    const { w, h } = this.canvasSize();
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  /**
   * three.js refreshes camera matrices only when it renders. Screen↔world conversions can run
   * between a view change and the next frame (a click right after zooming or 「正視於」), so
   * they bring the matrices up to date themselves.
   */
  private syncCamera(): void {
    this.camera.updateMatrixWorld();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
  }

  private rayAt(clientX: number, clientY: number): THREE.Ray {
    this.syncCamera();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const caster = new THREE.Raycaster();
    caster.setFromCamera(ndc, this.camera);
    return caster.ray;
  }

  // ---------------------------------------------------------------- selection

  /** Enables edge hover/click picking (e.g. while a fillet's edge list is active). */
  setEdgePicking(enabled: boolean): void {
    this.pickEdges = enabled;
    if (!enabled) this.setHovered(-1);
  }

  /** Enables face hover/click picking (selecting a face to sketch on, an end face …). */
  setFacePicking(enabled: boolean): void {
    this.pickFaces = enabled;
    if (!enabled) this.setHoveredFace(-1);
  }

  setSelectedFaces(faces: Iterable<number>): void {
    this.selectedFaces = new Set(faces);
    this.paintFaces();
  }

  private setHoveredFace(face: number): void {
    if (face === this.hoveredFace) return;
    this.hoveredFace = face;
    this.paintFaces();
    this.events.onFaceHover?.(face);
  }

  /** Translucent copies of the hovered and selected faces' triangles, drawn over the body. */
  private paintFaces(): void {
    if (this.faceHighlight) {
      this.scene.remove(this.faceHighlight);
      this.faceHighlight.geometry.dispose();
      (this.faceHighlight.material as THREE.Material).dispose();
      this.faceHighlight = null;
    }
    const mesh = this.mesh;
    const faces = new Map<number, THREE.Color>();
    for (const f of this.selectedFaces) faces.set(f, new THREE.Color(COLORS.edgeSelected));
    if (this.hoveredFace >= 0) faces.set(this.hoveredFace, new THREE.Color(COLORS.edgeHover));
    if (mesh && faces.size > 0) {
      const positions: number[] = [];
      const colors: number[] = [];
      for (let r = 0; r < mesh.faceRanges.length; r += 3) {
        const color = faces.get(mesh.faceRanges[r + 2]!);
        if (!color) continue;
        for (let i = mesh.faceRanges[r]!; i < mesh.faceRanges[r]! + mesh.faceRanges[r + 1]!; i++) {
          const v = mesh.indices[i]! * 3;
          positions.push(mesh.positions[v]!, mesh.positions[v + 1]!, mesh.positions[v + 2]!);
          colors.push(color.r, color.g, color.b);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      this.faceHighlight = new THREE.Mesh(g, material);
      this.scene.add(this.faceHighlight);
    }
    this.requestRender();
  }

  // ---------------------------------------------------------------- vertices (three-point planes, …)

  /** The model's vertices, xyz per vertex, in the order the element names use. */
  setVertices(points: Float32Array): void {
    this.vertices = points;
    this.hoveredVertex = -1;
    this.selectedVertices.clear();
    this.paintVertices();
  }

  setVertexPicking(enabled: boolean): void {
    this.pickVertices = enabled;
    if (!enabled) this.setHoveredVertex(-1);
  }

  setSelectedVertices(vertices: Iterable<number>): void {
    this.selectedVertices = new Set(vertices);
    this.paintVertices();
  }

  private setHoveredVertex(vertex: number): void {
    if (vertex === this.hoveredVertex) return;
    this.hoveredVertex = vertex;
    this.paintVertices();
    this.events.onVertexHover?.(vertex);
  }

  private paintVertices(): void {
    if (this.vertexHighlight) {
      this.overlayScene.remove(this.vertexHighlight);
      this.vertexHighlight.geometry.dispose();
      (this.vertexHighlight.material as THREE.Material).dispose();
      this.vertexHighlight = null;
    }
    const shown = new Map<number, THREE.Color>();
    for (const v of this.selectedVertices) shown.set(v, new THREE.Color(COLORS.edgeSelected));
    if (this.hoveredVertex >= 0) shown.set(this.hoveredVertex, new THREE.Color(COLORS.edgeHover));
    if (shown.size > 0) {
      const positions: number[] = [];
      const colors: number[] = [];
      for (const [v, c] of shown) {
        positions.push(this.vertices[v * 3]!, this.vertices[v * 3 + 1]!, this.vertices[v * 3 + 2]!);
        colors.push(c.r, c.g, c.b);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      this.vertexHighlight = new THREE.Points(g, new THREE.PointsMaterial({ size: 10, sizeAttenuation: false, vertexColors: true, depthTest: false }));
      this.overlayScene.add(this.vertexHighlight);
    }
    this.requestRender();
  }

  /** The nearest visible vertex within 10 pixels of the cursor, or -1. */
  private pickVertex(clientX: number, clientY: number): number {
    if (this.vertices.length === 0) return -1;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const { w, h } = this.canvasSize();
    this.syncCamera();
    const candidates: [number, number][] = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < this.vertices.length / 3; i++) {
      v.set(this.vertices[i * 3]!, this.vertices[i * 3 + 1]!, this.vertices[i * 3 + 2]!).project(this.camera);
      const d = Math.hypot(rect.left + ((v.x + 1) / 2) * w - clientX, rect.top + ((1 - v.y) / 2) * h - clientY);
      if (d <= 10) candidates.push([d, i]);
    }
    candidates.sort((a, b) => a[0] - b[0]);
    const scale = (this.camera.right - this.camera.left) / this.camera.zoom;
    for (const [, i] of candidates) {
      // Hidden behind the body? Compare the body hit along the ray with the vertex's own depth.
      const p = new THREE.Vector3(this.vertices[i * 3]!, this.vertices[i * 3 + 1]!, this.vertices[i * 3 + 2]!);
      const s = p.clone().project(this.camera);
      const ray = this.rayAt(rect.left + ((s.x + 1) / 2) * w, rect.top + ((1 - s.y) / 2) * h);
      const depth = p.clone().sub(ray.origin).dot(ray.direction);
      const caster = new THREE.Raycaster(ray.origin, ray.direction);
      const hit = this.body ? caster.intersectObject(this.body)[0]?.distance ?? Infinity : Infinity;
      if (hit >= depth - 1e-3 * scale) return i;
    }
    return -1;
  }

  // ---------------------------------------------------------------- reference planes (D4.6)

  /** Reference planes to show; each is a translucent square centered on the model's projection. */
  setPlanes(planes: PlaneDisplay[]): void {
    this.planes = planes;
    this.paintPlanes();
  }

  private paintPlanes(): void {
    if (this.planeGroup) {
      this.scene.remove(this.planeGroup);
      disposeGroup(this.planeGroup);
      this.planeGroup = null;
    }
    if (this.planes.length === 0) return this.requestRender();
    const box = new THREE.Box3();
    if (this.body) box.setFromObject(this.body);
    const boxCorners = box.isEmpty()
      ? []
      : [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    const group = new THREE.Group();
    for (const plane of this.planes) {
      const o = new THREE.Vector3(...plane.frame.origin);
      const x = new THREE.Vector3(...plane.frame.xDir);
      const y = new THREE.Vector3(...plane.frame.yDir);
      // Like SolidWorks, a plane is drawn as large as the model seen along its normal, plus a margin.
      let [u0, u1, v0, v1] = [-50, 50, -50, 50];
      if (boxCorners.length > 0) {
        const us = boxCorners.map((c) => c.clone().sub(o).dot(x));
        const vs = boxCorners.map((c) => c.clone().sub(o).dot(y));
        const margin = Math.max(0.1 * Math.max(Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs)), 5);
        [u0, u1, v0, v1] = [Math.min(...us) - margin, Math.max(...us) + margin, Math.min(...vs) - margin, Math.max(...vs) + margin];
      }
      const at = (u: number, v: number) => o.clone().addScaledVector(x, u).addScaledVector(y, v);
      const corners = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
      const fill = new THREE.BufferGeometry().setFromPoints([corners[0]!, corners[1]!, corners[2]!, corners[0]!, corners[2]!, corners[3]!]);
      const color = plane.highlighted ? COLORS.edgeHover : 0x6f9fd6;
      group.add(new THREE.Mesh(fill, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: plane.highlighted ? 0.22 : 0.12, side: THREE.DoubleSide, depthWrite: false })));
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([...corners, corners[0]!]), new THREE.LineBasicMaterial({ color })));
    }
    this.planeGroup = group;
    this.scene.add(group);
    this.requestRender();
  }

  private pickFace(clientX: number, clientY: number): number {
    if (!this.body) return -1;
    const ray = new THREE.Raycaster();
    const r = this.rayAt(clientX, clientY);
    ray.set(r.origin, r.direction);
    const hit = ray.intersectObject(this.body)[0];
    return hit?.faceIndex !== undefined && hit.faceIndex !== null ? (this.triangleFace[hit.faceIndex] ?? -1) : -1;
  }

  setSelectedEdges(edges: Iterable<number>): void {
    this.selected = new Set(edges);
    this.paintEdges();
  }

  private paintEdges(): void {
    if (!this.edges) return;
    const attr = this.edges.geometry.getAttribute('color') as THREE.BufferAttribute;
    const base = new THREE.Color(COLORS.edge);
    const hover = new THREE.Color(COLORS.edgeHover);
    const sel = new THREE.Color(COLORS.edgeSelected);
    for (let s = 0; s < this.segmentEdge.length; s++) {
      const e = this.segmentEdge[s]!;
      const c = e === this.hovered ? hover : this.selected.has(e) ? sel : base;
      for (const v of [2 * s, 2 * s + 1]) attr.setXYZ(v, c.r, c.g, c.b);
    }
    attr.needsUpdate = true;
    this.requestRender();
  }

  private setHovered(edge: number): void {
    if (edge === this.hovered) return;
    this.hovered = edge;
    this.paintEdges();
    this.events.onEdgeHover?.(edge);
  }

  private pick(clientX: number, clientY: number): number {
    if (!this.edges) return -1;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.params.Line = { threshold: (6 * (this.camera.right - this.camera.left)) / this.camera.zoom / rect.width };
    ray.set(this.rayAt(clientX, clientY).origin, this.rayAt(clientX, clientY).direction);
    const hits = ray.intersectObject(this.edges);
    // Prefer edges not hidden behind the body.
    const bodyHit = this.body ? ray.intersectObject(this.body)[0]?.distance ?? Infinity : Infinity;
    const visible = hits.filter((h) => h.distance <= bodyHit + (1e-3 * (this.camera.right - this.camera.left)) / this.camera.zoom);
    const hit = visible[0] ?? null;
    return hit && hit.index !== undefined ? (this.segmentEdge[Math.floor(hit.index / 2)] ?? -1) : -1;
  }

  private tool(type: ToolPointerEvent['type'], e: MouseEvent, pressed: boolean): void {
    this.toolHandler?.({ type, clientX: e.clientX, clientY: e.clientY, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, pressed });
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.toolHandler || e.button !== 0 || e.altKey) return;
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId); // keep receiving moves while dragging outside
    } catch {
      // the pointer is already gone (or the event is synthetic): nothing to capture
    }
    this.tool('down', e, true);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.toolHandler) {
      if (e.buttons === 0 || e.buttons === 1) this.tool('move', e, e.buttons === 1);
      return;
    }
    if (e.buttons !== 0) return;
    // One element at a time, in SolidWorks priority: vertex, then edge, then face.
    const vertex = this.pickVertices ? this.pickVertex(e.clientX, e.clientY) : -1;
    const edge = vertex < 0 && this.pickEdges ? this.pick(e.clientX, e.clientY) : -1;
    this.setHoveredVertex(vertex);
    this.setHovered(edge);
    this.setHoveredFace(vertex < 0 && edge < 0 && this.pickFaces ? this.pickFace(e.clientX, e.clientY) : -1);
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.toolHandler || e.button !== 0 || e.altKey) return;
    this.tool('up', e, false);
  };

  private onPointerLeave = (e: PointerEvent) => {
    if (this.toolHandler) this.tool('leave', e, false);
    this.setHoveredVertex(-1);
    this.setHovered(-1);
    this.setHoveredFace(-1);
  };

  private onClick = (e: MouseEvent) => {
    if (this.toolHandler || e.altKey) return;
    const additive = e.ctrlKey || e.shiftKey;
    const vertex = this.pickVertices ? this.pickVertex(e.clientX, e.clientY) : -1;
    if (vertex >= 0) return void this.events.onVertexClick?.(vertex, additive);
    const edge = this.pickEdges ? this.pick(e.clientX, e.clientY) : -1;
    if (edge >= 0 || (this.pickEdges && !this.pickFaces)) return void this.events.onEdgeClick?.(edge, additive);
    if (this.pickFaces) this.events.onFaceClick?.(this.pickFace(e.clientX, e.clientY), additive);
  };

  private onDoubleClick = (e: MouseEvent) => {
    if (this.toolHandler && !e.altKey) this.tool('dblclick', e, false);
  };

  // ---------------------------------------------------------------- views

  setView(view: StandardView): void {
    const [dir, up] = VIEW_DIRS[view];
    this.orient(dir, up);
    this.fitAll();
  }

  /** Looks straight at a plane (「正視於」, C1.2): view direction −normal, screen up = the plane's y. */
  lookAt(frame: PlaneFrame): void {
    this.orient(new THREE.Vector3(...frame.normal), new THREE.Vector3(...frame.yDir));
    this.viewChanged();
  }

  private orient(dir: THREE.Vector3, up: THREE.Vector3): void {
    const dist = 1000;
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.camera.up.copy(up);
    this.camera.lookAt(this.controls.target);
  }

  /** Zoom to fit (「全部顯示」). Deferred while the viewport has no size (hidden tab, minimized window). */
  fitAll(): void {
    if (this.container.clientWidth === 0 || this.container.clientHeight === 0) {
      this.pendingFit = true;
      return;
    }
    this.pendingFit = false;
    const box = new THREE.Box3();
    if (this.body) box.setFromObject(this.body);
    if (this.overlayGroup) box.union(new THREE.Box3().setFromObject(this.overlayGroup));
    if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, -50), new THREE.Vector3(50, 50, 50));
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 50;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, radius * 10);
    this.camera.lookAt(center);
    const aspect = this.container.clientWidth / this.container.clientHeight;
    const half = radius * 1.15;
    this.camera.left = -half * Math.max(aspect, 1);
    this.camera.right = half * Math.max(aspect, 1);
    this.camera.top = half / Math.min(aspect, 1);
    this.camera.bottom = -half / Math.min(aspect, 1);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.viewChanged();
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return; // keep the last good frustum; a zero size would distort the aspect ratio
    this.renderer.setSize(w, h);
    if (this.pendingFit) {
      this.fitAll();
      return;
    }
    const halfH = (this.camera.top - this.camera.bottom) / 2 || 1;
    this.camera.left = -halfH * (w / h);
    this.camera.right = halfH * (w / h);
    this.camera.updateProjectionMatrix();
    this.viewChanged();
  }

  private viewChanged(): void {
    this.events.onViewChange?.();
    this.requestRender();
  }

  // ---------------------------------------------------------------- triad (D4.2)

  private buildTriad(): void {
    const axes: [THREE.Vector3, number][] = [
      [new THREE.Vector3(1, 0, 0), 0xe03131],
      [new THREE.Vector3(0, 1, 0), 0x2f9e44],
      [new THREE.Vector3(0, 0, 1), 0x1c7ed6],
    ];
    for (const [dir, color] of axes) {
      this.triadScene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(), 1, color, 0.3, 0.16));
    }
  }

  // ---------------------------------------------------------------- render loop

  requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    const r = this.renderer;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    r.setViewport(0, 0, w, h);
    r.clear();
    r.render(this.scene, this.camera);
    if (this.overlayScene.children.length > 0) {
      r.clearDepth();
      r.render(this.overlayScene, this.camera);
    }
    const canvas = this.canvasSize();
    for (const { el, world } of this.labels.values()) {
      const v = world.clone().project(this.camera);
      el.style.transform = `translate(${((v.x + 1) / 2) * canvas.w}px, ${((1 - v.y) / 2) * canvas.h}px) translate(-50%, -50%)`;
    }
    const size = 90;
    const offset = this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(5);
    this.triadCamera.position.copy(offset);
    this.triadCamera.up.copy(this.camera.up);
    this.triadCamera.lookAt(0, 0, 0);
    r.clearDepth();
    r.setViewport(8, 8, size, size);
    r.render(this.triadScene, this.triadCamera);
  }
}
