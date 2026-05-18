import React, { useState, useMemo } from 'react';
import * as THREE from 'three';
import { useCadStore } from '../store/useCadStore';
import { Line } from '@react-three/drei';

export const SketchPreview = () => {
  const { 
    sketchPoints, 
    activePlane, 
    isSketchMode,
    selectedEntityIds,
    setSelectedEntityIds
  } = useCadStore();

  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);

  const get3DPoint = (u: number, v: number) => {
    if (activePlane === 'FRONT') return new THREE.Vector3(u, v, 0);
    if (activePlane === 'TOP') return new THREE.Vector3(u, 0, v);
    if (activePlane === 'RIGHT') return new THREE.Vector3(0, u, v);
    return new THREE.Vector3(u, v, 0);
  };

  // 1. Parse sketchPoints into independent entities
  const entities = useMemo(() => {
    const list: any[] = [];
    let i = 0;
    
    while (i < sketchPoints.length) {
      // Circle check (37 points closed loop)
      if (i + 36 < sketchPoints.length) {
        const pStart = sketchPoints[i];
        const pEnd = sketchPoints[i + 36];
        if (Math.hypot(pStart[0] - pEnd[0], pStart[1] - pEnd[1]) < 0.1) {
          list.push({
            id: `circle_${i}`,
            type: 'CIRCLE',
            name: `圓圈 C${list.filter(e => e.type === 'CIRCLE').length + 1}`,
            pointIndices: Array.from({ length: 37 }, (_, k) => i + k)
          });
          i += 37;
          continue;
        }
      }
      
      // Rectangle check (5 points closed loop)
      if (i + 4 < sketchPoints.length) {
        const pStart = sketchPoints[i];
        const pEnd = sketchPoints[i + 4];
        if (Math.hypot(pStart[0] - pEnd[0], pStart[1] - pEnd[1]) < 0.1) {
          list.push({
            id: `rect_${i}`,
            type: 'RECTANGLE',
            name: `矩形 R${list.filter(e => e.type === 'RECTANGLE').length + 1}`,
            pointIndices: Array.from({ length: 5 }, (_, k) => i + k)
          });
          i += 5;
          continue;
        }
      }
      
      // Standard segment check
      const pCurr = sketchPoints[i];
      const pNext = sketchPoints[i + 1];
      if (pNext) {
        if (pCurr[2] === 'CENTER_LINE') {
          list.push({
            id: `cline_${i}`,
            type: 'CENTER_LINE',
            name: `中心線 CL${list.filter(e => e.type === 'CENTER_LINE').length + 1}`,
            pointIndices: [i, i + 1]
          });
          i += 1;
        } else if (pNext[2] === 'ARC_CONTROL') {
          const pEnd = sketchPoints[i + 2];
          if (pEnd) {
            list.push({
              id: `arc_${i}`,
              type: 'LINE',
              name: `圓弧 A${list.filter(e => e.type === 'LINE' && e.name.includes('圓弧')).length + 1}`,
              pointIndices: [i, i + 1, i + 2]
            });
            i += 2;
          } else {
            list.push({
              id: `line_${i}`,
              type: 'LINE',
              name: `線段 L${list.filter(e => e.type === 'LINE' && !e.name.includes('圓弧')).length + 1}`,
              pointIndices: [i, i + 1]
            });
            i += 1;
          }
        } else {
          list.push({
            id: `line_${i}`,
            type: 'LINE',
            name: `線段 L${list.filter(e => e.type === 'LINE' && !e.name.includes('圓弧')).length + 1}`,
            pointIndices: [i, i + 1]
          });
          i += 1;
        }
      } else {
        i += 1;
      }
    }
    return list;
  }, [sketchPoints]);

  // 2. Generate 3D point array for a single entity
  const getEntityPoints = (ent: any): [number, number, number][] => {
    const pts: [number, number, number][] = [];
    const indices = ent.pointIndices;
    let idx = 0;
    
    while (idx < indices.length) {
      const ptIdx = indices[idx];
      const p_curr = sketchPoints[ptIdx];
      if (!p_curr) {
        idx++;
        continue;
      }
      
      const pt3d = get3DPoint(p_curr[0], p_curr[1]);
      
      // ARC special interpolation
      if (p_curr[2] === 'ARC_CONTROL') {
        const p_prev_idx = indices[idx - 1];
        const p_end_idx = indices[idx + 1];
        if (p_prev_idx !== undefined && p_end_idx !== undefined) {
          const p_prev = sketchPoints[p_prev_idx];
          const p_end = sketchPoints[p_end_idx];
          if (p_prev && p_end) {
            const p0 = get3DPoint(p_prev[0], p_prev[1]);
            const p1 = get3DPoint(p_curr[0], p_curr[1]);
            const p2 = get3DPoint(p_end[0], p_end[1]);
            const curve = new THREE.CatmullRomCurve3([p0, p1, p2]);
            const curvePts = curve.getPoints(15);
            for (let k = 1; k < curvePts.length; k++) {
              pts.push([curvePts[k].x, curvePts[k].y, curvePts[k].z]);
            }
            idx += 2;
            continue;
          }
        }
      }
      
      pts.push([pt3d.x, pt3d.y, pt3d.z]);
      idx++;
    }
    return pts;
  };

  // 3. Selection handler
  const handleEntityClick = (entId: string) => {
    const isSelected = selectedEntityIds.includes(entId);
    if (isSelected) {
      setSelectedEntityIds(selectedEntityIds.filter(id => id !== entId));
    } else {
      if (selectedEntityIds.length >= 2) {
        setSelectedEntityIds([selectedEntityIds[1], entId]);
      } else {
        setSelectedEntityIds([...selectedEntityIds, entId]);
      }
    }
  };

  // 4. Node markers (filtering out circle boundary points and adding a single center + perimeter marker instead)
  const markers = useMemo(() => {
    const list: any[] = [];
    const hiddenIndices = new Set<number>();

    // Scan entities for circles
    entities.forEach((ent, entIdx) => {
      if (ent.type === 'CIRCLE') {
        const indices = ent.pointIndices;
        // Compute center and radius mathematically from circle points
        const pts = indices.map((idx: number) => sketchPoints[idx]);
        const us = pts.map((p: number[]) => p[0]);
        const vs = pts.map((p: number[]) => p[1]);
        const minU = Math.min(...us);
        const maxU = Math.max(...us);
        const minV = Math.min(...vs);
        const maxV = Math.max(...vs);
        const cU = (minU + maxU) / 2;
        const cV = (minV + maxV) / 2;
        const radius = (maxU - minU) / 2;

        // Hide all 37 circumference points
        indices.forEach((idx: number) => hiddenIndices.add(idx));

        // Add 1 center marker (SolidWorks Style!)
        list.push({
          pos: get3DPoint(cU, cV),
          isCenter: true,
          isControl: false,
          isCorner: false,
          isCenterline: false,
          isStart: false
        });

        // Add 1 circumference point as a drag/select handle (SolidWorks Style!)
        list.push({
          pos: get3DPoint(cU + radius, cV),
          isCenter: false,
          isControl: true, // Draws green
          isCorner: false,
          isCenterline: false,
          isStart: false
        });
      }
    });

    // Add remaining non-circle sketch points
    sketchPoints.forEach((pt, idx) => {
      if (hiddenIndices.has(idx)) return;
      const isControl = pt[2] === 'ARC_CONTROL';
      const isCenter = pt[2] === 'CIRCLE_CENTER';
      const isCorner = pt[2] === 'RECT_CORNER';
      const isCenterline = pt[2] === 'CENTER_LINE';
      const pos = get3DPoint(pt[0], pt[1]);
      list.push({ pos, isControl, isCenter, isCorner, isCenterline, isStart: idx === 0 });
    });

    return list;
  }, [sketchPoints, entities, activePlane]);

  if (!isSketchMode || !activePlane || sketchPoints.length === 0) return null;

  return (
    <group>
      {/* Draw each entity dynamically with full hover/click interaction */}
      {entities.map((ent) => {
        const entityPoints = getEntityPoints(ent);
        if (entityPoints.length < 2) return null;

        const isSelected = selectedEntityIds.includes(ent.id);
        const isHovered = hoveredEntityId === ent.id;
        const isCenterline = ent.type === 'CENTER_LINE';

        return (
          <group key={ent.id}>
            {/* Elegant high-precision visible line */}
            <Line
              points={entityPoints}
              color={
                isSelected 
                  ? "#ec4899" // Vibrant Magenta when selected (SolidWorks selection style)
                  : isHovered 
                  ? "#f59e0b" // Warm Amber Gold on hover (SolidWorks hover highlight style)
                  : isCenterline 
                  ? "#6b7280" // Charcoal Grey for centerline
                  : "#3b82f6" // Royal Blue for standard lines
              }
              lineWidth={isSelected ? 5.5 : isHovered ? 4.5 : 3.0}
              dashed={isCenterline}
              dashSize={1.5}
              gapSize={1.0}
              depthTest={false}
            />
            
            {/* Thick transparent interactive click-receiver layer (Solves thin-line click accuracy) */}
            <Line
              points={entityPoints}
              color="#000000"
              lineWidth={16.0}
              opacity={0.0}
              transparent
              onClick={(e) => {
                e.stopPropagation();
                handleEntityClick(ent.id);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHoveredEntityId(ent.id);
              }}
              onPointerOut={(e) => {
                setHoveredEntityId(null);
              }}
            />
          </group>
        );
      })}

      {/* Draw node markers */}
      {markers.map((m, i) => (
        <mesh key={i} position={m.pos}>
          <sphereGeometry args={[m.isControl || m.isCenter || m.isCorner ? 0.35 : 0.5, 8, 8]} />
          <meshBasicMaterial
            depthTest={false}
            color={
              m.isCenter
                ? "#f59e0b" // Center point: Amber Gold
                : m.isCorner
                ? "#8b5cf6" // Rectangle Corner: Purple
                : m.isStart
                ? "#ef4444" // Start Point: Red
                : m.isControl
                ? "#10b981" // Arc Control Point: Emerald Green
                : m.isCenterline
                ? "#6b7280" // Centerline Node: Slate Grey
                : "#3b82f6" // Standard Line Node: Royal Blue
            }
          />
        </mesh>
      ))}
    </group>
  );
};
