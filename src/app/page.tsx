'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Viewport from '@/renderer/Viewport';
import OcctShape, { type MeshData } from '@/renderer/OcctShape';
import { useCadStore, type CADFeature } from '@/store/useCadStore';
import { v4 as uuidv4 } from 'uuid';
import { HeavyEngineClient } from '@/kernel/HeavyEngineClient';
import { MeasurementPanel } from '@/ui/MeasurementPanel';
import { InterferencePanel } from '@/ui/InterferencePanel';
import { SketchHUD } from '@/renderer/SketchHUD';
import { fileAPI } from '../../electron/renderer';
import { MatePanel } from '@/ui/MatePanel';
import { AssemblyTreePanel } from '@/ui/AssemblyTreePanel';
import { MotionStudyPanel } from '@/ui/MotionStudyPanel';
import { AssemblyComponent } from '@/renderer/AssemblyComponent';
import { MassPropertiesSymbol } from '@/renderer/MassPropertiesSymbol';
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
import { useSelectionLogic } from '@/hooks/useSelectionLogic';
import { useFeatureBuilders } from '@/hooks/useFeatureBuilders';
import { useAppIntegrations } from '@/hooks/useAppIntegrations';
import { MassPropertiesModal } from '@/ui/Modals/MassPropertiesModal';
import { TranslatorModal } from '@/ui/Modals/TranslatorModal';
import { ExportModal } from '@/ui/Modals/ExportModal';
import { ConfigurationManagerPanel } from '@/ui/ConfigurationManagerPanel';
import { EquationsModal } from '@/ui/Modals/EquationsModal';
import { DesignLibraryPanel } from '@/ui/DesignLibraryPanel';
import { MaterialSelectorModal } from '@/ui/Modals/MaterialSelectorModal';
import { RobotHUD } from '@/ui/RobotHUD';
import { RobotOperationService } from '@/ui/RobotOperationService';
import { useAutoSave } from '@/hooks/useAutoSave';
import { RecoveryDialog } from '@/ui/Modals/RecoveryDialog';

export default function Home() {
  useAutoSave();
  const [loading, setLoading] = useState(false);
  const [engineStatus, setEngineStatus] = useState<'CONNECTED' | 'DISCONNECTED'>('DISCONNECTED');
  const [sidebarTab, setSidebarTab] = useState<'TREE' | 'PROPERTIES' | 'CONFIGS'>('TREE');
  const [taskPaneTab, setTaskPaneTab] = useState<'LIBRARY' | 'NONE'>('LIBRARY');
  const [showMassPropsModal, setShowMassPropsModal] = useState(false);
  const [showTranslatorModal, setShowTranslatorModal] = useState(false);
  const [showEquationsModal, setShowEquationsModal] = useState(false);

  const client = HeavyEngineClient.getInstance();
  const { 
    features, addFeature, updateFeatureParams, 
    setSelectedId, setMeshData,
    isSketchMode, setSketchMode, setSketchTool,
    activePlane, setActivePlane, setActiveFaceOrigin, setActiveFaceNormal, setActiveFaceId,
    activeTab, setActiveTab,
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
    rollbackIndex, setRollbackIndex,
    massProperties, setMassProperties,
    showExportModal, setShowExportModal,
    hint: _hint,
    setHint,
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
        addFeature({ id: `dumb_${uuidv4()}`, name: file.name, type: 'DUMB_SOLID', parameters: { filepath: result.filepath, x: 0, y: 0, z: 0 } });
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

  // ── Selection / UI logic hooks ────────────────────────────
  useSelectionLogic({
    activeTab, isSketchMode, setSelectedTopology,
    selectedTopology, pendingFeatureCommand,
    selectedId, features, addFeature, updateFeatureParams,
    setPendingFeatureCommand, setSelectedId, handleRebuild,
    defaultFilletRadius, defaultChamferDistance, setHint,
  });

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
      (window as any).__handlePrintToPDF = handlePrintToPDF;
      (window as any).__handleEditFeatureSketch = handleEditFeatureSketch;
    }
  }, [handleRebuild, handleExitAndExtrude, handleRevolveFromSketch, resetSketchSession, handleSaveSketchOnly, handleConvertEntities, handleOffsetEntities, handlePrintToPDF, handleEditFeatureSketch]);

  return (
    <main className="flex flex-col h-screen w-screen overflow-hidden bg-background text-primary-text font-sans">
      <TopMenu engineStatus={engineStatus} onExport={() => setShowExportModal(true)} />
      
      <RibbonController
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        engineStatus={engineStatus}
        solidSketchPointCount={solidSketchPointCount}
        handleExitAndExtrude={handleExitAndExtrude}
        handleRevolveFromSketch={handleRevolveFromSketch}
        handleImportStep={handleImportStep}
        onShowMassProps={() => setShowMassPropsModal(true)}
        onShowEquations={() => setShowEquationsModal(true)}
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
            {["Tree", "Properties", "Configs"].map((tab, idx) => {
              const tabId = (['TREE', 'PROPERTIES', 'CONFIGS'] as const)[idx];
              const isActive = sidebarTab === tabId;
              return (
                <div 
                  key={tab} 
                  onClick={() => setSidebarTab(tabId)}
                  className={`flex-1 h-full flex items-center justify-center text-[10px] font-bold uppercase tracking-tighter cursor-pointer border-r border-slate-300 ${isActive ? 'bg-white text-[#005B9A] border-b-2 border-b-[#005B9A]' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                  {tab}
                </div>
              );
            })}
          </div>
          <div className="flex-grow flex flex-col overflow-hidden">
            {sidebarTab === 'CONFIGS' ? (
              <ConfigurationManagerPanel />
            ) : isSketchMode || sidebarTab === 'PROPERTIES' ? (
              <div className="flex-grow flex flex-col overflow-hidden">
                {isSketchMode ? <SketchPropertyManager /> : (
                  selectedFeature ? (
                    <PartFeaturePropertyManager
                      selectedFeature={selectedFeature}
                      features={features}
                      onParamChange={onParamChange}
                      onEditSketch={handleEditFeatureSketch}
                      onSelectFeature={setSelectedId}
                      onBuildSweepLoft={handleBuildSweepLoft}
                    />
                  ) : <div className="p-10 text-center text-slate-400 italic text-[11px]">No feature selected</div>
                )}
              </div>
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
              {activeTab === 'ASSEMBLY' ? (
                (useCadStore.getState().assemblyPreviewComponents || components).map(comp => (
                  <AssemblyComponent key={comp.id} comp={comp} meshes={meshData} isActive={useCadStore.getState().activeComponentId === comp.id} />
                ))
              ) : meshData.map((mesh: { data: MeshData }, idx: number) => (
                <OcctShape key={idx} data={mesh.data} />
              ))}
              <MassPropertiesSymbol />
            </Viewport>
          )}

          {activeTab === 'ASSEMBLY' && <MotionStudyPanel />}

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

          {showMassPropsModal && massProperties && <MassPropertiesModal massProps={massProperties} onClose={() => setShowMassPropsModal(false)} />}
          {showEquationsModal && <EquationsModal onClose={() => setShowEquationsModal(false)} />}
          {showTranslatorModal && <TranslatorModal onClose={() => setShowTranslatorModal(false)} onOpenAlternative={async () => { setShowTranslatorModal(false); const r = await fileAPI.open(); if(r) { const res = await fileAPI.read(r.path); if(res.success && res.content) loadCadData(res.content, r.path); } }} />}
          {showExportModal && <ExportModal onClose={() => setShowExportModal(false)} activeTab={activeTab} />}
          <RecoveryDialog />
        </section>

        {/* Right Task Pane (Design Library) */}
        {taskPaneTab !== 'NONE' && (
          <aside className="w-[280px] h-full bg-[#F5F6F9] border-l border-slate-300 flex flex-col z-10 shrink-0 animate-in slide-in-from-right duration-300">
            <div className="h-[32px] w-full bg-[#E8E8E8] flex items-center border-b border-slate-300">
               <div className="flex-1 h-full flex items-center justify-center text-[10px] font-bold uppercase tracking-tighter bg-white text-[#005B9A] border-b-2 border-b-[#005B9A]">
                 Library
               </div>
               <button 
                 onClick={() => setTaskPaneTab('NONE')}
                 className="px-2 text-slate-400 hover:text-slate-600"
               >✕</button>
            </div>
            <DesignLibraryPanel />
          </aside>
        )}

        {/* Task Pane Toggle handle if closed */}
        {taskPaneTab === 'NONE' && (
          <div 
            onClick={() => setTaskPaneTab('LIBRARY')}
            className="absolute right-0 top-1/2 -translate-y-1/2 w-6 h-24 bg-white border-l border-y border-slate-300 rounded-l-md shadow-md cursor-pointer flex items-center justify-center text-slate-400 hover:text-primary transition-all z-20 hover:w-8 group"
          >
            <span className="rotate-90 font-black text-[10px] whitespace-nowrap tracking-widest group-hover:text-primary transition-colors">TASK PANE</span>
          </div>
        )}
      </div>
      <StatusBar />
      <MaterialSelectorModal />
      <RobotHUD />
    </main>
  );
}
