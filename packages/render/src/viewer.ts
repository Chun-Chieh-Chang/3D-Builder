import * as THREE from 'three';
import { ViewControls } from './controls';

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

export interface ViewerEvents {
  /** Edge under the cursor changed (index into the mesh's edges, or -1). */
  onEdgeHover?: (edge: number) => void;
  /** Left click on an edge (or -1 on empty space / faces). */
  onEdgeClick?: (edge: number, additive: boolean) => void;
}

/**
 * Framework-agnostic viewport (A4.2, A5.1, D4): shaded body with black edges, orthographic
 * camera like SolidWorks, a headlight, edge picking and highlighting, and a reference triad.
 */
export class Viewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly controls: ViewControls;
  private readonly triadScene = new THREE.Scene();
  private readonly triadCamera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
  private body: THREE.Mesh | null = null;
  private edges: THREE.LineSegments | null = null;
  /** segmentEdge[s] = edge index owning line segment s. */
  private segmentEdge = new Int32Array(0);
  /** First segment and segment count per edge. */
  private edgeSegments: [number, number][] = [];
  private hovered = -1;
  private selected = new Set<number>();
  private pickEdges = false;
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

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e5, 1e5);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const headlight = new THREE.DirectionalLight(0xffffff, 1.8);
    headlight.position.set(0.3, 0.4, 1);
    this.camera.add(headlight);
    this.scene.add(this.camera);
    this.buildTriad();

    this.controls = new ViewControls(this.camera, this.renderer.domElement, () => this.requestRender());
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('click', this.onClick);
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
    this.renderer.dispose();
    this.renderer.domElement.remove();
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
    }
    this.hovered = -1;
    this.selected.clear();
    if (fit) this.fitAll();
    this.requestRender();
  }

  private buildEdges(mesh: ViewMesh): void {
    const segs: number[] = [];
    const owner: number[] = [];
    this.edgeSegments = [];
    for (let g = 0; g < mesh.edgeRanges.length; g += 3) {
      const start = mesh.edgeRanges[g]!;
      const count = mesh.edgeRanges[g + 1]!;
      const edge = mesh.edgeRanges[g + 2]!;
      this.edgeSegments[edge] = [owner.length, Math.max(0, count - 1)];
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

  // ---------------------------------------------------------------- selection

  /** Enables edge hover/click picking (e.g. while a fillet's edge list is active). */
  setEdgePicking(enabled: boolean): void {
    this.pickEdges = enabled;
    if (!enabled) this.setHovered(-1);
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
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.params.Line = { threshold: (6 * (this.camera.right - this.camera.left)) / this.camera.zoom / rect.width };
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObject(this.edges);
    // Prefer edges not hidden behind the body.
    const bodyHit = this.body ? ray.intersectObject(this.body)[0]?.distance ?? Infinity : Infinity;
    const visible = hits.filter((h) => h.distance <= bodyHit + 1e-3 * (this.camera.right - this.camera.left) / this.camera.zoom);
    const hit = (visible[0] ?? null);
    return hit && hit.index !== undefined ? (this.segmentEdge[Math.floor(hit.index / 2)] ?? -1) : -1;
  }

  private onPointerMove = (e: PointerEvent) => {
    if (!this.pickEdges || e.buttons !== 0) return;
    this.setHovered(this.pick(e.clientX, e.clientY));
  };

  private onClick = (e: MouseEvent) => {
    if (!this.pickEdges || e.altKey) return;
    this.events.onEdgeClick?.(this.pick(e.clientX, e.clientY), e.ctrlKey || e.shiftKey);
  };

  // ---------------------------------------------------------------- views

  setView(view: StandardView): void {
    const [dir, up] = VIEW_DIRS[view];
    const dist = 1000;
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.camera.up.copy(up);
    this.camera.lookAt(this.controls.target);
    this.fitAll();
  }

  /** Zoom to fit (「全部顯示」). */
  fitAll(): void {
    const box = new THREE.Box3();
    if (this.body) box.setFromObject(this.body);
    if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, -50), new THREE.Vector3(50, 50, 50));
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 50;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, radius * 10);
    this.camera.lookAt(center);
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const aspect = w / h;
    const half = radius * 1.15;
    this.camera.left = -half * Math.max(aspect, 1);
    this.camera.right = half * Math.max(aspect, 1);
    this.camera.top = half / Math.min(aspect, 1);
    this.camera.bottom = -half / Math.min(aspect, 1);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    const halfH = (this.camera.top - this.camera.bottom) / 2 || 1;
    this.camera.left = -halfH * (w / h);
    this.camera.right = halfH * (w / h);
    this.camera.updateProjectionMatrix();
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
