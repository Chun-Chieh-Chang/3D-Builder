import React, { useState } from 'react';
import { Plane, Text } from '@react-three/drei';
import { useCadStore } from '../store/useCadStore';
import * as THREE from 'three';

export const DatumPlanes = () => {
  const { 
    activePlane, setActivePlane, 
    isSketchMode, setSketchMode,
    sketchPoints, setSketchPoints,
    sketchTool,
    addFeature, features
  } = useCadStore();
  const [hovered, setHovered] = useState<string | null>(null);

  const size = 60;
  const opacity = 0.1;
  const hoverOpacity = 0.3;
  const activeOpacity = 0.5;

  const handlePlaneClick = (plane: 'FRONT' | 'TOP' | 'RIGHT', event: any) => {
    if (!isSketchMode) {
      setActivePlane(plane);
      setSketchMode(true);
      return;
    }

    if (activePlane !== plane) return;

    // We are in Sketch Mode and clicked the active plane
    // Extract local UV coordinates or project world point to local
    const point = event.point; // World coordinate
    let u = 0, v = 0;

    if (plane === 'FRONT') { u = point.x; v = point.y; }
    else if (plane === 'TOP') { u = point.x; v = point.z; }
    else if (plane === 'RIGHT') { u = point.y; v = point.z; }

    // Tag the point if it's an Arc Control Point (the 2nd point in a 3-point arc sequence)
    let newPt: any = [u, v];
    if (sketchTool === 'ARC' && sketchPoints.length % 3 === 1) {
      newPt = [u, v, 'ARC_CONTROL'];
    }

    const newPoints: any[] = [...sketchPoints, newPt];
    
    // Check if we should finish (e.g., if clicked near the start point or if points > 3 and user clicks again)
    const isClosing = newPoints.length > 2 && 
      (Math.hypot(newPoints[0][0] - u, newPoints[0][1] - v) < 2);

    if (isClosing) {
      // Create a Polyline Extrude
      addFeature({
        id: `feat_${Date.now()}`,
        type: 'EXTRUDE',
        name: `Custom Extrude ${features.length + 1}`,
        parameters: { 
          points: newPoints.slice(0, -1), // Remove the closing click
          depth: 10, 
          x: 0, y: 0, z: 0,
          operation: 'ADD', 
          plane 
        }
      });

      setSketchPoints([]);
      setSketchMode(false);
      setActivePlane(null);
    } else {
      setSketchPoints(newPoints);
    }
  };



  const getOpacity = (plane: string) => {
    if (activePlane === plane) return activeOpacity;
    if (hovered === plane) return hoverOpacity;
    return opacity;
  };

  return (
    <group>
      {/* Front Plane (XY) */}
      <group>
        <Plane 
          args={[size, size]} 
          onPointerOver={(e) => { e.stopPropagation(); setHovered('FRONT'); }}
          onPointerOut={() => setHovered(null)}
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
          onPointerOut={() => setHovered(null)}
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
          onPointerOut={() => setHovered(null)}
          onClick={(e) => { e.stopPropagation(); handlePlaneClick('RIGHT', e); }}
        >

          <meshStandardMaterial color="#ef4444" transparent opacity={getOpacity('RIGHT')} side={2} depthWrite={false} />
        </Plane>
        <Text position={[size/2, size/2, 0]} fontSize={2} color="#ef4444">RIGHT (YZ)</Text>
      </group>

      <axesHelper args={[size/2]} />
    </group>
  );
};

