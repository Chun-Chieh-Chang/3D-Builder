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

  const selectedConstraints = useMemo(() => {
    return selectedEntityIds.filter(id => sketchConstraints[id]).map(id => sketchConstraints[id]);
  }, [selectedEntityIds, sketchConstraints]);

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
    } else if (type === 'CONCENTRIC') {
      if (selectedEdges.length !== 2) return;
      newConstraint.edgeIds = [selectedEdges[0].id, selectedEdges[1].id];
    } else if (type === 'TANGENT') {
      if (selectedEdges.length !== 2) return;
      const hasLine = selectedEdges.some(e => e.type === 'LINE');
      const hasCircle = selectedEdges.some(e => e.type === 'CIRCLE');
      if (!hasLine || !hasCircle) return;
      newConstraint.edgeIds = [selectedEdges[0].id, selectedEdges[1].id];
    } else if (type === 'ANGLE') {
      if (selectedEdges.length !== 2) return;
      if (selectedEdges[0].type !== 'LINE' || selectedEdges[1].type !== 'LINE') return;
      newConstraint.edgeIds = [selectedEdges[0].id, selectedEdges[1].id];
      
      const e1 = selectedEdges[0];
      const e2 = selectedEdges[1];
      const p1a = sketchNodes[e1.nodeIds[0]];
      const p1b = sketchNodes[e1.nodeIds[1]];
      const p2a = sketchNodes[e2.nodeIds[0]];
      const p2b = sketchNodes[e2.nodeIds[1]];
      if (p1a && p1b && p2a && p2b) {
        const dx1 = p1b.x - p1a.x;
        const dy1 = p1b.y - p1a.y;
        const dx2 = p2b.x - p2a.x;
        const dy2 = p2b.y - p2a.y;
        const len1 = Math.hypot(dx1, dy1);
        const len2 = Math.hypot(dx2, dy2);
        if (len1 > 1e-4 && len2 > 1e-4) {
          const angle1 = Math.atan2(dy1, dx1);
          const angle2 = Math.atan2(dy2, dx2);
          let currentAngleDeg = Math.abs((angle2 - angle1) * 180.0 / Math.PI);
          if (currentAngleDeg > 180.0) currentAngleDeg = 360.0 - currentAngleDeg;
          
          const valStr = prompt(`請輸入夾角角度 (當前夾角為 ${currentAngleDeg.toFixed(1)}°):`, currentAngleDeg.toFixed(1));
          if (valStr !== null) {
            const val = parseFloat(valStr);
            newConstraint.value = isNaN(val) ? currentAngleDeg : val;
          } else {
            return;
          }
        }
      }
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
          {selectedConstraints.map(c => (
            <div key={c.id} className="flex flex-col bg-indigo-50 border border-indigo-200 p-1.5 rounded text-[13px] text-indigo-800">
              <div className="flex justify-between items-center">
                <span className="font-bold">尺寸約束 ({c.type})</span>
                <span className="font-mono text-[11px] text-indigo-600">ID: {c.id.slice(0, 4)}</span>
              </div>
              {c.value !== undefined && (
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[11px] text-indigo-400">數值:</span>
                  <input 
                    type="number"
                    defaultValue={c.value}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = parseFloat((e.target as HTMLInputElement).value);
                        if (!isNaN(val)) {
                          const nextConstraints = { ...sketchConstraints, [c.id]: { ...c, value: val } };
                          setSketchConstraints(nextConstraints);
                          const nextNodes = solveConstraints(sketchNodes, sketchEdges, nextConstraints);
                          setSketchNodes(nextNodes);
                        }
                      }
                    }}
                    onBlur={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val)) {
                        const nextConstraints = { ...sketchConstraints, [c.id]: { ...c, value: val } };
                        setSketchConstraints(nextConstraints);
                        const nextNodes = solveConstraints(sketchNodes, sketchEdges, nextConstraints);
                        setSketchNodes(nextNodes);
                      }
                    }}
                    className="w-16 bg-white border border-indigo-200 rounded px-1 text-[11px] font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[10px] text-indigo-300 italic">mm</span>
                </div>
              )}
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

          <button
            onClick={() => applyConstraint('CONCENTRIC')}
            disabled={!(selectedEdges.length === 2 && selectedEdges.every(e => e.type === 'CIRCLE'))}
            className="flex items-center gap-1.5 p-1.5 bg-white hover:bg-[#3A7CA8] hover:text-white rounded border border-[#B4D8E7] active:scale-95 transition-all text-[#1A3A5F] font-bold disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-[#1A3A5F]"
          >
            <span>◎</span> 同心
          </button>

          <button
            onClick={() => applyConstraint('TANGENT')}
            disabled={!(selectedEdges.length === 2 && selectedEdges.some(e => e.type === 'LINE') && selectedEdges.some(e => e.type === 'CIRCLE'))}
            className="flex items-center gap-1.5 p-1.5 bg-white hover:bg-[#3A7CA8] hover:text-white rounded border border-[#B4D8E7] active:scale-95 transition-all text-[#1A3A5F] font-bold disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-[#1A3A5F]"
          >
            <span>🎯</span> 相切
          </button>

          <button
            onClick={() => applyConstraint('ANGLE')}
            disabled={!(selectedEdges.length === 2 && selectedEdges.every(e => e.type === 'LINE'))}
            className="col-span-2 flex items-center justify-center gap-1.5 p-1.5 bg-white hover:bg-[#3A7CA8] hover:text-white rounded border border-[#B4D8E7] active:scale-95 transition-all text-[#1A3A5F] font-bold disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-[#1A3A5F]"
          >
            <span>📐</span> 設定角度 (夾角)
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
