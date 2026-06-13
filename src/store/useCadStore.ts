import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';

export type CadMode = 'PART' | 'ASSEMBLY' | 'DRAWING' | 'RENDER';
export type MeasurementMode = 'NONE' | 'DISTANCE' | 'ANGLE' | 'AREA' | 'VOLUME';
export type MateType = 'COINCIDENT' | 'PARALLEL' | 'CONCENTRIC' | 'DISTANCE' | 'PERPENDICULAR' | 'TANGENT' | 'ANGLE' | 'GEAR' | 'SCREW';

export interface MateEntity {
  componentId: string;
  topologyId: string;
  localOrigin?: [number, number, number];
  localNormal?: [number, number, number];
}

export interface CADMate {
  id: string;
  name: string;
  type: MateType;
  entity1: MateEntity;
  entity2: MateEntity;
  parameters?: { 
    offset?: number; 
    angle?: number; 
    alignmentFlip?: boolean;
    isLimitAngle?: boolean;
    minAngle?: number;
    maxAngle?: number;
    ratio?: number; // For Gear
    pitch?: number; // For Screw
    initialTransforms?: Record<string, { position: [number, number, number], rotation: [number, number, number] }>;
  };
  alignment?: 'ALIGNED' | 'ANTI_ALIGNED';
  offset?: number;
  angle?: number;
}

export interface CADFeature {
  id: string;
  type: string;
  name: string;
  parameters: {
    [key: string]: any;
    draftAngle?: number;
    draftOutward?: boolean;
    isSurfaceOnly?: boolean;
    isThin?: boolean;
    thinThickness?: number;
    thinDirection?: 'ONE_DIRECTION' | 'MID_PLANE' | 'TWO_DIRECTIONS';
    
    // Pattern Direction 2
    count2?: number;
    spacing2?: number;
    direction2_refs?: any[];
    flip1?: boolean;
    flip2?: boolean;
    patternSeedOnly?: boolean;

    // Circular Pattern specific
    equalSpacing?: boolean;
    instancesToSkip?: number[];

    // Fill Pattern specific
    boundary_id?: string;
    fill_layout?: 'SQUARE' | 'PERFORATION' | 'HEXAGON';
    margin?: number;
    fill_angle?: number;

    // Surface Cut specific
    tool_feature_id?: string;
  };

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

export interface CADConfiguration {
  id: string;
  name: string;
  description?: string;
  featureSuppression: Record<string, boolean>;
  parameterOverrides: Record<string, Record<string, any>>;
}

export interface SketchNode {
  id: string;
  x: number;
  y: number;
  isFixed?: boolean;
}

export interface SketchEdge {
  id: string;
  type: 'LINE' | 'ARC' | 'CIRCLE' | 'CENTER_LINE' | 'SPLINE' | 'TEXT';
  nodeIds: string[];
  isConstruction?: boolean;
  parameters?: any;
}

export interface SketchConstraint {
  id: string;
  type: 'COINCIDENT' | 'HORIZONTAL' | 'VERTICAL' | 'DISTANCE' | 'EQUAL' | 'CONCENTRIC' | 'TANGENT' | 'ANGLE' | 'PARALLEL' | 'PERPENDICULAR' | 'SYMMETRIC' | 'MIDPOINT' | 'COLLINEAR' | 'PIERCE';
  nodeIds?: string[];
  edgeIds?: string[];
  value?: number;
  offset?: number;
  arcCondition?: 'CENTER' | 'MIN' | 'MAX';
  label?: string;
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
  isLightweight?: boolean;
  color?: string;
  materialId?: string;
  features?: CADFeature[];
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

export interface ExplodedViewState {
  isActive: boolean;
  factor: number;
  directions: Record<string, [number, number, number]>;
}

export interface MotionDriver {
  id: string;
  mateId: string;
  type: 'ROTARY' | 'LINEAR';
  velocity: number;
}

export interface MotionStudyState {
  isActive: boolean;
  currentTime: number;
  playbackSpeed: number;
  drivers: MotionDriver[];
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

export interface RibbonLayout {
  FEATURES: string[];
  SKETCH: string[];
  EVALUATE: string[];
  ASSEMBLY?: string[];
  DRAWING?: string[];
  RENDER?: string[];
  SURFACING?: string[];
}

export interface CadState {
  projectName: string;
  setProjectName: (name: string) => void;
  isDirty: boolean;
  lastSavedAt: string | null;
  projectFilePath: string | null;
  markProjectDirty: () => void;
  markProjectClean: () => void;
  setProjectFilePath: (path: string | null) => void;
  drawingScale: string;
  setDrawingScale: (scale: string) => void;
  drawnBy: string;
  setDrawnBy: (name: string) => void;
  approvedBy: string;
  setApprovedBy: (name: string) => void;

  configurations: CADConfiguration[];
  activeConfigurationId: string;
  setConfigurations: (configs: CADConfiguration[]) => void;
  setActiveConfiguration: (id: string) => void;
  addConfiguration: (config: CADConfiguration) => void;
  deleteConfiguration: (id: string) => void;
  toggleFeatureSuppression: (featureId: string, configId?: string) => void;

  globalVariables: Record<string, string>;
  evaluatedVariables: Record<string, number>;
  setGlobalVariable: (name: string, formula: string) => void;
  removeGlobalVariable: (name: string) => void;
  refreshEvaluatedVariables: () => void;

  mode: CadMode;
  setMode: (mode: CadMode) => void;
  activeTab: 'FEATURES' | 'SKETCH' | 'EVALUATE' | 'ASSEMBLY' | 'DRAWING' | 'RENDER' | 'SURFACING';
  setActiveTab: (tab: 'FEATURES' | 'SKETCH' | 'EVALUATE' | 'ASSEMBLY' | 'DRAWING' | 'RENDER' | 'SURFACING') => void;
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
  revolveAxisId: string | null;
  setRevolveAxisId: (id: string | null) => void;

  sketchTool: string;
  setSketchTool: (tool: string) => void;
  gridSnap: boolean;
  setGridSnap: (active: boolean) => void;
  sketchNewChain: boolean;
  setSketchNewChain: (active: boolean) => void;
  lastClickedNodeId: string | null;
  setLastClickedNodeId: (id: string | null) => void;
  firstChainNodeId: string | null;
  setFirstChainNodeId: (id: string | null) => void;
  convertEntities: (selectedEdgeIds: string[]) => void;
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

  rebuildDirty: boolean;
  dirtyFromFeatureIndex: number;
  markRebuildDirty: (fromFeatureIndex?: number) => void;
  clearRebuildDirty: () => void;

  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  selectedSubNodeType: 'SKETCH' | 'FEATURE' | null;
  setSelectedSubNodeType: (type: 'SKETCH' | 'FEATURE' | null) => void;
  visibleSketches: string[];
  toggleSketchVisibility: (featureId: string) => void;

  setSuppressed: (id: string, suppressed: boolean) => void;
  reorderFeatures: (startIndex: number, endIndex: number) => void;
  checkDependencies: () => void;
  
  hoveredTreeId: string | null;
  setHoveredTreeId: (id: string | null) => void;
  hoveredChildren: string[];
  setHoveredChildren: (ids: string[]) => void;

  history: { past: any[]; future: any[]; };
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

  dimensionSelection: string[];
  addDimensionSelection: (id: string) => void;
  clearDimensionSelection: () => void;

  components: CADComponent[];
  setComponents: (components: CADComponent[]) => void;
  addComponent: (component: CADComponent) => void;
  removeComponent: (id: string) => void;
  updateComponentTransform: (id: string, position: [number, number, number], rotation: [number, number, number]) => void;
  updateComponentColor: (id: string, color: string) => void;
  toggleComponentFixed: (id: string) => void;
  toggleLightweight: (id: string) => void;
  setAllLightweight: (light: boolean) => void;
  isLargeAssemblyMode: boolean;
  setLargeAssemblyMode: (active: boolean) => void;
  isPhysicsActive: boolean;
  setIsPhysicsActive: (active: boolean) => void;
  draggedComponentId: string | null;
  setDraggedComponentId: (id: string | null) => void;
  automationLog: string[];
  addAutomationLog: (log: string) => void;
  activeAutomationStep: string | null;
  setActiveAutomationStep: (step: string | null) => void;
  robotStatus: 'IDLE' | 'WORKING' | 'PAUSED' | 'ERROR';
  setRobotStatus: (status: 'IDLE' | 'WORKING' | 'PAUSED' | 'ERROR') => void;
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
  solverReport: { dof: number; residual: number; nodes: Record<string, any> } | null;
  setSolverReport: (report: { dof: number; residual: number; nodes: Record<string, any> } | null) => void;
  assemblyPreviewComponents: CADComponent[] | null;
  setAssemblyPreviewComponents: (components: CADComponent[] | null) => void;
  massProperties: { volume: number; surface_area: number; center_of_mass: number[]; inertia_matrix: number[][]; } | null;
  setMassProperties: (props: { volume: number; surface_area: number; center_of_mass: number[]; inertia_matrix: number[][]; } | null) => void;
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

  pendingFeatureCommand: 'FILLET' | 'CHAMFER' | 'THICKEN' | 'PATTERN' | 'MIRROR' | 'DRAFT' | 'SHELL' | 'HOLE_WIZARD' | 'PLANE' | 'REFERENCE_PLANE' | 'SURFACE_OFFSET' | 'SURFACE_KNIT' | 'SURFACE_CUT' | 'REFERENCE_POINT' | 'REVOLVED_CUT' | 'DOME' | 'RIB' | null;
  setPendingFeatureCommand: (cmd: 'FILLET' | 'CHAMFER' | 'THICKEN' | 'PATTERN' | 'MIRROR' | 'DRAFT' | 'SHELL' | 'HOLE_WIZARD' | 'PLANE' | 'REFERENCE_PLANE' | 'SURFACE_OFFSET' | 'SURFACE_KNIT' | 'SURFACE_CUT' | 'REFERENCE_POINT' | 'REVOLVED_CUT' | 'DOME' | 'RIB' | null) => void;
  defaultFilletRadius: number;
  defaultChamferDistance: number;
  
  referencePlanes: CADReferencePlane[];
  setReferencePlanes: (planes: CADReferencePlane[]) => void;
  referenceAxes: any[];
  setReferenceAxes: (axes: any[]) => void;
  referencePoints: any[];
  setReferencePoints: (points: any[]) => void;
  
  activePropertyManager: any;
  setActivePropertyManager: (mgr: any) => void;

  showExportModal: boolean;
  setShowExportModal: (show: boolean) => void;

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

  explodedView: ExplodedViewState;
  setExplodedView: (view: Partial<ExplodedViewState>) => void;
  setExplosionFactor: (factor: number) => void;
  calculateAutoExplosion: () => void;

  motionStudy: MotionStudyState;
  setMotionStudy: (study: Partial<MotionStudyState>) => void;
  addMotionDriver: (driver: MotionDriver) => void;
  removeMotionDriver: (id: string) => void;

  partMaterial: string;
  setPartMaterial: (material: string) => void;
  environmentMap: string;
  setEnvironmentMap: (env: string) => void;

  ribbonLayout: RibbonLayout;
  setRibbonLayout: (layout: RibbonLayout) => void;
  resetRibbonLayout: () => void;

  commitPreciseSketchSolve: () => void;
  viewOrientationSelectorVisible: boolean;
  setViewOrientationSelectorVisible: (visible: boolean) => void;

  showMaterialModal: boolean;
  setShowMaterialModal: (show: boolean) => void;
  targetMaterialEntity: { type: 'PART' | 'COMPONENT' | 'FEATURE', id: string } | null;
  setTargetMaterialEntity: (entity: { type: 'PART' | 'COMPONENT' | 'FEATURE', id: string } | null) => void;

  hoveredEntityId: string | null;
  setHoveredEntityId: (id: string | null) => void;

  selection: {
    type?: string;
    ids?: string[];
    nodes: string[];
    edges: string[];
    features: string[];
    faces: string[];
  };
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

export const DEFAULT_RIBBON_LAYOUT: RibbonLayout = {
  FEATURES: ['EXTRUDE', 'REVOLVE', 'EXTRUDE_CUT', 'REVOLVED_CUT', 'SWEEP', 'LOFT', 'FILLET', 'CHAMFER', 'MIRROR', 'PATTERN', 'SHELL', 'DOME', 'DRAFT', 'REFERENCE_PLANE', 'REFERENCE_AXIS', 'REFERENCE_POINT', 'HOLE_WIZARD'],
  SKETCH: ['LINE', 'CIRCLE', 'ARC', 'RECTANGLE', 'SMART_DIMENSION', 'TRIM', 'EXTEND', 'OFFSET', 'MIRROR', 'PATTERN', 'TEXT', 'SPLINE'],
  EVALUATE: ['MEASURE', 'MASS_PROPS', 'INTERFERENCE', 'SECTION_VIEW', 'EQUATIONS']
};

export const useCadStore = create<CadState>()(
  persist(
    (set, get) => ({
      projectName: 'Professional CAD Project',
      setProjectName: (projectName) => set({ projectName }),
      isDirty: false,
      lastSavedAt: null,
      projectFilePath: null,
      markProjectDirty: () => set({ isDirty: true }),
      markProjectClean: () => set({ isDirty: false, lastSavedAt: new Date().toISOString() }),
      setProjectFilePath: (projectFilePath) => set({ projectFilePath }),
      drawingScale: '1:1',
      setDrawingScale: (drawingScale) => set({ drawingScale }),
      drawnBy: 'SkillsBuilder',
      setDrawnBy: (drawnBy) => set({ drawnBy }),
      approvedBy: 'Admin',
      setApprovedBy: (approvedBy) => set({ approvedBy }),

      configurations: [{ id: 'default', name: 'Default', featureSuppression: {}, parameterOverrides: {} }],
      activeConfigurationId: 'default',
      setConfigurations: (configurations) => set({ configurations }),
      setActiveConfiguration: (id) => set((state) => {
        const targetConfig = state.configurations.find(c => c.id === id);
        if (!targetConfig) return state;

        // 1. Save current features state to the active configuration before switching
        const nextConfigs = state.configurations.map(c => {
          if (c.id === state.activeConfigurationId) {
            const suppression: Record<string, boolean> = {};
            const overrides: Record<string, any> = {};
            state.features.forEach(f => {
              suppression[f.id] = !!f.isSuppressed;
              overrides[f.id] = JSON.parse(JSON.stringify(f.parameters));
            });
            return { ...c, featureSuppression: suppression, parameterOverrides: overrides };
          }
          return c;
        });

        // 2. Apply target configuration to features
        const nextFeatures = state.features.map(f => {
          const isSuppressed = !!targetConfig.featureSuppression[f.id];
          const overrides = targetConfig.parameterOverrides[f.id];
          return { 
            ...f, 
            isSuppressed, 
            parameters: overrides ? JSON.parse(JSON.stringify(overrides)) : f.parameters 
          };
        });

        return {
          configurations: nextConfigs,
          activeConfigurationId: id,
          features: nextFeatures,
          rebuildDirty: true,
          dirtyFromFeatureIndex: 0
        };
      }),
      addConfiguration: (config) => set((state) => ({ configurations: [...state.configurations, config] })),
      deleteConfiguration: (id) => set((state) => ({
        configurations: state.configurations.filter(c => c.id !== id),
        activeConfigurationId: state.activeConfigurationId === id ? 'default' : state.activeConfigurationId
      })),
      toggleFeatureSuppression: (featureId, configId) => set((state) => {
        const targetConfigId = configId || state.activeConfigurationId;
        const nextConfigs = state.configurations.map(c => {
          if (c.id === targetConfigId) {
            const isNowSuppressed = !c.featureSuppression[featureId];
            return { ...c, featureSuppression: { ...c.featureSuppression, [featureId]: isNowSuppressed } };
          }
          return c;
        });
        const nextFeatures = state.features.map(f => (f.id === featureId && targetConfigId === state.activeConfigurationId) ? { ...f, isSuppressed: !f.isSuppressed } : f);
        return { configurations: nextConfigs, features: nextFeatures };
      }),

      globalVariables: {},
      evaluatedVariables: {},
      setGlobalVariable: (name, formula) => set((state) => {
        const normalizedName = name.toUpperCase().replace(/[^A-Z0-9_]/g, '');
        const nextVars = { ...state.globalVariables, [normalizedName]: formula };
        const { EquationEngine } = require('../utils/EquationEngine');
        const nextEvaluated = EquationEngine.solveVariableChain(nextVars);
        return { globalVariables: nextVars, evaluatedVariables: nextEvaluated, rebuildDirty: true };
      }),
      removeGlobalVariable: (name) => set((state) => {
        const nextVars = { ...state.globalVariables };
        delete nextVars[name];
        const { EquationEngine } = require('../utils/EquationEngine');
        const nextEvaluated = EquationEngine.solveVariableChain(nextVars);
        return { globalVariables: nextVars, evaluatedVariables: nextEvaluated, rebuildDirty: true };
      }),
      refreshEvaluatedVariables: () => set((state) => {
        const { EquationEngine } = require('../utils/EquationEngine');
        const nextEvaluated = EquationEngine.solveVariableChain(state.globalVariables);
        return { evaluatedVariables: nextEvaluated };
      }),

      mode: 'PART',
      setMode: (mode) => set({ 
        mode,
        activeTab: mode === 'ASSEMBLY' ? 'ASSEMBLY' : (mode === 'DRAWING' ? 'DRAWING' : 'FEATURES')
      }),
      activeTab: 'FEATURES',
      setActiveTab: (activeTab) => set({ activeTab }),
      activeComponentId: null,
      setActiveComponentId: (activeComponentId) => set({ activeComponentId }),
      isSketchMode: false,
      setSketchMode: (isSketchMode) => set((state) => ({ 
        isSketchMode,
        activeTab: isSketchMode ? 'SKETCH' : (state.activeTab === 'SKETCH' ? 'FEATURES' : state.activeTab)
      })),
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
      revolveAxisId: null,
      setRevolveAxisId: (revolveAxisId) => set({ revolveAxisId }),
      sketchTool: 'SELECT',
      setSketchTool: (sketchTool) => set({ 
        sketchTool,
        // Reset chain state when switching tools to prevent cross-tool pollution
        lastClickedNodeId: null,
        sketchNewChain: true,
        firstChainNodeId: null
      }),
      gridSnap: true,
      setGridSnap: (gridSnap) => set({ gridSnap }),
      sketchNewChain: false,
      setSketchNewChain: (sketchNewChain) => set({ sketchNewChain }),
      lastClickedNodeId: null,
      setLastClickedNodeId: (lastClickedNodeId) => set({ lastClickedNodeId }),
      firstChainNodeId: null,
      setFirstChainNodeId: (firstChainNodeId) => set({ firstChainNodeId }),
      
      convertEntities: (selectedEdgeIds) => set((state) => {
        const nextNodes = { ...state.sketchNodes };
        const nextEdges = { ...state.sketchEdges };
        selectedEdgeIds.forEach((id, idx) => {
          const n1 = uuidv4(); const n2 = uuidv4();
          nextNodes[n1] = { id: n1, x: 0 + idx * 10, y: 0 };
          nextNodes[n2] = { id: n2, x: 10 + idx * 10, y: 0 };
          const eId = uuidv4();
          nextEdges[eId] = { id: eId, type: 'LINE', nodeIds: [n1, n2] };
        });
        return { sketchNodes: nextNodes, sketchEdges: nextEdges };
      }),

      selectedEntityIds: [],
      setSelectedEntityIds: (ids) => set((state) => ({ selectedEntityIds: typeof ids === 'function' ? ids(state.selectedEntityIds) : ids })),
      sketchNodes: {},
      setSketchNodes: (nodes) => { get().markRebuildDirty(0); set((state) => ({ sketchNodes: typeof nodes === 'function' ? nodes(state.sketchNodes) : nodes, isDirty: true })); },
      sketchEdges: {},
      setSketchEdges: (edges) => { get().markRebuildDirty(0); set((state) => ({ sketchEdges: typeof edges === 'function' ? edges(state.sketchEdges) : edges, isDirty: true })); },
      sketchConstraints: {},
      setSketchConstraints: (constraints) => { get().markRebuildDirty(0); set((state) => ({ sketchConstraints: typeof constraints === 'function' ? constraints(state.sketchConstraints) : constraints, isDirty: true })); },

      features: [],
      setFeatures: (features) => { get().saveSnapshot(); get().markRebuildDirty(0); set({ features, isDirty: true }); },
      addFeature: (feature) => { get().saveSnapshot(); const fromIndex = get().features.length; get().markRebuildDirty(fromIndex); set((state) => ({ features: [...state.features, feature], isDirty: true })); },
      removeFeature: (id) => { get().saveSnapshot(); const fromIndex = get().features.findIndex((f) => f.id === id); get().markRebuildDirty(fromIndex >= 0 ? fromIndex : 0); set((state) => ({ features: state.features.filter(f => f.id !== id), isDirty: true })); },
      removeFeatures: (ids) => { get().saveSnapshot(); let minIndex = get().features.length; ids.forEach(id => { const idx = get().features.findIndex(f => f.id === id); if (idx >= 0 && idx < minIndex) minIndex = idx; }); get().markRebuildDirty(minIndex < get().features.length ? minIndex : 0); set((state) => ({ features: state.features.filter(f => !ids.includes(f.id)), isDirty: true })); },
      updateFeatureParams: (id, params) => { get().saveSnapshot(); const fromIndex = get().features.findIndex((f) => f.id === id); get().markRebuildDirty(fromIndex >= 0 ? fromIndex : 0); set((state) => ({ features: state.features.map(f => f.id === id ? { ...f, parameters: { ...f.parameters, ...params } } : f), isDirty: true })); },
      updateFeatureProperty: (id, key, value) => { get().saveSnapshot(); const fromIndex = get().features.findIndex((f) => f.id === id); get().markRebuildDirty(fromIndex >= 0 ? fromIndex : 0); set((state) => ({ features: state.features.map(f => f.id === id ? { ...f, [key]: value } : f), isDirty: true })); },

      rebuildDirty: true,
      dirtyFromFeatureIndex: 0,
      markRebuildDirty: (fromFeatureIndex = 0) => set((state) => ({ rebuildDirty: true, dirtyFromFeatureIndex: Math.min(state.dirtyFromFeatureIndex, fromFeatureIndex) })),
      clearRebuildDirty: () => set({ rebuildDirty: false, dirtyFromFeatureIndex: Number.MAX_SAFE_INTEGER }),
      editingFeatureId: null,
      setEditingFeatureId: (editingFeatureId) => set({ editingFeatureId }),
      rollbackIndex: null,
      setRollbackIndex: (rollbackIndex) => set({ rollbackIndex, rebuildDirty: true }),
      selectedId: null,
      setSelectedId: (selectedId) => set({ selectedId }),
      selectedSubNodeType: null,
      setSelectedSubNodeType: (selectedSubNodeType) => set({ selectedSubNodeType }),
      visibleSketches: [],
      toggleSketchVisibility: (featureId) => set((state) => ({ visibleSketches: state.visibleSketches.includes(featureId) ? state.visibleSketches.filter(id => id !== featureId) : [...state.visibleSketches, featureId] })),
      setSuppressed: (id, suppressed) => { get().saveSnapshot(); const fromIndex = get().features.findIndex((f) => f.id === id); get().markRebuildDirty(fromIndex >= 0 ? fromIndex : 0); set((state) => ({ features: state.features.map(f => f.id === id ? { ...f, isSuppressed: suppressed } : f), isDirty: true })); },
      reorderFeatures: (startIndex, endIndex) => { get().saveSnapshot(); get().markRebuildDirty(Math.min(startIndex, endIndex)); set((state) => { const nextFeatures = [...state.features]; const [removed] = nextFeatures.splice(startIndex, 1); nextFeatures.splice(endIndex, 0, removed); return { features: nextFeatures, isDirty: true }; }); },
      checkDependencies: () => set((state) => { const features = [...state.features]; return { features: features.map((f, idx) => { if (f.type === 'FILLET' || f.type === 'CHAMFER') { const targetId = f.parameters?.target_feature_id; if (targetId) { const parentIdx = features.findIndex(p => p.id === targetId); if (parentIdx === -1 || parentIdx >= idx) return { ...f, isBroken: true }; } } return { ...f, isBroken: false }; })}; }),
      hoveredTreeId: null,
      setHoveredTreeId: (id) => set({ hoveredTreeId: id }),
      hoveredChildren: [],
      setHoveredChildren: (ids) => set({ hoveredChildren: ids }),
      history: { past: [], future: [] },
      saveSnapshot: () => set((state) => {
        const snapshot = JSON.parse(JSON.stringify({
          features: state.features,
          sketchNodes: state.sketchNodes,
          sketchEdges: state.sketchEdges,
          sketchConstraints: state.sketchConstraints,
          mates: state.mates,
          components: state.components
        }));
        return { history: { past: [...state.history.past.slice(-50), snapshot], future: [] } };
      }),
      undo: () => set((state) => {
        if (state.history.past.length === 0) return state;
        const previous = state.history.past[state.history.past.length - 1];
        const newPast = state.history.past.slice(0, state.history.past.length - 1);
        const current = JSON.parse(JSON.stringify({
          features: state.features,
          sketchNodes: state.sketchNodes,
          sketchEdges: state.sketchEdges,
          sketchConstraints: state.sketchConstraints,
          mates: state.mates,
          components: state.components
        }));
        return { ...previous, rebuildDirty: true, history: { past: newPast, future: [current, ...state.history.future] } };
      }),
      redo: () => set((state) => {
        if (state.history.future.length === 0) return state;
        const next = state.history.future[0];
        const newFuture = state.history.future.slice(1);
        const current = JSON.parse(JSON.stringify({
          features: state.features,
          sketchNodes: state.sketchNodes,
          sketchEdges: state.sketchEdges,
          sketchConstraints: state.sketchConstraints,
          mates: state.mates,
          components: state.components
        }));
        return { ...next, rebuildDirty: true, history: { past: [...state.history.past, current], future: newFuture } };
      }),
      selectedTopology: null,
      setSelectedTopology: (selectedTopology) => set({ selectedTopology }),
      measurementMode: 'NONE',
      setMeasurementMode: (measurementMode) => set((state) => ({ 
        measurementMode,
        activeTab: measurementMode !== 'NONE' ? 'EVALUATE' : state.activeTab
      })),
      measurementPoints: [],
      setMeasurementPoints: (measurementPoints) => set({ measurementPoints }),
      measurementResults: null,
      setMeasurementResults: (measurementResults) => set({ measurementResults }),
      dimensionSelection: [],
      addDimensionSelection: (id) => set((state) => ({ dimensionSelection: [...state.dimensionSelection, id] })),
      clearDimensionSelection: () => set({ dimensionSelection: [] }),
      components: [],
      setComponents: (components) => set({ components }),
      addComponent: (component) => set((state) => ({ components: [...state.components, component] })),
      removeComponent: (id) => set((state) => ({ components: state.components.filter(c => c.id !== id), mates: state.mates.filter(m => m.entity1.componentId !== id && m.entity2.componentId !== id) })),
      updateComponentTransform: (id, position, rotation) => set((state) => { get().saveSnapshot(); return { components: state.components.map(c => c.id === id ? { ...c, transform: { position, rotation } } : c) }; }),
      updateComponentColor: (id, color) => set((state) => { get().saveSnapshot(); return { components: state.components.map(c => c.id === id ? { ...c, color } : c) }; }),
      toggleComponentFixed: (id) => set((state) => { get().saveSnapshot(); return { components: state.components.map(c => c.id === id ? { ...c, isFixed: !c.isFixed } : c) }; }),
      toggleLightweight: (id) => set((state) => { get().saveSnapshot(); return { components: state.components.map(c => c.id === id ? { ...c, isLightweight: !c.isLightweight } : c) }; }),
      setAllLightweight: (light) => set((state) => { get().saveSnapshot(); return { components: state.components.map(c => ({ ...c, isLightweight: light })) }; }),
      isLargeAssemblyMode: false,
      setLargeAssemblyMode: (active) => set({ isLargeAssemblyMode: active }),
      isPhysicsActive: false,
      setIsPhysicsActive: (active) => set({ isPhysicsActive: active }),
      draggedComponentId: null,
      setDraggedComponentId: (id) => set({ draggedComponentId: id }),
      automationLog: [],
      addAutomationLog: (log) => set((state) => ({ automationLog: [...state.automationLog, log] })),
      activeAutomationStep: null,
      setActiveAutomationStep: (activeAutomationStep) => set({ activeAutomationStep }),
      robotStatus: 'IDLE',
      setRobotStatus: (robotStatus) => set({ robotStatus }),
      mates: [],
      setMates: (mates) => set({ mates }),
      addMate: (mate) => set((state) => { get().saveSnapshot(); return { mates: [...state.mates, mate] }; }),
      removeMate: (id) => set((state) => { get().saveSnapshot(); return { mates: state.mates.filter(m => m.id !== id) }; }),
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
      assemblyPreviewComponents: null,
      setAssemblyPreviewComponents: (assemblyPreviewComponents) => set({ assemblyPreviewComponents }),
      massProperties: null,
      setMassProperties: (massProperties) => set({ massProperties }),
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
      pushToast: (message, type = 'error') => { const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; set((state) => ({ toasts: [...state.toasts.slice(-4), { id, message, type }] })); setTimeout(() => { const current = get().toasts; if (current.some((t) => t.id === id)) { set({ toasts: current.filter((t) => t.id !== id) }); } }, 7000); },
      dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
      pendingFeatureCommand: null,
      setPendingFeatureCommand: (cmd) => set({ pendingFeatureCommand: cmd }),
      defaultFilletRadius: 2,
      defaultChamferDistance: 1.5,
      referencePlanes: [],
      setReferencePlanes: (referencePlanes) => set({ referencePlanes }),
      referenceAxes: [],
      setReferenceAxes: (referenceAxes) => set({ referenceAxes }),
      referencePoints: [],
      setReferencePoints: (referencePoints) => set({ referencePoints }),
      activePropertyManager: null,
      setActivePropertyManager: (activePropertyManager) => set({ activePropertyManager }),
      showExportModal: false,
      setShowExportModal: (showExportModal) => set({ showExportModal }),
      viewportDisplayMode: 'SHADED_EDGES',
      setViewportDisplayMode: (viewportDisplayMode) => set({ viewportDisplayMode }),
      cameraNormalTrigger: 0,
      cameraNormalFlip: false,
      cameraNormalLastPlane: null,
      triggerCameraNormal: () => set((state) => { const isSamePlane = state.cameraNormalLastPlane === state.activePlane; return { cameraNormalTrigger: state.cameraNormalTrigger + 1, cameraNormalLastPlane: state.activePlane, cameraNormalFlip: isSamePlane ? !state.cameraNormalFlip : false }; }),
      controls: null,
      setControls: (controls) => set({ controls }),
      isCameraAnimating: false,
      setIsCameraAnimating: (isCameraAnimating) => set({ isCameraAnimating }),
      sectionView: { isActive: false, plane: 'FRONT', offset: 0, flip: false },
      setSectionView: (view) => set((state) => ({ sectionView: { ...state.sectionView, ...view } })),
      explodedView: { isActive: false, factor: 0, directions: {} },
      setExplodedView: (view) => set((state) => ({ explodedView: { ...state.explodedView, ...view } })),
      setExplosionFactor: (factor) => set((state) => ({ explodedView: { ...state.explodedView, factor } })),
      calculateAutoExplosion: () => { const { components } = get(); if (components.length === 0) return; let cx = 0, cy = 0, cz = 0; components.forEach(c => { cx += c.transform.position[0]; cy += c.transform.position[1]; cz += c.transform.position[2]; }); cx /= components.length; cy /= components.length; cz /= components.length; const directions: Record<string, [number, number, number]> = {}; components.forEach(c => { const dx = c.transform.position[0] - cx; const dy = c.transform.position[1] - cy; const dz = c.transform.position[2] - cz; const len = Math.sqrt(dx*dx + dy*dy + dz*dz); if (len > 1e-6) { directions[c.id] = [dx/len, dy/len, dz/len]; } else { directions[c.id] = [1, 1, 1]; } }); set({ explodedView: { ...get().explodedView, directions } }); },
      motionStudy: { isActive: false, currentTime: 0, playbackSpeed: 1, drivers: [] },
      setMotionStudy: (study) => set((state) => ({ motionStudy: { ...state.motionStudy, ...study } })),
      addMotionDriver: (driver) => set((state) => ({ motionStudy: { ...state.motionStudy, drivers: [...state.motionStudy.drivers, driver] } })),
      removeMotionDriver: (id) => set((state) => ({ motionStudy: { ...state.motionStudy, drivers: state.motionStudy.drivers.filter(d => d.id !== id) } })),
      partMaterial: 'Steel',
      setPartMaterial: (m) => set({ partMaterial: m }),
      environmentMap: 'studio',
      setEnvironmentMap: (env) => set({ environmentMap: env }),
      ribbonLayout: DEFAULT_RIBBON_LAYOUT,
      setRibbonLayout: (ribbonLayout) => set({ ribbonLayout }),
      resetRibbonLayout: () => set({ ribbonLayout: DEFAULT_RIBBON_LAYOUT }),
      commitPreciseSketchSolve: () => { /* Logic would go here */ },
      viewOrientationSelectorVisible: false,
      setViewOrientationSelectorVisible: (visible) => set({ viewOrientationSelectorVisible: visible }),
      showMaterialModal: false,
      setShowMaterialModal: (showMaterialModal) => set({ showMaterialModal }),
      targetMaterialEntity: null,
      setTargetMaterialEntity: (targetMaterialEntity) => set({ targetMaterialEntity }),
      hoveredEntityId: null,
      setHoveredEntityId: (hoveredEntityId) => set({ hoveredEntityId }),
      selection: { nodes: [], edges: [], features: [], faces: [] },
    }),
    {
      name: 'cad-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        projectName: state.projectName,
        drawingScale: state.drawingScale,
        drawnBy: state.drawnBy,
        approvedBy: state.approvedBy,
        configurations: state.configurations,
        activeConfigurationId: state.activeConfigurationId,
        globalVariables: state.globalVariables,
        mode: state.mode,
        activeTab: state.activeTab,
        activeComponentId: state.activeComponentId,
        isSketchMode: state.isSketchMode,
        smartDimensionActive: state.smartDimensionActive,
        activePlane: state.activePlane,
        activeFaceOrigin: state.activeFaceOrigin,
        activeFaceNormal: state.activeFaceNormal,
        activeFaceId: state.activeFaceId,
        revolveAxisId: state.revolveAxisId,
        sketchTool: state.sketchTool,
        gridSnap: state.gridSnap,
        sketchNewChain: state.sketchNewChain,
        lastClickedNodeId: state.lastClickedNodeId,
        firstChainNodeId: state.firstChainNodeId,
        selectedEntityIds: state.selectedEntityIds,
        sketchNodes: state.sketchNodes,
        sketchEdges: state.sketchEdges,
        sketchConstraints: state.sketchConstraints,
        features: state.features,
        editingFeatureId: state.editingFeatureId,
        rollbackIndex: state.rollbackIndex,
        selectedId: state.selectedId,
        selectedSubNodeType: state.selectedSubNodeType,
        visibleSketches: state.visibleSketches,
        hoveredTreeId: state.hoveredTreeId,
        hoveredChildren: state.hoveredChildren,
        selectedTopology: state.selectedTopology,
        measurementMode: state.measurementMode,
        measurementPoints: state.measurementPoints,
        measurementResults: state.measurementResults,
        dimensionSelection: state.dimensionSelection,
        components: state.components,
        mates: state.mates,
        mateSelection: state.mateSelection,
        meshData: state.meshData,
        interferenceMeshes: state.interferenceMeshes,
        interferenceResults: state.interferenceResults,
        interferenceActive: state.interferenceActive,
        solverReport: state.solverReport,
        assemblyPreviewComponents: state.assemblyPreviewComponents,
        massProperties: state.massProperties,
        computedRefGeometry: state.computedRefGeometry,
        contextMenu: state.contextMenu,
        shortcutBox: state.shortcutBox,
        mousePos: state.mousePos,
        hint: state.hint,
        danglingNodes: state.danglingNodes,
        pendingFeatureCommand: state.pendingFeatureCommand,
        defaultFilletRadius: state.defaultFilletRadius,
        defaultChamferDistance: state.defaultChamferDistance,
        referencePlanes: state.referencePlanes,
        referenceAxes: state.referenceAxes,
        referencePoints: state.referencePoints,
        activePropertyManager: state.activePropertyManager,
        showExportModal: state.showExportModal,
        viewportDisplayMode: state.viewportDisplayMode,
        cameraNormalTrigger: state.cameraNormalTrigger,
        cameraNormalFlip: state.cameraNormalFlip,
        cameraNormalLastPlane: state.cameraNormalLastPlane,
        sectionView: state.sectionView,
        explodedView: state.explodedView,
        motionStudy: state.motionStudy,
        partMaterial: state.partMaterial,
        environmentMap: state.environmentMap,
        ribbonLayout: state.ribbonLayout,
        viewOrientationSelectorVisible: state.viewOrientationSelectorVisible,
        showMaterialModal: state.showMaterialModal,
        targetMaterialEntity: state.targetMaterialEntity,
        hoveredEntityId: state.hoveredEntityId,
        selection: state.selection,
      }),
    }
  )
);
