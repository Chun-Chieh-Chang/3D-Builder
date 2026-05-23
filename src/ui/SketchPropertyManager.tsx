'use client';

import React, { useMemo } from 'react';
import { useCadStore, SketchConstraint } from '../store/useCadStore';
import { solveConstraints } from '../utils/geometry/ConstraintSolver';
import { v4 as uuidv4 } from 'uuid';

export const SketchPropertyManager: React.FC = () => {
  const { 
    sketchNodes, setSketchNodes, 
    sketchEdges, 
    sketchConstraints, setSketchConstraints,
    selectedEntityIds 
  } = useCadStore();

  // Parse selection
  const selectedNodes = useMemo(() => {
    return selectedEntityIds.filter(id => sketchNodes[id]).map(id => sketchNodes[id]);
  }, [selectedEntityIds, sketchNodes]);

  const selectedEdges = useMemo(() => {
    return selectedEntityIds.filter(id => sketchEdges[id]).map(id => sketchEdges[id]);
  }, [selectedEntityIds, sketchEdges]);

  // Unified constraint applicator
  const applyConstraint = (type: SketchConstraint['type']) => {
    const cid = uuidv4();
    const newConstraint: SketchConstraint = { id: cid, type };

    if (type === 'HORIZONTAL' || type === 'VERTICAL') {
      if (selectedEdges.length !== 1) return;
      newConstraint.edgeIds = [selectedEdges[0].id];
    } else if (type === 'COINCIDENT' || type === 'DISTANCE') {
      if (selectedNodes.length !== 2) return;
      newConstraint.nodeIds = [selectedNodes[0].id, selectedNodes[1].id];
      if (type === 'DISTANCE') {
        const n1 = selectedNodes[0];
        const n2 = selectedNodes[1];
        newConstraint.value = Math.hypot(n2.x - n1.x, n2.y - n1.y);
      }
    } else if (type === 'EQUAL') {
      if (selectedEdges.length !== 2) return;
      newConstraint.edgeIds = [selectedEdges[0].id, selectedEdges[1].id];
    }

    const nextConstraints = { ...sketchConstraints, [cid]: newConstraint };
    setSketchConstraints(nextConstraints);

    // Run solver immediately to close the loop!
    const nextNodes = solveConstraints(sketchNodes, sketchEdges, nextConstraints);
    setSketchNodes(nextNodes);
  };

  const deleteConstraint = (cid: string) => {
    const nextConstraints = { ...sketchConstraints };
    delete nextConstraints[cid];
    setSketchConstraints(nextConstraints);
    // Might need to re-solve from scratch or let physics relax, but PBD is order independent mostly
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Selection Info Card */}
      <div className="p-2.5 bg-white rounded-xl border border-[#D1D5DB] shadow-sm space-y-2 relative overflow-hidden backdrop-blur-md bg-white/70">
        <div className="absolute inset-0 pointer-events-none border border-white/40 rounded-xl" />
        <div className="text-[14px] text-slate-700 font-bold uppercase border-b border-[#D1D5DB]/50 pb-1 flex justify-between items-center relative z-10">
          <span className="flex items-center gap-1">🎯 選擇物件 (Selection)</span>
          <span className="text-[13px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded font-mono">{selectedEntityIds.length} ITEMS</span>
        </div>

        <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-0.5 relative z-10">
          {selectedNodes.map(node => (
            <div key={node.id} className="flex justify-between items-center bg-blue-50 border border-blue-200 p-1.5 rounded text-[13px] text-blue-800">
              <span className="font-bold">節點 (Node)</span>
              <span className="font-mono text-[11px] text-blue-600">[{node.x.toFixed(1)}, {node.y.toFixed(1)}]</span>
            </div>
          ))}
          {selectedEdges.map(edge => (
            <div key={edge.id} className="flex justify-between items-center bg-emerald-50 border border-emerald-200 p-1.5 rounded text-[13px] text-emerald-800">
              <span className="font-bold">邊線 ({edge.type})</span>
            </div>
          ))}
          {selectedEntityIds.length === 0 && (
            <div className="text-[13px] text-slate-400 text-center py-2">
              請在畫面中點選點或線段以新增約束。
            </div>
          )}
        </div>
      </div>

      {/* Constraints Tool Card */}
      <div className="p-2.5 bg-[#F0F7FB] rounded-xl border border-[#B4D8E7] shadow-sm space-y-2 relative overflow-hidden backdrop-blur-xl">
        <div className="absolute inset-0 pointer-events-none border border-white/60 rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]" />
        <div className="text-[14px] text-[#1A3A5F] font-bold uppercase border-b border-[#B4D8E7] pb-1 flex justify-between items-center relative z-10">
          <span>🔗 幾何約束 (Constraints)</span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[13px] relative z-10">
          <button
            onClick={() => applyConstraint('HORIZONTAL')}
            disabled={selectedEdges.length !== 1}
            className="flex items-center gap-1.5 p-1.5 bg-white hover:bg-[#3A7CA8] hover:text-white rounded border border-[#B4D8E7] active:scale-95 transition-all text-[#1A3A5F] font-bold disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-[#1A3A5F]"
          >
            <span>➖</span> 水平
          </button>
          
          <button
            onClick={() => applyConstraint('VERTICAL')}
            disabled={selectedEdges.length !== 1}
            className="flex items-center gap-1.5 p-1.5 bg-white hover:bg-[#3A7CA8] hover:text-white rounded border border-[#B4D8E7] active:scale-95 transition-all text-[#1A3A5F] font-bold disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-[#1A3A5F]"
          >
            <span>➗</span> 垂直
          </button>

          <button
            onClick={() => applyConstraint('COINCIDENT')}
            disabled={selectedNodes.length !== 2}
            className="flex items-center gap-1.5 p-1.5 bg-white hover:bg-[#3A7CA8] hover:text-white rounded border border-[#B4D8E7] active:scale-95 transition-all text-[#1A3A5F] font-bold disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-[#1A3A5F]"
          >
            <span>🎯</span> 共點
          </button>

          <button
            onClick={() => applyConstraint('EQUAL')}
            disabled={selectedEdges.length !== 2}
            className="flex items-center gap-1.5 p-1.5 bg-white hover:bg-[#3A7CA8] hover:text-white rounded border border-[#B4D8E7] active:scale-95 transition-all text-[#1A3A5F] font-bold disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-[#1A3A5F]"
          >
            <span>⚖️</span> 等長
          </button>
          
          <button
            onClick={() => applyConstraint('DISTANCE')}
            disabled={selectedNodes.length !== 2}
            className="col-span-2 flex items-center justify-center gap-1.5 p-1.5 bg-white hover:bg-[#3A7CA8] hover:text-white rounded border border-[#B4D8E7] active:scale-95 transition-all text-[#1A3A5F] font-bold disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-[#1A3A5F]"
          >
            <span>📏</span> 設定距離 (固定長度)
          </button>
        </div>
      </div>

      {/* Active Constraints List */}
      {Object.keys(sketchConstraints).length > 0 && (
        <div className="p-2.5 bg-white rounded-xl border border-[#D1D5DB] shadow-sm space-y-2">
          <div className="text-[14px] text-slate-700 font-bold uppercase border-b border-[#D1D5DB]/50 pb-1">
            <span>作用中的約束</span>
          </div>
          <div className="space-y-1 max-h-[150px] overflow-y-auto">
            {Object.values(sketchConstraints).map(c => (
              <div key={c.id} className="flex justify-between items-center text-[12px] bg-slate-50 border border-slate-200 p-1 rounded group">
                <span className="font-bold text-slate-600">{c.type}</span>
                <button 
                  onClick={() => deleteConstraint(c.id)}
                  className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity font-bold px-1"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
