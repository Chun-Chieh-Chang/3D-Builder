'use client';

import React, { useMemo, useState } from 'react';
import * as THREE from 'three';
import { useCadStore } from '../store/useCadStore';
import { Line, Html } from '@react-three/drei';
import { analyzeSketchDefinitions } from '../utils/geometry/ConstraintSolver';

export const SketchPreview = () => {
  const { 
    sketchNodes, sketchEdges, sketchConstraints,
    activePlane, 
    isSketchMode,
    selectedEntityIds,
    setSelectedEntityIds,
    activeFaceOrigin,
    activeFaceNormal,
    referencePlanes,
    selectedId,
    selectedSubNodeType,
    features
  } = useCadStore();

  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [editingConstraintId, setEditingConstraintId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState<string>('');

  const selectedFeature = useMemo(() => features.find(f => f.id === selectedId), [features, selectedId]);

  const isViewingStoredSketch = useMemo(() => {
    return !isSketchMode && selectedSubNodeType === 'SKETCH' && selectedFeature && 
      (selectedFeature.type === 'EXTRUDE' || selectedFeature.type === 'REVOLVE');
  }, [isSketchMode, selectedSubNodeType, selectedFeature]);

  const faceBasis = useMemo(() => {
    if (activePlane !== 'FACE' || !activeFaceOrigin || !activeFaceNormal) return null;
    const origin = new THREE.Vector3(...activeFaceOrigin);
    const normal = new THREE.Vector3(...activeFaceNormal).normalize();
    let xDir = new THREE.Vector3();
    if (Math.abs(normal.x) < 1e-5 && Math.abs(normal.y) < 1e-5) {
      xDir.set(1, 0, 0);
    } else {
      xDir.set(-normal.y, normal.x, 0).normalize();
    }
    const yDir = new THREE.Vector3().crossVectors(normal, xDir).normalize();
    return { origin, normal, xDir, yDir };
  }, [activePlane, activeFaceOrigin, activeFaceNormal]);

  const customBasis = useMemo(() => {
    if (!activePlane || ['FRONT', 'TOP', 'RIGHT', 'FACE'].includes(activePlane)) return null;
    const plane = referencePlanes.find(p => p.id === activePlane);
    if (!plane) return null;
    const origin = new THREE.Vector3(...plane.origin);
    const normal = new THREE.Vector3(...plane.normal).normalize();
    const xDir = new THREE.Vector3(...plane.xDir).normalize();
    const yDir = new THREE.Vector3(...plane.yDir).normalize();
    return { origin, normal, xDir, yDir };
  }, [activePlane, referencePlanes]);

  const activeBasis = useMemo(() => {
    if (activePlane === 'FACE') return faceBasis;
    return customBasis;
  }, [activePlane, faceBasis, customBasis]);

  const get3DPoint = (u: number, v: number): [number, number, number] => {
    if (activePlane === 'FRONT') return [u, v, 0];
    if (activePlane === 'TOP') return [u, 0, v];
    if (activePlane === 'RIGHT') return [0, u, v];
    const basis = activeBasis;
    if (basis) {
      const p = basis.origin.clone()
        .addScaledVector(basis.xDir, u)
        .addScaledVector(basis.yDir, v);
      return [p.x, p.y, p.z];
    }
    return [u, v, 0];
  };

  const handleEntityClick = (entId: string) => {
    if (!isSketchMode) return;
    const isSelected = selectedEntityIds.includes(entId);
    if (isSelected) {
      setSelectedEntityIds(selectedEntityIds.filter(id => id !== entId));
    } else {
      setSelectedEntityIds([...selectedEntityIds, entId]);
    }
  };

  const definitionReport = useMemo(() => {
    return analyzeSketchDefinitions(sketchNodes, sketchEdges, sketchConstraints);
  }, [sketchNodes, sketchEdges, sketchConstraints]);

  const distanceConstraints = useMemo(() => {
    return Object.values(sketchConstraints).filter(
      c => c.type === 'DISTANCE' && c.nodeIds && c.nodeIds.length === 2 && c.value !== undefined
    );
  }, [sketchConstraints]);

  const handleSaveConstraintValue = (constraintId: string) => {
    const val = parseFloat(inputValue);
    if (!isNaN(val) && val > 0) {
      const currentConstraints = { ...useCadStore.getState().sketchConstraints };
      if (currentConstraints[constraintId]) {
        currentConstraints[constraintId] = {
          ...currentConstraints[constraintId],
          value: val
        };
        useCadStore.setState({ sketchConstraints: currentConstraints });
      }
    }
    setEditingConstraintId(null);
  };

  if ((!isSketchMode && !isViewingStoredSketch) || !activePlane) return null;

  return (
    <group>
      {/* 1. Render Edges (Lines & Circles) */}
      {Object.values(sketchEdges).map((edge) => {
        if (edge.nodeIds.length < 2) return null;
        
        let entityPoints: [number, number, number][] = [];
        const n1 = sketchNodes[edge.nodeIds[0]];
        const n2 = sketchNodes[edge.nodeIds[1]];
        if (!n1 || !n2) return null;

        if (edge.type === 'LINE' || edge.type === 'CENTER_LINE') {
          entityPoints = [get3DPoint(n1.x, n1.y), get3DPoint(n2.x, n2.y)];
        } else if (edge.type === 'CIRCLE') {
          const R = Math.hypot(n2.x - n1.x, n2.y - n1.y);
          for (let k = 0; k <= 36; k++) {
            const theta = (k / 36) * Math.PI * 2;
            entityPoints.push(get3DPoint(n1.x + R * Math.cos(theta), n1.y + R * Math.sin(theta)));
          }
        }

        const isSelected = selectedEntityIds.includes(edge.id);
        const isHovered = hoveredEntityId === edge.id;
        const isCenterline = edge.type === 'CENTER_LINE' || edge.isConstruction;
        
        const edgeState = definitionReport.edges[edge.id];
        const strokeColor = isSelected
          ? "#ec4899"
          : isHovered
          ? "#f59e0b"
          : edgeState === 'CONFLICT'
          ? "#ef4444"
          : edgeState === 'FULLY'
          ? "#0f172a"
          : isCenterline
          ? "#6b7280"
          : "#3b82f6";

        return (
          <group key={edge.id}>
            <Line
              points={entityPoints}
              color={strokeColor}
              lineWidth={isSelected ? 5.5 : isHovered ? 4.5 : 3.0}
              dashed={isCenterline}
              dashSize={1.5}
              gapSize={1.0}
              depthTest={false}
            />
            
            <Line
              points={entityPoints}
              color="#000000"
              lineWidth={16.0}
              opacity={0.0}
              transparent
              onClick={(e) => { e.stopPropagation(); handleEntityClick(edge.id); }}
              onPointerOver={(e) => { if (!isSketchMode) return; e.stopPropagation(); setHoveredEntityId(edge.id); }}
              onPointerOut={(e) => { if (!isSketchMode) return; setHoveredEntityId(null); }}
            />
          </group>
        );
      })}

      {/* 2. Render Nodes (Points) */}
      {isSketchMode && Object.values(sketchNodes).map((node) => {
        const isSelected = selectedEntityIds.includes(node.id);
        const isHovered = hoveredEntityId === node.id;
        const pos = get3DPoint(node.x, node.y);

        const nodeState = definitionReport.nodes[node.id];
        const dotColor = isSelected
          ? "#ec4899"
          : isHovered
          ? "#f59e0b"
          : node.isFixed
          ? "#10b981"
          : nodeState === 'CONFLICT'
          ? "#ef4444"
          : nodeState === 'FULLY'
          ? "#0f172a"
          : "#3b82f6";

        return (
          <mesh 
            key={node.id} 
            position={pos}
            onClick={(e) => { e.stopPropagation(); handleEntityClick(node.id); }}
            onPointerOver={(e) => { if (!isSketchMode) return; e.stopPropagation(); setHoveredEntityId(node.id); }}
            onPointerOut={(e) => { if (!isSketchMode) return; setHoveredEntityId(null); }}
          >
            <sphereGeometry args={[isSelected || isHovered ? 0.6 : 0.4, 12, 12]} />
            <meshBasicMaterial
              depthTest={false}
              color={dotColor}
            />
          </mesh>
        );
      })}

      {/* 3. Render Floating Interactive 2D Dimension Lines for DISTANCE constraints */}
      {isSketchMode && distanceConstraints.map((constraint) => {
        const nA = sketchNodes[constraint.nodeIds![0]];
        const nB = sketchNodes[constraint.nodeIds![1]];
        if (!nA || !nB) return null;

        const dx = nB.x - nA.x;
        const dy = nB.y - nA.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-4) return null;

        const ux = dx / len;
        const uy = dy / len;
        const nx = -uy;
        const ny = ux;

        const offsetDist = 12;
        const offAx = nA.x + nx * offsetDist;
        const offAy = nA.y + ny * offsetDist;
        const offBx = nB.x + nx * offsetDist;
        const offBy = nB.y + ny * offsetDist;

        const pA = get3DPoint(nA.x, nA.y);
        const pB = get3DPoint(nB.x, nB.y);
        const pOffA = get3DPoint(offAx, offAy);
        const pOffB = get3DPoint(offBx, offBy);

        const midX = (offAx + offBx) / 2;
        const midY = (offAy + offBy) / 2;
        const pMid = get3DPoint(midX, midY);

        const hasConflict = definitionReport.nodes[nA.id] === 'CONFLICT' || definitionReport.nodes[nB.id] === 'CONFLICT';

        return (
          <group key={constraint.id}>
            <Line
              points={[pA, pOffA]}
              color="#64748b"
              lineWidth={1.0}
              dashed
              dashSize={0.5}
              gapSize={0.5}
              depthTest={false}
            />
            <Line
              points={[pB, pOffB]}
              color="#64748b"
              lineWidth={1.0}
              dashed
              dashSize={0.5}
              gapSize={0.5}
              depthTest={false}
            />
            <Line
              points={[pOffA, pOffB]}
              color={hasConflict ? "#ef4444" : "#4f46e5"}
              lineWidth={1.5}
              depthTest={false}
            />
            
            <Html position={pMid} center>
              <div 
                className={`px-1.5 py-0.5 rounded border shadow-md font-mono text-[10px] font-bold transition-all select-none ${
                  hasConflict 
                    ? 'bg-red-50 border-red-200 text-red-600'
                    : 'bg-indigo-50/95 border-indigo-200 text-indigo-700 backdrop-blur'
                }`}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingConstraintId(constraint.id);
                  setInputValue(constraint.value!.toString());
                }}
                style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              >
                {editingConstraintId === constraint.id ? (
                  <input
                    type="number"
                    value={inputValue}
                    autoFocus
                    onChange={(e) => setInputValue(e.target.value)}
                    onBlur={() => handleSaveConstraintValue(constraint.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveConstraintValue(constraint.id);
                      if (e.key === 'Escape') setEditingConstraintId(null);
                    }}
                    className="w-[45px] bg-white border border-indigo-300 rounded px-1 py-0 text-slate-800 text-[10px] font-mono font-bold focus:outline-none"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span>{constraint.value!.toFixed(2)}</span>
                )}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
};
