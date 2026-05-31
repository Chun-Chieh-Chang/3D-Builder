'use client';

import React from 'react';
import { useCadStore } from '../store/useCadStore';
import { HeavyEngineClient } from '../kernel/HeavyEngineClient';

export const AssemblyTreePanel = () => {
  const {
    components,
    setComponents,
    activeComponentId,
    setActiveComponentId,
    setInterferenceMeshes,
    features,
  } = useCadStore();

  const handleToggleVisibility = (id: string) => {
    setComponents(components.map(c => c.id === id ? { ...c, visible: !c.visible } : c));
  };

  const handleDeleteComponent = (id: string) => {
    if (confirm('確定要從裝配體中移除此組件嗎？')) {
      setComponents(components.filter(c => c.id !== id));
      if (activeComponentId === id) setActiveComponentId(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-left-2 duration-300">
      {/* Header */}
      <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-indigo-500 text-white rounded flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          </div>
          <span className="text-[13px] font-black text-slate-800 uppercase tracking-wider">裝配體樹 (Assembly Tree)</span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {components.length === 0 ? (
          <div className="py-12 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50 text-[11px] text-slate-400 italic">
            尚未加入任何組件
          </div>
        ) : (
          components.map((comp) => (
            <div
              key={comp.id}
              onClick={() => setActiveComponentId(comp.id)}
              className={`p-2 rounded-lg border transition-all cursor-pointer group flex items-center justify-between ${
                activeComponentId === comp.id
                  ? 'bg-indigo-50 border-indigo-300'
                  : 'bg-white border-slate-100 hover:border-indigo-200 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">{comp.isFixed ? '📌' : '📦'}</span>
                <span className={`text-[12px] font-bold ${activeComponentId === comp.id ? 'text-indigo-800' : 'text-slate-700'}`}>
                  {comp.instanceName}
                </span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); handleToggleVisibility(comp.id); }}
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-200 text-slate-500"
                >
                  {comp.visible ? '👁️' : '🕶️'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteComponent(comp.id); }}
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-500 hover:text-white text-slate-400 font-bold"
                >
                  ×
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Assembly Tools */}
      <div className="p-2 bg-slate-50 border-t border-slate-200 space-y-1.5">
        <button
          onClick={async () => {
            if (components.length === 0) return alert('裝配體中無組件');
            try {
              const client = HeavyEngineClient.getInstance();
              const filename = `Assembly_${Date.now()}.step`;
              const success = await client.exportAssemblyStep(components, filename);
              if (success) {
                alert(`匯出成功！檔案已存至下載資料夾：${filename}`);
              } else {
                alert('匯出失敗');
              }
            } catch (err) {
              console.error(err);
              alert('匯出失敗');
            }
          }}
          className="w-full py-1.5 px-2 text-[12px] font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded transition-colors flex items-center justify-center gap-1"
        >
          <span>📥</span>
          <span>匯出 STEP (Export Assembly)</span>
        </button>
        <button
          onClick={async () => {
            if (components.length < 2) return alert('需要至少兩個組件才能進行干涉檢查');
            try {
              const client = HeavyEngineClient.getInstance();
              const res = await client.checkInterferences(components);
              if (res && res.length > 0) {
                useCadStore.getState().setInterferenceResults(res);
                setInterferenceMeshes(res.map((r: any) => r.mesh));
                alert(`發現 ${res.length} 處干涉！已在畫面中以紅色高亮標示。`);
                useCadStore.getState().setInterferenceActive(true);
              } else {
                setInterferenceMeshes([]);
                alert('未偵測到干涉，組裝完美！');
              }
            } catch (err) {
              console.error(err);
              alert('干涉檢查失敗');
            }
          }}
          className="w-full py-1.5 px-2 text-[12px] font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded transition-colors flex items-center justify-center gap-1"
        >
          <span>⚠️</span>
          <span>干涉檢查 (Interference)</span>
        </button>
      </div>
    </div>
  );
};
