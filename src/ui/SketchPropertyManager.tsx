'use client';

import React, { useMemo, useState } from 'react';
import { useCadStore } from '../store/useCadStore';
import { previewSolve, commitPreciseSketchSolve } from '@/kernel/SketchSolverService';

export const SketchPropertyManager: React.FC = () => {
  const {
    selectedEntityIds,
    setSelectedEntityIds,
    sketchNodes,
    setSketchNodes,
    sketchEdges,
    setSketchEdges,
    sketchConstraints,
    setSketchConstraints,
    solverReport,
    sketchTool,
    setSketchTool,
  } = useCadStore();

  const [mirrorAxisId, setMirrorAxisId] = useState<string | null>(null);

  // Pattern States
  const [patternAxisId, setPatternAxisId] = useState<string | null>(null);
  const [patternCount, setPatternCount] = useState<number>(3);
  const [patternSpacing, setPatternSpacing] = useState<number>(20);
  const [patternAngle, setPatternAngle] = useState<number>(360);

  const selectedNodes = useMemo(() => {
    return selectedEntityIds
      .filter(id => sketchNodes[id])
      .map(id => sketchNodes[id]);
  }, [selectedEntityIds, sketchNodes]);

  const selectedEdges = useMemo(() => {
    return selectedEntityIds
      .filter(id => sketchEdges[id])
      .map(id => sketchEdges[id]);
  }, [selectedEntityIds, sketchEdges]);

  const selectedConstraints = useMemo(() => {
    return Object.values(sketchConstraints).filter(c => {
      const nodeMatch = c.nodeIds?.some(id => selectedEntityIds.includes(id));
      const edgeMatch = c.edgeIds?.some(id => selectedEntityIds.includes(id));
      return nodeMatch || edgeMatch;
    });
  }, [selectedEntityIds, sketchConstraints]);

  const handleDeleteEntities = async () => {
    const nextNodes = { ...sketchNodes };
    const nextEdges = { ...sketchEdges };
    const nextConstraints = { ...sketchConstraints };

    const nodesToDelete = new Set<string>();
    const edgesToDelete = new Set<string>();

    selectedEntityIds.forEach(id => {
      if (nextNodes[id]) nodesToDelete.add(id);
      if (nextEdges[id]) edgesToDelete.add(id);
    });

    // Also delete dependent edges and constraints
    Object.values(nextEdges).forEach(edge => {
      if (edge.nodeIds.some(nid => nodesToDelete.has(nid))) {
        edgesToDelete.add(edge.id);
      }
    });

    Object.values(nextConstraints).forEach(c => {
      if (c.nodeIds?.some(nid => nodesToDelete.has(nid))) delete nextConstraints[c.id];
      if (c.edgeIds?.some(eid => edgesToDelete.has(eid))) delete nextConstraints[c.id];
    });

    nodesToDelete.forEach(id => delete nextNodes[id]);
    edgesToDelete.forEach(id => delete nextEdges[id]);

    setSketchNodes(nextNodes);
    setSketchEdges(nextEdges);
    setSketchConstraints(nextConstraints);
    setSelectedEntityIds([]);
    await commitPreciseSketchSolve();
    triggerRebuild();
  };

  const applyConstraint = async (type: 'COINCIDENT' | 'HORIZONTAL' | 'VERTICAL' | 'DISTANCE' | 'EQUAL' | 'CONCENTRIC' | 'TANGENT' | 'ANGLE') => {
    const cid = `c_${Date.now()}`;
    let newConstraint: any = { id: cid, type };

    if (type === 'HORIZONTAL' || type === 'VERTICAL') {
      if (selectedEdges.length === 1) {
        newConstraint.edgeIds = [selectedEdges[0].id];
      } else {
        return;
      }
    } else if (type === 'COINCIDENT') {
      if (selectedNodes.length === 2) {
        newConstraint.nodeIds = [selectedNodes[0].id, selectedNodes[1].id];
      } else {
        return;
      }
    } else if (type === 'DISTANCE') {
      if (selectedNodes.length === 2) {
        newConstraint.nodeIds = [selectedNodes[0].id, selectedNodes[1].id];
        newConstraint.value = Math.hypot(selectedNodes[0].x - selectedNodes[1].x, selectedNodes[0].y - selectedNodes[1].y);
      } else {
        return;
      }
    } else if (type === 'EQUAL') {
      if (selectedEdges.length === 2) {
        newConstraint.edgeIds = [selectedEdges[0].id, selectedEdges[1].id];
      } else {
        return;
      }
    } else if (type === 'CONCENTRIC') {
      if (selectedEdges.length === 2 && selectedEdges.every(e => e.type === 'CIRCLE')) {
        newConstraint.edgeIds = [selectedEdges[0].id, selectedEdges[1].id];
      } else {
        return;
      }
    } else if (type === 'TANGENT') {
      if (selectedEdges.length === 2) {
        newConstraint.edgeIds = [selectedEdges[0].id, selectedEdges[1].id];
      } else {
        return;
      }
    } else if (type === 'ANGLE') {
      if (selectedEdges.length === 2 && selectedEdges.every(e => e.type === 'LINE')) {
        newConstraint.edgeIds = [selectedEdges[0].id, selectedEdges[1].id];
        newConstraint.value = 90;
      } else {
        return;
      }
    } else if (type === 'PARALLEL' || type === 'PERPENDICULAR') {
      if (selectedEdges.length === 2 && selectedEdges.every(e => e.type === 'LINE')) {
        newConstraint.edgeIds = [selectedEdges[0].id, selectedEdges[1].id];
      } else {
        return;
      }
    }

    const nextConstraints = { ...sketchConstraints, [cid]: newConstraint };
    setSketchConstraints(nextConstraints);

    const previewNodes = previewSolve(sketchNodes, sketchEdges, nextConstraints, 6);
    setSketchNodes(previewNodes);
    await commitPreciseSketchSolve();
    triggerRebuild();
  };

  const deleteConstraint = async (cid: string) => {
    const nextConstraints = { ...sketchConstraints };
    delete nextConstraints[cid];
    setSketchConstraints(nextConstraints);
    await commitPreciseSketchSolve();
    triggerRebuild();
  };

  const executeSketchMirror = async () => {
    if (!mirrorAxisId) return;
    const axisEdge = sketchEdges[mirrorAxisId];
    if (!axisEdge || axisEdge.type !== 'CENTER_LINE') return;
    const a1 = sketchNodes[axisEdge.nodeIds[0]];
    const a2 = sketchNodes[axisEdge.nodeIds[1]];
    if (!a1 || !a2) return;

    const nextNodes = { ...sketchNodes };
    const nextEdges = { ...sketchEdges };
    const nextConstraints = { ...sketchConstraints };

    const nodeMap = new Map<string, string>(); // Original ID -> Mirrored ID

    const dx = a2.x - a1.x;
    const dy = a2.y - a1.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) return;

    // Mirror Nodes
    selectedNodes.forEach(n => {
      const t = ((n.x - a1.x) * dx + (n.y - a1.y) * dy) / lenSq;
      const projX = a1.x + t * dx;
      const projY = a1.y + t * dy;
      const dist = Math.hypot(n.x - projX, n.y - projY);
      
      if (dist < 1e-3) {
        nodeMap.set(n.id, n.id);
      } else {
        const mirroredId = `n_m_${Date.now()}_${n.id.slice(-4)}`;
        const mx = n.x + 2 * (projX - n.x);
        const my = n.y + 2 * (projY - n.y);
        nextNodes[mirroredId] = { id: mirroredId, x: mx, y: my, isFixed: false };
        nodeMap.set(n.id, mirroredId);
        
        const cid = `c_sym_${Date.now()}_${n.id.slice(-4)}`;
        nextConstraints[cid] = {
          id: cid,
          type: 'SYMMETRIC',
          nodeIds: [n.id, mirroredId],
          edgeIds: [mirrorAxisId]
        };
      }
    });

    // Mirror Edges
    selectedEdges.forEach(e => {
      if (e.id === mirrorAxisId) return;
      const mirroredId = `e_m_${Date.now()}_${e.id.slice(-4)}`;
      const mNodeIds = e.nodeIds.map(nid => nodeMap.get(nid) || nid);
      if (mNodeIds.every((id, idx) => id === e.nodeIds[idx])) return;

      nextEdges[mirroredId] = { 
        ...e, 
        id: mirroredId, 
        nodeIds: mNodeIds as [string, string]
      };
    });

    setSketchNodes(nextNodes);
    setSketchEdges(nextEdges);
    setSketchConstraints(nextConstraints);
    setSketchTool('SELECT');
    setSelectedEntityIds([]);
    setMirrorAxisId(null);
    await commitPreciseSketchSolve();
    triggerRebuild();
  };

  const executeLinearPattern = async () => {
    if (!patternAxisId || patternCount < 2) return;
    const axisEdge = sketchEdges[patternAxisId];
    if (!axisEdge) return;
    const a1 = sketchNodes[axisEdge.nodeIds[0]];
    const a2 = sketchNodes[axisEdge.nodeIds[1]];
    if (!a1 || !a2) return;

    const dx = a2.x - a1.x;
    const dy = a2.y - a1.y;
    const mag = Math.hypot(dx, dy);
    if (mag < 1e-6) return;
    const ux = dx / mag;
    const uy = dy / mag;

    const nextNodes = { ...sketchNodes };
    const nextEdges = { ...sketchEdges };
    const nextConstraints = { ...sketchConstraints };

    for (let i = 1; i < patternCount; i++) {
      const offset = i * patternSpacing;
      const nodeMap = new Map<string, string>();

      selectedNodes.forEach(n => {
        const newId = `n_lp_${Date.now()}_${i}_${n.id.slice(-4)}`;
        nextNodes[newId] = { 
          id: newId, 
          x: n.x + ux * offset, 
          y: n.y + uy * offset, 
          isFixed: false 
        };
        nodeMap.set(n.id, newId);
      });

      selectedEdges.forEach(e => {
        const newId = `e_lp_${Date.now()}_${i}_${e.id.slice(-4)}`;
        const mNodeIds = e.nodeIds.map(nid => nodeMap.get(nid) || nid);
        nextEdges[newId] = { ...e, id: newId, nodeIds: mNodeIds as [string, string] };

        // Auto-Constraint: Equal length/radius
        if (e.type === 'LINE' || e.type === 'CIRCLE') {
           const cId = `c_eq_lp_${Date.now()}_${i}_${e.id.slice(-4)}`;
           nextConstraints[cId] = {
             id: cId,
             type: 'EQUAL',
             edgeIds: [e.id, newId]
           };
        }
      });
    }

    setSketchNodes(nextNodes);
    setSketchEdges(nextEdges);
    setSketchConstraints(nextConstraints);
    setSketchTool('SELECT');
    setSelectedEntityIds([]);
    await commitPreciseSketchSolve();
    triggerRebuild();
  };

  const executeCircularPattern = async () => {
    if (selectedNodes.length === 0 || patternCount < 2) return;
    const center = selectedNodes[0]; 
    
    const nextNodes = { ...sketchNodes };
    const nextEdges = { ...sketchEdges };
    const nextConstraints = { ...sketchConstraints };
    const angleStep = (patternAngle * Math.PI / 180) / patternCount;

    for (let i = 1; i < patternCount; i++) {
      const theta = i * angleStep;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const nodeMap = new Map<string, string>();

      const toPattern = selectedNodes.filter(n => n.id !== center.id);

      toPattern.forEach(n => {
        const newId = `n_cp_${Date.now()}_${i}_${n.id.slice(-4)}`;
        const rx = n.x - center.x;
        const ry = n.y - center.y;
        nextNodes[newId] = { 
          id: newId, 
          x: center.x + rx * cos - ry * sin, 
          y: center.y + rx * sin + ry * cos, 
          isFixed: false 
        };
        nodeMap.set(n.id, newId);
      });

      selectedEdges.forEach(e => {
        const newId = `e_cp_${Date.now()}_${i}_${e.id.slice(-4)}`;
        const mNodeIds = e.nodeIds.map(nid => nodeMap.get(nid) || nid);
        const finalIds = mNodeIds.map((id, idx) => nodeMap.has(e.nodeIds[idx]) ? id : e.nodeIds[idx]);
        nextEdges[newId] = { ...e, id: newId, nodeIds: finalIds as [string, string] };

        // Auto-Constraint: Equal length/radius
        if (e.type === 'LINE' || e.type === 'CIRCLE') {
           const cId = `c_eq_cp_${Date.now()}_${i}_${e.id.slice(-4)}`;
           nextConstraints[cId] = {
             id: cId,
             type: 'EQUAL',
             edgeIds: [e.id, newId]
           };
        }
      });
    }

    setSketchNodes(nextNodes);
    setSketchEdges(nextEdges);
    setSketchConstraints(nextConstraints);
    setSketchTool('SELECT');
    setSelectedEntityIds([]);
    await commitPreciseSketchSolve();
    triggerRebuild();
  };

  const triggerRebuild = () => {
    const rebuildHook = (window as any).__handleRebuild;
    if (rebuildHook) rebuildHook();
  };

  const definitionStatus = useMemo(() => {
    const nodeIds = Object.keys(sketchNodes);
    if (nodeIds.length === 0) return { text: 'Empty Sketch', color: 'text-slate-400', bg: 'bg-slate-100' };

    if (!solverReport) return { text: 'Under Defined', color: 'text-blue-600', bg: 'bg-blue-100' };

    if (solverReport.dof < 0) {
      return { text: `Over Defined (${solverReport.dof} DOF)`, color: 'text-red-700', bg: 'bg-red-100' };
    }

    if (solverReport.dof === 0) {
      return { text: 'Fully Defined (0 DOF)', color: 'text-emerald-700', bg: 'bg-emerald-100' };
    } else {
      return { text: `Under Defined (${solverReport.dof} DOF)`, color: 'text-blue-700', bg: 'bg-blue-100' };
    }
  }, [sketchNodes, solverReport]);

  return (
    <div className="flex flex-col h-full bg-[#F5F6F9] select-none font-sans">
      {/* PropertyManager Header */}
      <div className="p-3 bg-white border-b border-slate-300 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[13px] font-black text-slate-800 uppercase tracking-tight">PropertyManager</h2>
          <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter ${definitionStatus.bg} ${definitionStatus.color}`}>
            {definitionStatus.text}
          </div>
        </div>
        <div className="text-[11px] text-slate-500 font-medium">
          {selectedEntityIds.length > 0 ? `Selected: ${selectedEntityIds.length} Entities` : 'Select entities to add relations'}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {/* Linear Pattern Rollout */}
        {sketchTool === 'LINEAR_PATTERN' && (
          <div className="bg-white border border-blue-300 rounded shadow-md overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="px-2 py-1 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
              <span className="text-[11px] font-bold text-blue-700 uppercase tracking-tighter">Linear Pattern</span>
              <button onClick={() => setSketchTool('SELECT')} className="text-[10px] text-slate-400 hover:text-blue-600 font-bold">CANCEL</button>
            </div>
            <div className="p-3 space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Pattern Direction (Axis)</label>
                <div 
                  className={`p-2 border rounded min-h-[40px] flex items-center justify-between transition-colors ${patternAxisId ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-300 text-slate-400 italic'}`}
                  onClick={() => {
                    const line = selectedEdges.find(e => e.type === 'LINE' || e.type === 'CENTER_LINE');
                    if (line) setPatternAxisId(line.id);
                  }}
                >
                  <span className="text-[11px]">{patternAxisId ? `Axis (${patternAxisId.slice(0,4)})` : "Select a Line..."}</span>
                  {patternAxisId && <button onClick={(e) => { e.stopPropagation(); setPatternAxisId(null); }} className="text-blue-400 hover:text-blue-600 font-bold">×</button>}
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Count</label>
                  <input type="number" min="2" value={patternCount} onChange={e => setPatternCount(parseInt(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-[12px] outline-none focus:border-blue-400" />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Spacing (mm)</label>
                  <input type="number" value={patternSpacing} onChange={e => setPatternSpacing(parseFloat(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-[12px] outline-none focus:border-blue-400" />
                </div>
              </div>
              <button 
                disabled={!patternAxisId || selectedEntityIds.filter(id => id !== patternAxisId).length === 0}
                onClick={executeLinearPattern}
                className="w-full py-2 bg-blue-600 text-white rounded font-bold text-[12px] hover:bg-blue-700 disabled:opacity-50 transition-all shadow-sm active:scale-95 flex items-center justify-center gap-2"
              >
                Apply Linear Pattern
              </button>
            </div>
          </div>
        )}

        {/* Circular Pattern Rollout */}
        {sketchTool === 'CIRCULAR_PATTERN' && (
          <div className="bg-white border border-blue-300 rounded shadow-md overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="px-2 py-1 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
              <span className="text-[11px] font-bold text-blue-700 uppercase tracking-tighter">Circular Pattern</span>
              <button onClick={() => setSketchTool('SELECT')} className="text-[10px] text-slate-400 hover:text-blue-600 font-bold">CANCEL</button>
            </div>
            <div className="p-3 space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Center Point (Seed Node)</label>
                <div className="p-2 bg-blue-50 border border-blue-200 rounded text-[11px] text-blue-700 font-bold">
                  {selectedNodes[0] ? `Point (${selectedNodes[0].id.slice(0,4)})` : "Select a seed point..."}
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Instances</label>
                  <input type="number" min="2" value={patternCount} onChange={e => setPatternCount(parseInt(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-[12px] outline-none focus:border-blue-400" />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Total Angle</label>
                  <input type="number" value={patternAngle} onChange={e => setPatternAngle(parseFloat(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-[12px] outline-none focus:border-blue-400" />
                </div>
              </div>
              <button 
                disabled={selectedNodes.length === 0}
                onClick={executeCircularPattern}
                className="w-full py-2 bg-blue-600 text-white rounded font-bold text-[12px] hover:bg-blue-700 disabled:opacity-50 transition-all shadow-sm active:scale-95 flex items-center justify-center gap-2"
              >
                Apply Circular Pattern
              </button>
            </div>
          </div>
        )}

        {/* Mirror Entities Rollout (Active Tool Only) */}
        {sketchTool === 'MIRROR' && (
          <div className="bg-white border border-indigo-300 rounded shadow-md overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="px-2 py-1 bg-indigo-50 border-b border-indigo-200 flex items-center justify-between">
              <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-tighter">Mirror Entities</span>
              <button onClick={() => { setSketchTool('SELECT'); setMirrorAxisId(null); }} className="text-[10px] text-slate-400 hover:text-indigo-600 font-bold">CANCEL</button>
            </div>
            <div className="p-3 space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Entities to Mirror</label>
                <div className="p-2 bg-slate-50 border border-slate-200 rounded min-h-[40px] text-[11px] text-slate-600">
                  {selectedEntityIds.filter(id => id !== mirrorAxisId).length === 0 ? (
                    <span className="text-slate-400 italic">Select entities in viewport...</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {selectedEntityIds.filter(id => id !== mirrorAxisId).map(id => (
                        <span key={id} className="bg-white px-1.5 py-0.5 border border-slate-200 rounded-sm text-[9px] font-mono">
                          {id.slice(0, 4)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Mirror About</label>
                <div 
                  className={`p-2 border rounded min-h-[40px] flex items-center justify-between transition-colors ${mirrorAxisId ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-slate-300 text-slate-400 italic'}`}
                  onClick={() => {
                    const centerLine = selectedEdges.find(e => e.type === 'CENTER_LINE');
                    if (centerLine) setMirrorAxisId(centerLine.id);
                  }}
                >
                  <span className="text-[11px]">{mirrorAxisId ? `CenterLine (${mirrorAxisId.slice(0,4)})` : "Select a Center Line..."}</span>
                  {mirrorAxisId && <button onClick={(e) => { e.stopPropagation(); setMirrorAxisId(null); }} className="text-indigo-400 hover:text-indigo-600 font-bold">×</button>}
                </div>
              </div>
              <button 
                disabled={!mirrorAxisId || selectedEntityIds.filter(id => id !== mirrorAxisId).length === 0}
                onClick={executeSketchMirror}
                className="w-full py-2 bg-indigo-600 text-white rounded font-bold text-[12px] hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95 flex items-center justify-center gap-2"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                Apply Mirror
              </button>
            </div>
          </div>
        )}

        {/* Selection Rollout */}
        <div className="bg-white border border-slate-300 rounded shadow-sm overflow-hidden">
          <div className="px-2 py-1 bg-slate-100 border-b border-slate-300 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-700">Selected Entities</span>
            <button onClick={handleDeleteEntities} className="text-[10px] text-red-600 hover:underline border-none bg-transparent cursor-pointer">Delete All</button>
          </div>
          <div className="p-2 max-h-[120px] overflow-y-auto space-y-1">
            {selectedNodes.map(node => (
              <div key={node.id} className="flex items-center gap-2 px-2 py-1 bg-blue-50 text-blue-800 text-[11px] rounded border border-blue-100 font-mono">
                <span className="opacity-50">●</span> Point: ({node.x.toFixed(1)}, {node.y.toFixed(1)})
              </div>
            ))}
            {selectedEdges.map(edge => (
              <div key={edge.id} className="flex items-center gap-2 px-2 py-1 bg-sky-50 text-sky-800 text-[11px] rounded border border-sky-100 font-mono">
                <span className="opacity-50">/</span> {edge.type} ({edge.id.slice(0, 4)})
              </div>
            ))}
            {selectedEntityIds.length === 0 && (
              <div className="text-[11px] text-slate-400 italic text-center py-2">No selection</div>
            )}
          </div>
        </div>

        {/* Relations Rollout */}
        <div className="bg-white border border-slate-300 rounded shadow-sm overflow-hidden">
          <div className="px-2 py-1 bg-slate-100 border-b border-slate-300">
            <span className="text-[11px] font-bold text-slate-700">Add Relations</span>
          </div>
          <div className="p-2 grid grid-cols-2 gap-1.5">
            {[
              { type: 'HORIZONTAL', label: 'Horizontal', icon: '—' },
              { type: 'VERTICAL', label: 'Vertical', icon: '|' },
              { type: 'COINCIDENT', label: 'Coincident', icon: '•' },
              { type: 'DISTANCE', label: 'Distance', icon: '↔' },
              { type: 'EQUAL', label: 'Equal', icon: '=' },
              { type: 'CONCENTRIC', label: 'Concentric', icon: '◎' },
              { type: 'TANGENT', label: 'Tangent', icon: '○' },
              { type: 'ANGLE', label: 'Angle', icon: '∠' },
              { type: 'PARALLEL', label: 'Parallel', icon: '∥' },
              { type: 'PERPENDICULAR', label: 'Perpend.', icon: '⊥' },
              { type: 'MIDPOINT', label: 'Midpoint', icon: '⬗' },
              { type: 'SYMMETRIC', label: 'Symmetric', icon: '|⬵|' }
              ].map(c => (
              <button
                key={c.type}
                onClick={() => applyConstraint(c.type as any)}
                className="flex flex-col items-center justify-center p-2 rounded border border-slate-200 hover:bg-blue-50 hover:border-blue-300 text-slate-600 hover:text-blue-700 transition-all bg-white cursor-pointer group"
              >
                <span className="text-lg font-bold group-hover:scale-110 transition-transform">{c.icon}</span>
                <span className="text-[9px] font-bold uppercase mt-1 tracking-tighter">{c.label}</span>
              </button>
              ))}
              </div>
              </div>

        {/* Existing Constraints Rollout */}
        {selectedConstraints.length > 0 && (
          <div className="bg-white border border-slate-300 rounded shadow-sm overflow-hidden">
            <div className="px-2 py-1 bg-slate-100 border-b border-slate-300 flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-700">Existing Relations</span>
            </div>
            <div className="p-2 space-y-1">
              {selectedConstraints.map(c => (
                <div key={c.id} className="flex items-center justify-between p-1.5 bg-slate-50 border border-slate-200 rounded text-[11px]">
                  <div className="flex flex-col">
                    <span className="font-bold text-slate-700 uppercase text-[9px]">{c.type}</span>
                    <span className="text-slate-400 font-mono text-[9px]">{c.id.slice(0, 8)}</span>
                  </div>
                  <button 
                    onClick={() => deleteConstraint(c.id)}
                    className="w-5 h-5 rounded hover:bg-red-50 text-red-400 hover:text-red-600 flex items-center justify-center border-none bg-transparent cursor-pointer"
                  >×</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
