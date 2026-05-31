import React, { useState, useMemo } from 'react';
import { Plane, Text, Html, Sphere, Line, Grid } from '@react-three/drei';
import { useCadStore } from '../store/useCadStore';
import * as THREE from 'three';
import { v4 as uuidv4 } from 'uuid';
import { previewSolve, commitPreciseSketchSolve } from '@/kernel/SketchSolverService';

export const DatumPlanes = () => {
  const { 
    activePlane, setActivePlane, 
    isSketchMode, setSketchMode,
    sketchNodes, setSketchNodes, sketchEdges, setSketchEdges, sketchConstraints, setSketchConstraints,
    sketchTool, setSketchTool,
    gridSnap,
    setEditingFeatureId,
    contextMenu, setContextMenu,
    meshData,
    sketchNewChain, setSketchNewChain,
    activeFaceOrigin,
    activeFaceNormal,
    activeFaceId, computedRefGeometry,
    referencePlanes,
    referenceAxes,
    pendingFeatureCommand,
    selectedId,
    measurementMode,
    setMeasurementPoints,
  } = useCadStore();
  
  const [hovered, setHovered] = useState<string | null>(null);
  
  const [dragStartUV, setDragStartUV] = useState<{u: number, v: number} | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lastClickedUV, setLastClickedUV] = useState<{u: number, v: number} | null>(null);
  const [lastClickedNodeId, setLastClickedNodeId] = useState<string | null>(null);
  const [firstChainNodeId, setFirstChainNodeId] = useState<string | null>(null);
  const [hasMovedAway, setHasMovedAway] = useState(false);

  const [cursorState, setCursorState] = useState<{u: number, v: number, type: string | null} | null>(null);
  const [inferenceLines, setInferenceLines] = useState<{ p1: [number, number], p2: [number, number] }[]>([]);
  const [trimPath, setTrimPath] = useState<THREE.Vector3[]>([]);
  const [activeDim, setActiveDim] = useState<{ length: number, angle: number } | null>(null);

  const faceBasis = useMemo(() => {
    if (activePlane !== 'FACE' || !activeFaceOrigin || !activeFaceNormal) {
      return null;
    }
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
    if (!activePlane || ['FRONT', 'TOP', 'RIGHT', 'FACE'].includes(activePlane)) {
      return null;
    }
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

  const getCustomFaceUV = (point: THREE.Vector3) => {
    const basis = activeBasis;
    if (!basis) return { u: 0, v: 0 };
    const diff = point.clone().sub(basis.origin);
    const u = diff.dot(basis.xDir);
    const v = diff.dot(basis.yDir);
    return { u, v };
  };

  const get3DPnt = (u: number, v: number) => {
    if (activePlane === 'FRONT') return new THREE.Vector3(u, v, 0);
    if (activePlane === 'TOP') return new THREE.Vector3(u, 0, v);
    if (activePlane === 'RIGHT') return new THREE.Vector3(0, u, v);
    const basis = activeBasis;
    if (basis) {
      return basis.origin.clone()
        .addScaledVector(basis.xDir, u)
        .addScaledVector(basis.yDir, v);
    }
    return new THREE.Vector3(u, v, 0);
  };

  const getSnappedUV = (rawU: number, rawV: number) => {
    let u = rawU;
    let v = rawV;
    let snappedId = null;
    const currentInferences: { p1: [number, number], p2: [number, number] }[] = [];

    if (gridSnap) {
      u = Math.round(u / 5) * 5;
      v = Math.round(v / 5) * 5;
    }

    if (Math.abs(u) < 1.5 && Math.abs(v) < 1.5) {
      setCursorState({ u: 0, v: 0, type: 'COINCIDENT' });
      setInferenceLines([]);
      return { u: 0, v: 0, id: 'origin' };
    }

    const SNAP_DIST = 2.5;

    for (const node of Object.values(sketchNodes)) {
      if (Math.hypot(node.x - rawU, node.y - rawV) < SNAP_DIST) {
        setCursorState({ u: node.x, v: node.y, type: 'COINCIDENT' });
        setInferenceLines([]);
        return { u: node.x, v: node.y, id: node.id };
      }
    }

    let bestU = u;
    let bestV = v;
    let foundH = false;
    let foundV = false;

    if (lastClickedUV) {
       if (Math.abs(rawU - lastClickedUV.u) < SNAP_DIST) {
         bestU = lastClickedUV.u; foundV = true;
         currentInferences.push({ p1: [lastClickedUV.u, lastClickedUV.v], p2: [lastClickedUV.u, rawV] });
       }
       if (Math.abs(rawV - lastClickedUV.v) < SNAP_DIST) {
         bestV = lastClickedUV.v; foundH = true;
         currentInferences.push({ p1: [lastClickedUV.u, lastClickedUV.v], p2: [rawU, lastClickedUV.v] });
       }
    }

    if (!foundV || !foundH) {
      for (const node of Object.values(sketchNodes)) {
        if (!foundV && Math.abs(rawU - node.x) < SNAP_DIST) {
          bestU = node.x; foundV = true;
          currentInferences.push({ p1: [node.x, node.y], p2: [node.x, rawV] });
        }
        if (!foundH && Math.abs(rawV - node.y) < SNAP_DIST) {
          bestV = node.y; foundH = true;
          currentInferences.push({ p1: [node.x, node.y], p2: [rawU, node.y] });
        }
      }
      if (!foundV && Math.abs(rawU) < SNAP_DIST) { bestU = 0; foundV = true; currentInferences.push({ p1: [0, 0], p2: [0, rawV] }); }
      if (!foundH && Math.abs(rawV) < SNAP_DIST) { bestV = 0; foundH = true; currentInferences.push({ p1: [0, 0], p2: [rawU, 0] }); }
    }

    setInferenceLines(currentInferences);
    if (foundH || foundV) {
      setCursorState({ u: bestU, v: bestV, type: foundH && foundV ? 'COINCIDENT' : (foundH ? 'HORIZONTAL' : 'VERTICAL') });
      return { u: bestU, v: bestV, id: null };
    }

    setCursorState(null);
    return { u, v, id: null };
  };

  const handlePointerMove = (e: any) => {
    if (!isSketchMode || !activePlane) return;
    const plane = e.object.name;
    if (activePlane !== plane) return;

    let rawU = 0, rawV = 0;
    if (plane === 'FRONT') { rawU = e.point.x; rawV = e.point.y; }
    else if (plane === 'TOP') { rawU = e.point.x; rawV = e.point.z; }
    else if (plane === 'RIGHT') { rawU = e.point.y; rawV = e.point.z; }
    else {
      const uv = getCustomFaceUV(e.point);
      rawU = uv.u; rawV = uv.v;
    }

    const { u, v } = getSnappedUV(rawU, rawV);
    
    if (lastClickedUV && Math.hypot(u - lastClickedUV.u, v - lastClickedUV.v) > 2) {
      setHasMovedAway(true);
    }

    if (lastClickedUV && (sketchTool === 'LINE' || sketchTool === 'CENTER_LINE' || sketchTool === 'RECTANGLE')) {
      const du = u - lastClickedUV.u;
      const dv = v - lastClickedUV.v;
      const len = Math.hypot(du, dv);
      const ang = Math.atan2(dv, du) * (180 / Math.PI);
      setActiveDim({ length: len, angle: ang });
    } else {
      if (activeDim) setActiveDim(null);
    }

    if (isDragging) {
      if (sketchTool === 'TRIM') {
        const currentPnt = new THREE.Vector3().copy(e.point);
        setTrimPath(prev => {
          const next = [...prev, currentPnt];
          if (next.length > 2) {
            const p1 = next[next.length - 2];
            const p2 = next[next.length - 1];
            // Check intersection with all edges
            const edges = Object.values(useCadStore.getState().sketchEdges);
            const nodes = useCadStore.getState().sketchNodes;
            
            for (const edge of edges) {
              if (edge.type === 'LINE') {
                const n1 = nodes[edge.nodeIds[0]];
                const n2 = nodes[edge.nodeIds[1]];
                if (!n1 || !n2) continue;
                
                // Segment 1: p1 to p2 (drag)
                // Segment 2: n1 to n2 (edge)
                // Projected 2D intersection
                const intersect = (
                  x1: number, y1: number, x2: number, y2: number, 
                  x3: number, y3: number, x4: number, y4: number
                ) => {
                  const den = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
                  if (den === 0) return false;
                  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / den;
                  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / den;
                  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
                };

                let hit = false;
                if (plane === 'FRONT') hit = intersect(p1.x, p1.y, p2.x, p2.y, n1.x, n1.y, n2.x, n2.y);
                else if (plane === 'TOP') hit = intersect(p1.x, p1.z, p2.x, p2.z, n1.x, n1.y, n2.x, n2.y);
                else if (plane === 'RIGHT') hit = intersect(p1.y, p1.z, p2.y, p2.z, n1.x, n1.y, n2.x, n2.y);
                else {
                  const uv1 = getCustomFaceUV(p1);
                  const uv2 = getCustomFaceUV(p2);
                  hit = intersect(uv1.u, uv1.v, uv2.u, uv2.v, n1.x, n1.y, n2.x, n2.y);
                }

                if (hit) {
                  useCadStore.setState(state => {
                    const nextEdges = { ...state.sketchEdges };
                    delete nextEdges[edge.id];
                    return { sketchEdges: nextEdges };
                  });
                }
              }
            }
          }
          return next.slice(-20); // Keep short trail
        });
      }
      else if (lastClickedUV && sketchTool === 'LINE') {
        setSketchTool('ARC');
      }
    }
  };

  const distToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const l2 = (x2-x1)**2 + (y2-y1)**2;
    if (l2 === 0) return Math.hypot(px-x1, py-y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  };

  const nodes_to_be_extended_find = (targetId: string, clickU: number, clickV: number, nodes: any, edges: any) => {
    const edge = edges[targetId];
    if (!edge || edge.type !== 'LINE') return null;
    const n1 = nodes[edge.nodeIds[0]];
    const n2 = nodes[edge.nodeIds[1]];
    if (!n1 || !n2) return null;

    // Determine direction: which end is closer to click?
    const d1 = Math.hypot(clickU - n1.x, clickV - n1.y);
    const d2 = Math.hypot(clickU - n2.x, clickV - n2.y);
    
    const extendNodeId = d1 < d2 ? n1.id : n2.id;
    const baseNodeId = d1 < d2 ? n2.id : n1.id;
    const extN = nodes[extendNodeId];
    const baseN = nodes[baseNodeId];

    // Ray: origin = base, dir = base -> ext
    const dx = extN.x - baseN.x;
    const dy = extN.y - baseN.y;
    const mag = Math.hypot(dx, dy);
    if (mag < 1e-6) return null;
    const ux = dx / mag;
    const uy = dy / mag;

    let bestT = Infinity;
    let bestP = null;

    // Check intersection with all other edges
    for (const other of Object.values(edges) as any[]) {
      if (other.id === targetId) continue;
      if (other.type === 'LINE') {
        const o1 = nodes[other.nodeIds[0]];
        const o2 = nodes[other.nodeIds[1]];
        if (!o1 || !o2) continue;
        
        // Ray-Line intersection
        const x1 = baseN.x, y1 = baseN.y, x2 = baseN.x + ux * 1000, y2 = baseN.y + uy * 1000;
        const x3 = o1.x, y3 = o1.y, x4 = o2.x, y4 = o2.y;
        const den = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
        if (Math.abs(den) < 1e-6) continue;
        const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / den;
        const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / den;
        
        if (ua > 1.0 && ub >= 0 && ub <= 1) { // ua > 1.0 means past the extend node
           const tx = x1 + ua * (x2 - x1);
           const ty = y1 + ua * (y2 - y1);
           const dist = Math.hypot(tx - extN.x, ty - extN.y);
           if (dist < bestT) {
             bestT = dist;
             bestP = { x: tx, y: ty };
           }
        }
      }
    }

    if (bestP) {
      return { nodeId: extendNodeId, newX: bestP.x, newY: bestP.y };
    }
    return null;
  };

  const handlePlaneClick = (plane: string, event: any) => {
    if (event.button !== 0) return;
    if (contextMenu) {
      setContextMenu(null);
      return;
    }
    if (!isSketchMode) {
      if (measurementMode !== 'NONE') {
         const planeRef = referencePlanes.find(p => p.id === plane);
         const selected = planeRef ? { 
            type: 'FACE' as const,
            id: planeRef.id, 
            coordinates: planeRef.origin as [number, number, number], 
            normal: planeRef.normal as [number, number, number],
            componentId: 'root'
         } : { 
            type: 'FACE' as const,
            id: plane, 
            coordinates: [0,0,0] as [number, number, number], 
            normal: (plane === 'FRONT' ? [0,0,1] : plane === 'TOP' ? [0,1,0] : [1,0,0]) as [number, number, number],
            componentId: 'root'
         };

         const currentPoints = useCadStore.getState().measurementPoints;
         if (currentPoints.length < 2) {
           useCadStore.getState().setMeasurementPoints([...currentPoints, selected]);
         } else {
           useCadStore.getState().setMeasurementPoints([currentPoints[0], selected]);
         }
         return;
      }
      
      if (pendingFeatureCommand === 'PLANE' && selectedId) {
         const planeRef = referencePlanes.find(p => p.id === plane);
         const refData = planeRef ? { 
            id: planeRef.id, 
            type: 'PLANE', 
            coordinates: planeRef.origin, 
            normal: planeRef.normal 
         } : { 
            id: plane, 
            type: 'PLANE', 
            coordinates: [0,0,0], 
            normal: plane === 'FRONT' ? [0,0,1] : plane === 'TOP' ? [0,1,0] : [1,0,0] 
         };
         useCadStore.getState().updateFeatureParams(selectedId, { refs: [refData] });
         return;
      }
      setActivePlane(plane);
      setSketchMode(true);
      return;
    }
    if (activePlane !== plane) return;
    event.stopPropagation();

    const point = event.point;
    let rawU = 0, rawV = 0;
    if (plane === 'FRONT') { rawU = point.x; rawV = point.y; }
    else if (plane === 'TOP') { rawU = point.x; rawV = point.z; }
    else if (plane === 'RIGHT') { rawU = point.y; rawV = point.z; }
    else {
      const uv = getCustomFaceUV(point);
      rawU = uv.u; rawV = uv.v;
    }

    const snapped = getSnappedUV(rawU, rawV);
    const u = snapped.u;
    const v = snapped.v;
    const activeSnapType = cursorState?.type;

    if (sketchTool === 'EXTEND') {
       const edges = Object.values(useCadStore.getState().sketchEdges);
       const nodes = useCadStore.getState().sketchNodes;
       let targetEdgeId = null;
       let minDist = 5.0;

       for (const edge of edges) {
         if (edge.type === 'LINE') {
           const n1 = nodes[edge.nodeIds[0]];
           const n2 = nodes[edge.nodeIds[1]];
           if (!n1 || !n2) continue;
           const d = distToSegment(rawU, rawV, n1.x, n1.y, n2.x, n2.y);
           if (d < minDist) { minDist = d; targetEdgeId = edge.id; }
         }
       }

       if (targetEdgeId) {
         const edge = nodes_to_be_extended_find(targetEdgeId, rawU, rawV, nodes, edges);
         if (edge) {
            useCadStore.setState(state => {
              const nextNodes = { ...state.sketchNodes };
              nextNodes[edge.nodeId] = { ...nextNodes[edge.nodeId], x: edge.newX, y: edge.newY };
              return { sketchNodes: nextNodes };
            });
            commitPreciseSketchSolve();
         }
       }
       return;
    }

    const nId = snapped.id || uuidv4();
    const isOrigin = Math.abs(u) < 1e-5 && Math.abs(v) < 1e-5;
    const newNode = { id: nId, x: u, y: v, isFixed: isOrigin };
    
    let isClosing = false;
    if (!sketchNewChain && firstChainNodeId === nId) {
       isClosing = true;
    }

    useCadStore.setState((state) => {
      const nextNodes = { ...state.sketchNodes };
      if (!nextNodes[nId]) nextNodes[nId] = newNode;
      
      let nextEdges = { ...state.sketchEdges };
      let nextConstraints = { ...state.sketchConstraints };
      let nextLastNodeId = lastClickedNodeId;

      if (sketchTool === 'LINE' || sketchTool === 'CENTER_LINE') {
         if (sketchNewChain || !lastClickedNodeId) {
            nextLastNodeId = nId;
         } else {
            const eId = uuidv4();
            nextEdges[eId] = { 
              id: eId, 
              type: 'LINE', 
              nodeIds: [lastClickedNodeId, nId],
              isConstruction: sketchTool === 'CENTER_LINE'
            };
            
            // Auto-Constraint Capture
            if (activeSnapType === 'HORIZONTAL' || activeSnapType === 'VERTICAL') {
              const cId = uuidv4();
              nextConstraints[cId] = {
                id: cId,
                type: activeSnapType,
                edgeIds: [eId]
              };
            }

            const solved = previewSolve(nextNodes, nextEdges, nextConstraints, 4);
            Object.assign(nextNodes, solved);
            nextLastNodeId = nId;
         }
      } else if (sketchTool === 'ARC') {
         if (sketchNewChain || !lastClickedNodeId) {
            nextLastNodeId = nId;
         } else {
            // 3-Point Arc Logic (Simplified: Start -> End -> Middle/Curvature)
            // If we have 2 points, and user clicks 3rd, we create/update the arc
            let activeArcEdgeId: string | null = null;
            for (const edge of Object.values(nextEdges)) {
               if (edge.type === 'ARC' && edge.nodeIds.length < 3 && edge.nodeIds[0] === firstChainNodeId) {
                  activeArcEdgeId = edge.id;
                  break;
               }
            }

            if (activeArcEdgeId) {
               nextEdges[activeArcEdgeId].nodeIds.push(nId);
               nextLastNodeId = null; // Arc finished
            } else {
               const eId = uuidv4();
               nextEdges[eId] = { id: eId, type: 'ARC', nodeIds: [lastClickedNodeId, nId] };
               nextLastNodeId = nId;
            }
         }
      } else if (sketchTool === 'SPLINE') {
         if (sketchNewChain || !lastClickedNodeId) {
            nextLastNodeId = nId;
         } else {
            let activeSplineEdgeId: string | null = null;
            for (const edge of Object.values(nextEdges)) {
               if (edge.type === 'SPLINE' && edge.nodeIds[edge.nodeIds.length - 1] === lastClickedNodeId) {
                  activeSplineEdgeId = edge.id;
                  break;
               }
            }
            if (activeSplineEdgeId) nextEdges[activeSplineEdgeId].nodeIds.push(nId);
            else {
               const eId = uuidv4();
               nextEdges[eId] = { id: eId, type: 'SPLINE', nodeIds: [lastClickedNodeId, nId] };
            }
            nextLastNodeId = nId;
         }
      } else if (sketchTool === 'CIRCLE') {
         if (sketchNewChain || !lastClickedNodeId) {
            nextLastNodeId = nId;
         } else {
            const eId = uuidv4();
            nextEdges[eId] = { id: eId, type: 'CIRCLE', nodeIds: [lastClickedNodeId, nId] };
            nextLastNodeId = null;
         }
      } else if (sketchTool === 'RECTANGLE') {
         if (sketchNewChain || !lastClickedNodeId) {
            nextLastNodeId = nId;
         } else {
            const n1 = lastClickedNodeId;
            const n3 = nId;
            const n2 = uuidv4();
            const n4 = uuidv4();
            nextNodes[n2] = { id: n2, x: u, y: nextNodes[n1].y };
            nextNodes[n4] = { id: n4, x: nextNodes[n1].x, y: v };
            const e1 = uuidv4(); const e2 = uuidv4(); const e3 = uuidv4(); const e4 = uuidv4();
            nextEdges[e1] = { id: e1, type: 'LINE', nodeIds: [n1, n2] };
            nextEdges[e2] = { id: e2, type: 'LINE', nodeIds: [n2, n3] };
            nextEdges[e3] = { id: e3, type: 'LINE', nodeIds: [n3, n4] };
            nextEdges[e4] = { id: e4, type: 'LINE', nodeIds: [n4, n1] };
            nextLastNodeId = null;
         }
      }
      return { sketchNodes: nextNodes, sketchEdges: nextEdges, sketchConstraints: nextConstraints };
    });

    if (isClosing || ((sketchTool === 'CIRCLE' || sketchTool === 'RECTANGLE') && !sketchNewChain)) {
      setSketchNewChain(true);
      setLastClickedNodeId(null);
      setFirstChainNodeId(null);
    } else {
      if (sketchNewChain) setFirstChainNodeId(nId);
      setLastClickedNodeId(nId);
      setSketchNewChain(false);
      setLastClickedUV({ u, v });
      setHasMovedAway(false);
    }

    if (isSketchMode) void commitPreciseSketchSolve();
  };

  const handlePlaneDoubleClick = (plane: string, event: any) => {
    if (!isSketchMode || activePlane !== plane) return;
    event.stopPropagation();
    setSketchNewChain(true);
    setLastClickedUV(null);
    setLastClickedNodeId(null);
    setFirstChainNodeId(null);
    setCursorState(null);
  };

  const handleContextMenu = (plane: string, event: any) => {
    if (activePlane && activePlane !== plane) return;
    event.stopPropagation();
    if (isSketchMode && !sketchNewChain) {
      setSketchNewChain(true);
      setLastClickedNodeId(null);
      setFirstChainNodeId(null);
      return;
    }
    setContextMenu({
      visible: true,
      x: event.nativeEvent.clientX,
      y: event.nativeEvent.clientY,
      type: 'BACKGROUND',
      data: { plane }
    });
  };

  return (
    <group>
      <Plane
        name="FRONT"
        args={[200, 200]}
        position={[0, 0, 0]}
        visible={isSketchMode ? activePlane === 'FRONT' : true}
        onPointerOver={() => setHovered('FRONT')}
        onPointerOut={() => { setHovered(null); setCursorState(null); }}
        onPointerMove={handlePointerMove}
        onPointerDown={(e) => {
            const rawU = e.point.x; const rawV = e.point.y;
            const snapped = getSnappedUV(rawU, rawV);
            setDragStartUV({u: snapped.u, v: snapped.v});
            setIsDragging(true);
            if (sketchTool === 'TRIM') setTrimPath([new THREE.Vector3().copy(e.point)]);
        }}
        onPointerUp={(e) => { setIsDragging(false); setTrimPath([]); handlePlaneClick('FRONT', e); }}
        onDoubleClick={(e) => handlePlaneDoubleClick('FRONT', e)}
        onContextMenu={(e) => handleContextMenu('FRONT', e)}
      >
        <meshBasicMaterial 
          color={activePlane === 'FRONT' ? "#60A5FA" : hovered === 'FRONT' ? "#94A3B8" : "#475569"} 
          transparent opacity={activePlane === 'FRONT' ? 0.05 : 0.15} 
          side={THREE.DoubleSide} depthWrite={false}
        />
        <lineSegments>
          <edgesGeometry args={[new THREE.PlaneGeometry(200, 200)]} />
          <lineBasicMaterial color={activePlane === 'FRONT' ? "#60A5FA" : hovered === 'FRONT' ? "#94A3B8" : "#475569"} />
        </lineSegments>
        {(!isSketchMode || activePlane === 'FRONT') && (
          <Html position={[100, 100, 0]} center className="pointer-events-none">
            <div className={`px-2 py-1 rounded bg-slate-900/80 backdrop-blur-sm border transition-colors ${
              activePlane === 'FRONT' ? 'border-sky-500 text-sky-400 font-bold' : hovered === 'FRONT' ? 'border-slate-500 text-slate-300' : 'border-slate-700 text-slate-500'
            } text-xs font-mono select-none whitespace-nowrap`}>
              Front Plane
            </div>
          </Html>
        )}
      </Plane>
      <Plane
        name="TOP"
        args={[200, 200]}
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={isSketchMode ? activePlane === 'TOP' : true}
        onPointerOver={() => setHovered('TOP')}
        onPointerOut={() => { setHovered(null); setCursorState(null); }}
        onPointerMove={handlePointerMove}
        onPointerDown={(e) => {
            const rawU = e.point.x; const rawV = e.point.z;
            const snapped = getSnappedUV(rawU, rawV);
            setDragStartUV({u: snapped.u, v: snapped.v});
            setIsDragging(true);
            if (sketchTool === 'TRIM') setTrimPath([new THREE.Vector3().copy(e.point)]);
        }}
        onPointerUp={(e) => { setIsDragging(false); setTrimPath([]); handlePlaneClick('TOP', e); }}
        onDoubleClick={(e) => handlePlaneDoubleClick('TOP', e)}
        onContextMenu={(e) => handleContextMenu('TOP', e)}
      >
        <meshBasicMaterial 
          color={activePlane === 'TOP' ? "#60A5FA" : hovered === 'TOP' ? "#94A3B8" : "#475569"} 
          transparent opacity={activePlane === 'TOP' ? 0.05 : 0.15} 
          side={THREE.DoubleSide} depthWrite={false}
        />
        <lineSegments>
          <edgesGeometry args={[new THREE.PlaneGeometry(200, 200)]} />
          <lineBasicMaterial color={activePlane === 'TOP' ? "#60A5FA" : hovered === 'TOP' ? "#94A3B8" : "#475569"} />
        </lineSegments>
        {(!isSketchMode || activePlane === 'TOP') && (
          <Html position={[100, 100, 0]} center className="pointer-events-none">
            <div className={`px-2 py-1 rounded bg-slate-900/80 backdrop-blur-sm border transition-colors ${
              activePlane === 'TOP' ? 'border-sky-500 text-sky-400 font-bold' : hovered === 'TOP' ? 'border-slate-500 text-slate-300' : 'border-slate-700 text-slate-500'
            } text-xs font-mono select-none whitespace-nowrap`}>
              Top Plane
            </div>
          </Html>
        )}
      </Plane>
      <Plane
        name="RIGHT"
        args={[200, 200]}
        position={[0, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
        visible={isSketchMode ? activePlane === 'RIGHT' : true}
        onPointerOver={() => setHovered('RIGHT')}
        onPointerOut={() => { setHovered(null); setCursorState(null); }}
        onPointerMove={handlePointerMove}
        onPointerDown={(e) => {
            const rawU = e.point.y; const rawV = e.point.z;
            const snapped = getSnappedUV(rawU, rawV);
            setDragStartUV({u: snapped.u, v: snapped.v});
            setIsDragging(true);
            if (sketchTool === 'TRIM') setTrimPath([new THREE.Vector3().copy(e.point)]);
        }}
        onPointerUp={(e) => { setIsDragging(false); setTrimPath([]); handlePlaneClick('RIGHT', e); }}
        onDoubleClick={(e) => handlePlaneDoubleClick('RIGHT', e)}
        onContextMenu={(e) => handleContextMenu('RIGHT', e)}
      >
        <meshBasicMaterial 
          color={activePlane === 'RIGHT' ? "#60A5FA" : hovered === 'RIGHT' ? "#94A3B8" : "#475569"} 
          transparent opacity={activePlane === 'RIGHT' ? 0.05 : 0.15} 
          side={THREE.DoubleSide} depthWrite={false}
        />
        <lineSegments>
          <edgesGeometry args={[new THREE.PlaneGeometry(200, 200)]} />
          <lineBasicMaterial color={activePlane === 'RIGHT' ? "#60A5FA" : hovered === 'RIGHT' ? "#94A3B8" : "#475569"} />
        </lineSegments>
        {(!isSketchMode || activePlane === 'RIGHT') && (
          <Html position={[100, 100, 0]} center className="pointer-events-none">
            <div className={`px-2 py-1 rounded bg-slate-900/80 backdrop-blur-sm border transition-colors ${
              activePlane === 'RIGHT' ? 'border-sky-500 text-sky-400 font-bold' : hovered === 'RIGHT' ? 'border-slate-500 text-slate-300' : 'border-slate-700 text-slate-500'
            } text-xs font-mono select-none whitespace-nowrap`}>
              Right Plane
            </div>
          </Html>
        )}
        </Plane>

        {/* Dynamic Face Plane for Sketching on Faces */}
        {isSketchMode && activePlane === 'FACE' && activeBasis && (
        <Plane
          args={[2000, 2000]}
          position={activeBasis.origin}
          quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), activeBasis.normal)}
          onPointerMove={handlePointerMove}
          onPointerDown={(e) => {
              const uv = getCustomFaceUV(e.point);
              const snapped = getSnappedUV(uv.u, uv.v);
              setDragStartUV({u: snapped.u, v: snapped.v});
              setIsDragging(true);
              if (sketchTool === 'TRIM') setTrimPath([new THREE.Vector3().copy(e.point)]);
          }}
          onPointerUp={(e) => { setIsDragging(false); setTrimPath([]); handlePlaneClick('FACE', e); }}
          onDoubleClick={(e) => handlePlaneDoubleClick('FACE', e)}
        >
          <meshBasicMaterial transparent opacity={0.02} color="#60A5FA" side={THREE.DoubleSide} depthWrite={false} />
          <Grid
            args={[100, 100]}
            sectionSize={10}
            sectionColor="#60A5FA"
            sectionThickness={1}
            cellSize={2}
            cellColor="#94A3B8"
            cellThickness={0.5}
            infiniteGrid
            fadeDistance={100}
            fadeStrength={5}
          />
        </Plane>
        )}

      {/* Snap/Constraint Cursor Feedback */}
      {isSketchMode && cursorState && (
        <group position={get3DPnt(cursorState.u, cursorState.v)}>
          <mesh scale={[1.2, 1.2, 1.2]}>
            <sphereGeometry args={[0.4, 16, 16]} />
            <meshBasicMaterial color={cursorState.type === 'COINCIDENT' ? '#F59E0B' : '#3B82F6'} transparent opacity={0.8} depthTest={false} />
          </mesh>
          <Html position={[1.5, 1.5, 0]} center className="pointer-events-none">
            <div className={`flex items-center justify-center w-6 h-6 rounded-sm shadow-md border border-amber-500/50 transition-all animate-in zoom-in-50 duration-75 ${
              cursorState.type === 'COINCIDENT' ? 'bg-[#F59E0B]' : 'bg-[#3B82F6]'
            }`}>
              {cursorState.type === 'HORIZONTAL' && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4"><line x1="4" y1="12" x2="20" y2="12"/></svg>
              )}
              {cursorState.type === 'VERTICAL' && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4"><line x1="12" y1="4" x2="12" y2="20"/></svg>
              )}
              {cursorState.type === 'COINCIDENT' && (
                <div className="w-2 h-2 rounded-full bg-white shadow-sm" />
              )}
            </div>
          </Html>
        </group>
      )}

      {inferenceLines.map((line, idx) => (
        <Line
          key={idx}
          points={[get3DPnt(line.p1[0], line.p1[1]), get3DPnt(line.p2[0], line.p2[1])]}
          color="#F59E0B"
          lineWidth={1.5}
          dashed
          dashScale={2}
          dashSize={1}
          gapSize={1}
        />
      ))}

      {trimPath.length > 1 && (
        <Line 
          points={trimPath}
          color="#EF4444"
          lineWidth={2}
        />
      )}

      {activeDim && cursorState && (
        <Html position={get3DPnt(cursorState.u, cursorState.v)} center distanceFactor={10}>
          <div className="ml-10 -mt-10 glass-effect px-2 py-1 rounded-md border border-white/40 shadow-xl pointer-events-none whitespace-nowrap">
            <div className="flex flex-col gap-0.5 font-mono text-[10px] font-bold">
              <div className="flex items-center gap-1.5">
                <span className="text-blue-600">L:</span>
                <span className="text-slate-800">{activeDim.length.toFixed(2)} mm</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-emerald-600">A:</span>
                <span className="text-slate-800">{activeDim.angle.toFixed(2)}°</span>
              </div>
            </div>
          </div>
        </Html>
      )}

      {referencePlanes.map((plane) => {
        const { id, origin, normal, xDir, yDir, name } = plane;
        const originVec = new THREE.Vector3(...origin);
        const normalVec = new THREE.Vector3(...normal);
        const xDirVec = new THREE.Vector3(...xDir);
        const yDirVec = new THREE.Vector3(...yDir);
        const isSelected = activePlane === id;
        return (
          <group key={id} position={originVec} quaternion={new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xDirVec, yDirVec, normalVec))}>
            <Plane
              args={[150, 150]}
              onPointerDown={(e) => { e.stopPropagation(); handlePlaneClick(id, e); }}
              onPointerOver={() => setHovered(id)}
              onPointerOut={() => setHovered(null)}
              onPointerMove={handlePointerMove}
              visible={isSketchMode ? activePlane === id : true}
            >
              <meshStandardMaterial 
                color={isSelected ? "#60A5FA" : hovered === id ? "#94A3B8" : "#475569"} 
                transparent opacity={isSelected ? 0.2 : 0.1} 
                side={THREE.DoubleSide} depthWrite={false}
              />
              <lineSegments>
                <edgesGeometry args={[new THREE.PlaneGeometry(150, 150)]} />
                <lineBasicMaterial color={isSelected ? "#60A5FA" : hovered === id ? "#94A3B8" : "#475569"} />
              </lineSegments>
            </Plane>
            <Html position={[75, 75, 0]} center className="pointer-events-none">
              <div className={`px-2 py-1 rounded bg-slate-900/80 backdrop-blur-sm border transition-colors ${
                isSelected ? 'border-sky-500 text-sky-400 font-bold' : hovered === id ? 'border-slate-500 text-slate-300' : 'border-slate-700 text-slate-500'
              } text-[10px] font-mono select-none whitespace-nowrap`}>
                {name || id}
              </div>
            </Html>
          </group>
        );
      })}

      {referenceAxes.map((axis) => {
        const { id, origin, direction, name } = axis;
        const originVec = new THREE.Vector3(...origin);
        const dirVec = new THREE.Vector3(...direction).normalize();
        const start = originVec.clone().addScaledVector(dirVec, -200);
        const end = originVec.clone().addScaledVector(dirVec, 200);
        return (
          <group key={id}>
            <Line
              points={[start, end]}
              color="#F59E0B"
              lineWidth={1.5}
              dashed
              dashScale={2}
              dashSize={5}
              gapSize={2}
            />
            <Html position={originVec} center className="pointer-events-none">
              <div className="px-1.5 py-0.5 rounded bg-amber-500/80 text-white text-[9px] font-black border border-amber-400 shadow-sm whitespace-nowrap">
                {name || id}
              </div>
            </Html>
          </group>
        );
      })}

      {computedRefGeometry?.filter(g => g.type === 'PLANE').map((plane) => {
        const { id, data } = plane;
        const origin = new THREE.Vector3(...data.origin);
        const normal = new THREE.Vector3(...data.normal);
        const xDir = new THREE.Vector3(...data.xDir);
        const yDir = new THREE.Vector3(...data.yDir);
        const isSelected = activePlane === id;
        return (
          <group key={id} position={origin} quaternion={new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xDir, yDir, normal))}>
            <Plane
              args={[100, 100]}
              onPointerDown={(e) => {
                  e.stopPropagation();
                  setActivePlane(id);
                  useCadStore.getState().setSelectedId(id);
              }}
            >
              <meshStandardMaterial color={isSelected ? "#3B82F6" : "#94A3B8"} transparent opacity={isSelected ? 0.3 : 0.15} side={THREE.DoubleSide} />
            </Plane>
            <Html position={[0, 0, 0]}>
              <div className={`text-[9px] font-bold px-1 rounded border ${isSelected ? 'bg-primary text-white border-primary' : 'bg-white/80 text-slate-500 border-slate-300'}`}>
                {id}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
};
