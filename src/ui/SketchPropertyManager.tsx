'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCadStore } from '../store/useCadStore';
import { previewSolve, commitPreciseSketchSolve } from '@/kernel/SketchSolverService';
import { Tabs, Tab } from './components/Tabs';
import { EquationEngine } from '../utils/EquationEngine';

/**
 * A specialized input that evaluates expressions and units (e.g., '1in + 5mm')
 */
const SmartNumericInput: React.FC<{
  label: string;
  value: number;
  onChange: (val: number) => void;
  badge?: string;
  unit?: string;
}> = ({ label, value, onChange, badge, unit = 'mm' }) => {
  const [inputValue, setInputValue] = useState(value.toString());
  const evaluatedVariables = useCadStore(state => state.evaluatedVariables);
  const isEditing = React.useRef(false);

  // Sync internal state when external value changes (e.g., from solver)
  // But only if we are not currently focused/editing
  useEffect(() => {
    if (!isEditing.current) {
      setInputValue(value.toFixed(2));
    }
  }, [value]);

  const handleBlur = () => {
    isEditing.current = false;
    const solved = EquationEngine.evaluate(inputValue, evaluatedVariables);
    onChange(solved);
    setInputValue(solved.toFixed(2));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur();
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase px-0.5">
        <span>{label}</span>
        {badge && <span className="bg-slate-200 text-slate-600 px-1 rounded-[2px]">{badge}</span>}
      </div>
      <div className="relative group">
        <input 
          type="text"
          value={inputValue}
          onFocus={() => { isEditing.current = true; }}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="w-full bg-white border border-slate-300 rounded px-1.5 py-1 text-[11px] font-bold text-slate-700 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-all text-right pr-6"
        />
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300 group-focus-within:text-blue-400 uppercase">{unit}</span>
      </div>
    </div>
  );
};

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
    setHoveredEntityId,
  } = useCadStore();

  const [isEditName, setIsEditName] = useState<string | null>(null);

  const activeEntity = useMemo(() => {
    if (selectedEntityIds.length === 1) {
      const id = selectedEntityIds[0];
      return sketchNodes[id] || sketchEdges[id] || sketchConstraints[id];
    }
    return null;
  }, [selectedEntityIds, sketchNodes, sketchEdges, sketchConstraints]);

  const updateEntityProperty = (id: string, key: string, value: any) => {
    if (sketchNodes[id]) {
      setSketchNodes({ ...sketchNodes, [id]: { ...sketchNodes[id], [key]: value } });
    } else if (sketchEdges[id]) {
      setSketchEdges({ ...sketchEdges, [id]: { ...sketchEdges[id], [key]: value } });
    } else if (sketchConstraints[id]) {
      setSketchConstraints({ ...sketchConstraints, [id]: { ...sketchConstraints[id], [key]: value } });
    }
    commitPreciseSketchSolve().then(() => triggerRebuild());
  };

  const [mirrorAxisId, setMirrorAxisId] = useState<string | null>(null);
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
      const isDirectlySelected = selectedEntityIds.includes(c.id);
      const nodeMatch = c.nodeIds?.some(id => selectedEntityIds.includes(id));
      const edgeMatch = c.edgeIds?.some(id => selectedEntityIds.includes(id));
      return isDirectlySelected || nodeMatch || edgeMatch;
    });
  }, [selectedEntityIds, sketchConstraints]);

  const handleDeleteEntities = async () => {
    const nextNodes = { ...sketchNodes };
    const nextEdges = { ...sketchEdges };
    const nextConstraints = { ...sketchConstraints };

    const toDelete = new Set(selectedEntityIds);

    toDelete.forEach(id => {
      if (nextNodes[id]) delete nextNodes[id];
      if (nextEdges[id]) delete nextEdges[id];
      if (nextConstraints[id]) delete nextConstraints[id];
    });

    // Cleanup orphaned edges and constraints
    Object.values(nextEdges).forEach(edge => {
      if (edge.nodeIds.some(nid => !nextNodes[nid])) delete nextEdges[edge.id];
    });
    Object.values(nextConstraints).forEach(c => {
      if (c.nodeIds?.some(nid => !nextNodes[nid])) delete nextConstraints[c.id];
      if (c.edgeIds?.some(eid => !nextEdges[eid])) delete nextConstraints[c.id];
    });

    setSketchNodes(nextNodes);
    setSketchEdges(nextEdges);
    setSketchConstraints(nextConstraints);
    setSelectedEntityIds([]);
    await commitPreciseSketchSolve();
    triggerRebuild();
  };

  const handleFixSelection = async (fixed: boolean) => {
    const nextNodes = { ...sketchNodes };
    let changed = false;
    
    selectedNodes.forEach(n => {
      if (nextNodes[n.id]) {
        nextNodes[n.id] = { ...nextNodes[n.id], isFixed: fixed };
        changed = true;
      }
    });

    selectedEdges.forEach(e => {
      e.nodeIds.forEach(nid => {
        if (nextNodes[nid]) {
          nextNodes[nid] = { ...nextNodes[nid], isFixed: fixed };
          changed = true;
        }
      });
    });

    if (changed) {
      setSketchNodes(nextNodes);
      await commitPreciseSketchSolve();
      triggerRebuild();
    }
  };

  const applyConstraint = async (type: 'COINCIDENT' | 'HORIZONTAL' | 'VERTICAL' | 'DISTANCE' | 'EQUAL' | 'CONCENTRIC' | 'TANGENT' | 'ANGLE' | 'PARALLEL' | 'PERPENDICULAR' | 'COLLINEAR' | 'FIX' | 'UNFIX') => {
    if (type === 'FIX') {
      handleFixSelection(true);
      return;
    }
    if (type === 'UNFIX') {
      handleFixSelection(false);
      return;
    }
    const cid = `c_${uuidv4().slice(0, 8)}`;
    const newConstraint: any = { id: cid, type };

    if (type === 'HORIZONTAL' || type === 'VERTICAL') {
      if (selectedEdges.length === 1) {
        newConstraint.edgeIds = [selectedEdges[0].id];
      } else {
        return;
      }
    } else if (type === 'COINCIDENT') {
      if (selectedNodes.length === 2) {
        newConstraint.nodeIds = [selectedNodes[0].id, selectedNodes[1].id];
      } else if (selectedNodes.length === 1 && selectedEdges.length === 1) {
        newConstraint.nodeIds = [selectedNodes[0].id];
        newConstraint.edgeIds = [selectedEdges[0].id];
      } else {
        return;
      }
    } else if (type === 'DISTANCE') {
      if (selectedNodes.length === 2) {
        newConstraint.nodeIds = [selectedNodes[0].id, selectedNodes[1].id];
        newConstraint.value = Math.hypot(selectedNodes[0].x - selectedNodes[1].x, selectedNodes[0].y - selectedNodes[1].y);
      } else if (selectedEdges.length === 1) {
        newConstraint.edgeIds = [selectedEdges[0].id];
        const e = selectedEdges[0];
        const n1 = sketchNodes[e.nodeIds[0]];
        const n2 = sketchNodes[e.nodeIds[1]];
        if (n1 && n2) newConstraint.value = Math.hypot(n2.x - n1.x, n2.y - n1.y);
      } else if (selectedNodes.length === 1 && selectedEdges.length === 1) {
        newConstraint.nodeIds = [selectedNodes[0].id];
        newConstraint.edgeIds = [selectedEdges[0].id];
        newConstraint.value = 50; 
        if (selectedEdges[0].type === 'CIRCLE') {
           newConstraint.arcCondition = 'CENTER';
        }
      } else if (selectedEdges.length === 2) {
        const e1 = selectedEdges[0];
        const e2 = selectedEdges[1];
        const hasLine = e1.type === 'LINE' || e1.type === 'CENTER_LINE' || e2.type === 'LINE' || e2.type === 'CENTER_LINE';
        const hasCircle = e1.type === 'CIRCLE' || e2.type === 'CIRCLE';
        if (hasLine && hasCircle) {
          newConstraint.edgeIds = [e1.id, e2.id];
          newConstraint.value = 50;
          newConstraint.arcCondition = 'CENTER';
        } else {
          return;
        }
      } else {
        return;
      }
    } else if (type === 'EQUAL') {
      if (selectedEdges.length === 2) {
        const t1 = selectedEdges[0].type;
        const t2 = selectedEdges[1].type;
        // Equal Length (Lines) or Equal Radius (Circles)
        if ((t1 === 'LINE' || t1 === 'CENTER_LINE') && (t2 === 'LINE' || t2 === 'CENTER_LINE')) {
          newConstraint.edgeIds = [selectedEdges[0].id, selectedEdges[1].id];
        } else if (t1 === 'CIRCLE' && t2 === 'CIRCLE') {
          newConstraint.edgeIds = [selectedEdges[0].id, selectedEdges[1].id];
        } else {
          return;
        }
      } else {
        return;
      }
    } else if (type === 'CONCENTRIC') {
      if (selectedEdges.length === 2 && selectedEdges.every(e => e.type === 'CIRCLE' || e.type === 'ARC')) {
        newConstraint.edgeIds = [selectedEdges[0].id, selectedEdges[1].id];
      } else {
        return;
      }
    } else if (type === 'TANGENT') {
      if (selectedEdges.length === 2) {
        const t1 = selectedEdges[0].type;
        const t2 = selectedEdges[1].type;
        const hasSpline = t1 === 'SPLINE' || t2 === 'SPLINE';
        const hasLine = t1 === 'LINE' || t1 === 'CENTER_LINE' || t2 === 'LINE' || t2 === 'CENTER_LINE';
        const hasCircle = t1 === 'CIRCLE' || t1 === 'ARC' || t2 === 'CIRCLE' || t2 === 'ARC';

        if ((hasLine && hasCircle) || (hasCircle && hasCircle) || (hasSpline && (hasLine || hasCircle))) {
           newConstraint.edgeIds = [selectedEdges[0].id, selectedEdges[1].id];
        } else {
           return;
        }
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
    } else if (type === 'PARALLEL' || type === 'PERPENDICULAR' || type === 'COLLINEAR') {
      if (selectedEdges.length === 2 && selectedEdges.every(e => e.type === 'LINE' || e.type === 'CENTER_LINE')) {
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
        const mirroredId = `n_m_${uuidv4().slice(0, 8)}_${n.id.slice(-4)}`;
        const mx = n.x + 2 * (projX - n.x);
        const my = n.y + 2 * (projY - n.y);
        nextNodes[mirroredId] = { id: mirroredId, x: mx, y: my, isFixed: false };
        nodeMap.set(n.id, mirroredId);
        
        const cid = `c_sym_${uuidv4().slice(0, 8)}_${n.id.slice(-4)}`;
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
      const mirroredId = `e_m_${uuidv4().slice(0, 8)}_${e.id.slice(-4)}`;
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
        const newId = `n_lp_${uuidv4().slice(0, 8)}_${i}_${n.id.slice(-4)}`;
        nextNodes[newId] = { 
          id: newId, 
          x: n.x + ux * offset, 
          y: n.y + uy * offset, 
          isFixed: false 
        };
        nodeMap.set(n.id, newId);
      });

      selectedEdges.forEach(e => {
        const newId = `e_lp_${uuidv4().slice(0, 8)}_${i}_${e.id.slice(-4)}`;
        const mNodeIds = e.nodeIds.map(nid => nodeMap.get(nid) || nid);
        nextEdges[newId] = { ...e, id: newId, nodeIds: mNodeIds as [string, string] };

        // Auto-Constraint: Equal length/radius
        if (e.type === 'LINE' || e.type === 'CIRCLE') {
           const cId = `c_eq_lp_${uuidv4().slice(0, 8)}_${i}_${e.id.slice(-4)}`;
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
        const newId = `n_cp_${uuidv4().slice(0, 8)}_${i}_${n.id.slice(-4)}`;
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
        const newId = `e_cp_${uuidv4().slice(0, 8)}_${i}_${e.id.slice(-4)}`;
        const mNodeIds = e.nodeIds.map(nid => nodeMap.get(nid) || nid);
        const finalIds = mNodeIds.map((id, idx) => nodeMap.has(e.nodeIds[idx]) ? id : e.nodeIds[idx]);
        nextEdges[newId] = { ...e, id: newId, nodeIds: finalIds as [string, string] };

        // Auto-Constraint: Equal length/radius
        if (e.type === 'LINE' || e.type === 'CIRCLE') {
           const cId = `c_eq_cp_${uuidv4().slice(0, 8)}_${i}_${e.id.slice(-4)}`;
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

  const handleAutoDefine = async () => {
    if (!solverReport) return;
    const nextConstraints = { ...sketchConstraints };
    let addedCount = 0;

    Object.entries(solverReport.nodes).forEach(([nid, status]) => {
      if (status === 'UNDER') {
        const node = sketchNodes[nid];
        if (!node || node.id === 'origin') return;

        // Add X Dimension (Horizontal distance from origin)
        const cxId = `dim_fds_x_${nid.slice(-4)}`;
        nextConstraints[cxId] = { id: cxId, type: 'DISTANCE', nodeIds: [nid], value: node.x, label: 'X' };
        
        // Add Y Dimension (Vertical distance from origin)
        const cyId = `dim_fds_y_${nid.slice(-4)}`;
        nextConstraints[cyId] = { id: cyId, type: 'DISTANCE', nodeIds: [nid], value: node.y, label: 'Y' };
        
        addedCount += 2;
      }
    });

    if (addedCount > 0) {
      setSketchConstraints(nextConstraints);
      await commitPreciseSketchSolve();
      triggerRebuild();
    }
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
          <div className="flex items-center gap-2">
            <button 
              onClick={handleAutoDefine}
              className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-[9px] font-black uppercase tracking-tighter transition-all shadow-sm active:scale-95"
              title="Fully Define Sketch (Auto-Dimension)"
            >
              Auto-Define
            </button>
            <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter ${definitionStatus.bg} ${definitionStatus.color}`}>
              {definitionStatus.text}
            </div>
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

        {/* Selected Entity Properties (Active Driver) */}
        {activeEntity && (
          <div className="bg-white border border-slate-300 rounded shadow-sm overflow-hidden">
            <div className="px-2 py-1 bg-slate-100 border-b border-slate-300 flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-700">Properties</span>
              <span className="text-[9px] font-mono text-slate-400">{activeEntity.id.slice(0, 8)}</span>
            </div>
            <div className="p-3 space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Entity Name</label>
                {isEditName === activeEntity.id ? (
                  <input 
                    autoFocus
                    type="text" 
                    defaultValue={(activeEntity as any).name || activeEntity.id.slice(0, 6)}
                    onBlur={(e) => {
                      updateEntityProperty(activeEntity.id, 'name', e.target.value);
                      setIsEditName(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    className="w-full bg-white border border-blue-400 rounded px-2 py-1 text-[12px] font-bold outline-none shadow-sm"
                  />
                ) : (
                  <div 
                    onClick={() => setIsEditName(activeEntity.id)}
                    className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-[12px] font-bold text-slate-700 cursor-text hover:border-blue-300"
                  >
                    {(activeEntity as any).name || activeEntity.id.slice(0, 6)}
                  </div>
                )}
              </div>
              
              {/* Node Specific: Coordinates */}
              {sketchNodes[activeEntity.id] && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">X Coord</label>
                    <input 
                      type="number" 
                      value={(activeEntity as any).x.toFixed(2)}
                      onChange={(e) => updateEntityProperty(activeEntity.id, 'x', parseFloat(e.target.value))}
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-mono font-bold text-right"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Y Coord</label>
                    <input 
                      type="number" 
                      value={(activeEntity as any).y.toFixed(2)}
                      onChange={(e) => updateEntityProperty(activeEntity.id, 'y', parseFloat(e.target.value))}
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-mono font-bold text-right"
                    />
                  </div>
                </div>
              )}

              {/* Edge Specific: Type & Status */}
              {sketchEdges[activeEntity.id] && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Parameters</label>
                  <div className="p-2 bg-slate-50 border border-slate-200 rounded space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-500">Type:</span>
                      <span className="font-bold text-slate-700">{(activeEntity as any).type}</span>
                    </div>
                    {/* Circle Radius Driver */}
                    {(activeEntity as any).type === 'CIRCLE' && (
                      <div className="pt-1">
                        <SmartNumericInput 
                          label="Radius"
                          value={(activeEntity as any).radius || 10}
                          onChange={(v) => updateEntityProperty(activeEntity.id, 'radius', v)}
                          badge="R1"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Constraint Specific */}
              {sketchConstraints[activeEntity.id] && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Parameters</label>
                  <div className="bg-slate-50 border border-slate-200 rounded overflow-hidden">
                    {(activeEntity as any).type === 'DISTANCE' && (activeEntity as any).arcCondition ? (
                      <Tabs>
                        <Tab label="General">
                          <div className="space-y-2 p-1">
                            <div className="flex justify-between text-[11px]">
                              <span className="text-slate-500">Type:</span>
                              <span className="font-bold text-slate-700">DISTANCE</span>
                            </div>
                            <SmartNumericInput 
                              label="Dimension Value"
                              value={(activeEntity as any).value || 0}
                              onChange={(v) => updateEntityProperty(activeEntity.id, 'value', v)}
                              badge="D1"
                            />
                          </div>
                        </Tab>
                        <Tab label="Leaders">
                          <div className="space-y-2 p-1">
                            <div className="flex flex-col gap-1">
                              <span className="text-slate-500 text-[10px] font-bold uppercase">Arc Condition</span>
                              <div className="grid grid-cols-1 gap-1">
                                {['CENTER', 'MIN', 'MAX'].map(condition => (
                                  <button
                                    key={condition}
                                    onClick={() => updateEntityProperty(activeEntity.id, 'arcCondition', condition)}
                                    className={`px-2 py-1.5 rounded text-[11px] font-bold text-left transition-all ${
                                      (activeEntity as any).arcCondition === condition
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                                    }`}
                                  >
                                    {condition.charAt(0) + condition.slice(1).toLowerCase()}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </Tab>
                      </Tabs>
                    ) : (
                      <div className="p-2 space-y-2">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-slate-500">Type:</span>
                          <span className="font-bold text-slate-700">{(activeEntity as any).type}</span>
                        </div>
                        {((activeEntity as any).type === 'DISTANCE' || (activeEntity as any).type === 'ANGLE') && (
                          <SmartNumericInput 
                            label="Value"
                            value={(activeEntity as any).value || 0}
                            onChange={(v) => updateEntityProperty(activeEntity.id, 'value', v)}
                            badge={(activeEntity as any).type === 'ANGLE' ? 'ANG' : 'D1'}
                            unit={(activeEntity as any).type === 'ANGLE' ? 'deg' : 'mm'}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Text Parameters Rollout */}
        {sketchTool === 'TEXT' && (
          <div className="bg-white border border-slate-300 rounded shadow-sm overflow-hidden animate-in slide-in-from-top-2 duration-200">
            <div className="px-2 py-1 bg-slate-100 border-b border-slate-300 flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-tighter flex items-center gap-1.5">
                <span className="text-blue-600">✍️</span> Text Parameters
              </span>
            </div>
            <div className="p-2 space-y-3">
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-500 uppercase">Input Text</label>
                <input 
                  type="text" 
                  defaultValue="3D Builder"
                  className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold"
                  onChange={(e) => {
                    // Update all selected text entities
                    selectedEntityIds.forEach(id => {
                      if (sketchEdges[id]?.type === 'TEXT') {
                        updateEntityProperty(id, 'parameters', { ...sketchEdges[id].parameters, text: e.target.value });
                      }
                    });
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-500 uppercase">Height (mm)</label>
                  <input 
                    type="number" 
                    defaultValue={10}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold"
                    onChange={(e) => {
                      selectedEntityIds.forEach(id => {
                        if (sketchEdges[id]?.type === 'TEXT') {
                          updateEntityProperty(id, 'parameters', { ...sketchEdges[id].parameters, height: parseFloat(e.target.value) });
                        }
                      });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-500 uppercase">Font</label>
                  <select 
                    className="w-full bg-white border border-slate-300 rounded px-1 py-1 text-[11px] font-bold"
                    onChange={(e) => {
                      selectedEntityIds.forEach(id => {
                        if (sketchEdges[id]?.type === 'TEXT') {
                          updateEntityProperty(id, 'parameters', { ...sketchEdges[id].parameters, font: e.target.value });
                        }
                      });
                    }}
                  >
                    <option value="SingleLine">Stick (CNC)</option>
                    <option value="Arial">Arial</option>
                    <option value="Times New Roman">Times</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  defaultChecked={true}
                  id="single_line_check"
                  onChange={(e) => {
                    selectedEntityIds.forEach(id => {
                      if (sketchEdges[id]?.type === 'TEXT') {
                        updateEntityProperty(id, 'parameters', { ...sketchEdges[id].parameters, isSingleLine: e.target.checked });
                      }
                    });
                  }}
                />
                <label htmlFor="single_line_check" className="text-[10px] font-bold text-slate-600">Single Line (CNC Mode)</label>
              </div>
            </div>
          </div>
        )}

        {/* Global Relations Rollout (Show when nothing is selected) */}
        {selectedEntityIds.length === 0 && (
          <div className="bg-white border border-slate-300 rounded shadow-sm overflow-hidden animate-in fade-in duration-300">
            <div className="px-2 py-1 bg-slate-100 border-b border-slate-300 flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-tighter flex items-center gap-1.5">
                <span className="text-emerald-600">📋</span> All Relations ({Object.keys(sketchConstraints).length})
              </span>
              <button 
                onClick={() => {
                  setSketchConstraints({});
                  commitPreciseSketchSolve().then(() => triggerRebuild());
                }}
                className="text-[9px] text-red-600 hover:underline border-none bg-transparent cursor-pointer font-bold"
              >
                Delete All
              </button>
            </div>
            <div className="p-2 space-y-1 max-h-[300px] overflow-y-auto custom-scrollbar">
              {Object.values(sketchConstraints).length === 0 ? (
                <div className="text-[10px] text-slate-400 italic text-center py-4">No relations in this sketch.</div>
              ) : (
                Object.values(sketchConstraints).map(c => (
                  <div 
                    key={c.id}
                    onMouseEnter={() => setHoveredEntityId(c.id)}
                    onMouseLeave={() => setHoveredEntityId(null)}
                    onClick={() => setSelectedEntityIds([c.id])}
                    className="flex items-center justify-between p-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] hover:bg-white hover:border-primary/40 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] text-emerald-600 font-bold">
                        {c.type === 'HORIZONTAL' && '—'}
                        {c.type === 'VERTICAL' && '│'}
                        {c.type === 'COINCIDENT' && '•'}
                        {c.type === 'DISTANCE' && '↔'}
                        {c.type === 'ANGLE' && '∠'}
                        {c.type === 'EQUAL' && '='}
                        {c.type === 'PARALLEL' && '∥'}
                        {c.type === 'PERPENDICULAR' && '⊥'}
                        {c.type === 'CONCENTRIC' && '◎'}
                        {c.type === 'COLLINEAR' && '⬌'}
                        {c.type === 'TANGENT' && '○'}
                      </span>
                      <span className="font-bold text-slate-700 uppercase text-[9px]">{c.type}</span>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); deleteConstraint(c.id); }}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all font-bold"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
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
              { type: 'COLLINEAR', label: 'Collinear', icon: '⬌' },
              { type: 'MIDPOINT', label: 'Midpoint', icon: '⬗' },
              { type: 'SYMMETRIC', label: 'Symmetric', icon: '|⬵|' },
              { type: 'FIX', label: 'Fix', icon: '🔒' },
              { type: 'UNFIX', label: 'Unfix', icon: '🔓' }
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
