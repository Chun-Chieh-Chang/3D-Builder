'use client';

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useCadStore, MATERIAL_PRESETS } from '../store/useCadStore';
import { topologySelector, getFeatureDistance } from './Viewport';

export interface FaceMetadata {
  id: string;
  tns_name?: string;
  area: number;
  v_count: number;
  curvature?: string;
  index_range: [number, number];
  surface_type?: string;
  axis_origin?: [number, number, number];
  axis_direction?: [number, number, number];
  radius?: number;
}

const geometryCache = new WeakMap<MeshData, THREE.BufferGeometry>();

export interface MeshData {
  vertices: number[];
  normals: number[];
  indices: number[];
  colors?: number[];
  face_metadata?: FaceMetadata[];
}

interface OcctShapeProps {
  data: MeshData;
  color?: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  componentId?: string;
}

export default function OcctShape({ 
  data, 
  color = '#60A5FA',
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  componentId
}: OcctShapeProps) {
  const {
    mode: cadMode,
    mateSelection,
    addMateSelection,
    isSketchMode,
    activePropertyManager,
    pendingFeatureCommand,
    features,
    setSelectedId,
    setSelectedSubNodeType,
    viewportDisplayMode,
    sectionView,
    partMaterial,
    measurementMode,
    measurementPoints,
    setMeasurementPoints,
  } = useCadStore();

  const clippingPlanes = useMemo(() => {
    if (!sectionView.isActive) return [];
    
    const plane = sectionView.plane;
    const normal = new THREE.Vector3();
    const origNormal = new THREE.Vector3();
    
    if (plane === 'FRONT') {
      normal.set(0, 0, 1);
      origNormal.set(0, 0, 1);
    } else if (plane === 'TOP') {
      normal.set(0, 1, 0);
      origNormal.set(0, 1, 0);
    } else if (plane === 'RIGHT') {
      normal.set(1, 0, 0);
      origNormal.set(1, 0, 0);
    }
    
    const d = sectionView.flip ? -sectionView.offset : sectionView.offset;
    if (sectionView.flip) normal.negate();
    
    const p = new THREE.Plane(normal, -d);
    return [p];
  }, [sectionView]);

  const geometry = useMemo(() => {
    if (geometryCache.has(data)) {
      return geometryCache.get(data)!;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices, 3));
    if (data.normals && data.normals.length > 0) {
      geom.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
    }
    if (data.colors && data.colors.length > 0) {
      geom.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
    }
    geom.setIndex(data.indices);
    geometryCache.set(data, geom);
    return geom;
  }, [data]);

  // We no longer dispose geometry on unmount because it may be shared via geometryCache.
  React.useEffect(() => {
    return () => {
      // Intentionally empty: Geometry is cached.
    };
  }, []);

  const handleMeshClick = (e: any) => {
    e.stopPropagation();
    
    if (topologySelector) {
      const ndcX = e.pointer ? e.pointer.x : 0;
      const ndcY = e.pointer ? e.pointer.y : 0;
      let filterType = 'ALL';
      if (pendingFeatureCommand === 'FILLET' || pendingFeatureCommand === 'CHAMFER' || pendingFeatureCommand === 'PATTERN') {
        filterType = 'EDGE_ONLY';
      } else if (pendingFeatureCommand === 'DRAFT' || pendingFeatureCommand === 'MIRROR' || pendingFeatureCommand === 'THICKEN' || pendingFeatureCommand === 'SHELL' || pendingFeatureCommand === 'HOLE_WIZARD' || pendingFeatureCommand === 'PLANE') {
        filterType = 'FACE_ONLY';
      } else if (activePropertyManager?.selectionFilter) {
        filterType = activePropertyManager.selectionFilter;
      }
      
      const preserve = isSketchMode || activePropertyManager !== null;
      
      const selected = topologySelector.selectAtPosition(ndcX, ndcY, preserve, filterType as any);
      
      if (selected && measurementMode !== 'NONE') {
        if (measurementPoints.length < 2) {
          setMeasurementPoints([...measurementPoints, selected]);
        } else {
          setMeasurementPoints([measurementPoints[0], selected]);
        }
        return;
      }

      if (selected && cadMode === 'ASSEMBLY' && !isSketchMode) {
        // Assembly Mate Selection
        selected.componentId = componentId;
        const currentState = useCadStore.getState().mateSelection;
        if (currentState.length < 2) {
            const alreadyExists = currentState.some((sel: any) => sel.id === selected.id && sel.componentId === componentId);
            if (!alreadyExists) {
                addMateSelection(selected);
            }
        }
      } else if (selected && activePropertyManager) {
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
      } else if (selected && pendingFeatureCommand) {
        const state = useCadStore.getState();
        const featId = state.selectedId;
        if (featId) {
          const featIndex = state.features.findIndex(f => f.id === featId);
          if (featIndex !== -1 && state.features[featIndex].type === pendingFeatureCommand) {
            const params = state.features[featIndex].parameters;
            
            if (pendingFeatureCommand === 'DRAFT') {
              const neutralRefs = params.neutral_plane_refs || [];
              const faceRefs = params.faces_to_draft_refs || [];
              if (neutralRefs.length === 0) {
                state.updateFeatureParams(featId, { neutral_plane_refs: [selected] });
              } else {
                if (!faceRefs.some((r: any) => r.id === selected.id) && neutralRefs[0].id !== selected.id) {
                  state.updateFeatureParams(featId, { faces_to_draft_refs: [...faceRefs, selected] });
                }
              }
            } else if (pendingFeatureCommand === 'MIRROR') {
              const currentRefs = params.mirror_plane_refs || [];
              if (currentRefs.length === 0) {
                state.updateFeatureParams(featId, { mirror_plane_refs: [selected] });
              }
            } else if (pendingFeatureCommand === 'PATTERN') {
              const currentRefs = params.direction_refs || [];
              if (currentRefs.length === 0) {
                state.updateFeatureParams(featId, { direction_refs: [selected] });
              }
            } else if (pendingFeatureCommand === 'SHELL') {
              const currentRefs = params.faces_to_remove_refs || [];
              const alreadyExists = currentRefs.some((r: any) => r.id === selected.id);
              if (!alreadyExists) {
                state.updateFeatureParams(featId, { faces_to_remove_refs: [...currentRefs, selected] });
              }
            } else if (pendingFeatureCommand === 'HOLE_WIZARD') {
              state.updateFeatureParams(featId, { hole_placement_refs: [selected] });
            } else if (pendingFeatureCommand === 'PLANE') {
              state.updateFeatureParams(featId, { reference_refs: [selected] });
            } else {
              const currentRefs = params.refs || [];
              const alreadyExists = currentRefs.some((r: any) => r.id === selected.id);
              if (!alreadyExists) {
                state.updateFeatureParams(featId, { refs: [...currentRefs, selected] });
              }
            }
          }
        }
      } else if (!activePropertyManager && !isSketchMode) {
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
      userData={{ type: 'B_REP_SHAPE', face_metadata: data.face_metadata, componentId }}
      onClick={handleMeshClick}
    >
      <meshPhysicalMaterial
        vertexColors={!!data.colors && data.colors.length > 0}
        color={data.colors && data.colors.length > 0 ? '#ffffff' : (cadMode === 'RENDER' ? MATERIAL_PRESETS[partMaterial]?.color || color : color)}
        roughness={cadMode === 'RENDER' ? MATERIAL_PRESETS[partMaterial]?.roughness ?? 0.3 : 0.3}
        metalness={cadMode === 'RENDER' ? MATERIAL_PRESETS[partMaterial]?.metalness ?? 0.2 : 0.2}
        clearcoat={cadMode === 'RENDER' ? MATERIAL_PRESETS[partMaterial]?.clearcoat ?? 0 : 0}
        clearcoatRoughness={cadMode === 'RENDER' ? MATERIAL_PRESETS[partMaterial]?.clearcoatRoughness ?? 0 : 0}
        transmission={cadMode === 'RENDER' ? MATERIAL_PRESETS[partMaterial]?.transmission ?? 0 : 0}
        ior={cadMode === 'RENDER' ? MATERIAL_PRESETS[partMaterial]?.ior ?? 1.5 : 1.5}
        thickness={cadMode === 'RENDER' ? MATERIAL_PRESETS[partMaterial]?.thickness ?? 0 : 0}
        flatShading={false}
        side={THREE.DoubleSide}
        wireframe={viewportDisplayMode === 'WIREFRAME'}
        transparent={viewportDisplayMode === 'WIREFRAME' || color === 'red' || (cadMode === 'RENDER' && (MATERIAL_PRESETS[partMaterial]?.transmission ?? 0) > 0)}
        opacity={viewportDisplayMode === 'WIREFRAME' ? 0.85 : (color === 'red' ? 0.6 : 1)}
        clippingPlanes={clippingPlanes}
      />
      {viewportDisplayMode !== 'SHADED' && (
        <lineSegments>
          <edgesGeometry args={[geometry]} />
          <lineBasicMaterial color="#1E293B" linewidth={1} clippingPlanes={clippingPlanes} />
        </lineSegments>
      )}
    </mesh>
  );
}
