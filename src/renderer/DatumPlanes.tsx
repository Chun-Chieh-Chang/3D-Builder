import React, { useState, useMemo } from 'react';
import { Plane, Text, Html, Sphere, Line, Grid } from '@react-three/drei';
import { useCadStore } from '../store/useCadStore';
import * as THREE from 'three';
import { v4 as uuidv4 } from 'uuid';
import { LineToolHandler } from '../utils/sketch/ToolHandlers/LineTool';
import { TrimToolHandler } from '../utils/sketch/ToolHandlers/TrimTool';
import { SelectToolHandler } from '../utils/sketch/ToolHandlers/SelectTool';
import { ArcToolHandler } from '../utils/sketch/ToolHandlers/ArcTool';
import { SplineToolHandler } from '../utils/sketch/ToolHandlers/SplineTool';
import { CircleToolHandler } from '../utils/sketch/ToolHandlers/CircleTool';
import { RectangleToolHandler, CenterRectangleToolHandler } from '../utils/sketch/ToolHandlers/RectangleTool';
import { sketchActions } from '../store/sketchActions';
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
    lastClickedNodeId, setLastClickedNodeId,
    firstChainNodeId, setFirstChainNodeId,
    activeFaceOrigin,
    activeFaceNormal,
    activeFaceId, computedRefGeometry,
    referencePlanes,
    referenceAxes,
    referencePoints,
    pendingFeatureCommand,
    selectedId,
    measurementMode,
    setMeasurementPoints,
    setActiveTab,
    setHint,
    pushToast,
  } = useCadStore();
  
  const [hovered, setHovered] = useState<string | null>(null);
  
  const [dragStartUV, setDragStartUV] = useState<{u: number, v: number} | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lastClickedUV, setLastClickedUV] = useState<{u: number, v: number} | null>(null);
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

  const sketchCoordinateSystem = useMemo(() => {
    if (!activePlane) return null;
    const origin = new THREE.Vector3(0, 0, 0);
    const xDir = new THREE.Vector3(1, 0, 0);
    const yDir = new THREE.Vector3(0, 1, 0);

    if (activePlane === 'FRONT') {
      origin.set(0, 0, 0);
      xDir.set(1, 0, 0);
      yDir.set(0, 1, 0);
    } else if (activePlane === 'TOP') {
      origin.set(0, 0, 0);
      xDir.set(1, 0, 0);
      yDir.set(0, 0, 1);
    } else if (activePlane === 'RIGHT') {
      origin.set(0, 0, 0);
      xDir.set(0, 1, 0);
      yDir.set(0, 0, 1);
    } else {
      const basis = activeBasis;
      if (basis) {
        origin.copy(basis.origin);
        xDir.copy(basis.xDir);
        yDir.copy(basis.yDir);
      }
    }
    return { origin, xDir, yDir };
  }, [activePlane, activeBasis]);

  const originRings = useMemo(() => {
    const R = 0.8;
    const segments = 32;
    const xy: [number, number, number][] = [];
    const xz: [number, number, number][] = [];
    const yz: [number, number, number][] = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const cos = Math.cos(theta) * R;
      const sin = Math.sin(theta) * R;
      xy.push([cos, sin, 0]);
      xz.push([cos, 0, sin]);
      yz.push([0, cos, sin]);
    }
    return { xy, xz, yz };
  }, []);

  const activeSketchOriginRing = useMemo(() => {
    if (!sketchCoordinateSystem) return [];
    const R = 0.8;
    const segments = 32;
    const pts: THREE.Vector3[] = [];
    const { origin, xDir, yDir } = sketchCoordinateSystem;
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const p = origin.clone()
        .addScaledVector(xDir, R * Math.cos(theta))
        .addScaledVector(yDir, R * Math.sin(theta));
      pts.push(p);
    }
    return pts;
  }, [sketchCoordinateSystem]);


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

  const pointToSegmentDistance = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  };

  const getSnappedUV = (rawU: number, rawV: number) => {
    let u = rawU;
    let v = rawV;
    const snappedId = null;
    const currentInferences: { p1: [number, number], p2: [number, number] }[] = [];

    if (gridSnap) {
      u = Math.round(u / 5) * 5;
      v = Math.round(v / 5) * 5;
    }

    if (Math.abs(u) < 2.0 && Math.abs(v) < 2.0) {
      setCursorState({ u: 0, v: 0, type: 'ORIGIN' });
      setInferenceLines([]);
      return { u: 0, v: 0, id: 'origin' };
    }

    const SNAP_DIST = 3.5; // Increased for easier snapping

    // 1. Check for Node Snapping (Priority: First Node of Chain for Loop Closure)
    if (firstChainNodeId && sketchNodes[firstChainNodeId]) {
      const node = sketchNodes[firstChainNodeId];
      if (Math.hypot(node.x - rawU, node.y - rawV) < SNAP_DIST) {
        setCursorState({ u: node.x, v: node.y, type: 'COINCIDENT' });
        setInferenceLines([]);
        return { u: node.x, v: node.y, id: node.id };
      }
    }

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

    // BUG FIX: Read last click position from the store (lastClickedNodeId) instead of
    // local lastClickedUV, because ToolHandlers update lastClickedNodeId in the store
    // but never update the local lastClickedUV state.
    const storeLastNodeId = useCadStore.getState().lastClickedNodeId;
    const storeLastNode = storeLastNodeId ? useCadStore.getState().sketchNodes[storeLastNodeId] : null;
    const lastClickRef = storeLastNode ? { u: storeLastNode.x, v: storeLastNode.y } : lastClickedUV;

    if (lastClickRef) {
       if (Math.abs(rawU - lastClickRef.u) < SNAP_DIST) {
         bestU = lastClickRef.u; foundV = true;
         currentInferences.push({ p1: [lastClickRef.u, lastClickRef.v], p2: [lastClickRef.u, rawV] });
       }
       if (Math.abs(rawV - lastClickRef.v) < SNAP_DIST) {
         bestV = lastClickRef.v; foundH = true;
         currentInferences.push({ p1: [lastClickRef.u, lastClickRef.v], p2: [rawU, lastClickRef.v] });
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

    // BUG FIX: Never set cursorState to null. The preview lines rendering at line 919+
    // is gated by {cursorState && ...}. Setting null kills ALL preview lines (ghost line,
    // circle preview, rectangle preview). Instead, always provide the current position
    // with type: null to indicate "no snap, but cursor is here".
    setCursorState({ u, v, type: null });
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

    // Use store-synced reference for active dimension readout
    const moveLastNodeId = useCadStore.getState().lastClickedNodeId;
    const moveLastNode = moveLastNodeId ? useCadStore.getState().sketchNodes[moveLastNodeId] : null;
    const moveLastRef = moveLastNode ? { u: moveLastNode.x, v: moveLastNode.y } : lastClickedUV;
    
    if (moveLastRef && Math.hypot(u - moveLastRef.u, v - moveLastRef.v) > 2) {
      setHasMovedAway(true);
    }

    if (moveLastRef && (sketchTool === 'LINE' || sketchTool === 'CENTER_LINE' || sketchTool === 'RECTANGLE' || sketchTool === 'CENTER_RECTANGLE')) {
      const du = u - moveLastRef.u;
      const dv = v - moveLastRef.v;
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
                  // Use centralized sketch action to guarantee cascading deletes
                  sketchActions.deleteEdges([edge.id]);
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
    
    // Check if clicking the ALREADY active plane
    if (isSketchMode && activePlane === plane) {
      // Proceed to entity construction logic below
    } else if (!isSketchMode) {
      if (measurementMode !== 'NONE') {
         // ... (measurement logic remains same)
         return;
      }
      
      // Standard selection logic
      if (activePlane === plane) {
        // Double-selection (or click when already selected) triggers sketch mode
        setSketchMode(true);
        setActiveTab('SKETCH');
        setSketchTool('LINE'); // Default to LINE tool when entering via plane click
        setHint('Sketching Mode: Click to place line start point.');
      } else {
        setActivePlane(plane);
        // Visual pulse feedback (placeholder for GSAP or similar)
        console.log(`[UI] Plane selected: ${plane}`);
      }
      return;
    }
    
    // If in sketch mode but clicked a DIFFERENT plane, do nothing or prompt
    if (activePlane !== plane) {
      console.log(`[UI] Ignored click on inactive plane: ${plane} (Active: ${activePlane})`);
      setHint(`Please sketch on the active plane: ${activePlane}`);
      return;
    }

    // Force tab sync if we are in sketch mode but the UI is showing something else
    const currentTab = useCadStore.getState().activeTab;
    if (currentTab !== 'SKETCH') {
      setActiveTab('SKETCH');
    }

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

    let u = rawU, v = rawV, snappedId = null;
    let activeSnapType = undefined;
    const SNAP_DIST = 3.5;
    
    if (!event.shiftKey) {
      const snapped = getSnappedUV(rawU, rawV);
      u = snapped.u;
      v = snapped.v;
      snappedId = snapped.id;
      activeSnapType = cursorState?.type;
    }

    // --- NEW ARCHITECTURE ROUTING ---
    const ctx = {
      rawU, rawV,
      snappedU: u, snappedV: v,
      snappedNodeId: snappedId,
      shiftKey: event.shiftKey || false,
      activeSnapType: activeSnapType || undefined
    };

    // Helper: After any ToolHandler call, sync lastClickedUV from the store
    // so the local state (used by preview dimensions, inference lines, etc.) stays in sync.
    const syncLastClickedUV = () => {
      const nodeId = useCadStore.getState().lastClickedNodeId;
      const node = nodeId ? useCadStore.getState().sketchNodes[nodeId] : null;
      if (node) {
        setLastClickedUV({ u: node.x, v: node.y });
        setHasMovedAway(false);
      } else {
        setLastClickedUV(null);
      }
    };

    if (sketchTool === 'LINE' || sketchTool === 'CENTER_LINE') {
      new LineToolHandler(sketchTool === 'CENTER_LINE').onPointerDown(ctx);
      syncLastClickedUV();
      return;
    }
    if (sketchTool === 'TRIM') {
      const trimTool = new TrimToolHandler();
      trimTool.onPointerDown(ctx); // Simulate drag start
      trimTool.onPointerUp(ctx);   // Trigger click-to-trim
      return;
    }
    if (sketchTool === 'SELECT') {
      new SelectToolHandler().onPointerDown(ctx);
      return;
    }
    if (sketchTool === 'ARC') {
      new ArcToolHandler().onPointerDown(ctx);
      syncLastClickedUV();
      return;
    }
    if (sketchTool === 'SPLINE') {
      new SplineToolHandler().onPointerDown(ctx);
      syncLastClickedUV();
      return;
    }
    if (sketchTool === 'CIRCLE') {
      new CircleToolHandler().onPointerDown(ctx);
      syncLastClickedUV();
      return;
    }
    if (sketchTool === 'RECTANGLE') {
      new RectangleToolHandler().onPointerDown(ctx);
      syncLastClickedUV();
      return;
    }
    if (sketchTool === 'CENTER_RECTANGLE') {
      new CenterRectangleToolHandler().onPointerDown(ctx);
      syncLastClickedUV();
      return;
    }
    useCadStore.setState((state) => {
      const nextNodes = { ...state.sketchNodes };
      const nextEdges = { ...state.sketchEdges };
      const nextConstraints = { ...state.sketchConstraints };

      if (sketchTool === 'SMART_DIMENSION') {
         // Smart Dimension Logic: Create a distance constraint between selected nodes or on an edge
         const eId = Object.values(nextEdges).find(e => {
            const n1 = nextNodes[e.nodeIds[0]];
            const n2 = nextNodes[e.nodeIds[1]];
            if (!n1 || !n2) return false;
            
            if (e.type === 'CIRCLE') {
               const radius = Math.hypot(n2.x - n1.x, n2.y - n1.y);
               const distToCenter = Math.hypot(u - n1.x, v - n1.y);
               return Math.abs(distToCenter - radius) < SNAP_DIST;
            } else {
               return pointToSegmentDistance(u, v, n1.x, n1.y, n2.x, n2.y) < SNAP_DIST;
            }
         })?.id;

         if (eId) {
            const cId = uuidv4();
            nextConstraints[cId] = { id: cId, type: 'DISTANCE', edgeIds: [eId], value: 50 }; // Default 50
         }
      } else if (sketchTool === 'OFFSET') {
         // Offset Entities: Offset selected entities by a fixed distance
         const selectedIds = useCadStore.getState().selectedEntityIds;
         if (selectedIds.length > 0) {
            const offsetDist = 10;
            selectedIds.forEach(id => {
               const edge = nextEdges[id];
               if (edge && edge.type === 'LINE') {
                  const n1 = nextNodes[edge.nodeIds[0]];
                  const n2 = nextNodes[edge.nodeIds[1]];
                  if (n1 && n2) {
                     const dx = n2.x - n1.x;
                     const dy = n2.y - n1.y;
                     const len = Math.hypot(dx, dy);
                     const nx = -dy / len * offsetDist;
                     const ny = dx / len * offsetDist;
                     
                     const id1 = uuidv4(); const id2 = uuidv4();
                     nextNodes[id1] = { id: id1, x: n1.x + nx, y: n1.y + ny };
                     nextNodes[id2] = { id: id2, x: n2.x + nx, y: n2.y + ny };
                     const eId = uuidv4();
                     nextEdges[eId] = { id: eId, type: 'LINE', nodeIds: [id1, id2] };
                  }
               }
            });
            setHint('Selected entities offset.');
         } else {
            pushToast('Please select entities to offset.', 'info');
         }
      } else if (sketchTool === 'MIRROR') {
         // Basic Mirror: Mirror selected entities across the first construction line found
         const axis = Object.values(nextEdges).find(e => e.isConstruction && e.type === 'LINE');
         if (axis) {
            const nodes = nextNodes[axis.nodeIds[0]];
            const nodes2 = nextNodes[axis.nodeIds[1]];
            // (Implementation of mirroring would be complex, adding a placeholder hint for now)
            console.log('[UI] Mirroring selected entities across axis:', axis.id);
         }
      } else if (sketchTool === 'CONVERT') {
         // Convert Entities: Project selected 3D topology to the active sketch plane
         const topo = useCadStore.getState().selectedTopology;
         if (topo && (topo.type === 'EDGE' || topo.type === 'VERTEX')) {
            if (topo.type === 'EDGE' && topo.edgeData) {
               // Project start and end points of the edge
               const p1 = new THREE.Vector3(...topo.edgeData.start);
               const p2 = new THREE.Vector3(...topo.edgeData.end);
               const uv1 = plane === 'FRONT' ? {u: p1.x, v: p1.y} : plane === 'TOP' ? {u: p1.x, v: p1.z} : plane === 'RIGHT' ? {u: p1.y, v: p1.z} : getCustomFaceUV(p1);
               const uv2 = plane === 'FRONT' ? {u: p2.x, v: p2.y} : plane === 'TOP' ? {u: p2.x, v: p2.z} : plane === 'RIGHT' ? {u: p2.y, v: p2.z} : getCustomFaceUV(p2);
               
               const id1 = uuidv4(); const id2 = uuidv4();
               nextNodes[id1] = { id: id1, x: uv1.u, y: uv1.v };
               nextNodes[id2] = { id: id2, x: uv2.u, y: uv2.v };
               const eId = uuidv4();
               nextEdges[eId] = { id: eId, type: 'LINE', nodeIds: [id1, id2] };
               setHint('Edge converted to sketch entity.');
            } else if (topo.type === 'VERTEX' && topo.coordinates) {
               const p = new THREE.Vector3(...topo.coordinates);
               const uv = plane === 'FRONT' ? {u: p.x, v: p.y} : plane === 'TOP' ? {u: p.x, v: p.z} : plane === 'RIGHT' ? {u: p.y, v: p.z} : getCustomFaceUV(p);
               const id = uuidv4();
               nextNodes[id] = { id: id, x: uv.u, y: uv.v };
               setHint('Vertex converted to sketch point.');
            }
         } else {
            pushToast('Please select a 3D edge or vertex to convert.', 'info');
         }
      }
      return { sketchNodes: nextNodes, sketchEdges: nextEdges, sketchConstraints: nextConstraints };
    });

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
            if (isSketchMode && activePlane !== 'FRONT') return;
            e.stopPropagation();
            const rawU = e.point.x; const rawV = e.point.y;
            const snapped = getSnappedUV(rawU, rawV);
            setDragStartUV({u: snapped.u, v: snapped.v});
            setIsDragging(true);
            if (sketchTool === 'TRIM') setTrimPath([new THREE.Vector3().copy(e.point)]);
        }}
        onPointerUp={(e) => { 
            if (isSketchMode && activePlane !== 'FRONT') return;
            e.stopPropagation();
            setIsDragging(false); 
            setTrimPath([]); 
            
            // If we are trimming, we process it on drag anyway, so we just end it.
            // If not trimming, only treat as a click if the mouse didn't move significantly during the down-up cycle.
            if (sketchTool !== 'TRIM') {
               const rawU = e.point.x; const rawV = e.point.y;
               const snapped = getSnappedUV(rawU, rawV);
               const dx = dragStartUV ? snapped.u - dragStartUV.u : 0;
               const dy = dragStartUV ? snapped.v - dragStartUV.v : 0;
               if (dragStartUV && Math.hypot(dx, dy) > 2.0) {
                 return; // Was a drag, don't create a point
               }
            }
            handlePlaneClick('FRONT', e); 
        }}
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
            if (isSketchMode && activePlane !== 'TOP') return;
            e.stopPropagation();
            const rawU = e.point.x; const rawV = e.point.z;
            const snapped = getSnappedUV(rawU, rawV);
            setDragStartUV({u: snapped.u, v: snapped.v});
            setIsDragging(true);
            if (sketchTool === 'TRIM') setTrimPath([new THREE.Vector3().copy(e.point)]);
        }}
        onPointerUp={(e) => { 
            if (isSketchMode && activePlane !== 'TOP') return;
            e.stopPropagation();
            setIsDragging(false); 
            setTrimPath([]); 
            
            if (sketchTool !== 'TRIM') {
               const rawU = e.point.x; const rawV = e.point.z;
               const snapped = getSnappedUV(rawU, rawV);
               const dx = dragStartUV ? snapped.u - dragStartUV.u : 0;
               const dy = dragStartUV ? snapped.v - dragStartUV.v : 0;
               if (dragStartUV && Math.hypot(dx, dy) > 2.0) {
                 return; 
               }
            }
            handlePlaneClick('TOP', e); 
        }}
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
            if (isSketchMode && activePlane !== 'RIGHT') return;
            e.stopPropagation();
            const rawU = e.point.y; const rawV = e.point.z;
            const snapped = getSnappedUV(rawU, rawV);
            setDragStartUV({u: snapped.u, v: snapped.v});
            setIsDragging(true);
            if (sketchTool === 'TRIM') setTrimPath([new THREE.Vector3().copy(e.point)]);
        }}
        onPointerUp={(e) => { 
            if (isSketchMode && activePlane !== 'RIGHT') return;
            e.stopPropagation();
            setIsDragging(false); 
            setTrimPath([]); 
            
            if (sketchTool !== 'TRIM') {
               const rawU = e.point.y; const rawV = e.point.z;
               const snapped = getSnappedUV(rawU, rawV);
               const dx = dragStartUV ? snapped.u - dragStartUV.u : 0;
               const dy = dragStartUV ? snapped.v - dragStartUV.v : 0;
               if (dragStartUV && Math.hypot(dx, dy) > 2.0) {
                 return; 
               }
            }
            handlePlaneClick('RIGHT', e); 
        }}
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
              e.stopPropagation();
              const uv = getCustomFaceUV(e.point);
              const snapped = getSnappedUV(uv.u, uv.v);
              setDragStartUV({u: snapped.u, v: snapped.v});
              setIsDragging(true);
              if (sketchTool === 'TRIM') setTrimPath([new THREE.Vector3().copy(e.point)]);
          }}
          onPointerUp={(e) => { 
              e.stopPropagation();
              setIsDragging(false); 
              setTrimPath([]); 
              
              if (sketchTool !== 'TRIM') {
                 const uv = getCustomFaceUV(e.point);
                 const snapped = getSnappedUV(uv.u, uv.v);
                 const dx = dragStartUV ? snapped.u - dragStartUV.u : 0;
                 const dy = dragStartUV ? snapped.v - dragStartUV.v : 0;
                 if (dragStartUV && Math.hypot(dx, dy) > 2.0) {
                   return; 
                 }
              }
              handlePlaneClick('FACE', e); 
          }}
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

      {/* Snap/Constraint Cursor Feedback - only show when an actual snap is active */}
      {isSketchMode && cursorState && cursorState.type && (
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

      {/* Professional Tool Cursor (SolidWorks Style) */}
      {isSketchMode && cursorState && (
        <Html position={get3DPnt(cursorState.u, cursorState.v)} center distanceFactor={10} className="pointer-events-none">
          <div className="flex flex-col items-center -ml-8 -mt-8 animate-in fade-in duration-200">
            {/* Tool Icon Badge */}
            <div className="bg-white/90 p-1.5 rounded-full shadow-lg border border-slate-200 mb-2">
              <div className="text-[14px] text-slate-800 font-bold">
                {sketchTool === 'LINE' && '╱'}
                {sketchTool === 'CIRCLE' && '○'}
                {sketchTool === 'RECTANGLE' && '▭'}
                {sketchTool === 'ARC' && '⌒'}
                {sketchTool === 'SMART_DIMENSION' && '📏'}
                {sketchTool === 'TRIM' && '✂️'}
              </div>
            </div>
          </div>
        </Html>
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

      {/* Drafting Ghost Preview (SolidWorks Style) */}
      {isSketchMode && cursorState && (
        <group>
          {(sketchTool === 'LINE' || sketchTool === 'CENTER_LINE') && (() => {
            const lastNodeId = useCadStore.getState().lastClickedNodeId;
            const lastNode = useCadStore.getState().sketchNodes[lastNodeId || ''];
            if (!lastNode) return null;
            return (
              <Line
                points={[get3DPnt(lastNode.x, lastNode.y), get3DPnt(cursorState.u, cursorState.v)]}
                color="#F59E0B"
                lineWidth={1.2}
                dashed={sketchTool === 'CENTER_LINE'}
                dashSize={1}
                gapSize={0.5}
                transparent
                opacity={0.6}
              />
            );
          })()}
          {sketchTool === 'CIRCLE' && (() => {
            const lastNodeId = useCadStore.getState().lastClickedNodeId;
            const centerNode = useCadStore.getState().sketchNodes[lastNodeId || ''];
            if (!centerNode) return null;
            const center = { u: centerNode.x, v: centerNode.y };
            const R = Math.hypot(cursorState.u - center.u, cursorState.v - center.v);
            const pts: [number, number, number][] = [];
            for (let k = 0; k <= 36; k++) {
              const theta = (k / 36) * Math.PI * 2;
              const p = get3DPnt(center.u + R * Math.cos(theta), center.v + R * Math.sin(theta));
              pts.push([p.x, p.y, p.z]);
            }
            return (
              <>
                <Line points={pts} color="#F59E0B" lineWidth={1.2} transparent opacity={0.6} />
                <Line points={[get3DPnt(center.u, center.v), get3DPnt(cursorState.u, cursorState.v)]} color="#94A3B8" lineWidth={0.5} dashed dashSize={0.5} gapSize={0.5} />
              </>
            );
          })()}
          {sketchTool === 'RECTANGLE' && (() => {
            const lastNodeId = useCadStore.getState().lastClickedNodeId;
            const p1Node = useCadStore.getState().sketchNodes[lastNodeId || ''];
            if (!p1Node) return null;
            const p1 = { u: p1Node.x, v: p1Node.y };
            const p3 = cursorState;
            const pts = [
              get3DPnt(p1.u, p1.v),
              get3DPnt(p3.u, p1.v),
              get3DPnt(p3.u, p3.v),
              get3DPnt(p1.u, p3.v),
              get3DPnt(p1.u, p1.v)
            ];
            return <Line points={pts} color="#F59E0B" lineWidth={1.2} transparent opacity={0.6} />;
          })()}
          {sketchTool === 'CENTER_RECTANGLE' && (() => {
            const lastNodeId = useCadStore.getState().lastClickedNodeId;
            const centerNode = useCadStore.getState().sketchNodes[lastNodeId || ''];
            if (!centerNode) return null;
            const cx = centerNode.x;
            const cy = centerNode.y;
            const dx = cursorState.u - cx;
            const dy = cursorState.v - cy;
            const pts = [
              get3DPnt(cx + dx, cy + dy),
              get3DPnt(cx - dx, cy + dy),
              get3DPnt(cx - dx, cy - dy),
              get3DPnt(cx + dx, cy - dy),
              get3DPnt(cx + dx, cy + dy)
            ];
            const diagonals = [
              get3DPnt(cx - dx, cy - dy),
              get3DPnt(cx + dx, cy + dy),
              get3DPnt(cx + dx, cy - dy),
              get3DPnt(cx - dx, cy + dy)
            ];
            return (
              <group>
                <Line points={pts} color="#F59E0B" lineWidth={1.2} transparent opacity={0.6} />
                <Line points={diagonals} color="#94A3B8" lineWidth={0.5} dashed dashSize={0.5} gapSize={0.5} />
              </group>
            );
          })()}
        </group>
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
              onPointerDown={(e) => { 
                if (isSketchMode && activePlane !== id) return;
                e.stopPropagation(); 
                handlePlaneClick(id, e); 
              }}
              onPointerUp={(e) => {
                if (isSketchMode && activePlane !== id) return;
                e.stopPropagation();
              }}
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

      {referencePoints?.map((pt) => {
        const { id, origin, name } = pt;
        const originVec = new THREE.Vector3(...origin);
        return (
          <group key={id} position={originVec}>
            <Sphere args={[1.5, 16, 16]}>
              <meshBasicMaterial color="#10B981" depthTest={false} transparent opacity={0.8} />
            </Sphere>
            <Html position={[2, 2, 0]} center className="pointer-events-none">
              <div className="px-1 py-0.5 rounded bg-slate-900/80 backdrop-blur-sm border border-emerald-700 text-emerald-400 text-[9px] font-mono select-none">
                {name || id}
              </div>
            </Html>
          </group>
        );
      })}

      {/* Plane Intersection Lines */}
      {!isSketchMode ? (
        <>
          {/* X axis intersection (Front and Top planes) */}
          <Line
            points={[new THREE.Vector3(-100, 0, 0), new THREE.Vector3(100, 0, 0)]}
            color="#94A3B8"
            lineWidth={1.5}
            dashed
            dashScale={2}
            dashSize={2}
            gapSize={2}
            transparent
            opacity={0.5}
          />
          {/* Y axis intersection (Front and Right planes) */}
          <Line
            points={[new THREE.Vector3(0, -100, 0), new THREE.Vector3(0, 100, 0)]}
            color="#94A3B8"
            lineWidth={1.5}
            dashed
            dashScale={2}
            dashSize={2}
            gapSize={2}
            transparent
            opacity={0.5}
          />
          {/* Z axis intersection (Top and Right planes) */}
          <Line
            points={[new THREE.Vector3(0, 0, -100), new THREE.Vector3(0, 0, 100)]}
            color="#94A3B8"
            lineWidth={1.5}
            dashed
            dashScale={2}
            dashSize={2}
            gapSize={2}
            transparent
            opacity={0.5}
          />
        </>
      ) : (
        sketchCoordinateSystem && (
          <>
            {/* Sketch local horizontal axis line */}
            <Line
              points={[
                sketchCoordinateSystem.origin.clone().addScaledVector(sketchCoordinateSystem.xDir, -100),
                sketchCoordinateSystem.origin.clone().addScaledVector(sketchCoordinateSystem.xDir, 100)
              ]}
              color="#94A3B8"
              lineWidth={1.5}
              dashed
              dashScale={2}
              dashSize={2}
              gapSize={2}
              transparent
              opacity={0.5}
            />
            {/* Sketch local vertical axis line */}
            <Line
              points={[
                sketchCoordinateSystem.origin.clone().addScaledVector(sketchCoordinateSystem.yDir, -100),
                sketchCoordinateSystem.origin.clone().addScaledVector(sketchCoordinateSystem.yDir, 100)
              ]}
              color="#94A3B8"
              lineWidth={1.5}
              dashed
              dashScale={2}
              dashSize={2}
              gapSize={2}
              transparent
              opacity={0.5}
            />
          </>
        )
      )}

      {/* SolidWorks-style Geometric Origin */}
      {!isSketchMode ? (
        <group>
          {/* Central violet-blue sphere */}
          <mesh position={[0, 0, 0]}>
            <sphereGeometry args={[0.5, 16, 16]} />
            <meshBasicMaterial color="#8B5CF6" depthTest={false} transparent opacity={0.9} />
          </mesh>
          
          {/* Orthogonal rings */}
          <Line points={originRings.xy} color="#8B5CF6" lineWidth={1.2} depthTest={false} transparent opacity={0.6} />
          <Line points={originRings.xz} color="#8B5CF6" lineWidth={1.2} depthTest={false} transparent opacity={0.6} />
          <Line points={originRings.yz} color="#8B5CF6" lineWidth={1.2} depthTest={false} transparent opacity={0.6} />

          {/* X Axis Arrow */}
          <Line points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(8, 0, 0)]} color="#8B5CF6" lineWidth={1.8} depthTest={false} />
          <Line points={[new THREE.Vector3(8, 0, 0), new THREE.Vector3(6.8, 0.4, 0)]} color="#8B5CF6" lineWidth={1.5} depthTest={false} />
          <Line points={[new THREE.Vector3(8, 0, 0), new THREE.Vector3(6.8, -0.4, 0)]} color="#8B5CF6" lineWidth={1.5} depthTest={false} />
          <Line points={[new THREE.Vector3(8, 0, 0), new THREE.Vector3(6.8, 0, 0.4)]} color="#8B5CF6" lineWidth={1.5} depthTest={false} />
          <Line points={[new THREE.Vector3(8, 0, 0), new THREE.Vector3(6.8, 0, -0.4)]} color="#8B5CF6" lineWidth={1.5} depthTest={false} />
          <Html position={[9.5, 0, 0]} center className="pointer-events-none">
            <div className="text-[#8B5CF6] font-mono text-[10px] font-black select-none transition-opacity duration-200">X</div>
          </Html>

          {/* Y Axis Arrow */}
          <Line points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 8, 0)]} color="#8B5CF6" lineWidth={1.8} depthTest={false} />
          <Line points={[new THREE.Vector3(0, 8, 0), new THREE.Vector3(0.4, 6.8, 0)]} color="#8B5CF6" lineWidth={1.5} depthTest={false} />
          <Line points={[new THREE.Vector3(0, 8, 0), new THREE.Vector3(-0.4, 6.8, 0)]} color="#8B5CF6" lineWidth={1.5} depthTest={false} />
          <Line points={[new THREE.Vector3(0, 8, 0), new THREE.Vector3(0, 6.8, 0.4)]} color="#8B5CF6" lineWidth={1.5} depthTest={false} />
          <Line points={[new THREE.Vector3(0, 8, 0), new THREE.Vector3(0, 6.8, -0.4)]} color="#8B5CF6" lineWidth={1.5} depthTest={false} />
          <Html position={[0, 9.5, 0]} center className="pointer-events-none">
            <div className="text-[#8B5CF6] font-mono text-[10px] font-black select-none transition-opacity duration-200">Y</div>
          </Html>

          {/* Z Axis Arrow */}
          <Line points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 8)]} color="#8B5CF6" lineWidth={1.8} depthTest={false} />
          <Line points={[new THREE.Vector3(0, 0, 8), new THREE.Vector3(0.4, 0, 6.8)]} color="#8B5CF6" lineWidth={1.5} depthTest={false} />
          <Line points={[new THREE.Vector3(0, 0, 8), new THREE.Vector3(-0.4, 0, 6.8)]} color="#8B5CF6" lineWidth={1.5} depthTest={false} />
          <Line points={[new THREE.Vector3(0, 0, 8), new THREE.Vector3(0, 0.4, 6.8)]} color="#8B5CF6" lineWidth={1.5} depthTest={false} />
          <Line points={[new THREE.Vector3(0, 0, 8), new THREE.Vector3(0, -0.4, 6.8)]} color="#8B5CF6" lineWidth={1.5} depthTest={false} />
          <Html position={[0, 0, 9.5]} center className="pointer-events-none">
            <div className="text-[#8B5CF6] font-mono text-[10px] font-black select-none transition-opacity duration-200">Z</div>
          </Html>
        </group>
      ) : (
        sketchCoordinateSystem && (
          <group>
            {/* Sketch orange-red center sphere */}
            <mesh position={sketchCoordinateSystem.origin}>
              <sphereGeometry args={[0.5, 16, 16]} />
              <meshBasicMaterial color="#EF4444" depthTest={false} transparent opacity={0.9} />
            </mesh>
            
            {/* Sketch plane origin ring */}
            <Line points={activeSketchOriginRing} color="#EF4444" lineWidth={1.5} depthTest={false} transparent opacity={0.6} />

            {/* Horizontal Axis Arrow */}
            <Line
              points={[
                sketchCoordinateSystem.origin,
                sketchCoordinateSystem.origin.clone().addScaledVector(sketchCoordinateSystem.xDir, 8)
              ]}
              color="#EF4444"
              lineWidth={1.8}
              depthTest={false}
            />
            <Line
              points={[
                sketchCoordinateSystem.origin.clone().addScaledVector(sketchCoordinateSystem.xDir, 8),
                sketchCoordinateSystem.origin.clone().addScaledVector(sketchCoordinateSystem.xDir, 6.8).addScaledVector(sketchCoordinateSystem.yDir, 0.4)
              ]}
              color="#EF4444"
              lineWidth={1.5}
              depthTest={false}
            />
            <Line
              points={[
                sketchCoordinateSystem.origin.clone().addScaledVector(sketchCoordinateSystem.xDir, 8),
                sketchCoordinateSystem.origin.clone().addScaledVector(sketchCoordinateSystem.xDir, 6.8).addScaledVector(sketchCoordinateSystem.yDir, -0.4)
              ]}
              color="#EF4444"
              lineWidth={1.5}
              depthTest={false}
            />
            <Html
              position={sketchCoordinateSystem.origin.clone().addScaledVector(sketchCoordinateSystem.xDir, 9.5)}
              center
              className="pointer-events-none"
            >
              <div className="text-[#EF4444] font-mono text-[10px] font-black select-none transition-opacity duration-200">X</div>
            </Html>

            {/* Vertical Axis Arrow */}
            <Line
              points={[
                sketchCoordinateSystem.origin,
                sketchCoordinateSystem.origin.clone().addScaledVector(sketchCoordinateSystem.yDir, 8)
              ]}
              color="#EF4444"
              lineWidth={1.8}
              depthTest={false}
            />
            <Line
              points={[
                sketchCoordinateSystem.origin.clone().addScaledVector(sketchCoordinateSystem.yDir, 8),
                sketchCoordinateSystem.origin.clone().addScaledVector(sketchCoordinateSystem.yDir, 6.8).addScaledVector(sketchCoordinateSystem.xDir, 0.4)
              ]}
              color="#EF4444"
              lineWidth={1.5}
              depthTest={false}
            />
            <Line
              points={[
                sketchCoordinateSystem.origin.clone().addScaledVector(sketchCoordinateSystem.yDir, 8),
                sketchCoordinateSystem.origin.clone().addScaledVector(sketchCoordinateSystem.yDir, 6.8).addScaledVector(sketchCoordinateSystem.xDir, -0.4)
              ]}
              color="#EF4444"
              lineWidth={1.5}
              depthTest={false}
            />
            <Html
              position={sketchCoordinateSystem.origin.clone().addScaledVector(sketchCoordinateSystem.yDir, 9.5)}
              center
              className="pointer-events-none"
            >
              <div className="text-[#EF4444] font-mono text-[10px] font-black select-none transition-opacity duration-200">Y</div>
            </Html>
          </group>
        )
      )}

    </group>
  );
};

