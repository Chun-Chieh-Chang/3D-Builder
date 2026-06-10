'use client';

import { useEffect } from 'react';
import { useCadStore, type CADFeature } from '@/store/useCadStore';
import { v4 as uuidv4 } from 'uuid';

interface SelectionLogicDeps {
  activeTab: string;
  isSketchMode: boolean;
  setSelectedTopology: (t: any) => void;
  selectedTopology: any;
  pendingFeatureCommand: string | null;
  selectedId: string | null;
  features: CADFeature[];
  addFeature: (f: any) => void;
  updateFeatureParams: (id: string, params: any) => void;
  setPendingFeatureCommand: (cmd: any) => void;
  setSelectedId: (id: string | null) => void;
  handleRebuild: () => void;
  defaultFilletRadius: number;
  defaultChamferDistance: number;
  setHint: (hint: string) => void;
}

export function useSelectionLogic(deps: SelectionLogicDeps) {
  const {
    activeTab, isSketchMode, setSelectedTopology,
    selectedTopology, pendingFeatureCommand,
    selectedId, features, addFeature, updateFeatureParams,
    setPendingFeatureCommand, setSelectedId, handleRebuild,
    defaultFilletRadius, defaultChamferDistance, setHint,
  } = deps;

  const selectedFeature =
    selectedId ? features.find(f => f.id === selectedId) : null;

  // ── Sweep feature hint ──────────────────────────────────────
  useEffect(() => {
    if (selectedFeature?.type !== 'SWEEP') return;
    const hasProfile = selectedFeature.parameters?.profile_id;
    const hasPath = selectedFeature.parameters?.path_id;
    if (!hasProfile && !hasPath) {
      setHint('Sweep: Select Profile (截面) and Path (路徑) in PropertyManager below.');
    } else if (!hasProfile) {
      setHint('Sweep: Please select a Profile sketch first.');
    } else if (!hasPath) {
      setHint('Sweep: Profile selected. Now select a Path sketch.');
    } else {
      setHint('Sweep: Ready. Profile + Path set. Adjust alignment/flip options if needed.');
    }
  }, [selectedFeature, selectedId, setHint]);

  // ── Assembly mate selection ─────────────────────────────────
  useEffect(() => {
    const clickedTopo = useCadStore.getState().selectedTopology;
    if (isSketchMode || activeTab !== 'ASSEMBLY' || !clickedTopo) return;

    const prevSelection = useCadStore.getState().mateSelection || [];
    if (prevSelection.some((p: any) => p.id === clickedTopo.id)) {
      setSelectedTopology(null);
      return;
    }

    const enriched = {
      ...clickedTopo,
      componentId: clickedTopo.componentId || 'root',
    };
    const nextSelection =
      prevSelection.length >= 2
        ? [enriched]
        : [...prevSelection, enriched];

    useCadStore.setState({ mateSelection: nextSelection });
    setSelectedTopology(null);
  }, [activeTab, isSketchMode, setSelectedTopology]);

  // ── Fillet / Chamfer picker ─────────────────────────────────
  useEffect(() => {
    const cmd = pendingFeatureCommand;
    const topo = selectedTopology;
    if (isSketchMode || !cmd || !topo || topo.type !== 'EDGE') return;

    const start = topo.edgeData?.start;
    const end = topo.edgeData?.end;
    if (!start || !end) return;

    const featureId = `feat_${uuidv4()}`;
    if (cmd === 'FILLET') {
      addFeature({
        id: featureId, type: 'FILLET',
        name: `Fillet ${features.length + 1}`,
        parameters: {
          radius: defaultFilletRadius,
          edge_start: start, edge_end: end,
          signature: topo.signature, operation: 'ADD',
        },
      });
    } else {
      addFeature({
        id: featureId, type: 'CHAMFER',
        name: `Chamfer ${features.length + 1}`,
        parameters: {
          distance: defaultChamferDistance,
          edge_start: start, edge_end: end,
          signature: topo.signature, operation: 'ADD',
        },
      });
    }
    setPendingFeatureCommand(null);
    setSelectedTopology(null);
    setSelectedId(featureId);
    setTimeout(handleRebuild, 50);
  }, [
    pendingFeatureCommand, selectedTopology, isSketchMode,
    features.length, defaultFilletRadius, defaultChamferDistance,
    addFeature, setPendingFeatureCommand, setSelectedTopology,
    setSelectedId, handleRebuild,
  ]);

  // ── Pattern / Mirror / Shell / RefPlane / RefAxis / HoleWizard / Draft picker ──
  useEffect(() => {
    const topo = selectedTopology;
    if (isSketchMode || !selectedId || !topo) return;

    const feat = features.find(f => f.id === selectedId);
    if (!feat) return;

    const pick = (ref: any) => {
      setSelectedTopology(null);
      setTimeout(handleRebuild, 50);
    };

    if (feat.type === 'PATTERN' && topo.type === 'EDGE') {
      const edgeRef = {
        id: topo.id, type: 'EDGE',
        coordinates: topo.edgeData?.start,
        end_coordinates: topo.edgeData?.end,
        signature: topo.signature,
      };
      updateFeatureParams(selectedId, { direction_refs: [edgeRef] });
    }
    else if (feat.type === 'MIRROR' && (topo.type === 'FACE' || topo.type === 'PLANE')) {
      const planeRef = {
        id: topo.id, type: topo.type,
        coordinates: topo.coordinates, normal: topo.normal,
        signature: topo.signature,
      };
      updateFeatureParams(selectedId, { mirror_plane_refs: [planeRef] });
      pick(planeRef);
    }
    else if (feat.type === 'SHELL' && topo.type === 'FACE') {
      const faceRef = {
        id: topo.id, type: 'FACE',
        coordinates: topo.coordinates, normal: topo.normal,
        signature: topo.signature,
      };
      const current = feat.parameters?.faces_to_remove_refs || [];
      if (!current.some((r: any) => r.id === faceRef.id)) {
        updateFeatureParams(selectedId, {
          faces_to_remove_refs: [...current, faceRef],
        });
      }
      pick(faceRef);
    }
    else if (feat.type === 'REFERENCE_PLANE') {
      const ref = {
        id: topo.id, type: topo.type,
        coordinates: topo.coordinates, normal: topo.normal,
        edgeData: topo.edgeData, signature: topo.signature,
      };
      const current = feat.parameters?.refs || [];
      if (!current.some((r: any) => r.id === ref.id)) {
        updateFeatureParams(selectedId, { refs: [...current, ref] });
      }
      pick(ref);
    }
    else if (feat.type === 'REFERENCE_AXIS') {
      const ref = {
        id: topo.id, type: topo.type,
        coordinates: topo.coordinates, normal: topo.normal,
        edgeData: topo.edgeData, signature: topo.signature,
      };
      const current = feat.parameters?.refs || [];
      if (!current.some((r: any) => r.id === ref.id)) {
        updateFeatureParams(selectedId, { refs: [...current, ref] });
      }
      pick(ref);
    }
    else if (feat.type === 'HOLE_WIZARD' && topo.type === 'FACE') {
      const faceRef = {
        id: topo.id, type: 'FACE',
        coordinates: topo.coordinates, normal: topo.normal,
        signature: topo.signature,
      };
      updateFeatureParams(selectedId, { hole_placement_refs: [faceRef] });
      pick(faceRef);
    }
    else if (feat.type === 'DRAFT') {
      if (topo.type === 'FACE' || topo.type === 'PLANE') {
        const ref = {
          id: topo.id, type: topo.type,
          coordinates: topo.coordinates, normal: topo.normal,
          signature: topo.signature,
        };
        if (!feat.parameters?.neutral_plane_refs ||
            feat.parameters.neutral_plane_refs.length === 0) {
          updateFeatureParams(selectedId, { neutral_plane_refs: [ref] });
        } else {
          const current = feat.parameters?.faces_to_draft_refs || [];
          if (!current.some((r: any) => r.id === ref.id)) {
            updateFeatureParams(selectedId, {
              faces_to_draft_refs: [...current, ref],
            });
          }
        }
        pick(ref);
      }
    }
  }, [
    selectedTopology, isSketchMode, selectedId,
    features, updateFeatureParams, setSelectedTopology, handleRebuild,
  ]);
}
