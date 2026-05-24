'use client';

import React from 'react';
import { useCadStore } from '../store/useCadStore';

export const SketchHUD = ({ 
  onReset, 
  onExit 
}: { 
  onReset: () => void; 
  onExit: () => void; 
}) => {
  const {
    isSketchMode,
    activePlane,
    sketchTool,
    gridSnap,
    setGridSnap
  } = useCadStore();

  if (!isSketchMode) return null;

  const solidPointCount = Object.values(useCadStore.getState().sketchNodes).length;
  const isClosed = solidPointCount >= 3;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 glass-effect px-4 py-2 rounded-lg text-xs font-mono text-slate-700 pointer-events-none z-20">
      <div className="flex items-center gap-4">
        {/* Status Indicator */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-primary">✏️ 草圖模式</span>
          <span className="text-slate-500">[{activePlane}]</span>
        </div>

        {/* Tool Indicator */}
        <div className="flex items-center gap-2">
          <span className="text-slate-600">工具:</span>
          <span className="font-bold text-emerald-600 uppercase">{sketchTool}</span>
        </div>

        {/* Grid Snap Toggle */}
        <button
          onClick={() => setGridSnap(!gridSnap)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded transition-all ${
            gridSnap ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'
          }`}
        >
          <span>🧲</span>
          <span className="font-bold">網格吸附: {gridSnap ? '已啟用' : '已關閉'}</span>
        </button>

        {/* Point Count */}
        <div className="flex items-center gap-2">
          <span className="text-slate-600">節點:</span>
          <span className="font-bold text-blue-600">{solidPointCount}</span>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            className="px-3 py-0.5 rounded bg-error/10 text-error hover:bg-error/20 transition-all font-bold"
          >
            ✗ 捨棄
          </button>
          <button
            onClick={onExit}
            disabled={!isClosed}
            className={`px-3 py-0.5 rounded font-bold transition-all ${
              isClosed
                ? 'bg-success/10 text-success hover:bg-success/20'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            ✓ 離開並拉伸
          </button>
        </div>
      </div>
    </div>
  );
};
