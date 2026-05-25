﻿'use client';



import React, { useEffect, useState, useCallback, useMemo, Fragment, useRef } from 'react';

import Viewport from '@/renderer/Viewport';

import OcctShape, { type MeshData } from '@/renderer/OcctShape';

import { useCadStore, type CADFeature } from '@/store/useCadStore';

import { HeavyEngineClient } from '@/kernel/HeavyEngineClient';

import { MeasurementService } from '@/kernel/MeasurementService';

import { MeasurementPanel } from '@/ui/MeasurementPanel';

import { SketchHUD } from '@/renderer/SketchHUD';

import { onFileOpen, onSaveRequest, onNewFile, appAPI, fileAPI } from '../../electron/renderer';

import { MatePanel } from '@/ui/MatePanel';

import { DrawingSheet } from '@/ui/DrawingSheet';

import { SketchPropertyManager } from '@/ui/SketchPropertyManager';

import { v4 as uuidv4 } from 'uuid';

import { extractClosedLoop, extractAllClosedLoops } from '@/utils/geometry/GraphAdapter';

import { analyzeSketchDefinitions } from '@/utils/geometry/ConstraintSolver';

import { HeadsUpToolbar } from '@/ui/HeadsUpToolbar';

import { StatusBar } from '@/ui/StatusBar';

import { ShortcutBox } from '@/ui/ShortcutBox';

import { ContextMenu } from '@/ui/ContextMenu';



const isSketchPlane = (plane: unknown): plane is 'FRONT' | 'TOP' | 'RIGHT' | 'FACE' => (

  plane === 'FRONT' || plane === 'TOP' || plane === 'RIGHT' || plane === 'FACE'

);



const cloneSketchPoints = (points: unknown[]) => (

  points.map((pt) => Array.isArray(pt) ? [...pt] : pt)

);



export interface SketchEntity {

  id: string;

  type: 'LINE' | 'CENTER_LINE' | 'CIRCLE' | 'RECTANGLE';

  name: string;

  pointIndices: number[];

  center?: [number, number];

  radius?: number;

}



export default function Home() {

  const client = HeavyEngineClient.getInstance();
  const rebuildController = useRef<AbortController | null>(null);

  // Electron Native Integration

  useEffect(() => {

    if (typeof window === 'undefined' || !window.electronAPI) return;



    const unsubs = [

      onFileOpen(async (path) => {

        const result = await fileAPI.read(path);

        if (result.success && result.content) {

          loadCadData(result.content, path);

        }

      }),

      onSaveRequest(async () => {

        handleSaveSldprt();

      }),

      onNewFile(() => {

        if (confirm('Create new project? All unsaved changes will be lost.')) {

          useCadStore.setState({ 

            features: [], 

            projectName: 'New Project',

            meshData: [],

            selectedId: null,

            components: [],

            mates: []

          });

          appAPI.notify('New Project', 'Workspace cleared');

        }

      })

    ];



    return () => unsubs.forEach(unsub => unsub());

  }, []);


    // Continuous Heartbeat to force connection recovery
    useEffect(() => {
      const check = async () => {
        const client = HeavyEngineClient.getInstance();
        try {
          const isAlive = await client.checkHealth();
          setEngineStatus(isAlive ? 'CONNECTED' : 'DISCONNECTED');
        } catch (e) {
          setEngineStatus('DISCONNECTED');
        }
      };
      const timer = setInterval(check, 2000);
      check();
      return () => clearInterval(timer);
    }, []);

  const { mode, setMode,

    projectName, setProjectName,

    drawingScale, setDrawingScale,

    drawnBy, setDrawnBy,

    approvedBy, setApprovedBy,

    features,

    addFeature,

    removeFeature,

    updateFeatureParams,

    editingFeatureId,

    setEditingFeatureId,

    rollbackIndex,

    setRollbackIndex,

    selectedId,

    setSelectedId,

    selectedSubNodeType, setSelectedSubNodeType,

    visibleSketches, toggleSketchVisibility,

    meshData, setMeshData,

    isSketchMode, smartDimensionActive, setSmartDimensionActive, setSketchMode,

    activePlane, setActivePlane,

    sketchTool, setSketchTool,

    gridSnap, setGridSnap,

    measurementMode, setMeasurementMode,

    measurementPoints, setMeasurementPoints,

    measurementResults, setMeasurementResults,

    mateSelection, setMateSelection,

    addComponent, components, setComponents,

    setContextMenu,

    shortcutBox, setShortcutBox,

    sketchNewChain, setSketchNewChain,

    selectedEntityIds, setSelectedEntityIds,

    selectedTopology, setSelectedTopology,

    activeFaceOrigin, setActiveFaceOrigin,

    activeFaceNormal, setActiveFaceNormal,

    activeFaceId, setActiveFaceId,

    triggerCameraNormal,

    sketchNodes, setSketchNodes, sketchEdges, setSketchEdges, sketchConstraints, setSketchConstraints,

    hint, setHint } = useCadStore();



  // Hint Logic Update

  useEffect(() => {

    if (isSketchMode) {

      switch (sketchTool) {

        case 'LINE': setHint('Sketch Mode (Line)'); break;

        case 'CENTER_LINE': setHint('Sketch Mode (Centerline)'); break;

        case 'CIRCLE': setHint('Sketch Mode (Circle)'); break;

        case 'RECTANGLE': setHint('Sketch Mode (Rectangle)'); break;

        case 'ARC': setHint('Sketch Mode (3-Point Arc)'); break;

        case 'MIDPOINT_LINE': setHint('Sketch Mode (Midpoint Line)'); break;

        default: setHint('Sketch Mode');

      }

    } else if (measurementMode !== 'NONE') {

      setHint(` (${measurementMode})`);

    } else if (selectedTopology?.type === 'FACE') {

      setHint('Selected');

    } else if (selectedId) {

      setHint(`Selected: ${features.find(f => f.id === selectedId)?.name || ''}`);

    } else {

      setHint('PartMode:');

    }

  }, [isSketchMode, sketchTool, measurementMode, selectedTopology, selectedId, features, setHint]);



  // Legacy stubs to prevent TS errors in dead code

  const sketchPoints: any[] = [];

  const setSketchPoints = (pts: any) => {};

  const sketchRelations: any[] = [];

  const setSketchRelations = (rels: any) => {};



  const [hoveredTreeId, setHoveredTreeId] = useState<string | null>(null);



  const getTreeRelation = useCallback((targetId: string, hoveredId: string | null): 'NONE' | 'PARENT' | 'CHILD' => {

    if (!hoveredId || targetId === hoveredId) return 'NONE';



    // 1. If hovered is a Feature

    if (hoveredId.startsWith('feat_')) {

      const hoveredFeat = features.find(f => f.id === hoveredId);

      const hoveredPlane = hoveredFeat?.parameters?.plane || 'FRONT';



      // Standard plane relationships

      if (targetId === hoveredPlane || targetId === 'ORIGIN') return 'PARENT';



      // Feature-to-Feature relationships

      if (hoveredId === 'feat_base_plate') {

        if (targetId === 'feat_center_hole' || targetId === 'feat_corner_fillets') return 'CHILD';

      }

      if (hoveredId === 'feat_center_hole' || hoveredId === 'feat_corner_fillets') {

        if (targetId === 'feat_base_plate') return 'PARENT';

      }

      

      // Dynamic fallback for custom features

      if (targetId === 'feat_base_plate') return 'PARENT';

      if (hoveredId === 'feat_base_plate') return 'CHILD';

    }



    // 2. If hovered is a Standard Plane or Origin

    if (hoveredId === 'FRONT' || hoveredId === 'TOP' || hoveredId === 'RIGHT' || hoveredId === 'ORIGIN') {

      if (targetId.startsWith('feat_')) {

        const targetFeat = features.find(f => f.id === targetId);

        const targetPlane = targetFeat?.parameters?.plane || 'FRONT';



        if (hoveredId === 'ORIGIN') return 'CHILD';

        if (targetPlane === hoveredId) return 'CHILD';

      }

    }



    return 'NONE';

  }, [features]);



  const measurementService = useMemo(() => new MeasurementService(), []);



  // Listen to selectedTopology changes in Measurement Mode

  useEffect(() => {

    const clickedTopo = useCadStore.getState().selectedTopology;

    if (isSketchMode || measurementMode === 'NONE' || !clickedTopo) return;



    const prevPoints = useCadStore.getState().measurementPoints || [];

    if (prevPoints.some((p: any) => p.id === clickedTopo.id)) {

      useCadStore.getState().setSelectedTopology(null);

      return;

    }



    let nextPts = [...prevPoints];

    

    if (measurementMode === 'DISTANCE') {

      if (nextPts.length >= 2) nextPts = [clickedTopo];

      else nextPts.push(clickedTopo);

    } else if (measurementMode === 'ANGLE') {

      if (clickedTopo.type !== 'EDGE') {

        useCadStore.getState().setSelectedTopology(null);

        return;

      }

      if (nextPts.length >= 2) nextPts = [clickedTopo];

      else nextPts.push(clickedTopo);

    } else if (measurementMode === 'AREA') {

      if (clickedTopo.type !== 'FACE') {

        useCadStore.getState().setSelectedTopology(null);

        return;

      }

      nextPts = [clickedTopo];

    } else if (measurementMode === 'VOLUME') {

      nextPts = [clickedTopo];

    }



    setMeasurementPoints(nextPts);



    // Calculate results immediately

    if (measurementMode === 'DISTANCE' && nextPts.length === 2) {

      const val = measurementService.calculateDistance(

        nextPts[0].coordinates,

        nextPts[1].coordinates

      );

      setMeasurementResults({

        mode: 'DISTANCE',

        value: val,

        unit: 'mm',

        details: ` D = ${val.toFixed(3)} mm`

      });

    } else if (measurementMode === 'ANGLE' && nextPts.length === 2) {

      const edgeA = nextPts[0].edgeData;

      const edgeB = nextPts[1].edgeData;

      if (edgeA && edgeB) {

        const val = measurementService.calculateEdgeAngle(

          edgeA.start, edgeA.end,

          edgeB.start, edgeB.end

        );

        setMeasurementResults({

          mode: 'ANGLE',

          value: val,

          unit: '',

          details: ` = ${val.toFixed(2)}`

        });

      }

    } else if (measurementMode === 'AREA' && nextPts.length === 1) {

      let areaVal = 100.0;

      const currentFeat = features.find(f => f.id === selectedId);

      if (currentFeat) {

        const params = currentFeat.parameters;

        if (currentFeat.type === 'BOX') {

          areaVal = (params.width ?? 10) * (params.height ?? 10);

        } else if (currentFeat.type === 'CYLINDER') {

          areaVal = Math.PI * (params.radius ?? 5) * (params.radius ?? 5);

        }

      }

      setMeasurementResults({

        mode: 'AREA',

        value: areaVal,

        unit: 'mm',

        details: ` = ${areaVal.toFixed(3)} mm`

      });

    } else if (measurementMode === 'VOLUME' && nextPts.length === 1) {

      let volVal = 1000.0;

      const currentFeat = features.find(f => f.id === selectedId);

      if (currentFeat) {

        const params = currentFeat.parameters;

        if (currentFeat.type === 'BOX') {

          volVal = (params.width ?? 10) * (params.height ?? 10) * (params.depth ?? 10);

        } else if (currentFeat.type === 'CYLINDER') {

          volVal = Math.PI * (params.radius ?? 5) * (params.radius ?? 5) * (params.height ?? 10);

        } else if (currentFeat.type === 'SPHERE') {

          volVal = (4/3) * Math.PI * Math.pow(params.radius ?? 5, 3);

        } else if (currentFeat.type === 'EXTRUDE') {

          volVal = 3000.0;

        }

      }

      setMeasurementResults({

        mode: 'VOLUME',

        value: volVal,

        unit: 'mm',

        details: ` = ${volVal.toFixed(3)} mm`

      });

    }



    useCadStore.getState().setSelectedTopology(null);

  }, [measurementMode, isSketchMode, measurementService, features, selectedId, setMeasurementPoints, setMeasurementResults]);





  const [loading, setLoading] = useState(false);
  

  const [engineStatus, setEngineStatus] = useState<'CONNECTED' | 'DISCONNECTED'>('DISCONNECTED');

  const [activeTab, setActiveTab] = useState<'FEATURES' | 'SKETCH' | 'EVALUATE' | 'ASSEMBLY' | 'DRAWING'>('FEATURES');

  const [massProps, setMassProps] = useState<{

    volume: number;

    surface_area: number;

    center_of_mass: number[];

    inertia_matrix: number[][];

  } | null>(null);

  const [showMassPropsModal, setShowMassPropsModal] = useState(false);

  const [showTranslatorModal, setShowTranslatorModal] = useState(false);

  



  // Dynamic LocalStorage self-cleanup of legacy mockup features

  useEffect(() => {

    if (features.some(f => f.id === 'feat_1')) {

      useCadStore.setState({ features: [], selectedId: null });

      setMeshData([]);

    }

  }, [features, setMeshData]);



  // Global Keyboard Shortcuts for Sketch Mode (L to draw Line, A to draw Arc, Esc to finish chain)

  useEffect(() => {

    const handleGlobalKeyDown = (e: KeyboardEvent) => {

      if (!isSketchMode) return;

      

      // Prevent stealing focus from input fields

      if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {

        return;

      }



      const key = e.key.toLowerCase();

      if (key === 'l') {

        setSketchTool('SELECT');

      } else if (key === 'a') {

        setSketchTool('ARC');

      } else if (e.key === 'Escape') {

        // Esc ends current continuous polyline segment, but doesn't exit the tool

        let newPts = [...sketchPoints];

        if (newPts.length > 0) {

          const last = newPts[newPts.length - 1];

          if (last[2] && (last[2].includes('MIDPOINT_CENTER') || last[2].includes('CIRCLE_CENTER') || last[2].includes('RECT_CORNER'))) {

            newPts.pop(); // Remove dangling center helper

          }

        }

        setSketchPoints(newPts);

        setSketchNewChain(true);

      } else if (e.key === 'Delete' || e.key === 'Backspace') {

        const state = useCadStore.getState();

        const selectedIds = state.selectedEntityIds || [];

        

        if (selectedIds.length > 0) {

          e.preventDefault();

          const nextNodes = { ...state.sketchNodes };

          const nextEdges = { ...state.sketchEdges };

          const nextConstraints = { ...state.sketchConstraints };

          

          const nodesToDelete = new Set();

          const edgesToDelete = new Set();

          const constraintsToDelete = new Set();



          selectedIds.forEach(id => {

            if (nextNodes[id]) nodesToDelete.add(id);

            if (nextEdges[id]) edgesToDelete.add(id);

            if (nextConstraints[id]) constraintsToDelete.add(id);

          });



          Object.values(nextEdges).forEach((edge: any) => {

            if (edge.nodeIds.some((nid: string) => nodesToDelete.has(nid))) {

              edgesToDelete.add(edge.id);

            }

          });



          Object.values(nextConstraints).forEach((c: any) => {

            if (c.nodeIds?.some((nid: string) => nodesToDelete.has(nid))) constraintsToDelete.add(c.id);

            if (c.edgeIds?.some((eid: string) => edgesToDelete.has(eid))) constraintsToDelete.add(c.id);

          });



          nodesToDelete.forEach((id: any) => delete nextNodes[id]);

          edgesToDelete.forEach((id: any) => delete nextEdges[id]);

          constraintsToDelete.forEach((id: any) => delete nextConstraints[id]);



          state.setSketchNodes(nextNodes);

          state.setSketchEdges(nextEdges);

          state.setSketchConstraints(nextConstraints);

          state.setSelectedEntityIds([]);

        }

      }

    };

    window.addEventListener('keydown', handleGlobalKeyDown);

    return () => window.removeEventListener('keydown', handleGlobalKeyDown);

  }, [isSketchMode, setSketchTool, setSketchNewChain]);



  // Global Keyboard Shortcuts (S for Shortcut Box)

  useEffect(() => {

    const handleSKey = (e: KeyboardEvent) => {

      if (e.key.toLowerCase() === 's') {

        if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {

          return;

        }

        e.preventDefault();

        // Use last mouse position from store or center of screen if not available

        const { mousePos } = useCadStore.getState();

        // Since we need screen coordinates, we'll use the event if available, 

        // but since this is a global listener, we might need to track clientX/Y

      }

    };



    const handleMouseMove = (e: MouseEvent) => {

      (window as any)._lastClientX = e.clientX;

      (window as any)._lastClientY = e.clientY;

    };



    const handleKeyDown = (e: KeyboardEvent) => {

      if (e.key.toLowerCase() === 's') {

        if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {

          return;

        }

        e.preventDefault();

        setShortcutBox({

          visible: true,

          x: (window as any)._lastClientX || window.innerWidth / 2,

          y: (window as any)._lastClientY || window.innerHeight / 2

        });

      }

    };



    window.addEventListener('mousemove', handleMouseMove);

    window.addEventListener('keydown', handleKeyDown);

    return () => {

      window.removeEventListener('mousemove', handleMouseMove);

      window.removeEventListener('keydown', handleKeyDown);

    };

  }, [setShortcutBox]);



  const selectedFeature = useMemo(() => features.find(f => f.id === selectedId), [features, selectedId]);

  const solidSketchPointCount = useMemo(

    () => sketchPoints.filter(pt => !pt[2] || !pt[2].includes('CENTER_LINE')).length,

    [sketchPoints]

  );



  const hasConflict = useMemo(() => {

    if (!isSketchMode) return false;

    const report = analyzeSketchDefinitions(sketchNodes, sketchEdges, sketchConstraints);

    return report.hasConflict;

  }, [isSketchMode, sketchNodes, sketchEdges, sketchConstraints]);



  const entities = useMemo(() => {

    const list: SketchEntity[] = [];

    let i = 0;

    

    while (i < sketchPoints.length) {

      // 1. Check if it's a Circle (37 points closed loop)

      if (i + 36 < sketchPoints.length) {

        const pStart = sketchPoints[i];

        const pEnd = sketchPoints[i + 36];

        if (Math.hypot(pStart[0] - pEnd[0], pStart[1] - pEnd[1]) < 0.1) {

          const pts = sketchPoints.slice(i, i + 37);

          const us = pts.map(p => p[0]);

          const vs = pts.map(p => p[1]);

          const minU = Math.min(...us);

          const maxU = Math.max(...us);

          const minV = Math.min(...vs);

          const maxV = Math.max(...vs);

          const cU = (minU + maxU) / 2;

          const cV = (minV + maxV) / 2;

          const radius = (maxU - minU) / 2;

          

          list.push({

            id: `circle_${i}`,

            type: 'CIRCLE',

            name: ` C${list.filter(e => e.type === 'CIRCLE').length + 1}`,

            pointIndices: Array.from({ length: 37 }, (_, k) => i + k),

            center: [cU, cV],

            radius: radius

          });

          i += 37;

          continue;

        }

      }

      

      // 2. Check if it's a Rectangle (5 points closed loop)

      if (i + 4 < sketchPoints.length) {

        const pStart = sketchPoints[i];

        const pEnd = sketchPoints[i + 4];

        if (Math.hypot(pStart[0] - pEnd[0], pStart[1] - pEnd[1]) < 0.1) {

          list.push({

            id: `rect_${i}`,

            type: 'RECTANGLE',

            name: `矩形 R${list.filter(e => e.type === 'RECTANGLE').length + 1}`,

            pointIndices: Array.from({ length: 5 }, (_, k) => i + k)

          });

          i += 5;

          continue;

        }

      }

      

      // 3. Otherwise, check segments

      const pCurr = sketchPoints[i];

      const pNext = sketchPoints[i + 1];

      if (pNext) {

        if (pNext[2] && pNext[2].includes('START')) {

          // This is a new chain boundary. Do NOT connect them!

          i += 1;

        } else if (pCurr[2] && pCurr[2].includes('CENTER_LINE')) {

          list.push({

            id: `cline_${i}`,

            type: 'CENTER_LINE',

            name: ` CL${list.filter(e => e.type === 'CENTER_LINE').length + 1}`,

            pointIndices: [i, i + 1]

          });

          i += 1;

        } else if (pNext[2] === 'ARC_CONTROL') {

          const pEnd = sketchPoints[i + 2];

          if (pEnd) {

            list.push({

              id: `arc_${i}`,

              type: 'LINE',

              name: ` A${list.filter(e => e.type === 'LINE' && e.name.includes('')).length + 1}`,

              pointIndices: [i, i + 1, i + 2]

            });

            i += 2;

          } else {

            list.push({

              id: `line_${i}`,

              type: 'LINE',

              name: ` L${list.filter(e => e.type === 'LINE' && !e.name.includes('')).length + 1}`,

              pointIndices: [i, i + 1]

            });

            i += 1;

          }

        } else {

          list.push({

            id: `line_${i}`,

            type: 'LINE',

            name: ` L${list.filter(e => e.type === 'LINE' && !e.name.includes('')).length + 1}`,

            pointIndices: [i, i + 1]

          });

          i += 1;

        }

      } else {

        i += 1;

      }

    }

    

    return list;

  }, [sketchPoints]);



  // Listen to selectedTopology changes in Assembly/Mate Mode

  useEffect(() => {

    const clickedTopo = useCadStore.getState().selectedTopology;

    if (isSketchMode || activeTab !== 'ASSEMBLY' || !clickedTopo) return;



    const prevSelection = useCadStore.getState().mateSelection || [];

    if (prevSelection.some((p: any) => p.id === clickedTopo.id)) {

      useCadStore.getState().setSelectedTopology(null);

      return;

    }



    let nextSelection = [...prevSelection];

    if (nextSelection.length >= 2) nextSelection = [clickedTopo];

    else nextSelection.push(clickedTopo);



    setMateSelection(nextSelection);

    useCadStore.getState().setSelectedTopology(null);

  }, [activeTab, isSketchMode, setMateSelection]);



  // The new "Assembly-Aware" Rebuild Logic with History Rollback ()

  const handleInsertComponent = () => {

    const id = `comp_${Date.now()}`;

    const newComp = {

      id,

      partId: 'current',

      instanceName: `Component ${components.length + 1}`,

      transform: {

        position: [components.length * 50, 0, 0] as [number, number, number],

        rotation: [0, 0, 0] as [number, number, number]

      },

      visible: true

    };

    addComponent(newComp);

  };



  const handleOpen = async () => {

    const result = await fileAPI.open();

    if (result) {

      const readResult = await fileAPI.read(result.path);

      if (readResult.success && readResult.content) {

        loadCadData(readResult.content, result.path);

      }

    }

  };



  const handleSave = async () => {

    handleSaveSldprt();

  };



  const handleRebuild = useCallback(async () => {

    const { isSketchMode, editingFeatureId, rollbackIndex } = useCadStore.getState();

    

    // Determine the active features based on the history rollback state

    let activeFeatures = features;

    

    // Priority 1: Rollback Index (Manual Bar)

    if (rollbackIndex !== null) {

      activeFeatures = features.slice(0, rollbackIndex + 1);

    }

    

    // Priority 2: Auto-Rollback on Edit (SolidWorks behavior)

    if (isSketchMode && editingFeatureId) {

      const index = features.findIndex(f => f.id === editingFeatureId);

      if (index !== -1) {

        // Rollback history: Exclude the current feature being edited and all subsequent features

        activeFeatures = features.slice(0, index);

      }

    }



    if (activeFeatures.length === 0) {

      setMeshData([]);

      return;

    }



    setLoading(true);

    try {

      const client = HeavyEngineClient.getInstance();
  const rebuildController = useRef<AbortController | null>(null);



      // Check health first to update UI

      const isAlive = await client.checkHealth();

      setEngineStatus(isAlive ? 'CONNECTED' : 'DISCONNECTED');



      if (!isAlive) {

        console.warn('[API] Heavy Engine is not responding.');

        setLoading(false);

        return;

      }



      console.log('[API] Sending rolled-back feature list to Python Heavy Engine...', activeFeatures);

      const results = await client.rebuild(activeFeatures, 0.01, rebuildController.current?.signal);



      if (results && Array.isArray(results)) {

        setMeshData(results);

      }

    } catch (err) {

      console.error('[API] Rebuild request failed:', err);

      setEngineStatus('DISCONNECTED');

    } finally {

      setLoading(false);

    }

  }, [features, setMeshData]); // Removed unnecessary dependencies to use getState() internally



  useEffect(() => {

    const timer = setTimeout(() => {

      handleRebuild();

    }, 150); // Debounce rebuilds for smoother live preview

    return () => clearTimeout(timer);

  }, [handleRebuild]);



  const onParamChange = (key: string, value: string) => {

    if (!selectedId) return;



    // Industrial Parameter Handling: String-based parameters (Booleans, Planes, Types)

    const stringParams = ['operation', 'plane', 'type', 'target_feature_id', 'pattern_type', 'axis'];



    if (stringParams.includes(key)) {

      updateFeatureParams(selectedId, { [key]: value });

      // Trigger immediate rebuild for non-numeric params that change topology

      setTimeout(handleRebuild, 0);

      return;

    }



    const num = parseFloat(value);

    if (isNaN(num)) return;

    updateFeatureParams(selectedId, { [key]: num });

    // Numeric params are debounced by the handleRebuild useEffect

  };





  const addNewFeature = (type: 'EXTRUDE' | 'BOX' | 'CYLINDER' | 'SPHERE' | 'PATTERN', operation: 'ADD' | 'CUT' = 'ADD') => {

    const id = `feat_${Date.now()}`;

    const names = {

      EXTRUDE: operation === 'ADD' ? '-' : '-',

      BOX: '',

      CYLINDER: '',

      SPHERE: '',

      PATTERN: ''

    };

    const defaultParams = {

      EXTRUDE: { width: 10, height: 10, depth: 10, x: 0, y: 0, z: 0, operation: operation, plane: 'FRONT' },

      BOX: { width: 10, height: 10, depth: 10, x: 0, y: 0, z: 0 },

      CYLINDER: { radius: 5, height: 10, x: 0, y: 0, z: 0 },

      SPHERE: { radius: 5, x: 0, y: 0, z: 0 },

      PATTERN: {

        target_feature_id: features.find(f => f.type === 'EXTRUDE' || f.type === 'BOX' || f.type === 'CYLINDER' || f.type === 'SPHERE' || f.type === 'REVOLVE')?.id ?? '',

        pattern_type: 'CIRCULAR',

        axis: 'Y',

        count: 4,

        spacing: 90.0

      }

    };



    addFeature({

      id,

      type,

      name: `${names[type]} ${features.length + 1}`,

      parameters: defaultParams[type]

    });

    setSelectedId(id);

  };



  const loadCadData = useCallback(async (content: string, filePath: string) => {

    try {

      const data = JSON.parse(content);

      if (data.schema === "3D-BUILDER-PARAMETRIC-SCHEMA") {

        useCadStore.setState({

          features: data.features || [],

          sketchNodes: data.sketchNodes || {},

          sketchEdges: data.sketchEdges || {},

          sketchConstraints: data.sketchConstraints || {}

        });

        setTimeout(handleRebuild, 50);

        appAPI.notify('', `: ${filePath}`);

      } else if (data.features) {

        useCadStore.setState({ features: data.features });

        setTimeout(handleRebuild, 50);

        appAPI.notify('', `Part: ${filePath}`);

      } else {

        appAPI.notify('', '');

      }

    } catch (e) {

      // If it's a binary SolidWorks file (not JSON), show the Translator modal

      const pathLower = filePath.toLowerCase();

      if (pathLower.endsWith('.sldprt') || pathLower.endsWith('.sldasm')) {

        setShowTranslatorModal(true);

      } else {

        appAPI.notify('', ' STEP/IGES ');

      }

    }

  }, [handleRebuild]);



  const handleExportCad = async (format: 'STEP' | 'IGES' | 'STL') => {

    if (typeof window === 'undefined' || !window.electronAPI) {

      alert(' Electron ');

      return;

    }



    // We pass empty string just to open the save dialog and get the path

    const result = await window.electronAPI.file.save('');

    if (result && result.success && result.path) {

      setLoading(true);

      try {

        const success = await client.exportCadFile(features, format, result.path);

        if (success) {

          appAPI.notify('', ` ${format} : ${result.path}`);

        } else {

          alert(` ${format}  3D `);

        }

      } catch (err) {

        console.error(`[Export] ${format} failed:`, err);

        alert(`: ${err}`);

      } finally {

        setLoading(false);

      }

    }

  };



  const handleSaveSldprt = async () => {

    if (typeof window === 'undefined' || !window.electronAPI) {

      alert(' Electron ');

      return;

    }



    const state = useCadStore.getState();

    const payload = JSON.stringify({

      schema: "3D-BUILDER-PARAMETRIC-SCHEMA",

      version: "3.1.0",

      features: features,

      sketchNodes: state.sketchNodes,

      sketchEdges: state.sketchEdges,

      sketchConstraints: state.sketchConstraints

    }, null, 2);



    const result = await window.electronAPI.file.save(payload);

    if (result && result.success && result.path) {

      appAPI.notify('', `SolidWorks Part: ${result.path}`);

    }

  };



  const handleCalculateMassProperties = async () => {

    setLoading(true);

    try {

      const results = await client.calculateMassProperties(features);

      if (results) {

        setMassProps(results);

        setShowMassPropsModal(true);

      }

    } catch (err) {

      console.error('[API] Mass properties failed:', err);

      alert(' 3D ');

    } finally {

      setLoading(false);

    }

  };



  const resetSketchSession = useCallback(() => {

    setSketchNodes({});

    setSketchEdges({});

    setSketchConstraints({});

    setSketchPoints([]);

    setSketchRelations([]);

    setSketchMode(false);

    setActivePlane(null);

    setEditingFeatureId(null);

    setSmartDimensionActive(false);

    setSelectedEntityIds([]);

    setActiveFaceOrigin(null);

    setActiveFaceNormal(null);

    setActiveFaceId(null);

  }, [setSketchNodes, setSketchEdges, setSketchConstraints, setSketchPoints, setSketchRelations, setSketchMode, setActivePlane, setEditingFeatureId, setSelectedEntityIds, setActiveFaceOrigin, setActiveFaceNormal, setActiveFaceId]);

  const handleEditFeatureSketch = useCallback((f: CADFeature) => {
    setEditingFeatureId(f.id);
    setSketchNodes(f.parameters.sketchNodes || {});
    setSketchEdges(f.parameters.sketchEdges || {});
    setSketchConstraints(f.parameters.sketchConstraints || {});
    setSketchRelations(f.parameters.relations || []);
    setActivePlane(f.parameters.plane);
    if (f.parameters.plane === 'FACE') {
      setActiveFaceOrigin(f.parameters.faceOrigin);
      setActiveFaceNormal(f.parameters.faceNormal);
      setActiveFaceId(f.parameters.faceId);
    }
    setSketchMode(true);
    setSketchTool('SELECT');
    setActiveTab('SKETCH');
  }, [setEditingFeatureId, setSketchNodes, setSketchEdges, setSketchConstraints, setSketchRelations, setActivePlane, setActiveFaceOrigin, setActiveFaceNormal, setActiveFaceId, setSketchMode, setSketchTool, setActiveTab]);

  const handleExitAndExtrude = useCallback((operationOverride?: 'ADD' | 'CUT') => {
    // Connection Warning (Non-blocking attempt)
    if (engineStatus === 'DISCONNECTED') {
      console.warn('Attempting construction while kernel reports DISCONNECTED...');
    }

    const solidLoops = extractAllClosedLoops(sketchNodes, sketchEdges);
    
    // 2. Profile Validation Guard
    if (solidLoops.length === 0 || solidLoops[0].length < 3) {
      alert('Invalid Sketch Profile: No closed loop found.\nPlease ensure your sketch forms a single closed boundary without self-intersections.');
      return;
    }

    if (!activePlane) return;



    const existingFeature = editingFeatureId ? features.find(f => f.id === editingFeatureId) : null;

    const existingParams = existingFeature?.parameters ?? {};

    const nextParams = {

      ...existingParams,

      points: solidLoops,

      sketchNodes: { ...sketchNodes },

      sketchEdges: { ...sketchEdges },

      sketchConstraints: { ...sketchConstraints },

      depth: existingParams.depth ?? 10,

      x: existingParams.x ?? 0,

      y: existingParams.y ?? 0,

      z: existingParams.z ?? 0,

      operation: operationOverride ?? existingParams.operation ?? 'ADD',

      plane: activePlane,

      relations: [...sketchRelations],

      ...(activePlane === 'FACE' ? {

        faceOrigin: activeFaceOrigin,

        faceNormal: activeFaceNormal,

        faceId: activeFaceId

      } : {})

    };



    let featureId = editingFeatureId;

    if (featureId && existingFeature) {

      updateFeatureParams(featureId, nextParams);

    } else {

      featureId = `feat_${Date.now()}`;

      addFeature({

        id: featureId,

        type: 'EXTRUDE',

        name: `Custom Extrude ${features.length + 1}`,

        parameters: nextParams

      });

    }



    resetSketchSession();

    setRollbackIndex(null); // Clear rollback on exit

    setSelectedId(featureId);



    setTimeout(handleRebuild, 50);

  }, [sketchNodes, sketchEdges, activePlane, editingFeatureId, features, sketchRelations, updateFeatureParams, addFeature, resetSketchSession, setSelectedId, handleRebuild, activeFaceOrigin, activeFaceNormal, activeFaceId]);



  const applyHorizontalConstraint = useCallback(() => {

    if (sketchPoints.length < 2) return;

    const newPts = [...sketchPoints];

    for (let i = 0; i < newPts.length - 1; i++) {

      const dy = Math.abs(newPts[i][1] - newPts[i + 1][1]);

      if (dy > 0 && dy < 4.5) {

        newPts[i + 1][1] = newPts[i][1];

      }

    }

    if (newPts.length > 3) {

      const start = newPts[0];

      const end = newPts[newPts.length - 1];

      if (Math.hypot(start[0] - end[0], start[1] - end[1]) < 0.1) {

        const dy = Math.abs(start[1] - newPts[newPts.length - 2][1]);

        if (dy > 0 && dy < 4.5) {

          newPts[newPts.length - 2][1] = start[1];

        }

      }

    }

    setSketchPoints(newPts);

    const newRel = `水平 (Horizontal ${sketchRelations.filter(r => r.includes('')).length + 1})`;

    setSketchRelations([...sketchRelations, newRel]);

  }, [ sketchRelations, setSketchRelations]);



  const applyVerticalConstraint = useCallback(() => {

    if (sketchPoints.length < 2) return;

    const newPts = [...sketchPoints];

    for (let i = 0; i < newPts.length - 1; i++) {

      const dx = Math.abs(newPts[i][0] - newPts[i + 1][0]);

      if (dx > 0 && dx < 4.5) {

        newPts[i + 1][0] = newPts[i][0];

      }

    }

    if (newPts.length > 3) {

      const start = newPts[0];

      const end = newPts[newPts.length - 1];

      if (Math.hypot(start[0] - end[0], start[1] - end[1]) < 0.1) {

        const dx = Math.abs(start[0] - newPts[newPts.length - 2][0]);

        if (dx > 0 && dx < 4.5) {

          newPts[newPts.length - 2][0] = start[0];

        }

      }

    }

    setSketchPoints(newPts);

    const newRel = `Perpendicular (Vertical ${sketchRelations.filter(r => r.includes('Perpendicular')).length + 1})`;

    setSketchRelations([...sketchRelations, newRel]);

  }, [ sketchRelations, setSketchRelations]);



  const applyCoincidentToOrigin = useCallback(() => {

    if (sketchPoints.length === 0) return;

    const du = sketchPoints[0][0];

    const dv = sketchPoints[0][1];

    const newPts = sketchPoints.map(pt => [

      pt[0] - du,

      pt[1] - dv,

      pt[2]

    ]);

    setSketchPoints(newPts);

    const newRel = `Coincident (Coincident ${sketchRelations.filter(r => r.includes('Coincident')).length + 1})`;

    setSketchRelations([...sketchRelations, newRel]);

  }, [ sketchRelations, setSketchRelations]);



  const applyEqualSidesConstraint = useCallback(() => {

    if (sketchPoints.length < 4) return;

    const newPts = [...sketchPoints];

    const u1 = newPts[0][0];

    const v1 = newPts[0][1];

    const u2 = newPts[2][0];

    const v2 = newPts[2][1];



    const w = Math.abs(u2 - u1);

    const directionSign = v2 >= v1 ? 1 : -1;

    const newV2 = v1 + w * directionSign;



    newPts[1] = [u2, v1, newPts[1][2]];

    newPts[2] = [u2, newV2, newPts[2][2]];

    newPts[3] = [u1, newV2, newPts[3][2]];

    if (newPts[4]) {

      newPts[4] = [u1, v1, newPts[4][2]];

    }

    setSketchPoints(newPts);

    const newRel = ` (Equal ${sketchRelations.filter(r => r.includes('')).length + 1})`;

    setSketchRelations([...sketchRelations, newRel]);

  }, [ sketchRelations, setSketchRelations]);



  const applySmoothArcConstraint = useCallback(() => {

    const newPts = [...sketchPoints];

    for (let i = 0; i < newPts.length - 2; i++) {

      if (newPts[i + 1] && newPts[i + 1][2] === 'ARC_CONTROL') {

        const p_start = newPts[i];

        const p_end = newPts[i + 2];

        const mid_u = (p_start[0] + p_end[0]) / 2;

        const mid_v = (p_start[1] + p_end[1]) / 2;

        const du = p_end[0] - p_start[0];

        const dv = p_end[1] - p_start[1];

        const length = Math.hypot(du, dv);

        if (length > 0.1) {

          const perp_u = -dv / length;

          const perp_v = du / length;

          newPts[i + 1] = [

            mid_u + perp_u * (length * 0.25),

            mid_v + perp_v * (length * 0.25),

            'ARC_CONTROL'

          ];

        }

      }

    }

    setSketchPoints(newPts);

    const newRel = `Tangent (Tangent ${sketchRelations.filter(r => r.includes('Tangent')).length + 1})`;

    setSketchRelations([...sketchRelations, newRel]);

  }, [ sketchRelations, setSketchRelations]);



  const applyFixConstraint = useCallback(() => {

    const newPts = sketchPoints.map(pt => [

      Math.round(pt[0]),

      Math.round(pt[1]),

      pt[2]

    ]);

    setSketchPoints(newPts);

    const newRel = ` (Fixed ${sketchRelations.filter(r => r.includes('')).length + 1})`;

    setSketchRelations([...sketchRelations, newRel]);

  }, [ sketchRelations, setSketchRelations]);



  const handleScaleSegment = useCallback((index: number, newLen: number) => {

    if (sketchPoints.length < 2) return;

    const newPts = [...sketchPoints];

    const i = index;

    const nextIdx = (i + 1) % newPts.length;



    const p1 = newPts[i];

    const p2 = newPts[nextIdx];



    const du = p2[0] - p1[0];

    const dv = p2[1] - p1[1];

    const currentLen = Math.hypot(du, dv);



    if (currentLen > 0.1) {

      const scale = newLen / currentLen;

      const newU = p1[0] + du * scale;

      const newV = p1[1] + dv * scale;



      const deltaU = newU - p2[0];

      const deltaV = newV - p2[1];



      // Shift all subsequent points so the loop shape maintains relative dimensions!

      for (let j = nextIdx; j < newPts.length; j++) {

        newPts[j] = [newPts[j][0] + deltaU, newPts[j][1] + deltaV, newPts[j][2]];

      }



      // If closed loop, make sure the last point matches the first point coordinate if they were coincident

      if (newPts.length > 3) {

        const start = newPts[0];

        const end = newPts[newPts.length - 1];

        if (Math.hypot(start[0] - end[0], start[1] - end[1]) < 1.0) {

          newPts[newPts.length - 1] = [start[0], start[1], end[2]];

        }

      }

      setSketchPoints(newPts);



      const newRel = `尺寸定量 (Dim ${sketchRelations.filter(r => r.includes('')).length + 1})`;

      setSketchRelations([...sketchRelations, newRel]);

    }

  }, [ sketchRelations, setSketchRelations]);



  const applyParallelRelation = useCallback((entA: SketchEntity, entB: SketchEntity) => {

    const newPts = [...sketchPoints];

    const ptsA = entA.pointIndices.map(idx => newPts[idx]);

    const ptsB = entB.pointIndices.map(idx => newPts[idx]);

    if (ptsA.length < 2 || ptsB.length < 2) return;

    const angleA = Math.atan2(ptsA[1][1] - ptsA[0][1], ptsA[1][0] - ptsA[0][0]);

    const midB_u = (ptsB[0][0] + ptsB[1][0]) / 2;

    const midB_v = (ptsB[0][1] + ptsB[1][1]) / 2;

    const lenB = Math.hypot(ptsB[1][0] - ptsB[0][0], ptsB[1][1] - ptsB[0][1]);

    const dx = Math.cos(angleA) * (lenB / 2);

    const dy = Math.sin(angleA) * (lenB / 2);

    newPts[entB.pointIndices[0]] = [midB_u - dx, midB_v - dy, newPts[entB.pointIndices[0]][2]];

    newPts[entB.pointIndices[1]] = [midB_u + dx, midB_v + dy, newPts[entB.pointIndices[1]][2]];

    setSketchPoints(newPts);

    const newRel = `Parallel (Parallel: ${entA.name} ∥ ${entB.name})`;

    setSketchRelations([...sketchRelations, newRel]);

    setSelectedEntityIds([]);

  }, [ setSelectedEntityIds]);



  const applyConcentricRelation = useCallback((entA: SketchEntity, entB: SketchEntity) => {

    if (!entA.center || !entB.center) return;

    const newPts = [...sketchPoints];

    const deltaU = entA.center[0] - entB.center[0];

    const deltaV = entA.center[1] - entB.center[1];

    entB.pointIndices.forEach(idx => {

      newPts[idx] = [newPts[idx][0] + deltaU, newPts[idx][1] + deltaV, newPts[idx][2]];

    });

    setSketchPoints(newPts);

    const newRel = `Concentric (Concentric: ${entA.name}  ${entB.name})`;

    setSketchRelations([...sketchRelations, newRel]);

    setSelectedEntityIds([]);

  }, [ setSelectedEntityIds]);



  const applyTangentRelation = useCallback((lineEnt: SketchEntity, circleEnt: SketchEntity) => {

    if (!circleEnt.center || circleEnt.radius === undefined) return;

    const newPts = [...sketchPoints];

    const p1 = newPts[lineEnt.pointIndices[0]];

    const p2 = newPts[lineEnt.pointIndices[1]];

    const cU = circleEnt.center[0];

    const cV = circleEnt.center[1];

    const R = circleEnt.radius;

    const du = p2[0] - p1[0];

    const dv = p2[1] - p1[1];

    const len = Math.hypot(du, dv);

    if (len < 0.1) return;

    const nu = -dv / len;

    const nv = du / len;

    const dist = nu * (cU - p1[0]) + nv * (cV - p1[1]);

    const shift = R - Math.abs(dist);

    const direction = dist >= 0 ? 1 : -1;

    const shiftU = -nu * shift * direction;

    const shiftV = -nv * shift * direction;

    newPts[lineEnt.pointIndices[0]] = [p1[0] + shiftU, p1[1] + shiftV, p1[2]];

    newPts[lineEnt.pointIndices[1]] = [p2[0] + shiftU, p2[1] + shiftV, p2[2]];

    setSketchPoints(newPts);

    const newRel = `Tangent (Tangent: ${lineEnt.name}  ${circleEnt.name})`;

    setSketchRelations([...sketchRelations, newRel]);

    setSelectedEntityIds([]);

  }, [ setSelectedEntityIds]);



  const applyMirrorSketch = useCallback(() => {

    const selectedEntities = entities.filter(ent => selectedEntityIds.includes(ent.id));

    const centerline = selectedEntities.find(ent => ent.type === 'CENTER_LINE');

    if (!centerline) return;



    const targets = selectedEntities.filter(ent => ent.id !== centerline.id);

    if (targets.length === 0) return;



    const cp1 = sketchPoints[centerline.pointIndices[0]];

    const cp2 = sketchPoints[centerline.pointIndices[1]];

    if (!cp1 || !cp2) return;



    const a = cp2[1] - cp1[1];

    const b = -(cp2[0] - cp1[0]);

    const c = cp2[0] * cp1[1] - cp2[1] * cp1[0];

    const denom = a * a + b * b;

    if (denom < 1e-6) return;



    const newPts = [...sketchPoints];



    targets.forEach(target => {

      target.pointIndices.forEach((ptIdx, loopIdx) => {

        const pt = sketchPoints[ptIdx];

        const u = pt[0];

        const v = pt[1];

        const d = (a * u + b * v + c) / denom;

        const mirU = u - 2 * a * d;

        const mirV = v - 2 * b * d;



        // Extract original tag without any starting 'START' to avoid duplicate starts,

        // and then append 'START' for the first point of the mirrored entity.

        let origTag = pt[2] || '';

        origTag = origTag.split(',').filter((t: string) => t !== 'START').join(',');

        

        let tag = origTag;

        if (loopIdx === 0) {

          tag = tag ? 'START,' + tag : 'START';

        }



        newPts.push([mirU, mirV, tag]);

      });

    });



    setSketchPoints(newPts);

    const newRel = ` (Mirror: ${targets.map(t => t.name).join(', ')}   ${centerline.name})`;

    setSketchRelations([...sketchRelations, newRel]);

    setSelectedEntityIds([]);

  }, [entities, selectedEntityIds, setSelectedEntityIds]);



  const handlePrintToPDF = useCallback(async () => {

    try {

      const result = await fileAPI.printToPdf();

      if (result.success && result.path) {

        appAPI.notify('PDF  ', `:
${result.path}`);

      } else if (result.error && result.error !== 'Cancelled') {

        alert(`PDF : ${result.error}`);

      }

    } catch (e) {

      console.error(e);

      alert('PDF ');

    }

  }, []);



  return (

    <main className="flex flex-col h-screen w-screen overflow-hidden bg-background text-primary-text font-sans">

      {/* 1. SolidWorks Desktop Titlebar */}

      <header className="h-[32px] w-full bg-[#F5F5F5] border-b border-[#A0A0A0] flex items-center justify-between px-3 select-none z-50 shrink-0" style={{ background: "linear-gradient(to bottom, #FFFFFF 0%, #E8E8E8 100%)" }}>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-[14px] font-black tracking-tighter text-[#000000]">
            <div className="w-6 h-6 bg-[#005B9A] rounded-sm flex items-center justify-center text-white text-[11px] shadow-sm font-sans">3D</div>
            3D-Builder Pro
          </div>
          <nav className="flex items-center gap-4 text-[12px] text-[#404040] font-semibold">
            {["File", "Edit", "View", "Insert", "Tools", "Help"].map(m => (
              <span key={m} className="hover:text-[#005B9A] cursor-pointer transition-colors px-1 uppercase tracking-wider">{m}</span>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-[11px] text-[#404040] font-medium bg-[#FFFFFF] px-4 py-1 rounded-sm border border-[#A0A0A0] shadow-inner">
            Part 1.SLDPRT * <span className="text-[#005B9A] font-bold">[{activePlane || "No Active Plane"}]</span>
          </div>
          <div className="flex items-center gap-3 text-[12px]">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${engineStatus === "CONNECTED" ? "bg-[#28a745]" : "bg-[#dc3545]"} shadow-sm`} />
              <span className="text-[#404040] font-bold uppercase tracking-widest text-[10px]">Kernel: <span className={engineStatus === "CONNECTED" ? "text-[#28a745]" : "text-[#dc3545]"}>{engineStatus}</span></span>
            </div>
          </div>
        </div>
      </header>



      
      {/* 2. SolidWorks CommandManager (Ribbon Bar) */}
      <div className="h-[110px] w-full bg-[#E8E8E8] border-b border-[#A0A0A0] flex flex-col z-20 shrink-0 select-none">
        {/* Ribbon Tabs */}
        <div className="flex px-2 border-b border-[#A0A0A0] bg-[#D6DADC]">
          <button
            onClick={() => { setActiveTab('FEATURES'); setMeasurementMode('NONE'); setMeasurementPoints([]); setMeasurementResults(null); } }
            className={`px-6 py-1.5 text-[11px] font-black transition-all border-b-[3px] uppercase ${activeTab === "FEATURES" ? "border-[#005B9A] text-[#005B9A] bg-white shadow-sm" : "border-transparent text-slate-600 hover:bg-white/50"}` }
          >FEATURES</button>
          <button
            onClick={() => {
              setActiveTab('SKETCH'); 
              setMeasurementMode('NONE'); 
              setMeasurementPoints([]); 
              setMeasurementResults(null);
              
              if (!isSketchMode) { 
                setEditingFeatureId(null); 
                setSketchPoints([]); 
                setSketchRelations([]);      
                
                // Smart Plane Selection:
                // 1. Priority: Currently selected topology face
                if (selectedTopology?.type === 'FACE' && selectedTopology.coordinates && selectedTopology.normal) {
                  setActiveFaceOrigin(selectedTopology.coordinates); 
                  setActiveFaceNormal(selectedTopology.normal);
                  setActiveFaceId(selectedTopology.id || `face_${Date.now()}`); 
                  setActivePlane('FACE'); 
                  triggerCameraNormal();
                } 
                // 2. Secondary: A plane already selected via FeatureTree or Viewport (activePlane might be set)
                else if (activePlane) {
                  triggerCameraNormal();
                }
                // 3. Fallback: Default to FRONT
                else {
                  setActivePlane('FRONT');
                  triggerCameraNormal();
                }
                
                setSketchMode(true); 
                setSketchTool('SELECT');
              }
            } }
            className={`px-6 py-1.5 text-[11px] font-black transition-all border-b-[3px] uppercase ${activeTab === "SKETCH" ? "border-[#005B9A] text-[#005B9A] bg-white shadow-sm" : "border-transparent text-slate-600 hover:bg-white/50"}` }
          >SKETCH</button>
          <button
            onClick={() => { setActiveTab('EVALUATE'); setMeasurementMode('NONE'); } }
            className={`px-6 py-1.5 text-[11px] font-black transition-all border-b-[3px] uppercase ${activeTab === "EVALUATE" ? "border-[#005B9A] text-[#005B9A] bg-white shadow-sm" : "border-transparent text-slate-600 hover:bg-white/50"}` }
          >EVALUATE</button>
        </div>

        {/* Ribbon Content Panels */}
        <div className="flex-1 flex items-center px-6 py-2 gap-2 overflow-x-auto overflow-y-hidden bg-surface"> 
          {activeTab === 'FEATURES' ? (
            <div className="flex items-center gap-2 h-full animate-in fade-in slide-in-from-left-2 duration-300">
              <button onClick={() => { if (solidSketchPointCount >= 3) handleExitAndExtrude(); else { setSketchMode(true); setSketchTool('SELECT'); } }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Extruded Boss/Base">
                <div className="w-10 h-10 flex items-center justify-center text-[#005B9A] transition-transform group-hover:scale-110">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                </div>
                <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Extrude</span>
              </button>
              <button onClick={() => { if (solidSketchPointCount >= 3) handleExitAndExtrude('CUT'); else { setSketchMode(true); setSketchTool('SELECT'); } }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Extruded Cut">
                <div className="w-10 h-10 flex items-center justify-center text-red-600 transition-transform group-hover:scale-110">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M12 22V12"/><path d="M3 8l9 4 9-4"/></svg>
                </div>
                <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Cut</span>
              </button>
            </div>
          ) : activeTab === 'SKETCH' ? (
            <div className="flex items-center gap-2 h-full animate-in fade-in slide-in-from-left-2 duration-300">
              <button onClick={resetSketchSession} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Exit Sketch">
                <div className="w-10 h-10 flex items-center justify-center text-emerald-600 transition-transform group-hover:scale-110">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                </div>
                <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Exit</span>
              </button>
              <div className="w-[1px] h-10 bg-border/50 mx-2" />
              <button onClick={() => setSmartDimensionActive(!smartDimensionActive)} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${smartDimensionActive ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`} title="Smart Dimension">
                <div className={`w-10 h-10 flex items-center justify-center transition-transform ${smartDimensionActive ? 'text-[#005B9A] scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m18 8 3 3-3 3"/><path d="m6 8-3 3 3 3"/><path d="M2 11h20"/><path d="M2 4v14"/><path d="M22 4v14"/></svg>
                </div>
                <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Smart Dim</span>
              </button>
            </div>
          ) : activeTab === 'EVALUATE' ? (
            <div className="flex items-center gap-2 h-full animate-in fade-in slide-in-from-left-2 duration-300">
              <button onClick={() => setMeasurementMode(measurementMode === 'NONE' ? 'DISTANCE' : 'NONE')} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${measurementMode !== 'NONE' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`} title="Measure">
                <div className={`w-10 h-10 flex items-center justify-center transition-transform ${measurementMode !== 'NONE' ? 'text-indigo-600 scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.3 15.3l-5-5L19 7.7l-2-2L14.7 8l-5-5-1.4 1.4 1 1-1.5 1.5-1-1L5.4 7.3l1 1-1.5 1.5-1-1-1.4 1.4 5 5-2.3 2.3 2 2 2.3-2.3 5 5 1.4-1.4-1-1 1.5-1.5 1 1 1.4-1.4-1-1 1.5-1.5 1 1z"/></svg>
                </div>
                <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Measure</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Kernel Offline Warning Banner */}
      {engineStatus === 'DISCONNECTED' && (
        <div className="bg-red-600 text-white text-[11px] font-black py-1 px-4 flex items-center justify-center gap-4 animate-pulse z-[100]">
          <span>⚠️ GEOMETRY KERNEL OFFLINE</span>
          <button 
            onClick={async () => {
              const client = HeavyEngineClient.getInstance();
              const alive = await client.checkHealth();
              setEngineStatus(alive ? 'CONNECTED' : 'DISCONNECTED');
            }}
            className="px-2 py-0.5 bg-white text-red-600 rounded text-[9px] font-black hover:bg-slate-100"
          >RETRY CONNECTION</button>
        </div>
      )}


      {/* 3. Main Workspace Area */}

      <div className="flex-1 flex w-full overflow-hidden relative">

        {/* Left Sidebars: FeatureManager & PropertyManager */}

        <aside className="w-[290px] h-full bg-surface border-r border-border flex flex-col z-10 shrink-0">

          {/* SolidWorks Tab Header */}

          <div className="h-[28px] w-full bg-surface flex items-center justify-around border-b border-border/60 text-secondary-text text-[14px]"> <span className="text-primary font-bold cursor-pointer" title="FeatureManager 設計樹">Feature Tree</span> <span className="hover:text-primary-text cursor-pointer" title="PropertyManager 屬性經理">Properties</span> <span className="hover:text-primary-text cursor-pointer" title="ConfigurationManager 設定經理">Configurations</span> </div> <div className="flex-grow flex flex-col overflow-hidden">

            {isSketchMode ? (

              /* Active Sketch Editor Panel */

              <div className="flex-grow overflow-y-auto p-3 bg-primary/5 border-l-4 border-primary"> <div className="text-[14px] uppercase tracking-wider text-primary mb-3 font-bold flex justify-between items-center"> <span>Active Sketch Editor</span> <button

                    onClick={resetSketchSession}

                    className="text-error hover:underline text-[13px]"

                  > </button> </div> <div className="space-y-3"> <SketchPropertyManager /> </div> </div>

            ) : activeTab === 'ASSEMBLY' ? (

              <MatePanel />

            ) : measurementMode !== 'NONE' ? (

              <MeasurementPanel />

            ) : (

              /* FeatureManager Design Tree */

              <div className="flex-1 overflow-y-auto p-3 flex flex-col"> <div className="text-[11px] uppercase tracking-[0.2em] text-secondary-text mb-4 font-black flex justify-between items-center border-b border-border pb-2"> <span>Feature Tree</span> <button onClick={handleRebuild} className="text-primary hover:text-primary-dark transition-all" title="Rebuild Model"> 🔄 </button> </div>



                {/* Standard SolidWorks Meta Nodes */}

                <div className="space-y-1.5 text-[14px] select-none"> <div className="flex items-center gap-2 p-1 text-primary-text font-bold"> <span> </span> <span>📦</span> <span>Part1</span> </div> <div className="pl-4 space-y-1 text-secondary-text"> <div className="flex items-center gap-2 p-0.5 hover:text-primary-text cursor-pointer"> <span> </span> <span>📡</span> <span>Sensors</span> </div> <div className="flex items-center gap-2 p-0.5 hover:text-primary-text cursor-pointer"> <span> </span> <span>📝</span> <span>Annotations</span> </div> <div className="flex items-center gap-2 p-0.5 hover:text-primary-text cursor-pointer border-b border-border/40 pb-1.5"> <span> </span> <span>🧊</span> <span>Material</span> </div>



                    {/* Standard Plane Selection (Double click triggers sketch) */}

                    {(() => {

                      const frontRel = getTreeRelation('FRONT', hoveredTreeId);

                      const topRel = getTreeRelation('TOP', hoveredTreeId);

                      const rightRel = getTreeRelation('RIGHT', hoveredTreeId);

                      const originRel = getTreeRelation('ORIGIN', hoveredTreeId);



                      return (

                        <> <div

                            onClick={(e) => { 

                              setActivePlane('FRONT'); 

                              setSelectedId(null); 

                              setContextMenu({ 

                                visible: true, 

                                x: e.clientX, 

                                y: e.clientY,

                                type: 'BACKGROUND',

                                data: { plane: 'FRONT' }

                              });

                            }}

                            onDoubleClick={() => { setEditingFeatureId(null); setSketchPoints([]); setSketchRelations([]); setActivePlane('FRONT'); setSketchMode(true); setSketchTool('SELECT'); setContextMenu(null); }}

                            onMouseEnter={() => setHoveredTreeId('FRONT')}

                            onMouseLeave={() => setHoveredTreeId(null)}

                            className={`flex items-center justify-between p-1 rounded cursor-pointer transition-all border ${

                              activePlane === 'FRONT' 

                                ? 'bg-primary/10 border-primary/30 text-primary font-bold' 

                                : frontRel === 'PARENT'

                                ? 'bg-blue-50 border-blue-200 text-blue-900 font-medium'

                                : frontRel === 'CHILD'

                                ? 'bg-purple-50 border-purple-200 text-purple-900 font-medium'

                                : 'hover:bg-slate-100 border-transparent hover:text-primary-text'

                            }`}

                            title="Sketch Mode"

                          >

                            <div className="flex items-center gap-2"> <span> </span> <span>📄</span> <span>Reference Plane</span> </div> <div className="flex items-center gap-1 shrink-0 text-[12px] font-bold">

                              {frontRel === 'PARENT' && <span className="bg-blue-100 text-blue-600 px-1 py-0.2 rounded"> (Parent)</span>}

                              {frontRel === 'CHILD' && <span className="bg-purple-100 text-purple-600 px-1 py-0.2 rounded"> (Child)</span>}

                              {activePlane === 'FRONT' && <span className="bg-primary/10 text-primary px-1 rounded uppercase"> </span>}

                            </div> </div> <div

                            onClick={(e) => { 

                              setActivePlane('TOP'); 

                              setSelectedId(null); 

                              setContextMenu({ 

                                visible: true, 

                                x: e.clientX, 

                                y: e.clientY,

                                type: 'BACKGROUND',

                                data: { plane: 'TOP' }

                              });

                            }}

                            onDoubleClick={() => { setEditingFeatureId(null); setSketchPoints([]); setSketchRelations([]); setActivePlane('TOP'); setSketchMode(true); setSketchTool('SELECT'); setContextMenu(null); }}

                            onMouseEnter={() => setHoveredTreeId('TOP')}

                            onMouseLeave={() => setHoveredTreeId(null)}

                            className={`flex items-center justify-between p-1 rounded cursor-pointer transition-all border ${

                              activePlane === 'TOP' 

                                ? 'bg-primary/10 border-primary/30 text-primary font-bold' 

                                : topRel === 'PARENT'

                                ? 'bg-blue-50 border-blue-200 text-blue-900 font-medium'

                                : topRel === 'CHILD'

                                ? 'bg-purple-50 border-purple-200 text-purple-900 font-medium'

                                : 'hover:bg-slate-100 border-transparent hover:text-primary-text'

                            }`}

                            title="Sketch Mode"

                          >

                            <div className="flex items-center gap-2"> <span> </span> <span>📄</span> <span>Reference Plane</span> </div> <div className="flex items-center gap-1 shrink-0 text-[12px] font-bold">

                              {topRel === 'PARENT' && <span className="bg-blue-100 text-blue-600 px-1 py-0.2 rounded"> (Parent)</span>}

                              {topRel === 'CHILD' && <span className="bg-purple-100 text-purple-600 px-1 py-0.2 rounded"> (Child)</span>}

                              {activePlane === 'TOP' && <span className="bg-primary/10 text-primary px-1 rounded uppercase"> </span>}

                            </div> </div> <div

                            onClick={(e) => { 

                              setActivePlane('RIGHT'); 

                              setSelectedId(null); 

                              setContextMenu({ 

                                visible: true, 

                                x: e.clientX, 

                                y: e.clientY,

                                type: 'BACKGROUND',

                                data: { plane: 'RIGHT' }

                              });

                            }}

                            onDoubleClick={() => { setEditingFeatureId(null); setSketchPoints([]); setSketchRelations([]); setActivePlane('RIGHT'); setSketchMode(true); setSketchTool('SELECT'); setContextMenu(null); }}

                            onMouseEnter={() => setHoveredTreeId('RIGHT')}

                            onMouseLeave={() => setHoveredTreeId(null)}

                            className={`flex items-center justify-between p-1 rounded cursor-pointer transition-all border ${

                              activePlane === 'RIGHT' 

                                ? 'bg-primary/10 border-primary/30 text-primary font-bold' 

                                : rightRel === 'PARENT'

                                ? 'bg-blue-50 border-blue-200 text-blue-900 font-medium'

                                : rightRel === 'CHILD'

                                ? 'bg-purple-50 border-purple-200 text-purple-900 font-medium'

                                : 'hover:bg-slate-100 border-transparent hover:text-primary-text'

                            }`}

                            title="Sketch Mode"

                          >

                            <div className="flex items-center gap-2"> <span> </span> <span>📄</span> <span>Reference Plane</span> </div> <div className="flex items-center gap-1 shrink-0 text-[12px] font-bold">

                              {rightRel === 'PARENT' && <span className="bg-blue-100 text-blue-600 px-1 py-0.2 rounded"> (Parent)</span>}

                              {rightRel === 'CHILD' && <span className="bg-purple-100 text-purple-600 px-1 py-0.2 rounded"> (Child)</span>}

                              {activePlane === 'RIGHT' && <span className="bg-primary/10 text-primary px-1 rounded uppercase"> </span>}

                            </div> </div> <div 

                            onMouseEnter={() => setHoveredTreeId('ORIGIN')}

                            onMouseLeave={() => setHoveredTreeId(null)}

                            className={`flex items-center justify-between p-1 rounded cursor-pointer transition-all border border-transparent ${

                              originRel === 'PARENT'

                                ? 'bg-blue-50 border-blue-200 text-blue-900 font-medium'

                                : originRel === 'CHILD'

                                ? 'bg-purple-50 border-purple-200 text-purple-900 font-medium'

                                : 'hover:bg-slate-100 hover:text-primary-text'

                            }`}

                          >

                            <div className="flex items-center gap-2 p-0.5"> <span> </span> <span>📍</span> <span>Origin</span> </div> <div className="flex items-center gap-1 shrink-0 text-[12px] font-bold mr-1">

                              {originRel === 'PARENT' && <span className="bg-blue-100 text-blue-600 px-1 py-0.2 rounded"> (Parent)</span>}

                              {originRel === 'CHILD' && <span className="bg-purple-100 text-purple-600 px-1 py-0.2 rounded"> (Child)</span>}

                            </div> </div> </>

                      );

                    })()}

                  </div>



                  {/* Chronological History Tree */}

                  <div className="pl-2 pt-2 space-y-1 relative"> <div className="text-[13px] uppercase tracking-wider text-secondary-text font-bold mb-1"> </div>

                    

                    {/* Top-level Rollback Target (Rollback to start) */}

                    <div 

                      className={`h-1 w-full rounded-full transition-all cursor-row-resize ${rollbackIndex === -1 ? 'bg-blue-600 h-1.5 shadow-md' : 'bg-transparent hover:bg-blue-200'}`}

                      onClick={() => setRollbackIndex(rollbackIndex === -1 ? null : -1)}

                      title=""

                    />



                    {features.map((f, fIdx) => {

                      const relState = getTreeRelation(f.id, hoveredTreeId);

                      const isExtrudeOrRevolve = f.type === 'EXTRUDE' || f.type === 'REVOLVE';

                      const isRolledBack = rollbackIndex !== null && fIdx > rollbackIndex;

                      let sketchNum = 1;

                      if (f.id === 'feat_base_plate') sketchNum = 1;

                      else if (f.id === 'feat_center_hole') sketchNum = 2;

                      else {

                        const extrudeFeats = features.filter(x => x.type === 'EXTRUDE' || x.type === 'REVOLVE');

                        const idx = extrudeFeats.findIndex(x => x.id === f.id);

                        sketchNum = idx >= 0 ? idx + 1 : fIdx + 1;

                      }



                      return (

                        <Fragment key={f.id}> <div 

                            className={`flex flex-col border border-transparent rounded transition-all ${isRolledBack ? 'opacity-40 grayscale-[0.5]' : ''}`}

                            onMouseEnter={() => setHoveredTreeId(f.id)}

                            onMouseLeave={() => setHoveredTreeId(null)}

                          >

                            {/* Feature Row */}

                            <div

                              onClick={() => { setSelectedId(f.id); setSelectedSubNodeType('FEATURE'); }}

                              onDoubleClick={() => handleEditFeatureSketch(f)}

                              className={`group flex items-center justify-between p-1.5 rounded cursor-pointer transition-all border ${

                                editingFeatureId === f.id

                                  ? 'bg-emerald-50 border-emerald-300 text-slate-900 font-bold'

                                  : selectedId === f.id && selectedSubNodeType === 'FEATURE'

                                  ? 'bg-primary/10 border-primary/30 text-primary-text font-bold'

                                  : relState === 'PARENT'

                                  ? 'bg-blue-50/70 border-blue-200 text-blue-900 font-medium'

                                  : relState === 'CHILD'

                                  ? 'bg-purple-50/70 border-purple-200 text-purple-900 font-medium'

                                  : 'hover:bg-slate-100 border-transparent text-slate-700'

                              }`}

                            >

                              <div className="flex items-center gap-2"> <span className="text-sm">

                                  {f.type === 'REVOLVE' ? '🔄' : f.type === 'EXTRUDE' ? (f.parameters.operation === 'CUT' ? '🔨' : '🏗️') : f.type === 'BOX' ? '📦' : f.type === 'CYLINDER' ? '🛢️' : '🛠️'}

                                </span> <div className="flex flex-col"> <span className="text-[14px] leading-tight">{f.name}</span> <span className="text-[13px] text-secondary-text font-mono leading-none uppercase">{f.type === 'EXTRUDE' ? f.parameters.operation : f.type}</span>

                                  {editingFeatureId === f.id && (

                                    <span className="mt-0.5 text-[12px] text-emerald-700 font-bold uppercase leading-none">Editing sketch</span>

                                  )}

                                </div> </div> <div className="flex items-center gap-1 shrink-0 text-[12px] font-bold">

                                {relState === 'PARENT' && <span className="bg-blue-100 text-blue-600 px-1 py-0.2 rounded"> (Parent)</span>}

                                {relState === 'CHILD' && <span className="bg-purple-100 text-purple-600 px-1.5 py-0.2 rounded"> (Child)</span>}

                                <button

                                  onClick={(e) => {

                                    e.stopPropagation();

                                    removeFeature(f.id);

                                    setSelectedId(null);

                                    setTimeout(handleRebuild, 50);

                                  }}

                                  onDoubleClick={(e) => e.stopPropagation()}

                                  className="opacity-30 group-hover:opacity-100 p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500 transition-all border border-transparent hover:border-red-200"

                                  title="Delete Feature"

                                >
                                  🗑️
                                

                                  

                                </button> </div> </div>



                            {/* Nested Sketch Child Node */}

                            {isExtrudeOrRevolve && (

                              <div

                                onClick={() => { setSelectedId(f.id); setSelectedSubNodeType('SKETCH'); }}

                                onDoubleClick={() => handleEditFeatureSketch(f)}

                                className={`pl-7 pr-2 py-1 flex items-center justify-between gap-1.5 cursor-pointer text-[14px] select-none rounded transition-all border border-transparent ${

                                  selectedId === f.id && selectedSubNodeType === 'SKETCH'

                                    ? 'bg-pink-100/90 border border-pink-300 text-pink-700 font-bold shadow-xs'

                                    : 'text-secondary-text hover:text-primary hover:bg-slate-100/50'

                                }`}

                                title="Double-click to edit"

                              >

                                <div className="flex items-center gap-1.5 overflow-hidden"> <span> </span> <span>✏️</span> <span>✏️</span> <span className="italic hover:underline truncate">Sketch {sketchNum}</span> </div> <div className="flex items-center gap-1.5 shrink-0">

                                  {editingFeatureId === f.id && (

                                    <span className="text-[12px] bg-emerald-100 text-emerald-700 px-1.5 py-0.2 rounded font-bold font-mono animate-pulse"> </span>

                                  )}

                                  <button

                                    onClick={(e) => {

                                      e.stopPropagation();

                                      toggleSketchVisibility(f.id);

                                    }}

                                    className={`p-0.5 rounded transition-all hover:bg-slate-200 ${

                                      visibleSketches.includes(f.id) ? 'text-primary' : 'text-slate-300'

                                    }`}

                                    title={visibleSketches.includes(f.id) ? "" : ""}

                                  >

                                    {visibleSketches.includes(f.id) ? '' : ''}

                                  </button> </div> </div>

                            )}

                          </div>

                          

                          {/* Rollback Line after each feature */}

                          <div 

                            className={`h-1 w-full rounded-full transition-all cursor-row-resize ${rollbackIndex === fIdx ? 'bg-blue-600 h-1.5 shadow-md' : 'bg-transparent hover:bg-blue-200'}`}

                            onClick={() => setRollbackIndex(rollbackIndex === fIdx ? null : fIdx)}

                            title=""

                          />

                        </Fragment>

                      );

                    })}

                  </div> </div> </div>

            )}

          </div>



          {/*  (Face Selection) */}

          {!isSketchMode && selectedTopology?.type === 'FACE' && measurementMode === 'NONE' && (

            <div className="h-[250px] w-full border-t border-border bg-surface flex flex-col p-3 z-10 shrink-0 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]"> <div className="text-[14px] uppercase tracking-wider text-secondary-text mb-2 font-bold flex justify-between items-center border-b border-border/40 pb-1"> <span className="flex items-center gap-1"> </span> <span className="text-[13px] bg-indigo-600/10 text-indigo-600 px-1.5 rounded uppercase font-mono">Face Selected</span> </div> <div className="flex-1 overflow-y-auto space-y-2.5 pr-1"> <div className="bg-surface p-2.5 rounded border border-border shadow-sm space-y-2 text-[14px]"> <div className="flex justify-between items-center"> <span className="text-secondary-text font-medium"> (Center)</span> <span className="font-mono text-primary-text text-[13px]">

                      {selectedTopology.coordinates ? `[${selectedTopology.coordinates.map((c: number) => c.toFixed(1)).join(', ')}]` : 'N/A'}

                    </span> </div> <div className="flex justify-between items-center"> <span className="text-secondary-text font-medium"> (Normal)</span> <span className="font-mono text-primary-text text-[13px]">

                      {selectedTopology.normal ? `[${selectedTopology.normal.map((n: number) => n.toFixed(2)).join(', ')}]` : 'N/A'}

                    </span> </div>

                  {selectedTopology.id && (

                    <div className="flex justify-between items-center"> <span className="text-secondary-text font-medium"> ID</span> <span className="font-mono text-primary-text text-xs bg-slate-100 px-1 rounded truncate max-w-[120px]" title={selectedTopology.id}>

                        {selectedTopology.id}

                      </span> </div>

                  )}

                </div> <button

                  onClick={() => {

                    if (!selectedTopology.coordinates || !selectedTopology.normal) return;

                    setActiveFaceOrigin(selectedTopology.coordinates);

                    setActiveFaceNormal(selectedTopology.normal);

                    setActiveFaceId(selectedTopology.id || `face_${Date.now()}`);

                    setActivePlane('FACE');

                    setSketchPoints([]);

                    setSketchRelations([]);

                    setSketchMode(true);

                    setSketchTool('SELECT');

                    setEditingFeatureId(null);

                    triggerCameraNormal();

                  }}

                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm text-[14px]"

                >

                  <span> </span> <span> (Sketch on Face)</span> </button> </div> </div>

          )}



          {/* PropertyManager () */}

          {!isSketchMode && selectedFeature && selectedSubNodeType !== 'SKETCH' && measurementMode === 'NONE' && (!selectedTopology || selectedTopology.type !== 'FACE') && (

            <div className="h-[250px] w-full border-t border-border bg-surface flex flex-col p-3 z-10 shrink-0"> <div className="text-[14px] uppercase tracking-wider text-secondary-text mb-2 font-bold flex justify-between items-center border-b border-border/40 pb-1"> <span> PropertyManager</span> <span className="text-[13px] bg-primary/10 text-primary px-1 rounded uppercase font-mono">{selectedFeature.type}</span> </div> <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">

                {selectedFeature.type === 'PATTERN' ? (

                  <div className="bg-surface p-2 rounded border border-border shadow-sm"> <div className="text-[13px] text-primary font-bold uppercase mb-1.5 border-b border-border/30 pb-0.5">Pattern</div> <div className="space-y-2 text-[14px] pt-1">

                      {/* Target Feature Selector */}

                      <div className="flex items-center justify-between gap-2"> <label className="text-[13px] text-secondary-text font-medium uppercase shrink-0"> </label> <select

                          value={selectedFeature.parameters.target_feature_id || ''}

                          onChange={(e) => onParamChange('target_feature_id', e.target.value)}

                          className="bg-surface border border-[#C4C7CE] rounded px-1 py-0.5 text-[14px] focus:border-primary outline-none text-primary-text w-[120px]"

                        >

                          <option value="">...</option>

                          {features

                            .filter(f => f.id !== selectedFeature.id && f.type !== 'PATTERN')

                            .map(f => (

                              <option key={f.id} value={f.id}>{f.name}</option>

                            ))

                          }

                        </select> </div>



                      {/* Pattern Type */}

                      <div className="flex items-center justify-between gap-2"> <label className="text-[13px] text-secondary-text font-medium uppercase shrink-0">Pattern</label> <select

                          value={selectedFeature.parameters.pattern_type || 'CIRCULAR'}

                          onChange={(e) => onParamChange('pattern_type', e.target.value)}

                          className="bg-surface border border-[#C4C7CE] rounded px-1 py-0.5 text-[14px] focus:border-primary outline-none text-primary-text w-[120px]"

                        >

                          <option value="CIRCULAR">Pattern</option> <option value="LINEAR">Pattern</option> </select> </div>



                      {/* Axis */}

                      <div className="flex items-center justify-between gap-2"> <label className="text-[13px] text-secondary-text font-medium uppercase shrink-0"> </label> <select

                          value={selectedFeature.parameters.axis || 'Y'}

                          onChange={(e) => onParamChange('axis', e.target.value)}

                          className="bg-surface border border-[#C4C7CE] rounded px-1 py-0.5 text-[14px] focus:border-primary outline-none text-primary-text w-[120px]"

                        >

                          <option value="X">X  (Axis X)</option> <option value="Y">Y  (Axis Y)</option> <option value="Z">Z  (Axis Z)</option> </select> </div>



                      {/* Count */}

                      <div className="flex items-center justify-between gap-2"> <label className="text-[13px] text-secondary-text font-medium uppercase shrink-0"> (Count)</label> <input

                          type="number"

                          step="1"

                          min="1"

                          value={selectedFeature.parameters.count ?? 4}

                          onChange={(e) => onParamChange('count', e.target.value)}

                          className="bg-surface border border-[#C4C7CE] rounded px-1.5 py-0.5 text-[14px] focus:border-primary outline-none text-primary-text font-mono w-[120px] text-right"

                        />

                      </div>



                      {/* Spacing */}

                      <div className="flex items-center justify-between gap-2"> <label className="text-[13px] text-secondary-text font-medium uppercase shrink-0">

                          {selectedFeature.parameters.pattern_type === 'CIRCULAR' ? ' ()' : ' (mm)'}

                        </label> <input

                          type="number"

                          step="1"

                          value={selectedFeature.parameters.spacing ?? 90.0}

                          onChange={(e) => onParamChange('spacing', e.target.value)}

                          className="bg-surface border border-[#C4C7CE] rounded px-1.5 py-0.5 text-[14px] focus:border-primary outline-none text-primary-text font-mono w-[120px] text-right"

                        />

                      </div> </div> </div>

                ) : (

                  /* direction header */

                  <div className="bg-surface p-2 rounded border border-border shadow-sm"> <div className="text-[13px] text-primary font-bold uppercase mb-1.5"> 1 (Direction 1)</div> <div className="space-y-2 text-[14px]">

                      {Object.keys(selectedFeature.parameters).map((key) => {

                        // Avoid showing points or relations array directly as a raw field, edit coordinates instead

                        if (key === 'points' || key === 'relations' || key === 'faceOrigin' || key === 'faceNormal' || key === 'faceId') return null;

                        return (

                          <div key={key} className="flex items-center justify-between gap-2"> <label className="text-[13px] text-secondary-text font-medium uppercase shrink-0">{key}</label>

                            {key === 'operation' ? (

                              <select

                                value={selectedFeature.parameters[key]}

                                onChange={(e) => onParamChange(key, e.target.value)}

                                className="bg-surface border border-[#C4C7CE] rounded px-1 py-0.5 text-[14px] focus:border-primary outline-none text-primary-text w-[120px]"

                              >

                                <option value="ADD">- (JOIN)</option> <option value="CUT">- (CUT)</option> </select>

                            ) : key === 'plane' ? (

                              <select

                                value={selectedFeature.parameters[key]}

                                onChange={(e) => onParamChange(key, e.target.value)}

                                className="bg-surface border border-[#C4C7CE] rounded px-1 py-0.5 text-[14px] focus:border-primary outline-none text-primary-text w-[120px]"

                              >

                                <option value="FRONT">FRONT (XY)</option> <option value="TOP">TOP (XZ)</option> <option value="RIGHT">RIGHT (YZ)</option> <option value="FACE"> (LCS)</option> </select>

                            ) : (

                              <input

                                type="number"

                                step="1"

                                value={selectedFeature.parameters[key]}

                                onChange={(e) => onParamChange(key, e.target.value)}

                                className="bg-surface border border-[#C4C7CE] rounded px-1.5 py-0.5 text-[14px] focus:border-primary outline-none text-primary-text font-mono w-[120px] text-right"

                              />

                            )}

                          </div>

                        );

                      })}

                    </div> </div>

                )}



                {/* Sketch Relations & Constraints Card */}

                {selectedFeature.parameters.relations && selectedFeature.parameters.relations.length > 0 && (

                  <div className="bg-surface p-2.5 rounded border border-border shadow-sm"> <div className="text-[13px] text-slate-700 font-bold uppercase mb-1.5 border-b border-border/30 pb-0.5 flex justify-between items-center"> <span>  (Relations)</span> <span className="text-[12px] text-emerald-600 font-bold bg-emerald-50 px-1 rounded animate-pulse">Fully Defined</span> </div> <div className="space-y-1 max-h-[85px] overflow-y-auto pr-0.5">

                      {selectedFeature.parameters.relations.map((rel: string, rIdx: number) => (

                        <div key={rIdx} className="flex items-center gap-1.5 text-[13px] text-secondary-text bg-[#F8FAFC] px-1.5 py-0.5 rounded border border-[#E2E8F0] font-mono"> <span className="text-emerald-500"> </span> <span className="font-bold text-primary-text">{rel}</span> <span className="text-slate-400 text-[13px] ml-auto"> </span> </div>

                      ))}

                    </div> </div>

                )}



                {/* Parent/Child Relations Card () */}

                {(() => {

                  const getParentsAndChildren = (targetFeature: any, allFeatures: any[]) => {

                    const parents: { id: string; name: string; type: string }[] = [];

                    const children: { id: string; name: string; type: string }[] = [];



                    const targetIdx = allFeatures.findIndex(f => f.id === targetFeature.id);

                    if (targetIdx === -1) return { parents, children };



                    // 1. Determine parents

                    for (let i = 0; i < targetIdx; i++) {

                      const f = allFeatures[i];

                      if (targetFeature.type === 'EXTRUDE') {

                        if (targetFeature.parameters.operation === 'CUT' && f.type === 'EXTRUDE' && f.parameters.operation === 'ADD') {

                          parents.push({ id: f.id, name: f.name, type: f.type });

                        }

                      } else if (targetFeature.type === 'FILLET' || targetFeature.type === 'CHAMFER') {

                        if (f.type === 'EXTRUDE' || f.type === 'BOX' || f.type === 'CYLINDER' || f.type === 'SPHERE' || f.type === 'REVOLVE') {

                          parents.push({ id: f.id, name: f.name, type: f.type });

                        }

                      } else if (targetFeature.type === 'REVOLVE') {

                        if (f.type === 'EXTRUDE' && f.parameters.operation === 'ADD') {

                          parents.push({ id: f.id, name: f.name, type: f.type });

                        }

                      }

                    }



                    // Always add its own sketch for extrudes/revolves

                    if (targetFeature.type === 'EXTRUDE' || targetFeature.type === 'REVOLVE') {

                      const sketchNum = targetFeature.name.match(/\d+/)?.[0] || '1';

                      parents.unshift({ id: `${targetFeature.id}_sketch`, name: `草圖${sketchNum} (Sketch${sketchNum})`, type: 'SKETCH' });

                    }



                    // 2. Determine children

                    for (let i = targetIdx + 1; i < allFeatures.length; i++) {

                      const f = allFeatures[i];

                      if (targetFeature.type === 'EXTRUDE' && targetFeature.parameters.operation === 'ADD') {

                        if (f.type === 'EXTRUDE' || f.type === 'FILLET' || f.type === 'CHAMFER' || f.type === 'REVOLVE') {

                          children.push({ id: f.id, name: f.name, type: f.type });

                        }

                      } else if (targetFeature.type === 'EXTRUDE' && targetFeature.parameters.operation === 'CUT') {

                        if (f.type === 'FILLET' || f.type === 'CHAMFER') {

                          children.push({ id: f.id, name: f.name, type: f.type });

                        }

                      }

                    }



                    return { parents, children };

                  };



                  const { parents, children } = getParentsAndChildren(selectedFeature, features);

                  if (parents.length === 0 && children.length === 0) return null;



                  return (

                    <div className="bg-surface p-2.5 rounded border border-border shadow-sm space-y-2"> <div className="text-[13px] text-slate-700 font-bold uppercase border-b border-border/30 pb-0.5 flex justify-between items-center"> <span className="flex items-center gap-1">  (Parent/Child Relations)</span> <span className="text-[12px] text-primary font-bold bg-primary/10 px-1 rounded font-mono"> </span> </div> <div className="grid grid-cols-2 gap-2 text-[9.5px]">

                        {/* Parents Column */}

                        <div className="space-y-1"> <div className="text-[13px] text-slate-400 font-semibold uppercase tracking-wider flex items-center gap-0.5"> <span> </span>  (Parents)

                          </div>

                          {parents.length === 0 ? (

                            <div className="text-[13px] text-slate-400 italic p-1 bg-slate-50 rounded text-center border border-dashed border-[#E5E7EB]"> </div>

                          ) : (

                            <div className="space-y-1 max-h-[70px] overflow-y-auto pr-0.5">

                              {parents.map((p) => (

                                <button

                                  key={p.id}

                                  onClick={() => {

                                    if (p.type === 'SKETCH') {

                                      handleEditFeatureSketch(selectedFeature);

                                    } else {

                                      setSelectedId(p.id);

                                    }

                                  }}

                                  className="w-full text-left truncate px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 transition-all font-medium leading-tight flex items-center gap-1"

                                >

                                  <span className="text-[13px]"> </span> <span className="truncate">{p.name}</span> </button>

                              ))}

                            </div>

                          )}

                        </div>



                        {/* Children Column */}

                        <div className="space-y-1"> <div className="text-[13px] text-slate-400 font-semibold uppercase tracking-wider flex items-center gap-0.5"> <span> </span>  (Children)

                          </div>

                          {children.length === 0 ? (

                            <div className="text-[13px] text-slate-400 italic p-1 bg-slate-50 rounded text-center border border-dashed border-[#E5E7EB]"> </div>

                          ) : (

                            <div className="space-y-1 max-h-[70px] overflow-y-auto pr-0.5">

                              {children.map((c) => (

                                <button

                                  key={c.id}

                                  onClick={() => setSelectedId(c.id)}

                                  className="w-full text-left truncate px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-800 transition-all font-medium leading-tight flex items-center gap-1"

                                >

                                  <span className="text-[13px]"> </span> <span className="truncate">{c.name}</span> </button>

                              ))}

                            </div>

                          )}

                        </div> </div> </div>

                  );

                })()}

              </div> </div>

          )}



          {/* Sketch Properties Manager () */}

          {!isSketchMode && selectedSubNodeType === 'SKETCH' && selectedFeature && measurementMode === 'NONE' && (

            <div className="h-[250px] w-full border-t border-border bg-[#FDF2F8] flex flex-col p-3 z-10 shrink-0 shadow-[0_-2px_10px_rgba(219,39,119,0.05)]"> <div className="text-[14px] uppercase tracking-wider text-pink-600 mb-2 font-bold flex justify-between items-center border-b border-pink-200 pb-1"> <span className="flex items-center gap-1.5"> </span> <span className="text-[13px] bg-pink-100 text-pink-600 px-1.5 rounded uppercase font-mono">Sketch Node</span> </div> <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 text-[14px]"> <div className="bg-surface p-2.5 rounded border border-pink-200 shadow-sm space-y-2"> <div className="flex justify-between items-center"> <span className="text-secondary-text font-medium"> </span> <span className="font-bold text-primary-text font-mono">

                      {selectedFeature.name.replace('-', '').replace('-', '')}

                    </span> </div> <div className="flex justify-between items-center"> <span className="text-secondary-text font-medium">Reference Plane</span> <span className="font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded font-mono">

                      {selectedFeature.parameters.plane || 'FRONT'}

                    </span> </div> <div className="flex justify-between items-center"> <span className="text-secondary-text font-medium"> </span> <span className="font-bold text-primary-text font-mono">

                      {Array.isArray(selectedFeature.parameters.points) ? selectedFeature.parameters.points.length : 0}

                    </span> </div> <div className="flex justify-between items-center"> <span className="text-secondary-text font-medium"> </span> <span className="font-semibold text-primary font-mono bg-blue-50 border border-blue-100 px-1 rounded">

                      {selectedFeature.name}

                    </span> </div> </div> <button

                  onClick={() => handleEditFeatureSketch(selectedFeature)}

                  className="w-full py-2 bg-pink-600 hover:bg-pink-700 active:bg-pink-800 text-white rounded font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm text-[14px] hover:shadow-pink-200"

                >

                  <span> </span> <span> (Edit Sketch)</span> </button> </div> </div>

          )}



          {/* Measurement PropertyManager () */}

          {!isSketchMode && measurementMode !== 'NONE' && (

            <div className="h-[210px] w-full border-t border-border bg-surface flex flex-col p-3 z-10 shrink-0"> <div className="text-[14px] uppercase tracking-wider text-indigo-600 mb-2 font-bold flex justify-between items-center border-b border-border/40 pb-1"> <span>  (Measure Manager)</span> <button

                  onClick={() => {

                    setMeasurementPoints([]);

                    setMeasurementResults(null);

                  }}

                  className="text-error text-[13px] font-bold hover:underline"

                >

                  

                </button> </div> <div className="flex-1 overflow-y-auto space-y-2.5 pr-1"> <div className="bg-surface p-2.5 rounded-sm border border-border shadow-sm"> <div className="text-[13px] text-indigo-700 font-bold uppercase mb-1.5 border-b border-border/30 pb-0.5 flex justify-between items-center"> <span>: {measurementMode}</span> <span className="text-[12px] text-indigo-600 font-bold bg-indigo-50 px-1 rounded font-mono">

                      : {measurementPoints.length} 

                    </span> </div> <div className="space-y-1">

                    {measurementPoints.length === 0 ? (

                      <div className="text-[13px] text-slate-400 py-4 text-center leading-tight">

                         3D 

                      </div>

                    ) : (

                      <div className="space-y-1.5 max-h-[70px] overflow-y-auto">

                        {measurementPoints.map((pt, pIdx) => (

                          <div key={pIdx} className="flex items-center gap-1.5 text-[13px] text-slate-700 bg-slate-50 p-1.5 rounded border border-slate-200 font-mono"> <span className="text-indigo-500 font-bold">M{pIdx+1}:</span> <span className="font-semibold">{pt.type}</span> <span className="text-slate-400 ml-auto">

                              [{pt.coordinates.map((n: number) => n.toFixed(1)).join(', ')}]

                            </span> </div>

                        ))}

                      </div>

                    )}

                  </div> </div>



                {measurementResults && (

                  <div className="bg-[#4F46E5]/10 p-2.5 rounded-sm border border-[#4F46E5]/20 shadow-sm flex flex-col items-center justify-center py-3"> <span className="text-[13px] text-[#4F46E5] uppercase font-bold tracking-widest mb-1"> </span> <div className="text-base font-black text-slate-900 font-mono leading-none flex items-baseline gap-1"> <span>{(measurementResults.value ?? 0).toFixed(3)}</span> <span className="text-[14px] text-indigo-600 font-bold">{measurementResults.unit}</span> </div>

                    {measurementResults.details && (

                      <span className="text-[13px] text-slate-400 font-mono mt-1 w-full text-center truncate">

                        {measurementResults.details}

                      </span>

                    )}

                  </div>

                )}

              </div> </div>

          )}

        </aside>



        {/* Right Area: Viewport (Graphics Area) */}

        <section className="flex-grow h-full relative" onContextMenu={(e) => e.preventDefault()}>

          <HeadsUpToolbar /> <ShortcutBox /> <ContextMenu />



          {isSketchMode && hasConflict && (

            <div className="absolute top-24 left-1/2 -translate-x-1/2 bg-red-500/90 border border-red-400 text-white px-5 py-3 rounded-full shadow-sm flex items-center gap-2.5 z-[999] w-[85%] max-w-[500px] pointer-events-none backdrop-blur-md"> <span className="text-xl"> </span> <div className="flex flex-col"> <span className="text-[12px] font-extrabold uppercase tracking-wider leading-none"> (Over-Constrained Conflict)</span> <span className="text-[11px] font-bold mt-1 text-red-50"> </span> </div> </div>

          )}



          {activeTab === 'DRAWING' ? (

            <DrawingSheet />

          ) : (

            <Viewport>

              {activeTab === 'ASSEMBLY' && components.length > 0 ? (

              components.map((comp) => (

                meshData.map((mesh: { data: MeshData }, idx: number) => (

                  <OcctShape 

                    key={`${comp.id}_${idx}`} 

                    data={mesh.data} 

                    position={comp.transform.position}

                    rotation={comp.transform.rotation}

                  />

                ))

              ))

            ) : meshData && meshData.length > 0 ? (

              meshData.map((mesh: { data: MeshData }, idx: number) => (

                <OcctShape key={idx} data={mesh.data} />

              ))

            ) : (

              <mesh> <sphereGeometry args={[1, 32, 32]} /> <meshStandardMaterial color="#94A3B8" wireframe opacity={0.4} transparent /> </mesh>

            )}

          </Viewport>

          )}



          {/* Floating Sketch Viewport HUD */}

          <SketchHUD onReset={resetSketchSession} onExit={handleExitAndExtrude} />



          {/* Loading Overlay */}

          {loading && (

            <div className="absolute inset-0 bg-background/25 backdrop-blur-[1px] flex items-center justify-center pointer-events-none z-30"> <div className="glass-effect px-5 py-2.5 rounded text-[14px] font-bold text-primary animate-pulse border border-primary/30 shadow-sm flex items-center gap-2"> <span> </span> <span>B-REP ...</span> </div> </div>

          )}



          {/*   (Mass Properties Modal) */}

          {showMassPropsModal && massProps && (

            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[1000] p-4 animate-fade-in"> <div className="w-[520px] bg-slate-900/90 border border-slate-700/60 rounded-3xl p-6 shadow-sm flex flex-col gap-5 text-slate-100 relative overflow-hidden backdrop-blur-xl">

                {/* Glowing neon background highlights */}

                <div className="absolute -top-12 -left-12 w-32 h-32 bg-amber-500/20 rounded-full blur-3xl pointer-events-none" /> <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />



                {/* Header */}

                <div className="flex justify-between items-center border-b border-slate-800 pb-3 z-10"> <div className="flex items-center gap-2"> <span className="text-xl"> </span> <span className="text-[16px] font-extrabold tracking-wider uppercase text-amber-400 font-sans">Mass Properties</span> </div> <button

                    onClick={() => setShowMassPropsModal(false)}

                    className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all cursor-pointer"

                  >

                    

                  </button> </div>



                {/* Physical metrics list */}

                <div className="space-y-3 z-10 font-sans"> <div className="bg-slate-950/50 rounded border border-slate-800/80 p-3.5 flex justify-between items-center shadow-inner"> <div className="flex flex-col"> <span className="text-[13px] text-slate-400 font-bold uppercase tracking-wider">Volume</span> <span className="text-[12px] text-secondary-text mt-0.5"> 3D B-Rep </span> </div> <span className="text-base font-black font-mono text-emerald-400">

                      {massProps.volume.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} <span className="text-[12px] font-bold text-secondary-text">mm</span> </span> </div> <div className="bg-slate-950/50 rounded border border-slate-800/80 p-3.5 flex justify-between items-center shadow-inner"> <div className="flex flex-col"> <span className="text-[13px] text-slate-400 font-bold uppercase tracking-wider">Surface Area</span> <span className="text-[12px] text-secondary-text mt-0.5">Surface Area</span> </div> <span className="text-base font-black font-mono text-indigo-400">

                      {massProps.surface_area.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} <span className="text-[12px] font-bold text-secondary-text">mm</span> </span> </div> <div className="bg-slate-950/50 rounded border border-slate-800/80 p-3.5 flex flex-col gap-2 shadow-inner"> <div className="flex justify-between items-center"> <span className="text-[13px] text-slate-400 font-bold uppercase tracking-wider"> (Center of Mass)</span> <span className="text-[11px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full font-mono font-bold">X, Y, Z Coords</span> </div> <div className="grid grid-cols-3 gap-2.5 mt-1">

                      {['X', 'Y', 'Z'].map((axis, aIdx) => (

                        <div key={axis} className="bg-slate-900 border border-slate-800 rounded-sm p-2 flex flex-col items-center shadow-sm"> <span className="text-[12px] font-extrabold text-secondary-text">{axis}-</span> <span className="text-[14px] font-black font-mono text-slate-100 mt-0.5">

                            {massProps.center_of_mass[aIdx].toFixed(3)} <span className="text-[10px] text-secondary-text font-bold">mm</span> </span> </div>

                      ))}

                    </div> </div>



                  {/* Moment of inertia tensor */}

                  <div className="bg-slate-950/50 rounded border border-slate-800/80 p-3.5 flex flex-col gap-2 shadow-inner"> <span className="text-[13px] text-slate-400 font-bold uppercase tracking-wider border-b border-slate-800 pb-1.5 flex justify-between items-center"> <span> (Inertia Tensor)</span> <span className="text-[10px] text-secondary-text font-mono">gmm (Density = 1.0)</span> </span> <div className="grid grid-cols-3 gap-1.5 mt-1 font-mono text-[12px] bg-slate-900/50 p-2.5 rounded-sm border border-slate-800/40">

                      {massProps.inertia_matrix.map((row, rIdx) => 

                        row.map((val, cIdx) => (

                          <div key={`${rIdx}-${cIdx}`} className="text-right p-1 font-semibold text-slate-300">

                            {val.toLocaleString(undefined, { maximumFractionDigits: 1 })}

                          </div>

                        ))

                      )}

                    </div> </div> </div>



                {/* Footer Controls */}

                <button

                  onClick={() => {

                    const text = `: ${massProps.volume.toFixed(3)} mm
: ${massProps.surface_area.toFixed(3)} mm
: [${massProps.center_of_mass.map(c => c.toFixed(3)).join(', ')}]
:
${massProps.inertia_matrix.map(r => r.map(v => v.toFixed(1)).join('\t')).join('\n')}`;

                    navigator.clipboard.writeText(text);

                    appAPI.notify('', '');

                  }}

                  className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 active:from-amber-700 active:to-amber-800 text-slate-950 font-extrabold rounded transition-all shadow-lg flex items-center justify-center gap-1.5 text-[14px] cursor-pointer"

                >

                  <span> </span> <span> (Copy Report)</span> </button> </div> </div>

          )}



          {/*  SolidWorks  (SolidWorks Translator Dialog) */}

          {showTranslatorModal && (

            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[1000] p-4 animate-fade-in"> <div className="w-[460px] bg-slate-900/90 border border-slate-700/60 rounded-3xl p-6 shadow-sm flex flex-col gap-4 text-slate-100 relative overflow-hidden backdrop-blur-xl"> <div className="absolute -top-12 -left-12 w-32 h-32 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />



                {/* Header */}

                <div className="flex justify-between items-center border-b border-slate-800 pb-3 z-10"> <div className="flex items-center gap-2"> <span className="text-xl"> </span> <span className="text-[16px] font-extrabold tracking-wider uppercase text-blue-400 font-sans">SolidWorks </span> </div> <button

                    onClick={() => setShowTranslatorModal(false)}

                    className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all cursor-pointer"

                  >

                    

                  </button> </div>



                {/* Guidance Content */}

                <div className="space-y-3.5 z-10 leading-relaxed text-[13px] text-slate-300 font-sans"> <p className="text-slate-200 font-bold border-l-4 border-blue-500 pl-2">

                     SolidWorks Part (.sldprt / .sldasm)

                  </p> <p>

                     SolidWorks 

                  </p> <div className="bg-slate-950/60 p-3.5 rounded border border-slate-800/80 space-y-2"> <span className="text-[13px] font-bold text-slate-100 flex items-center gap-1.5"> <span> </span> <span> </span> </span> <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-400"> <li> SolidWorks </li> <li> <span className="text-slate-200"> (Save As...)</span></li> <li> <span className="text-slate-200 font-mono">STEP (.step / .stp)</span> <span className="text-slate-200 font-mono">IGES (.iges)</span></li> <li> 3D-Builder </li> </ol> </div> </div>



                {/* Actions */}

                <div className="flex gap-3 mt-2 z-10 font-sans"> <button

                    onClick={() => setShowTranslatorModal(false)}

                    className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-sm font-bold transition-all text-center text-slate-300 text-[13px] cursor-pointer"

                  >

                    

                  </button> <button

                    onClick={async () => {

                      setShowTranslatorModal(false);

                      handleOpen();

                    }}

                    className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-sm font-bold transition-all shadow-md text-center text-[13px] cursor-pointer"

                  >

                    

                  </button> </div> </div> </div>

          )}

        </section> </div> <StatusBar /> </main>

  );

}

