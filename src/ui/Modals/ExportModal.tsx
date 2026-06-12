'use client';

import React, { useState } from 'react';
import { useCadStore } from '../../store/useCadStore';
import { HeavyEngineClient } from '../../kernel/HeavyEngineClient';

interface ExportModalProps {
  onClose: () => void;
  activeTab: string;
}

export const ExportModal: React.FC<ExportModalProps> = ({ onClose, activeTab }) => {
  const { projectName, features, pushToast, components } = useCadStore();
  const [format, setFormat] = useState<'STEP' | 'IGES' | 'STL' | 'PDF' | 'DXF'>('STEP');
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    const client = HeavyEngineClient.getInstance();
    const filename = `${projectName || 'Part'}_exported.${format.toLowerCase()}`;
    
    try {
      let success = false;
      
      if (format === 'PDF') {
        // PDF is handled via window.print or a specialized drawing export
        const printHook = (window as any).__handlePrintToPDF;
        if (printHook) {
          await printHook();
          success = true;
        } else {
          pushToast('PDF Export: No active drawing session found.', 'error');
        }
      } else if (activeTab === 'ASSEMBLY') {
        // Assembly Export (STEP only for now via backend XDE)
        if (format !== 'STEP') {
          pushToast(`Assembly export currently only supports STEP format.`, 'warning');
          setIsExporting(false);
          return;
        }
        success = await client.exportAssemblyStep(components, filename);
      } else {
        // Part Export
        success = await client.exportCadFile(features, format, filename);
      }

      if (success) {
        pushToast(`Successfully exported to ${filename}`, 'info');
        onClose();
      } else {
        pushToast(`Export failed. Check backend logs.`, 'error');
      }
    } catch (err) {
      console.error('[ExportModal] Failed:', err);
      pushToast(`Export error: ${err}`, 'error');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[1000] p-4">
      <div className="w-[540px] bg-[#F8FAFC] border border-slate-300 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#005B9A] to-[#0078D4] p-4 flex justify-between items-center text-white">
          <h3 className="text-[14px] font-black tracking-wider uppercase flex items-center gap-2">
            <span>📦</span> 工業級檔案匯出 (Industrial Export)
          </h3>
          <button onClick={onClose} className="hover:text-slate-200 text-xl font-bold leading-none">×</button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">檔案格式 (Format)</label>
            <div className="grid grid-cols-3 gap-3">
              {(['STEP', 'IGES', 'STL', 'PDF', 'DXF'] as const).map(fmt => (
                <button
                  key={fmt}
                  onClick={() => setFormat(fmt)}
                  className={`p-4 rounded-md border-2 transition-all flex flex-col items-center gap-2 ${
                    format === fmt 
                      ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-inner' 
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span className="text-xl">
                    {fmt === 'STEP' ? '📐' : fmt === 'IGES' ? '🧊' : fmt === 'STL' ? '🖨️' : fmt === 'DXF' ? '✒️' : '📄'}
                  </span>
                  <span className="font-bold text-[13px]">{fmt}</span>
                  <span className="text-[9px] opacity-70">
                    {fmt === 'STEP' ? '最推薦 (通用)' : fmt === 'IGES' ? '舊型系統' : fmt === 'STL' ? '3D 打印' : fmt === 'DXF' ? '2D 向量圖紙' : '工程視圖'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-slate-100 p-4 rounded border border-slate-200 space-y-2">
            <div className="flex justify-between text-[11px] text-slate-500 font-bold uppercase tracking-wider">
              <span>當前模式:</span>
              <span className="text-blue-600">{activeTab}</span>
            </div>
            <div className="text-[12px] text-slate-700">
              檔案將匯出至專案下載目錄，預設名稱為:
              <span className="block font-mono bg-white p-1 mt-1 border border-slate-300 rounded text-[10px]">
                {projectName || 'Part'}_exported.{format.toLowerCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2 text-slate-600 font-bold text-[13px] hover:bg-slate-100 rounded transition-colors"
          >
            取消
          </button>
          <button
            disabled={isExporting}
            onClick={handleExport}
            className={`px-8 py-2 bg-[#005B9A] text-white font-bold text-[13px] rounded shadow-md hover:bg-[#004A80] transition-all flex items-center gap-2 ${isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isExporting ? (
              <>
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                匯出中...
              </>
            ) : (
              '執行匯出'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
