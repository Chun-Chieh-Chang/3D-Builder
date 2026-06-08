'use client';

import React, { useEffect, useRef } from 'react';
import { useCadStore } from '../store/useCadStore';

export const ContextMenu: React.FC = () => {
  const { 
    contextMenu, 
    setContextMenu, 
    isSketchMode, 
    setSketchMode,
    setActivePlane,
    triggerCameraNormal,
    selectedId,
    selectedEntityIds,
    setSketchEdges,
    sketchEdges,
    selectedSubNodeType,
    features,
    removeFeature,
    toggleFeatureSuppression,
    sketchTool,
    setSketchTool,
    sketchNewChain,
    setSketchNewChain,
    setLastClickedNodeId,
    setFirstChainNodeId,
    selectedEntityIds,
    sketchEdges,
    setSketchEdges,
    setShowMaterialModal,
    setTargetMaterialEntity,
    sketchNodes,
    sketchConstraints
  } = useCadStore() as any;

  const menuRef = useRef<HTMLDivElement>(null);

  // --- Dynamic Sketch Relations Logic ---
  const selectedNodes = selectedEntityIds.filter((id: string) => sketchNodes[id]).map((id: string) => sketchNodes[id]);
  const selectedEdges = selectedEntityIds.filter((id: string) => sketchEdges[id]).map((id: string) => sketchEdges[id]);

  const applicableRelations = useMemo(() => {
    if (!isSketchMode) return [];
    const relations = [];

    // 1 Edge cases
    if (selectedEdges.length === 1) {
      relations.push({ type: 'HORIZONTAL', label: '設為水平', icon: '—' });
      relations.push({ type: 'VERTICAL', label: '設為垂直', icon: '│' });
      relations.push({ type: 'FIX', label: '固定', icon: '🔒' });
    }

    // 2 Edges cases
    if (selectedEdges.length === 2) {
      const e1 = selectedEdges[0];
      const e2 = selectedEdges[1];
      const bothLines = (e1.type === 'LINE' || e1.type === 'CENTER_LINE') && (e2.type === 'LINE' || e2.type === 'CENTER_LINE');
      const bothCircles = (e1.type === 'CIRCLE' || e1.type === 'ARC') && (e2.type === 'CIRCLE' || e2.type === 'ARC');
      const oneLineOneCircle = (e1.type === 'LINE' && e2.type === 'CIRCLE') || (e1.type === 'CIRCLE' && e2.type === 'LINE');

      if (bothLines) {
        relations.push({ type: 'PARALLEL', label: '平行', icon: '∥' });
        relations.push({ type: 'PERPENDICULAR', label: '垂直', icon: '⊥' });
        relations.push({ type: 'COLLINEAR', label: '共線', icon: '⬌' });
        relations.push({ type: 'EQUAL', label: '等長', icon: '=' });
      } else if (bothCircles) {
        relations.push({ type: 'CONCENTRIC', label: '同心', icon: '◎' });
        relations.push({ type: 'EQUAL', label: '等徑', icon: '=' });
      } else if (oneLineOneCircle) {
        relations.push({ type: 'TANGENT', label: '相切', icon: '○' });
      }
    }

    // Point + Line cases
    if (selectedNodes.length === 1 && selectedEdges.length === 1) {
      relations.push({ type: 'MIDPOINT', label: '中點', icon: '⬗' });
      relations.push({ type: 'COINCIDENT', label: '重合', icon: '•' });
    }

    return relations;
  }, [isSketchMode, selectedEdges, selectedNodes]);

  const handleQuickRelation = (type: string) => {
    const cid = `c_${uuidv4().slice(0, 8)}`;
    const newConstraint: any = { id: cid, type };
    
    if (type === 'HORIZONTAL' || type === 'VERTICAL' || type === 'FIX') {
      newConstraint.edgeIds = [selectedEdges[0].id];
    } else if (type === 'PARALLEL' || type === 'PERPENDICULAR' || type === 'COLLINEAR' || type === 'EQUAL' || type === 'CONCENTRIC' || type === 'TANGENT') {
      newConstraint.edgeIds = [selectedEdges[0].id, selectedEdges[1].id];
    } else if (type === 'MIDPOINT' || type === 'COINCIDENT') {
      newConstraint.nodeIds = [selectedNodes[0].id];
      newConstraint.edgeIds = [selectedEdges[0].id];
    }

    sketchActions.addConstraintObj(newConstraint);
    const rebuildHook = (window as any).__handleRebuild;
    if (rebuildHook) setTimeout(rebuildHook, 10);
    setContextMenu(null);
  };
  // ---------------------------------------

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenu, setContextMenu]);

  if (!contextMenu) return null;

  const handleEdit = () => {
    if (selectedId) {
      const feature = features.find((f: any) => f.id === selectedId);
      if (feature) {
        const editHook = (window as any).__handleEditFeatureSketch;
        if (editHook) {
          editHook(feature);
        }
      }
    }
    setContextMenu(null);
  };

  const handleDelete = () => {
    if (selectedId) {
      removeFeature(selectedId);
      const rebuildHook = (window as any).__handleRebuild;
      if (rebuildHook) setTimeout(rebuildHook, 10);
    }
    setContextMenu(null);
  };

  const handleToggleSuppression = () => {
    if (selectedId) {
      toggleFeatureSuppression(selectedId);
      const rebuildHook = (window as any).__handleRebuild;
      if (rebuildHook) setTimeout(rebuildHook, 10);
    }
    setContextMenu(null);
  };

  const handleToggleConstruction = () => {
    if (!selectedEntityIds || selectedEntityIds.length === 0) return;
    const nextEdges = { ...sketchEdges };
    let toggledAny = false;
    
    selectedEntityIds.forEach((id: string) => {
      const edge = nextEdges[id];
      if (edge && (edge.type === 'LINE' || edge.type === 'CENTER_LINE' || edge.type === 'CIRCLE' || edge.type === 'ARC')) {
        nextEdges[id] = { ...edge, isConstruction: !edge.isConstruction };
        toggledAny = true;
      }
    });

    if (toggledAny) {
      setSketchEdges(nextEdges);
      const rebuildHook = (window as any).__handleRebuild;
      if (rebuildHook) setTimeout(rebuildHook, 10);
    }
    setContextMenu(null);
  };

  const handleRename = () => {
    if (contextMenu?.data?.onRename) {
      contextMenu.data.onRename();
    }
    setContextMenu(null);
  };

  const handleAppearances = () => {
    if (contextMenu.type === 'FEATURE' && selectedId) {
      setTargetMaterialEntity({ type: 'FEATURE', id: selectedId });
      setShowMaterialModal(true);
    } else {
      setTargetMaterialEntity({ type: 'PART', id: 'main' });
      setShowMaterialModal(true);
    }
    setContextMenu(null);
  };

  // Render Sketch Mode Context Menu
  if (isSketchMode) {
    const isDrawingChain = !sketchNewChain && (sketchTool === 'LINE' || sketchTool === 'CENTER_LINE' || sketchTool === 'SPLINE');
    const hasSelectedEdges = selectedEntityIds?.some((id: string) => sketchEdges[id]);

    return (
      <div 
        ref={menuRef}
        className="fixed z-[1100] bg-white border border-slate-200 rounded-lg shadow-2xl py-1 min-w-[180px] animate-in fade-in slide-in-from-top-1 duration-100"
        style={{ left: contextMenu.x, top: contextMenu.y }}
      >
        {/* Quick Action Icons Row */}
        <div className="flex items-center justify-around px-2 py-1.5 border-b border-slate-100 mb-1">
          <button 
            onClick={() => {
              setSketchTool('SELECT');
              setContextMenu(null);
            }} 
            className="p-1.5 hover:bg-blue-50 text-blue-600 rounded transition-colors" 
            title="選擇 (Select)"
          >
            🖱️
          </button>
          {isDrawingChain && (
            <button 
              onClick={() => {
                setSketchNewChain(true);
                setLastClickedNodeId(null);
                setFirstChainNodeId(null);
                setContextMenu(null);
              }} 
              className="p-1.5 hover:bg-amber-50 text-amber-600 rounded transition-colors" 
              title="結束鏈 (End Chain)"
            >
              ✂️
            </button>
          )}
          {hasSelectedEdges && (
            <button 
              onClick={handleToggleConstruction} 
              className="p-1.5 hover:bg-purple-50 text-purple-600 rounded transition-colors" 
              title="構造幾何 (Construction Geometry)"
            >
              📐
            </button>
          )}
          <button 
            onClick={() => { 
              triggerCameraNormal(); 
              setContextMenu(null); 
            }} 
            className="p-1.5 hover:bg-emerald-50 text-emerald-600 rounded transition-colors" 
            title="正視於 (Normal To)"
          >
            🎯
          </button>
          <button 
            onClick={() => { 
              setSketchMode(false); 
              setContextMenu(null); 
            }} 
            className="p-1.5 hover:bg-red-50 text-red-600 rounded transition-colors" 
            title="退出草圖 (Exit Sketch)"
          >
            🚪
          </button>
        </div>

        {/* Dynamic Add Relations Section (SolidWorks Style) */}
        {applicableRelations.length > 0 && (
          <div className="px-2 py-1.5 border-b border-slate-100 bg-emerald-50/30">
            <div className="text-[9px] font-black text-emerald-700 uppercase tracking-widest mb-1 px-1">加入幾何關係</div>
            <div className="grid grid-cols-3 gap-1">
              {applicableRelations.map(rel => (
                <button
                  key={rel.type}
                  onClick={() => handleQuickRelation(rel.type)}
                  className="flex flex-col items-center justify-center p-1.5 rounded border border-emerald-100 bg-white hover:bg-emerald-500 hover:text-white transition-all group"
                  title={rel.label}
                >
                  <span className="text-[12px] font-bold">{rel.icon}</span>
                  <span className="text-[8px] font-bold uppercase tracking-tighter opacity-70 group-hover:opacity-100">{rel.type.slice(0, 5)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Menu Items */}
        <button 
          onClick={() => {
            setSketchTool('SELECT');
            setContextMenu(null);
          }}
          className="w-full text-left px-4 py-1.5 text-[13px] text-slate-700 hover:bg-slate-100 transition-colors flex items-center justify-between"
        >
          <span className="font-semibold text-blue-600">選擇 (Select)</span>
          <span className="text-[10px] text-slate-400">Esc</span>
        </button>

        {hasSelectedEdges && (
          <button 
            onClick={handleToggleConstruction}
            className="w-full text-left px-4 py-1.5 text-[13px] text-slate-700 hover:bg-slate-100 transition-colors flex items-center justify-between"
          >
            <span className="font-semibold text-purple-600">構造幾何 (Construction Geometry)</span>
          </button>
        )}

        {isDrawingChain && (
          <button 
            onClick={() => {
              setSketchNewChain(true);
              setLastClickedNodeId(null);
              setFirstChainNodeId(null);
              setContextMenu(null);
            }}
            className="w-full text-left px-4 py-1.5 text-[13px] text-slate-700 hover:bg-slate-100 transition-colors flex items-center justify-between"
          >
            <span className="font-semibold text-amber-600">結束鏈 (End Chain)</span>
            <span className="text-[10px] text-slate-400">Double Click</span>
          </button>
        )}

        {selectedEntityIds && selectedEntityIds.length > 0 && (
          <button 
            onClick={() => {
              const newEdges = { ...sketchEdges };
              selectedEntityIds.forEach((id: string) => {
                if (newEdges[id]) {
                  newEdges[id] = { ...newEdges[id], isConstruction: !newEdges[id].isConstruction };
                }
              });
              setSketchEdges(newEdges);
              setContextMenu(null);
            }}
            className="w-full text-left px-4 py-1.5 text-[13px] text-slate-700 hover:bg-slate-100 transition-colors flex items-center justify-between"
          >
            <span className="font-semibold text-indigo-600">構造幾何 (Construction)</span>
          </button>
        )}

        <button 
          onClick={() => { 
            triggerCameraNormal(); 
            setContextMenu(null); 
          }}
          className="w-full text-left px-4 py-1.5 text-[13px] text-slate-700 hover:bg-slate-100 transition-colors"
        >
          正視於 (Normal To)
        </button>

        <div className="h-px bg-slate-100 my-1" />

        <button 
          onClick={() => { 
            setSketchMode(false); 
            setContextMenu(null); 
          }}
          className="w-full text-left px-4 py-1.5 text-[13px] text-slate-700 hover:bg-slate-100 transition-colors flex items-center justify-between"
        >
          <span className="text-red-600 font-semibold">退出草圖 (Exit Sketch)</span>
        </button>
      </div>
    );
  }

  // Render 3D Part Mode Context Menu
  const selectedFeature = features.find((f: any) => f.id === selectedId);

  return (
    <div 
      ref={menuRef}
      className="fixed z-[1100] bg-white border border-slate-200 rounded-lg shadow-2xl py-1 min-w-[180px] animate-in fade-in slide-in-from-top-1 duration-100"
      style={{ left: contextMenu.x, top: contextMenu.y }}
    >
      {/* Quick Action Icons Row */}
      <div className="flex items-center justify-around px-2 py-1.5 border-b border-slate-100 mb-1">
        <button onClick={handleEdit} className="p-1.5 hover:bg-emerald-50 text-emerald-600 rounded transition-colors" title="編輯草圖/特徵">✏️</button>
        <button onClick={handleToggleSuppression} className={`p-1.5 rounded transition-colors ${selectedFeature?.isSuppressed ? 'bg-amber-100 text-amber-600 hover:bg-amber-200' : 'hover:bg-slate-100 text-slate-400'}`} title={selectedFeature?.isSuppressed ? "解除壓縮" : "隱藏/壓縮"}>🚫</button>
        <button onClick={() => { triggerCameraNormal(); setContextMenu(null); }} className="p-1.5 hover:bg-blue-50 text-blue-600 rounded transition-colors" title="正視於">🎯</button>
        <button onClick={handleDelete} className="p-1.5 hover:bg-red-50 text-red-600 rounded transition-colors" title="刪除">🗑️</button>
      </div>

      {/* Menu Items */}
      <button 
        onClick={handleEdit}
        className="w-full text-left px-4 py-1.5 text-[13px] text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors flex items-center justify-between"
      >
        <span>編輯 (Edit)</span>
        <span className="text-[10px] text-slate-400">Double Click</span>
      </button>
      <button 
        onClick={handleToggleSuppression}
        className="w-full text-left px-4 py-1.5 text-[13px] text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors"
      >
        {selectedFeature?.isSuppressed ? '解除壓縮 (Unsuppress)' : '壓縮 (Suppress)'}
      </button>
      <button 
        onClick={handleRename}
        className="w-full text-left px-4 py-1.5 text-[13px] text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors flex items-center justify-between"
      >
        <span>重新命名 (Rename)</span>
        <span className="text-[10px] text-slate-400">F2</span>
      </button>
      <button 
        onClick={() => { triggerCameraNormal(); setContextMenu(null); }}
        className="w-full text-left px-4 py-1.5 text-[13px] text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors"
      >
        正視於 (Normal To)
      </button>
      <div className="h-px bg-slate-100 my-1" />
      <button 
        className="w-full text-left px-4 py-1.5 text-[13px] text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors flex items-center justify-between"
        onClick={handleDelete}
      >
        <span className="text-red-600">刪除 (Delete)</span>
        <span className="text-[10px] text-slate-400">Del</span>
      </button>
      <button 
        className="w-full text-left px-4 py-1.5 text-[13px] text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors"
        onClick={handleAppearances}
      >
        外觀 (Appearances)
      </button>
      <div className="h-px bg-slate-100 my-1" />
      <button className="w-full text-left px-4 py-1.5 text-[13px] text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors">
        放大選定範圍 (Zoom to Selection)
      </button>
    </div>
  );
};
