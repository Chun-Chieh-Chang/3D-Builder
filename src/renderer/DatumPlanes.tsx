import React, { useState, useMemo } from 'react';
import { Plane, Text, Html, Sphere, Line } from '@react-three/drei';
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
    referenceAxes
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

  const handlePlaneClick = (plane: string, event: any) => {
    if (event.button !== 0) return;
    if (contextMenu) {
      setContextMenu(null);
      return;
    }
    if (!isSketchMode) {
      setActivePlane(plane);
      if (['FRONT', 'TOP', 'RIGHT'].includes(plane)) {
        setSketchMode(true);
      }
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

      if (sketchTool === 'LINE') {
         if (sketchNewChain || !lastClickedNodeId) {
            nextLastNodeId = nId;
         } else {
            const eId = uuidv4();
            nextEdges[eId] = { id: eId, type: 'LINE', nodeIds: [lastClickedNodeId, nId] };
            
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

      {cursorState && (
        <group position={get3DPnt(cursorState.u, cursorState.v)}>
          <mesh scale={[1.2, 1.2, 1.2]}>
            <sphereGeometry args={[0.4, 16, 16]} />
            <meshBasicMaterial color={cursorState.type === 'COINCIDENT' ? '#F59E0B' : '#3B82F6'} transparent opacity={0.8} />
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
