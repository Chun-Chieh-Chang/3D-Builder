'use client';

import React from 'react';
import { useCadStore, MateType, CADMate } from '../store/useCadStore';
import { AssemblyService } from '../kernel/AssemblyService';

export const MatePanel = () => {
  const {
    mateSelection,
    clearMateSelection,
    mates,
    addMate,
    setMates,
    components,
    setComponents
  } = useCadStore();

  const [mateType, setMateType] = React.useState<MateType>('COINCIDENT');
  const [offset, setOffset] = React.useState<number>(0);
  const [alignment, setAlignment] = React.useState<'ALIGNED' | 'ANTI_ALIGNED'>('ANTI_ALIGNED');

  const assemblyService = new AssemblyService();

  const handleApplyMate = async () => {
    if (mateSelection.length < 2) return;

    const newMate: CADMate = {
      id: `mate_${Date.now()}`,
      name: `Mate ${mates.length + 1}`,
      type: mateType,
      entity1: {
        componentId: mateSelection[0].componentId || 'root',
        topologyId: mateSelection[0].id
      },
      entity2: {
        componentId: mateSelection[1].componentId || 'root',
        topologyId: mateSelection[1].id
      },
      alignment: alignment,
      offset: mateType === 'DISTANCE' ? offset : undefined
    };

    addMate(newMate);
    clearMateSelection();
    
    // Trigger solver
    const updatedComponents = await assemblyService.solve(components, [...mates, newMate]);
    setComponents(updatedComponents);
  };

  return (
    <div className="p-3 bg-white rounded-xl border border-[#D1D5DB] shadow-sm space-y-4"> <div className="text-[14px] text-slate-700 font-bold uppercase border-b border-[#D1D5DB]/50 pb-1 flex justify-between items-center"> <span className="flex items-center gap-1">??  (Mate Manager)</span> <span className="text-[13px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded font-mono">ASSEMBLY</span> </div>

      {/* Mate Type Selection */}
      <div className="grid grid-cols-3 gap-1.5">
        {(['COINCIDENT', 'PARALLEL', 'CONCENTRIC', 'DISTANCE', 'PERPENDICULAR', 'TANGENT'] as MateType[]).map((type) => (
          <button
            key={type}
            onClick={() => setMateType(type)}
            className={`p-1.5 rounded border text-[11px] font-bold transition-all ${
              mateType === type
                ? 'bg-primary/10 border-primary text-primary shadow-sm'
                : 'bg-[#F8FAFC] border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            {type.charAt(0) + type.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Selection Summary */}
      <div className="space-y-2"> <div className="text-[12px] text-slate-500 font-bold uppercase">???? ({mateSelection.length}/2)</div> <div className="min-h-[60px] bg-slate-50 rounded border border-dashed border-slate-300 p-2 space-y-1">
          {mateSelection.length === 0 ? (
            <div className="text-[12px] text-slate-400 italic text-center py-4">
              ???
            </div>
          ) : (
            mateSelection.map((ent, i) => (
              <div key={i} className="text-[12px] bg-white p-1 rounded border border-slate-200 flex justify-between"> <span className="font-bold text-slate-700">{ent.type}</span> <span className="text-slate-500 font-mono text-[10px]">{ent.id.slice(0, 8)}</span> </div>
            ))
          )}
        </div> </div>

      {/* Mate Settings */}
      {mateType === 'DISTANCE' && (
        <div className="flex items-center gap-2"> <span className="text-[13px] text-slate-600 font-medium">?:</span> <input
            type="number"
            value={offset}
            onChange={(e) => setOffset(parseFloat(e.target.value))}
            className="flex-1 bg-white border border-slate-300 rounded px-2 py-1 text-[13px] focus:border-primary outline-none"
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-2"> <button
          onClick={() => setAlignment(alignment === 'ALIGNED' ? 'ANTI_ALIGNED' : 'ALIGNED')}
          className="flex-1 p-1.5 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 text-[12px] font-bold text-slate-700 transition-all"
        >
          {alignment === 'ALIGNED' ? 'Aligned' : 'Anti-Aligned'}
        </button> </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2"> <button
          onClick={clearMateSelection}
          className="flex-1 p-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded border border-slate-200 text-[13px] font-bold transition-all"
        > </button> <button
          onClick={handleApplyMate}
          disabled={mateSelection.length < 2}
          className="flex-[2] p-2 bg-primary text-white hover:bg-primary-dark disabled:opacity-50 rounded shadow-md text-[13px] font-bold transition-all"
        >
           (Add Mate)
        </button> </div>

      {/* Existing Mates List */}
      {mates.length > 0 && (
        <div className="pt-2 border-t border-slate-200"> <div className="text-[12px] text-slate-500 font-bold uppercase mb-2">?? ??? ({mates.length})</div> <div className="max-h-[120px] overflow-y-auto space-y-1 pr-1">
            {mates.map((mate) => (
              <div key={mate.id} className="text-[12px] p-2 bg-slate-50 rounded border border-slate-100 flex items-center justify-between group"> <div className="flex flex-col"> <span className="font-bold text-slate-700">{mate.name}</span> <span className="text-[10px] text-slate-500 uppercase">{mate.type}</span> </div> <button 
                  onClick={() => setMates(mates.filter(m => m.id !== mate.id))}
                  className="text-error opacity-0 group-hover:opacity-100 transition-all text-[11px] font-bold"
                >
                  ??
                </button> </div>
            ))}
          </div> </div>
      )}
    </div>
  );
};
