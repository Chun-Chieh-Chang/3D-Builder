'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Viewport from '@/renderer/Viewport';
import OcctShape, { type MeshData } from '@/renderer/OcctShape';
import { useCadStore, type CADFeature } from '@/store/useCadStore';
import { HeavyEngineClient } from '@/kernel/HeavyEngineClient';
import { MeasurementPanel } from '@/ui/MeasurementPanel';
import { InterferencePanel } from '@/ui/InterferencePanel';
import { SketchHUD } from '@/renderer/SketchHUD';
import { fileAPI } from '../../electron/renderer';
import { MatePanel } from '@/ui/MatePanel';
import { AssemblyTreePanel } from '@/ui/AssemblyTreePanel';
import { AssemblyComponent } from '@/renderer/AssemblyComponent';
import { DrawingSheet } from '@/ui/DrawingSheet';
import { SketchPropertyManager } from '@/ui/SketchPropertyManager';
import { analyzeSketchDefinitions } from '@/utils/geometry/ConstraintSolver';
import { HeadsUpToolbar } from '@/ui/HeadsUpToolbar';
import { TopMenu } from '@/ui/TopMenu';
import { RibbonController } from '@/ui/RibbonBar/RibbonController';
import { StatusBar } from '@/ui/StatusBar';
import { ShortcutBox } from '@/ui/ShortcutBox';
import { ContextMenu } from '@/ui/ContextMenu';
import { usePartDocument } from '@/hooks/usePartDocument';
import { usePartRebuild } from '@/hooks/usePartRebuild';
import { FeatureManagerPanel } from '@/ui/FeatureManagerPanel';
import { PartFeaturePropertyManager } from '@/ui/PartFeaturePropertyManager';
import { SectionViewPropertyManager } from '@/ui/SectionViewPropertyManager';
import { useFeatureBuilders } from '@/hooks/useFeatureBuilders';
import { useAppIntegrations } from '@/hooks/useAppIntegrations';
import { MassPropertiesModal } from '@/ui/Modals/MassPropertiesModal';
import { TranslatorModal } from '@/ui/Modals/TranslatorModal';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [engineStatus, setEngineStatus] = useState<'CONNECTED' | 'DISCONNECTED'>('DISCONNECTED');
  const [activeTab, setActiveTab] = useState<'FEATURES' | 'SKETCH' | 'EVALUATE' | 'ASSEMBLY' | 'DRAWING' | 'RENDER'>('FEATURES');
  const [massProps, setMassProps] = useState<{ volume: number; surface_area: number; center_of_mass: number[]; inertia_matrix: number[][]; } | null>(null);
  const [showMassPropsModal, setShowMassPropsModal] = useState(false);
  const [showTranslatorModal, setShowTranslatorModal] = useState(false);

  const client = HeavyEngineClient.getInstance();
  const { 
    features, addFeature, updateFeatureParams, 
    setSelectedId, setMeshData,
    isSketchMode, setSketchMode, setSketchTool,
    activePlane, setActivePlane, setActiveFaceOrigin, setActiveFaceNormal, setActiveFaceId,
    sketchNodes, sketchEdges, sketchConstraints,
    selectedId, selectedSubNodeType, setSelectedSubNodeType,
    visibleSketches, toggleSketchVisibility,
    removeFeature, removeFeatures,
    measurementMode,
    interferenceActive,
    selectedTopology, setSelectedTopology,
    triggerCameraNormal, pendingFeatureCommand, setPendingFeatureCommand,
    defaultFilletRadius, defaultChamferDistance,
    components, meshData,
    rollbackIndex, setRollbackIndex
  } = useCadStore();

  const { handleRebuild, resetRebuildCache, abortRebuild } = usePartRebuild(features, setMeshData, setLoading, setEngineStatus);
  const { loadCadData: loadPartDocument, handleSaveProject } = usePartDocument(features);

  const loadCadData = useCallback(
    async (content: string, filePath: string) => {
      const pathLower = filePath.toLowerCase();
      if (pathLower.endsWith('.sldprt') || pathLower.endsWith('.sldasm')) {
        setShowTranslatorModal(true);
        return;
      }
      resetRebuildCache();
      await loadPartDocument(content, filePath, () => setTimeout(handleRebuild, 50));
    },
    [handleRebuild, loadPartDocument, resetRebuildCache],
  );

  const {
    resetSketchSession,
    handleSaveSketchOnly,
    handleExitAndExtrude,
    handleRevolveFromSketch,
    handleBuildSweepLoft,
    handleConvertEntities,
    handleOffsetEntities,
  } = useFeatureBuilders(handleRebuild);

  const handlePrintToPDF = useCallback(async () => {
    try {
      const result = await fileAPI.printToPdf();
      if (result.success && result.path) (window as any).electronAPI.app.notify('PDF Export', `Success: ${result.path}`);
    } catch (e) { alert('PDF Export failed'); }
  }, []);

  useAppIntegrations(loadCadData, handleSaveProject, handlePrintToPDF);

  const handleImportStep = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const result = await client.uploadStepFile(file);
      if (result?.filepath) {
        addFeature({ id: `dumb_${Date.now()}`, name: file.name, type: 'DUMB_SOLID', parameters: { filepath: result.filepath, x: 0, y: 0, z: 0 } });
        setTimeout(handleRebuild, 50);
      }
    } catch (err) {
      useCadStore.getState().pushToast('Failed to import STEP file.', 'error');
    } finally {
      setLoading(false);
      e.target.value = ''; // Reset input
    }
  };

  // Kernel Heartbeat
  useEffect(() => {
    const check = async () => {
      try {
        const alive = await client.checkHealth();
        setEngineStatus(alive ? 'CONNECTED' : 'DISCONNECTED');
      } catch (e) { setEngineStatus('DISCONNECTED'); }
    };
    const timer = setInterval(check, 3000);
    check();
    return () => clearInterval(timer);
  }, [client]);

  const handleEditFeatureSketch = useCallback((f: CADFeature) => {
    useCadStore.setState({
      editingFeatureId: f.id,
      sketchNodes: f.parameters.sketchNodes || {},
      sketchEdges: f.parameters.sketchEdges || {},
      sketchConstraints: f.parameters.sketchConstraints || {},
      activePlane: f.parameters.plane,
      activeFaceOrigin: f.parameters.plane === 'FACE' ? f.parameters.faceOrigin : null,
      activeFaceNormal: f.parameters.plane === 'FACE' ? f.parameters.faceNormal : null,
      activeFaceId: f.parameters.plane === 'FACE' ? f.parameters.faceId : null,
      isSketchMode: true,
      sketchTool: 'SELECT',
    });
    setActiveTab('SKETCH');
  }, []);

  const handleStartPlaneSketch = useCallback((plane: 'FRONT' | 'TOP' | 'RIGHT') => {
    resetSketchSession();
    setActivePlane(plane);
    setSketchMode(true);
    setSketchTool('SELECT');
    triggerCameraNormal();
  }, [resetSketchSession, setActivePlane, setSketchMode, setSketchTool, triggerCameraNormal]);

  const handlePlaneContextMenu = useCallback((e: React.MouseEvent, plane: string) => {
    useCadStore.setState({ contextMenu: { visible: true, x: e.clientX, y: e.clientY, type: 'BACKGROUND', data: { plane } } });
  }, []);

  const onParamChange = (key: string, value: string) => {
    if (!selectedId) return;
    const stringParams = ['operation', 'plane', 'type', 'target_feature_id', 'pattern_type', 'axis'];
    if (stringParams.includes(key)) {
      updateFeatureParams(selectedId, { [key]: value });
      setTimeout(handleRebuild, 0);
    } else {
      const num = parseFloat(value);
      if (!isNaN(num)) updateFeatureParams(selectedId, { [key]: num });
    }
  };

  const solidSketchPointCount = useMemo(() => Object.keys(sketchNodes).length, [sketchNodes]);
  const hasConflict = useMemo(() => {
    if (!isSketchMode) return false;
    return analyzeSketchDefinitions(sketchNodes, sketchEdges, sketchConstraints).hasConflict;
  }, [isSketchMode, sketchNodes, sketchEdges, sketchConstraints]);

  const selectedFeature = useMemo(() => features.find(f => f.id === selectedId), [features, selectedId]);

  // Assembly Selection Logic
  useEffect(() => {
    const clickedTopo = useCadStore.getState().selectedTopology;
    if (isSketchMode || activeTab !== 'ASSEMBLY' || !clickedTopo) return;
    const prevSelection = useCadStore.getState().mateSelection || [];
    if (prevSelection.some((p: any) => p.id === clickedTopo.id)) {
      setSelectedTopology(null);
      return;
    }
    const nextSelection = prevSelection.length >= 2 ? [{ ...clickedTopo, componentId: clickedTopo.componentId || 'root' }] : [...prevSelection, { ...clickedTopo, componentId: clickedTopo.componentId || 'root' }];
    useCadStore.setState({ mateSelection: nextSelection });
    setSelectedTopology(null);
  }, [activeTab, isSketchMode, setSelectedTopology]);

  // Fillet/Chamfer Picker Logic
  useEffect(() => {
    const cmd = pendingFeatureCommand;
    const topo = selectedTopology;
    if (isSketchMode || !cmd || !topo || topo.type !== 'EDGE') return;
    const start = topo.edgeData?.start;
    const end = topo.edgeData?.end;
    if (!start || !end) return;

    const featureId = `feat_${Date.now()}`;
    if (cmd === 'FILLET') {
      addFeature({ id: featureId, type: 'FILLET', name: `Fillet ${features.length + 1}`, parameters: { radius: defaultFilletRadius, edge_start: start, edge_end: end, signature: topo.signature, operation: 'ADD' } });
    } else {
      addFeature({ id: featureId, type: 'CHAMFER', name: `Chamfer ${features.length + 1}`, parameters: { distance: defaultChamferDistance, edge_start: start, edge_end: end, signature: topo.signature, operation: 'ADD' } });
    }
    setPendingFeatureCommand(null);
    setSelectedTopology(null);
    setSelectedId(featureId);
    setTimeout(handleRebuild, 50);
  }, [pendingFeatureCommand, selectedTopology, isSketchMode, features.length, defaultFilletRadius, defaultChamferDistance, addFeature, setPendingFeatureCommand, setSelectedTopology, setSelectedId, handleRebuild]);

  // Pattern/Mirror Selection Picker Logic
  useEffect(() => {
    const topo = selectedTopology;
    if (isSketchMode || !selectedId || !topo) return;

    const feat = features.find(f => f.id === selectedId);
    if (!feat) return;

    if (feat.type === 'PATTERN' && topo.type === 'EDGE') {
      const edgeRef = { id: topo.id, type: 'EDGE', coordinates: topo.edgeData?.start, end_coordinates: topo.edgeData?.end, signature: topo.signature };
      updateFeatureParams(selectedId, { direction_refs: [edgeRef] });
      setSelectedTopology(null);
      setTimeout(handleRebuild, 50);
    } 
    else if (feat.type === 'MIRROR' && (topo.type === 'FACE' || topo.type === 'PLANE')) {
      const planeRef = { id: topo.id, type: topo.type, coordinates: topo.coordinates, normal: topo.normal, signature: topo.signature };
      updateFeatureParams(selectedId, { mirror_plane_refs: [planeRef] });
      setSelectedTopology(null);
      setTimeout(handleRebuild, 50);
    }
  }, [selectedTopology, isSketchMode, selectedId, features, updateFeatureParams, setSelectedTopology, handleRebuild]);

  // Window Callbacks for Shortcuts
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__handleRebuild = handleRebuild;
      (window as any).__handleExtrude = handleExitAndExtrude;
      (window as any).__handleRevolve = handleRevolveFromSketch;
      (window as any).__resetSketchSession = resetSketchSession;
      (window as any).__handleSaveSketchOnly = handleSaveSketchOnly;
      (window as any).__handleConvertEntities = handleConvertEntities;
      (window as any).__handleOffsetEntities = handleOffsetEntities;
    }
  }, [handleRebuild, handleExitAndExtrude, handleRevolveFromSketch, resetSketchSession, handleSaveSketchOnly, handleConvertEntities, handleOffsetEntities]);

  return (
    <main className="flex flex-col h-screen w-screen overflow-hidden bg-background text-primary-text font-sans">
      <TopMenu engineStatus={engineStatus} />
      
      <RibbonController
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        engineStatus={engineStatus}
        solidSketchPointCount={solidSketchPointCount}
        handleExitAndExtrude={handleExitAndExtrude}
        handleRevolveFromSketch={handleRevolveFromSketch}
        handleImportStep={handleImportStep}
      />

      {engineStatus === 'DISCONNECTED' && (
        <div className="bg-red-600 text-white text-[11px] font-black py-1 px-4 flex items-center justify-center gap-4 animate-pulse z-[100]">
          <span>⚠️ GEOMETRY KERNEL OFFLINE</span>
          <button onClick={() => HeavyEngineClient.getInstance().checkHealth().then(a => setEngineStatus(a?'CONNECTED':'DISCONNECTED'))} className="px-2 py-0.5 bg-white text-red-600 rounded text-[9px] font-black hover:bg-slate-100">RETRY</button>
        </div>
      )}

      <div className="flex-1 flex w-full overflow-hidden relative">
        <aside className="w-[300px] h-full bg-[#F5F6F9] border-r border-slate-300 flex flex-col z-10 shrink-0">
          <div className="h-[32px] w-full bg-[#E8E8E8] flex items-center border-b border-slate-300">
            {["Tree", "Properties", "Configs"].map((tab, idx) => (
              <div key={tab} className={`flex-1 h-full flex items-center justify-center text-[10px] font-bold uppercase tracking-tighter cursor-pointer border-r border-slate-300 ${idx === (isSketchMode ? 1 : 0) ? 'bg-white text-[#005B9A] border-b-2 border-b-[#005B9A]' : 'text-slate-500 hover:bg-slate-100'}`}>
                {tab}
              </div>
            ))}
          </div>
          <div className="flex-grow flex flex-col overflow-hidden">
            {isSketchMode ? (
              <div className="flex-grow flex flex-col overflow-hidden"><SketchPropertyManager /></div>
            ) : activeTab === 'ASSEMBLY' ? (
              <div className="flex-1 flex flex-col p-2 gap-2 bg-[#F8FAFC]"><AssemblyTreePanel /><MatePanel /></div>
            ) : measurementMode !== 'NONE' ? (
              <MeasurementPanel />
            ) : interferenceActive ? (
              <InterferencePanel />
            ) : (
              <FeatureManagerPanel
                features={features}
                rollbackIndex={rollbackIndex}
                setRollbackIndex={setRollbackIndex}
                activePlane={activePlane}
                setActivePlane={setActivePlane}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                selectedSubNodeType={selectedSubNodeType}
                setSelectedSubNodeType={setSelectedSubNodeType}
                editingFeatureId={useCadStore.getState().editingFeatureId}
                visibleSketches={visibleSketches}
                toggleSketchVisibility={toggleSketchVisibility}
                removeFeature={removeFeature}
                removeFeatures={removeFeatures}
                onRebuild={handleRebuild}
                onEditFeatureSketch={handleEditFeatureSketch}
                onStartPlaneSketch={handleStartPlaneSketch}
                onPlaneContextMenu={handlePlaneContextMenu}
              />
            )}

            <SectionViewPropertyManager />

            {!isSketchMode && selectedFeature && selectedSubNodeType !== 'SKETCH' && measurementMode === 'NONE' && (!selectedTopology || selectedTopology.type !== 'FACE') && (
              <PartFeaturePropertyManager
                selectedFeature={selectedFeature}
                features={features}
                onParamChange={onParamChange}
                onEditSketch={handleEditFeatureSketch}
                onSelectFeature={setSelectedId}
                onBuildSweepLoft={handleBuildSweepLoft}
              />
            )}
          </div>
        </aside>

        <section className="flex-grow h-full relative" onContextMenu={(e) => e.preventDefault()}>
          <HeadsUpToolbar /> <ShortcutBox /> <ContextMenu />

          {isSketchMode && hasConflict && (
            <div className="absolute top-24 left-1/2 -translate-x-1/2 bg-red-500/90 border border-red-400 text-white px-5 py-3 rounded-full shadow-sm flex items-center gap-2.5 z-[999] w-[85%] max-w-[500px] pointer-events-none backdrop-blur-md">
              <div className="flex flex-col"><span className="text-[12px] font-extrabold uppercase tracking-wider leading-none">Over-Constrained Conflict</span></div>
            </div>
          )}

          {activeTab === 'DRAWING' ? <DrawingSheet /> : (
            <Viewport>
              {activeTab === 'ASSEMBLY' ? components.map(comp => (
                <AssemblyComponent key={comp.id} comp={comp} meshes={meshData} isActive={useCadStore.getState().activeComponentId === comp.id} />
              )) : meshData.map((mesh: { data: MeshData }, idx: number) => (
                <OcctShape key={idx} data={mesh.data} />
              ))}
            </Viewport>
          )}

          <SketchHUD onReset={resetSketchSession} onExit={handleExitAndExtrude} />

          {loading && (
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[1000] p-4">
              <div className="w-[380px] bg-slate-900/90 border border-slate-700/60 rounded-2xl p-6 shadow-2xl flex flex-col gap-4 text-slate-100 items-center">
                <div className="w-10 h-10 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
                <span className="text-[14px] font-bold text-slate-200 tracking-wide">Rebuilding Geometry...</span>
                <button onClick={abortRebuild} className="w-full py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 rounded font-bold transition-all text-[13px]">Abort</button>
              </div>
            </div>
          )}

          {showMassPropsModal && massProps && <MassPropertiesModal massProps={massProps} onClose={() => setShowMassPropsModal(false)} />}
          {showTranslatorModal && <TranslatorModal onClose={() => setShowTranslatorModal(false)} onOpenAlternative={async () => { setShowTranslatorModal(false); const r = await fileAPI.open(); if(r) { const res = await fileAPI.read(r.path); if(res.success && res.content) loadCadData(res.content, r.path); } }} />}
        </section>
      </div>
      <StatusBar />
    </main>
  );
}
