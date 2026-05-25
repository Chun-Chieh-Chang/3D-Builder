import React, { useState, useMemo } from 'react';
import { Plane, Text, Html, Sphere, Line } from '@react-three/drei';
import { useCadStore } from '../store/useCadStore';
import * as THREE from 'three';
import { v4 as uuidv4 } from 'uuid';
import { solveConstraints } from '../utils/geometry/ConstraintSolver';

export const DatumPlanes = () => {
  const { 
    activePlane, setActivePlane, 
    isSketchMode, setSketchMode,
    sketchNodes, setSketchNodes, sketchEdges, setSketchEdges, sketchConstraints, setSketchConstraints,
    sketchTool, setSketchTool,
    gridSnap,
    setSketchRelations, setEditingFeatureId,
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

  const featureSnapPoints = useMemo(() => {
    if (!isSketchMode || !activePlane || !meshData) return [];
    const points: [number, number][] = [];
    return points;
  }, [isSketchMode, activePlane, meshData, activeBasis]);

    const getSnappedUV = (rawU: number, rawV: number) => {
    let u = rawU;
    let v = rawV;
    let snappedId = null;
    const currentInferences: { p1: [number, number], p2: [number, number] }[] = [];

    // A. Grid Snap
    if (gridSnap) {
      u = Math.round(u / 5) * 5;
      v = Math.round(v / 5) * 5;
    }

    // B. Origin Snap
    if (Math.abs(u) < 1.5 && Math.abs(v) < 1.5) {
      setCursorState({ u: 0, v: 0, type: 'COINCIDENT' });
      setInferenceLines([]);
      return { u: 0, v: 0, id: 'origin' };
    }

    const SNAP_DIST = 2.5;

    // C. Node Snap (Coincident)
    for (const node of Object.values(sketchNodes)) {
      if (Math.hypot(node.x - rawU, node.y - rawV) < SNAP_DIST) {
        setCursorState({ u: node.x, v: node.y, type: 'COINCIDENT' });
        setInferenceLines([]);
        return { u: node.x, v: node.y, id: node.id };
      }
    }

    // D. Smart Inferences (Horizontal/Vertical alignment with ANY node)
    let bestU = u;
    let bestV = v;
    let foundH = false;
    let foundV = false;

    // First priority: Current Chain Last Node
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

    // Second priority: Origin or other nodes
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
      // Origin Inferences
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

    if (isDragging && lastClickedUV) {
      if (sketchTool === 'LINE') {
        setSketchTool('ARC');
      }
    }
  };

  const handlePlaneClick = (plane: string, event: any) => {
    // Only accept Left Click (button === 0)
    if (event.button !== 0) return;

    if (contextMenu) {
      setContextMenu(null);
      return;
    }

    if (!isSketchMode) {
      // If not in sketch mode, clicking a plane selects it as the active plane
      setActivePlane(plane);
      
      // Double click to enter sketch mode (simulated via rapid selection or we could add a timer)
      // For now, let's make it more explicit: selecting a plane enables the "Sketch" button in UI
      // But if the user clicks a standard plane, we can optionally jump into sketch mode immediately
      // to keep the existing flow, while allowing custom planes to be selected first.
      if (['FRONT', 'TOP', 'RIGHT'].includes(plane)) {
        setSketchMode(true);
      }
      return;
    }

    if (activePlane !== plane) {
      // If in sketch mode but clicked a different plane, we might want to switch planes
      // or simply ignore to prevent accidental sketch plane switching.
      // SolidWorks requires exiting sketch mode first.
      return;
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

    const snapped = getSnappedUV(rawU, rawV);
    const u = snapped.u;
    const v = snapped.v;

    // GRAPH SHADOW WRITE (Now Native)
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
            
            // Auto Constraint logic can be added here
            const solved = solveConstraints(nextNodes, nextEdges, nextConstraints);
            Object.assign(nextNodes, solved);
            
            nextLastNodeId = nId;
         }
      } else if (sketchTool === 'CIRCLE') {
         if (sketchNewChain || !lastClickedNodeId) {
            nextLastNodeId = nId;
         } else {
            const eId = uuidv4();
            nextEdges[eId] = { id: eId, type: 'CIRCLE', nodeIds: [lastClickedNodeId, nId] };
            nextLastNodeId = null; // Reset chain after circle
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
      if (sketchNewChain) {
         setFirstChainNodeId(nId);
      }
      setLastClickedNodeId(nId);
      setSketchNewChain(false);
      setLastClickedUV({ u, v });
      setHasMovedAway(false);
    }
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
        rotation={[0, 0, 0]}
        visible={isSketchMode ? activePlane === 'FRONT' : true}
        onPointerOver={() => setHovered('FRONT')}
        onPointerOut={() => { setHovered(null); setCursorState(null); }}
        onPointerMove={handlePointerMove}
        onPointerDown={(e) => {
            const rawU = e.point.x; const rawV = e.point.y;
            const snapped = getSnappedUV(rawU, rawV);
            setDragStartUV({u: snapped.u, v: snapped.v});
            setIsDragging(true);
        }}
        onPointerUp={(e) => { setIsDragging(false); handlePlaneClick('FRONT', e); }}
        onDoubleClick={(e) => handlePlaneDoubleClick('FRONT', e)}
        onContextMenu={(e) => handleContextMenu('FRONT', e)}
      >
        <meshBasicMaterial 
          color={activePlane === 'FRONT' ? "#60A5FA" : hovered === 'FRONT' ? "#94A3B8" : "#475569"} 
          transparent 
          opacity={activePlane === 'FRONT' ? 0.05 : 0.15} 
          side={THREE.DoubleSide} 
          depthWrite={false}
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
        }}
        onPointerUp={(e) => { setIsDragging(false); handlePlaneClick('TOP', e); }}
        onDoubleClick={(e) => handlePlaneDoubleClick('TOP', e)}
        onContextMenu={(e) => handleContextMenu('TOP', e)}
      >
        <meshBasicMaterial 
          color={activePlane === 'TOP' ? "#60A5FA" : hovered === 'TOP' ? "#94A3B8" : "#475569"} 
          transparent 
          opacity={activePlane === 'TOP' ? 0.05 : 0.15} 
          side={THREE.DoubleSide} 
          depthWrite={false}
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
        }}
        onPointerUp={(e) => { setIsDragging(false); handlePlaneClick('RIGHT', e); }}
        onDoubleClick={(e) => handlePlaneDoubleClick('RIGHT', e)}
        onContextMenu={(e) => handleContextMenu('RIGHT', e)}
      >
        <meshBasicMaterial 
          color={activePlane === 'RIGHT' ? "#60A5FA" : hovered === 'RIGHT' ? "#94A3B8" : "#475569"} 
          transparent 
          opacity={activePlane === 'RIGHT' ? 0.05 : 0.15} 
          side={THREE.DoubleSide} 
          depthWrite={false}
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

      {/* Render O-Snap Cursor & Guides */}
      {cursorState && (
        <group position={get3DPnt(cursorState.u, cursorState.v)}>
          <Sphere args={[0.5, 16, 16]}>
            <meshBasicMaterial color={cursorState.type === 'COINCIDENT' ? '#F59E0B' : '#3B82F6'} />
          </Sphere>
          <Html position={[1, 1, 0]} center className="pointer-events-none">
            <div className="bg-slate-900/90 text-[10px] text-sky-300 font-mono px-1 py-0.5 rounded border border-slate-700">
              {cursorState.type || `${cursorState.u.toFixed(1)}, ${cursorState.v.toFixed(1)}`}
            </div>
          </Html>
      {/* Render Permanent User-defined Reference Planes */}
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
                  e.stopPropagation();
                  handlePlaneClick(id, e);
              }}
              onPointerOver={() => setHovered(id)}
              onPointerOut={() => setHovered(null)}
              onPointerMove={handlePointerMove}
              visible={isSketchMode ? activePlane === id : true}
            >
              <meshStandardMaterial 
                color={isSelected ? "#60A5FA" : hovered === id ? "#94A3B8" : "#475569"} 
                transparent 
                opacity={isSelected ? 0.2 : 0.1} 
                side={THREE.DoubleSide}
                depthWrite={false}
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

      {/* Render Computed Custom Reference Planes (Preview) */}
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
                  useCadStore.getState().setActivePlane(id);
                  useCadStore.getState().setSelectedId(id);
              }}
            >
              <meshStandardMaterial 
                color={isSelected ? "#3B82F6" : "#94A3B8"} 
                transparent 
                opacity={isSelected ? 0.3 : 0.15} 
                side={THREE.DoubleSide}
              />
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
      )}

      {/* Reference Geometry Rendering is omitted for brevity but can be added back */}
          {/* Render Computed Custom Reference Planes */}
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
                  useCadStore.getState().setActivePlane(id);
                  useCadStore.getState().setSelectedId(id);
              }}
            >
              <meshStandardMaterial 
                color={isSelected ? "#3B82F6" : "#94A3B8"} 
                transparent 
                opacity={isSelected ? 0.3 : 0.15} 
                side={THREE.DoubleSide}
              />
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
