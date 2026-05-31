'use client';

import { useCallback } from 'react';
import { useCadStore, type CADFeature } from '../store/useCadStore';
import { v4 as uuidv4 } from 'uuid';
import { extractAllClosedLoops, extractAllPaths, findDanglingNodes } from '../utils/geometry/GraphAdapter';
import { HeavyEngineClient } from '../kernel/HeavyEngineClient';

export const useFeatureBuilders = (handleRebuild: () => void) => {
  const {
    features,
    editingFeatureId,
    setEditingFeatureId,
    sketchNodes,
    setSketchNodes,
    sketchEdges,
    setSketchEdges,
    sketchConstraints,
    setSketchConstraints,
    setSketchMode,
    setActivePlane,
    activePlane,
    activeFaceOrigin,
    setActiveFaceOrigin,
    activeFaceNormal,
    setActiveFaceNormal,
    activeFaceId,
    setActiveFaceId,
    addFeature,
    updateFeatureParams,
    setSelectedId,
    setRollbackIndex,
    setSmartDimensionActive,
    setSelectedEntityIds,
    pushToast,
    setDanglingNodes,
    selectedTopology,
    setSelectedTopology,
    referencePlanes,
  } = useCadStore();

  const handleConvertEntities = useCallback(async () => {
    if (!activePlane || !selectedTopology) {
      pushToast('Please select a face or edge to convert.', 'warning');
      return;
    }
    try {
      const client = HeavyEngineClient.getInstance();
      const points = await client.convertEntities(
        features, 
        selectedTopology, 
        activePlane, 
        activeFaceOrigin || undefined, 
        activeFaceNormal || undefined
      );
      if (points && points.length > 0) {
        const nextNodes = { ...sketchNodes };
        const nextEdges = { ...sketchEdges };
        for (let i = 0; i < points.length; i++) {
          const loop = points[i];
          if (!loop || loop.length < 2) continue;
          let firstNodeId = null;
          let prevNodeId = null;
          for (let j = 0; j < loop.length; j++) {
            const pt = loop[j];
            const nId = uuidv4();
            nextNodes[nId] = { id: nId, x: pt[0], y: pt[1], isFixed: true };
            if (j === 0) firstNodeId = nId;
            if (prevNodeId) {
              const eId = uuidv4();
              nextEdges[eId] = { id: eId, type: 'LINE', nodeIds: [prevNodeId, nId] };
            }
            prevNodeId = nId;
          }
          if (firstNodeId && prevNodeId && loop.length >= 3) {
            const eId = uuidv4();
            nextEdges[eId] = { id: eId, type: 'LINE', nodeIds: [prevNodeId, firstNodeId] };
          }
        }
        setSketchNodes(nextNodes);
        setSketchEdges(nextEdges);
        pushToast('Entities converted successfully.', 'info');
        setSelectedTopology(null);
      }
    } catch (err) {
      pushToast('Failed to convert entities.', 'error');
    }
  }, [activePlane, selectedTopology, features, activeFaceOrigin, activeFaceNormal, sketchNodes, sketchEdges, setSketchNodes, setSketchEdges, setSelectedTopology, pushToast]);

  const handleOffsetEntities = useCallback(async () => {
    if (!activePlane) {
      pushToast('Sketch plane is not active.', 'warning');
      return;
    }
    const paths = extractAllPaths(sketchNodes, sketchEdges);
    if (paths.length === 0) {
      pushToast('Please sketch some geometry to offset.', 'warning');
      return;
    }
    try {
      const client = HeavyEngineClient.getInstance();
      const offsetDistance = parseFloat(prompt('Offset distance (mm):', '10') || '0');
      if (!offsetDistance || isNaN(offsetDistance) || offsetDistance === 0) return;

      const points = await client.offsetEntities(
        paths,
        offsetDistance,
        activePlane,
        activeFaceOrigin || undefined,
        activeFaceNormal || undefined
      );

      if (points && points.length > 0) {
        const nextNodes = { ...sketchNodes };
        const nextEdges = { ...sketchEdges };
        for (let i = 0; i < points.length; i++) {
          const loop = points[i];
          if (!loop || loop.length < 2) continue;
          let firstNodeId = null;
          let prevNodeId = null;
          for (let j = 0; j < loop.length; j++) {
            const pt = loop[j];
            const nId = uuidv4();
            nextNodes[nId] = { id: nId, x: pt[0], y: pt[1], isFixed: false };
            if (j === 0) firstNodeId = nId;
            if (prevNodeId) {
              const eId = uuidv4();
              nextEdges[eId] = { id: eId, type: 'LINE', nodeIds: [prevNodeId, nId] };
            }
            prevNodeId = nId;
          }
          if (firstNodeId && prevNodeId && loop.length >= 3) {
            const eId = uuidv4();
            nextEdges[eId] = { id: eId, type: 'LINE', nodeIds: [prevNodeId, firstNodeId] };
          }
        }
        setSketchNodes(nextNodes);
        setSketchEdges(nextEdges);
        pushToast(`Entities offset by ${offsetDistance}mm.`, 'info');
      }
    } catch (err) {
      pushToast('Failed to offset entities.', 'error');
    }
  }, [activePlane, sketchNodes, sketchEdges, activeFaceOrigin, activeFaceNormal, setSketchNodes, setSketchEdges, pushToast]);

  const uvTo3D = useCallback((u: number, v: number): [number, number, number] => {
    if (!activePlane) return [0, 0, 0];
    if (activePlane === 'FRONT') return [u, v, 0];
    if (activePlane === 'TOP') return [u, 0, v];
    if (activePlane === 'RIGHT') return [0, u, v];
    
    // Check if custom reference plane
    const customPlane = referencePlanes.find(p => p.id === activePlane);
    if (customPlane) {
      const [ox, oy, oz] = customPlane.origin;
      const [xx, xy, xz] = customPlane.xDir;
      const [yx, yy, yz] = customPlane.yDir;
      return [
        ox + u * xx + v * yx,
        oy + u * xy + v * yy,
        oz + u * xz + v * yz
      ];
    }

    if (activePlane === 'FACE' && activeFaceOrigin && activeFaceNormal) {
      const [nx, ny, nz] = activeFaceNormal;
      
      // Robust Plane Axis Logic (Aligned with OCC gp_Ax2 defaults)
      let ux = 0, uy = 1, uz = 0;
      if (Math.abs(ny) > 0.9) {
        ux = 0; uy = 0; uz = 1;
      }

      let xx = uy * nz - uz * ny;
      let xy = uz * nx - ux * nz;
      let xz = ux * ny - uy * nx;
      const xLen = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
      xx /= xLen; xy /= xLen; xz /= xLen;

      const yx = ny * xz - nz * xy;
      const yy = nz * xx - nx * xz;
      const yz = nx * xy - ny * xx;

      return [
        activeFaceOrigin[0] + u * xx + v * yx,
        activeFaceOrigin[1] + u * xy + v * yy,
        activeFaceOrigin[2] + u * xz + v * yz
      ];
    }
    return [0, 0, 0];
  }, [activePlane, activeFaceOrigin, activeFaceNormal, referencePlanes]);

  const resetSketchSession = useCallback(() => {
    setSketchNodes({});
    setSketchEdges({});
    setSketchConstraints({});
    setSketchMode(false);
    setActivePlane(null);
    setEditingFeatureId(null);
    setSmartDimensionActive(false);
    setSelectedEntityIds([]);
    setActiveFaceOrigin(null);
    setActiveFaceNormal(null);
    setActiveFaceId(null);
    setDanglingNodes([]);
  }, [setSketchNodes, setSketchEdges, setSketchConstraints, setSketchMode, setActivePlane, setEditingFeatureId, setSelectedEntityIds, setActiveFaceOrigin, setActiveFaceNormal, setActiveFaceId, setSmartDimensionActive, setDanglingNodes]);

  const handleSaveSketchOnly = useCallback(() => {
    if (!activePlane) return;
    
    const pointsToExtrude = extractAllPaths(sketchNodes, sketchEdges);
    if (pointsToExtrude.length === 0) {
      pushToast('Invalid Sketch Profile: No paths found.', 'error');
      return;
    }

    const existingFeature = editingFeatureId ? features.find(f => f.id === editingFeatureId) : null;
    const existingParams = existingFeature?.parameters ?? {};
    
    const nextParams = {
      ...existingParams,
      points: pointsToExtrude,
      sketchNodes: { ...sketchNodes },
      sketchEdges: { ...sketchEdges },
      sketchConstraints: { ...sketchConstraints },
      plane: activePlane,
      ...(activePlane === 'FACE' ? {
        faceOrigin: activeFaceOrigin,
        faceNormal: activeFaceNormal,
        faceId: activeFaceId
      } : {})
    };

    if (editingFeatureId && existingFeature && existingFeature.type === 'SKETCH') {
      updateFeatureParams(editingFeatureId, nextParams);
    } else {
      addFeature({
        id: `feat_${uuidv4()}`,
        type: 'SKETCH',
        name: `Sketch ${features.filter(f => f.type === 'SKETCH').length + 1}`,
        parameters: nextParams
      });
    }

    resetSketchSession();
  }, [activePlane, sketchNodes, sketchEdges, editingFeatureId, features, sketchConstraints, activeFaceOrigin, activeFaceNormal, activeFaceId, updateFeatureParams, resetSketchSession, addFeature, pushToast]);

  const handleExitAndExtrude = useCallback((operationOverride?: 'ADD' | 'CUT' | 'SURFACE') => {
    let pointsToExtrude: any[][] = [];
    if (operationOverride === 'SURFACE') {
      pointsToExtrude = extractAllPaths(sketchNodes, sketchEdges);
      if (pointsToExtrude.length === 0) {
        pushToast('Invalid Sketch Profile: No paths found for surface extrusion.', 'error');
        return;
      }
    } else {
      pointsToExtrude = extractAllClosedLoops(sketchNodes, sketchEdges);
      if (pointsToExtrude.length === 0 || pointsToExtrude[0].length < 3) {
        const danglingIds = findDanglingNodes(sketchNodes, sketchEdges);
        const danglingCoords = danglingIds.map(id => {
          const node = sketchNodes[id];
          return uvTo3D(node.x, node.y);
        });
        setDanglingNodes(danglingCoords);
        pushToast('Profile not closed. Dangling endpoints highlighted in red.', 'warning');
        return;
      }
    }

    if (!activePlane) return;

    const existingFeature = editingFeatureId ? features.find(f => f.id === editingFeatureId) : null;
    const existingParams = existingFeature?.parameters ?? {};
    const nextParams = {
      ...existingParams,
      points: pointsToExtrude,
      sketchNodes: { ...sketchNodes },
      sketchEdges: { ...sketchEdges },
      sketchConstraints: { ...sketchConstraints },
      depth: existingParams.depth ?? 10,
      x: existingParams.x ?? 0,
      y: existingParams.y ?? 0,
      z: existingParams.z ?? 0,
      operation: operationOverride ?? existingParams.operation ?? 'ADD',
      plane: activePlane,
      ...(activePlane === 'FACE' ? {
        faceOrigin: activeFaceOrigin,
        faceNormal: activeFaceNormal,
        faceId: activeFaceId
      } : {})
    };

    let featureId = editingFeatureId;
    if (featureId && existingFeature) {
      updateFeatureParams(featureId, nextParams);
    } else {
      featureId = `feat_${Date.now()}`;
      addFeature({
        id: featureId,
        type: 'EXTRUDE',
        name: `Custom Extrude ${features.length + 1}`,
        parameters: nextParams
      });
    }

    resetSketchSession();
    setRollbackIndex(null);
    setSelectedId(featureId);
    setTimeout(handleRebuild, 50);
  }, [sketchNodes, sketchEdges, activePlane, editingFeatureId, features, updateFeatureParams, addFeature, resetSketchSession, setSelectedId, handleRebuild, activeFaceOrigin, activeFaceNormal, activeFaceId, sketchConstraints, setRollbackIndex, pushToast, setDanglingNodes, uvTo3D]);

  const handleRevolveFromSketch = useCallback(() => {
    const solidLoops = extractAllClosedLoops(sketchNodes, sketchEdges);
    if (solidLoops.length === 0 || solidLoops[0].length < 3) {
      const danglingIds = findDanglingNodes(sketchNodes, sketchEdges);
      const danglingCoords = danglingIds.map(id => {
        const node = sketchNodes[id];
        return uvTo3D(node.x, node.y);
      });
      setDanglingNodes(danglingCoords);
      pushToast('Profile not closed. Dangling endpoints highlighted in red.', 'warning');
      return;
    }
    if (!activePlane) return;

    const existingFeature = editingFeatureId ? features.find(f => f.id === editingFeatureId) : null;
    const existingParams = existingFeature?.parameters ?? {};
    const nextParams = {
      ...existingParams,
      points: solidLoops,
      sketchNodes: { ...sketchNodes },
      sketchEdges: { ...sketchEdges },
      sketchConstraints: { ...sketchConstraints },
      angle: existingParams.angle ?? 360,
      x: existingParams.x ?? 0,
      y: existingParams.y ?? 0,
      z: existingParams.z ?? 0,
      operation: existingParams.operation ?? 'ADD',
      plane: activePlane,
      ...(activePlane === 'FACE' ? {
        faceOrigin: activeFaceOrigin,
        faceNormal: activeFaceNormal,
        faceId: activeFaceId
      } : {})
    };

    let featureId = editingFeatureId;
    if (featureId && existingFeature) {
      updateFeatureParams(featureId, nextParams);
    } else {
      featureId = `feat_${Date.now()}`;
      addFeature({
        id: featureId,
        type: 'REVOLVE',
        name: `Revolve ${features.length + 1}`,
        parameters: nextParams,
      });
    }

    resetSketchSession();
    setRollbackIndex(null);
    setSelectedId(featureId);
    setTimeout(handleRebuild, 50);
  }, [sketchNodes, sketchEdges, sketchConstraints, activePlane, editingFeatureId, features, updateFeatureParams, addFeature, resetSketchSession, setSelectedId, handleRebuild, activeFaceOrigin, activeFaceNormal, activeFaceId, setRollbackIndex, pushToast, setDanglingNodes, uvTo3D]);

  /** Convert a SKETCH feature's 2D points to 3D world-space coordinates using its plane. */
  const sketchFeatureTo3DPoints = useCallback((sketchFeat: CADFeature): any[][] => {
    const points = sketchFeat.parameters.points as any[][] | undefined;
    if (!points || points.length === 0) return [];
    const plane = sketchFeat.parameters.plane as string;
    const faceOrigin = sketchFeat.parameters.faceOrigin as [number,number,number] | undefined;
    const faceNormal = sketchFeat.parameters.faceNormal as [number,number,number] | undefined;

    const result: any[][] = [];
    for (const loop of points) {
      const transformedLoop: any[] = [];
      for (const pt of loop) {
        if (!pt || pt.length < 2) continue;
        const [u, v] = [Number(pt[0]), Number(pt[1])];
        let x = 0, y = 0, z = 0;
        let pnx = 0, pny = 0, pnz = 1;
        
        if (plane === 'FRONT')       { x = u; y = v; z = 0; pnx = 0; pny = 0; pnz = 1; }
        else if (plane === 'TOP')    { x = u; y = 0; z = v; pnx = 0; pny = 1; pnz = 0; }
        else if (plane === 'RIGHT')  { x = 0; y = u; z = v; pnx = 1; pny = 0; pnz = 0; }
        else if (plane === 'FACE' && faceOrigin && faceNormal) {
          const [nx, ny, nz] = faceNormal;
          pnx = nx; pny = ny; pnz = nz;
          
          // Robust Plane Axis Logic (Aligned with OCC gp_Ax2 defaults)
          // 1. Choose a candidate 'up' vector
          let ux = 0, uy = 1, uz = 0;
          if (Math.abs(ny) > 0.9) {
            ux = 0; uy = 0; uz = 1;
          }

          // 2. X = normalize(up x N)
          let xx = uy * nz - uz * ny;
          let xy = uz * nx - ux * nz;
          let xz = ux * ny - uy * nx;
          const xLen = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
          xx /= xLen; xy /= xLen; xz /= xLen;

          // 3. Y = N x X
          const yx = ny * xz - nz * xy;
          const yy = nz * xx - nx * xz;
          const yz = nx * xy - ny * xx;

          x = faceOrigin[0] + u * xx + v * yx;
          y = faceOrigin[1] + u * xy + v * yy;
          z = faceOrigin[2] + u * xz + v * yz;
        }

        // Preserve all metadata (labels like 'SPLINE_CONTROL', 'ARC_CONTROL')
        const labels = pt.slice(2);
        // Ensure metadata object exists and append planeNormal
        const metadataIdx = labels.findIndex((l: any) => typeof l === 'object' && l !== null);
        let metadata = metadataIdx >= 0 ? labels[metadataIdx] : {};
        metadata = { ...metadata, planeNormal: [pnx, pny, pnz] };
        
        if (metadataIdx >= 0) {
          labels[metadataIdx] = metadata;
        } else if (labels.length > 0) {
           // Tag exists but no metadata obj, append metadata
           labels.push(metadata);
        } else {
           // No tag, no metadata, push undefined tag then metadata
           labels.push(undefined, metadata);
        }

        transformedLoop.push([x, y, z, ...labels]);
      }
      if (transformedLoop.length > 0) {
         result.push(transformedLoop);
      }
    }
    return result;
  }, []);
const handleBuildSweepLoft = useCallback((feat: CADFeature) => {
  if (feat.type === 'SWEEP') {
    const profileFeat = features.find(f => f.id === feat.parameters.profile_id);
    const pathFeat    = features.find(f => f.id === feat.parameters.path_id);
    if (!profileFeat || !pathFeat) {
      pushToast('Sweep: Please select both a Profile and a Path sketch.', 'error');
      return;
    }
    
    // Extract guide points if any
    const guideIds: string[] = feat.parameters.guide_ids || [];
    const guidePointsList = guideIds.filter(Boolean).map(id => {
      const f = features.find(feat => feat.id === id);
      return f ? sketchFeatureTo3DPoints(f) : [];
    });

    updateFeatureParams(feat.id, {
      ...feat.parameters,
      profile_points: sketchFeatureTo3DPoints(profileFeat),
      path_points:    sketchFeatureTo3DPoints(pathFeat),
      guide_points:   guidePointsList,
    });
  } else if (feat.type === 'HELICAL_SWEEP') {
    const profileFeat = features.find(f => f.id === feat.parameters.profile_id);
    if (!profileFeat) {
      pushToast('Helical Sweep: Please select a Profile sketch.', 'error');
      return;
    }

    let axisPoints: number[][] = [];
    const axisRef = feat.parameters.axis_ref;
    if (axisRef && axisRef.type === 'EDGE' && axisRef.edgeData) {
      axisPoints = [axisRef.edgeData.start, axisRef.edgeData.end];
    } else if (axisRef && axisRef.coordinates) {
      // Fallback for single point selection or other types
      axisPoints = [axisRef.coordinates, [axisRef.coordinates[0], axisRef.coordinates[1], axisRef.coordinates[2] + 10]];
    }

    updateFeatureParams(feat.id, {
      ...feat.parameters,
      profile_points: sketchFeatureTo3DPoints(profileFeat),
      axis_points: axisPoints,
    });
  } else if (feat.type === 'LOFT') {
      const profileIds: string[] = feat.parameters.profile_ids || [];
      if (profileIds.filter(Boolean).length < 2) {
        pushToast('Loft: Please select at least two Profile sketches.', 'error');
        return;
      }
      const profilePts = profileIds
        .filter(Boolean)
        .map(id => {
          const f = features.find(f => f.id === id);
          return f ? sketchFeatureTo3DPoints(f) : [];
        });

      // Extract guide points if any
      const guideIds: string[] = feat.parameters.guide_ids || [];
      const guidePointsList = guideIds.filter(Boolean).map(id => {
        const f = features.find(feat => feat.id === id);
        return f ? sketchFeatureTo3DPoints(f) : [];
      });

      updateFeatureParams(feat.id, { 
        ...feat.parameters, 
        profiles: profilePts,
        guide_points: guidePointsList,
      });
    } else if (feat.type === 'FILLET' || feat.type === 'CHAMFER') {
      // In multi-select mode, refs are already in the store. 
      // Just trigger a rebuild.
      const rebuildHook = (window as any).__handleRebuild;
      if (rebuildHook) rebuildHook();
    }
  }, [features, sketchFeatureTo3DPoints, updateFeatureParams, pushToast]);

  return {
    resetSketchSession,
    handleSaveSketchOnly,
    handleExitAndExtrude,
    handleRevolveFromSketch,
    handleBuildSweepLoft,
    sketchFeatureTo3DPoints,
    handleConvertEntities,
    handleOffsetEntities,
  };
};
