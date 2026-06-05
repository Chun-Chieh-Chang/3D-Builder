'use client';

import React from 'react';
import { useCadStore, MateType, CADMate } from '../store/useCadStore';
import { v4 as uuidv4 } from 'uuid';
import { AssemblyService } from '../kernel/AssemblyService';

export const MatePanel = () => {
  const {
    mateSelection,
    clearMateSelection,
    mates,
    addMate,
    setMates,
    components,
    setComponents,
    setAssemblyPreviewComponents
  } = useCadStore();

  const [mateType, setMateType] = React.useState<MateType>('COINCIDENT');
  const [offset, setOffset] = React.useState<number>(0);
  const [angle, setAngle] = React.useState<number>(0);
  const [ratio, setRatio] = React.useState<number>(1);
  const [pitch, setPitch] = React.useState<number>(1.5);
  const [alignment, setAlignment] = React.useState<'ALIGNED' | 'ANTI_ALIGNED'>('ANTI_ALIGNED');
  const [isSuggesting, setIsSuggesting] = React.useState(false);

  const assemblyService = React.useMemo(() => new AssemblyService(), []);

  // 1. Suggest Mate Type & Alignment
  React.useEffect(() => {
    const triggerSuggestion = async () => {
      if (mateSelection.length === 2) {
        setIsSuggesting(true);
        try {
          const suggestion = await assemblyService.suggestMate(
            mateSelection.map(sel => {
              const comp = components.find(c => c.id === sel.componentId);
              return {
                componentId: sel.componentId || 'root',
                features: comp?.features || [],
                subshapeId: sel.id
              };
            })
          );
          setMateType(suggestion.type as MateType);
          setAlignment(suggestion.alignment);
        } catch (err) {
          console.error('[MatePanel] Suggestion failed:', err);
        } finally {
          setIsSuggesting(false);
        }
      } else {
        setAssemblyPreviewComponents(null);
      }
    };
    triggerSuggestion();
  }, [mateSelection, components, assemblyService, setAssemblyPreviewComponents]);

  // 2. Live Preview
  React.useEffect(() => {
    const updatePreview = async () => {
      if (mateSelection.length === 2) {
        const toMateEntity = (sel: (typeof mateSelection)[0]) => ({
          componentId: sel.componentId || 'root',
          topologyId: sel.id,
          localOrigin: (sel.coordinates ?? [0, 0, 0]) as [number, number, number],
          localNormal: (sel.normal ?? [0, 0, 1]) as [number, number, number],
        });

        const tempMate: CADMate = {
          id: 'preview',
          name: 'Preview',
          type: mateType,
          entity1: toMateEntity(mateSelection[0]),
          entity2: toMateEntity(mateSelection[1]),
          alignment,
          parameters: { 
            offset: (mateType === 'DISTANCE' || mateType === 'COINCIDENT') ? offset : 0, 
            angle: mateType === 'ANGLE' ? angle : 0,
            alignmentFlip: alignment === 'ANTI_ALIGNED' 
          },
        };

        try {
          const previewComponents = await assemblyService.solve(
            components,
            [...mates, tempMate],
            mateSelection,
          );
          setAssemblyPreviewComponents(previewComponents);
        } catch (err) {
          console.error('[MatePanel] Preview failed:', err);
        }
      }
    };
    updatePreview();
  }, [mateSelection, mateType, offset, angle, alignment, components, mates, assemblyService, setAssemblyPreviewComponents]);

  const handleApplyMate = async () => {
    if (mateSelection.length < 2) return;

    const toMateEntity = (sel: (typeof mateSelection)[0]) => ({
      componentId: sel.componentId || 'root',
      topologyId: sel.id,
      localOrigin: (sel.coordinates ?? [0, 0, 0]) as [number, number, number],
      localNormal: (sel.normal ?? [0, 0, 1]) as [number, number, number],
    });

    const initialTransforms: Record<string, any> = {};
    components.forEach(c => {
      initialTransforms[c.id] = { position: c.transform.position, rotation: c.transform.rotation };
    });

    const newMate: CADMate = {
      id: `mate_${uuidv4()}`,
      name: `${mateType === 'GEAR' || mateType === 'SCREW' ? '機械配合' : '配合'} ${mates.length + 1}`,
      type: mateType,
      entity1: toMateEntity(mateSelection[0]),
      entity2: toMateEntity(mateSelection[1]),
      alignment,
      parameters: { 
        offset: (mateType === 'DISTANCE' || mateType === 'COINCIDENT') ? offset : 0, 
        angle: mateType === 'ANGLE' ? angle : 0,
        alignmentFlip: alignment === 'ANTI_ALIGNED',
        ratio: mateType === 'GEAR' ? ratio : undefined,
        pitch: mateType === 'SCREW' ? pitch : undefined,
        initialTransforms
      },
      offset: (mateType === 'DISTANCE' || mateType === 'COINCIDENT') ? offset : undefined,
      angle: mateType === 'ANGLE' ? angle : undefined,
    };

    const finalComponents = await assemblyService.solve(
      components,
      [...mates, newMate],
      mateSelection,
    );
    
    addMate(newMate);
    setComponents(finalComponents);
    setAssemblyPreviewComponents(null);
    clearMateSelection();
  };

  return (
    <div className="p-3 bg-white rounded-xl border border-[#D1D5DB] shadow-sm space-y-4">
      <div className="text-[14px] text-slate-700 font-bold uppercase border-b border-[#D1D5DB]/50 pb-1 flex justify-between items-center">
        <span>配合管理器 (Mate Manager)</span>
        <span className="text-[13px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded font-mono">ASSEMBLY</span>
      </div>

      {/* Mate Type Selection */}
      <div className="space-y-3">
        <div>
          <div className="text-[10px] font-black text-slate-400 uppercase mb-1.5 tracking-widest">標準配合 (Standard)</div>
          <div className="grid grid-cols-4 gap-1">
            {(['COINCIDENT', 'PARALLEL', 'CONCENTRIC', 'DISTANCE', 'PERPENDICULAR', 'TANGENT', 'ANGLE'] as MateType[]).map((type) => (
              <button
                key={type}
                onClick={() => setMateType(type)}
                className={`p-1.5 rounded border text-[10px] font-bold transition-all ${
                  mateType === type
                    ? 'bg-primary/10 border-primary text-primary shadow-sm'
                    : 'bg-[#F8FAFC] border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {type.charAt(0) + type.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[10px] font-black text-slate-400 uppercase mb-1.5 tracking-widest">機械配合 (Mechanical)</div>
          <div className="grid grid-cols-2 gap-1.5">
            {(['GEAR', 'SCREW'] as MateType[]).map((type) => (
              <button
                key={type}
                onClick={() => setMateType(type)}
                className={`p-2 rounded border text-[11px] font-black transition-all ${
                  mateType === type
                    ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-inner'
                    : 'bg-[#F8FAFC] border-slate-200 text-slate-500 hover:bg-slate-100'
                }`}
              >
                {type === 'GEAR' ? '⚙️ Gear' : '🔩 Screw'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Selection Summary */}
      <div className="space-y-2">
        <div className="text-[12px] text-slate-500 font-bold uppercase">選取實體 ({mateSelection.length}/2)</div>
        <div className="min-h-[60px] bg-slate-50 rounded border border-dashed border-slate-300 p-2 space-y-1">
          {mateSelection.length === 0 ? (
            <div className="text-[12px] text-slate-400 italic text-center py-4">
              在視埠中選取兩個面或邊以建立配合
            </div>
          ) : (
            mateSelection.map((ent, i) => {
              const surfaceType = ent.signature && 'surface_type' in ent.signature ? (ent.signature as any).surface_type : null;
              return (
                <div key={i} className="text-[12px] bg-white p-1.5 rounded border border-slate-200 flex justify-between items-center"> 
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-700">{ent.type}</span> 
                    {surfaceType === 'CYLINDER' && (
                      <span className="text-[9px] bg-blue-100 text-blue-700 px-1 py-0.5 rounded font-mono uppercase">圓柱軸心</span>
                    )}
                  </div>
                  <span className="text-slate-500 font-mono text-[10px]">{ent.id.slice(0, 8)}</span> 
                </div>
              );
            })
          )}
        </div> </div>

      {/* Mate Settings */}
      {(mateType === 'DISTANCE' || mateType === 'COINCIDENT') && (
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-slate-600 font-medium whitespace-nowrap">距離 (Offset):</span>
          <div className="relative flex-1">
            <input
              type="number"
              value={offset}
              onChange={(e) => setOffset(parseFloat(e.target.value))}
              className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[13px] focus:border-primary outline-none text-right pr-7 font-mono"
            />
            <span className="absolute right-2 top-1.5 text-[11px] text-slate-400 font-bold">mm</span>
          </div>
        </div>
      )}

      {mateType === 'ANGLE' && (
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-slate-600 font-medium whitespace-nowrap">角度 (Angle):</span>
          <div className="relative flex-1">
            <input
              type="number"
              value={angle}
              onChange={(e) => setAngle(parseFloat(e.target.value))}
              className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[13px] focus:border-primary outline-none text-right pr-7 font-mono"
            />
            <span className="absolute right-2 top-1.5 text-[11px] text-slate-400 font-bold">deg</span>
          </div>
        </div>
      )}

      {mateType === 'GEAR' && (
        <div className="flex items-center gap-2 p-2 bg-indigo-50/50 rounded-lg border border-indigo-100 animate-in fade-in slide-in-from-top-1 duration-200">
          <span className="text-[12px] text-indigo-700 font-black whitespace-nowrap">比率 (Ratio):</span>
          <div className="relative flex-1">
            <input
              type="number"
              value={ratio}
              onChange={(e) => setRatio(parseFloat(e.target.value))}
              className="w-full bg-white border border-indigo-200 rounded px-2 py-1 text-[13px] font-mono text-right"
            />
          </div>
        </div>
      )}

      {mateType === 'SCREW' && (
        <div className="flex items-center gap-2 p-2 bg-indigo-50/50 rounded-lg border border-indigo-100 animate-in fade-in slide-in-from-top-1 duration-200">
          <span className="text-[12px] text-indigo-700 font-black whitespace-nowrap">節距 (Pitch):</span>
          <div className="relative flex-1">
            <input
              type="number"
              value={pitch}
              onChange={(e) => setPitch(parseFloat(e.target.value))}
              className="w-full bg-white border border-indigo-200 rounded px-2 py-1 text-[13px] font-mono text-right pr-12"
            />
            <span className="absolute right-2 top-1.5 text-[10px] text-indigo-400 font-bold">mm/rev</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2"> <button
          onClick={() => setAlignment(alignment === 'ALIGNED' ? 'ANTI_ALIGNED' : 'ALIGNED')}
          className="flex-1 p-1.5 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 text-[12px] font-bold text-slate-700 transition-all"
        >
          {alignment === 'ALIGNED' ? 'Aligned' : 'Anti-Aligned'}
        </button> </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={clearMateSelection}
          className="flex-1 p-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded border border-slate-200 text-[13px] font-bold transition-all"
        >
          清除
        </button>
        <button
          onClick={handleApplyMate}
          disabled={mateSelection.length < 2}
          className="flex-[2] p-2 bg-primary text-white hover:bg-primary-dark disabled:opacity-50 rounded shadow-md text-[13px] font-bold transition-all"
        >
          加入配合
        </button>
      </div>

      {/* Existing Mates List */}
      {mates.length > 0 && (
        <div className="pt-2 border-t border-slate-200">
          <div className="text-[12px] text-slate-500 font-bold uppercase mb-2">現有配合 ({mates.length})</div>
          <div className="max-h-[120px] overflow-y-auto space-y-1 pr-1">
            {mates.map((mate) => (
              <div key={mate.id} className="text-[12px] p-2 bg-slate-50 rounded border border-slate-100 flex items-center justify-between group"> <div className="flex flex-col"> <span className="font-bold text-slate-700">{mate.name}</span> <span className="text-[10px] text-slate-500 uppercase">{mate.type}</span> </div> <button 
                  onClick={() => setMates(mates.filter(m => m.id !== mate.id))}
                  className="text-error opacity-0 group-hover:opacity-100 transition-all text-[11px] font-bold"
                >
                  刪除
                </button>
              </div>
            ))}
          </div> </div>
      )}
    </div>
  );
};
