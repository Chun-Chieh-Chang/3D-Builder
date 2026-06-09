'use client';

import React from 'react';
import { useCadStore, RibbonLayout, DEFAULT_RIBBON_LAYOUT } from '../../store/useCadStore';
import { v4 as uuidv4 } from 'uuid';
import { extractAllClosedLoops } from '../../utils/geometry/GraphAdapter';
import { CustomizeRibbonModal } from '../Modals/CustomizeRibbonModal';

interface RibbonControllerProps {
  activeTab: 'FEATURES' | 'SKETCH' | 'EVALUATE' | 'ASSEMBLY' | 'DRAWING' | 'RENDER' | 'SURFACING';
  setActiveTab: (tab: any) => void;
  engineStatus: 'CONNECTED' | 'DISCONNECTED';
  solidSketchPointCount: number;
  handleExitAndExtrude: (op?: any) => void;
  handleRevolveFromSketch: (op?: any) => void;
  handleImportStep: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onShowMassProps?: () => void;
  onShowEquations?: () => void;
}

export const RibbonController: React.FC<RibbonControllerProps> = ({
  activeTab,
  setActiveTab,
  engineStatus,
  solidSketchPointCount,
  handleExitAndExtrude,
  handleRevolveFromSketch,
  handleImportStep,
  onShowMassProps,
  onShowEquations,
}) => {
  const {
    features,
    isSketchMode,
    setSketchMode,
    sketchTool,
    setSketchTool,
    setEditingFeatureId,
    setActivePlane,
    activePlane,
    triggerCameraNormal,
    selectedTopology,
    setSelectedTopology,
    setActiveFaceOrigin,
    setActiveFaceNormal,
    setActiveFaceId,
    setMeasurementMode,
    setMeasurementPoints,
    setMeasurementResults,
    measurementMode,
    interferenceActive,
    setInterferenceActive,
    setHint,
    pendingFeatureCommand,
    setPendingFeatureCommand,
    sketchNodes,
    sketchEdges,
    addFeature,
    setSelectedId,
    setSelectedSubNodeType,
    pushToast,
    components,
    viewportDisplayMode,
    setViewportDisplayMode,
    explodedView,
    setExplodedView,
    calculateAutoExplosion,
    partMaterial,
    setPartMaterial,
    environmentMap,
    setEnvironmentMap,
    ribbonLayout,
    setRibbonLayout,
  } = useCadStore();

  const [isCustomizeMode, setIsCustomizeMode] = React.useState(false);
  const [showAddModal, setShowAddModal] = React.useState(false);

  const ALL_RIBBON_BUTTONS: Record<string, any> = {
    EXTRUDE: {
      id: 'EXTRUDE',
      label: 'Extrude',
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
      action: () => handleExitAndExtrude()
    },
    REVOLVE: {
      id: 'REVOLVE',
      label: 'Revolve',
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><polyline points="21 3 21 8 16 8"/></svg>,
      action: () => {
        const loops = extractAllClosedLoops(sketchNodes, sketchEdges);
        if (isSketchMode && loops.length > 0 && loops[0].length >= 3) {
          handleRevolveFromSketch();
        } else {
          setSketchMode(true);
          setSketchTool('SELECT');
          pushToast('Select profile for Revolve', 'info');
        }
      }
    },
    EXTRUDE_CUT: {
      id: 'EXTRUDE_CUT',
      label: 'Cut',
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M12 22V12"/><path d="M3 8l9 4 9-4"/></svg>,
      action: () => handleExitAndExtrude('CUT')
    },
    REVOLVED_CUT: {
      id: 'REVOLVED_CUT',
      label: 'Rev Cut',
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><polyline points="21 3 21 8 16 8"/><line x1="12" y1="12" x2="12" y2="21"/></svg>,
      action: () => {
        const loops = extractAllClosedLoops(sketchNodes, sketchEdges);
        if (isSketchMode && loops.length > 0 && loops[0].length >= 3) {
          handleRevolveFromSketch('CUT');
        } else {
          setSketchMode(true);
          setSketchTool('SELECT');
          pushToast('Select profile for Revolve Cut', 'info');
        }
      }
    },
    SWEEP: { id: 'SWEEP', label: 'Sweep', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 22C4 13 14 13 14 4"/><circle cx="14" cy="4" r="2"/><circle cx="4" cy="22" r="2"/></svg>, action: () => addFeature({ id: `feat_${uuidv4()}`, type: 'SWEEP', name: `Sweep ${features.length+1}`, parameters: { profile_id: '', path_id: '' }}) },
    LOFT: { id: 'LOFT', label: 'Loft', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 20h16"/><path d="M6 12h12"/><path d="M8 4h8"/><path d="M4 20L8 4"/><path d="M20 20L16 4"/></svg>, action: () => addFeature({ id: `feat_${uuidv4()}`, type: 'LOFT', name: `Loft ${features.length+1}`, parameters: { profile_ids: [] }}) },
    FILLET: { id: 'FILLET', label: 'Fillet', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 2a7 7 0 0 1 7 7"/></svg>, action: () => setPendingFeatureCommand('FILLET') },
    CHAMFER: { id: 'CHAMFER', label: 'Chamfer', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="2" x2="19" y2="9"/></svg>, action: () => setPendingFeatureCommand('CHAMFER') },
    SHELL: { id: 'SHELL', label: 'Shell', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M7 7h10v10H7z"/></svg>, action: () => setPendingFeatureCommand('SHELL') },
    DOME: { id: 'DOME', label: 'Dome', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2C6.48 2 2 6.48 2 12h20c0-5.52-4.48-10-10-10z"/></svg>, action: () => setPendingFeatureCommand('DOME') },
    DRAFT: { id: 'DRAFT', label: 'Draft', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>, action: () => setPendingFeatureCommand('DRAFT') },
    HOLE_WIZARD: { id: 'HOLE_WIZARD', label: 'Hole', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>, action: () => setPendingFeatureCommand('HOLE_WIZARD') },
    REFERENCE_PLANE: { id: 'REFERENCE_PLANE', label: 'Plane', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>, action: () => addFeature({ id: `feat_${uuidv4()}`, type: 'REFERENCE_PLANE', name: `Plane ${features.length+1}`, parameters: { planeType: 'OFFSET', offset: 10, refs: [], flip: false }}) },
    REFERENCE_AXIS: { id: 'REFERENCE_AXIS', label: 'Axis', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="2" x2="12" y2="22"/><polyline points="5 12 12 12 19 12"/></svg>, action: () => addFeature({ id: `feat_${uuidv4()}`, type: 'REFERENCE_AXIS', name: `Axis ${features.length+1}`, parameters: { axisType: 'TWO_POINTS', refs: [] }}) },
    REFERENCE_POINT: { id: 'REFERENCE_POINT', label: 'Point', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>, action: () => addFeature({ id: `feat_${uuidv4()}`, type: 'REFERENCE_POINT', name: `Point ${features.length+1}`, parameters: { pointType: 'FACE_CENTER', refs: [] }}) },

    LINE: { id: 'LINE', label: 'Line', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="19" x2="19" y2="5"/><circle cx="5" cy="19" r="1.5"/><circle cx="19" cy="5" r="1.5"/></svg>, action: () => setSketchTool('LINE') },
    CIRCLE: { id: 'CIRCLE', label: 'Circle', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="9"/></svg>, action: () => setSketchTool('CIRCLE') },
    ARC: { id: 'ARC', label: 'Arc', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 12a8 8 0 0 0-16 0"/><path d="M4 12v4"/><path d="M20 12v4"/></svg>, action: () => setSketchTool('ARC') },
    RECTANGLE: { id: 'RECTANGLE', label: 'Rect', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>, action: () => setSketchTool('RECTANGLE') },
    SMART_DIMENSION: { id: 'SMART_DIMENSION', label: 'Smart Dim', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m18 8 3 3-3 3"/><path d="m6 8-3 3 3 3"/><path d="M2 11h20"/></svg>, action: () => useCadStore.setState(s => ({ smartDimensionActive: !s.smartDimensionActive })) },
    TRIM: { id: 'TRIM', label: 'Trim', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m17 17-5-5-5 5"/><path d="m14.5 10.5-2.5 2.5-2.5-2.5"/></svg>, action: () => setSketchTool('TRIM') },
    TEXT: { id: 'TEXT', label: 'Text', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>, action: () => setSketchTool('TEXT') },
    
    MEASURE: { id: 'MEASURE', label: 'Measure', icon: '📏', action: () => setMeasurementMode('DISTANCE') },
    MASS_PROPS: { id: 'MASS_PROPS', label: 'Mass', icon: '⚖️', action: onShowMassProps },
    INTERFERENCE: { id: 'INTERFERENCE', label: 'Interfere', icon: '💥', action: () => setInterferenceActive(!interferenceActive) },
    SECTION_VIEW: { id: 'SECTION_VIEW', label: 'Section', icon: '🔪', action: () => { const curr = useCadStore.getState().sectionView.isActive; useCadStore.getState().setSectionView({ isActive: !curr }); } },
    EQUATIONS: { id: 'EQUATIONS', label: 'Eqs', icon: '∑', action: onShowEquations },
  };

  const renderButtons = (tab: keyof RibbonLayout) => {
    return (ribbonLayout[tab] || []).map(id => {
      const btn = ALL_RIBBON_BUTTONS[id];
      if (!btn) return null;
      const isActive = (tab === 'SKETCH' && sketchTool === id) || (tab === 'FEATURES' && pendingFeatureCommand === id);
      
      return (
        <button 
          key={id}
          onClick={btn.action}
          className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[70px] transition-all border ${isActive ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group relative`}
        >
          <div className={`w-10 h-10 flex items-center justify-center transition-transform ${isActive ? 'text-[#005B9A] scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
            {typeof btn.icon === 'string' ? <span className="text-2xl font-black">{btn.icon}</span> : btn.icon}
          </div>
          <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">{btn.label}</span>
          {isCustomizeMode && (
            <div 
              className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] font-bold cursor-pointer shadow-sm hover:bg-red-600 transition-colors z-30"
              onClick={(e) => {
                e.stopPropagation();
                const next = { ...ribbonLayout };
                next[tab] = next[tab].filter(btnId => btnId !== id);
                setRibbonLayout(next);
              }}
            >×</div>
          )}
        </button>
      );
    });
  };

  const appliedEdgeFeatureRef = React.useRef<string | null>(null);

  return (
    <div className="h-[110px] w-full bg-[#E8E8E8] border-b border-[#A0A0A0] flex flex-col z-20 shrink-0 select-none">
      {/* Ribbon Tabs */}
      <div className="flex px-2 border-b border-[#A0A0A0] bg-[#D6DADC]">
        {['FEATURES', 'SURFACES', 'SKETCH', 'EVALUATE', 'ASSEMBLY', 'RENDER'].map(tab => (
          <button
            key={tab}
            onClick={() => { 
              if (tab === 'ASSEMBLY' || tab === 'RENDER') useCadStore.getState().setMode(tab as any);
              setActiveTab(tab as any); 
            }}
            className={`px-6 py-1.5 text-[11px] font-black transition-all border-b-[3px] uppercase ${activeTab === tab ? "border-[#005B9A] text-[#005B9A] bg-white shadow-sm" : "border-transparent text-slate-600 hover:bg-white/50"}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Ribbon Content Panels */}
      <div 
        className="flex-1 flex items-center px-6 py-2 gap-2 overflow-x-auto overflow-y-hidden bg-surface relative group/ribbon"
        onContextMenu={(e) => {
          e.preventDefault();
          setIsCustomizeMode(!isCustomizeMode);
          if (!isCustomizeMode) pushToast('UI Customize Mode: ON. Click × to remove, Click + to add.', 'info');
        }}
      > 
        {/* Dynamic Buttons based on Layout */}
        <div className="flex items-center gap-1 h-full animate-in fade-in slide-in-from-left-2 duration-300">
          {(activeTab === 'FEATURES' || activeTab === 'SKETCH' || activeTab === 'EVALUATE') ? (
            <>
              {renderButtons(activeTab as keyof RibbonLayout)}
              {isCustomizeMode && (
                 <button 
                  onClick={() => setShowAddModal(true)} 
                  className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[70px] border border-dashed border-slate-400 rounded hover:bg-white transition-all text-slate-400 group"
                >
                  <span className="text-xl font-black transition-transform group-hover:scale-125">+</span>
                  <span className="text-[9px] font-bold">ADD</span>
                </button>
              )}
            </>
          ) : (
            <div className="text-slate-400 text-[10px] font-bold uppercase italic px-4">Static Tab Content</div>
          )}
        </div>
      </div>

      {showAddModal && (
        <CustomizeRibbonModal 
          tab={activeTab as any} 
          onClose={() => setShowAddModal(false)} 
        />
      )}
    </div>
  );
};
