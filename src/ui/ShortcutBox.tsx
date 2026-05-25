'use client';

import React, { useEffect, useRef } from 'react';
import { useCadStore } from '../store/useCadStore';

const LineIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="19" x2="19" y2="5"/><circle cx="5" cy="19" r="1"/><circle cx="19" cy="5" r="1"/></svg>;
const CircleIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/></svg>;
const RectIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>;
const DimIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m18 8 3 3-3 3"/><path d="m6 8-3 3 3 3"/><path d="M2 11h20"/><path d="M2 4v14"/><path d="M22 4v14"/></svg>;
const ExitIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>;
const ExtrudeIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
const MeasureIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.3 15.3l-5-5L19 7.7l-2-2L14.7 8l-5-5-1.4 1.4 1 1-1.5 1.5-1-1L5.4 7.3l1 1-1.5 1.5-1-1-1.4 1.4 5 5-2.3 2.3 2 2 2.3-2.3 5 5 1.4-1.4-1-1 1.5-1.5 1 1 1.4-1.4-1-1 1.5-1.5 1 1z"/></svg>;

export const ShortcutBox: React.FC = () => {
  const { shortcutBox, setShortcutBox, isSketchMode, setSketchTool, setSketchMode, setActivePlane } = useCadStore();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setShortcutBox(null);
    };
    if (shortcutBox?.visible) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [shortcutBox, setShortcutBox]);

  if (!shortcutBox?.visible) return null;

  const tools = isSketchMode ? [
    { id: 'LINE', icon: <LineIcon />, label: 'Line', action: () => setSketchTool('LINE') },
    { id: 'CIRCLE', icon: <CircleIcon />, label: 'Circle', action: () => setSketchTool('CIRCLE') },
    { id: 'RECTANGLE', icon: <RectIcon />, label: 'Rect', action: () => setSketchTool('RECTANGLE') },
    { id: 'SMART_DIM', icon: <DimIcon />, label: 'Dim', action: () => {} },
    { id: 'EXIT', icon: <ExitIcon />, label: 'Exit', action: () => { setShortcutBox(null); } },
  ] : [
    { id: 'EXTRUDE', icon: <ExtrudeIcon />, label: 'Extrude', action: () => {} },
    { id: 'MEASURE', icon: <MeasureIcon />, label: 'Measure', action: () => {} },
    { id: 'SKETCH', icon: <LineIcon />, label: 'Sketch', action: () => { setActivePlane('FRONT'); setSketchMode(true); } },
  ];

  return (
    <div ref={boxRef} className="fixed z-[1000] bg-surface border border-white/20 rounded-sm shadow-sm p-2 grid grid-cols-4 gap-2 animate-in fade-in zoom-in duration-200 select-none" style={{ left: shortcutBox.x, top: shortcutBox.y }}>
      {tools.map((tool) => (
        <button key={tool.id} onClick={() => { tool.action(); setShortcutBox(null); }} className="w-12 h-12 flex flex-col items-center justify-center rounded-xl hover:bg-background text-slate-700 hover:text-accent transition-all  group">
          <div className="group-hover:scale-110 transition-transform">{tool.icon}</div>
          <span className="text-[9px] font-black mt-1 uppercase tracking-tighter">{tool.label}</span>
        </button>
      ))}
    </div>
  );
};
