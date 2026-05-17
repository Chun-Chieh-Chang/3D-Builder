import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type CadMode = 'PART' | 'ASSEMBLY' | 'DRAWING';

export interface CADFeature {
  id: string;
  type: 'SKETCH_RECT' | 'EXTRUDE' | 'BOX' | 'CYLINDER' | 'SPHERE';
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
  sketchTool: 'LINE' | 'ARC';
  setSketchTool: (tool: 'LINE' | 'ARC') => void;
  
  projectName: string;

  setProjectName: (name: string) => void;

  
  // Feature Tree Logic
  features: CADFeature[];
  addFeature: (feature: CADFeature) => void;
  removeFeature: (id: string) => void;
  updateFeatureParams: (id: string, params: any) => void;
  
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;


  // Render State
  meshData: any[]; // Array of { id, data: { vertices, indices, normals } }
  setMeshData: (data: any[]) => void;
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
      
      projectName: 'Professional CAD Project',


      setProjectName: (name) => set({ projectName: name }),
      
      // Industrial Default: A Base Plate with a Cut-out on a different plane
      features: [
        {
          id: 'feat_1',
          type: 'EXTRUDE',
          name: 'Base Plate',
          parameters: { width: 50, height: 30, depth: 5, x: 0, y: 0, z: 0, operation: 'ADD', plane: 'FRONT' }
        },
        {
          id: 'feat_2',
          type: 'EXTRUDE',
          name: 'Top Cut-out',
          parameters: { width: 10, height: 10, depth: 20, x: 20, y: 0, z: 10, operation: 'CUT', plane: 'TOP' }
        }
      ],


      
      addFeature: (feature) => set((state) => ({ 
        features: [...state.features, feature] 
      })),
      
      removeFeature: (id) => set((state) => ({
        features: state.features.filter(f => f.id !== id),
        selectedId: state.selectedId === id ? null : state.selectedId
      })),
      
      updateFeatureParams: (id, params) => set((state) => {
        const newFeatures = state.features.map(f => 
          f.id === id ? { ...f, parameters: { ...f.parameters, ...params } } : f
        );
        return { features: [...newFeatures] };
      }),
      
      selectedId: 'feat_1',
      setSelectedId: (id) => set({ selectedId: id }),

      meshData: [],
      setMeshData: (meshData) => set({ meshData }),
    }),
    {
      name: 'cad-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        mode: state.mode,
        projectName: state.projectName,
        features: state.features,
        selectedId: state.selectedId,
      }), // Don't persist meshData as it can be large
    }
  )
);

