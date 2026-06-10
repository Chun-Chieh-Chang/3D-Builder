'use client';

import React from 'react';
import { useCadStore, MATERIAL_PRESETS } from '../../store/useCadStore';

export const MaterialSelectorModal: React.FC = () => {
  const { 
    showMaterialModal, setShowMaterialModal, 
    targetMaterialEntity, setTargetMaterialEntity,
    updateComponentColor, setPartMaterial, features, updateFeatureProperty
  } = useCadStore();

  if (!showMaterialModal || !targetMaterialEntity) return null;

  const handleApplyMaterial = (materialId: string) => {
    const material = MATERIAL_PRESETS[materialId];
    if (!material) return;

    if (targetMaterialEntity.type === 'COMPONENT') {
      updateComponentColor(targetMaterialEntity.id, material.color);
    } else if (targetMaterialEntity.type === 'PART') {
      setPartMaterial(materialId);
    } else if (targetMaterialEntity.type === 'FEATURE') {
      updateFeatureProperty(targetMaterialEntity.id, 'color', material.color);
      updateFeatureProperty(targetMaterialEntity.id, 'materialId', materialId);
    }

    setShowMaterialModal(false);
    setTargetMaterialEntity(null);
  };

  return (
    <div 
      className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={() => setShowMaterialModal(false)}
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">
            Appearance Selector
          </h3>
          <button 
            onClick={() => setShowMaterialModal(false)}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            ✕
          </button>
        </div>
        
        <div className="p-4 grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto custom-scrollbar">
          {Object.entries(MATERIAL_PRESETS).map(([id, data]) => (
            <button
              key={id}
              onClick={() => handleApplyMaterial(id)}
              className="flex flex-col gap-2 p-3 rounded-xl border border-slate-100 hover:border-primary hover:bg-primary/5 transition-all text-left group"
            >
              <div 
                className="w-full h-12 rounded-lg shadow-inner group-hover:scale-[1.02] transition-transform"
                style={{ backgroundColor: data.color }}
              />
              <span className="text-[11px] font-bold text-slate-700">{id}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
