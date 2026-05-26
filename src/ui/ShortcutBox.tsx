'use client';

import React, { useEffect, useRef } from 'react';
import { useCadStore } from '../store/useCadStore';

export const ShortcutBox: React.FC = () => {
  const { 
    shortcutBox, 
    setShortcutBox, 
    isSketchMode, 
    setSketchTool, 
    setSketchMode,
    setActivePlane,
    triggerCameraNormal,
    // handleExitAndExtrude // Assuming this exists in a way we can call or we use a wrapper
  } = useCadStore();

  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setShortcutBox(null);
      }
    };
    if (shortcutBox?.visible) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [shortcutBox, setShortcutBox]);

  if (!shortcutBox?.visible) return null;

  const tools = isSketchMode ? [
    { id: 'LINE', icon: '📏', label: '直線 (L)', action: () => setSketchTool('LINE') },
    { id: 'CIRCLE', icon: '⭕', label: '圓 (C)', action: () => setSketchTool('CIRCLE') },
    { id: 'RECTANGLE', icon: '矩', label: '矩形 (R)', action: () => setSketchTool('RECTANGLE') },
    { id: 'SMART_DIM', icon: '📐', label: '智慧尺寸 (D)', action: () => {} }, // Logic to be linked
    { id: 'EXIT', icon: '✅', label: '退出草圖', action: () => { setShortcutBox(null); } },
  ] : [
    { id: 'EXTRUDE', icon: '🏗️', label: '伸長實體', action: () => {} },
    { id: 'CUT', icon: '🕳️', label: '伸長除料', action: () => {} },
    { id: 'MEASURE', icon: '⚖️', label: '量測', action: () => {} },
    { id: 'SKETCH', icon: '✏️', label: '草圖', action: () => {
      setActivePlane('FRONT');
      setSketchMode(true);
    }},
  ];

  return (
    <div 
      ref={boxRef}
      className="fixed z-[1000] bg-white/80 backdrop-blur-xl border border-slate-200 rounded-xl shadow-2xl p-1.5 grid grid-cols-4 gap-1 animate-in fade-in zoom-in duration-150"
      style={{ left: shortcutBox.x, top: shortcutBox.y }}
    >
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => {
            tool.action();
            setShortcutBox(null);
          }}
          className="w-12 h-12 flex flex-col items-center justify-center rounded-lg hover:bg-primary/10 hover:text-primary transition-all group"
          title={tool.label}
        >
          <span className="text-xl group-hover:scale-110 transition-transform">{tool.icon}</span>
          <span className="text-[9px] font-bold mt-0.5 whitespace-nowrap">{tool.label.split(' ')[0]}</span>
        </button>
      ))}
    </div>
  );
};
