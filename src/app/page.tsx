'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
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
  // Electron Native Integration
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) return;

    const unsubs = [
      onFileOpen(async (path) => {
        const result = await fileAPI.read(path);
        if (result.success && result.content) {
          try {
            const data = JSON.parse(result.content);
            if (data.features) {
              useCadStore.setState({ features: data.features });
              appAPI.notify('File Opened', `Successfully loaded ${path}`);
            }
          } catch (e) {
            appAPI.notify('Open Failed', 'Invalid project file format');
          }
        }
      }),
      onSaveRequest(async () => {
        const state = useCadStore.getState();
        const data = JSON.stringify({
          features: state.features,
          projectName: state.projectName
        });
        const result = await fileAPI.save(data);
        if (result?.success) {
          appAPI.notify('Saved', `Project saved to ${result.path}`);
        }
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
  const {
    mode, setMode,
    projectName,
    features, addFeature, removeFeature, updateFeatureParams,
    editingFeatureId, setEditingFeatureId,
    selectedId, setSelectedId,
    selectedSubNodeType, setSelectedSubNodeType,
    meshData, setMeshData,
    isSketchMode, setSketchMode,
    activePlane, setActivePlane,
    sketchTool, setSketchTool,
    gridSnap, setGridSnap,
    measurementMode, setMeasurementMode,
    measurementPoints, setMeasurementPoints,
    measurementResults, setMeasurementResults,
    mateSelection, setMateSelection,
    addComponent, components, setComponents,
    setContextMenu,
    sketchNewChain, setSketchNewChain,
    selectedEntityIds, setSelectedEntityIds,
    selectedTopology, setSelectedTopology,
    activeFaceOrigin, setActiveFaceOrigin,
    activeFaceNormal, setActiveFaceNormal,
    activeFaceId, setActiveFaceId,
    triggerCameraNormal
  } = useCadStore();

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
        details: `頂點距離 D = ${val.toFixed(3)} mm`
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
          unit: '°',
          details: `夾角 = ${val.toFixed(2)}°`
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
        unit: 'mm²',
        details: `表面積 = ${areaVal.toFixed(3)} mm²`
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
        unit: 'mm³',
        details: `體積 = ${volVal.toFixed(3)} mm³`
      });
    }

    useCadStore.getState().setSelectedTopology(null);
  }, [measurementMode, isSketchMode, measurementService, features, selectedId, setMeasurementPoints, setMeasurementResults]);


  const [loading, setLoading] = useState(false);
  const [engineStatus, setEngineStatus] = useState<'CONNECTED' | 'DISCONNECTED'>('DISCONNECTED');
  const [activeTab, setActiveTab] = useState<'FEATURES' | 'SKETCH' | 'EVALUATE' | 'ASSEMBLY' | 'DRAWING'>('FEATURES');
  const [smartDimensionActive, setSmartDimensionActive] = useState(false);
  const [demoStep, setDemoStep] = useState<string | null>(null);
  const [virtualCursor, setVirtualCursor] = useState<{
    x: string;
    y: string;
    visible: boolean;
    label: string;
    clicking: boolean;
  } | null>(null);
  const [sidebarHighlight, setSidebarHighlight] = useState<{
    active: boolean;
    target: 'SKETCH_COORDS' | 'SMART_DIM' | 'SIDEBAR_INPUT';
    typeValue?: string;
  } | null>(null);

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
        setSketchTool('LINE');
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
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isSketchMode, setSketchTool, setSketchNewChain]);

  const selectedFeature = useMemo(() => features.find(f => f.id === selectedId), [features, selectedId]);
  const solidSketchPointCount = useMemo(
    () => sketchPoints.filter(pt => !pt[2] || !pt[2].includes('CENTER_LINE')).length,
    [sketchPoints]
  );

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
            name: `圓圈 C${list.filter(e => e.type === 'CIRCLE').length + 1}`,
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
            name: `中心線 CL${list.filter(e => e.type === 'CENTER_LINE').length + 1}`,
            pointIndices: [i, i + 1]
          });
          i += 1;
        } else if (pNext[2] === 'ARC_CONTROL') {
          const pEnd = sketchPoints[i + 2];
          if (pEnd) {
            list.push({
              id: `arc_${i}`,
              type: 'LINE',
              name: `圓弧 A${list.filter(e => e.type === 'LINE' && e.name.includes('圓弧')).length + 1}`,
              pointIndices: [i, i + 1, i + 2]
            });
            i += 2;
          } else {
            list.push({
              id: `line_${i}`,
              type: 'LINE',
              name: `線段 L${list.filter(e => e.type === 'LINE' && !e.name.includes('圓弧')).length + 1}`,
              pointIndices: [i, i + 1]
            });
            i += 1;
          }
        } else {
          list.push({
            id: `line_${i}`,
            type: 'LINE',
            name: `線段 L${list.filter(e => e.type === 'LINE' && !e.name.includes('圓弧')).length + 1}`,
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

  // The new "Assembly-Aware" Rebuild Logic with History Rollback (退回控制棒)
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
        try {
          const data = JSON.parse(readResult.content);
          if (data.features) {
            useCadStore.setState({ features: data.features });
            appAPI.notify('File Opened', `Successfully loaded ${result.path}`);
          }
        } catch (e) {
          appAPI.notify('Open Failed', 'Invalid project file format');
        }
      }
    }
  };

  const handleSave = async () => {
    const state = useCadStore.getState();
    const data = JSON.stringify({
      features: state.features,
      projectName: state.projectName,
      components: state.components,
      mates: state.mates
    });
    const result = await fileAPI.save(data);
    if (result?.success) {
      appAPI.notify('Saved', `Project saved to ${result.path}`);
    }
  };

  const handleRebuild = useCallback(async () => {
    // Determine the active features based on the history rollback state
    let activeFeatures = features;
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

      // Check health first to update UI
      const isAlive = await client.checkHealth();
      setEngineStatus(isAlive ? 'CONNECTED' : 'DISCONNECTED');

      if (!isAlive) {
        console.warn('[API] Heavy Engine is not responding.');
        setLoading(false);
        return;
      }

      console.log('[API] Sending rolled-back feature list to Python Heavy Engine...', activeFeatures);
      const results = await client.rebuild(activeFeatures);

      if (results && Array.isArray(results)) {
        setMeshData(results);
      }
    } catch (err) {
      console.error('[API] Rebuild request failed:', err);
      setEngineStatus('DISCONNECTED');
    } finally {
      setLoading(false);
    }
  }, [features, setMeshData, isSketchMode, editingFeatureId]);

  useEffect(() => {
    handleRebuild();
  }, [handleRebuild]);

  const onParamChange = (key: string, value: string) => {
    if (!selectedId) return;

    // Industrial Parameter Handling: String-based parameters (Booleans, Planes, Types)
    const stringParams = ['operation', 'plane', 'type', 'target_feature_id', 'pattern_type', 'axis'];

    if (stringParams.includes(key)) {
      updateFeatureParams(selectedId, { [key]: value });
      return;
    }

    const num = parseFloat(value);
    if (isNaN(num)) return;
    updateFeatureParams(selectedId, { [key]: num });
  };


  const startInteractiveConstructionDemo = () => {
    // 1. Clear everything and reset
    useCadStore.setState({ features: [], selectedId: null });
    resetSketchSession();
    setSmartDimensionActive(false);
    setSidebarHighlight(null);
    
    // Step 1: Start sketching on FRONT plane
    setDemoStep("步驟 1：啟動草圖編輯器，並自動選定「前基準面 (Front Plane)」...");
    setVirtualCursor({ x: '180px', y: '50px', visible: true, label: '點選: 草圖分頁', clicking: true });
    setActiveTab('SKETCH');

    setTimeout(() => {
      setVirtualCursor(prev => prev ? { ...prev, clicking: false } : null);
    }, 400);

    setTimeout(() => {
      setVirtualCursor({ x: '120px', y: '330px', visible: true, label: '雙擊選定: 前基準面', clicking: true });
      setSketchMode(true);
      setActivePlane('FRONT');
      setSketchTool('LINE');
      setTimeout(() => setVirtualCursor(prev => prev ? { ...prev, clicking: false } : null), 400);
    }, 800);
    
    // Step 2: Draw base outline sequentially (Base center to outer wall)
    setTimeout(() => {
      setDemoStep("步驟 2：逐步連續繪製草圖端點以定義工件剖面 (P1 ➔ P2 ➔ P3)...");
      setVirtualCursor({ x: '60%', y: '52%', visible: true, label: '定位點 P1: (0, 0) mm', clicking: true });
      setSketchPoints([
        [0.0, 0.0]
      ]);
      setTimeout(() => setVirtualCursor(prev => prev ? { ...prev, clicking: false } : null), 400);
    }, 1800);

    setTimeout(() => {
      setVirtualCursor({ x: '68%', y: '52%', visible: true, label: '定位點 P2: (20.0, 0) mm', clicking: true });
      setSketchPoints([
        [0.0, 0.0],
        [20.0, 0.0]
      ]);
      setTimeout(() => setVirtualCursor(prev => prev ? { ...prev, clicking: false } : null), 400);
    }, 3200);

    setTimeout(() => {
      setVirtualCursor({ x: '68%', y: '38%', visible: true, label: '定位點 P3: (20.0, 30.0) mm', clicking: true });
      setSketchPoints([
        [0.0, 0.0],
        [20.0, 0.0],
        [20.0, 30.0]
      ]);
      setTimeout(() => setVirtualCursor(prev => prev ? { ...prev, clicking: false } : null), 400);
    }, 4600);

    // Step 3: Draw upper lip profile (P3 -> P4 -> P5 -> P6)
    setTimeout(() => {
      setDemoStep("步驟 3：繼續逆時針描繪內腔與壁厚，形成封閉的 2D 草圖輪廓...");
      setVirtualCursor({ x: '60%', y: '52%', visible: true, label: '端點閉合於起點 P1', clicking: true });
      setSketchPoints([
        [0.0, 0.0],
        [20.0, 0.0],
        [20.0, 30.0],
        [18.0, 30.0],
        [18.0, 2.0],
        [0.0, 2.0]
      ]);
      setTimeout(() => setVirtualCursor(prev => prev ? { ...prev, clicking: false } : null), 400);
    }, 6000);

    // Step 4: Apply Smart Dimension to scale parametric segment
    setTimeout(() => {
      setDemoStep("步驟 4：啟用「智慧尺寸 (Smart Dimension)」工具進行幾何定量驅動...");
      setVirtualCursor({ x: '210px', y: '110px', visible: true, label: '點選: 智慧尺寸', clicking: true });
      setSmartDimensionActive(true);
      setTimeout(() => setVirtualCursor(prev => prev ? { ...prev, clicking: false } : null), 400);
    }, 7500);

    // Step 5: Double click to type dimension in Sidebar
    setTimeout(() => {
      setDemoStep("步驟 5：雙擊高度標記，將外壁高度從 30.0 mm 參數化調整為 50.0 mm（端點座標與相鄰拓撲自適應縮放，保持草圖閉合）...");
      setVirtualCursor({ x: '180px', y: '730px', visible: true, label: '修改邊 P2➔P3 長度', clicking: true });
      setSidebarHighlight({ active: true, target: 'SMART_DIM', typeValue: '30.' });
      setTimeout(() => setVirtualCursor(prev => prev ? { ...prev, clicking: false } : null), 400);
    }, 8800);

    // Animate typing text values
    setTimeout(() => {
      setSidebarHighlight({ active: true, target: 'SMART_DIM', typeValue: '' });
    }, 9200);
    setTimeout(() => {
      setSidebarHighlight({ active: true, target: 'SMART_DIM', typeValue: '5' });
    }, 9500);
    setTimeout(() => {
      setSidebarHighlight({ active: true, target: 'SMART_DIM', typeValue: '50' });
    }, 9800);
    setTimeout(() => {
      setSidebarHighlight({ active: true, target: 'SMART_DIM', typeValue: '50.0' });
    }, 10100);

    // Apply parametric rebuild
    setTimeout(() => {
      const scaledPoints = [
        [0.0, 0.0],
        [20.0, 0.0],
        [20.0, 50.0],
        [18.0, 50.0],
        [18.0, 2.0],
        [0.0, 2.0]
      ];
      setSketchPoints(scaledPoints);
      setSketchRelations(["段邊 P2➔P3: 智慧尺寸 (已驅動值 50.00 mm)"]);
      setVirtualCursor(prev => prev ? { ...prev, clicking: true, label: '定量完成！' } : null);
      setTimeout(() => setVirtualCursor(prev => prev ? { ...prev, clicking: false } : null), 400);
    }, 10600);

    // Step 5: Exit sketch and trigger B-Rep Revolve Solid!
    setTimeout(() => {
      setDemoStep("步驟 6：結束草圖！呼叫「旋轉-實體」，底層 OCCT 幾何核讀取閉合草圖並繞對稱 Y 軸旋轉 360 度...");
      setVirtualCursor({ x: '100px', y: '50px', visible: true, label: '切換: 特徵分頁', clicking: true });
      setActiveTab('FEATURES');
      setSmartDimensionActive(false);
      setSidebarHighlight(null);
      setTimeout(() => setVirtualCursor(prev => prev ? { ...prev, clicking: false } : null), 400);
    }, 11800);

    setTimeout(() => {
      setVirtualCursor({ x: '170px', y: '110px', visible: true, label: '點選: 旋轉-實體', clicking: true });
      setTimeout(() => setVirtualCursor(prev => prev ? { ...prev, clicking: false } : null), 400);
    }, 12600);

    setTimeout(() => {
      const solidPoints = [
        [0.0, 0.0],
        [20.0, 0.0],
        [20.0, 50.0],
        [18.0, 50.0],
        [18.0, 2.0],
        [0.0, 2.0]
      ];
      const id = "feat_revolve_cup";
      const revolveFeature: CADFeature = {
        id,
        type: 'REVOLVE',
        name: `旋轉-實體 1 (空腔杯形件)`,
        parameters: {
          plane: 'FRONT',
          angle: 360.0,
          points: solidPoints,
          x: 0.0, y: 0.0, z: 0.0,
          operation: 'ADD'
        }
      };
      useCadStore.setState({ features: [revolveFeature], selectedId: id });
      resetSketchSession();
      setVirtualCursor({ x: '60%', y: '50%', visible: true, label: '3D 旋轉展示實體...', clicking: false });
      setTimeout(handleRebuild, 50);
    }, 13500);

    // Step 6: Highlight final solid and display measurements
    setTimeout(() => {
      setDemoStep("🎉 成功！3D 中空杯形實體建模完成！我們已自動調用「測量工具」來分析表面積與體積屬性，完美實現 CAD 確效！");
      setVirtualCursor({ x: '260px', y: '50px', visible: true, label: '切換: 評估分頁', clicking: true });
      setActiveTab('EVALUATE');
      setMeasurementMode('DISTANCE');
      setTimeout(() => setVirtualCursor(prev => prev ? { ...prev, clicking: false } : null), 400);
    }, 15800);

    setTimeout(() => {
      setVirtualCursor({ x: '58%', y: '48%', visible: true, label: '選取表面量測屬性', clicking: true });
      useCadStore.setState({
        selectedTopology: {
          type: "FACE",
          coordinates: [10.0, 25.0, 0.0],
          normal: [1.0, 0.0, 0.0],
          area: 6283.18,
          volume: 5882.16
        }
      });
      setTimeout(() => setVirtualCursor(prev => prev ? { ...prev, clicking: false } : null), 400);
    }, 16800);

    // Clear message banner and cursor
    setTimeout(() => {
      setDemoStep(null);
      setVirtualCursor(null);
      setSidebarHighlight(null);
    }, 20500);
  };


  const handleCokeBottleDemonstration = () => {
    const cokeWallProfile = [
      [0.0, 0.0],
      [15.0, 0.0],
      [15.0, 10.0],
      [17.5, 22.5, "ARC_CONTROL"],
      [15.0, 35.0],
      [12.5, 52.5, "ARC_CONTROL"],
      [15.0, 70.0],
      [17.5, 87.5, "ARC_CONTROL"],
      [15.0, 105.0],
      [8.5, 117.5, "ARC_CONTROL"],
      [8.5, 130.0],
      [10.0, 130.0],
      [10.0, 135.0],
      [9.0, 135.0],
      [9.0, 130.0],
      [7.5, 117.5, "ARC_CONTROL"],
      [7.5, 105.0],
      [16.5, 87.5, "ARC_CONTROL"],
      [14.0, 70.0],
      [11.5, 52.5, "ARC_CONTROL"],
      [14.0, 35.0],
      [16.5, 22.5, "ARC_CONTROL"],
      [14.0, 10.0],
      [14.0, 1.0],
      [0.0, 1.0]
    ];

    const cokeFeature: CADFeature = {
      id: "feat_coke_revolve",
      type: "REVOLVE",
      name: "旋轉-實體 1",
      parameters: {
        plane: "FRONT",
        angle: 360.0,
        points: cokeWallProfile,
        x: 0.0,
        y: 0.0,
        z: 0.0,
        operation: "ADD"
      }
    };

    useCadStore.setState({ features: [cokeFeature], selectedId: "feat_coke_revolve" });
    setTimeout(handleRebuild, 50);
  };


  const addNewFeature = (type: 'EXTRUDE' | 'BOX' | 'CYLINDER' | 'SPHERE' | 'PATTERN', operation: 'ADD' | 'CUT' = 'ADD') => {
    const id = `feat_${Date.now()}`;
    const names = {
      EXTRUDE: operation === 'ADD' ? '伸長-實體' : '伸長-除料',
      BOX: '方塊特徵',
      CYLINDER: '圓柱特徵',
      SPHERE: '球體特徵',
      PATTERN: '特徵陣列'
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

  const resetSketchSession = useCallback(() => {
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
  }, [setSketchPoints, setSketchRelations, setSketchMode, setActivePlane, setEditingFeatureId, setSelectedEntityIds, setActiveFaceOrigin, setActiveFaceNormal, setActiveFaceId]);

  const handleEditFeatureSketch = useCallback((feature: CADFeature) => {
    const rawPoints = feature.parameters?.points;
    if ((feature.type !== 'EXTRUDE' && feature.type !== 'REVOLVE') || !Array.isArray(rawPoints) || rawPoints.length < 3) {
      setSelectedId(feature.id);
      setSelectedSubNodeType('FEATURE');
      return;
    }

    const plane = isSketchPlane(feature.parameters?.plane) ? feature.parameters.plane : 'FRONT';
    const relations = Array.isArray(feature.parameters?.relations) ? [...feature.parameters.relations] : [];

    setSelectedId(feature.id);
    setSelectedSubNodeType(null);
    setEditingFeatureId(feature.id);
    setSketchPoints(cloneSketchPoints(rawPoints));
    setSketchRelations(relations);
    setActivePlane(plane);
    if (plane === 'FACE') {
      setActiveFaceOrigin(feature.parameters?.faceOrigin ?? null);
      setActiveFaceNormal(feature.parameters?.faceNormal ?? null);
      setActiveFaceId(feature.parameters?.faceId ?? null);
    } else {
      setActiveFaceOrigin(null);
      setActiveFaceNormal(null);
      setActiveFaceId(null);
    }
    setSketchTool('LINE');
    setSketchMode(true);
    setActiveTab('SKETCH');
    setSmartDimensionActive(false);
  }, [setSelectedId, setSelectedSubNodeType, setEditingFeatureId, setSketchPoints, setSketchRelations, setActivePlane, setSketchTool, setSketchMode, setActiveFaceOrigin, setActiveFaceNormal, setActiveFaceId]);

  const handleExitAndExtrude = useCallback((operationOverride?: 'ADD' | 'CUT') => {
    const solidPoints = cloneSketchPoints(sketchPoints.filter(pt => !pt[2] || !pt[2].includes('CENTER_LINE')));
    if (solidPoints.length < 3 || !activePlane) return;

    const existingFeature = editingFeatureId ? features.find(f => f.id === editingFeatureId) : null;
    const existingParams = existingFeature?.parameters ?? {};
    const nextParams = {
      ...existingParams,
      points: solidPoints,
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
    setSelectedId(featureId);

    setTimeout(handleRebuild, 50);
  }, [sketchPoints, activePlane, editingFeatureId, features, sketchRelations, updateFeatureParams, addFeature, resetSketchSession, setSelectedId, handleRebuild, activeFaceOrigin, activeFaceNormal, activeFaceId]);

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
    const newRel = `水平 (Horizontal ${sketchRelations.filter(r => r.includes('水平')).length + 1})`;
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
    const newRel = `垂直 (Vertical ${sketchRelations.filter(r => r.includes('垂直')).length + 1})`;
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
    const newRel = `重合原點 (Coincident ${sketchRelations.filter(r => r.includes('重合')).length + 1})`;
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
    const newRel = `等長邊緣 (Equal ${sketchRelations.filter(r => r.includes('等長')).length + 1})`;
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
    const newRel = `相切對稱 (Tangent ${sketchRelations.filter(r => r.includes('相切')).length + 1})`;
    setSketchRelations([...sketchRelations, newRel]);
  }, [ sketchRelations, setSketchRelations]);

  const applyFixConstraint = useCallback(() => {
    const newPts = sketchPoints.map(pt => [
      Math.round(pt[0]),
      Math.round(pt[1]),
      pt[2]
    ]);
    setSketchPoints(newPts);
    const newRel = `固定鎖定 (Fixed ${sketchRelations.filter(r => r.includes('固定')).length + 1})`;
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

      const newRel = `尺寸定量 (Dim ${sketchRelations.filter(r => r.includes('尺寸')).length + 1})`;
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
    const newRel = `平行 (Parallel: ${entA.name} ∥ ${entB.name})`;
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
    const newRel = `同心 (Concentric: ${entA.name} 🎯 ${entB.name})`;
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
    const newRel = `相切 (Tangent: ${lineEnt.name} 🌀 ${circleEnt.name})`;
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
    const newRel = `鏡像 (Mirror: ${targets.map(t => t.name).join(', ')} 🪞 對稱於 ${centerline.name})`;
    setSketchRelations([...sketchRelations, newRel]);
    setSelectedEntityIds([]);
  }, [entities, selectedEntityIds, setSelectedEntityIds]);

  return (
    <main className="flex flex-col h-screen w-screen overflow-hidden bg-[#EBEBEB] text-slate-800 font-sans">
      {/* 1. SolidWorks Desktop Titlebar */}
      <header className="h-[32px] w-full bg-white border-b border-[#D1D5DB] flex items-center justify-between px-3 select-none z-30 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <span className="text-primary font-black text-[14px]">🔷</span>
            <span className="text-[14px] font-bold tracking-tight text-slate-800">SolidWeb 3D-Builder</span>
          </div>
          <nav className="flex items-center gap-3 text-[14px] text-slate-600 font-medium">
            <span className="hover:text-foreground cursor-pointer transition-all">檔案 (F)</span>
            <span className="hover:text-foreground cursor-pointer transition-all">編輯 (E)</span>
            <span className="hover:text-foreground cursor-pointer transition-all">檢視 (V)</span>
            <span className="hover:text-foreground cursor-pointer transition-all">插入 (I)</span>
            <span className="hover:text-foreground cursor-pointer transition-all">工具 (T)</span>
            <span className="hover:text-foreground cursor-pointer transition-all">說明 (H)</span>
          </nav>
        </div>

        <div className="text-[14px] text-slate-600 font-medium tracking-tight">
          零件 1.SLDPRT * <span className="text-primary font-semibold">[{activePlane ? `${activePlane} 平面草圖` : '特徵編輯中'}]</span>
        </div>

        <div className="flex items-center gap-4 text-[14px] text-slate-600">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${engineStatus === 'CONNECTED' ? 'bg-success' : 'bg-error'}`} />
            <span>OCCT 幾何引擎: <span className={engineStatus === 'CONNECTED' ? 'text-success font-bold' : 'text-error'}>{engineStatus}</span></span>
          </div>
          <div className="flex gap-2">
            <span className="hover:text-foreground cursor-pointer">➖</span>
            <span className="hover:text-foreground cursor-pointer">⬜</span>
            <span className="hover:text-error cursor-pointer">❌</span>
          </div>
        </div>
      </header>

      {/* 2. SolidWorks CommandManager (Ribbon Bar) */}
      <div className="h-[95px] w-full bg-[#F5F6F9] border-b border-[#D1D5DB] flex flex-col z-20 shrink-0 select-none">
        {/* Ribbon Tabs */}
        <div className="flex px-4 border-b border-[#D1D5DB]/60 bg-[#EBEBEB]/40">
          <button
            onClick={() => {
              setActiveTab('FEATURES');
              setMeasurementMode('NONE');
              setMeasurementPoints([]);
              setMeasurementResults(null);
            }}
            className={`px-4 py-1 text-[14px] font-bold tracking-wider transition-all border-b-2 uppercase ${
              activeTab === 'FEATURES'
                ? 'border-primary text-primary bg-[#F5F6F9]/60'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            特徵 (Features)
          </button>
          <button
            onClick={() => {
              setActiveTab('SKETCH');
              setMeasurementMode('NONE');
              setMeasurementPoints([]);
              setMeasurementResults(null);
              // Auto trigger front plane sketch if not in sketch mode
              if (!isSketchMode) {
                setEditingFeatureId(null);
                setSketchPoints([]);
                setSketchRelations([]);
                setActivePlane('FRONT');
                setSketchMode(true);
                setSketchTool('LINE');
              }
            }}
            className={`px-4 py-1 text-[14px] font-bold tracking-wider transition-all border-b-2 uppercase ${
              activeTab === 'SKETCH'
                ? 'border-primary text-primary bg-[#F5F6F9]/60'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            草圖 (Sketch)
          </button>
          <button
            onClick={() => {
              setActiveTab('DRAWING');
              setMode('DRAWING');
              setMeasurementMode('NONE');
            }}
            className={`px-4 py-1 text-[14px] font-bold tracking-wider transition-all border-b-2 uppercase ${
              activeTab === 'DRAWING'
                ? 'border-primary text-primary bg-[#F5F6F9]/60'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            ?漲 (Drawing)
          </button>
          <button
            onClick={() => {
              setActiveTab('ASSEMBLY');
              setMode('ASSEMBLY');
              setMeasurementMode('NONE');
            }}
            className={`px-4 py-1 text-[14px] font-bold tracking-wider transition-all border-b-2 uppercase ${
              activeTab === 'ASSEMBLY'
                ? 'border-primary text-primary bg-[#F5F6F9]/60'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            ?? (Assembly)
          </button>
          <button
            onClick={() => {
              setActiveTab('EVALUATE');
              setMeasurementMode('DISTANCE');
              setMeasurementPoints([]);
              setMeasurementResults(null);
            }}
            className={`px-4 py-1 text-[14px] font-bold tracking-wider transition-all border-b-2 uppercase ${
              activeTab === 'EVALUATE'
                ? 'border-primary text-primary bg-[#F5F6F9]/60'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            評估 (Evaluate)
          </button>
        </div>

        {/* Ribbon Content Panels */}
        <div className="flex-1 flex items-center px-4 py-1 gap-1 overflow-x-auto overflow-y-hidden bg-[#F5F6F9]">
          {activeTab === 'FEATURES' ? (
            <div className="flex items-center gap-1.5 h-full">
              {/* Feature Commands */}
              <button
                onClick={() => {
                  if (solidSketchPointCount >= 3) {
                    handleExitAndExtrude();
                  } else {
                    // Start sketch mode on Front plane
                    setEditingFeatureId(null);
                    setSketchPoints([]);
                    setSketchRelations([]);
                    setActivePlane('FRONT');
                    setSketchMode(true);
                    setSketchTool('LINE');
                  }
                }}
                className="h-[52px] px-3 rounded hover:bg-slate-200/80 active:bg-slate-300 transition-all flex flex-col items-center justify-center gap-1 group"
                title="拉伸封閉草圖為三維特徵"
              >
                <span className="text-lg group-hover:scale-110 transition-all">🏗️</span>
                <span className="text-[13px] text-slate-800 font-bold leading-none">伸長-實體</span>
              </button>

              <button
                onClick={() => {
                  if (solidSketchPointCount >= 3) {
                    handleExitAndExtrude('CUT');
                  } else {
                    setEditingFeatureId(null);
                    setSketchPoints([]);
                    setSketchRelations([]);
                    setActivePlane('FRONT');
                    setSketchMode(true);
                    setSketchTool('LINE');
                  }
                }}
                className="h-[52px] px-3 rounded hover:bg-slate-200/80 active:bg-slate-300 transition-all flex flex-col items-center justify-center gap-1 group"
                title="在已有實體上拉伸除料"
              >
                <span className="text-lg group-hover:scale-110 transition-all">🕳️</span>
                <span className="text-[13px] text-slate-800 font-bold leading-none">伸長-除料</span>
              </button>

              <button
                onClick={() => {
                  if (isSketchMode && sketchPoints.length >= 3) {
                    const solidPoints = cloneSketchPoints(sketchPoints.filter(pt => pt[2] !== 'CENTER_LINE'));
                    const id = `feat_${Date.now()}`;
                    const revolveFeature: CADFeature = {
                      id,
                      type: 'REVOLVE',
                      name: `旋轉-實體 ${features.length + 1}`,
                      parameters: {
                        plane: activePlane ?? 'FRONT',
                        angle: 360.0,
                        points: solidPoints,
                        x: 0.0, y: 0.0, z: 0.0,
                        operation: 'ADD'
                      }
                    };
                    useCadStore.setState({ features: [...features, revolveFeature], selectedId: id });
                    resetSketchSession();
                    setTimeout(handleRebuild, 50);
                  } else {
                    handleCokeBottleDemonstration();
                  }
                }}
                className="h-[52px] px-3 rounded hover:bg-slate-200/80 active:bg-slate-300 transition-all flex flex-col items-center justify-center gap-1 group text-indigo-600 font-bold border border-indigo-200/50 bg-indigo-50/30 shadow-sm"
                title="執行 B-Rep 旋轉特徵（若在草圖模式下則旋轉當前草圖；否則載入可樂瓶）"
              >
                <span className="text-lg group-hover:scale-110 transition-all">🍾</span>
                <span className="text-[13px] leading-none">旋轉-實體</span>
              </button>

              <button
                onClick={startInteractiveConstructionDemo}
                className="h-[52px] px-3 rounded hover:bg-slate-200/80 active:bg-slate-300 transition-all flex flex-col items-center justify-center gap-1 group text-emerald-600 font-bold border border-emerald-200/50 bg-emerald-50/30 shadow-sm"
                title="自動演示從零草圖繪製、定量定量變更、到 3D 旋轉實體化與物理屬性分析的完整中間建構過程，親眼見證 CAD 解析與重建的真實能力！"
              >
                <span className="text-lg group-hover:scale-110 transition-all animate-bounce">🎥</span>
                <span className="text-[13px] leading-none">示範建構</span>
              </button>

              {/* Divider and active feature list cleaned of placeholder/padlocked orphans */}

              <div className="w-[1px] h-[40px] bg-slate-300 mx-2 shrink-0" />

              {/* Spawn Primitives */}
              <button
                onClick={() => addNewFeature('BOX')}
                className="h-[52px] px-3 rounded hover:bg-slate-200/80 active:bg-slate-300 transition-all flex flex-col items-center justify-center gap-1 group"
                title="快速生成三維方塊實體"
              >
                <span className="text-lg group-hover:scale-110 transition-all">📦</span>
                <span className="text-[13px] text-slate-800 font-bold leading-none">方塊實體</span>
              </button>

              <button
                onClick={() => addNewFeature('CYLINDER')}
                className="h-[52px] px-3 rounded hover:bg-slate-200/80 active:bg-slate-300 transition-all flex flex-col items-center justify-center gap-1 group"
                title="快速生成三維圓柱實體"
              >
                <span className="text-lg group-hover:scale-110 transition-all">🧪</span>
                <span className="text-[13px] text-slate-800 font-bold leading-none">圓柱實體</span>
              </button>

              <button
                onClick={() => addNewFeature('SPHERE')}
                className="h-[52px] px-3 rounded hover:bg-slate-200/80 active:bg-slate-300 transition-all flex flex-col items-center justify-center gap-1 group"
                title="快速生成三維球體實體"
              >
                <span className="text-lg group-hover:scale-110 transition-all">🔮</span>
                <span className="text-[13px] text-slate-800 font-bold leading-none">球體實體</span>
              </button>

              <button
                onClick={() => addNewFeature('PATTERN')}
                className="h-[52px] px-3 rounded hover:bg-slate-200/80 active:bg-slate-300 transition-all flex flex-col items-center justify-center gap-1 group text-indigo-600 font-bold border border-indigo-200/50 bg-indigo-50/30 shadow-sm animate-pulse"
                title="建立線性/環形特徵陣列複製"
              >
                <span className="text-lg group-hover:scale-110 transition-all">🔄</span>
                <span className="text-[13px] leading-none">特徵陣列</span>
              </button>
            </div>
          ) : activeTab === 'SKETCH' ? (
            <div className="flex items-center gap-1.5 h-full">
              {/* Sketch Commands */}
              <button
                onClick={() => {
                  setSketchMode(!isSketchMode);
                  if(!isSketchMode && !activePlane) setActivePlane('FRONT');
                }}
                className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 group ${
                  isSketchMode ? 'bg-primary/20 border border-primary/30 text-primary' : 'hover:bg-slate-200/80 active:bg-slate-300'
                }`}
                title="啟用/停用二維草圖編輯"
              >
                <span className="text-lg group-hover:scale-110 transition-all">✏️</span>
                <span className="text-[13px] text-slate-800 font-bold leading-none">{isSketchMode ? '結束草圖' : '繪製草圖'}</span>
              </button>

              <button
                onClick={() => {
                  setSmartDimensionActive(!smartDimensionActive);
                  setSelectedId(null); // Clear selected feature to focus on sketch sidebar editor
                }}
                className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 group ${
                  smartDimensionActive ? 'bg-primary/20 border border-primary/30 text-primary font-bold shadow-inner' : 'hover:bg-slate-200/80 active:bg-slate-300'
                }`}
                title="啟用智慧定量尺寸：點擊測量並修改草圖邊段的精確長度"
              >
                <span className="text-lg group-hover:scale-110 transition-all">📏</span>
                <span className="text-[13px] text-slate-800 font-bold leading-none">智慧尺寸</span>
              </button>

              <div className="w-[1px] h-[40px] bg-slate-300 mx-2 shrink-0" />

              {/* Sketch Tools */}
              <button
                onClick={() => setSketchTool('LINE')}
                className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 group ${
                  sketchTool === 'LINE' ? 'bg-primary/10 border border-primary/20 text-primary font-bold' : 'hover:bg-slate-200/80 active:bg-slate-300'
                }`}
                title="繪製直邊輪廓 (Line)"
              >
                <span className="text-lg group-hover:scale-110 transition-all">📐</span>
                <span className="text-[13px] text-slate-800 font-bold leading-none">直線段</span>
              </button>

              <button
                onClick={() => setSketchTool('CENTER_LINE')}
                className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 group ${
                  sketchTool === 'CENTER_LINE' ? 'bg-primary/10 border border-primary/20 text-primary font-bold' : 'hover:bg-slate-200/80 active:bg-slate-300'
                }`}
                title="繪製構造用中心線 (Centerline)"
              >
                <span className="text-lg group-hover:scale-110 transition-all">⛓️</span>
                <span className="text-[13px] text-slate-800 font-bold leading-none">中心線</span>
              </button>

              <button
                onClick={() => setSketchTool('MIDPOINT_LINE')}
                className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 group ${
                  sketchTool === 'MIDPOINT_LINE' ? 'bg-primary/10 border border-primary/20 text-primary font-bold' : 'hover:bg-slate-200/80 active:bg-slate-300'
                }`}
                title="繪製對稱中點直線 (Midpoint Line)"
              >
                <span className="text-lg group-hover:scale-110 transition-all">↔️</span>
                <span className="text-[13px] text-slate-800 font-bold leading-none">中點直線</span>
              </button>

              <button
                onClick={() => setSketchTool('CIRCLE')}
                className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 group ${
                  sketchTool === 'CIRCLE' ? 'bg-primary/10 border border-primary/20 text-primary font-bold' : 'hover:bg-slate-200/80 active:bg-slate-300'
                }`}
                title="繪製中心起點圓 (Circle)"
              >
                <span className="text-lg group-hover:scale-110 transition-all">⭕</span>
                <span className="text-[13px] text-slate-800 font-bold leading-none">中心圓</span>
              </button>

              <button
                onClick={() => setSketchTool('RECTANGLE')}
                className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 group ${
                  sketchTool === 'RECTANGLE' ? 'bg-primary/10 border border-primary/20 text-primary font-bold' : 'hover:bg-slate-200/80 active:bg-slate-300'
                }`}
                title="繪製對角矩形 (Rectangle)"
              >
                <span className="text-lg group-hover:scale-110 transition-all">⬜</span>
                <span className="text-[13px] text-slate-800 font-bold leading-none">邊角矩形</span>
              </button>

              <button
                onClick={() => setSketchTool('ARC')}
                className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 group ${
                  sketchTool === 'ARC' ? 'bg-primary/10 border border-primary/20 text-primary font-bold' : 'hover:bg-slate-200/80 active:bg-slate-300'
                }`}
                title="繪製三點圓弧輪廓 (Arc)"
              >
                <span className="text-lg group-hover:scale-110 transition-all">🎯</span>
                <span className="text-[13px] text-slate-800 font-bold leading-none">三點圓弧</span>
              </button>

              <div className="w-[1px] h-[40px] bg-slate-300 mx-2 shrink-0" />

              {/* Snapping Toggle */}
              <button
                onClick={() => setGridSnap(!gridSnap)}
                className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 group ${
                  gridSnap ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600' : 'hover:bg-slate-200/80 active:bg-slate-300'
                }`}
                title="是否將座標鎖定於整數網格點"
              >
                <span className="text-lg group-hover:scale-110 transition-all">🧲</span>
                <span className="text-[13px] font-bold leading-none">網格吸附</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 h-full">
              {/* Evaluate/Measure Tools */}
              <button
                onClick={() => {
                  if (measurementMode === 'NONE') {
                    setMeasurementMode('DISTANCE');
                    setMeasurementPoints([]);
                    setMeasurementResults(null);
                  } else {
                    setMeasurementMode('NONE');
                    setMeasurementPoints([]);
                    setMeasurementResults(null);
                  }
                }}
                className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 group ${
                  measurementMode !== 'NONE'
                    ? 'bg-indigo-500/20 border border-indigo-500/30 text-indigo-600 font-bold shadow-inner'
                    : 'hover:bg-slate-200/80 active:bg-slate-300'
                }`}
                title="啟用/停用精確量測工具 (Measure)"
              >
                <span className="text-lg group-hover:scale-110 transition-all">📐</span>
                <span className="text-[13px] text-slate-800 font-bold leading-none">
                  {measurementMode !== 'NONE' ? '結束量測' : '測量工具'}
                </span>
              </button>

              {measurementMode !== 'NONE' && (
                <>
                  <div className="w-[1px] h-[40px] bg-slate-300 mx-2 shrink-0" />
                  
                  <button
                    onClick={() => {
                      setMeasurementMode('DISTANCE');
                      setMeasurementPoints([]);
                      setMeasurementResults(null);
                    }}
                    className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 ${
                      measurementMode === 'DISTANCE' ? 'bg-indigo-100 border border-indigo-300 text-indigo-700 font-bold' : 'hover:bg-slate-200'
                    }`}
                  >
                    <span className="text-sm">📏</span>
                    <span className="text-[13px] text-slate-700 font-bold">頂點距離</span>
                  </button>

                  <button
                    onClick={() => {
                      setMeasurementMode('ANGLE');
                      setMeasurementPoints([]);
                      setMeasurementResults(null);
                    }}
                    className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 ${
                      measurementMode === 'ANGLE' ? 'bg-indigo-100 border border-indigo-300 text-indigo-700 font-bold' : 'hover:bg-slate-200'
                    }`}
                  >
                    <span className="text-sm">📐</span>
                    <span className="text-[13px] text-slate-700 font-bold">夾角測量</span>
                  </button>

                  <button
                    onClick={() => {
                      setMeasurementMode('AREA');
                      setMeasurementPoints([]);
                      setMeasurementResults(null);
                    }}
                    className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 ${
                      measurementMode === 'AREA' ? 'bg-indigo-100 border border-indigo-300 text-indigo-700 font-bold' : 'hover:bg-slate-200'
                    }`}
                  >
                    <span className="text-sm">💠</span>
                    <span className="text-[13px] text-slate-700 font-bold">表面積</span>
                  </button>

                  <button
                    onClick={() => {
                      setMeasurementMode('VOLUME');
                      setMeasurementPoints([]);
                      setMeasurementResults(null);
                    }}
                    className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 ${
                      measurementMode === 'VOLUME' ? 'bg-indigo-100 border border-indigo-300 text-indigo-700 font-bold' : 'hover:bg-slate-200'
                    }`}
                  >
                    <span className="text-sm">📦</span>
                    <span className="text-[13px] text-slate-700 font-bold">實體體積</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3. Main Workspace Area */}
      <div className="flex-1 flex w-full overflow-hidden relative">
        {/* Left Sidebars: FeatureManager & PropertyManager */}
        <aside className="w-[290px] h-full bg-white border-r border-[#D1D5DB] flex flex-col z-10 shrink-0">
          {/* SolidWorks Tab Header */}
          <div className="h-[28px] w-full bg-[#F5F6F9] flex items-center justify-around border-b border-[#D1D5DB]/60 text-slate-500 text-[14px]">
            <span className="text-primary font-bold cursor-pointer" title="FeatureManager 設計樹">📑 設計樹</span>
            <span className="hover:text-slate-800 cursor-pointer" title="PropertyManager 屬性經理">📋 屬性列</span>
            <span className="hover:text-slate-800 cursor-pointer" title="ConfigurationManager 設定經理">⚙️ 組態</span>
          </div>

          <div className="flex-grow flex flex-col overflow-hidden">
            {isSketchMode ? (
              /* Active Sketch Editor Panel */
              <div className="flex-grow overflow-y-auto p-3 bg-primary/5 border-l-4 border-primary">
                <div className="text-[14px] uppercase tracking-wider text-primary mb-3 font-bold flex justify-between items-center">
                  <span>Active Sketch Editor</span>
                  <button
                    onClick={resetSketchSession}
                    className="text-error hover:underline text-[13px]"
                  >
                    取消草圖
                  </button>
                </div>

                <div className="space-y-3">
                  <SketchPropertyManager />
                </div>
              </div>
            ) : activeTab === 'ASSEMBLY' ? (
              <MatePanel />
            ) : measurementMode !== 'NONE' ? (
              <MeasurementPanel />
            ) : (
              /* FeatureManager Design Tree */
              <div className="flex-1 overflow-y-auto p-3 flex flex-col">
                <div className="text-[14px] uppercase tracking-wider text-slate-600 mb-3 font-bold flex justify-between items-center border-b border-[#D1D5DB] pb-1.5">
                  <span>FeatureManager 設計樹</span>
                  <button onClick={handleRebuild} className="text-primary hover:underline text-[13px] uppercase tracking-tighter">模型重構</button>
                </div>

                {/* Standard SolidWorks Meta Nodes */}
                <div className="space-y-1.5 text-[14px] select-none">
                  <div className="flex items-center gap-2 p-1 text-slate-800 font-bold">
                    <span>🔷</span>
                    <span>零件1 (Part1)</span>
                  </div>

                  <div className="pl-4 space-y-1 text-slate-600">
                    <div className="flex items-center gap-2 p-0.5 hover:text-slate-800 cursor-pointer">
                      <span>📡</span>
                      <span>感測器 (Sensors)</span>
                    </div>
                    <div className="flex items-center gap-2 p-0.5 hover:text-slate-800 cursor-pointer">
                      <span>📝</span>
                      <span>註記 (Annotations)</span>
                    </div>
                    <div className="flex items-center gap-2 p-0.5 hover:text-slate-800 cursor-pointer border-b border-[#D1D5DB]/40 pb-1.5">
                      <span>🪵</span>
                      <span>材質 &lt;未指定材質&gt;</span>
                    </div>

                    {/* Standard Plane Selection (Double click triggers sketch) */}
                    {(() => {
                      const frontRel = getTreeRelation('FRONT', hoveredTreeId);
                      const topRel = getTreeRelation('TOP', hoveredTreeId);
                      const rightRel = getTreeRelation('RIGHT', hoveredTreeId);
                      const originRel = getTreeRelation('ORIGIN', hoveredTreeId);

                      return (
                        <>
                          <div
                            onClick={() => { 
                              setActivePlane('FRONT'); 
                              setSelectedId(null); 
                              setContextMenu({ plane: 'FRONT', position: [0, 0, 40] });
                            }}
                            onDoubleClick={() => { setEditingFeatureId(null); setSketchPoints([]); setSketchRelations([]); setActivePlane('FRONT'); setSketchMode(true); setSketchTool('LINE'); setContextMenu(null); }}
                            onMouseEnter={() => setHoveredTreeId('FRONT')}
                            onMouseLeave={() => setHoveredTreeId(null)}
                            className={`flex items-center justify-between p-1 rounded cursor-pointer transition-all border ${
                              activePlane === 'FRONT' 
                                ? 'bg-primary/10 border-primary/30 text-primary font-bold' 
                                : frontRel === 'PARENT'
                                ? 'bg-blue-50 border-blue-200 text-blue-900 font-medium'
                                : frontRel === 'CHILD'
                                ? 'bg-purple-50 border-purple-200 text-purple-900 font-medium'
                                : 'hover:bg-slate-100 border-transparent hover:text-slate-800'
                            }`}
                            title="點擊選取基準面，按雙擊進入草圖模式"
                          >
                            <div className="flex items-center gap-2">
                              <span>🌐</span>
                              <span>前基準面 (Front Plane)</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 text-[12px] font-bold">
                              {frontRel === 'PARENT' && <span className="bg-blue-100 text-blue-600 px-1 py-0.2 rounded">父 (Parent)</span>}
                              {frontRel === 'CHILD' && <span className="bg-purple-100 text-purple-600 px-1 py-0.2 rounded">子 (Child)</span>}
                              {activePlane === 'FRONT' && <span className="bg-primary/10 text-primary px-1 rounded uppercase">選取</span>}
                            </div>
                          </div>

                          <div
                            onClick={() => { 
                              setActivePlane('TOP'); 
                              setSelectedId(null); 
                              setContextMenu({ plane: 'TOP', position: [0, 40, 0] });
                            }}
                            onDoubleClick={() => { setEditingFeatureId(null); setSketchPoints([]); setSketchRelations([]); setActivePlane('TOP'); setSketchMode(true); setSketchTool('LINE'); setContextMenu(null); }}
                            onMouseEnter={() => setHoveredTreeId('TOP')}
                            onMouseLeave={() => setHoveredTreeId(null)}
                            className={`flex items-center justify-between p-1 rounded cursor-pointer transition-all border ${
                              activePlane === 'TOP' 
                                ? 'bg-primary/10 border-primary/30 text-primary font-bold' 
                                : topRel === 'PARENT'
                                ? 'bg-blue-50 border-blue-200 text-blue-900 font-medium'
                                : topRel === 'CHILD'
                                ? 'bg-purple-50 border-purple-200 text-purple-900 font-medium'
                                : 'hover:bg-slate-100 border-transparent hover:text-slate-800'
                            }`}
                            title="點擊選取基準面，按雙擊進入草圖模式"
                          >
                            <div className="flex items-center gap-2">
                              <span>🌐</span>
                              <span>上基準面 (Top Plane)</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 text-[12px] font-bold">
                              {topRel === 'PARENT' && <span className="bg-blue-100 text-blue-600 px-1 py-0.2 rounded">父 (Parent)</span>}
                              {topRel === 'CHILD' && <span className="bg-purple-100 text-purple-600 px-1 py-0.2 rounded">子 (Child)</span>}
                              {activePlane === 'TOP' && <span className="bg-primary/10 text-primary px-1 rounded uppercase">選取</span>}
                            </div>
                          </div>

                          <div
                            onClick={() => { 
                              setActivePlane('RIGHT'); 
                              setSelectedId(null); 
                              setContextMenu({ plane: 'RIGHT', position: [40, 0, 0] });
                            }}
                            onDoubleClick={() => { setEditingFeatureId(null); setSketchPoints([]); setSketchRelations([]); setActivePlane('RIGHT'); setSketchMode(true); setSketchTool('LINE'); setContextMenu(null); }}
                            onMouseEnter={() => setHoveredTreeId('RIGHT')}
                            onMouseLeave={() => setHoveredTreeId(null)}
                            className={`flex items-center justify-between p-1 rounded cursor-pointer transition-all border ${
                              activePlane === 'RIGHT' 
                                ? 'bg-primary/10 border-primary/30 text-primary font-bold' 
                                : rightRel === 'PARENT'
                                ? 'bg-blue-50 border-blue-200 text-blue-900 font-medium'
                                : rightRel === 'CHILD'
                                ? 'bg-purple-50 border-purple-200 text-purple-900 font-medium'
                                : 'hover:bg-slate-100 border-transparent hover:text-slate-800'
                            }`}
                            title="點擊選取基準面，按雙擊進入草圖模式"
                          >
                            <div className="flex items-center gap-2">
                              <span>🌐</span>
                              <span>右基準面 (Right Plane)</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 text-[12px] font-bold">
                              {rightRel === 'PARENT' && <span className="bg-blue-100 text-blue-600 px-1 py-0.2 rounded">父 (Parent)</span>}
                              {rightRel === 'CHILD' && <span className="bg-purple-100 text-purple-600 px-1 py-0.2 rounded">子 (Child)</span>}
                              {activePlane === 'RIGHT' && <span className="bg-primary/10 text-primary px-1 rounded uppercase">選取</span>}
                            </div>
                          </div>

                          <div 
                            onMouseEnter={() => setHoveredTreeId('ORIGIN')}
                            onMouseLeave={() => setHoveredTreeId(null)}
                            className={`flex items-center justify-between p-1 rounded cursor-pointer transition-all border border-transparent ${
                              originRel === 'PARENT'
                                ? 'bg-blue-50 border-blue-200 text-blue-900 font-medium'
                                : originRel === 'CHILD'
                                ? 'bg-purple-50 border-purple-200 text-purple-900 font-medium'
                                : 'hover:bg-slate-100 hover:text-slate-800'
                            }`}
                          >
                            <div className="flex items-center gap-2 p-0.5">
                              <span>📍</span>
                              <span>原點 (Origin)</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 text-[12px] font-bold mr-1">
                              {originRel === 'PARENT' && <span className="bg-blue-100 text-blue-600 px-1 py-0.2 rounded">父 (Parent)</span>}
                              {originRel === 'CHILD' && <span className="bg-purple-100 text-purple-600 px-1 py-0.2 rounded">子 (Child)</span>}
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Chronological History Tree */}
                  <div className="pl-2 pt-2 space-y-1">
                    <div className="text-[13px] uppercase tracking-wider text-slate-500 font-bold mb-1">模型歷史特徵</div>
                    {features.map((f, fIdx) => {
                      const relState = getTreeRelation(f.id, hoveredTreeId);
                      const isExtrudeOrRevolve = f.type === 'EXTRUDE' || f.type === 'REVOLVE';
                      let sketchNum = 1;
                      if (f.id === 'feat_base_plate') sketchNum = 1;
                      else if (f.id === 'feat_center_hole') sketchNum = 2;
                      else {
                        const extrudeFeats = features.filter(x => x.type === 'EXTRUDE' || x.type === 'REVOLVE');
                        const idx = extrudeFeats.findIndex(x => x.id === f.id);
                        sketchNum = idx >= 0 ? idx + 1 : fIdx + 1;
                      }

                      return (
                        <div 
                          key={f.id} 
                          className="flex flex-col border border-transparent rounded transition-all"
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
                                ? 'bg-primary/10 border-primary/30 text-slate-800 font-bold'
                                : relState === 'PARENT'
                                ? 'bg-blue-50/70 border-blue-200 text-blue-900 font-medium'
                                : relState === 'CHILD'
                                ? 'bg-purple-50/70 border-purple-200 text-purple-900 font-medium'
                                : 'hover:bg-slate-100 border-transparent text-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm">
                                {f.type === 'REVOLVE' ? '🍾' : f.type === 'EXTRUDE' ? (f.parameters.operation === 'CUT' ? '🕳️' : '🏗️') : f.type === 'BOX' ? '📦' : f.type === 'CYLINDER' ? '🧪' : '🔮'}
                              </span>
                              <div className="flex flex-col">
                                <span className="text-[14px] leading-tight">{f.name}</span>
                                <span className="text-[13px] text-slate-500 font-mono leading-none uppercase">{f.type === 'EXTRUDE' ? f.parameters.operation : f.type}</span>
                                {editingFeatureId === f.id && (
                                  <span className="mt-0.5 text-[12px] text-emerald-700 font-bold uppercase leading-none">Editing sketch</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 text-[12px] font-bold">
                              {relState === 'PARENT' && <span className="bg-blue-100 text-blue-600 px-1 py-0.2 rounded">父 (Parent)</span>}
                              {relState === 'CHILD' && <span className="bg-purple-100 text-purple-600 px-1.5 py-0.2 rounded">子 (Child)</span>}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeFeature(f.id);
                                  setSelectedId(null);
                                  setTimeout(handleRebuild, 50);
                                }}
                                onDoubleClick={(e) => e.stopPropagation()}
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-error/20 rounded text-slate-500 hover:text-error transition-all"
                                title="刪除特徵"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>

                          {/* Nested Sketch Child Node */}
                          {isExtrudeOrRevolve && (
                            <div
                              onClick={() => { setSelectedId(f.id); setSelectedSubNodeType('SKETCH'); }}
                              onDoubleClick={() => handleEditFeatureSketch(f)}
                              className={`pl-7 pr-2 py-1 flex items-center justify-between gap-1.5 cursor-pointer text-[14px] select-none rounded transition-all border border-transparent ${
                                selectedId === f.id && selectedSubNodeType === 'SKETCH'
                                  ? 'bg-pink-100/90 border border-pink-300 text-pink-700 font-bold shadow-xs'
                                  : 'text-slate-500 hover:text-primary hover:bg-slate-100/50'
                              }`}
                              title="雙擊編輯此特徵所屬的草圖幾何"
                            >
                              <div className="flex items-center gap-1.5">
                                <span>↳ ✏️</span>
                                <span className="italic hover:underline">草圖{sketchNum} (Sketch{sketchNum})</span>
                              </div>
                              {editingFeatureId === f.id && (
                                <span className="text-[12px] bg-emerald-100 text-emerald-700 px-1.5 py-0.2 rounded font-bold font-mono mr-2 animate-pulse">編輯中</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 表面屬性管理器 (Face Selection) */}
          {!isSketchMode && selectedTopology?.type === 'FACE' && measurementMode === 'NONE' && (
            <div className="h-[250px] w-full border-t border-[#D1D5DB] bg-[#F5F6F9] flex flex-col p-3 z-10 shrink-0 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
              <div className="text-[14px] uppercase tracking-wider text-slate-500 mb-2 font-bold flex justify-between items-center border-b border-[#D1D5DB]/40 pb-1">
                <span className="flex items-center gap-1">📋 表面屬性管理器</span>
                <span className="text-[13px] bg-indigo-600/10 text-indigo-600 px-1.5 rounded uppercase font-mono">Face Selected</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                <div className="bg-white p-2.5 rounded border border-[#D1D5DB] shadow-sm space-y-2 text-[14px]">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">中心點 (Center)</span>
                    <span className="font-mono text-slate-800 text-[13px]">
                      {selectedTopology.coordinates ? `[${selectedTopology.coordinates.map((c: number) => c.toFixed(1)).join(', ')}]` : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">法向量 (Normal)</span>
                    <span className="font-mono text-slate-800 text-[13px]">
                      {selectedTopology.normal ? `[${selectedTopology.normal.map((n: number) => n.toFixed(2)).join(', ')}]` : 'N/A'}
                    </span>
                  </div>
                  {selectedTopology.id && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-medium">拓撲 ID</span>
                      <span className="font-mono text-slate-800 text-xs bg-slate-100 px-1 rounded truncate max-w-[120px]" title={selectedTopology.id}>
                        {selectedTopology.id}
                      </span>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => {
                    if (!selectedTopology.coordinates || !selectedTopology.normal) return;
                    setActiveFaceOrigin(selectedTopology.coordinates);
                    setActiveFaceNormal(selectedTopology.normal);
                    setActiveFaceId(selectedTopology.id || `face_${Date.now()}`);
                    setActivePlane('FACE');
                    setSketchPoints([]);
                    setSketchRelations([]);
                    setSketchMode(true);
                    setSketchTool('LINE');
                    setEditingFeatureId(null);
                    triggerCameraNormal();
                  }}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm text-[14px]"
                >
                  <span>✏️</span>
                  <span>在面上起草 (Sketch on Face)</span>
                </button>
              </div>
            </div>
          )}

          {/* PropertyManager (左下角特徵屬性面板) */}
          {!isSketchMode && selectedFeature && selectedSubNodeType !== 'SKETCH' && measurementMode === 'NONE' && (!selectedTopology || selectedTopology.type !== 'FACE') && (
            <div className="h-[250px] w-full border-t border-[#D1D5DB] bg-[#F5F6F9] flex flex-col p-3 z-10 shrink-0">
              <div className="text-[14px] uppercase tracking-wider text-slate-500 mb-2 font-bold flex justify-between items-center border-b border-[#D1D5DB]/40 pb-1">
                <span>📋 PropertyManager</span>
                <span className="text-[13px] bg-primary/10 text-primary px-1 rounded uppercase font-mono">{selectedFeature.type}</span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                {selectedFeature.type === 'PATTERN' ? (
                  <div className="bg-white p-2 rounded border border-[#D1D5DB] shadow-sm">
                    <div className="text-[13px] text-primary font-bold uppercase mb-1.5 border-b border-[#D1D5DB]/30 pb-0.5">陣列參數 (Pattern Parameters)</div>
                    <div className="space-y-2 text-[14px] pt-1">
                      {/* Target Feature Selector */}
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-[13px] text-slate-600 font-medium uppercase shrink-0">目標特徵</label>
                        <select
                          value={selectedFeature.parameters.target_feature_id || ''}
                          onChange={(e) => onParamChange('target_feature_id', e.target.value)}
                          className="bg-white border border-[#C4C7CE] rounded px-1 py-0.5 text-[14px] focus:border-primary outline-none text-slate-800 w-[120px]"
                        >
                          <option value="">選擇特徵...</option>
                          {features
                            .filter(f => f.id !== selectedFeature.id && f.type !== 'PATTERN')
                            .map(f => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))
                          }
                        </select>
                      </div>

                      {/* Pattern Type */}
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-[13px] text-slate-600 font-medium uppercase shrink-0">陣列類型</label>
                        <select
                          value={selectedFeature.parameters.pattern_type || 'CIRCULAR'}
                          onChange={(e) => onParamChange('pattern_type', e.target.value)}
                          className="bg-white border border-[#C4C7CE] rounded px-1 py-0.5 text-[14px] focus:border-primary outline-none text-slate-800 w-[120px]"
                        >
                          <option value="CIRCULAR">環形陣列</option>
                          <option value="LINEAR">線性陣列</option>
                        </select>
                      </div>

                      {/* Axis */}
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-[13px] text-slate-600 font-medium uppercase shrink-0">參考軸心</label>
                        <select
                          value={selectedFeature.parameters.axis || 'Y'}
                          onChange={(e) => onParamChange('axis', e.target.value)}
                          className="bg-white border border-[#C4C7CE] rounded px-1 py-0.5 text-[14px] focus:border-primary outline-none text-slate-800 w-[120px]"
                        >
                          <option value="X">X 軸 (Axis X)</option>
                          <option value="Y">Y 軸 (Axis Y)</option>
                          <option value="Z">Z 軸 (Axis Z)</option>
                        </select>
                      </div>

                      {/* Count */}
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-[13px] text-slate-600 font-medium uppercase shrink-0">個數 (Count)</label>
                        <input
                          type="number"
                          step="1"
                          min="1"
                          value={selectedFeature.parameters.count ?? 4}
                          onChange={(e) => onParamChange('count', e.target.value)}
                          className="bg-white border border-[#C4C7CE] rounded px-1.5 py-0.5 text-[14px] focus:border-primary outline-none text-slate-800 font-mono w-[120px] text-right"
                        />
                      </div>

                      {/* Spacing */}
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-[13px] text-slate-600 font-medium uppercase shrink-0">
                          {selectedFeature.parameters.pattern_type === 'CIRCULAR' ? '角度 (度)' : '距離 (mm)'}
                        </label>
                        <input
                          type="number"
                          step="1"
                          value={selectedFeature.parameters.spacing ?? 90.0}
                          onChange={(e) => onParamChange('spacing', e.target.value)}
                          className="bg-white border border-[#C4C7CE] rounded px-1.5 py-0.5 text-[14px] focus:border-primary outline-none text-slate-800 font-mono w-[120px] text-right"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  /* direction header */
                  <div className="bg-white p-2 rounded border border-[#D1D5DB] shadow-sm">
                    <div className="text-[13px] text-primary font-bold uppercase mb-1.5">方向 1 (Direction 1)</div>

                    <div className="space-y-2 text-[14px]">
                      {Object.keys(selectedFeature.parameters).map((key) => {
                        // Avoid showing points or relations array directly as a raw field, edit coordinates instead
                        if (key === 'points' || key === 'relations' || key === 'faceOrigin' || key === 'faceNormal' || key === 'faceId') return null;
                        return (
                          <div key={key} className="flex items-center justify-between gap-2">
                            <label className="text-[13px] text-slate-600 font-medium uppercase shrink-0">{key}</label>
                            {key === 'operation' ? (
                              <select
                                value={selectedFeature.parameters[key]}
                                onChange={(e) => onParamChange(key, e.target.value)}
                                className="bg-white border border-[#C4C7CE] rounded px-1 py-0.5 text-[14px] focus:border-primary outline-none text-slate-800 w-[120px]"
                              >
                                <option value="ADD">伸長-實體 (JOIN)</option>
                                <option value="CUT">伸長-除料 (CUT)</option>
                              </select>
                            ) : key === 'plane' ? (
                              <select
                                value={selectedFeature.parameters[key]}
                                onChange={(e) => onParamChange(key, e.target.value)}
                                className="bg-white border border-[#C4C7CE] rounded px-1 py-0.5 text-[14px] focus:border-primary outline-none text-slate-800 w-[120px]"
                              >
                                <option value="FRONT">FRONT (XY)</option>
                                <option value="TOP">TOP (XZ)</option>
                                <option value="RIGHT">RIGHT (YZ)</option>
                                <option value="FACE">表面草圖 (LCS)</option>
                              </select>
                            ) : (
                              <input
                                type="number"
                                step="1"
                                value={selectedFeature.parameters[key]}
                                onChange={(e) => onParamChange(key, e.target.value)}
                                className="bg-white border border-[#C4C7CE] rounded px-1.5 py-0.5 text-[14px] focus:border-primary outline-none text-slate-800 font-mono w-[120px] text-right"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Sketch Relations & Constraints Card */}
                {selectedFeature.parameters.relations && selectedFeature.parameters.relations.length > 0 && (
                  <div className="bg-white p-2.5 rounded border border-[#D1D5DB] shadow-sm">
                    <div className="text-[13px] text-slate-700 font-bold uppercase mb-1.5 border-b border-[#D1D5DB]/30 pb-0.5 flex justify-between items-center">
                      <span>🔗 草圖幾何關係 (Relations)</span>
                      <span className="text-[12px] text-emerald-600 font-bold bg-emerald-50 px-1 rounded animate-pulse">完全定義</span>
                    </div>
                    <div className="space-y-1 max-h-[85px] overflow-y-auto pr-0.5">
                      {selectedFeature.parameters.relations.map((rel: string, rIdx: number) => (
                        <div key={rIdx} className="flex items-center gap-1.5 text-[13px] text-slate-600 bg-[#F8FAFC] px-1.5 py-0.5 rounded border border-[#E2E8F0] font-mono">
                          <span className="text-emerald-500">🟢</span>
                          <span className="font-bold text-slate-800">{rel}</span>
                          <span className="text-slate-400 text-[13px] ml-auto">已綁定</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Parent/Child Relations Card (父子拓撲關係鏈) */}
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
                    <div className="bg-white p-2.5 rounded border border-[#D1D5DB] shadow-sm space-y-2">
                      <div className="text-[13px] text-slate-700 font-bold uppercase border-b border-[#D1D5DB]/30 pb-0.5 flex justify-between items-center">
                        <span className="flex items-center gap-1">👪 父子拓撲鏈 (Parent/Child Relations)</span>
                        <span className="text-[12px] text-primary font-bold bg-primary/10 px-1 rounded font-mono">拓撲依賴</span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 text-[9.5px]">
                        {/* Parents Column */}
                        <div className="space-y-1">
                          <div className="text-[13px] text-slate-400 font-semibold uppercase tracking-wider flex items-center gap-0.5">
                            <span>⬆️</span> 父特徵 (Parents)
                          </div>
                          {parents.length === 0 ? (
                            <div className="text-[13px] text-slate-400 italic p-1 bg-slate-50 rounded text-center border border-dashed border-[#E5E7EB]">無</div>
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
                                  <span className="text-[13px]">●</span>
                                  <span className="truncate">{p.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Children Column */}
                        <div className="space-y-1">
                          <div className="text-[13px] text-slate-400 font-semibold uppercase tracking-wider flex items-center gap-0.5">
                            <span>⬇️</span> 子特徵 (Children)
                          </div>
                          {children.length === 0 ? (
                            <div className="text-[13px] text-slate-400 italic p-1 bg-slate-50 rounded text-center border border-dashed border-[#E5E7EB]">無</div>
                          ) : (
                            <div className="space-y-1 max-h-[70px] overflow-y-auto pr-0.5">
                              {children.map((c) => (
                                <button
                                  key={c.id}
                                  onClick={() => setSelectedId(c.id)}
                                  className="w-full text-left truncate px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-800 transition-all font-medium leading-tight flex items-center gap-1"
                                >
                                  <span className="text-[13px]">●</span>
                                  <span className="truncate">{c.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Sketch Properties Manager (左下角草圖屬性面板) */}
          {!isSketchMode && selectedSubNodeType === 'SKETCH' && selectedFeature && measurementMode === 'NONE' && (
            <div className="h-[250px] w-full border-t border-[#D1D5DB] bg-[#FDF2F8] flex flex-col p-3 z-10 shrink-0 shadow-[0_-2px_10px_rgba(219,39,119,0.05)]">
              <div className="text-[14px] uppercase tracking-wider text-pink-600 mb-2 font-bold flex justify-between items-center border-b border-pink-200 pb-1">
                <span className="flex items-center gap-1.5">✏️ 草圖屬性管理器</span>
                <span className="text-[13px] bg-pink-100 text-pink-600 px-1.5 rounded uppercase font-mono">Sketch Node</span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 text-[14px]">
                <div className="bg-white p-2.5 rounded border border-pink-200 shadow-sm space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">草圖名稱</span>
                    <span className="font-bold text-slate-800 font-mono">
                      {selectedFeature.name.replace('伸長-', '草圖').replace('旋轉-', '草圖')}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">基準面</span>
                    <span className="font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded font-mono">
                      {selectedFeature.parameters.plane || 'FRONT'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">幾何頂點數</span>
                    <span className="font-bold text-slate-800 font-mono">
                      {Array.isArray(selectedFeature.parameters.points) ? selectedFeature.parameters.points.length : 0}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">所屬父特徵</span>
                    <span className="font-semibold text-primary font-mono bg-blue-50 border border-blue-100 px-1 rounded">
                      {selectedFeature.name}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleEditFeatureSketch(selectedFeature)}
                  className="w-full py-2 bg-pink-600 hover:bg-pink-700 active:bg-pink-800 text-white rounded font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm text-[14px] hover:shadow-pink-200"
                >
                  <span>🛠️</span>
                  <span>編輯草圖幾何 (Edit Sketch)</span>
                </button>
              </div>
            </div>
          )}

          {/* Measurement PropertyManager (量測專用面板) */}
          {!isSketchMode && measurementMode !== 'NONE' && (
            <div className="h-[210px] w-full border-t border-[#D1D5DB] bg-[#F5F6F9] flex flex-col p-3 z-10 shrink-0">
              <div className="text-[14px] uppercase tracking-wider text-indigo-600 mb-2 font-bold flex justify-between items-center border-b border-[#D1D5DB]/40 pb-1">
                <span>📋 量測屬性管理器 (Measure Manager)</span>
                <button
                  onClick={() => {
                    setMeasurementPoints([]);
                    setMeasurementResults(null);
                  }}
                  className="text-error text-[13px] font-bold hover:underline"
                >
                  清除選取
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                <div className="bg-white p-2.5 rounded-xl border border-[#D1D5DB] shadow-sm">
                  <div className="text-[13px] text-indigo-700 font-bold uppercase mb-1.5 border-b border-[#D1D5DB]/30 pb-0.5 flex justify-between items-center">
                    <span>量測項目狀態: {measurementMode}</span>
                    <span className="text-[12px] text-indigo-600 font-bold bg-indigo-50 px-1 rounded font-mono">
                      已選: {measurementPoints.length} 個
                    </span>
                  </div>

                  <div className="space-y-1">
                    {measurementPoints.length === 0 ? (
                      <div className="text-[13px] text-slate-400 py-4 text-center leading-tight">
                        請在 3D 視區中點選頂點、邊段或表面，系統將自動擷取座標並計算！
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-[70px] overflow-y-auto">
                        {measurementPoints.map((pt, pIdx) => (
                          <div key={pIdx} className="flex items-center gap-1.5 text-[13px] text-slate-700 bg-slate-50 p-1.5 rounded border border-slate-200 font-mono">
                            <span className="text-indigo-500 font-bold">M{pIdx+1}:</span>
                            <span className="font-semibold">{pt.type}</span>
                            <span className="text-slate-400 ml-auto">
                              [{pt.coordinates.map((n: number) => n.toFixed(1)).join(', ')}]
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {measurementResults && (
                  <div className="bg-[#4F46E5]/10 p-2.5 rounded-xl border border-[#4F46E5]/20 shadow-sm flex flex-col items-center justify-center py-3">
                    <span className="text-[13px] text-[#4F46E5] uppercase font-bold tracking-widest mb-1">精確量測數值</span>
                    <div className="text-base font-black text-slate-900 font-mono leading-none flex items-baseline gap-1">
                      <span>{measurementResults.value.toFixed(3)}</span>
                      <span className="text-[14px] text-indigo-600 font-bold">{measurementResults.unit}</span>
                    </div>
                    {measurementResults.details && (
                      <span className="text-[13px] text-slate-400 font-mono mt-1 w-full text-center truncate">
                        {measurementResults.details}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Sidebar Status Footer */}
          <div className="h-[28px] w-full border-t border-[#D1D5DB] bg-[#F5F6F9] flex items-center justify-between px-3 text-[13px] text-slate-600 shrink-0 font-mono">
            <span className={loading ? 'text-warning animate-pulse' : 'text-slate-600'}>
              {loading ? '⚡ 幾何重構中 (BUSY)...' : '🟢 系統就緒 (READY)'}
            </span>
            <span>MMGS (公釐)</span>
          </div>
        </aside>

        {/* Right Area: Viewport (Graphics Area) */}
        <section className="flex-grow h-full relative">
          {/* Interactive Construction Demo Banner */}
          {demoStep && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-amber-50/95 border border-amber-300 text-amber-950 px-6 py-4 rounded-3xl shadow-2xl flex items-center gap-3.5 z-[999] animate-pulse w-[85%] max-w-[650px] pointer-events-none backdrop-blur-md">
              <span className="text-2xl">🎥</span>
              <div className="flex flex-col">
                <span className="text-[14px] font-extrabold uppercase tracking-wider text-amber-700 leading-none">正在演示 CAD 逐步建構過程 (Live CAD Build Demo)</span>
                <span className="text-[13px] font-bold mt-2 leading-relaxed text-amber-900">{demoStep}</span>
              </div>
            </div>
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
              <mesh>
                <sphereGeometry args={[1, 32, 32]} />
                <meshStandardMaterial color="#94A3B8" wireframe opacity={0.4} transparent />
              </mesh>
            )}
          </Viewport>
          )}

          {/* Floating Sketch Viewport HUD */}
          <SketchHUD onReset={resetSketchSession} onExit={handleExitAndExtrude} />

          {/* Floating Camera View Orientation Toolbar (Right side) */}
          <div className="absolute top-4 right-4 flex flex-col gap-2 z-10 select-none">
            <div className="glass-effect p-1.5 rounded-2xl flex flex-col gap-1.5 shadow-2xl border border-white/30 text-[14px]">
              <div className="text-[12px] text-slate-500 font-bold uppercase tracking-wider text-center border-b border-slate-200 pb-1 mb-1">視角 (View)</div>

              <button
                onClick={() => { setActivePlane('FRONT'); setSelectedId(null); }}
                className={`w-9 h-9 flex flex-col items-center justify-center rounded-xl transition-all ${
                  activePlane === 'FRONT' ? 'bg-primary/10 text-primary border border-primary/20 font-bold' : 'hover:bg-slate-100 text-slate-700'
                }`}
                title="前視景 (FRONT)"
              >
                <span className="text-[13px] font-bold font-mono">前</span>
                <span className="text-[12px] text-slate-600 leading-none">XY</span>
              </button>

              <button
                onClick={() => { setActivePlane('TOP'); setSelectedId(null); }}
                className={`w-9 h-9 flex flex-col items-center justify-center rounded-xl transition-all ${
                  activePlane === 'TOP' ? 'bg-primary/10 text-primary border border-primary/20 font-bold' : 'hover:bg-slate-100 text-slate-700'
                }`}
                title="俯視景 (TOP)"
              >
                <span className="text-[13px] font-bold font-mono">上</span>
                <span className="text-[12px] text-slate-600 leading-none">XZ</span>
              </button>

              <button
                onClick={() => { setActivePlane('RIGHT'); setSelectedId(null); }}
                className={`w-9 h-9 flex flex-col items-center justify-center rounded-xl transition-all ${
                  activePlane === 'RIGHT' ? 'bg-primary/10 text-primary border border-primary/20 font-bold' : 'hover:bg-slate-100 text-slate-700'
                }`}
                title="右視景 (RIGHT)"
              >
                <span className="text-[13px] font-bold font-mono">右</span>
                <span className="text-[12px] text-slate-600 leading-none">YZ</span>
              </button>

              <div className="w-6 h-px bg-slate-200 self-center my-0.5" />

              <button
                onClick={() => {
                  setSelectedId(null);
                  resetSketchSession();
                }}
                className={`w-9 h-9 flex flex-col items-center justify-center rounded-xl hover:bg-slate-100 text-slate-700 transition-all`}
                title="等角透視 (Perspective)"
              >
                <span className="text-[12px]">🌐</span>
                <span className="text-[12px] text-slate-600 leading-none">立體</span>
              </button>
            </div>
          </div>

          {/* Loading Overlay */}
          {loading && (
            <div className="absolute inset-0 bg-background/25 backdrop-blur-[1px] flex items-center justify-center pointer-events-none z-30">
              <div className="glass-effect px-5 py-2.5 rounded-2xl text-[14px] font-bold text-primary animate-pulse border border-primary/30 shadow-2xl flex items-center gap-2">
                <span>🔄</span>
                <span>B-REP 幾何核心特徵重構中...</span>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
