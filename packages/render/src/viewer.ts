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

/** How the model is drawn (A4.3): shaded with edges, shaded, hidden lines removed (white fill), hidden lines dashed, or wireframe. */
export type DisplayMode = 'shadedEdges' | 'shaded' | 'hiddenRemoved' | 'hiddenVisible' | 'wireframe';

/** A cut through the model (D4.4): what is on the side of `normal` beyond `offset` (the points with normal · p > offset) is left out. */
export interface SectionPlane {
  normal: [number, number, number];
  offset: number;
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
  componentHover: 0xf2c48d,
  componentSelected: 0x8fb8e8,
};

/**
 * A placed copy of a part mesh (an assembly component): `part` names a mesh given to setParts, and
 * `matrix` (4×4, column-major) maps the part's coordinates into the scene.
 */
export interface ViewInstance {
  key: string;
  part: string;
  matrix: ArrayLike<number>;
}

/** A part mesh instances can show, and its vertices (xyz each, in the order of its vertex names). */
export interface ViewPart {
  mesh: ViewMesh;
  vertices?: Float32Array;
}

/** An element of a placed part: a face, edge or vertex, by its index in the part's mesh. */
export interface InstanceElement {
  key: string;
  kind: 'face' | 'edge' | 'vertex';
  index: number;
}

interface PartGeometry {
  mesh: ViewMesh;
  body: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
  /** triangleFace[t] = face owning triangle t; segmentEdge[s] = edge owning line segment s. */
  triangleFace: Int32Array;
  segmentEdge: Int32Array;
  vertices: Float32Array;
}

interface Instance {
  part: string;
  group: THREE.Group;
  body: THREE.Mesh;
  edges: THREE.LineSegments | null;
  /** Hovered and selected elements, drawn in the part's coordinates so they follow the component. */
  marks: THREE.Group;
}

function bodyGeometry(mesh: ViewMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return g;
}

/** The edges as line segments, and the edge each segment belongs to. */
function edgeSegments(mesh: ViewMesh): { segs: number[]; owner: number[] } {
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
  return { segs, owner };
}

const bodyMaterial = (options: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color: COLORS.body, metalness: 0.15, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, ...options });

function setMatrix(group: THREE.Object3D, matrix: ArrayLike<number>): void {
  group.matrix.fromArray(Array.from(matrix));
  group.updateMatrixWorld(true);
}

/** A reference plane to show (D4.6): drawn as a translucent square around the model. */
export interface PlaneDisplay {
  key: string;
  frame: PlaneFrame;
  highlighted?: boolean;
}

/**
 * Reference axes, points and coordinate systems to show (D4.6, C3.3–C3.5). An axis is a line through the model's extent, a point a dot, a coordinate
 * system three arrows: the last two a constant length on screen.
 */
export interface DatumDisplay {
  axes: { key: string; origin: [number, number, number]; dir: [number, number, number]; highlighted?: boolean }[];
  points: { key: string; p: [number, number, number]; highlighted?: boolean }[];
  systems: { key: string; origin: [number, number, number]; x: [number, number, number]; y: [number, number, number]; z: [number, number, number]; highlighted?: boolean }[];
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

/** The pointer during a component drag (C15.3). */
export interface ComponentDragEvent {
  /** The line under the cursor, in scene coordinates. */
  origin: [number, number, number];
  dir: [number, number, number];
  /** How far the pointer is from where the drag began, in CSS pixels (x to the right, y down). */
  dx: number;
  dy: number;
  /** The screen's right and up directions in the scene (for turning). */
  right: [number, number, number];
  up: [number, number, number];
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
  /** Component under the cursor changed (an instance key, or null). */
  onComponentHover?: (key: string | null) => void;
  /** Left click on a component (null on empty space). */
  onComponentClick?: (key: string | null, additive: boolean) => void;
  /** Element of a component under the cursor changed (while elements are picked). */
  onElementHover?: (element: InstanceElement | null) => void;
  onElementClick?: (element: InstanceElement | null, additive: boolean) => void;
  /**
   * A drag began on a component (left button: move it, right button: turn it); `point` is where it was
   * grabbed, in scene coordinates. Returning false refuses the drag (e.g. the component is fixed).
   */
  onComponentDragStart?: (key: string, point: [number, number, number], button: 'left' | 'right') => boolean;
  onComponentDrag?: (e: ComponentDragEvent) => void;
  /** The drag is over: the button was released, or it was cancelled (Esc). */
  onComponentDragEnd?: (cancelled: boolean) => void;
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
  /** The color of each face (C14.2): "#rrggbb" or null for the body's own. */
  private faceColors: readonly (string | null)[] = [];
  private displayMode: DisplayMode = 'shadedEdges';
  private section: SectionPlane | null = null;
  private clip: THREE.Plane[] = [];
  /** The edges that lie behind the body, drawn dashed in 'hiddenVisible'. */
  private hiddenEdges: THREE.LineSegments | null = null;
  private readonly viewListeners = new Set<() => void>();
  private planes: PlaneDisplay[] = [];
  private planeGroup: THREE.Group | null = null;
  private overlay: SketchOverlay | null = null;
  /** Sketches that are shown next to the model (D4.6), each drawn like the sketch being edited, without labels. */
  private sketches: SketchOverlay[] = [];
  private sketchGroup: THREE.Group | null = null;
  private originShown = false;
  private originGroup: THREE.Group | null = null;
  private datums: DatumDisplay = { axes: [], points: [], systems: [] };
  private datumGroup: THREE.Group | null = null;
  private overlayGroup: THREE.Group | null = null;
  private labels = new Map<string, { el: HTMLElement; world: THREE.Vector3 }>();
  private toolHandler: ((e: ToolPointerEvent) => void) | null = null;
  /** Part meshes that instances show, by key: built once, shared by every instance of the part. */
  private partGeometry = new Map<string, PartGeometry>();
  private pickElements = false;
  private hoveredElement: InstanceElement | null = null;
  private selectedElements: InstanceElement[] = [];
  private instances = new Map<string, Instance>();
  private readonly instanceEdges = new THREE.LineBasicMaterial({ color: COLORS.edge });
  private pickInstances = false;
  private hoveredInstance: string | null = null;
  private selectedInstances = new Set<string>();
  /** A see-through instance following the cursor while a component is being placed. */
  private ghost: Instance | null = null;
  private dragInstances = false;
  /** A button pressed on a component: a drag once the pointer moves a few pixels, else a click. */
  private press: { key: string; point: THREE.Vector3; button: 'left' | 'right'; x: number; y: number; pointerId: number; dragging: boolean } | null = null;
  /** The click the browser sends after a left-button drag is not a click. */
  private swallowClick = false;
  private pendingFit = false;
  private frame = 0;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    private readonly events: ViewerEvents = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.localClippingEnabled = true;
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
    dom.addEventListener('pointercancel', () => this.cancelComponentDrag()); // the system took the pointer
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
    this.setSketches([]);
    this.setOrigin(false);
    this.setPlanes([]);
    this.setVertices(new Float32Array(0));
    this.setGhost(null);
    this.setParts(new Map());
    this.instanceEdges.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }

  // ---------------------------------------------------------------- content

  setMesh(mesh: ViewMesh | null, fit = false): void {
    this.clear();
    if (mesh) {
      this.body = new THREE.Mesh(bodyGeometry(mesh), bodyMaterial());
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
    this.applyDisplay();
    if (this.planes.length > 0) this.paintPlanes(); // sized to the body
    if (this.datums.axes.length > 0) this.paintDatums();
    if (fit) this.fitAll();
    this.requestRender();
  }

  private buildEdges(mesh: ViewMesh): void {
    const { segs, owner } = edgeSegments(mesh);
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
    if (this.hiddenEdges) {
      this.scene.remove(this.hiddenEdges);
      this.hiddenEdges.geometry.dispose();
      (this.hiddenEdges.material as THREE.Material).dispose();
      this.hiddenEdges = null;
    }
  }

  // ---------------------------------------------------------------- assembly components (C15.1, A3.1)

  /** The part meshes instances can show, by key. Instances of a part no longer given are removed. */
  setParts(parts: ReadonlyMap<string, ViewPart>): void {
    for (const [key, geo] of this.partGeometry) {
      if (parts.has(key)) continue;
      for (const [k, inst] of this.instances) if (inst.part === key) this.removeInstance(k);
      if (this.ghost?.part === key) this.setGhost(null);
      geo.body.dispose();
      geo.edges.dispose();
      this.partGeometry.delete(key);
    }
    for (const [key, { mesh, vertices }] of parts) {
      if (this.partGeometry.has(key)) continue;
      const { segs, owner } = edgeSegments(mesh);
      const edges = new THREE.BufferGeometry();
      edges.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      const triangleFace = new Int32Array(mesh.indices.length / 3);
      for (let r = 0; r < mesh.faceRanges.length; r += 3) triangleFace.fill(mesh.faceRanges[r + 2]!, mesh.faceRanges[r]! / 3, (mesh.faceRanges[r]! + mesh.faceRanges[r + 1]!) / 3);
      this.partGeometry.set(key, { mesh, body: bodyGeometry(mesh), edges, triangleFace, segmentEdge: Int32Array.from(owner), vertices: vertices ?? new Float32Array(0) });
    }
    this.requestRender();
  }

  /** The components to show; an instance whose part mesh has not been given yet is left out. */
  setInstances(list: ViewInstance[]): void {
    const keep = new Set(list.map((i) => i.key));
    for (const key of [...this.instances.keys()]) if (!keep.has(key)) this.removeInstance(key);
    for (const i of list) {
      let inst = this.instances.get(i.key);
      if (inst && inst.part !== i.part) {
        this.removeInstance(i.key);
        inst = undefined;
      }
      if (!inst) {
        inst = this.makeInstance(i.part, false) ?? undefined;
        if (!inst) continue;
        this.instances.set(i.key, inst);
        this.scene.add(inst.group);
      }
      setMatrix(inst.group, i.matrix);
    }
    if (this.hoveredInstance !== null && !this.instances.has(this.hoveredInstance)) this.setHoveredInstance(null);
    this.paintInstances();
    if (this.planes.length > 0) this.paintPlanes(); // sized to the content
  }

  private makeInstance(part: string, ghost: boolean): Instance | null {
    const geo = this.partGeometry.get(part);
    if (!geo) return null;
    const body = new THREE.Mesh(geo.body, bodyMaterial(ghost ? { transparent: true, opacity: 0.45, depthWrite: false } : {}));
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.add(body);
    const edges = ghost ? null : new THREE.LineSegments(geo.edges, this.instanceEdges);
    if (edges) group.add(edges);
    const marks = new THREE.Group();
    group.add(marks);
    return { part, group, body, edges, marks };
  }

  private removeInstance(key: string): void {
    const inst = this.instances.get(key);
    if (!inst) return;
    this.scene.remove(inst.group);
    (inst.body.material as THREE.Material).dispose();
    clearMarks(inst.marks);
    this.instances.delete(key);
    this.selectedInstances.delete(key);
  }

  // ---------------------------------------------------------------- elements of components (mates, 2C)

  /** Enables picking faces, edges and vertices of the components instead of whole components. */
  setElementPicking(enabled: boolean): void {
    this.pickElements = enabled;
    if (!enabled) this.setHoveredElement(null);
  }

  /** Elements shown as chosen (the mate being defined, or the selected mate's elements). */
  setSelectedElements(elements: InstanceElement[]): void {
    this.selectedElements = elements;
    this.paintElements();
  }

  private setHoveredElement(el: InstanceElement | null): void {
    const same = el === this.hoveredElement || (el && this.hoveredElement && el.key === this.hoveredElement.key && el.kind === this.hoveredElement.kind && el.index === this.hoveredElement.index);
    if (same) return;
    this.hoveredElement = el;
    this.paintElements();
    this.events.onElementHover?.(el);
  }

  /** Marks on each instance, in its part's coordinates: the element's triangles, segments or point. */
  private paintElements(): void {
    for (const inst of this.instances.values()) clearMarks(inst.marks);
    const draw = (el: InstanceElement, color: number) => {
      const inst = this.instances.get(el.key);
      const geo = inst && this.partGeometry.get(inst.part);
      if (!inst || !geo) return;
      const g = new THREE.BufferGeometry();
      if (el.kind === 'face') {
        const positions: number[] = [];
        const { mesh } = geo;
        for (let r = 0; r < mesh.faceRanges.length; r += 3) {
          if (mesh.faceRanges[r + 2] !== el.index) continue;
          for (let i = mesh.faceRanges[r]!; i < mesh.faceRanges[r]! + mesh.faceRanges[r + 1]!; i++) {
            const v = mesh.indices[i]! * 3;
            positions.push(mesh.positions[v]!, mesh.positions[v + 1]!, mesh.positions[v + 2]!);
          }
        }
        g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
        inst.marks.add(new THREE.Mesh(g, m));
      } else if (el.kind === 'edge') {
        const all = geo.edges.getAttribute('position') as THREE.BufferAttribute;
        const positions: number[] = [];
        geo.segmentEdge.forEach((edge, seg) => {
          if (edge !== el.index) return;
          for (const v of [2 * seg, 2 * seg + 1]) positions.push(all.getX(v), all.getY(v), all.getZ(v));
        });
        g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthTest: false }));
        line.renderOrder = 2;
        inst.marks.add(line);
      } else {
        const v = geo.vertices;
        g.setAttribute('position', new THREE.Float32BufferAttribute([v[3 * el.index]!, v[3 * el.index + 1]!, v[3 * el.index + 2]!], 3));
        const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size: 10, sizeAttenuation: false, depthTest: false }));
        pts.renderOrder = 3;
        inst.marks.add(pts);
      }
    };
    for (const el of this.selectedElements) draw(el, COLORS.edgeSelected);
    if (this.hoveredElement) draw(this.hoveredElement, COLORS.edgeHover);
    this.requestRender();
  }

  /** The element under the cursor, in SolidWorks priority: vertex, then edge, then face; hidden ones excluded. */
  private pickElement(clientX: number, clientY: number): InstanceElement | null {
    if (this.instances.size === 0) return null;
    const ray = this.rayAt(clientX, clientY);
    const caster = new THREE.Raycaster(ray.origin, ray.direction);
    const bodies = [...this.instances.values()].map((i) => i.body);
    const bodyHit = caster.intersectObjects(bodies)[0];
    const depth = bodyHit?.distance ?? Infinity;
    const scale = (this.camera.right - this.camera.left) / this.camera.zoom;
    const slack = 1e-3 * scale;
    const owner = (obj: THREE.Object3D) => [...this.instances].find(([, i]) => i.body === obj || i.edges === obj);

    // Vertices within 10 px, nearest first, that no body hides.
    const rect = this.renderer.domElement.getBoundingClientRect();
    const { w, h } = this.canvasSize();
    this.syncCamera();
    let best: { d: number; el: InstanceElement; p: THREE.Vector3 } | null = null;
    const p = new THREE.Vector3();
    for (const [key, inst] of this.instances) {
      const v = this.partGeometry.get(inst.part)?.vertices;
      if (!v) continue;
      for (let i = 0; i < v.length / 3; i++) {
        p.set(v[3 * i]!, v[3 * i + 1]!, v[3 * i + 2]!).applyMatrix4(inst.group.matrixWorld);
        const s = p.clone().project(this.camera);
        const d = Math.hypot(rect.left + ((s.x + 1) / 2) * w - clientX, rect.top + ((1 - s.y) / 2) * h - clientY);
        if (d <= 10 && (!best || d < best.d)) best = { d, el: { key, kind: 'vertex', index: i }, p: p.clone() };
      }
    }
    if (best) {
      const toVertex = best.p.clone().sub(ray.origin);
      const along = toVertex.dot(ray.direction);
      const r = new THREE.Raycaster(best.p.clone().addScaledVector(ray.direction, -along), ray.direction);
      const hit = r.intersectObjects(bodies)[0]?.distance ?? Infinity;
      if (hit >= along - slack) return best.el;
    }

    // Edges within 6 px, in front of the bodies.
    caster.params.Line = { threshold: (6 * scale) / rect.width };
    const edges = [...this.instances.values()].flatMap((i) => (i.edges ? [i.edges] : []));
    const edgeHit = caster.intersectObjects(edges).find((x) => x.distance <= depth + slack);
    if (edgeHit && edgeHit.index !== undefined) {
      const found = owner(edgeHit.object);
      const geo = found && this.partGeometry.get(found[1].part);
      const edge = geo?.segmentEdge[Math.floor(edgeHit.index / 2)];
      if (found && edge !== undefined) return { key: found[0], kind: 'edge', index: edge };
    }

    if (bodyHit && bodyHit.faceIndex !== undefined && bodyHit.faceIndex !== null) {
      const found = owner(bodyHit.object);
      const face = found && this.partGeometry.get(found[1].part)?.triangleFace[bodyHit.faceIndex];
      if (found && face !== undefined) return { key: found[0], kind: 'face', index: face };
    }
    return null;
  }

  /** Enables picking whole components (hover highlight, click). */
  setComponentPicking(enabled: boolean): void {
    this.pickInstances = enabled;
    if (!enabled) this.setHoveredInstance(null);
  }

  /** Lets components be dragged: the left button moves one, the right button turns it (C15.3). */
  setComponentDragging(enabled: boolean): void {
    this.dragInstances = enabled;
    if (!enabled) this.cancelComponentDrag();
  }

  /** Ends a drag in progress as cancelled (Esc). */
  cancelComponentDrag(): void {
    const p = this.press;
    this.press = null;
    if (p?.dragging) {
      this.swallowClick = p.button === 'left';
      this.events.onComponentDragEnd?.(true);
    }
  }

  /** The component under a screen position and the point of it there (scene coordinates). */
  private hitInstance(clientX: number, clientY: number): { key: string; point: THREE.Vector3 } | null {
    if (this.instances.size === 0) return null;
    const r = this.rayAt(clientX, clientY);
    const hit = new THREE.Raycaster(r.origin, r.direction).intersectObjects([...this.instances.values()].map((i) => i.body))[0];
    if (!hit) return null;
    for (const [key, inst] of this.instances) if (inst.body === hit.object) return { key, point: hit.point.clone() };
    return null;
  }

  private dragMove(e: PointerEvent): void {
    const p = this.press!;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.dragging) {
      if (Math.hypot(dx, dy) < 4) return;
      if (!(this.events.onComponentDragStart?.(p.key, [p.point.x, p.point.y, p.point.z], p.button) ?? false)) {
        this.press = null;
        return;
      }
      p.dragging = true;
      try {
        this.renderer.domElement.setPointerCapture(p.pointerId);
      } catch {
        // the pointer is already gone (or the event is synthetic): nothing to capture
      }
    }
    const ray = this.rayAt(e.clientX, e.clientY);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.events.onComponentDrag?.({
      origin: [ray.origin.x, ray.origin.y, ray.origin.z],
      dir: [ray.direction.x, ray.direction.y, ray.direction.z],
      dx,
      dy,
      right: [right.x, right.y, right.z],
      up: [up.x, up.y, up.z],
    });
  }

  setSelectedComponents(keys: Iterable<string>): void {
    this.selectedInstances = new Set(keys);
    this.paintInstances();
  }

  private setHoveredInstance(key: string | null): void {
    if (key === this.hoveredInstance) return;
    this.hoveredInstance = key;
    this.paintInstances();
    this.events.onComponentHover?.(key);
  }

  private paintInstances(): void {
    for (const [key, inst] of this.instances) {
      const color = key === this.hoveredInstance ? COLORS.componentHover : this.selectedInstances.has(key) ? COLORS.componentSelected : COLORS.body;
      (inst.body.material as THREE.MeshStandardMaterial).color.setHex(color);
    }
    this.requestRender();
  }

  private pickInstance(clientX: number, clientY: number): string | null {
    if (this.instances.size === 0) return null;
    const r = this.rayAt(clientX, clientY);
    const hit = new THREE.Raycaster(r.origin, r.direction).intersectObjects([...this.instances.values()].map((i) => i.body))[0];
    if (!hit) return null;
    for (const [key, inst] of this.instances) if (inst.body === hit.object) return key;
    return null;
  }

  /** Shows a see-through copy of a part (null removes it); moveGhost places it. */
  setGhost(part: string | null): void {
    if (this.ghost && this.ghost.part === part) return;
    if (this.ghost) {
      this.scene.remove(this.ghost.group);
      (this.ghost.body.material as THREE.Material).dispose();
      this.ghost = null;
    }
    if (part) {
      this.ghost = this.makeInstance(part, true);
      if (this.ghost) {
        this.ghost.group.visible = false;
        this.scene.add(this.ghost.group);
      }
    }
    this.requestRender();
  }

  /** Moves the see-through copy (null hides it, e.g. while the cursor is outside the view). */
  moveGhost(matrix: ArrayLike<number> | null): void {
    if (!this.ghost) return;
    this.ghost.group.visible = matrix !== null;
    if (matrix) setMatrix(this.ghost.group, matrix);
    this.requestRender();
  }

  /** Where a screen position meets the plane through `through` that faces the viewer. */
  pointOnViewPlane(clientX: number, clientY: number, through: [number, number, number] = [0, 0, 0]): [number, number, number] {
    const ray = this.rayAt(clientX, clientY);
    const n = this.camera.getWorldDirection(new THREE.Vector3());
    const t = new THREE.Vector3(...through).sub(ray.origin).dot(n) / ray.direction.dot(n);
    const p = ray.origin.clone().addScaledVector(ray.direction, t);
    return [p.x, p.y, p.z];
  }

  /** Everything the model shows: the part's body or the assembly's components. */
  private contentBox(): THREE.Box3 {
    const box = new THREE.Box3();
    if (this.body) box.expandByObject(this.body);
    for (const inst of this.instances.values()) box.expandByObject(inst.group);
    return box;
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
  /** The colors of the faces of the body on show (C14.2), in the order of its faces; faces without one keep the body's. */
  setFaceColors(colors: readonly (string | null)[]): void {
    this.faceColors = colors;
    this.paintBodyColors();
  }

  private paintBodyColors(): void {
    const mesh = this.mesh;
    if (!this.body || !mesh) return;
    const geometry = this.body.geometry;
    const material = this.body.material as THREE.MeshStandardMaterial;
    if (!this.faceColors.some(Boolean) || this.displayMode === 'hiddenRemoved') {
      if (geometry.getAttribute('color')) geometry.deleteAttribute('color');
      material.vertexColors = false;
      material.color.set(COLORS.body);
      material.needsUpdate = true;
      return this.requestRender();
    }
    const base = new THREE.Color(COLORS.body);
    const colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([base.r, base.g, base.b], i);
    const own = new THREE.Color();
    for (let r = 0; r < mesh.faceRanges.length; r += 3) {
      const hex = this.faceColors[mesh.faceRanges[r + 2]!];
      if (!hex) continue;
      own.set(hex);
      for (let i = mesh.faceRanges[r]!; i < mesh.faceRanges[r]! + mesh.faceRanges[r + 1]!; i++) colors.set([own.r, own.g, own.b], mesh.indices[i]! * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    material.vertexColors = true;
    material.color.set(0xffffff);
    material.needsUpdate = true;
    this.requestRender();
  }

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

  // ---------------------------------------------------------------- shown sketches and the origin (D4.6)

  /** Sketches to show in the graphics area, on top of the model. Only their lines and points are drawn. */
  setSketches(sketches: SketchOverlay[]): void {
    if (this.sketchGroup) {
      this.overlayScene.remove(this.sketchGroup);
      disposeGroup(this.sketchGroup);
      this.sketchGroup = null;
    }
    this.sketches = sketches;
    if (sketches.length > 0) {
      const group = new THREE.Group();
      const px = this.pixelSize();
      for (const s of sketches) group.add(buildOverlayObjects({ ...s, labels: [] }, px));
      this.sketchGroup = group;
      this.overlayScene.add(group);
    }
    this.requestRender();
  }

  /** The part's origin: three short axes, a constant length on screen. */
  setOrigin(show: boolean): void {
    this.originShown = show;
    this.paintOrigin();
  }

  private paintOrigin(): void {
    if (this.originGroup) {
      this.overlayScene.remove(this.originGroup);
      disposeGroup(this.originGroup);
      this.originGroup = null;
    }
    if (this.originShown) {
      const len = 28 * this.pixelSize();
      const group = new THREE.Group();
      const axes: [number[], number][] = [
        [[len, 0, 0], 0xe03131],
        [[0, len, 0], 0x2f9e44],
        [[0, 0, len], 0x1c7ed6],
      ];
      for (const [end, color] of axes) {
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(...end)]), new THREE.LineBasicMaterial({ color, depthTest: false })));
      }
      group.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]), new THREE.PointsMaterial({ color: 0xe03131, size: 6, sizeAttenuation: false, depthTest: false })));
      this.originGroup = group;
      this.overlayScene.add(group);
    }
    this.requestRender();
  }

  // ---------------------------------------------------------------- reference axes, points and coordinate systems (D4.6)

  /** Reference axes, points and coordinate systems to show. */
  setDatums(datums: DatumDisplay): void {
    this.datums = datums;
    this.paintDatums();
  }

  private paintDatums(): void {
    if (this.datumGroup) {
      this.overlayScene.remove(this.datumGroup);
      disposeGroup(this.datumGroup);
      this.datumGroup = null;
    }
    const { axes, points, systems } = this.datums;
    if (axes.length + points.length + systems.length > 0) {
      const group = new THREE.Group();
      const px = this.pixelSize();
      const box = this.contentBox();
      const reach = box.isEmpty() ? 50 : box.getSize(new THREE.Vector3()).length();
      const line = (a: THREE.Vector3, b: THREE.Vector3, color: number) =>
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color, depthTest: false })));
      for (const axis of axes) {
        // through the extent of the model, and a little beyond it, whatever the axis starts at
        const o = new THREE.Vector3(...axis.origin);
        const d = new THREE.Vector3(...axis.dir).normalize();
        let [t0, t1] = [-reach / 2, reach / 2];
        if (!box.isEmpty()) {
          const along = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(o).dot(d));
          const margin = 0.1 * (Math.max(...along) - Math.min(...along)) + 5;
          [t0, t1] = [Math.min(...along) - margin, Math.max(...along) + margin];
        }
        line(o.clone().addScaledVector(d, t0), o.clone().addScaledVector(d, t1), axis.highlighted ? COLORS.edgeHover : 0x7048a8);
      }
      if (points.length > 0) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p.p)));
        group.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x7048a8, size: 8, sizeAttenuation: false, depthTest: false })));
        const lit = points.filter((p) => p.highlighted);
        if (lit.length > 0) group.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(lit.map((p) => new THREE.Vector3(...p.p))), new THREE.PointsMaterial({ color: COLORS.edgeHover, size: 11, sizeAttenuation: false, depthTest: false })));
      }
      const len = 40 * px;
      for (const c of systems) {
        const o = new THREE.Vector3(...c.origin);
        const arm = (v: [number, number, number], color: number) => line(o, o.clone().addScaledVector(new THREE.Vector3(...v), len), color);
        arm(c.x, 0xe03131);
        arm(c.y, 0x2f9e44);
        arm(c.z, 0x1c7ed6);
        group.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints([o]), new THREE.PointsMaterial({ color: c.highlighted ? COLORS.edgeHover : 0x7048a8, size: 7, sizeAttenuation: false, depthTest: false })));
      }
      this.datumGroup = group;
      this.overlayScene.add(group);
    }
    this.requestRender();
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
    const box = this.contentBox();
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
    const hit = ray.intersectObject(this.body).find((h) => this.kept(h.point));
    return hit?.faceIndex !== undefined && hit.faceIndex !== null ? (this.triangleFace[hit.faceIndex] ?? -1) : -1;
  }

  setSelectedEdges(edges: Iterable<number>): void {
    this.selected = new Set(edges);
    this.paintEdges();
  }

  private paintEdges(): void {
    if (!this.edges) return;
    const attr = this.edges.geometry.getAttribute('color') as THREE.BufferAttribute;
    // with no edges drawn ('shaded') the edges are the colour of the body: they are still there to hover and to pick
    const base = new THREE.Color(this.displayMode === 'shaded' ? COLORS.body : COLORS.edge);
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
    const seeThrough = this.displayMode === 'wireframe' || this.displayMode === 'hiddenVisible';
    const bodyHit = this.body && !seeThrough ? this.firstBodyHit(ray) : Infinity;
    const visible = hits.filter((h) => this.kept(h.point) && h.distance <= bodyHit + (1e-3 * (this.camera.right - this.camera.left)) / this.camera.zoom);
    const hit = visible[0] ?? null;
    return hit && hit.index !== undefined ? (this.segmentEdge[Math.floor(hit.index / 2)] ?? -1) : -1;
  }

  private tool(type: ToolPointerEvent['type'], e: MouseEvent, pressed: boolean): void {
    this.toolHandler?.({ type, clientX: e.clientX, clientY: e.clientY, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, pressed });
  }

  private onPointerDown = (e: PointerEvent) => {
    this.swallowClick = false; // a new press: whatever the last drag left no longer applies
    if (this.dragInstances && !this.toolHandler && (e.button === 0 || e.button === 2) && !e.altKey && !e.ctrlKey && !e.shiftKey) {
      const hit = this.hitInstance(e.clientX, e.clientY);
      this.press = hit && { ...hit, button: e.button === 0 ? 'left' : 'right', x: e.clientX, y: e.clientY, pointerId: e.pointerId, dragging: false };
    }
    if (!this.toolHandler || e.button !== 0 || e.altKey) return;
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId); // keep receiving moves while dragging outside
    } catch {
      // the pointer is already gone (or the event is synthetic): nothing to capture
    }
    this.tool('down', e, true);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.press) {
      if (e.buttons & (this.press.button === 'left' ? 1 : 2)) return this.dragMove(e);
      // Released where the canvas could not see it: a drag ends there, as if released.
      const p = this.press;
      this.press = null;
      if (p.dragging) this.events.onComponentDragEnd?.(false);
    }
    if (this.toolHandler) {
      if (e.buttons === 0 || e.buttons === 1) this.tool('move', e, e.buttons === 1);
      return;
    }
    if (e.buttons !== 0) return;
    if (this.pickInstances) this.setHoveredInstance(this.pickInstance(e.clientX, e.clientY));
    if (this.pickElements) this.setHoveredElement(this.pickElement(e.clientX, e.clientY));
    // One element at a time, in SolidWorks priority: vertex, then edge, then face.
    const vertex = this.pickVertices ? this.pickVertex(e.clientX, e.clientY) : -1;
    const edge = vertex < 0 && this.pickEdges ? this.pick(e.clientX, e.clientY) : -1;
    this.setHoveredVertex(vertex);
    this.setHovered(edge);
    this.setHoveredFace(vertex < 0 && edge < 0 && this.pickFaces ? this.pickFace(e.clientX, e.clientY) : -1);
  };

  private onPointerUp = (e: PointerEvent) => {
    const p = this.press;
    if (p && e.button === (p.button === 'left' ? 0 : 2)) {
      this.press = null;
      if (p.dragging) {
        this.swallowClick = p.button === 'left';
        this.events.onComponentDragEnd?.(false);
        return;
      }
    }
    if (!this.toolHandler || e.button !== 0 || e.altKey) return;
    this.tool('up', e, false);
  };

  private onPointerLeave = (e: PointerEvent) => {
    if (this.toolHandler) this.tool('leave', e, false);
    this.setHoveredVertex(-1);
    this.setHovered(-1);
    this.setHoveredFace(-1);
    this.setHoveredInstance(null);
    this.setHoveredElement(null);
  };

  private onClick = (e: MouseEvent) => {
    if (this.swallowClick) {
      this.swallowClick = false;
      return;
    }
    if (this.toolHandler || e.altKey) return;
    const additive = e.ctrlKey || e.shiftKey;
    if (this.pickElements) return void this.events.onElementClick?.(this.pickElement(e.clientX, e.clientY), additive);
    if (this.pickInstances) return void this.events.onComponentClick?.(this.pickInstance(e.clientX, e.clientY), additive);
    const vertex = this.pickVertices ? this.pickVertex(e.clientX, e.clientY) : -1;
    if (vertex >= 0) return void this.events.onVertexClick?.(vertex, additive);
    const edge = this.pickEdges ? this.pick(e.clientX, e.clientY) : -1;
    if (edge >= 0 || (this.pickEdges && !this.pickFaces)) return void this.events.onEdgeClick?.(edge, additive);
    if (this.pickFaces) this.events.onFaceClick?.(this.pickFace(e.clientX, e.clientY), additive);
  };

  private onDoubleClick = (e: MouseEvent) => {
    if (this.toolHandler && !e.altKey) this.tool('dblclick', e, false);
  };

  // ---------------------------------------------------------------- display modes (A4.3) and section (D4.4)

  setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    this.paintEdges();
    this.applyDisplay();
  }

  /** Cuts the model open at a plane, or (null) puts it back. */
  setSection(section: SectionPlane | null): void {
    this.section = section;
    this.clip = section ? [new THREE.Plane(new THREE.Vector3(...section.normal).normalize().negate(), section.offset)] : [];
    this.applyDisplay();
  }

  /** The corners of the box round everything on show, or null when nothing is. */
  contentBounds(): { min: [number, number, number]; max: [number, number, number] } | null {
    const box = this.contentBox();
    return box.isEmpty() ? null : { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
  }

  /** Is the point on the side of the section that is kept? */
  private kept(p: THREE.Vector3): boolean {
    return this.clip.every((c) => c.distanceToPoint(p) >= -1e-9);
  }

  private firstBodyHit(ray: THREE.Raycaster): number {
    return this.body ? (ray.intersectObject(this.body).find((h) => this.kept(h.point))?.distance ?? Infinity) : Infinity;
  }

  /** Puts the body and its edges as the display mode and the section say. */
  private applyDisplay(): void {
    const mode = this.displayMode;
    const body = this.body;
    if (body) {
      const m = body.material as THREE.MeshStandardMaterial;
      const seeThrough = mode === 'wireframe' || mode === 'hiddenVisible';
      m.colorWrite = !seeThrough;
      m.depthWrite = mode !== 'wireframe';
      m.emissive.set(mode === 'hiddenRemoved' ? 0xffffff : 0x000000);
      m.emissiveIntensity = mode === 'hiddenRemoved' ? 0.85 : 1;
      m.clippingPlanes = this.clip;
      m.side = this.clip.length > 0 ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
      this.paintBodyColors();
    }
    if (this.edges) {
      const m = this.edges.material as THREE.LineBasicMaterial;
      m.clippingPlanes = this.clip;
      m.needsUpdate = true;
    }
    if (mode === 'hiddenVisible' && this.edges && !this.hiddenEdges) {
      const g = this.edges.geometry.clone();
      const line = new THREE.LineSegments(g, new THREE.LineDashedMaterial({ color: 0x8b98a8, dashSize: 1, gapSize: 1, depthFunc: THREE.GreaterDepth, depthWrite: false }));
      line.computeLineDistances();
      this.hiddenEdges = line;
      this.scene.add(line);
    }
    if (this.hiddenEdges) {
      this.hiddenEdges.visible = mode === 'hiddenVisible';
      const m = this.hiddenEdges.material as THREE.LineDashedMaterial;
      const box = this.contentBox();
      const size = box.isEmpty() ? 100 : box.getSize(new THREE.Vector3()).length();
      m.dashSize = size / 150;
      m.gapSize = size / 300;
      m.clippingPlanes = this.clip;
      m.needsUpdate = true;
    }
    this.requestRender();
  }

  /**
   * The rotation of the view as a CSS `matrix3d` (D4.3): what turns a cube drawn with x to the right, y down and z toward the viewer so that it shows
   * the model's axes as the camera sees them.
   */
  cubeMatrix(): number[] {
    this.camera.updateMatrixWorld();
    const e = this.camera.matrixWorldInverse.clone().copy(this.camera.matrixWorld).invert().elements;
    // column-major, rotation only. The cube is drawn in CSS's frame (y down) and the camera's is y up: M = S · R · S, S turning y over
    const r = (row: number, col: number) => e[col * 4 + row]!;
    const m = (row: number, col: number) => (row === 1 ? -1 : 1) * (col === 1 ? -1 : 1) * r(row, col);
    return [m(0, 0), m(1, 0), m(2, 0), 0, m(0, 1), m(1, 1), m(2, 1), 0, m(0, 2), m(1, 2), m(2, 2), 0, 0, 0, 0, 1];
  }

  /** Called whenever the camera moves, zooms or the viewport is resized. Returns the way to stop. */
  subscribeView(fn: () => void): () => void {
    this.viewListeners.add(fn);
    return () => this.viewListeners.delete(fn);
  }

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
    const box = this.contentBox();
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
    if (this.originShown) this.paintOrigin(); // a constant size on screen
    if (this.datums.points.length + this.datums.systems.length > 0) this.paintDatums();
    this.events.onViewChange?.();
    for (const fn of this.viewListeners) fn();
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

  /**
   * The picture on the screen as a PNG (F3.3), the size of the canvas: drawn again and taken in the same step, since the canvas does not keep what it
   * showed. Null when the browser cannot make one.
   */
  snapshot(): Promise<Blob | null> {
    this.render();
    return new Promise((resolve) => this.renderer.domElement.toBlob(resolve, 'image/png'));
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

function clearMarks(marks: THREE.Group): void {
  for (const m of [...marks.children]) {
    marks.remove(m);
    const o = m as THREE.Mesh;
    o.geometry.dispose();
    (o.material as THREE.Material).dispose();
  }
}
