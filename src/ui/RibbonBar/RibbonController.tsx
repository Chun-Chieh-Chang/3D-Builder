'use client';

import React from 'react';
import { useCadStore } from '../../store/useCadStore';
import { v4 as uuidv4 } from 'uuid';
import { extractAllClosedLoops } from '../../utils/geometry/GraphAdapter';

interface RibbonControllerProps {
  activeTab: 'FEATURES' | 'SKETCH' | 'EVALUATE' | 'ASSEMBLY' | 'DRAWING' | 'RENDER' | 'SURFACING';
  setActiveTab: (tab: any) => void;
  engineStatus: 'CONNECTED' | 'DISCONNECTED';
  solidSketchPointCount: number;
  handleExitAndExtrude: (op?: any) => void;
  handleRevolveFromSketch: (op?: 'ADD' | 'CUT') => void;
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
  } = useCadStore();

  const appliedEdgeFeatureRef = React.useRef<string | null>(null);

  return (
    <div className="h-[110px] w-full bg-[#E8E8E8] border-b border-[#A0A0A0] flex flex-col z-20 shrink-0 select-none">
      {/* Ribbon Tabs */}
      <div className="flex px-2 border-b border-[#A0A0A0] bg-[#D6DADC]">
        <button
          onClick={() => { setActiveTab('FEATURES'); setMeasurementMode('NONE'); setMeasurementPoints([]); setMeasurementResults(null); } }
          className={`px-6 py-1.5 text-[11px] font-black transition-all border-b-[3px] uppercase ${activeTab === "FEATURES" ? "border-[#005B9A] text-[#005B9A] bg-white shadow-sm" : "border-transparent text-slate-600 hover:bg-white/50"}` }
        >FEATURES</button>
        <button
          onClick={() => { setActiveTab('SURFACING'); setMeasurementMode('NONE'); } }
          className={`px-6 py-1.5 text-[11px] font-black transition-all border-b-[3px] uppercase ${activeTab === "SURFACING" ? "border-orange-500 text-orange-600 bg-white shadow-sm" : "border-transparent text-slate-600 hover:bg-white/50"}` }
        >SURFACES</button>
        <button
          onClick={() => {
            setActiveTab('SKETCH'); 
            setMeasurementMode('NONE'); 
            setMeasurementPoints([]); 
            setMeasurementResults(null);
            
            if (!isSketchMode) { 
              setEditingFeatureId(null); 
              if (selectedTopology?.type === 'FACE' && selectedTopology.coordinates && selectedTopology.normal) {
                setActiveFaceOrigin(selectedTopology.coordinates); 
                setActiveFaceNormal(selectedTopology.normal);
                setActiveFaceId(selectedTopology.id || `face_${uuidv4()}`); 
                setActivePlane('FACE'); 
                triggerCameraNormal();
              } 
              else if (activePlane) {
                triggerCameraNormal();
              }
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
        <button
          onClick={() => { setActiveTab('ASSEMBLY'); setMeasurementMode('NONE'); useCadStore.getState().setMode('ASSEMBLY'); } }
          className={`px-6 py-1.5 text-[11px] font-black transition-all border-b-[3px] uppercase ${activeTab === "ASSEMBLY" ? "border-[#005B9A] text-[#005B9A] bg-white shadow-sm" : "border-transparent text-slate-600 hover:bg-white/50"}` }
        >ASSEMBLY</button>
        <button
          onClick={() => { setActiveTab('RENDER'); setMeasurementMode('NONE'); useCadStore.getState().setMode('RENDER'); } }
          className={`px-6 py-1.5 text-[11px] font-black transition-all border-b-[3px] uppercase ${activeTab === "RENDER" ? "border-[#005B9A] text-[#005B9A] bg-white shadow-sm" : "border-transparent text-slate-600 hover:bg-white/50"}` }
        >RENDER</button>
      </div>

      {/* Ribbon Content Panels */}
      <div className="flex-1 flex items-center px-6 py-2 gap-2 overflow-x-auto overflow-y-hidden bg-surface"> 
        {activeTab === 'FEATURES' ? (
          <div className="flex items-center gap-2 h-full animate-in fade-in slide-in-from-left-2 duration-300">
            <input 
              type="file" 
              accept=".step,.stp,.iges,.igs" 
              className="hidden" 
              ref={(ref) => { (window as any)._fileInputRef = ref; }}
              onChange={handleImportStep} 
            />
            <button onClick={() => (window as any)._fileInputRef?.click()} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Import STEP">
              <div className="w-10 h-10 flex items-center justify-center text-[#005B9A] transition-transform group-hover:scale-110">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Import</span>
            </button>
            <div className="w-[1px] h-10 bg-border/50 mx-1" />
            <button onClick={() => { 
              if (solidSketchPointCount >= 3) {
                handleExitAndExtrude();
              } else { 
                setSketchMode(true); 
                setSketchTool('SELECT'); 
                if (solidSketchPointCount > 0) pushToast('點數不足：拉伸至少需要 3 個草圖點。', 'info');
              } 
            }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Extruded Boss/Base">
              <div className="w-10 h-10 flex items-center justify-center text-[#005B9A] transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Extrude</span>
            </button>
            <button onClick={() => {
              if (solidSketchPointCount >= 2) {
                handleExitAndExtrude('CUT');
              } else {
                setSketchMode(true);
                setSketchTool('SELECT');
                if (solidSketchPointCount > 0) pushToast('點數不足：切除至少需要 2 個草圖點。', 'info');
              }
            }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Extruded Cut">
              <div className="w-10 h-10 flex items-center justify-center text-red-600 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M12 22V12"/><path d="M3 8l9 4 9-4"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Cut</span>
            </button>
            <button onClick={() => {
              if (solidSketchPointCount >= 3) {
                // handleExitAndExtrude only accepts 'ADD' | 'CUT' | 'SURFACE'
                handleExitAndExtrude('ADD');
              } else { 
                setSketchMode(true); 
                setSketchTool('SELECT'); 
              }
            }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[65px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Extrude Up To Next">
              <div className="w-10 h-10 flex items-center justify-center text-[#005B9A] transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="12 12 12 22"/><polyline points="7 17 12 22 17 17"/></svg>
              </div>
              <span className="text-[9px] font-bold text-slate-800 leading-tight uppercase text-center">Up To<br/>Next</span>
            </button>
            <button onClick={() => {
              const newId = `feat_${uuidv4()}`;
              addFeature({
                id: newId,
                type: 'HOLE',
                name: `Hole ${features.filter(f => f.type === 'HOLE').length + 1}`,
                parameters: {
                  holeType: 'COUNTERBORE',
                  standard: 'ISO',
                  size: 'M5',
                  depth: 10.0,
                  endCondition: 'THROUGH_ALL'
                }
              });
              setSelectedId(newId); 
            }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Hole Wizard">
              <div className="w-10 h-10 flex items-center justify-center text-slate-700 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Hole<br/>Wizard</span>
            </button>
            <button onClick={() => { 
              if (solidSketchPointCount >= 2) {
                handleExitAndExtrude('SURFACE'); 
              } else { 
                setSketchMode(true); 
                setSketchTool('SELECT'); 
              } 
            }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Extruded Surface">
              <div className="w-10 h-10 flex items-center justify-center text-orange-500 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 3l9 4-9 4-9-4 9-4z"/><path d="M12 17l9-4-9-4-9 4 9 4z"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Surface</span>
            </button>
            <div className="w-[1px] h-10 bg-border/50 mx-2" />
            <button
              onClick={() => {
                const loops = extractAllClosedLoops(sketchNodes, sketchEdges);
                if (isSketchMode && loops.length > 0 && loops[0].length >= 3) {
                  handleRevolveFromSketch();
                } else { 
                  setSketchMode(true); 
                  setSketchTool('SELECT'); 
                  if (isSketchMode && loops.length === 0) {
                    pushToast('無法旋轉：需要閉合輪廓。', 'warning');
                  } else {
                    setHint('Draw closed profile, then Revolved Boss/Base');
                  }
                }
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${pendingFeatureCommand ? 'border-transparent' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`}
              title="Revolve Boss/Base"
            >
              <div className="w-10 h-10 flex items-center justify-center text-[#005B9A] transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><polyline points="21 3 21 8 16 8"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Revolve</span>
            </button>
            <button
              onClick={() => {
                const loops = extractAllClosedLoops(sketchNodes, sketchEdges);
                if (isSketchMode && loops.length > 0 && loops[0].length >= 3) {
                  handleRevolveFromSketch('CUT');
                } else { 
                  setSketchMode(true); 
                  setSketchTool('SELECT'); 
                  if (isSketchMode && loops.length === 0) {
                    pushToast('無法旋轉切除：需要閉合輪廓。', 'warning');
                  } else {
                    setHint('Draw closed profile, then Revolved Cut');
                  }
                }
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${pendingFeatureCommand ? 'border-transparent' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`}
              title="Revolved Cut"
            >
              <div className="w-10 h-10 flex items-center justify-center text-red-600 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M12 12L3 12"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Rev<br/>Cut</span>
            </button>
            <button
              onClick={() => {
                addFeature({
                  id: `feat_${uuidv4()}`,
                  type: 'SWEEP',
                  name: `Sweep ${features.filter(f => f.type === 'SWEEP').length + 1}`,
                  parameters: {
                    profile_id: '',
                    path_id: '',
                    circularProfile: false,
                    diameter: 10.0,
                    guide_ids: [],
                    isThin: false,
                    thinThickness: 1.0,
                    thinDirection: 'ONE_DIRECTION',
                    operation: 'ADD',
                    twistType: 'NONE',
                    twistValue: 0.0
                  }
                });
                setHint('Sweep feature created. Configure in PropertyManager.');
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group`}
              title="Swept Boss/Base"
            >
            <div className="w-10 h-10 flex items-center justify-center text-[#005B9A] transition-transform group-hover:scale-110">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 22C4 13 14 13 14 4"/><circle cx="14" cy="4" r="2"/><circle cx="4" cy="22" r="2"/></svg>
            </div>
            <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Sweep</span>
            </button>
            <button
            onClick={() => {
              addFeature({
                id: `feat_${uuidv4()}`,
                type: 'HELICAL_SWEEP',
                name: `Helix ${features.filter(f => f.type === 'HELICAL_SWEEP').length + 1}`,
                parameters: { 
                  profile_id: '', 
                  pitch: 5, 
                  revolutions: 10, 
                  diameter: 20, 
                  handedness: 'CW',
                  start_angle: 0,
                  taper_angle: 0,
                  axis_ref: null
                }
              });
              setHint('Helical Sweep created. Configure in PropertyManager.');
            }}
            className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group`}
            title="Helical Sweep"
            >
            <div className="w-10 h-10 flex items-center justify-center text-[#005B9A] transition-transform group-hover:scale-110">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2C12 2 15 5 15 10C15 15 9 15 9 10C9 5 12 2 12 2Z" opacity="0.5"/>
                <path d="M12 22V2M12 22C16 22 19 19 19 15C19 11 12 8 12 2M12 22C8 22 5 19 5 15C5 11 12 8 12 2"/>
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Helical<br/>Sweep</span>
            </button>
            <button
            onClick={() => {
              addFeature({
                id: `feat_${uuidv4()}`,
                type: 'LOFT',
                name: `Loft ${features.filter(f => f.type === 'LOFT' && f.parameters.operation !== 'CUT').length + 1}`,
                parameters: { 
                  profile_ids: [], 
                  guide_ids: [],
                  operation: 'ADD',
                  isThin: false,
                  thinThickness: 1.0,
                  startConstraint: 'NONE',
                  endConstraint: 'NONE',
                  startMagnitude: 1.0,
                  endMagnitude: 1.0
                }
              });
              setHint('Loft feature created. Configure in PropertyManager.');
            }}
            className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group`}
            title="Lofted Boss/Base"
            >
              <div className="w-10 h-10 flex items-center justify-center text-[#005B9A] transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 20h16"/><path d="M6 12h12"/><path d="M8 4h8"/><path d="M4 20L8 4"/><path d="M20 20L16 4"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Loft</span>
            </button>
            <button
            onClick={() => {
              addFeature({
                id: `feat_${uuidv4()}`,
                type: 'LOFT',
                name: `Lofted Cut ${features.filter(f => f.type === 'LOFT' && f.parameters.operation === 'CUT').length + 1}`,
                parameters: { 
                  profile_ids: [], 
                  guide_ids: [],
                  operation: 'CUT',
                  isThin: false,
                  thinThickness: 1.0,
                  startConstraint: 'NONE',
                  endConstraint: 'NONE',
                  startMagnitude: 1.0,
                  endMagnitude: 1.0
                }
              });
              setHint('Lofted Cut feature created. Configure in PropertyManager.');
            }}
            className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group`}
            title="Lofted Cut"
            >
              <div className="w-10 h-10 flex items-center justify-center text-rose-600 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 20h16M6 12h12M8 4h8M4 20L8 4M20 20L16 4"/><path d="M12 4v16" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Lofted<br/>Cut</span>
            </button>
            <button
              onClick={() => { 
                if (features.length === 0) {
                  alert('Create a solid body first!');
                  return;
                }
                const featId = `feat_${uuidv4()}`;
                addFeature({
                  id: featId,
                  type: 'FILLET',
                  name: `Fillet ${features.filter(f => f.type === 'FILLET').length + 1}`,
                  parameters: { radius: 2, radius2: 2, refs: [] }
                });
                setSelectedId(featId);
                
                appliedEdgeFeatureRef.current = null; 
                setActiveTab('FEATURES'); 
                setPendingFeatureCommand('FILLET'); 
                setSelectedTopology(null); 
                setHint('Select an edge to fillet, then adjust parameters.');
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${pendingFeatureCommand === 'FILLET' ? 'border-[#005B9A] bg-white shadow-sm' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`}
              title="Fillet"
            >
              <div className="w-10 h-10 flex items-center justify-center text-[#005B9A] transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 2a7 7 0 0 1 7 7"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Fillet</span>
            </button>
            <button
              onClick={() => { appliedEdgeFeatureRef.current = null; setActiveTab('FEATURES'); setPendingFeatureCommand('CHAMFER'); setSelectedTopology(null); }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${pendingFeatureCommand === 'CHAMFER' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`}
              title="Chamfer"
            >
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${pendingFeatureCommand === 'CHAMFER' ? 'text-[#005B9A] scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="2" x2="19" y2="9"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Chamfer</span>
            </button>
            <button
              onClick={() => { appliedEdgeFeatureRef.current = null; setActiveTab('FEATURES'); setPendingFeatureCommand('THICKEN'); setSelectedTopology(null); }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${pendingFeatureCommand === 'THICKEN' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`}
              title="Thicken"
            >
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${pendingFeatureCommand === 'THICKEN' ? 'text-orange-500 scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="7.5 4.21 12 6.81 16.5 4.21"/><polyline points="7.5 19.79 12 17.19 16.5 19.79"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Thicken</span>
            </button>
            
            <div className="w-[1px] h-10 bg-border/50 mx-1" />

            <button
              onClick={() => {
                const featId = `feat_${uuidv4()}`;
                addFeature({
                  id: featId,
                  type: 'PATTERN',
                  name: `Pattern ${features.filter(f => f.type === 'PATTERN').length + 1}`,
                  parameters: { pattern_type: 'LINEAR', count: 2, spacing: 10, axis: 'X', direction_refs: [], target_feature_ids: [] }
                });
                setSelectedId(featId);
                appliedEdgeFeatureRef.current = null;
                setActiveTab('FEATURES');
                setPendingFeatureCommand('PATTERN');
                setSelectedTopology(null);
                setHint('Select a target feature, then select a linear edge for direction.');
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${pendingFeatureCommand === 'PATTERN' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`}
              title="Pattern"
            >
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${pendingFeatureCommand === 'PATTERN' ? 'text-indigo-500 scale-110' : 'text-[#005B9A] group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Pattern</span>
            </button>

            <button
              onClick={() => {
                const featId = `feat_${uuidv4()}`;
                addFeature({
                  id: featId,
                  type: 'MIRROR',
                  name: `Mirror ${features.filter(f => f.type === 'MIRROR').length + 1}`,
                  parameters: { mirror_plane_refs: [], target_feature_ids: [] }
                });
                setSelectedId(featId);
                appliedEdgeFeatureRef.current = null;
                setActiveTab('FEATURES');
                setPendingFeatureCommand('MIRROR');
                setSelectedTopology(null);
                setHint('Select a plane or planar face to mirror about.');
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${pendingFeatureCommand === 'MIRROR' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`}
              title="Mirror"
            >
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${pendingFeatureCommand === 'MIRROR' ? 'text-indigo-500 scale-110' : 'text-[#005B9A] group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Mirror</span>
            </button>

            <button
              onClick={() => {
                const featId = `feat_${uuidv4()}`;
                addFeature({
                  id: featId,
                  type: 'DRAFT',
                  name: `Draft ${features.filter(f => f.type === 'DRAFT').length + 1}`,
                  parameters: { angle: 5, neutral_plane_refs: [], faces_to_draft_refs: [] }
                });
                setSelectedId(featId);
                appliedEdgeFeatureRef.current = null;
                setActiveTab('FEATURES');
                setPendingFeatureCommand('DRAFT');
                setSelectedTopology(null);
                setHint('Step 1: Select a neutral plane. Step 2: Select faces to draft.');
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${pendingFeatureCommand === 'DRAFT' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`}
              title="Draft"
            >
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${pendingFeatureCommand === 'DRAFT' ? 'text-[#005B9A] scale-110' : 'text-[#005B9A] group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Draft</span>
            </button>

            <div className="w-[1px] h-10 bg-border/50 mx-1" />

            <button
              onClick={() => {
                const featId = `feat_${uuidv4()}`;
                addFeature({
                  id: featId,
                  type: 'SHELL',
                  name: `Shell ${features.filter(f => f.type === 'SHELL').length + 1}`,
                  parameters: { thickness: 2, faces_to_remove_refs: [], flip: false }
                });
                setSelectedId(featId);
                appliedEdgeFeatureRef.current = null;
                setActiveTab('FEATURES');
                setPendingFeatureCommand('SHELL');
                setSelectedTopology(null);
                setHint('Select faces to remove to create a shell.');
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${pendingFeatureCommand === 'SHELL' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`}
              title="Shell"
            >
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${pendingFeatureCommand === 'SHELL' ? 'text-teal-600 scale-110' : 'text-[#005B9A] group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M7 7h10v10H7z"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Shell</span>
            </button>

            <button
              onClick={() => {
                const featId = `feat_${uuidv4()}`;
                addFeature({
                  id: featId,
                  type: 'DOME',
                  name: `Dome ${features.filter(f => f.type === 'DOME').length + 1}`,
                  parameters: { distance: 2.0, refs: [], reverse: false }
                });
                setSelectedId(featId);
                setPendingFeatureCommand('DOME');
                setSelectedTopology(null);
                setHint('Select a face to apply a Dome feature.');
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${pendingFeatureCommand === 'DOME' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`}
              title="Dome"
            >
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${pendingFeatureCommand === 'DOME' ? 'text-indigo-500 scale-110' : 'text-[#005B9A] group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M2 20a10 10 0 0 1 20 0H2z"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Dome</span>
            </button>

            <div className="w-[1px] h-10 bg-border/50 mx-1" />

            <button 
              onClick={() => {
                const featId = `feat_${uuidv4()}`;
                addFeature({
                  id: featId,
                  type: 'REFERENCE_PLANE',
                  name: `Plane ${features.filter(f => f.type === 'REFERENCE_PLANE').length + 1}`,
                  parameters: { planeType: 'OFFSET', offset: 10, refs: [], flip: false }
                });
                setSelectedId(featId);
                setSelectedSubNodeType('FEATURE');
                setHint('Select entities (faces, points, edges) to define the reference plane.');
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group`}
              title="Reference Plane"
            >
              <div className={`w-10 h-10 flex items-center justify-center transition-transform text-slate-600 group-hover:scale-110`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Ref<br/>Plane</span>
            </button>

            <button 
              onClick={() => {
                const featId = `feat_${uuidv4()}`;
                addFeature({
                  id: featId,
                  type: 'REFERENCE_AXIS',
                  name: `Axis ${features.filter(f => f.type === 'REFERENCE_AXIS').length + 1}`,
                  parameters: { axisType: 'TWO_POINTS', refs: [] }
                });
                setSelectedId(featId);
                setSelectedSubNodeType('FEATURE');
                setHint('Select entities to define the reference axis.');
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group`}
              title="Reference Axis"
            >
              <div className={`w-10 h-10 flex items-center justify-center transition-transform text-slate-600 group-hover:scale-110`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="2" x2="12" y2="22"/><polyline points="5 12 12 12 19 12"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Ref<br/>Axis</span>
            </button>

            <button 
              onClick={() => {
                const featId = `feat_${uuidv4()}`;
                addFeature({
                  id: featId,
                  type: 'REFERENCE_POINT',
                  name: `Point ${features.filter(f => f.type === 'REFERENCE_POINT').length + 1}`,
                  parameters: { pointType: 'FACE_CENTER', refs: [] }
                });
                setSelectedId(featId);
                setSelectedSubNodeType('FEATURE');
                setHint('Select entities to define the reference point.');
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group`}
              title="Reference Point"
            >
              <div className={`w-10 h-10 flex items-center justify-center transition-transform text-slate-600 group-hover:scale-110`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Ref<br/>Point</span>
            </button>
            <button
              onClick={() => {
                const featId = `feat_${uuidv4()}`;
                addFeature({
                  id: featId,
                  type: 'HOLE_WIZARD',
                  name: `Hole ${features.filter(f => f.type === 'HOLE_WIZARD').length + 1}`,
                  parameters: { hole_type: 'SIMPLE', diameter: 5, depth: 10, hole_placement_refs: [] }
                });
                setSelectedId(featId);
                appliedEdgeFeatureRef.current = null;
                setActiveTab('FEATURES');
                setPendingFeatureCommand('HOLE_WIZARD');
                setSelectedTopology(null);
                setHint('Click on a face to place the hole.');
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${pendingFeatureCommand === 'HOLE_WIZARD' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`}
              title="Hole Wizard"
            >
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${pendingFeatureCommand === 'HOLE_WIZARD' ? 'text-teal-600 scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Hole</span>
            </button>
          </div>
        ) : activeTab === 'SURFACING' ? (
          <div className="flex items-center gap-1 h-full animate-in fade-in slide-in-from-left-2 duration-300">
            <button onClick={() => { setSketchMode(true); setSketchTool('SELECT'); setHint('Select profile for Surface Extrude'); }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Extruded Surface">
              <div className="w-10 h-10 flex items-center justify-center text-orange-500 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 3l9 4-9 4-9-4 9-4z"/><path d="M12 17l9-4-9-4-9 4 9 4z"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Surface<br/>Extrude</span>
            </button>
            <button onClick={() => { setSketchMode(true); setSketchTool('SELECT'); }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Revolved Surface">
              <div className="w-10 h-10 flex items-center justify-center text-orange-500 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M12 12L3 12"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Surface<br/>Revolve</span>
            </button>
            <button onClick={() => { 
                const featId = `feat_${uuidv4()}`;
                addFeature({
                  id: featId,
                  type: 'LOFT',
                  name: `Surface-Loft ${features.filter(f => f.type === 'LOFT').length + 1}`,
                  parameters: { profile_ids: [], isSurfaceOnly: true }
                });
             }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Lofted Surface">
              <div className="w-10 h-10 flex items-center justify-center text-orange-500 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 20h16"/><path d="M8 4h8"/><path d="M4 20L8 4"/><path d="M20 20L16 4"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Surface<br/>Loft</span>
            </button>
            <div className="w-[1px] h-10 bg-border/50 mx-1" />
            <button onClick={() => { 
                const featId = `feat_${uuidv4()}`;
                addFeature({
                  id: featId,
                  type: 'SURFACE_OFFSET',
                  name: `Offset-Surf ${features.filter(f => f.type === 'SURFACE_OFFSET').length + 1}`,
                  parameters: { distance: 1.0, refs: [] }
                });
                setPendingFeatureCommand('SURFACE_OFFSET');
                setHint('Select faces to offset as a surface.');
             }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Offset Surface">
              <div className="w-10 h-10 flex items-center justify-center text-orange-600 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M16 14l4-4-4-4"/><path d="M20 10H4"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Offset<br/>Surface</span>
            </button>
            <button onClick={() => {
                const featId = `feat_${uuidv4()}`;
                addFeature({
                  id: featId,
                  type: 'SURFACE_KNIT',
                  name: `Knit-Surf ${features.filter(f => f.type === 'SURFACE_KNIT').length + 1}`,
                  parameters: { refs: [] }
                });
                setHint('Knit surface feature created. All current surfaces will be sewn.');
             }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Knit Surface">
              <div className="w-10 h-10 flex items-center justify-center text-orange-700 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M16 3H8l-5 9 5 9h8l5-9-5-9z"/><path d="M12 3v18"/><path d="M3 12h18"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Knit<br/>Surface</span>
            </button>
            <button onClick={() => {
                const featId = `feat_${uuidv4()}`;
                addFeature({
                  id: featId,
                  type: 'SURFACE_CUT',
                  name: `Surf-Cut ${features.filter(f => f.type === 'SURFACE_CUT').length + 1}`,
                  parameters: { tool_feature_id: '', flip: false }
                });
                setPendingFeatureCommand('SURFACE_CUT');
                setHint('Select a surface to cut the solid body.');
             }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Surface Cut">
              <div className="w-10 h-10 flex items-center justify-center text-amber-600 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="7.5 4.21 12 6.81 16.5 4.21"/><polyline points="7.5 19.79 7.5 14.6 3 12"/><polyline points="21 12 16.5 14.6 16.5 19.79"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Surface<br/>Cut</span>
            </button>

            <div className="w-[1px] h-10 bg-border/50 mx-1" />
            <button onClick={() => { pushToast('Boundary Surface requires multi-directional curves.', 'info'); }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Boundary Surface">
              <div className="w-10 h-10 flex items-center justify-center text-orange-400 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M2 12c4-4 8-4 12 0s8 4 12 0"/><path d="M12 2c-4 4-4 8 0 12s4 8 0 12"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Boundary<br/>Surface</span>
            </button>
          </div>
        ) : activeTab === 'SKETCH' ? (
          <div className="flex items-center gap-2 h-full animate-in fade-in slide-in-from-left-2 duration-300">
            <button onClick={() => { (window as any).__handleSaveSketchOnly?.(); }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Save Sketch">
              <div className="w-10 h-10 flex items-center justify-center text-blue-600 transition-transform group-hover:scale-110">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Save</span>
            </button>
            <button onClick={() => { (window as any).__resetSketchSession?.(); }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Discard/Exit Sketch">
              <div className="w-10 h-10 flex items-center justify-center text-emerald-600 transition-transform group-hover:scale-110">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Exit</span>
            </button>
            <div className="w-[1px] h-10 bg-border/50 mx-2" />

            {/* Basic Sketch Primitives */}
            <button onClick={() => setSketchTool('LINE')} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[65px] transition-all border ${sketchTool === 'LINE' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`} title="Line">
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${sketchTool === 'LINE' ? 'text-[#005B9A] scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="19" x2="19" y2="5"/><circle cx="5" cy="19" r="1.5"/><circle cx="19" cy="5" r="1.5"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Line</span>
            </button>

            <button onClick={() => setSketchTool('RECTANGLE')} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[65px] transition-all border ${sketchTool === 'RECTANGLE' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`} title="Corner Rectangle">
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${sketchTool === 'RECTANGLE' ? 'text-[#005B9A] scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Rect</span>
            </button>

            <button onClick={() => setSketchTool('CENTER_RECTANGLE')} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[65px] transition-all border ${sketchTool === 'CENTER_RECTANGLE' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`} title="Center Rectangle">
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${sketchTool === 'CENTER_RECTANGLE' ? 'text-[#005B9A] scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
                  <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="2 2"/>
                  <line x1="3" y1="12" x2="21" y2="12" strokeDasharray="2 2"/>
                </svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Ctr Rect</span>
            </button>

            <button onClick={() => setSketchTool('CIRCLE')} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[65px] transition-all border ${sketchTool === 'CIRCLE' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`} title="Circle">
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${sketchTool === 'CIRCLE' ? 'text-[#005B9A] scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="9"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Circle</span>
            </button>

            <button onClick={() => setSketchTool('ARC')} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[65px] transition-all border ${sketchTool === 'ARC' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`} title="3 Point Arc">
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${sketchTool === 'ARC' ? 'text-[#005B9A] scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 12a8 8 0 0 0-16 0"/><path d="M4 12v4"/><path d="M20 12v4"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Arc</span>
            </button>

            <button onClick={() => setSketchTool('SPLINE')} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[65px] transition-all border ${sketchTool === 'SPLINE' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`} title="Spline">
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${sketchTool === 'SPLINE' ? 'text-[#005B9A] scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 19c4 0 6-8 10-8s6 8 10 8" /></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Spline</span>
            </button>

            <div className="w-[1px] h-10 bg-border/50 mx-2" />
            <button onClick={() => useCadStore.setState(s => ({ smartDimensionActive: !s.smartDimensionActive }))} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${useCadStore.getState().smartDimensionActive ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`} title="Smart Dimension">
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${useCadStore.getState().smartDimensionActive ? 'text-[#005B9A] scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m18 8 3 3-3 3"/><path d="m6 8-3 3 3 3"/><path d="M2 11h20"/><path d="M2 4v14"/><path d="M22 4v14"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Smart Dim</span>
            </button>
            <div className="w-[1px] h-10 bg-border/50 mx-1" />
            <button onClick={() => { setSketchTool('TRIM'); }} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${sketchTool === 'TRIM' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`} title="Trim Entities">
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${sketchTool === 'TRIM' ? 'text-red-500 scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="M18 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="m17 17-5-5-5 5"/><path d="m14.5 10.5-2.5 2.5-2.5-2.5"/><path d="M15 18H9"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Trim</span>
            </button>
            <div className="w-[1px] h-10 bg-border/50 mx-1" />
            <button onClick={() => { setSketchTool('MIRROR'); }} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${sketchTool === 'MIRROR' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`} title="Mirror Entities">
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${sketchTool === 'MIRROR' ? 'text-indigo-600 scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v20"/><path d="m2 8 8 2"/><path d="m2 14 8-2"/><path d="m22 8-8 2"/><path d="m22 14-8-2"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Mirror</span>
            </button>
            <div className="w-[1px] h-10 bg-border/50 mx-1" />
            <button onClick={() => { setSketchTool('EXTEND'); }} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${sketchTool === 'EXTEND' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`} title="Extend Entities">
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${sketchTool === 'EXTEND' ? 'text-emerald-600 scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/><path d="m15 16 4-4-4-4"/><path d="M12 2v20"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Extend</span>
            </button>
            <div className="w-[1px] h-10 bg-border/50 mx-1" />
            <button onClick={() => { setSketchTool('LINEAR_PATTERN'); }} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${sketchTool === 'LINEAR_PATTERN' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`} title="Linear Sketch Pattern">
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${sketchTool === 'LINEAR_PATTERN' ? 'text-[#005B9A] scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M12 6h3"/><path d="M6 12v3"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Linear<br/>Pattern</span>
            </button>
            <button onClick={() => { setSketchTool('CIRCULAR_PATTERN'); }} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${sketchTool === 'CIRCULAR_PATTERN' ? 'bg-white border-[#A0A0A0] shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`} title="Circular Sketch Pattern">
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${sketchTool === 'CIRCULAR_PATTERN' ? 'text-[#005B9A] scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"/><path d="M12 2v2"/><path d="M12 18v2"/><path d="M2 12h2"/><path d="M18 12h2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase text-center">Circular<br/>Pattern</span>
            </button>
            <div className="w-[1px] h-10 bg-border/50 mx-1" />
            <button onClick={() => { (window as any).__handleConvertEntities?.(); }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Convert Entities">
              <div className="w-10 h-10 flex items-center justify-center text-slate-700 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M12 22V12"/><path d="M12 12 3.5 7.5"/><path d="M12 12l8.5-4.5"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Convert</span>
            </button>
            <button onClick={() => { (window as any).__handleOffsetEntities?.(); }} className="flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group" title="Offset Entities">
              <div className="w-10 h-10 flex items-center justify-center text-slate-700 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 12A10 10 0 0 0 12 2v0"/><path d="M22 12A10 10 0 0 1 12 22v0"/><path d="M12 22a10 10 0 0 1-10-10v0"/><path d="M12 2a10 10 0 0 0-10 10v0"/><path d="M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Offset</span>
            </button>
          </div>
        ) : activeTab === 'EVALUATE' ? (
          <div className="flex items-center gap-2 h-full animate-in fade-in slide-in-from-left-2 duration-300">
            <button onClick={() => { setMeasurementMode(measurementMode === 'DISTANCE' ? 'NONE' : 'DISTANCE'); setInterferenceActive(false); }} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border rounded-md ${measurementMode !== 'NONE' ? 'bg-[#005B9A]/10 border-[#005B9A]' : 'border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100'} group`} title="Measure Distance">
              <div className="w-10 h-10 flex items-center justify-center text-slate-700 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6" /><path d="M20 4L4 20" /><path d="M10 20H4v-6" /></svg>
              </div>
              <span className="text-[11px] font-semibold text-slate-800 leading-tight">Measure</span>
            </button>

            <button
              onClick={() => {
                const current = useCadStore.getState().sectionView.isActive;
                useCadStore.getState().setSectionView({ isActive: !current });
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 rounded-md group ${useCadStore.getState().sectionView.isActive ? 'bg-[#005B9A]/10 border-[#005B9A]' : ''}`}
              title="Section View"
            >
              <div className="w-10 h-10 flex items-center justify-center text-slate-700 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h16M12 4v16M3 9h18M3 15h18" /></svg>
              </div>
              <span className="text-[11px] font-semibold text-slate-800 leading-tight">Section<br />View</span>
            </button>

            <button
              onClick={() => {
                const next = !interferenceActive;
                setInterferenceActive(next);
                if (next) setMeasurementMode('NONE');
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 rounded-md group ${interferenceActive ? 'bg-red-50 border-red-300 shadow-inner' : ''}`}
              title="Interference Detection"
            >
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${interferenceActive ? 'text-red-600 scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m21 21-4.3-4.3"/><circle cx="11" cy="11" r="8"/><path d="m11 8-2 2 2 2 2-2-2-2Z"/></svg>
              </div>
              <span className="text-[11px] font-semibold text-slate-800 leading-tight">Interference</span>
            </button>

            <div className="w-px h-10 bg-slate-300 mx-1"></div>

            <button
              onClick={onShowMassProps}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 rounded-md group`}
              title="Mass Properties"
            >
              <div className="w-10 h-10 flex items-center justify-center text-slate-700 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
              </div>
              <span className="text-[11px] font-semibold text-slate-800 leading-tight">Mass<br />Props</span>
            </button>

            <button
              onClick={onShowEquations}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 rounded-md group`}
              title="Equations"
            >
              <div className="w-10 h-10 flex items-center justify-center text-indigo-600 transition-transform group-hover:scale-110">
                <span className="text-2xl font-black italic">∑</span>
              </div>
              <span className="text-[11px] font-semibold text-slate-800 leading-tight">Equations</span>
            </button>
          </div>
        ) : 
 activeTab === 'RENDER' ? (
          <div className="flex items-center gap-2 h-full animate-in fade-in slide-in-from-left-2 duration-300">
            <div className="flex flex-col gap-1 px-3 py-1 border border-[#A0A0A0] rounded bg-white">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">材質 (Material)</label>
              <select 
                className="text-[12px] bg-slate-100 border border-slate-300 rounded px-2 py-1 outline-none font-bold text-slate-800"
                value={partMaterial}
                onChange={(e) => setPartMaterial(e.target.value)}
              >
                {Object.keys(require('@/store/useCadStore').MATERIAL_PRESETS || {}).map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="w-px h-[60%] bg-slate-300 mx-1"></div>
            <div className="flex flex-col gap-1 px-3 py-1 border border-[#A0A0A0] rounded bg-white">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">環境光 (Environment)</label>
              <select 
                className="text-[12px] bg-slate-100 border border-slate-300 rounded px-2 py-1 outline-none font-bold text-slate-800"
                value={environmentMap}
                onChange={(e) => setEnvironmentMap(e.target.value)}
              >
                <option value="studio">Studio (攝影棚)</option>
                <option value="city">City (城市)</option>
                <option value="forest">Forest (森林)</option>
                <option value="sunset">Sunset (日落)</option>
                <option value="dawn">Dawn (黎明)</option>
                <option value="night">Night (夜晚)</option>
              </select>
            </div>
            <div className="w-px h-[60%] bg-slate-300 mx-1"></div>
            <button
              onClick={() => {
                const currentMode = viewportDisplayMode;
                setViewportDisplayMode(currentMode === 'SHADED' ? 'SHADED_EDGES' : 'SHADED');
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 rounded-md group`}
              title="Display Style (Toggle Edges)"
            >
              <div className="w-10 h-10 flex items-center justify-center text-slate-700 transition-transform group-hover:scale-110">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
              </div>
              <span className="text-[11px] font-semibold text-slate-800 leading-tight">Display<br />Style</span>
            </button>
          </div>
        ) : activeTab === 'ASSEMBLY' ? (
          <div className="flex items-center gap-2 h-full animate-in fade-in slide-in-from-left-2 duration-300">
            <button onClick={() => {
              const id = `comp_${uuidv4()}`;
              const newComp = { id, partId: 'new_part', instanceName: `Component_${components?.length || 0 + 1}`, transform: { position: [0,0,0] as [number, number, number], rotation: [0,0,0] as [number, number, number] }, visible: true };
              useCadStore.setState(state => ({ components: [...(state.components||[]), newComp] }));
            }} className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border border-transparent hover:bg-white hover:border-[#A0A0A0] active:bg-slate-100 group`} title="Insert Component">
              <div className={`w-10 h-10 flex items-center justify-center transition-transform text-indigo-600 group-hover:scale-110`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Insert Comp</span>
            </button>
            <div className="w-[1px] h-10 bg-border/50 mx-1" />
            <button 
              onClick={() => {
                const nextActive = !explodedView.isActive;
                setExplodedView({ isActive: nextActive });
                if (nextActive && Object.keys(explodedView.directions).length === 0) {
                  calculateAutoExplosion();
                }
                if (nextActive && explodedView.factor === 0) {
                  useCadStore.getState().setExplosionFactor(0.5);
                }
              }} 
              className={`flex flex-col items-center justify-center gap-0.5 px-3 h-[78px] min-w-[75px] transition-all border ${explodedView.isActive ? 'bg-indigo-50 border-indigo-300 shadow-inner' : 'border-transparent hover:bg-white hover:border-[#A0A0A0]'} active:bg-slate-100 group`} 
              title="Exploded View"
            >
              <div className={`w-10 h-10 flex items-center justify-center transition-transform ${explodedView.isActive ? 'text-indigo-600 scale-110' : 'text-slate-600 group-hover:scale-110'}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><line x1="12" y1="12" x2="12" y2="2"/><line x1="12" y1="12" x2="22" y2="12"/><line x1="12" y1="12" x2="12" y2="22"/><line x1="12" y1="12" x2="2" y2="12"/></svg>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-none uppercase">Explode</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

