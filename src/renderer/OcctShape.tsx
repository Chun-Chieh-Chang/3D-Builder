'use client';

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useCadStore, type MaterialAppearance, DEFAULT_APPEARANCE } from '../store/useCadStore';
import { topologySelector, getFeatureDistance } from './Viewport';

export interface FaceMetadata {
  id: string;
  area: number;
  v_count: number;
  curvature?: string;
  index_range: [number, number];
}

export interface MeshData {
  vertices: number[];
  normals: number[];
  indices: number[];
  face_metadata?: FaceMetadata[];
  featureId?: string;
}

interface OcctShapeProps {
  data: MeshData;
  color?: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
}

function applyBrightness(color: string, brightness: number): string {
  const hex = color.replace('#', '');
  const r = Math.min(255, Math.max(0, parseInt(hex.slice(0, 2), 16) + Math.round(brightness * 255)));
  const g = Math.min(255, Math.max(0, parseInt(hex.slice(2, 4), 16) + Math.round(brightness * 255)));
  const b = Math.min(255, Math.max(0, parseInt(hex.slice(4, 6), 16) + Math.round(brightness * 255)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export default function OcctShape({ 
  data, 
  color = '#60A5FA',
  position = [0, 0, 0],
  rotation = [0, 0, 0]
}: OcctShapeProps) {
  const { isSketchMode, activePropertyManager, features, setSelectedId, setSelectedSubNodeType, appearances, getFeatureAppearance } = useCadStore();

  const appearance: MaterialAppearance = useMemo(() => {
    if (data.featureId) {
      return appearances.features[data.featureId] || DEFAULT_APPEARANCE;
    }
    return { ...DEFAULT_APPEARANCE, color };
  }, [data.featureId, appearances.features, color]);

  const finalColor = useMemo(() => 
    applyBrightness(appearance.color, appearance.brightness),
    [appearance.color, appearance.brightness]
  );

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    
    // Convert arrays to Float32Array/Uint32Array for Three.js
    const positions = new Float32Array(data.vertices);
    const normals = new Float32Array(data.normals);
    const indices = new Uint32Array(data.indices);

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    if (normals.length > 0) {
      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    } else {
      geo.computeVertexNormals();
    }

    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }, [data]);

  // P4-3 Performance Audit: Proper resource disposal to prevent memory leaks
  React.useEffect(() => {
    return () => {
      if (geometry) {
        console.log('[OcctShape] Disposing geometry for performance stabilization');
        geometry.dispose();
      }
    };
  }, [geometry]);

  const handleMeshClick = (e: any) => {
    // Only process Left Click
    if (e.button !== 0) return;
    
    e.stopPropagation();
    
    if (topologySelector) {
      const ndcX = e.pointer ? e.pointer.x : 0;
      const ndcY = e.pointer ? e.pointer.y : 0;
      const filterType = activePropertyManager?.selectionFilter || 'ALL';
      const preserve = isSketchMode || activePropertyManager !== null;
      
      const selected = topologySelector.selectAtPosition(ndcX, ndcY, preserve, filterType);
      console.log('[OcctShape Topology] Clicked mesh at NDC:', ndcX, ndcY, 'Selected:', selected);
      
      if (selected && activePropertyManager) {
        const mgr = useCadStore.getState().activePropertyManager;
        if (mgr) {
          const alreadyExists = mgr.refs.some((r: any) => r.id === selected.id);
          if (!alreadyExists) {
            useCadStore.setState({
              activePropertyManager: {
                ...mgr,
                refs: [...mgr.refs, selected]
              }
            });
          }
        }
      } else if (!activePropertyManager && !isSketchMode) {
        // SolidWorks viewport selection & proximity mapping logic
        if (selected) {
          const clickPos = new THREE.Vector3(...selected.coordinates);
          let closestFeat = null;
          let minDistance = Infinity;
          
          for (const feat of features) {
            const dist = getFeatureDistance(feat, clickPos);
            if (dist < minDistance) {
              minDistance = dist;
              closestFeat = feat;
            }
          }
          
          if (closestFeat) {
            console.log('[OcctShape Selection] Proximity matches feature:', closestFeat.name, 'with distance:', minDistance);
            setSelectedId(closestFeat.id);
            setSelectedSubNodeType('FEATURE');
          }
        }
      }
    }
  };

  return (
    <mesh 
      geometry={geometry} 
      position={position} 
      rotation={rotation} 
      userData={{ type: 'B_REP_SHAPE', face_metadata: data.face_metadata }}
      onClick={handleMeshClick}
    >
      <meshStandardMaterial 
        color={finalColor} 
        roughness={1 - appearance.glossAmount} 
        metalness={appearance.reflectionAmount * 0.5} 
        flatShading={false}
        side={THREE.DoubleSide}
        transparent={appearance.transmissionAmount > 0}
        opacity={1 - appearance.transmissionAmount * 0.7}
      />
      {/* Edge visualization */}
      <lineSegments>
        <edgesGeometry args={[geometry]} />
        <lineBasicMaterial color="#1E293B" linewidth={1} />
      </lineSegments>
    </mesh>
  );
}

