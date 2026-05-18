import React, { useState, useMemo } from 'react';
import { Plane, Text, Html, Sphere } from '@react-three/drei';
import { useCadStore } from '../store/useCadStore';
import * as THREE from 'three';

export const DatumPlanes = () => {
  const { 
    activePlane, setActivePlane, 
    isSketchMode, setSketchMode,
    sketchPoints, setSketchPoints,
    sketchTool, gridSnap,
    setSketchRelations, setEditingFeatureId,
    contextMenu, setContextMenu,
    meshData
  } = useCadStore();
  const [hovered, setHovered] = useState<string | null>(null);

  // --- O-SNAP (Object Snapping) Engine ---
  const [cursorState, setCursorState] = useState<{u: number, v: number, type: string | null} | null>(null);

  const featureSnapPoints = useMemo(() => {
    if (!isSketchMode || !activePlane || !meshData) return [];
    
    const points: [number, number][] = [];
    const threshold = 1e-4; // Dedup threshold
    
    for (const mesh of meshData) {
      if (!mesh.data || !mesh.data.vertices) continue;
      const verts = mesh.data.vertices;
      for (let i = 0; i < verts.length; i += 3) {
        const x = verts[i];
        const y = verts[i + 1];
        const z = verts[i + 2];
        
        let u = 0, v = 0;
        if (activePlane === 'FRONT') { u = x; v = y; }
        else if (activePlane === 'TOP') { u = x; v = z; }
        else if (activePlane === 'RIGHT') { u = y; v = z; }
        
        // Deduplicate
        const exists = points.some(p => Math.abs(p[0] - u) < threshold && Math.abs(p[1] - v) < threshold);
        if (!exists) points.push([u, v]);
      }
    }
    return points;
  }, [isSketchMode, activePlane, meshData]);

  const getSnappedUV = (rawU: number, rawV: number) => {
    const SNAP_RADIUS = 2.5;
    
    // 1. Origin Priority
    if (Math.hypot(rawU, rawV) < SNAP_RADIUS) {
      return { u: 0, v: 0, type: 'ORIGIN' };
    }
    
    // 2. Existing Sketch Points
    for (const pt of sketchPoints) {
      if (Math.hypot(rawU - pt[0], rawV - pt[1]) < SNAP_RADIUS) {
        return { u: pt[0], v: pt[1], type: 'SKETCH_POINT' };
      }
    }
    
    // 3. 3D Feature Vertices
    for (const pt of featureSnapPoints) {
      if (Math.hypot(rawU - pt[0], rawV - pt[1]) < SNAP_RADIUS) {
        return { u: pt[0], v: pt[1], type: 'FEATURE_VERTEX' };
      }
    }
    
    // 4. Grid Snap
    if (gridSnap) {
      return { u: Math.round(rawU), v: Math.round(rawV), type: 'GRID' };
    }
    
    return { u: rawU, v: rawV, type: null };
  };

  const handlePointerMove = (plane: 'FRONT' | 'TOP' | 'RIGHT', event: any) => {
    if (!isSketchMode || activePlane !== plane) {
      if (cursorState) setCursorState(null);
      return;
    }
    event.stopPropagation();
    
    const point = event.point;
    let rawU = 0, rawV = 0;
    if (plane === 'FRONT') { rawU = point.x; rawV = point.y; }
    else if (plane === 'TOP') { rawU = point.x; rawV = point.z; }
    else if (plane === 'RIGHT') { rawU = point.y; rawV = point.z; }
    
    setCursorState(getSnappedUV(rawU, rawV));
  };

  const size = 60;
  const opacity = 0.1;
  const hoverOpacity = 0.3;
  const activeOpacity = 0.5;

  const handlePlaneClick = (plane: 'FRONT' | 'TOP' | 'RIGHT', event: any) => {
    if (!isSketchMode) {
      event.stopPropagation();
      setEditingFeatureId(null);
      setSketchPoints([]);
      setSketchRelations([]);
      setActivePlane(plane);
      setContextMenu({
        plane,
        position: [event.point.x, event.point.y, event.point.z]
      });
      return;
    }

    if (activePlane !== plane) return;

    // We are in Sketch Mode and clicked the active plane
    event.stopPropagation();

    // Extract local UV coordinates or project world point to local
    const point = event.point; // World coordinate
    let rawU = 0, rawV = 0;

    if (plane === 'FRONT') { rawU = point.x; rawV = point.y; }
    else if (plane === 'TOP') { rawU = point.x; rawV = point.z; }
    else if (plane === 'RIGHT') { rawU = point.y; rawV = point.z; }

    // Apply SolidWorks precision O-Snap
    const snapped = getSnappedUV(rawU, rawV);
    const u = snapped.u;
    const v = snapped.v;

    // --- CIRCLE DRAWING TOOL ---
    if (sketchTool === 'CIRCLE') {
      if (sketchPoints.length === 0) {
        setSketchPoints([[u, v, 'CIRCLE_CENTER']]);
      } else {
        const [u_c, v_c] = sketchPoints[0];
        const R = Math.hypot(u - u_c, v - v_c);
        if (R > 0.1) {
          const circlePoints: any[] = [];
          const DIVISIONS = 36;
          for (let k = 0; k <= DIVISIONS; k++) {
            const theta = (k / DIVISIONS) * Math.PI * 2;
            circlePoints.push([u_c + R * Math.cos(theta), v_c + R * Math.sin(theta)]);
          }
          setSketchPoints(circlePoints);
        }
      }
      return;
    }

    // --- RECTANGLE DRAWING TOOL ---
    if (sketchTool === 'RECTANGLE') {
      if (sketchPoints.length === 0) {
        setSketchPoints([[u, v, 'RECT_CORNER']]);
      } else {
        const [u1, v1] = sketchPoints[0];
        const rectPoints = [
          [u1, v1],
          [u, v1],
          [u, v],
          [u1, v],
          [u1, v]
        ];
        setSketchPoints(rectPoints);
      }
      return;
    }

    // --- CENTER_LINE DRAWING TOOL ---
    if (sketchTool === 'CENTER_LINE') {
      const newPt = [u, v, 'CENTER_LINE'];
      setSketchPoints([...sketchPoints, newPt]);
      return;
    }

    // --- STANDARD LINE & ARC DRAWING ---
    let newPt: any = [u, v];
    if (sketchTool === 'ARC' && sketchPoints.length % 3 === 1) {
      newPt = [u, v, 'ARC_CONTROL'];
    }

    const newPoints: any[] = [...sketchPoints, newPt];
    
    // Check if we should finish (e.g., if clicked near the start point or if points > 3 and user clicks again)
    const isClosing = newPoints.length > 2 && 
      (Math.hypot(newPoints[0][0] - u, newPoints[0][1] - v) < 2);

    if (isClosing) {
      const firstPoint = newPoints[0];
      setSketchPoints([...newPoints.slice(0, -1), [firstPoint[0], firstPoint[1], firstPoint[2]]]);
    } else {
      setSketchPoints(newPoints);
    }
  };



  const getOpacity = (plane: string) => {
    if (activePlane === plane) return activeOpacity;
    if (hovered === plane) return hoverOpacity;
    return opacity;
  };

  const renderSnapCursor = () => {
    if (!isSketchMode || !cursorState) return null;
    
    let position: [number, number, number] = [0, 0, 0];
    if (activePlane === 'FRONT') position = [cursorState.u, cursorState.v, 0];
    else if (activePlane === 'TOP') position = [cursorState.u, 0, cursorState.v];
    else if (activePlane === 'RIGHT') position = [0, cursorState.u, cursorState.v];

    const isSnapped = cursorState.type !== null;
    const color = isSnapped ? "#f59e0b" : "#3b82f6"; // Amber Gold for snapped, Blue for free

    return (
      <group position={position}>
        <Sphere args={[isSnapped ? 0.8 : 0.4, 16, 16]}>
          <meshBasicMaterial color={color} depthTest={false} />
        </Sphere>
        {isSnapped && (
          <Html position={[1.5, 1.5, 0]} center style={{ pointerEvents: 'none' }}>
            <div className="bg-white/90 backdrop-blur-sm px-1.5 py-0.5 rounded shadow-sm border border-amber-200 text-[10px] font-mono font-bold text-amber-600 whitespace-nowrap">
              {cursorState.type === 'ORIGIN' ? '◎ Origin' : 
               cursorState.type === 'SKETCH_POINT' ? '● EndPoint' : 
               cursorState.type === 'FEATURE_VERTEX' ? '♦ Vertex' : 
               '⊞ Grid'}
            </div>
          </Html>
        )}
      </group>
    );
  };

  return (
    <group onPointerMissed={() => setContextMenu(null)}>
      {renderSnapCursor()}
      
      {/* Front Plane (XY) */}
      <group>
        <Plane 
          args={[size, size]} 
          onPointerOver={(e) => { e.stopPropagation(); setHovered('FRONT'); }}
          onPointerOut={() => { setHovered(null); setCursorState(null); }}
          onPointerMove={(e) => handlePointerMove('FRONT', e)}
          onClick={(e) => { e.stopPropagation(); handlePlaneClick('FRONT', e); }}
        >
          <meshStandardMaterial color="#3b82f6" transparent opacity={getOpacity('FRONT')} side={2} depthWrite={false} />
        </Plane>
        <Text position={[size/2, size/2, 0]} fontSize={2} color="#3b82f6">FRONT (XY)</Text>
      </group>

      {/* Top Plane (XZ) */}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <Plane 
          args={[size, size]} 
          onPointerOver={(e) => { e.stopPropagation(); setHovered('TOP'); }}
          onPointerOut={() => { setHovered(null); setCursorState(null); }}
          onPointerMove={(e) => handlePointerMove('TOP', e)}
          onClick={(e) => { e.stopPropagation(); handlePlaneClick('TOP', e); }}
        >
          <meshStandardMaterial color="#10b981" transparent opacity={getOpacity('TOP')} side={2} depthWrite={false} />
        </Plane>
        <Text position={[size/2, size/2, 0]} fontSize={2} color="#10b981">TOP (XZ)</Text>
      </group>

      {/* Right Plane (YZ) */}
      <group rotation={[0, Math.PI / 2, 0]}>
        <Plane 
          args={[size, size]} 
          onPointerOver={(e) => { e.stopPropagation(); setHovered('RIGHT'); }}
          onPointerOut={() => { setHovered(null); setCursorState(null); }}
          onPointerMove={(e) => handlePointerMove('RIGHT', e)}
          onClick={(e) => { e.stopPropagation(); handlePlaneClick('RIGHT', e); }}
        >

          <meshStandardMaterial color="#ef4444" transparent opacity={getOpacity('RIGHT')} side={2} depthWrite={false} />
        </Plane>
        <Text position={[size/2, size/2, 0]} fontSize={2} color="#ef4444">RIGHT (YZ)</Text>
      </group>

      {/* Context Menu Overlay (SolidWorks-like HUD context popup) */}
      {contextMenu && (
        <Html position={new THREE.Vector3(...contextMenu.position)} center>
          <div 
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="flex flex-col bg-white/95 backdrop-blur-md border border-slate-200 shadow-2xl rounded-lg p-2 w-[160px] gap-1.5 select-none animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="text-[10px] font-bold text-slate-400 px-2 py-0.5 uppercase tracking-wider font-mono border-b border-slate-200/50 pb-1 mb-0.5 flex justify-between items-center">
              <span>{contextMenu.plane} PLANE</span>
              <button 
                onClick={(e) => { e.stopPropagation(); setContextMenu(null); }} 
                className="text-slate-400 hover:text-red-500 font-bold ml-2 text-[11px] leading-none transition-all"
              >
                ✕
              </button>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingFeatureId(null);
                setSketchPoints([]);
                setSketchRelations([]);
                setActivePlane(contextMenu.plane);
                setSketchMode(true);
                setContextMenu(null);
              }}
              type="button"
              className="flex items-center gap-2.5 px-2 py-1.5 text-[12px] text-slate-700 hover:text-primary hover:bg-primary/10 rounded-md font-semibold transition-all duration-150 text-left border border-transparent hover:border-primary/20 shadow-sm hover:shadow-md"
            >
              <span className="text-sm">✏️</span>
              <span>草圖繪製 (Sketch)</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActivePlane(contextMenu.plane);
                useCadStore.getState().triggerCameraNormal();
                setContextMenu(null);
              }}
              type="button"
              className="flex items-center gap-2.5 px-2 py-1.5 text-[12px] text-slate-700 hover:text-indigo-600 hover:bg-indigo-50 rounded-md font-semibold transition-all duration-150 text-left border border-transparent hover:border-indigo-100 shadow-sm hover:shadow-md"
            >
              <span className="text-sm">🎯</span>
              <span>正對其 (Normal To)</span>
            </button>
          </div>
        </Html>
      )}

      <axesHelper args={[size/2]} />
    </group>
  );
};
