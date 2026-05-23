'use client';

import React, { useMemo, useState } from 'react';
import * as THREE from 'three';
import { useCadStore } from '../store/useCadStore';
import { Line, Html } from '@react-three/drei';

export const SketchPreview = () => {
  const { 
    sketchNodes, sketchEdges, 
    activePlane, 
    isSketchMode,
    selectedEntityIds,
    setSelectedEntityIds,
    activeFaceOrigin,
    activeFaceNormal,
    referencePlanes,
    selectedId,
    selectedSubNodeType,
    features,
    updateFeatureParams
  } = useCadStore();

  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
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
      // Allow multiple selection (for geometric constraints)
      setSelectedEntityIds([...selectedEntityIds, entId]);
    }
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

        return (
          <group key={edge.id}>
            {/* Visual Line */}
            <Line
              points={entityPoints}
              color={
                isSelected 
                  ? "#ec4899" // Magenta when selected
                  : isHovered 
                  ? "#f59e0b" // Amber when hovered
                  : isCenterline 
                  ? "#6b7280" // Grey for construction
                  : "#3b82f6" // Royal Blue for standard lines
              }
              lineWidth={isSelected ? 5.5 : isHovered ? 4.5 : 3.0}
              dashed={isCenterline}
              dashSize={1.5}
              gapSize={1.0}
              depthTest={false}
            />
            
            {/* Hitbox */}
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
              color={
                isSelected 
                  ? "#ec4899" // Magenta when selected
                  : isHovered 
                  ? "#f59e0b" // Amber when hovered
                  : node.isFixed
                  ? "#10b981" // Emerald for fixed (Origin)
                  : "#3b82f6" // Royal blue for free nodes
              }
            />
          </mesh>
        );
      })}
    </group>
  );
};
