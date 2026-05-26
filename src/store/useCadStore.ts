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
    unit?: string;
    details?: any;
    distance?: number;
    angle?: number;
    area?: number;
    volume?: number;
    center_of_mass?: [number, number, number];
    inertia_matrix?: number[][];
}

export interface MaterialAppearance {
  id: string;
  name: string;
  color: string;
  diffuseAmount: number;
  glossAmount: number;
  brightness: number;
  glossColor: string;
  glossDistribution: number;
  reflectionAmount: number;
  transmissionAmount: number;
  glowAmount: number;
}

export const DEFAULT_APPEARANCE: MaterialAppearance = {
  id: 'default',
  name: 'Default',
  color: '#60A5FA',
  diffuseAmount: 0.8,
  glossAmount: 0.3,
  brightness: 0,
  glossColor: '#FFFFFF',
  glossDistribution: 0.5,
  reflectionAmount: 0.2,
  transmissionAmount: 0,
  glowAmount: 0,
};

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

  showConstraints: boolean;
  toggleShowConstraints: () => void;

  trimMode: boolean;
  setTrimMode: (active: boolean) => void;

  appearances: {
    features: Record<string, MaterialAppearance>;
    faces: Record<string, MaterialAppearance>;
    clipboard: MaterialAppearance | null;
  };
  setFeatureAppearance: (featureId: string, material: Partial<MaterialAppearance>) => void;
  setFaceAppearance: (featureId: string, faceIndex: number, material: Partial<MaterialAppearance>) => void;
  copyAppearance: (source: MaterialAppearance) => void;
  pasteAppearance: (targetType: 'feature' | 'face', targetId: string, faceIndex?: number) => void;
  getFeatureAppearance: (featureId: string) => MaterialAppearance;

  history: {
    past: Array<{
      features: CADFeature[];
      sketchNodes: Record<string, SketchNode>;
      sketchEdges: Record<string, SketchEdge>;
      sketchConstraints: Record<string, SketchConstraint>;
    }>;
    future: Array<{
      features: CADFeature[];
      sketchNodes: Record<string, SketchNode>;
      sketchEdges: Record<string, SketchEdge>;
      sketchConstraints: Record<string, SketchConstraint>;
    }>;
  };
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  clipboard: any;
  copy: () => void;
  cut: () => void;
  paste: () => void;

  selectAll: () => void;
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

      features: [],
      setFeatures: (features) => { get().pushHistory(); set({ features }); },
      addFeature: (feature) => { get().pushHistory(); set((state) => ({ features: [...state.features, feature] })); },
      removeFeature: (id) => { get().pushHistory(); set((state) => ({ features: state.features.filter(f => f.id !== id) })); },
      updateFeatureParams: (id, params) => { get().pushHistory(); set((state) => ({
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

      setSuppressed: (id, suppressed) => { get().pushHistory(); set((state) => ({
        features: state.features.map(f => f.id === id ? { ...f, isSuppressed: suppressed } : f)
      })); },
      reorderFeatures: (startIndex, endIndex) => { get().pushHistory(); set((state) => {
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
      addComponent: (component) => { get().pushHistory(); set((state) => ({ components: [...state.components, component] })); },
      mates: [],
      setMates: (mates) => { get().pushHistory(); set({ mates }); },
      addMate: (mate) => { get().pushHistory(); set((state) => ({ mates: [...state.mates, mate] })); },

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

      showConstraints: true,
      toggleShowConstraints: () => set((state) => ({ showConstraints: !state.showConstraints })),

      trimMode: false,
      setTrimMode: (trimMode) => set({ trimMode }),

      appearances: {
        features: {},
        faces: {},
        clipboard: null,
      },
      setFeatureAppearance: (featureId, material) => set((state) => {
        const current = state.appearances.features[featureId] || { ...DEFAULT_APPEARANCE, id: featureId };
        return {
          appearances: {
            ...state.appearances,
            features: {
              ...state.appearances.features,
              [featureId]: { ...current, ...material, id: featureId }
            }
          }
        };
      }),
      setFaceAppearance: (featureId, faceIndex, material) => set((state) => {
        const key = `${featureId}_${faceIndex}`;
        const current = state.appearances.faces[key] || { ...DEFAULT_APPEARANCE, id: key };
        return {
          appearances: {
            ...state.appearances,
            faces: {
              ...state.appearances.faces,
              [key]: { ...current, ...material, id: key }
            }
          }
        };
      }),
      copyAppearance: (source) => set((state) => ({
        appearances: { ...state.appearances, clipboard: { ...source } }
      })),
      pasteAppearance: (targetType, targetId, faceIndex) => {
        const state = get();
        if (!state.appearances.clipboard) return;
        if (targetType === 'feature') {
          state.setFeatureAppearance(targetId, state.appearances.clipboard);
        } else if (targetType === 'face' && faceIndex !== undefined) {
          state.setFaceAppearance(targetId, faceIndex, state.appearances.clipboard);
        }
      },
      getFeatureAppearance: (featureId) => {
        const state = get();
        return state.appearances.features[featureId] || DEFAULT_APPEARANCE;
      },

      history: {
        past: [],
        future: []
      },
      pushHistory: () => {
        const state = get();
        const snapshot = {
          features: JSON.parse(JSON.stringify(state.features)),
          sketchNodes: JSON.parse(JSON.stringify(state.sketchNodes)),
          sketchEdges: JSON.parse(JSON.stringify(state.sketchEdges)),
          sketchConstraints: JSON.parse(JSON.stringify(state.sketchConstraints))
        };
        set((s) => ({
          history: {
            past: [...s.history.past.slice(-49), snapshot],
            future: []
          }
        }));
      },
      undo: () => {
        const state = get();
        if (state.history.past.length === 0) return;
        const prev = state.history.past[state.history.past.length - 1];
        const newPast = state.history.past.slice(0, -1);
        const currentSnapshot = {
          features: JSON.parse(JSON.stringify(state.features)),
          sketchNodes: JSON.parse(JSON.stringify(state.sketchNodes)),
          sketchEdges: JSON.parse(JSON.stringify(state.sketchEdges)),
          sketchConstraints: JSON.parse(JSON.stringify(state.sketchConstraints))
        };
        set((s) => ({
          history: {
            past: newPast,
            future: [...s.history.future, currentSnapshot]
          },
          features: prev.features,
          sketchNodes: prev.sketchNodes,
          sketchEdges: prev.sketchEdges,
          sketchConstraints: prev.sketchConstraints
        }));
      },
      redo: () => {
        const state = get();
        if (state.history.future.length === 0) return;
        const next = state.history.future[state.history.future.length - 1];
        const newFuture = state.history.future.slice(0, -1);
        const currentSnapshot = {
          features: JSON.parse(JSON.stringify(state.features)),
          sketchNodes: JSON.parse(JSON.stringify(state.sketchNodes)),
          sketchEdges: JSON.parse(JSON.stringify(state.sketchEdges)),
          sketchConstraints: JSON.parse(JSON.stringify(state.sketchConstraints))
        };
        set((s) => ({
          history: {
            past: [...s.history.past, currentSnapshot],
            future: newFuture
          },
          features: next.features,
          sketchNodes: next.sketchNodes,
          sketchEdges: next.sketchEdges,
          sketchConstraints: next.sketchConstraints
        }));
      },

      clipboard: null,
      copy: () => {
        const state = get();
        const selected = state.selectedEntityIds;
        if (selected.length === 0) return;
        const clipboardData = {
          type: 'sketch',
          nodeIds: selected.filter((id) => state.sketchNodes[id]),
          edgeIds: selected.filter((id) => state.sketchEdges[id])
        };
        set({ clipboard: clipboardData });
      },
      cut: () => {
        const state = get();
        state.copy();
        const selected = state.selectedEntityIds;
        if (selected.length === 0) return;
        const nextNodes = { ...state.sketchNodes };
        const nextEdges = { ...state.sketchEdges };
        const nextConstraints = { ...state.sketchConstraints };
        selected.forEach((id) => {
          delete nextNodes[id];
          delete nextEdges[id];
          delete nextConstraints[id];
        });
        set({
          sketchNodes: nextNodes,
          sketchEdges: nextEdges,
          sketchConstraints: nextConstraints,
          selectedEntityIds: []
        });
      },
      paste: () => {
        const state = get();
        if (!state.clipboard || state.clipboard.type !== 'sketch') return;
        const clipboard = state.clipboard;
        const newNodes = { ...state.sketchNodes };
        const newEdges = { ...state.sketchEdges };
        const idMap: Record<string, string> = {};
        clipboard.nodeIds.forEach((oldId: string) => {
          const oldNode = state.sketchNodes[oldId];
          if (oldNode) {
            const newId = `pasted_node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            idMap[oldId] = newId;
            newNodes[newId] = {
              ...oldNode,
              id: newId,
              x: oldNode.x + 20,
              y: oldNode.y + 20
            };
          }
        });
        clipboard.edgeIds.forEach((oldId: string) => {
          const oldEdge = state.sketchEdges[oldId];
          if (oldEdge) {
            const newId = `pasted_edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            newEdges[newId] = {
              ...oldEdge,
              id: newId,
              nodeIds: oldEdge.nodeIds.map((nid) => idMap[nid] || nid)
            };
          }
        });
        set({
          sketchNodes: newNodes,
          sketchEdges: newEdges
        });
      },

      selectAll: () => {
        const state = get();
        const allIds = [
          ...Object.keys(state.sketchNodes),
          ...Object.keys(state.sketchEdges),
          ...Object.keys(state.sketchConstraints)
        ];
        set({ selectedEntityIds: allIds });
      },
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
        appearances: state.appearances,
      }),
    }
  )
);
