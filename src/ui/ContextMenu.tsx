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
    setFirstChainNodeId
  } = useCadStore() as any;

  const menuRef = useRef<HTMLDivElement>(null);

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

  // Render Sketch Mode Context Menu
  if (isSketchMode) {
    const isDrawingChain = !sketchNewChain && (sketchTool === 'LINE' || sketchTool === 'CENTER_LINE' || sketchTool === 'SPLINE');

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
      <button className="w-full text-left px-4 py-1.5 text-[13px] text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors">
        外觀 (Appearances)
      </button>
      <div className="h-px bg-slate-100 my-1" />
      <button className="w-full text-left px-4 py-1.5 text-[13px] text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors">
        放大選定範圍 (Zoom to Selection)
      </button>
    </div>
  );
};
