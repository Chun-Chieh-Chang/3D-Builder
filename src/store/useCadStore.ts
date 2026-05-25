import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type CadMode = 'PART' | 'ASSEMBLY' | 'DRAWING';
export type MeasurementMode = 'NONE' | 'DISTANCE' | 'ANGLE' | 'AREA' | 'VOLUME';
export type MateType = 'COINCIDENT' | 'PARALLEL' | 'CONCENTRIC' | 'DISTANCE' | 'PERPENDICULAR' | 'TANGENT';

export interface MateEntity {
  componentId: string;
  topologyId: string;
}

export interface CADMate {
  id: string;
  name: string;
  type: MateType;
  entity1: MateEntity;
  entity2: MateEntity;
  parameters?: { offset?: number; alignmentFlip?: boolean };
  alignment?: 'ALIGNED' | 'ANTI_ALIGNED';
  offset?: number;
}

export interface CADFeature {
  id: string;
  type: string;
  name: string;
  parameters: any;
  isSuppressed?: boolean;
  isBroken?: boolean;
}

export interface SketchNode {
  id: string;
  x: number;
  y: number;
  isFixed?: boolean;
}

export interface SketchEdge {
  id: string;
  type: 'LINE' | 'ARC' | 'CIRCLE' | 'CENTER_LINE';
  nodeIds: string[];
  isConstruction?: boolean;
}

export interface SketchConstraint {
  id: string;
  type: 'COINCIDENT' | 'HORIZONTAL' | 'VERTICAL' | 'DISTANCE' | 'EQUAL' | 'CONCENTRIC' | 'TANGENT' | 'ANGLE';
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
}

export interface CADShortcutBox {
  visible: boolean;
  x: number;
  y: number;
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

interface CadState {
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
  setSketchRelations: (rels: any) => void;

  features: CADFeature[];
  setFeatures: (features: CADFeature[]) => void;
  addFeature: (feature: CADFeature) => void;
  removeFeature: (id: string) => void;
  updateFeatureParams: (id: string, params: any) => void;
  editingFeatureId: string | null;
  setEditingFeatureId: (id: string | null) => void;
  rollbackIndex: number | null;
  setRollbackIndex: (index: number | null) => void;

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
  mates: CADMate[];
  setMates: (mates: CADMate[]) => void;
  addMate: (mate: CADMate) => void;

  mateSelection: any[];
  setMateSelection: (selection: any[]) => void;
  addMateSelection: (entity: any) => void;
  clearMateSelection: () => void;

  meshData: any[];
  setMeshData: (data: any[]) => void;
  solverReport: { dof: number; residual: number } | null;
  setSolverReport: (report: { dof: number; residual: number } | null) => void;
  computedRefGeometry: any[];
  setComputedRefGeometry: (refGeom: any[]) => void;

  contextMenu: CADContextMenu | null;
  setContextMenu: (menu: CADContextMenu | null) => void;
  shortcutBox: CADShortcutBox | null;
  setShortcutBox: (box: CADShortcutBox | null) => void;
  mousePos: [number, number, number] | null;
  setMousePos: (pos: [number, number, number] | null) => void;

  hint: string;
  setHint: (hint: string) => void;
  
  referencePlanes: any[];
  setReferencePlanes: (planes: any[]) => void;
  referenceAxes: any[];
  setReferenceAxes: (axes: any[]) => void;
  
  activePropertyManager: any;
  setActivePropertyManager: (mgr: any) => void;

  cameraNormalTrigger: number;
  cameraNormalFlip: boolean;
  cameraNormalLastPlane: string | null;
  triggerCameraNormal: () => void;
  controls: any;
  setControls: (controls: any) => void;
  isCameraAnimating: boolean;
  setIsCameraAnimating: (active: boolean) => void;
}

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
      setSketchNodes: (nodes) => set((state) => ({ 
        sketchNodes: typeof nodes === 'function' ? nodes(state.sketchNodes) : nodes 
      })),
      sketchEdges: {},
      setSketchEdges: (edges) => set((state) => ({ 
        sketchEdges: typeof edges === 'function' ? edges(state.sketchEdges) : edges 
      })),
      sketchConstraints: {},
      setSketchConstraints: (constraints) => set((state) => ({ 
        sketchConstraints: typeof constraints === 'function' ? constraints(state.sketchConstraints) : constraints 
      })),
      setSketchRelations: (rels) => {},

      features: [{ id: 'ai_constructed_cylinder', type: 'CYLINDER', name: 'AI Built Cylinder', parameters: { radius: 20, height: 50, x: 0, y: 0, z: 0 } }],
      setFeatures: (features) => { get().saveSnapshot(); set({ features }); },
      addFeature: (feature) => { get().saveSnapshot(); set((state) => ({ features: [...state.features, feature] })); },
      removeFeature: (id) => { get().saveSnapshot(); set((state) => ({ features: state.features.filter(f => f.id !== id) })); },
      updateFeatureParams: (id, params) => { get().saveSnapshot(); set((state) => ({
        features: state.features.map(f => f.id === id ? { ...f, parameters: { ...f.parameters, ...params } } : f)
      })); },
      
      editingFeatureId: null,
      setEditingFeatureId: (editingFeatureId) => set({ editingFeatureId }),
      rollbackIndex: null,
      setRollbackIndex: (rollbackIndex) => set({ rollbackIndex }),

      selectedId: null,
      setSelectedId: (selectedId) => set({ selectedId }),
      selectedSubNodeType: null,
      setSelectedSubNodeType: (selectedSubNodeType) => set({ selectedSubNodeType }),
      visibleSketches: [],
      toggleSketchVisibility: (featureId) => set((state) => ({
        visibleSketches: state.visibleSketches.includes(featureId) ? state.visibleSketches.filter(id => id !== featureId) : [...state.visibleSketches, featureId]
      })),

      setSuppressed: (id, suppressed) => { get().saveSnapshot(); set((state) => ({
        features: state.features.map(f => f.id === id ? { ...f, isSuppressed: suppressed } : f)
      })); },
      reorderFeatures: (startIndex, endIndex) => { get().saveSnapshot(); set((state) => {
        const nextFeatures = [...state.features];
        const [removed] = nextFeatures.splice(startIndex, 1);
        nextFeatures.splice(endIndex, 0, removed);
        return { features: nextFeatures };
      }); },
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
      addComponent: (component) => { get().saveSnapshot(); set((state) => ({ components: [...state.components, component] })); },
      mates: [],
      setMates: (mates) => { get().saveSnapshot(); set({ mates }); },
      addMate: (mate) => { get().saveSnapshot(); set((state) => ({ mates: [...state.mates, mate] })); },

      mateSelection: [],
      setMateSelection: (mateSelection) => set({ mateSelection }),
      addMateSelection: (entity) => set((state) => ({ mateSelection: [...state.mateSelection, entity] })),
      clearMateSelection: () => set({ mateSelection: [] }),

      meshData: [],
      setMeshData: (meshData) => set({ meshData }),
      solverReport: null,
      setSolverReport: (solverReport) => set({ solverReport }),
      computedRefGeometry: [],
      setComputedRefGeometry: (computedRefGeometry) => set({ computedRefGeometry }),

      contextMenu: null,
      setContextMenu: (contextMenu) => set({ contextMenu }),
      shortcutBox: null,
      setShortcutBox: (shortcutBox) => set({ shortcutBox }),
      mousePos: null,
      setMousePos: (mousePos) => set({ mousePos }),
      hint: 'Ready',
      setHint: (hint) => set({ hint }),
      referencePlanes: [],
      setReferencePlanes: (referencePlanes) => set({ referencePlanes }),
      referenceAxes: [],
      setReferenceAxes: (referenceAxes) => set({ referenceAxes }),
      activePropertyManager: null,
      setActivePropertyManager: (activePropertyManager) => set({ activePropertyManager }),

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
      }),
    }
  )
);
