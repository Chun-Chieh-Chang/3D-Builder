import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type CadMode = 'PART' | 'ASSEMBLY' | 'DRAWING';
export type MeasurementMode = 'NONE' | 'DISTANCE' | 'ANGLE' | 'AREA' | 'VOLUME';

export interface CADContextMenu {
  plane: 'FRONT' | 'TOP' | 'RIGHT';
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
  type: 'SKETCH_RECT' | 'EXTRUDE' | 'BOX' | 'CYLINDER' | 'SPHERE' | 'REVOLVE' | 'FILLET' | 'CHAMFER';
  name: string;
  parameters: any;
}

interface CadState {
  mode: CadMode;
  setMode: (mode: CadMode) => void;

  isSketchMode: boolean;
  setSketchMode: (active: boolean) => void;
  activePlane: 'FRONT' | 'TOP' | 'RIGHT' | null;
  setActivePlane: (plane: 'FRONT' | 'TOP' | 'RIGHT' | null) => void;

  sketchPoints: any[]; // 2D points on the active plane
  setSketchPoints: (points: any[]) => void;
  sketchTool: 'LINE' | 'CENTER_LINE' | 'CIRCLE' | 'RECTANGLE' | 'ARC';
  setSketchTool: (tool: 'LINE' | 'CENTER_LINE' | 'CIRCLE' | 'RECTANGLE' | 'ARC') => void;
  gridSnap: boolean;
  setGridSnap: (snap: boolean) => void;
  sketchRelations: string[];
  setSketchRelations: (relations: string[]) => void;
  selectedEntityIds: string[];
  setSelectedEntityIds: (ids: string[]) => void;

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

      sketchPoints: [],
      setSketchPoints: (points) => set({ sketchPoints: points }),
      sketchTool: 'LINE',
      setSketchTool: (tool) => set({ sketchTool: tool }),
      gridSnap: true,
      setGridSnap: (snap) => set({ gridSnap: snap }),
      sketchRelations: [],
      setSketchRelations: (relations) => set({ sketchRelations: relations }),
      selectedEntityIds: [],
      setSelectedEntityIds: (selectedEntityIds) => set({ selectedEntityIds }),

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
        editingFeatureId: state.editingFeatureId === id ? null : state.editingFeatureId
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

      selectedTopology: null,
      setSelectedTopology: (topology) => set({ selectedTopology: topology }),

      measurementMode: 'NONE',
      setMeasurementMode: (measurementMode) => set({ measurementMode }),
      measurementPoints: [],
      setMeasurementPoints: (measurementPoints) => set({ measurementPoints }),
      measurementResults: null,
      setMeasurementResults: (measurementResults) => set({ measurementResults }),

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
    }),
    {
      name: 'cad-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        mode: state.mode,
        projectName: state.projectName,
        features: state.features,
        selectedId: state.selectedId,
        selectedTopology: state.selectedTopology,
        selectedEntityIds: state.selectedEntityIds,
      }), // Don't persist meshData and transient measurement state as they can be large or dynamic
    }
  )
);
