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
    selectedSubNodeType,
    features,
    removeFeature
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
    if (selectedId && selectedSubNodeType === 'FEATURE') {
      const feature = features.find((f: any) => f.id === selectedId);
      if (feature) {
        // Logic to trigger edit sketch
        // This is usually handled in page.tsx, we might need to expose a handler
      }
    }
    setContextMenu(null);
  };

  const handleDelete = () => {
    if (selectedId) {
      removeFeature(selectedId);
    }
    setContextMenu(null);
  };

  return (
    <div 
      ref={menuRef}
      className="fixed z-[1100] bg-white border border-slate-200 rounded-lg shadow-2xl py-1 min-w-[160px] animate-in fade-in slide-in-from-top-1 duration-100"
      style={{ left: contextMenu.x, top: contextMenu.y }}
    >
      {/* Quick Action Icons Row */}
      <div className="flex items-center justify-around px-2 py-1.5 border-b border-slate-100 mb-1">
        <button onClick={handleEdit} className="p-1.5 hover:bg-slate-100 rounded text-slate-700" title="編輯草圖">✏️</button>
        <button onClick={() => { triggerCameraNormal(); setContextMenu(null); }} className="p-1.5 hover:bg-slate-100 rounded text-slate-700" title="正視於">🎯</button>
        <button className="p-1.5 hover:bg-slate-100 rounded text-slate-700 opacity-40" title="隱藏">👁️</button>
        <button onClick={handleDelete} className="p-1.5 hover:bg-slate-100 rounded text-red-600 hover:bg-red-50" title="刪除">🗑️</button>
      </div>

      {/* Menu Items */}
      <button className="w-full text-left px-4 py-1.5 text-[13px] text-slate-700 hover:bg-primary/10 hover:text-primary transition-colors flex items-center justify-between">
        <span>編輯特徵 (Edit Feature)</span>
        <span className="text-[10px] text-slate-400">Ctrl+E</span>
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
