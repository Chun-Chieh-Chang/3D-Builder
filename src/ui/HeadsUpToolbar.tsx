'use client';

import React, { useState } from 'react';
import { useCadStore } from '../store/useCadStore';

const ZoomIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    <path d="M8 11h6" /><path d="M11 8v6" />
  </svg>
);

const ViewIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21 16-4 4-4-4" /><path d="M17 20V4" /><path d="m3 8 4-4 4 4" /><path d="M7 4v16" />
  </svg>
);

const StyleIcon = ({ wireframe }: { wireframe?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    {wireframe ? (
      <g>
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
      </g>
    ) : (
      <path d="M12 22.08V12L3.27 6.96" />
    )}
  </svg>
);

const SectionIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3h18v18H3z" /><path d="M3 12h18" /><path d="M12 3v18" />
  </svg>
);

export const HeadsUpToolbar: React.FC = () => {
  const {
    triggerCameraNormal,
    setActivePlane,
    controls,
    isSketchMode,
    setSketchMode,
    viewportDisplayMode,
    setViewportDisplayMode,
  } = useCadStore();
  const [showOrientation, setShowOrientation] = useState(false);

  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = React.useRef<{ startX: number, startY: number, initialX: number, initialY: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y
    };
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPosition({
      x: dragRef.current.initialX + dx,
      y: dragRef.current.initialY + dy
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const handleZoomToFit = () => { if (controls) controls.reset(); };

  const setOrientation = (view: 'FRONT' | 'TOP' | 'RIGHT' | 'ISOMETRIC' | 'NORMAL_TO') => {
    if (view === 'ISOMETRIC') {
      if (controls) {
        controls.object.position.set(150, 150, 150);
        controls.target.set(0, 0, 0);
        controls.update();
      }
    } else if (view === 'NORMAL_TO') {
      triggerCameraNormal();
    } else {
      setActivePlane(view);
      triggerCameraNormal();
    }
    setShowOrientation(false);
  };

  return (
    <div 
      className={`absolute flex items-center gap-1 p-1 bg-[#F5F6F9]/80 backdrop-blur-xl border border-slate-300/50 rounded-lg shadow-2xl z-40 select-none font-sans ${isDragging ? '' : 'transition-colors hover:bg-white/90'}`}
      style={{
        top: `calc(1.5rem + ${position.y}px)`,
        left: `calc(50% + ${position.x}px)`,
        transform: 'translateX(-50%)'
      }}
    >
      <div 
        className="h-9 flex flex-col flex-wrap gap-[3px] items-center justify-center cursor-move text-slate-300 hover:text-slate-500 px-1 border-r border-slate-300/50 opacity-80 hover:opacity-100 transition-all touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        title="Drag to move toolbar"
      >
        <div className="w-[3px] h-[3px] rounded-full bg-current" />
        <div className="w-[3px] h-[3px] rounded-full bg-current" />
        <div className="w-[3px] h-[3px] rounded-full bg-current" />
        <div className="w-[3px] h-[3px] rounded-full bg-current" />
        <div className="w-[3px] h-[3px] rounded-full bg-current" />
        <div className="w-[3px] h-[3px] rounded-full bg-current" />
      </div>

      <button onClick={handleZoomToFit} className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-slate-200/50 text-slate-700 transition-all border-none bg-transparent cursor-pointer" title="Zoom to Fit (F)">
        <ZoomIcon />
      </button>

      <div className="relative">
        <button onClick={() => setShowOrientation(!showOrientation)} className={`w-9 h-9 flex items-center justify-center rounded-md transition-all border-none bg-transparent cursor-pointer ${showOrientation ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'hover:bg-slate-200/50 text-slate-700'}`} title="View Orientation">
          <ViewIcon />
        </button>

        {showOrientation && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-48 bg-white/95 backdrop-blur-2xl border border-slate-200 rounded-md shadow-2xl py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
            {[
              { id: 'NORMAL_TO', label: 'Normal To', key: 'N', color: 'bg-slate-700' },
              { id: 'FRONT', label: 'Front View', key: 'F', color: 'bg-blue-500' },
              { id: 'TOP', label: 'Top View', key: 'T', color: 'bg-green-500' },
              { id: 'RIGHT', label: 'Right View', key: 'R', color: 'bg-red-500' },
              { id: 'ISOMETRIC', label: 'Isometric', key: 'I', color: 'bg-purple-500' }
            ].map((v) => (
              <button key={v.id} onClick={() => setOrientation(v.id as any)} className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-all flex items-center gap-3 border-none bg-transparent cursor-pointer">
                <span className={`w-5 h-5 ${v.color} text-white rounded-md flex items-center justify-center text-[10px] shadow-sm font-black`}>{v.key}</span>
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-[1px] h-6 bg-slate-300/50 mx-1" />

      <button
        onClick={() => {
          const next =
            viewportDisplayMode === 'SHADED_EDGES'
              ? 'WIREFRAME'
              : viewportDisplayMode === 'WIREFRAME'
                ? 'SHADED'
                : 'SHADED_EDGES';
          setViewportDisplayMode(next);
        }}
        className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-slate-200/50 text-slate-700 transition-all border-none bg-transparent cursor-pointer"
        title="顯示樣式：著色含邊線 / 線框"
      >
        <StyleIcon wireframe={viewportDisplayMode === 'WIREFRAME'} />
      </button>

      <button
        onClick={() => {
          const newState = !useCadStore.getState().sectionView.isActive;
          useCadStore.getState().setSectionView({ isActive: newState });
          useCadStore.getState().setActivePropertyManager(newState ? 'SECTION_VIEW' : null);
        }}
        className={`w-9 h-9 flex items-center justify-center rounded-md transition-all border-none cursor-pointer ${
          useCadStore.getState().sectionView.isActive
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700'
            : 'bg-transparent hover:bg-slate-200/50 text-slate-700'
        }`}
        title="Section View"
      >
        <SectionIcon />
      </button>

      {isSketchMode && (
        <>
          <div className="w-[1px] h-6 bg-slate-300/50 mx-1" />
          <button 
            onClick={() => setSketchMode(false)}
            className="px-3 h-9 flex items-center gap-2 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-all border border-emerald-200/50 cursor-pointer font-bold text-[11px] uppercase tracking-wider"
            title="Exit Sketch"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            Exit
          </button>
        </>
      )}
    </div>
  );
};
