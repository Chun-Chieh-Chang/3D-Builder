'use client';

import React, { useState } from 'react';
import { useCadStore } from '../store/useCadStore';
import { HeavyEngineClient } from '../kernel/HeavyEngineClient';

export const InterferencePanel = () => {
  const {
    components,
    interferenceResults,
    setInterferenceResults,
    setInterferenceMeshes,
  } = useCadStore();

  const [isCalculating, setIsCalculating] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const handleCheckInterference = async () => {
    if (!components || components.length < 2) return;
    
    setIsCalculating(true);
    setSelectedIndex(null);
    setInterferenceMeshes([]);
    
    try {
      const client = HeavyEngineClient.getInstance();
      const results = await client.checkInterferences(components);
      setInterferenceResults(results);
      
      if (results.length === 0) {
        // useCadStore.getState().pushToast('未偵測到干涉 (No Interferences Detected)', 'info');
      }
    } catch (err) {
      console.error('[InterferencePanel] Calculation failed:', err);
    } finally {
      setIsCalculating(false);
    }
  };

  const handleSelectResult = (index: number) => {
    setSelectedIndex(index);
    const result = interferenceResults[index];
    if (result && result.mesh) {
      setInterferenceMeshes([result.mesh]);
    }
  };

  return (
    <div className="p-3 bg-white rounded-xl border border-slate-300 shadow-lg space-y-4 w-full animate-in fade-in slide-in-from-right-2 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-red-500 text-white rounded flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m21 21-4.3-4.3"/><circle cx="11" cy="11" r="8"/><path d="m11 8-2 2 2 2 2-2-2-2Z"/></svg>
          </div>
          <span className="text-[13px] font-black text-slate-800 uppercase tracking-wider">干涉檢查 (Interference)</span>
        </div>
      </div>

      {/* Action Button */}
      <button
        onClick={handleCheckInterference}
        disabled={isCalculating || components.length < 2}
        className={`w-full py-2 rounded-lg font-bold text-[12px] transition-all flex items-center justify-center gap-2 ${
          isCalculating 
            ? 'bg-slate-100 text-slate-400 cursor-wait' 
            : 'bg-red-600 text-white hover:bg-red-700 shadow-md active:scale-95'
        }`}
      >
        {isCalculating ? (
          <>
            <span className="w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin"></span>
            計算中...
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 2v20M2 12h20"/></svg>
            開始檢查 (Calculate)
          </>
        )}
      </button>

      {/* Results List */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center px-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase">偵測到 {interferenceResults.length} 處衝突</span>
        </div>
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {interferenceResults.length === 0 ? (
            <div className="py-8 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50 text-[11px] text-slate-400 italic">
              {components.length < 2 ? '請先載入至少兩個組件' : '點擊按鈕開始執行空間布林運算'}
            </div>
          ) : (
            interferenceResults.map((res, i) => (
              <div 
                key={i} 
                onClick={() => handleSelectResult(i)}
                className={`p-2 rounded-lg border transition-all cursor-pointer group ${
                  selectedIndex === i 
                    ? 'bg-red-50 border-red-300 ring-1 ring-red-200' 
                    : 'bg-white border-slate-200 hover:border-red-300 hover:bg-red-50/30'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold text-red-700">衝突 #{i + 1}</span>
                  <span className="text-[10px] font-mono text-slate-400">{(res.volume || 0).toFixed(3)} mm³</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-slate-600 font-medium">
                  <span className="truncate max-w-[80px]">{components.find(c => c.id === res.component_id_1)?.instanceName || 'Comp 1'}</span>
                  <span className="text-slate-300">↔</span>
                  <span className="truncate max-w-[80px]">{components.find(c => c.id === res.component_id_2)?.instanceName || 'Comp 2'}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Selection Warning */}
      {selectedIndex !== null && (
        <div className="p-2 bg-amber-50 rounded-lg border border-amber-100 text-[10px] text-amber-700 font-medium flex gap-2">
          <span className="text-sm">💡</span>
          <span>已在視埠中使用紅色高亮標示衝突區域。請調整配合 (Mates) 以消除干涉。</span>
        </div>
      )}
    </div>
  );
};
