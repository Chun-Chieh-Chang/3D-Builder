'use client';

import { useEffect, useCallback } from 'react';
import { useCadStore } from '../store/useCadStore';
import { sketchActions } from '../store/sketchActions';
import { onFileOpen, onSaveRequest, onNewFile, appAPI, fileAPI } from '../../electron/renderer';

export const useAppIntegrations = (
  loadCadData: (content: string, path: string) => void,
  handleSaveProject: () => void,
  handlePrintToPDF: () => void
) => {
  const {
    isSketchMode,
    setSketchTool,
    setSketchNewChain,
    setSketchNodes,
    setSketchEdges,
    setSketchConstraints,
    setSelectedEntityIds,
    setShortcutBox,
    setPendingFeatureCommand,
    setSelectedTopology,
    setHint,
    sketchNodes,
    sketchEdges,
    sketchConstraints,
    selectedEntityIds,
  } = useCadStore();

  // Electron Native Integration
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) return;

    const unsubs = [
      onFileOpen(async (path) => {
        const result = await fileAPI.read(path);
        if (result.success && result.content) {
          loadCadData(result.content, path);
        }
      }),
      onSaveRequest(async () => {
        handleSaveProject();
      }),
      onNewFile(() => {
        if (confirm('Create new project? All unsaved changes will be lost.')) {
          useCadStore.setState({ 
            features: [], 
            projectName: 'New Project',
            meshData: [],
            selectedId: null,
            components: [],
            mates: []
          });
          appAPI.notify('New Project', 'Workspace cleared');
        }
      })
    ];

    return () => unsubs.forEach(unsub => unsub());
  }, [loadCadData, handleSaveProject]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (!isSketchMode) return;
      if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      const key = e.key.toLowerCase();
      if (key === 'l') {
        setSketchTool('SELECT');
      } else if (key === 'a') {
        setSketchTool('ARC');
      } else if (e.key === 'Escape') {
        setSketchNewChain(true);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEntityIds.length > 0) {
          e.preventDefault();
          sketchActions.deleteEntities(selectedEntityIds);
          setSelectedEntityIds([]);
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      (window as any)._lastClientX = e.clientX;
      (window as any)._lastClientY = e.clientY;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useCadStore.getState().pendingFeatureCommand) {
        if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
        e.preventDefault();
        setPendingFeatureCommand(null);
        setSelectedTopology(null);
        setHint('Ready');
        return;
      }
      if (e.key.toLowerCase() === 's') {
        if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
        e.preventDefault();
        setShortcutBox({
          visible: true,
          x: (window as any)._lastClientX || window.innerWidth / 2,
          y: (window as any)._lastClientY || window.innerHeight / 2
        });
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    isSketchMode, setSketchTool, setSketchNewChain, selectedEntityIds, 
    sketchNodes, sketchEdges, sketchConstraints, setSketchNodes, 
    setSketchEdges, setSketchConstraints, setSelectedEntityIds,
    setShortcutBox, setPendingFeatureCommand, setSelectedTopology, setHint
  ]);
};
