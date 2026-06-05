'use client';

import React, { useMemo, useState } from 'react';
import * as THREE from 'three';
import { useCadStore } from '../store/useCadStore';
import { sketchActions } from '../store/sketchActions';
import { v4 as uuidv4 } from 'uuid';
import { Line, Html } from '@react-three/drei';
import { analyzeSketchDefinitions, solveConstraints } from '../utils/geometry/ConstraintSolver';
import { commitPreciseSketchSolve } from '@/kernel/SketchSolverService';

export const SketchPreview = () => {
  const { 
    sketchNodes, setSketchNodes, sketchEdges, setSketchEdges, sketchConstraints,
    activePlane, 
    isSketchMode,
    smartDimensionActive, setSmartDimensionActive,
    setSketchConstraints,
    selectedEntityIds,
    setSelectedEntityIds,
    activeFaceOrigin,
    activeFaceNormal,
    referencePlanes,
    selectedId,
    selectedSubNodeType,
    features,
    visibleSketches,
    mousePos,
    gridSnap,
    solverReport
  } = useCadStore();

  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [editingConstraintId, setEditingConstraintId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState<string>('');
  const [draggingDimId, setDraggingDimId] = useState<string | null>(null);
  const [dragStartPos, setDragStartPos] = useState<{ x: number, y: number, nx?: number, ny?: number } | null>(null);
  const [dragStartOffset, setDragStartOffset] = useState<number>(12);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);

  const selectedFeature = useMemo(() => features.find(f => f.id === selectedId), [features, selectedId]);

  React.useEffect(() => {
    if (!draggingDimId || !dragStartPos) return;

    const handlePointerMove = (e: PointerEvent) => {
      const dx = e.clientX - dragStartPos.x;
      const dy = e.clientY - dragStartPos.y;
      
      // Get the 2D normal vector of the dimension on the screen
      const nx = dragStartPos.nx ?? 1;
      const ny = dragStartPos.ny ?? 0;

      // Project mouse movement (dx, dy) onto the screen-space normal vector (nx, -ny)
      // clientY is inverted relative to world Y, so screen-space Y normal is -ny
      const dot = (dx * nx) - (dy * ny);

      // Industrial Drag Logic: Intuitive projection-based delta
      const sensitivity = 0.5;
      const delta = dot * sensitivity;
      const newOffset = dragStartOffset + delta;

      sketchActions.updateConstraint(draggingDimId, { offset: newOffset });
    };

    const handlePointerUp = () => {
      setDraggingDimId(null);
      setDragStartPos(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [draggingDimId, dragStartPos, dragStartOffset, setSketchConstraints]);

  const isViewingStoredSketch = useMemo(() => {
    return !isSketchMode && selectedSubNodeType === 'SKETCH' && selectedFeature && 
      (selectedFeature.type === 'EXTRUDE' || selectedFeature.type === 'REVOLVE');
  }, [isSketchMode, selectedSubNodeType, selectedFeature]);

  // Combined list of features whose sketches should be rendered
  const sketchesToRender = useMemo(() => {
    const list: { 
      id: string, 
      points: any, 
      plane: string, 
      faceOrigin?: any, 
      faceNormal?: any, 
      faceId?: any,
      sketchNodes?: Record<string, any>,
      sketchEdges?: Record<string, any>,
      sketchConstraints?: Record<string, any>
    }[] = [];
    
    // 1. Current Active Sketch (handled by sketchNodes/Edges state)
    // We handle this separately in the return JSX to preserve interactivity
    
    // 2. Persistent Visible Sketches from other features
    features.forEach(f => {
      if (visibleSketches.includes(f.id) && (f.type === 'EXTRUDE' || f.type === 'REVOLVE')) {
        // Avoid double rendering if it's the currently selected sketch being viewed
        if (isViewingStoredSketch && f.id === selectedId) return;
        
        list.push({
          id: f.id,
          points: f.parameters.points,
          plane: f.parameters.plane,
          faceOrigin: f.parameters.faceOrigin,
          faceNormal: f.parameters.faceNormal,
          faceId: f.parameters.faceId,
          sketchNodes: f.parameters.sketchNodes,
          sketchEdges: f.parameters.sketchEdges,
          sketchConstraints: f.parameters.sketchConstraints
        });
      }
    });

    // 3. Stored Sketch currently being "viewed" via tree selection
    if (isViewingStoredSketch && selectedFeature) {
      list.push({
        id: selectedFeature.id,
        points: selectedFeature.parameters.points,
        plane: selectedFeature.parameters.plane,
        faceOrigin: selectedFeature.parameters.faceOrigin,
        faceNormal: selectedFeature.parameters.faceNormal,
        faceId: selectedFeature.parameters.faceId,
        sketchNodes: selectedFeature.parameters.sketchNodes,
        sketchEdges: selectedFeature.parameters.sketchEdges,
        sketchConstraints: selectedFeature.parameters.sketchConstraints
      });
    }

    return list;
  }, [features, visibleSketches, isViewingStoredSketch, selectedId, selectedFeature]);

  const faceBasis = useMemo(() => {
    if (activePlane !== 'FACE' || !activeFaceOrigin || !activeFaceNormal) return null;
    const origin = new THREE.Vector3(...activeFaceOrigin);
    const normal = new THREE.Vector3(...activeFaceNormal).normalize();
    const xDir = new THREE.Vector3();
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

  const get2DPointFrom3D = (pos3D: [number, number, number], plane: string, basis?: any): { u: number, v: number } => {
    const point = new THREE.Vector3(...pos3D);
    if (plane === 'FRONT') return { u: point.x, v: point.y };
    if (plane === 'TOP') return { u: point.x, v: point.z };
    if (plane === 'RIGHT') return { u: point.y, v: point.z };
    if (basis) {
      const diff = point.clone().sub(basis.origin);
      const u = diff.dot(basis.xDir);
      const v = diff.dot(basis.yDir);
      return { u, v };
    }
    return { u: point.x, v: point.y };
  };

  // Window pointerup listener for node dragging
  React.useEffect(() => {
    if (!draggingNodeId) return;

    const handlePointerUp = async () => {
      setDraggingNodeId(null);
      await commitPreciseSketchSolve();
      
      const rebuildHook = (window as any).__handleRebuild;
      if (rebuildHook) {
        rebuildHook();
      }
    };

    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [draggingNodeId]);

  // Node dragging constraint relaxation loop
  React.useEffect(() => {
    if (!draggingNodeId || !isSketchMode || !activePlane) return;

    const uv = get2DPointFrom3D(mousePos, activePlane, activeBasis);
    let u = uv.u;
    let v = uv.v;

    if (gridSnap) {
      u = Math.round(u / 5) * 5;
      v = Math.round(v / 5) * 5;
    }

    const nextNodes = {
      ...sketchNodes,
      [draggingNodeId]: { ...sketchNodes[draggingNodeId], x: u, y: v }
    };

    const resolvedNodes = solveConstraints(nextNodes, sketchEdges, sketchConstraints, 8);
    setSketchNodes(resolvedNodes);
  }, [mousePos, draggingNodeId, activePlane, activeBasis, gridSnap, isSketchMode]);

  const get3DPointForPlane = (u: number, v: number, plane: string, basis?: any): [number, number, number] => {
    if (plane === 'FRONT') return [u, v, 0];
    if (plane === 'TOP') return [u, 0, v];
    if (plane === 'RIGHT') return [0, u, v];
    if (basis) {
      const p = basis.origin.clone()
        .addScaledVector(basis.xDir, u)
        .addScaledVector(basis.yDir, v);
      return [p.x, p.y, p.z];
    }
    return [u, v, 0];
  };

  const getBasisForPlane = (plane: string, origin?: any, normal?: any) => {
    if (plane === 'FRONT' || plane === 'TOP' || plane === 'RIGHT') return null;
    if (plane === 'FACE' && origin && normal) {
      const originVec = new THREE.Vector3(...origin);
      const normalVec = new THREE.Vector3(...normal).normalize();
      const xDir = new THREE.Vector3();
      if (Math.abs(normalVec.x) < 1e-5 && Math.abs(normalVec.y) < 1e-5) {
        xDir.set(1, 0, 0);
      } else {
        xDir.set(-normalVec.y, normalVec.x, 0).normalize();
      }
      const yDir = new THREE.Vector3().crossVectors(normalVec, xDir).normalize();
      return { origin: originVec, normal: normalVec, xDir, yDir };
    }
    // Handle custom planes
    const refPlane = referencePlanes.find(p => p.id === plane);
    if (refPlane) {
      return {
        origin: new THREE.Vector3(...refPlane.origin),
        normal: new THREE.Vector3(...refPlane.normal).normalize(),
        xDir: new THREE.Vector3(...refPlane.xDir).normalize(),
        yDir: new THREE.Vector3(...refPlane.yDir).normalize()
      };
    }
    return null;
  };

    const handleEntityClick = (entId: string) => {
    if (!isSketchMode) return;

    if (smartDimensionActive) {
      // 1. Check if we already have one entity selected
      if (selectedEntityIds.length === 1) {
        const id1 = selectedEntityIds[0];
        const id2 = entId;
        if (id1 === id2) return; // Same entity

        // A. Two Lines -> Angle
        const e1 = sketchEdges[id1];
        const e2 = sketchEdges[id2];
        if (e1 && e2 && (e1.type === 'LINE' || e1.type === 'CENTER_LINE') && (e2.type === 'LINE' || e2.type === 'CENTER_LINE')) {
          const cId = uuidv4();
          sketchActions.addConstraintObj({ id: cId, type: 'ANGLE' as const, edgeIds: [id1, id2], value: 45.0 });
          setSelectedEntityIds([]);
          return;
        }

        // B. Two Nodes -> Distance
        const n1 = sketchNodes[id1];
        const n2 = sketchNodes[id2];
        if (n1 && n2) {
          const existingDim = Object.values(sketchConstraints).find(
            c => c.type === 'DISTANCE' && c.nodeIds && (
              (c.nodeIds[0] === n1.id && c.nodeIds[1] === n2.id) || 
              (c.nodeIds[0] === n2.id && c.nodeIds[1] === n1.id)
            )
          );
          if (existingDim) {
            setSelectedEntityIds([]);
            return;
          }

          const dist = Math.hypot(n2.x - n1.x, n2.y - n1.y);
          const cId = uuidv4();
          sketchActions.addConstraintObj({ id: cId, type: 'DISTANCE' as const, nodeIds: [id1, id2], value: dist });
          setSelectedEntityIds([]);
          return;
        }
      }

      // 2. Single Entity Selection Logic (Starting or Single-Click Dim)
      const edge = sketchEdges[entId];
      if (edge && (edge.type === 'LINE' || edge.type === 'CENTER_LINE' || edge.type === 'CIRCLE')) {
        // Line distance or Circle diameter
        const n1 = sketchNodes[edge.nodeIds[0]];
        const n2 = sketchNodes[edge.nodeIds[1]];
        if (n1 && n2) {
          // Prevent duplicating constraints
          const existingDim = Object.values(sketchConstraints).find(
            c => c.type === 'DISTANCE' && c.nodeIds && (
              (c.nodeIds[0] === n1.id && c.nodeIds[1] === n2.id) || 
              (c.nodeIds[0] === n2.id && c.nodeIds[1] === n1.id)
            )
          );
          if (existingDim) {
            setSelectedEntityIds([]);
            return;
          }

          const distance = Math.hypot(n2.x - n1.x, n2.y - n1.y);
          const cId = uuidv4();
          sketchActions.addConstraintObj({ id: cId, type: 'DISTANCE' as const, nodeIds: [n1.id, n2.id], value: distance });
          setSelectedEntityIds([]);
          return;
        }
      }

      // If it's a node, just select it and wait for second click
      if (sketchNodes[entId]) {
        setSelectedEntityIds([entId]);
        return;
      }
      
      // If it's a line but we might want it for an angle, select it and wait
      if (edge && (edge.type === 'LINE' || edge.type === 'CENTER_LINE')) {
        setSelectedEntityIds([entId]);
        return;
      }
    }

    // Standard Selection
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

  const geometricConstraints = useMemo(() => {
    return Object.values(sketchConstraints).filter(
      c => ['HORIZONTAL', 'VERTICAL', 'COINCIDENT', 'EQUAL', 'PARALLEL', 'PERPENDICULAR', 'CONCENTRIC'].includes(c.type)
    );
  }, [sketchConstraints]);
  const angleConstraints = useMemo(() => {
    return Object.values(sketchConstraints).filter(
      c => c.type === 'ANGLE' && c.edgeIds && c.edgeIds.length === 2 && c.value !== undefined
    );
  }, [sketchConstraints]);

  const handleSaveConstraintValue = async (constraintId: string) => {
    const val = parseFloat(inputValue);
    if (!isNaN(val) && val > 0) {
      if (useCadStore.getState().sketchConstraints[constraintId]) {
        sketchActions.updateConstraint(constraintId, { value: val });
        await commitPreciseSketchSolve();
        
        const rebuildHook = (window as any).__handleRebuild;
        if (rebuildHook) {
          rebuildHook();
        }
      }
    }
    setEditingConstraintId(null);
  };

  if (!isSketchMode && sketchesToRender.length === 0) return null;

  return (
    <group>
      {/* 1. Render Active Sketch (Interactive) */}
      {isSketchMode && activePlane && Object.values(sketchEdges).map((edge) => {
        if (edge.nodeIds.length < 2) return null;
        
        let entityPoints: [number, number, number][] = [];
        const n1 = sketchNodes[edge.nodeIds[0]];
        const n2 = sketchNodes[edge.nodeIds[1]];
        if (!n1 || !n2) return null;

        if (edge.type === 'LINE' || edge.type === 'CENTER_LINE') {
          entityPoints = [get3DPointForPlane(n1.x, n1.y, activePlane, activeBasis), get3DPointForPlane(n2.x, n2.y, activePlane, activeBasis)];
        } else if (edge.type === 'ARC') {
          const p1 = get3DPointForPlane(n1.x, n1.y, activePlane, activeBasis);
          const p2 = get3DPointForPlane(n2.x, n2.y, activePlane, activeBasis);
          
          if (edge.nodeIds.length === 3) {
            const n3 = sketchNodes[edge.nodeIds[2]];
            if (n3) {
              const p3 = get3DPointForPlane(n3.x, n3.y, activePlane, activeBasis);
              // Use quadratic bezier as a high-quality visual approximation for 3-point arc
              const curve = new THREE.QuadraticBezierCurve3(
                new THREE.Vector3(...p1),
                new THREE.Vector3(...p2), // In a 3-point arc, usually p2 is the middle/apex point
                new THREE.Vector3(...p3)
              );
              entityPoints = curve.getPoints(32).map(p => [p.x, p.y, p.z]);
            }
          } else {
            // Preview/2-point arc: straight line
            entityPoints = [p1, p2];
          }
        } else if (edge.type === 'CIRCLE') {
          const R = Math.hypot(n2.x - n1.x, n2.y - n1.y);
          for (let k = 0; k <= 36; k++) {
            const theta = (k / 36) * Math.PI * 2;
            entityPoints.push(get3DPointForPlane(n1.x + R * Math.cos(theta), n1.y + R * Math.sin(theta), activePlane, activeBasis));
          }
        } else if (edge.type === 'SPLINE') {
          // Splines can have >2 nodes
          for (let k = 0; k < edge.nodeIds.length; k++) {
            const nd = sketchNodes[edge.nodeIds[k]];
            if (nd) {
              entityPoints.push(get3DPointForPlane(nd.x, nd.y, activePlane, activeBasis));
            }
          }
          // Note: In a real renderer, we should use a SplineCurve or CatmullRomCurve3 to interpolate visually
          // For now, drawing lines between nodes will act as the control polygon / rough spline
          if (entityPoints.length >= 2) {
             const curve = new THREE.CatmullRomCurve3(entityPoints.map(p => new THREE.Vector3(...p)));
             const points = curve.getPoints(50);
             entityPoints = points.map(p => [p.x, p.y, p.z]);
          }
        }

        const isSelected = selectedEntityIds.includes(edge.id);
        const isHovered = hoveredEntityId === edge.id;
        const isCenterline = edge.type === 'CENTER_LINE' || edge.isConstruction;
        
        const isFullyDefined = solverReport?.dof === 0;
        const isOverDefined = solverReport !== undefined && solverReport !== null && solverReport.dof < 0;

        const edgeState = definitionReport.edges[edge.id];
        const strokeColor = isSelected
          ? "#ec4899"
          : isHovered
          ? "#f59e0b"
          : (isOverDefined || edgeState === 'CONFLICT')
          ? "#ef4444"
          : (isFullyDefined || edgeState === 'FULLY')
          ? "#000000"
          : isCenterline
          ? "#6b7280"
          : "#2563eb"; // SolidWorks Blue for Under Defined

        return (
          <group key={edge.id}>
            <Line
              points={entityPoints}
              color={strokeColor}
              lineWidth={isSelected ? 3.5 : isHovered ? 2.5 : 1.5}
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
              onPointerDown={(e) => { if (!isSketchMode) return; }}
              onPointerUp={(e) => {}}
              onPointerOver={(e) => { if (!isSketchMode) return; e.stopPropagation(); setHoveredEntityId(edge.id); }}
              onPointerOut={(e) => { if (!isSketchMode) return; setHoveredEntityId(null); }}
            />
          </group>
        );
      })}

      {/* 2. Render Nodes (Points) */}
      {isSketchMode && activePlane && Object.values(sketchNodes).map((node) => {
        const isSelected = selectedEntityIds.includes(node.id);
        const isHovered = hoveredEntityId === node.id;
        const pos = get3DPointForPlane(node.x, node.y, activePlane, activeBasis);

        const isFullyDefined = solverReport?.dof === 0;
        const isOverDefined = solverReport !== undefined && solverReport !== null && solverReport.dof < 0;

        const nodeState = definitionReport.nodes[node.id];
        const dotColor = isSelected
          ? "#ec4899"
          : isHovered
          ? "#f59e0b"
          : node.isFixed
          ? "#10b981"
          : (isOverDefined || nodeState === 'CONFLICT')
          ? "#ef4444"
          : (isFullyDefined || nodeState === 'FULLY')
          ? "#0f172a" // Almost black
          : "#3b82f6";

        return (
          <mesh 
            key={node.id} 
            position={pos}
            onClick={(e) => { e.stopPropagation(); handleEntityClick(node.id); }}
            onPointerOver={(e) => { if (!isSketchMode) return; e.stopPropagation(); setHoveredEntityId(node.id); }}
            onPointerOut={(e) => { if (!isSketchMode) return; setHoveredEntityId(null); }}
            onPointerDown={(e) => {
              if (!isSketchMode) return;
              setDraggingNodeId(node.id);
            }}
            onPointerUp={(e) => {}}
          >
            <sphereGeometry args={[isSelected || isHovered ? 0.35 : 0.2, 12, 12]} />
            <meshBasicMaterial
              depthTest={false}
              color={dotColor}
            />
          </mesh>
        );
      })}

      {/* 3. Render Floating Interactive 2D Dimension Lines for DISTANCE constraints */}
      {isSketchMode && activePlane && distanceConstraints.map((constraint) => {
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

        const currentOffset = constraint.offset ?? 12;
        const offAx = nA.x + nx * currentOffset;
        const offAy = nA.y + ny * currentOffset;
        const offBx = nB.x + nx * currentOffset;
        const offBy = nB.y + ny * currentOffset;

        const pA = get3DPointForPlane(nA.x, nA.y, activePlane, activeBasis);
        const pB = get3DPointForPlane(nB.x, nB.y, activePlane, activeBasis);
        const pOffA = get3DPointForPlane(offAx, offAy, activePlane, activeBasis);
        const pOffB = get3DPointForPlane(offBx, offBy, activePlane, activeBasis);

        const midX = (offAx + offBx) / 2;
        const midY = (offAy + offBy) / 2;
        const pMid = get3DPointForPlane(midX, midY, activePlane, activeBasis);

        // Arrowhead vectors for the dimension line
        const arrowSize = 1.2;
        const pArrow1A = get3DPointForPlane(offAx + (ux - nx) * arrowSize, offAy + (uy - ny) * arrowSize, activePlane, activeBasis);
        const pArrow1B = get3DPointForPlane(offAx + (ux + nx) * arrowSize, offAy + (uy + ny) * arrowSize, activePlane, activeBasis);
        const pArrow2A = get3DPointForPlane(offBx + (-ux - nx) * arrowSize, offBy + (-uy - ny) * arrowSize, activePlane, activeBasis);
        const pArrow2B = get3DPointForPlane(offBx + (-ux + nx) * arrowSize, offBy + (-uy + ny) * arrowSize, activePlane, activeBasis);

        const isSelected = selectedEntityIds.includes(constraint.id);
        const hasConflict = definitionReport.nodes[nA.id] === 'CONFLICT' || definitionReport.nodes[nB.id] === 'CONFLICT';

        const dimColor = isSelected ? "#ec4899" : hasConflict ? "#ef4444" : "#4f46e5";

        return (
          <group key={constraint.id}>
            <Line
              points={[pA, pOffA]}
              color="#64748b"
              lineWidth={0.8}
              dashed
              dashSize={0.5}
              gapSize={0.5}
              depthTest={false}
            />
            <Line
              points={[pB, pOffB]}
              color="#64748b"
              lineWidth={0.8}
              dashed
              dashSize={0.5}
              gapSize={0.5}
              depthTest={false}
            />
            {/* Dimension Line */}
            <Line
              points={[pOffA, pOffB]}
              color={dimColor}
              lineWidth={isSelected ? 2.0 : 1.2}
              depthTest={false}
            />
            {/* Arrowheads */}
            <Line
              points={[pArrow1A, pOffA, pArrow1B]}
              color={dimColor}
              lineWidth={isSelected ? 2.0 : 1.2}
              depthTest={false}
            />
            <Line
              points={[pArrow2A, pOffB, pArrow2B]}
              color={dimColor}
              lineWidth={isSelected ? 2.0 : 1.2}
              depthTest={false}
            />
            
            <Html position={pMid} center>
              <div 
                className={`px-1.5 py-0.25 rounded border shadow-lg font-mono text-[10px] font-black transition-all select-none flex items-center gap-1 ${
                  isSelected
                    ? 'bg-pink-50 border-pink-400 text-pink-700 shadow-pink-100'
                    : hasConflict 
                    ? 'bg-red-50 border-red-300 text-red-600'
                    : 'bg-white/90 border-indigo-400 text-indigo-800 shadow-indigo-100/50'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleEntityClick(constraint.id);
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setDraggingDimId(constraint.id);
                  setDragStartPos({ x: e.clientX, y: e.clientY, nx, ny });
                  setDragStartOffset(constraint.offset ?? 12);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingConstraintId(constraint.id);
                  setInputValue(constraint.value!.toString());
                }}
                style={{ pointerEvents: 'auto', cursor: draggingDimId ? 'grabbing' : 'grab' }}
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
      {isSketchMode && activePlane && angleConstraints.map((c) => {
        const e1 = sketchEdges[c.edgeIds![0]];
        const e2 = sketchEdges[c.edgeIds![1]];
        if (!e1 || !e2) return null;
        const n1a = sketchNodes[e1.nodeIds[0]]; const n1b = sketchNodes[e1.nodeIds[1]];
        const n2a = sketchNodes[e2.nodeIds[0]]; const n2b = sketchNodes[e2.nodeIds[1]];
        if (!n1a || !n1b || !n2a || !n2b) return null;

        // Visual Center (Roughly midpoint of both lines)
        const cx = (n1a.x + n1b.x + n2a.x + n2b.x) / 4;
        const cy = (n1a.y + n1b.y + n2a.y + n2b.y) / 4;
        const pMid = get3DPointForPlane(cx, cy, activePlane, activeBasis);

        return (
          <group key={c.id}>
            <Html position={pMid} center>
              <div 
                className="px-1.5 py-0.5 rounded border border-indigo-400 bg-white/90 text-indigo-800 text-[10px] font-black shadow-md cursor-pointer flex items-center gap-1"
                onClick={(e) => { e.stopPropagation(); handleEntityClick(c.id); }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingConstraintId(c.id);
                  setInputValue(c.value!.toString());
                }}
              >
                {editingConstraintId === c.id ? (
                  <input
                    type="number" value={inputValue} autoFocus
                    onChange={(e) => setInputValue(e.target.value)}
                    onBlur={() => handleSaveConstraintValue(c.id)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveConstraintValue(c.id)}
                    className="w-[40px] outline-none"
                  />
                ) : (
                  <span>{c.value!.toFixed(1)}°</span>
                )}
              </div>
            </Html>
          </group>
        );
      })}

      {/* 4. Render Geometric Constraint Icons (Horizontal, Vertical, etc.) */}
      {isSketchMode && activePlane && geometricConstraints.map((constraint) => {
        let pos: [number, number, number] | null = null;
        let icon = "";

        if (constraint.type === 'HORIZONTAL' || constraint.type === 'VERTICAL' || constraint.type === 'PARALLEL' || constraint.type === 'PERPENDICULAR' || constraint.type === 'CONCENTRIC') {
          if (!constraint.edgeIds || constraint.edgeIds.length === 0) return null;
          const edge = sketchEdges[constraint.edgeIds[0]];
          if (!edge || edge.nodeIds.length < 2) return null;
          const n1 = sketchNodes[edge.nodeIds[0]];
          const n2 = sketchNodes[edge.nodeIds[1]];
          if (!n1 || !n2) return null;
          pos = get3DPointForPlane((n1.x + n2.x) / 2, (n1.y + n2.y) / 2, activePlane, activeBasis);
          if (constraint.type === 'HORIZONTAL') icon = "—";
          else if (constraint.type === 'VERTICAL') icon = "│";
          else if (constraint.type === 'PARALLEL') icon = "∥";
          else if (constraint.type === 'PERPENDICULAR') icon = "⊥";
          else if (constraint.type === 'CONCENTRIC') icon = "◎";
          else if (constraint.type === 'TANGENT') icon = "○";
          else if (constraint.type === 'MIDPOINT') icon = "⬗";
          else if (constraint.type === 'SYMMETRIC') icon = "|⬵|";

          } else if (constraint.type === 'COINCIDENT') {
          if (!constraint.nodeIds || constraint.nodeIds.length === 0) return null;
          const n = sketchNodes[constraint.nodeIds[0]];
          if (!n) return null;
          pos = get3DPointForPlane(n.x, n.y, activePlane, activeBasis);
          // Offset slightly to avoid Z-fighting with node
          pos[0] += 1; pos[1] += 1;
          icon = "•";
        }

        if (!pos) return null;

        return (
          <Html key={constraint.id} position={pos} center>
            <div className="w-3 h-3 bg-emerald-500 border border-emerald-600 rounded-sm flex items-center justify-center text-[9px] text-white font-bold shadow-sm pointer-events-none opacity-80">
              {icon}
            </div>
          </Html>
        );
      })}

      {/* 5. Render Passive Sketches (Persistent Visible or Tree-Selected) */}
      {sketchesToRender.map((sketch) => {
        const basis = getBasisForPlane(sketch.plane, sketch.faceOrigin, sketch.faceNormal);
        const isSelected = selectedId === sketch.id && selectedSubNodeType === 'SKETCH';
        const color = isSelected ? "#ec4899" : "#64748b";
        const opacity = isSelected ? 0.9 : 0.6;
        const lineWidth = isSelected ? 2.5 : 1.0;

        // If we have parametric data, use it for richer rendering (including dimensions)
        if (sketch.sketchNodes && sketch.sketchEdges) {
          return (
            <group key={`passive_${sketch.id}`}>
              {/* Edges */}
              {Object.values(sketch.sketchEdges).map((edge: any) => {
                if (edge.nodeIds.length < 2) return null;
                const n1 = sketch.sketchNodes![edge.nodeIds[0]];
                const n2 = sketch.sketchNodes![edge.nodeIds[1]];
                if (!n1 || !n2) return null;

                let entityPoints: [number, number, number][] = [];
                if (edge.type === 'LINE' || edge.type === 'CENTER_LINE') {
                  entityPoints = [
                    get3DPointForPlane(n1.x, n1.y, sketch.plane, basis),
                    get3DPointForPlane(n2.x, n2.y, sketch.plane, basis)
                  ];
                } else if (edge.type === 'ARC') {
                  const p1 = get3DPointForPlane(n1.x, n1.y, sketch.plane, basis);
                  const p2 = get3DPointForPlane(n2.x, n2.y, sketch.plane, basis);
                  if (edge.nodeIds.length === 3) {
                    const n3 = sketch.sketchNodes![edge.nodeIds[2]];
                    if (n3) {
                      const p3 = get3DPointForPlane(n3.x, n3.y, sketch.plane, basis);
                      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(...p1), new THREE.Vector3(...p2), new THREE.Vector3(...p3));
                      entityPoints = curve.getPoints(32).map(p => [p.x, p.y, p.z]);
                    }
                  } else {
                    entityPoints = [p1, p2];
                  }
                } else if (edge.type === 'CIRCLE') {
                  const R = Math.hypot(n2.x - n1.x, n2.y - n1.y);
                  for (let k = 0; k <= 36; k++) {
                    const theta = (k / 36) * Math.PI * 2;
                    entityPoints.push(get3DPointForPlane(n1.x + R * Math.cos(theta), n1.y + R * Math.sin(theta), sketch.plane, basis));
                  }
                }

                return (
                  <Line
                    key={`${sketch.id}_edge_${edge.id}`}
                    points={entityPoints}
                    color={color}
                    lineWidth={lineWidth}
                    dashed={edge.type === 'CENTER_LINE' || edge.isConstruction}
                    dashSize={1.5}
                    gapSize={1.0}
                    transparent
                    opacity={opacity}
                    depthTest={false}
                  />
                );
              })}

              {/* Dimensions (Only if selected) */}
              {isSelected && sketch.sketchConstraints && Object.values(sketch.sketchConstraints)
                .filter((c: any) => c.type === 'DISTANCE' && c.nodeIds?.length === 2)
                .map((constraint: any) => {
                  const nA = sketch.sketchNodes![constraint.nodeIds[0]];
                  const nB = sketch.sketchNodes![constraint.nodeIds[1]];
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
                  const pA = get3DPointForPlane(nA.x, nA.y, sketch.plane, basis);
                  const pB = get3DPointForPlane(nB.x, nB.y, sketch.plane, basis);
                  const pOffA = get3DPointForPlane(nA.x + nx * offsetDist, nA.y + ny * offsetDist, sketch.plane, basis);
                  const pOffB = get3DPointForPlane(nB.x + nx * offsetDist, nB.y + ny * offsetDist, sketch.plane, basis);
                  const pMid = get3DPointForPlane((nA.x + nB.x) / 2 + nx * offsetDist, (nA.y + nB.y) / 2 + ny * offsetDist, sketch.plane, basis);

                  return (
                    <group key={`${sketch.id}_dim_${constraint.id}`}>
                      <Line points={[pA, pOffA]} color="#94a3b8" lineWidth={0.5} dashed dashSize={0.5} gapSize={0.5} depthTest={false} />
                      <Line points={[pB, pOffB]} color="#94a3b8" lineWidth={0.5} dashed dashSize={0.5} gapSize={0.5} depthTest={false} />
                      <Line points={[pOffA, pOffB]} color={color} lineWidth={1.0} depthTest={false} />
                      <Html position={pMid} center>
                        <div className="bg-white/80 border border-pink-300 text-pink-700 px-1 rounded text-[9px] font-mono font-bold shadow-sm">
                          {constraint.value?.toFixed(1)}
                        </div>
                      </Html>
                    </group>
                  );
                })}
            </group>
          );
        }

        // Fallback to basic loop rendering for legacy features
        const loops: any[][] = Array.isArray(sketch.points[0]) && Array.isArray(sketch.points[0][0]) 
          ? sketch.points 
          : [sketch.points];

        return (
          <group key={`passive_${sketch.id}`}>
            {loops.map((loop, lIdx) => {
              const entityPoints: [number, number, number][] = loop.map((p: any) => 
                get3DPointForPlane(p[0], p[1], sketch.plane, basis)
              );
              // Close the loop for display
              if (entityPoints.length > 0) {
                entityPoints.push(entityPoints[0]);
              }

              return (
                <Line
                  key={`${sketch.id}_loop_${lIdx}`}
                  points={entityPoints}
                  color={isSelected ? "#ec4899" : "#64748b"}
                  lineWidth={isSelected ? 2.5 : 1.0}
                  transparent
                  opacity={isSelected ? 0.9 : 0.6}
                  depthTest={false}
                />
              );
            })}
          </group>
        );
      })}
    </group>
  );
};
