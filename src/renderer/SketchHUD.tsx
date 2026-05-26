'use client';

import React, { useState, useRef, useEffect } from 'react';
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

  const [position, setPosition] = useState({ x: 50, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const solidPointCount = Object.values(useCadStore.getState().sketchNodes).length;
  const isClosed = solidPointCount >= 3;

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  if (!isSketchMode) return null;

  return (
    <div
      className={`absolute glass-effect rounded-lg text-xs font-mono text-slate-700 z-20 select-none ${isDragging ? 'cursor-grabbing shadow-2xl scale-105' : 'cursor-grab'}`}
      style={{
        left: position.x,
        top: position.y,
        userSelect: 'none',
        transition: isDragging ? 'none' : 'box-shadow 0.2s, transform 0.2s'
      }}
    >
      <div className="flex items-stretch">
        <div
          onMouseDown={handleMouseDown}
          className="bg-slate-300 hover:bg-slate-400 px-2 py-2 rounded-l-lg cursor-grab active:cursor-grabbing flex items-center justify-center select-none border-r border-slate-400"
        >
          <span className="text-slate-600 font-bold">⋮⋮</span>
        </div>
        <div className="flex items-center gap-4 px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-primary"> Sketch Mode</span>
            <span className="text-slate-500">[{activePlane}]</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-600">:</span>
            <span className="font-bold text-emerald-600 uppercase">{sketchTool}</span>
          </div>
          <button
            onClick={() => setGridSnap(!gridSnap)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded transition-all ${
              gridSnap ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'
            }`}
          >
            <span> </span>
            <span className="font-bold">Grid Snap</span>
          </button>
          <div className="flex items-center gap-2">
            <span className="text-slate-600">:</span>
            <span className="font-bold text-blue-600">{solidPointCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onReset}
              className="px-3 py-0.5 rounded bg-error/10 text-error hover:bg-error/20 transition-all font-bold"
            >
              重置 (Reset)
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
              退出草圖 (Exit Sketch)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
