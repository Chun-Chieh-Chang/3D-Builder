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
  alignment: 'ALIGNED' | 'ANTI_ALIGNED';
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
}

export interface CADContextMenu {
  plane: string;
  position: [number, number, number];
}

export interface MeasurementResult {
  mode: MeasurementMode;
  value: number;
  unit: string;
  details?: string;
}

export interface CADFeature {
  id: string;
  type: 'SKETCH_RECT' | 'EXTRUDE' | 'BOX' | 'CYLINDER' | 'SPHERE' | 'REVOLVE' | 'FILLET' | 'CHAMFER' | 'PATTERN' | 'REFERENCE_PLANE' | 'REFERENCE_AXIS';
  name: string;
  parameters: any;
}

export interface SketchNode {
  id: string;
  x: number;
  y: number;
  isFixed?: boolean;
}

export type SketchEdgeType = 'LINE' | 'ARC' | 'CIRCLE' | 'CENTER_LINE';

export interface SketchEdge {
  id: string;
  type: SketchEdgeType;
  nodeIds: string[]; 
  isConstruction?: boolean;
}

export type ConstraintType = 'COINCIDENT' | 'HORIZONTAL' | 'VERTICAL' | 'DISTANCE' | 'EQUAL';

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  nodeIds?: string[];
  edgeIds?: string[];
  value?: number;
}

interface CadState {
  mode: CadMode;
  setMode: (mode: CadMode) => void;

  isSketchMode: boolean;
  setSketchMode: (active: boolean) => void;
  activePlane: string | null;
  setActivePlane: (plane: string | null) => void;

  activeFaceOrigin: [number, number, number] | null;
  setActiveFaceOrigin: (origin: [number, number, number] | null) => void;
  activeFaceNormal: [number, number, number] | null;
  setActiveFaceNormal: (normal: [number, number, number] | null) => void;
  activeFaceId: string | null;
  setActiveFaceId: (id: string | null) => void;

  sketchNodes: Record<string, SketchNode>;
  setSketchNodes: (nodes: Record<string, SketchNode> | ((prev: Record<string, SketchNode>) => Record<string, SketchNode>)) => void;
  sketchEdges: Record<string, SketchEdge>;
  setSketchEdges: (edges: Record<string, SketchEdge> | ((prev: Record<string, SketchEdge>) => Record<string, SketchEdge>)) => void;
  sketchConstraints: Record<string, SketchConstraint>;
  setSketchConstraints: (constraints: Record<string, SketchConstraint> | ((prev: Record<string, SketchConstraint>) => Record<string, SketchConstraint>)) => void;


  sketchTool: 'LINE' | 'CENTER_LINE' | 'CIRCLE' | 'RECTANGLE' | 'ARC' | 'MIDPOINT_LINE';
  /** Circle creation mode */
  activeCircleMode: 'CENTER_RADIUS' | 'DIAMETER' | 'THREE_POINTS' | 'TANGENT' | 'COINCIDENT';
  setActiveCircleMode: (mode: CadState['activeCircleMode']) => void;
  setSketchTool: (tool: 'LINE' | 'CENTER_LINE' | 'CIRCLE' | 'RECTANGLE' | 'ARC' | 'MIDPOINT_LINE') => void;
  gridSnap: boolean;
  setGridSnap: (snap: boolean) => void;
  sketchRelations: string[];
  setSketchRelations: (relations: string[]) => void;
  selectedEntityIds: string[];
  setSelectedEntityIds: (ids: string[]) => void;
  sketchNewChain: boolean;
  setSketchNewChain: (val: boolean) => void;

  projectName: string;

  setProjectName: (name: string) => void;

  // Feature Tree Logic
  features: CADFeature[];
  addFeature: (feature: CADFeature) => void;
  removeFeature: (id: string) => void;
  updateFeatureParams: (id: string, params: any) => void;
  editingFeatureId: string | null;
  setEditingFeatureId: (id: string | null) => void;

  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  selectedSubNodeType: 'SKETCH' | 'FEATURE' | null;
  setSelectedSubNodeType: (type: 'SKETCH' | 'FEATURE' | null) => void;

  // Topology Selection State
  selectedTopology: any; // SelectedTopology from TopologySelector
  setSelectedTopology: (topology: any) => void;

  // Measurement State
  measurementMode: MeasurementMode;
  setMeasurementMode: (mode: MeasurementMode) => void;
  measurementPoints: any[];
  setMeasurementPoints: (points: any[]) => void;
  measurementResults: MeasurementResult | null;
  setMeasurementResults: (results: MeasurementResult | null) => void;

  // Assembly & Mate State
  components: CADComponent[];
  setComponents: (components: CADComponent[]) => void;
  addComponent: (component: CADComponent) => void;
  mates: CADMate[];
  setMates: (mates: CADMate[]) => void;
  addMate: (mate: CADMate) => void;

  // Assembly Selection State
  mateSelection: any[];
  setMateSelection: (selection: any[]) => void;
  addMateSelection: (entity: any) => void;
  clearMateSelection: () => void;

  // Render State
  meshData: any[]; // Array of { id, data: { vertices, indices, normals } }
  setMeshData: (data: any[]) => void;

  // Camera Alignment Trigger
  cameraNormalTrigger: number;
  cameraNormalFlip: boolean;
  cameraNormalLastPlane: string | null;
  triggerCameraNormal: () => void;

  // Transient Context Menu HUD
  contextMenu: CADContextMenu | null;
  setContextMenu: (menu: CADContextMenu | null) => void;

  // Transient OrbitControls Reference & Animation Lock
  controls: any | null;
  setControls: (controls: any | null) => void;
  isCameraAnimating: boolean;
  setIsCameraAnimating: (isAnimating: boolean) => void;

  // Reference Geometry & PropertyManager
  referencePlanes: any[];
  setReferencePlanes: (planes: any[]) => void;
  addReferencePlane: (plane: any) => void;
  referenceAxes: any[];
  setReferenceAxes: (axes: any[]) => void;
  addReferenceAxis: (axis: any) => void;
  activePropertyManager: any | null;
  setActivePropertyManager: (mgr: any | null) => void;
}

export const useCadStore = create<CadState>()(
  persist(
    (set) => ({
      mode: 'PART',
      setMode: (mode) => set({ mode }),

      isSketchMode: false,
      setSketchMode: (active) => set({ isSketchMode: active }),
      activePlane: null,
      setActivePlane: (plane) => set({ activePlane: plane }),

      activeFaceOrigin: null,
      setActiveFaceOrigin: (activeFaceOrigin) => set({ activeFaceOrigin }),
      activeFaceNormal: null,
      setActiveFaceNormal: (activeFaceNormal) => set({ activeFaceNormal }),
      activeFaceId: null,
      setActiveFaceId: (activeFaceId) => set({ activeFaceId }),

      sketchNodes: {},
      setSketchNodes: (updater) => set((state) => ({ 
        sketchNodes: typeof updater === 'function' ? updater(state.sketchNodes) : updater 
      })),
      sketchEdges: {},
      setSketchEdges: (updater) => set((state) => ({ 
        sketchEdges: typeof updater === 'function' ? updater(state.sketchEdges) : updater 
      })),
      sketchConstraints: {},
      setSketchConstraints: (updater) => set((state) => ({ 
        sketchConstraints: typeof updater === 'function' ? updater(state.sketchConstraints) : updater 
      })),


      sketchTool: 'LINE',
      setSketchTool: (tool) => set({ sketchTool: tool }),
      // Circle mode defaults to center‑radius
      activeCircleMode: 'CENTER_RADIUS',
      setActiveCircleMode: (mode) => set({ activeCircleMode: mode }),
      gridSnap: true,
      setGridSnap: (snap) => set({ gridSnap: snap }),
      sketchRelations: [],
      setSketchRelations: (relations) => set({ sketchRelations: relations }),
      selectedEntityIds: [],
      setSelectedEntityIds: (selectedEntityIds) => set({ selectedEntityIds }),
      sketchNewChain: true,
      setSketchNewChain: (sketchNewChain) => set({ sketchNewChain }),

      projectName: 'Professional CAD Project',


      setProjectName: (name) => set({ projectName: name }),

      // Start with a clean slate: no default features, exactly like a new SolidWorks Part document
      features: [],



      addFeature: (feature) => set((state) => ({
        features: [...state.features, feature]
      })),

      removeFeature: (id) => set((state) => ({
        features: state.features.filter(f => f.id !== id),
        selectedId: state.selectedId === id ? null : state.selectedId,
        editingFeatureId: state.editingFeatureId === id ? null : state.editingFeatureId,
        referencePlanes: state.referencePlanes.filter(p => p.id !== id),
        referenceAxes: state.referenceAxes.filter(a => a.id !== id)
      })),

      updateFeatureParams: (id, params) => set((state) => {
        const newFeatures = state.features.map(f =>
          f.id === id ? { ...f, parameters: { ...f.parameters, ...params } } : f
        );
        return { features: [...newFeatures] };
      }),

      editingFeatureId: null,
      setEditingFeatureId: (id) => set({ editingFeatureId: id }),

      selectedId: null,
      setSelectedId: (id) => set({ selectedId: id }),
      selectedSubNodeType: null,
      setSelectedSubNodeType: (selectedSubNodeType) => set({ selectedSubNodeType }),

      selectedTopology: null,
      setSelectedTopology: (topology) => set({ selectedTopology: topology }),

      measurementMode: 'NONE',
      setMeasurementMode: (measurementMode) => set({ measurementMode }),
      measurementPoints: [],
      setMeasurementPoints: (measurementPoints) => set({ measurementPoints }),
      measurementResults: null,
      setMeasurementResults: (measurementResults) => set({ measurementResults }),

      components: [],
      setComponents: (components) => set({ components }),
      addComponent: (component) => set((state) => ({ components: [...state.components, component] })),
      mates: [],
      setMates: (mates) => set({ mates }),
      addMate: (mate) => set((state) => ({ mates: [...state.mates, mate] })),

      mateSelection: [],
      setMateSelection: (mateSelection) => set({ mateSelection }),
      addMateSelection: (entity) => set((state) => ({ mateSelection: [...state.mateSelection, entity] })),
      clearMateSelection: () => set({ mateSelection: [] }),

      meshData: [],
      setMeshData: (meshData) => set({ meshData }),

      cameraNormalTrigger: 0,
      cameraNormalFlip: false,
      cameraNormalLastPlane: null,
      triggerCameraNormal: () => set((state) => {
        // If clicking normal to the same plane again, flip the view 180 degrees!
        const isSamePlane = state.cameraNormalLastPlane === state.activePlane;
        return { 
          cameraNormalTrigger: state.cameraNormalTrigger + 1,
          cameraNormalLastPlane: state.activePlane,
          cameraNormalFlip: isSamePlane ? !state.cameraNormalFlip : false
        };
      }),

      contextMenu: null,
      setContextMenu: (contextMenu) => set({ contextMenu }),

      controls: null,
      setControls: (controls) => set({ controls }),
      isCameraAnimating: false,
      setIsCameraAnimating: (isCameraAnimating) => set({ isCameraAnimating }),

      referencePlanes: [],
      setReferencePlanes: (planes) => set({ referencePlanes: planes }),
      addReferencePlane: (plane) => set((state) => ({ referencePlanes: [...state.referencePlanes, plane] })),
      referenceAxes: [],
      setReferenceAxes: (axes) => set({ referenceAxes: axes }),
      addReferenceAxis: (axis) => set((state) => ({ referenceAxes: [...state.referenceAxes, axis] })),
      activePropertyManager: null,
      setActivePropertyManager: (activePropertyManager) => set({ activePropertyManager }),
    }),
    {
      name: 'cad-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        mode: state.mode,
        projectName: state.projectName,
        features: state.features,
        selectedId: state.selectedId,
        selectedSubNodeType: state.selectedSubNodeType,
        selectedTopology: state.selectedTopology,
        selectedEntityIds: state.selectedEntityIds,
        components: state.components,
        mates: state.mates,
        activePlane: state.activePlane,
        activeFaceOrigin: state.activeFaceOrigin,
        activeFaceNormal: state.activeFaceNormal,
        activeFaceId: state.activeFaceId,
        referencePlanes: state.referencePlanes,
        referenceAxes: state.referenceAxes,
      }), // Don't persist meshData and transient measurement state as they can be large or dynamic
    }
  )
);
