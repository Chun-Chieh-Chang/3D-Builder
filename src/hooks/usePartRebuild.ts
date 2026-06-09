'use client';

import { useCallback, useRef } from 'react';
import { useCadStore } from '@/store/useCadStore';
import { HeavyEngineClient, RebuildError } from '@/kernel/HeavyEngineClient';
import { formatCadErrorMessage, formatFeatureWarnings } from '@/utils/cad-error-messages';
import { featureTreeFingerprint } from '@/utils/rebuild-fingerprint';
import type { CADFeature } from '@/store/useCadStore';
import { EquationEngine } from '@/utils/EquationEngine';

export function usePartRebuild(
  features: CADFeature[],
  setMeshData: (data: unknown[]) => void,
  setLoading: (v: boolean) => void,
  setEngineStatus: (s: 'CONNECTED' | 'DISCONNECTED') => void,
) {
  const client = HeavyEngineClient.getInstance();
  const rebuildController = useRef<AbortController | null>(null);
  const lastRebuildFingerprint = useRef<string | null>(null);

  const handleRebuild = useCallback(async () => {
    const {
      isSketchMode,
      editingFeatureId,
      rollbackIndex,
      rebuildDirty,
      clearRebuildDirty,
      dirtyFromFeatureIndex,
    } = useCadStore.getState();

    let activeFeatures = features.filter(f => !f.isSuppressed);

    if (rollbackIndex !== null) {
      // Find the index in the original features to correctly slice the filtered ones
      activeFeatures = features.slice(0, rollbackIndex + 1).filter(f => !f.isSuppressed);
    }

    if (isSketchMode && editingFeatureId) {
      const index = features.findIndex((f) => f.id === editingFeatureId);
      if (index !== -1) {
        activeFeatures = features.slice(0, index).filter(f => !f.isSuppressed);
      }
    }

    const { evaluatedVariables } = useCadStore.getState();
    const evaluatedFeatures = activeFeatures.map(f => {
      const p = { ...f.parameters };
      Object.keys(p).forEach(key => {
        const val = p[key];
        if (typeof val === 'string' && val.startsWith('=')) {
          p[key] = EquationEngine.evaluate(val.substring(1), evaluatedVariables);
        }
      });
      return { ...f, parameters: p };
    });

    if (evaluatedFeatures.length === 0) {
      setMeshData([]);
      lastRebuildFingerprint.current = '';
      clearRebuildDirty();
      return;
    }

    const fingerprint = featureTreeFingerprint(evaluatedFeatures);
    if (!rebuildDirty && fingerprint === lastRebuildFingerprint.current) {
      return;
    }

    rebuildController.current?.abort();
    rebuildController.current = new AbortController();
    const signal = rebuildController.current.signal;

    const fromFeatureIndex =
      dirtyFromFeatureIndex >= Number.MAX_SAFE_INTEGER
        ? 0
        : Math.min(dirtyFromFeatureIndex, activeFeatures.length - 1);

    setLoading(true);
    try {
      const isAlive = await client.checkHealth();
      setEngineStatus(isAlive ? 'CONNECTED' : 'DISCONNECTED');

      if (!isAlive) {
        useCadStore.getState().pushToast(
          '幾何核心未連線，無法重建 B-Rep。請啟動後端服務（埠 8400）。',
          'warning',
        );
        return;
      }

      const results = await client.rebuild(evaluatedFeatures, 0.01, signal, {
        fromFeatureIndex,
        featureFingerprint: fingerprint,
      });

      if (results && Array.isArray(results)) {
        if (results.length === 0 && activeFeatures.length > 0) {
          useCadStore.getState().pushToast(
            '重建未產生幾何。請檢查草圖是否封閉、特徵參數是否有效。',
            'error',
          );
        } else {
          const warnings = results.flatMap((r) => r?.warnings ?? []);
          const warnMsg = formatFeatureWarnings(warnings);
          if (warnMsg) {
            useCadStore.getState().pushToast(warnMsg, 'warning');
          }
        }
        setMeshData(results);

        // Update Reference Geometry
        const allRefGeo = results.flatMap((r: any) => r.ref_geometry || []);
        
        const formattedPlanes = allRefGeo.filter((g: any) => g.type === 'PLANE').map((p: any) => {
          const featName = features.find(f => f.id === p.id)?.name || p.id;
          return {
            id: p.id,
            name: featName,
            origin: p.data.origin,
            normal: p.data.normal,
            xDir: p.data.xDir,
            yDir: p.data.yDir
          };
        });
        useCadStore.getState().setReferencePlanes(formattedPlanes);

        const formattedAxes = allRefGeo.filter((g: any) => g.type === 'AXIS').map((a: any) => {
          const featName = features.find(f => f.id === a.id)?.name || a.id;
          return {
            id: a.id,
            name: featName,
            origin: a.data.origin,
            direction: a.data.direction
          };
        });
        useCadStore.getState().setReferenceAxes(formattedAxes);

        const formattedPoints = allRefGeo.filter((g: any) => g.type === 'POINT').map((p: any) => {
          const featName = features.find(f => f.id === p.id)?.name || p.id;
          return {
            id: p.id,
            name: featName,
            origin: p.data.origin
          };
        });
        useCadStore.getState().setReferencePoints(formattedPoints);

        lastRebuildFingerprint.current = fingerprint;
        clearRebuildDirty();
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[API] Rebuild request failed:', err);
        const detail = err instanceof RebuildError ? err.detail : (err as Error).message;
        useCadStore.getState().pushToast(formatCadErrorMessage(detail || ''), 'error');
        setEngineStatus('DISCONNECTED');
      }
    } finally {
      setLoading(false);
    }
  }, [features, setMeshData, setLoading, setEngineStatus, client]);

  const resetRebuildCache = useCallback(() => {
    lastRebuildFingerprint.current = null;
  }, []);

  const abortRebuild = useCallback(() => {
    if (rebuildController.current) {
      rebuildController.current.abort();
    }
    setLoading(false);
  }, [setLoading]);

  return { handleRebuild, resetRebuildCache, abortRebuild, lastRebuildFingerprint };
}
