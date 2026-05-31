import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type CadMode = 'PART' | 'ASSEMBLY' | 'DRAWING' | 'RENDER';
export type MeasurementMode = 'NONE' | 'DISTANCE' | 'ANGLE' | 'AREA' | 'VOLUME';
export type MateType = 'COINCIDENT' | 'PARALLEL' | 'CONCENTRIC' | 'DISTANCE' | 'PERPENDICULAR' | 'TANGENT' | 'ANGLE';

export interface MateEntity {
  componentId: string;
  topologyId: string;
  /** World-space point on the selected face/edge (assembly solver). */
  localOrigin?: [number, number, number];
  /** Face normal or edge direction in component space. */
  localNormal?: [number, number, number];
}

export interface CADMate {
  id: string;
  name: string;
  type: MateType;
  entity1: MateEntity;
  entity2: MateEntity;
  parameters?: { offset?: number; angle?: number; alignmentFlip?: boolean };
  alignment?: 'ALIGNED' | 'ANTI_ALIGNED';
  offset?: number;
  angle?: number;
}

export interface CADFeature {
  id: string;
  type: string;
  name: string;
  parameters: any;
  isSuppressed?: boolean;
  isBroken?: boolean;
  color?: string;
  materialId?: string;
}

export interface CADReferencePlane {
  id: string;
  name: string;
  origin: [number, number, number];
  normal: [number, number, number];
  xDir: [number, number, number];
  yDir: [number, number, number];
}

export interface SketchNode {
  id: string;
  x: number;
  y: number;
  isFixed?: boolean;
}

export interface SketchEdge {
  id: string;
  type: 'LINE' | 'ARC' | 'CIRCLE' | 'CENTER_LINE' | 'SPLINE';
  nodeIds: string[];
  isConstruction?: boolean;
}

export interface SketchConstraint {
  id: string;
  type: 'COINCIDENT' | 'HORIZONTAL' | 'VERTICAL' | 'DISTANCE' | 'EQUAL' | 'CONCENTRIC' | 'TANGENT' | 'ANGLE' | 'PARALLEL' | 'PERPENDICULAR' | 'SYMMETRIC' | 'MIDPOINT';
  nodeIds?: string[];
  edgeIds?: string[];
  value?: number;
  offset?: number;
}

export interface CADComponent {
  id: string;
  partId: string;
  instanceName: string;
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
  };
  visible: boolean;
  isFixed?: boolean;
  color?: string;
  materialId?: string;
}

export interface CADShortcutBox {
  visible: boolean;
  x: number;
  y: number;
}

export interface SectionViewState {
  isActive: boolean;
  plane: 'FRONT' | 'TOP' | 'RIGHT';
  offset: number;
  flip: boolean;
}

export type CadToastType = 'error' | 'warning' | 'info';

export interface CadToastItem {
  id: string;
  message: string;
  type: CadToastType;
}

export interface CADContextMenu {
  visible: boolean;
  x: number;
  y: number;
  type?: 'BACKGROUND' | 'ENTITY' | 'FEATURE';
  data?: any;
}

export interface MeasurementResult {
    mode?: string;
    value?: number;
  offset?: number;
    unit?: string;
    details?: any;
    distance?: number;
    angle?: number;
    area?: number;
    volume?: number;
    center_of_mass?: [number, number, number];
    inertia_matrix?: number[][];
}
export interface CadState {
  projectName: string;
  setProjectName: (name: string) => void;

  drawingScale: string;
  setDrawingScale: (scale: string) => void;
  drawnBy: string;
  setDrawnBy: (name: string) => void;
  approvedBy: string;
  setApprovedBy: (name: string) => void;

  mode: CadMode;
  setMode: (mode: CadMode) => void;
  activeComponentId: string | null;
  setActiveComponentId: (id: string | null) => void;
  isSketchMode: boolean;
  setSketchMode: (active: boolean) => void;
  smartDimensionActive: boolean;
  setSmartDimensionActive: (active: boolean) => void;
  activePlane: string | null;
  setActivePlane: (plane: string | null) => void;
  activeFaceOrigin: [number, number, number] | null;
  setActiveFaceOrigin: (origin: [number, number, number] | null) => void;
  activeFaceNormal: [number, number, number] | null;
  setActiveFaceNormal: (normal: [number, number, number] | null) => void;
  activeFaceId: string | null;
  setActiveFaceId: (id: string | null) => void;

  sketchTool: string;
  setSketchTool: (tool: string) => void;
  gridSnap: boolean;
  setGridSnap: (active: boolean) => void;
  sketchNewChain: boolean;
  setSketchNewChain: (active: boolean) => void;
  selectedEntityIds: string[];
  setSelectedEntityIds: (ids: string[] | ((prev: string[]) => string[])) => void;

  sketchNodes: Record<string, SketchNode>;
  setSketchNodes: (nodes: Record<string, SketchNode> | ((prev: Record<string, SketchNode>) => Record<string, SketchNode>)) => void;
  sketchEdges: Record<string, SketchEdge>;
  setSketchEdges: (edges: Record<string, SketchEdge> | ((prev: Record<string, SketchEdge>) => Record<string, SketchEdge>)) => void;
  sketchConstraints: Record<string, SketchConstraint>;
  setSketchConstraints: (constraints: Record<string, SketchConstraint> | ((prev: Record<string, SketchConstraint>) => Record<string, SketchConstraint>)) => void;

  features: CADFeature[];
  setFeatures: (features: CADFeature[]) => void;
  addFeature: (feature: CADFeature) => void;
  removeFeature: (id: string) => void;
  removeFeatures: (ids: string[]) => void;
  updateFeatureParams: (id: string, params: any) => void;
  updateFeatureProperty: (id: string, key: string, value: any) => void;
  editingFeatureId: string | null;
  setEditingFeatureId: (id: string | null) => void;
  rollbackIndex: number | null;
  setRollbackIndex: (index: number | null) => void;

  /** When false, debounced rebuild can skip identical feature-tree fingerprints. */
  rebuildDirty: boolean;
  /** First feature index affected by the latest edit (for future incremental kernel rebuild). */
  dirtyFromFeatureIndex: number;
  markRebuildDirty: (fromFeatureIndex?: number) => void;
  clearRebuildDirty: () => void;

  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  selectedSubNodeType: 'SKETCH' | 'FEATURE' | null;
  setSelectedSubNodeType: (type: 'SKETCH' | 'FEATURE' | null) => void;
  visibleSketches: string[];
  toggleSketchVisibility: (featureId: string) => void;

  // History
  setSuppressed: (id: string, suppressed: boolean) => void;
  reorderFeatures: (startIndex: number, endIndex: number) => void;
  checkDependencies: () => void;
  
  hoveredTreeId: string | null;
  setHoveredTreeId: (id: string | null) => void;
  hoveredChildren: string[];
  setHoveredChildren: (ids: string[]) => void;

  // Undo/Redo System
  history: {
    past: any[];
    future: any[];
  };
  undo: () => void;
  redo: () => void;
  saveSnapshot: () => void;

  selectedTopology: any;
  setSelectedTopology: (topology: any) => void;

  measurementMode: MeasurementMode;
  setMeasurementMode: (mode: MeasurementMode) => void;
  measurementPoints: any[];
  setMeasurementPoints: (points: any[]) => void;
  measurementResults: MeasurementResult | null;
  setMeasurementResults: (results: MeasurementResult | null) => void;

  components: CADComponent[];
  setComponents: (components: CADComponent[]) => void;
  addComponent: (component: CADComponent) => void;
  removeComponent: (id: string) => void;
  updateComponentTransform: (id: string, position: [number, number, number], rotation: [number, number, number]) => void;
  updateComponentColor: (id: string, color: string) => void;
  toggleComponentFixed: (id: string) => void;
  mates: CADMate[];
  setMates: (mates: CADMate[]) => void;
  addMate: (mate: CADMate) => void;
  removeMate: (id: string) => void;

  mateSelection: any[];
  setMateSelection: (selection: any[]) => void;
  addMateSelection: (entity: any) => void;
  clearMateSelection: () => void;

  meshData: any[];
  setMeshData: (data: any[]) => void;
  interferenceMeshes: any[];
  setInterferenceMeshes: (data: any[]) => void;
  interferenceResults: any[];
  setInterferenceResults: (results: any[]) => void;
  interferenceActive: boolean;
  setInterferenceActive: (active: boolean) => void;
  solverReport: { dof: number; residual: number } | null;
  setSolverReport: (report: { dof: number; residual: number } | null) => void;
  computedRefGeometry: any[];
  setComputedRefGeometry: (refGeom: any[]) => void;

  contextMenu: CADContextMenu | null;
  setContextMenu: (menu: CADContextMenu | null) => void;
  shortcutBox: CADShortcutBox | null;
  setShortcutBox: (box: CADShortcutBox | null) => void;
  mousePos: [number, number, number];
  setMousePos: (pos: [number, number, number]) => void;

  hint: string;
  setHint: (hint: string) => void;

  danglingNodes: [number, number, number][];
  setDanglingNodes: (nodes: [number, number, number][]) => void;

  toasts: CadToastItem[];
  pushToast: (message: string, type?: CadToastType) => void;
  dismissToast: (id: string) => void;

  /** SolidWorks-style applied-feature placement: pick edges after ribbon command. */
  pendingFeatureCommand: 'FILLET' | 'CHAMFER' | 'THICKEN' | 'PATTERN' | 'MIRROR' | 'DRAFT' | 'SHELL' | 'HOLE_WIZARD' | 'PLANE' | null;
  setPendingFeatureCommand: (cmd: 'FILLET' | 'CHAMFER' | 'THICKEN' | 'PATTERN' | 'MIRROR' | 'DRAFT' | 'SHELL' | 'HOLE_WIZARD' | 'PLANE' | null) => void;
  defaultFilletRadius: number;
  defaultChamferDistance: number;
  
  referencePlanes: CADReferencePlane[];
  setReferencePlanes: (planes: CADReferencePlane[]) => void;
  referenceAxes: any[];
  setReferenceAxes: (axes: any[]) => void;
  
  activePropertyManager: any;
  setActivePropertyManager: (mgr: any) => void;

  viewportDisplayMode: 'SHADED' | 'SHADED_EDGES' | 'WIREFRAME';
  setViewportDisplayMode: (mode: 'SHADED' | 'SHADED_EDGES' | 'WIREFRAME') => void;

  cameraNormalTrigger: number;
  cameraNormalFlip: boolean;
  cameraNormalLastPlane: string | null;
  triggerCameraNormal: () => void;
  controls: any;
  setControls: (controls: any) => void;
  isCameraAnimating: boolean;
  setIsCameraAnimating: (active: boolean) => void;
  
  sectionView: SectionViewState;
  setSectionView: (view: Partial<SectionViewState>) => void;

  // Render & Appearance
  partMaterial: string;
  setPartMaterial: (material: string) => void;
  environmentMap: string;
  setEnvironmentMap: (env: string) => void;
}

export const MATERIAL_PRESETS: Record<string, {
  color: string;
  roughness: number;
  metalness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  transmission?: number;
  ior?: number;
  thickness?: number;
}> = {
  Steel: { color: '#8c929c', roughness: 0.3, metalness: 0.8, clearcoat: 0.1 },
  Aluminum: { color: '#d5d7db', roughness: 0.4, metalness: 0.9 },
  Gold: { color: '#f0ce4a', roughness: 0.1, metalness: 1.0, clearcoat: 0.2 },
  Copper: { color: '#b87333', roughness: 0.2, metalness: 0.95 },
  'Glossy Plastic': { color: '#e74c3c', roughness: 0.05, metalness: 0.05, clearcoat: 1.0, clearcoatRoughness: 0.1 },
  'Matte Plastic': { color: '#2c3e50', roughness: 0.8, metalness: 0.0 },
  Glass: { color: '#ffffff', roughness: 0.0, metalness: 0.0, transmission: 1.0, ior: 1.5, thickness: 2.0, clearcoat: 1.0 },
};

export const useCadStore = create<CadState>()(
  persist(
    (set, get) => ({
      projectName: 'Professional CAD Project',
      setProjectName: (projectName) => set({ projectName }),
      drawingScale: '1:1',
      setDrawingScale: (drawingScale) => set({ drawingScale }),
      drawnBy: 'SkillsBuilder',
      setDrawnBy: (drawnBy) => set({ drawnBy }),
      approvedBy: 'Admin',
      setApprovedBy: (approvedBy) => set({ approvedBy }),

      mode: 'PART',
      setMode: (mode) => set({ mode }),
      activeComponentId: null,
      setActiveComponentId: (activeComponentId) => set({ activeComponentId }),
      isSketchMode: false,
      setSketchMode: (isSketchMode) => set({ isSketchMode }),
      smartDimensionActive: false,
      setSmartDimensionActive: (smartDimensionActive) => set({ smartDimensionActive }),
      activePlane: null,
      setActivePlane: (activePlane) => set({ activePlane }),
      activeFaceOrigin: null,
      setActiveFaceOrigin: (activeFaceOrigin) => set({ activeFaceOrigin }),
      activeFaceNormal: null,
      setActiveFaceNormal: (activeFaceNormal) => set({ activeFaceNormal }),
      activeFaceId: null,
      setActiveFaceId: (activeFaceId) => set({ activeFaceId }),

      sketchTool: 'SELECT',
      setSketchTool: (sketchTool) => set({ sketchTool }),
      gridSnap: true,
      setGridSnap: (gridSnap) => set({ gridSnap }),
      sketchNewChain: false,
      setSketchNewChain: (sketchNewChain) => set({ sketchNewChain }),
      selectedEntityIds: [],
      setSelectedEntityIds: (ids) => set((state) => ({ 
        selectedEntityIds: typeof ids === 'function' ? ids(state.selectedEntityIds) : ids 
      })),

      sketchNodes: {},
      setSketchNodes: (nodes) => {
        get().markRebuildDirty(0);
        set((state) => ({
          sketchNodes: typeof nodes === 'function' ? nodes(state.sketchNodes) : nodes
        }));
      },
      sketchEdges: {},
      setSketchEdges: (edges) => {
        get().markRebuildDirty(0);
        set((state) => ({
          sketchEdges: typeof edges === 'function' ? edges(state.sketchEdges) : edges
        }));
      },
      sketchConstraints: {},
      setSketchConstraints: (constraints) => {
        get().markRebuildDirty(0);
        set((state) => ({
          sketchConstraints: typeof constraints === 'function' ? constraints(state.sketchConstraints) : constraints
        }));
      },

      features: [{ id: 'ai_constructed_cylinder', type: 'CYLINDER', name: 'AI Built Cylinder', parameters: { radius: 20, height: 50, x: 0, y: 0, z: 0 } }],
      setFeatures: (features) => {
        get().saveSnapshot();
        get().markRebuildDirty(0);
        set({ features });
      },
      addFeature: (feature) => {
        get().saveSnapshot();
        const fromIndex = get().features.length;
        get().markRebuildDirty(fromIndex);
        set((state) => ({ features: [...state.features, feature] }));
      },
      removeFeature: (id) => {
        get().saveSnapshot();
        const fromIndex = get().features.findIndex((f) => f.id === id);
        get().markRebuildDirty(fromIndex >= 0 ? fromIndex : 0);
        set((state) => ({ features: state.features.filter(f => f.id !== id) }));
      },
      removeFeatures: (ids) => {
        get().saveSnapshot();
        let minIndex = get().features.length;
        ids.forEach(id => {
          const idx = get().features.findIndex(f => f.id === id);
          if (idx >= 0 && idx < minIndex) minIndex = idx;
        });
        get().markRebuildDirty(minIndex < get().features.length ? minIndex : 0);
        set((state) => ({ features: state.features.filter(f => !ids.includes(f.id)) }));
      },
      updateFeatureParams: (id, params) => {
        get().saveSnapshot();
        const fromIndex = get().features.findIndex((f) => f.id === id);
        get().markRebuildDirty(fromIndex >= 0 ? fromIndex : 0);
        set((state) => ({
          features: state.features.map(f => f.id === id ? { ...f, parameters: { ...f.parameters, ...params } } : f)
        }));
      },
      updateFeatureProperty: (id, key, value) => {
        get().saveSnapshot();
        const fromIndex = get().features.findIndex((f) => f.id === id);
        get().markRebuildDirty(fromIndex >= 0 ? fromIndex : 0);
        set((state) => ({
          features: state.features.map(f => f.id === id ? { ...f, [key]: value } : f)
        }));
      },

      rebuildDirty: true,
      dirtyFromFeatureIndex: 0,
      markRebuildDirty: (fromFeatureIndex = 0) => set((state) => ({
        rebuildDirty: true,
        dirtyFromFeatureIndex: Math.min(state.dirtyFromFeatureIndex, fromFeatureIndex),
      })),
      clearRebuildDirty: () => set({
        rebuildDirty: false,
        dirtyFromFeatureIndex: Number.MAX_SAFE_INTEGER,
      }),

      editingFeatureId: null,
      setEditingFeatureId: (editingFeatureId) => set({ editingFeatureId }),
      rollbackIndex: null,
      setRollbackIndex: (rollbackIndex) => set({ rollbackIndex, rebuildDirty: true }),

      selectedId: null,
      setSelectedId: (selectedId) => set({ selectedId }),
      selectedSubNodeType: null,
      setSelectedSubNodeType: (selectedSubNodeType) => set({ selectedSubNodeType }),
      visibleSketches: [],
      toggleSketchVisibility: (featureId) => set((state) => ({
        visibleSketches: state.visibleSketches.includes(featureId) ? state.visibleSketches.filter(id => id !== featureId) : [...state.visibleSketches, featureId]
      })),

      setSuppressed: (id, suppressed) => {
        get().saveSnapshot();
        const fromIndex = get().features.findIndex((f) => f.id === id);
        get().markRebuildDirty(fromIndex >= 0 ? fromIndex : 0);
        set((state) => ({
          features: state.features.map(f => f.id === id ? { ...f, isSuppressed: suppressed } : f)
        }));
      },
      reorderFeatures: (startIndex, endIndex) => {
        get().saveSnapshot();
        get().markRebuildDirty(Math.min(startIndex, endIndex));
        set((state) => {
          const nextFeatures = [...state.features];
          const [removed] = nextFeatures.splice(startIndex, 1);
          nextFeatures.splice(endIndex, 0, removed);
          return { features: nextFeatures };
        });
      },
      checkDependencies: () => set((state) => {
        const features = [...state.features];
        return { features: features.map((f, idx) => {
           if (f.type === 'FILLET' || f.type === 'CHAMFER') {
              const targetId = f.parameters?.target_feature_id;
              if (targetId) {
                const parentIdx = features.findIndex(p => p.id === targetId);
                if (parentIdx === -1 || parentIdx >= idx) return { ...f, isBroken: true };
              }
           }
           return { ...f, isBroken: false };
        })};
      }),

      hoveredTreeId: null,
      setHoveredTreeId: (id) => set({ hoveredTreeId: id }),
      hoveredChildren: [],
      setHoveredChildren: (ids) => set({ hoveredChildren: ids }),

      history: { past: [], future: [] },
      saveSnapshot: () => set((state) => {
        const snapshot = {
          features: state.features,
          sketchNodes: state.sketchNodes,
          sketchEdges: state.sketchEdges,
          sketchConstraints: state.sketchConstraints,
          mates: state.mates,
          components: state.components
        };
        return {
          history: {
            past: [...state.history.past.slice(-50), snapshot],
            future: []
          }
        };
      }),
      undo: () => set((state) => {
        if (state.history.past.length === 0) return state;
        const previous = state.history.past[state.history.past.length - 1];
        const newPast = state.history.past.slice(0, state.history.past.length - 1);
        const current = {
          features: state.features,
          sketchNodes: state.sketchNodes,
          sketchEdges: state.sketchEdges,
          sketchConstraints: state.sketchConstraints,
          mates: state.mates,
          components: state.components
        };
        return {
          ...previous,
          rebuildDirty: true,
          history: { past: newPast, future: [current, ...state.history.future] }
        };
      }),
      redo: () => set((state) => {
        if (state.history.future.length === 0) return state;
        const next = state.history.future[0];
        const newFuture = state.history.future.slice(1);
        const current = {
          features: state.features,
          sketchNodes: state.sketchNodes,
          sketchEdges: state.sketchEdges,
          sketchConstraints: state.sketchConstraints,
          mates: state.mates,
          components: state.components
        };
        return {
          ...next,
          rebuildDirty: true,
          history: { past: [...state.history.past, current], future: newFuture }
        };
      }),

      selectedTopology: null,
      setSelectedTopology: (selectedTopology) => set({ selectedTopology }),
      measurementMode: 'NONE',
      setMeasurementMode: (measurementMode) => set({ measurementMode }),
      measurementPoints: [],
      setMeasurementPoints: (measurementPoints) => set({ measurementPoints }),
      measurementResults: null,
      setMeasurementResults: (measurementResults) => set({ measurementResults }),

      components: [],
      setComponents: (components) => set({ components }),
      addComponent: (component) => set((state) => ({ components: [...state.components, component] })),
      removeComponent: (id) => set((state) => ({
        components: state.components.filter(c => c.id !== id),
        mates: state.mates.filter(m => m.entity1.componentId !== id && m.entity2.componentId !== id)
      })),
      updateComponentTransform: (id, position, rotation) => set((state) => {
        get().saveSnapshot();
        return {
          components: state.components.map(c => 
            c.id === id ? { ...c, transform: { position, rotation } } : c
          )
        };
      }),
      updateComponentColor: (id, color) => set((state) => {
        get().saveSnapshot();
        return {
          components: state.components.map(c => 
            c.id === id ? { ...c, color } : c
          )
        };
      }),
      toggleComponentFixed: (id) => set((state) => {
        get().saveSnapshot();
        return {
          components: state.components.map(c =>
            c.id === id ? { ...c, isFixed: !c.isFixed } : c
          )
        };
      }),

      mates: [],
      setMates: (mates) => set({ mates }),
      addMate: (mate) => set((state) => {
        get().saveSnapshot();
        return { mates: [...state.mates, mate] };
      }),
      removeMate: (id) => set((state) => {
        get().saveSnapshot();
        return { mates: state.mates.filter(m => m.id !== id) };
      }),
      mateSelection: [],
      setMateSelection: (mateSelection) => set({ mateSelection }),
      addMateSelection: (entity) => set((state) => ({ mateSelection: [...state.mateSelection, entity] })),
      clearMateSelection: () => set({ mateSelection: [] }),
meshData: [],
setMeshData: (meshData) => set({ meshData }),
interferenceMeshes: [],
setInterferenceMeshes: (interferenceMeshes) => set({ interferenceMeshes }),
interferenceResults: [],
setInterferenceResults: (interferenceResults) => set({ interferenceResults }),
interferenceActive: false,
setInterferenceActive: (interferenceActive) => set({ interferenceActive }),
solverReport: null,

      setSolverReport: (solverReport) => set({ solverReport }),
      computedRefGeometry: [],
      setComputedRefGeometry: (computedRefGeometry) => set({ computedRefGeometry }),

      contextMenu: null,
      setContextMenu: (contextMenu) => set({ contextMenu }),
      shortcutBox: null,
      setShortcutBox: (shortcutBox) => set({ shortcutBox }),
      mousePos: [0, 0, 0],
      setMousePos: (mousePos) => set({ mousePos }),
      hint: 'Ready',
      setHint: (hint) => set({ hint }),

      danglingNodes: [],
      setDanglingNodes: (danglingNodes) => set({ danglingNodes }),

      toasts: [],
      pushToast: (message, type = 'error') => {
        const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        set((state) => ({
          toasts: [...state.toasts.slice(-4), { id, message, type }],
        }));
        setTimeout(() => {
          const current = get().toasts;
          if (current.some((t) => t.id === id)) {
            set({ toasts: current.filter((t) => t.id !== id) });
          }
        }, 7000);
      },
      dismissToast: (id) =>
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
      pendingFeatureCommand: null,
      setPendingFeatureCommand: (cmd) => set({ pendingFeatureCommand: cmd }),
      defaultFilletRadius: 2,
      defaultChamferDistance: 1.5,
      referencePlanes: [],
      setReferencePlanes: (referencePlanes) => set({ referencePlanes }),
      referenceAxes: [],
      setReferenceAxes: (referenceAxes) => set({ referenceAxes }),
      activePropertyManager: null,
      setActivePropertyManager: (activePropertyManager) => set({ activePropertyManager }),

      viewportDisplayMode: 'SHADED_EDGES',
      setViewportDisplayMode: (viewportDisplayMode) => set({ viewportDisplayMode }),

      cameraNormalTrigger: 0,
      cameraNormalFlip: false,
      cameraNormalLastPlane: null,
      triggerCameraNormal: () => set((state) => {
        const isSamePlane = state.cameraNormalLastPlane === state.activePlane;
        return {
          cameraNormalTrigger: state.cameraNormalTrigger + 1,
          cameraNormalLastPlane: state.activePlane,
          cameraNormalFlip: isSamePlane ? !state.cameraNormalFlip : false
        };
      }),
      controls: null,
      setControls: (controls) => set({ controls }),
      isCameraAnimating: false,
      setIsCameraAnimating: (isCameraAnimating) => set({ isCameraAnimating }),

      sectionView: { isActive: false, plane: 'FRONT', offset: 0, flip: false },
      setSectionView: (view) => set((state) => ({ sectionView: { ...state.sectionView, ...view } })),

      partMaterial: 'Steel',
      setPartMaterial: (m) => set({ partMaterial: m }),
      environmentMap: 'studio',
      setEnvironmentMap: (env) => set({ environmentMap: env }),
    }),
    {
      name: 'cad-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        mode: state.mode,
        features: state.features,
        sketchNodes: state.sketchNodes,
        sketchEdges: state.sketchEdges,
        sketchConstraints: state.sketchConstraints,
        components: state.components,
        mates: state.mates,
        activePlane: state.activePlane,
        activeFaceOrigin: state.activeFaceOrigin,
        activeFaceNormal: state.activeFaceNormal,
        activeFaceId: state.activeFaceId,
        referencePlanes: state.referencePlanes,
        referenceAxes: state.referenceAxes,
        projectName: state.projectName,
        drawingScale: state.drawingScale,
        drawnBy: state.drawnBy,
        approvedBy: state.approvedBy,
        partMaterial: state.partMaterial,
        environmentMap: state.environmentMap,
      }),
    }
  )
);
