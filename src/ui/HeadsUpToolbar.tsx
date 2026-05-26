'use client';

import React, { useState } from 'react';
import { useCadStore } from '../store/useCadStore';
import * as THREE from 'three';

export const HeadsUpToolbar: React.FC = () => {
  const { 
    triggerCameraNormal, 
    setActivePlane, 
    controls, 
    meshData,
    isSketchMode,
    showConstraints,
    toggleShowConstraints,
    trimMode,
    setTrimMode
  } = useCadStore();
  const [showOrientation, setShowOrientation] = useState(false);
  const [displayStyle, setDisplayStyle] = useState<'SHADED' | 'WIREFRAME'>('SHADED');

  const handleZoomToFit = () => {
    if (!controls) return;
    
    // In a real implementation, we would compute the bounding box of all meshes.
    // For now, we'll reset to a standard isometric-like view.
    controls.reset();
    // controls.fitToBox(); // If using a more advanced control library
  };

  const setOrientation = (plane: 'FRONT' | 'TOP' | 'RIGHT' | 'ISOMETRIC') => {
    if (plane === 'ISOMETRIC') {
      if (controls) {
        // Simple isometric approximation
        controls.object.position.set(100, 100, 100);
        controls.target.set(0, 0, 0);
        controls.update();
      }
    } else {
      setActivePlane(plane);
      triggerCameraNormal();
    }
    setShowOrientation(false);
  };

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1.5 bg-white/60 backdrop-blur-md border border-white/40 rounded-lg shadow-lg z-40 select-none group hover:bg-white/80 transition-all">
      {/* Zoom to Fit */}
      <button
        onClick={handleZoomToFit}
        className="w-8 h-8 flex items-center justify-center rounded hover:bg-slate-200 text-slate-700 transition-colors"
        title="整頁縮放 (Zoom to Fit)"
      >
        <span className="text-lg">🔍</span>
      </button>

      {/* View Orientation */}
      <div className="relative">
        <button
          onClick={() => setShowOrientation(!showOrientation)}
          className={`w-8 h-8 flex items-center justify-center rounded hover:bg-slate-200 text-slate-700 transition-colors ${showOrientation ? 'bg-slate-200' : ''}`}
          title="視圖定向 (View Orientation)"
        >
          <span className="text-lg">🧊</span>
        </button>
        
        {showOrientation && (
          <div className="absolute top-full left-0 mt-2 w-32 bg-white/90 backdrop-blur-xl border border-slate-200 rounded-md shadow-xl py-1 z-50">
            <button onClick={() => setOrientation('FRONT')} className="w-full text-left px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors flex items-center gap-2">
              <span className="w-4 h-4 bg-blue-100 rounded flex items-center justify-center text-[10px]">F</span> 前基準面
            </button>
            <button onClick={() => setOrientation('TOP')} className="w-full text-left px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors flex items-center gap-2">
              <span className="w-4 h-4 bg-green-100 rounded flex items-center justify-center text-[10px]">T</span> 上基準面
            </button>
            <button onClick={() => setOrientation('RIGHT')} className="w-full text-left px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors flex items-center gap-2">
              <span className="w-4 h-4 bg-red-100 rounded flex items-center justify-center text-[10px]">R</span> 右基準面
            </button>
            <div className="h-[1px] bg-slate-200 my-1" />
            <button onClick={() => setOrientation('ISOMETRIC')} className="w-full text-left px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors flex items-center gap-2">
              <span className="w-4 h-4 bg-purple-100 rounded flex items-center justify-center text-[10px]">I</span> 等角視圖
            </button>
          </div>
        )}
      </div>

      <div className="w-[1px] h-4 bg-slate-300 mx-1" />

      {/* Display Style */}
      <button
        onClick={() => setDisplayStyle(displayStyle === 'SHADED' ? 'WIREFRAME' : 'SHADED')}
        className="w-8 h-8 flex items-center justify-center rounded hover:bg-slate-200 text-slate-700 transition-colors"
        title="顯示樣式 (Display Style)"
      >
        <span className="text-lg">{displayStyle === 'SHADED' ? '🎨' : '🕸️'}</span>
      </button>

      {/* Constraint Display Toggle (Only in Sketch Mode) */}
      {isSketchMode && (
        <>
          <div className="w-[1px] h-4 bg-slate-300 mx-1" />
          <button
            onClick={toggleShowConstraints}
            className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
              showConstraints 
                ? 'bg-primary/10 text-primary hover:bg-primary/20' 
                : 'hover:bg-slate-200 text-slate-500'
            }`}
            title={`${showConstraints ? '隱藏' : '顯示'}草圖約束 (Toggle Constraints)`}
          >
            <span className="text-lg">🔗</span>
          </button>
          
          {/* Trim Tool */}
          <button
            onClick={() => setTrimMode(!trimMode)}
            className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
              trimMode 
                ? 'bg-primary/10 text-primary hover:bg-primary/20' 
                : 'hover:bg-slate-200 text-slate-600'
            }`}
            title={`${trimMode ? '退出' : '進入'}草圖修剪模式 (Trim)`}
          >
            <span className="text-lg">✂️</span>
          </button>
        </>
      )}

      {/* Section View */}
      <button
        className="w-8 h-8 flex items-center justify-center rounded hover:bg-slate-200 text-slate-700 transition-colors opacity-50 cursor-not-allowed"
        title="剖面視圖 (Section View - 尚未開放)"
      >
        <span className="text-lg">🔪</span>
      </button>
    </div>
  );
};
