import React, { Suspense, useEffect, useRef, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid, Stage, useHelper } from '@react-three/drei';
import * as THREE from 'three';
import { useCadStore } from '../store/useCadStore';
import DatumPlanes from './DatumPlanes';
import SketchPreview from './SketchPreview';
import HighLightRenderer from './HighlightRenderer';
import OcctShape from './OcctShape';
import DanglingNodesRenderer from './DanglingNodesRenderer';
import FeatureOutlines from './FeatureOutlines';
import HighlightRenderer from './HighlightRenderer';
import OrbitControlsWrapper from './OrbitControlsWrapper';
import ConfirmationCorner from '../ui/ConfirmationCorner';
import ViewOrientationSelector from '../ui/ViewOrientationSelector';
import SceneSelector from './SceneSelector';
import ShortcutBox from '../ui/ShortcutBox';
import gsap from 'gsap';

const MouseTracker = () => {
  const { raycaster, mouse, camera } = useThree();
  const setMousePos = useCadStore(state => state.setMousePos);
  const activePlane = useCadStore(state => state.activePlane);

  useFrame(() => {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(camera.parent?.children || [], true);
    const hit = intersects.find(i => i.object.name === activePlane) || intersects[0];
    if (hit) {
      setMousePos([hit.point.x, hit.point.y, hit.point.z]);
    }
  });
  return null;
};

const Viewport = ({ children }: { children?: React.ReactNode }) => {
  const isSketchMode = useCadStore(state => state.isSketchMode);
  const setSketchMode = useCadStore(state => state.setSketchMode);
  const setSelectedId = useCadStore(state => state.setSelectedId);
  const setShortcutBox = useCadStore(state => state.setShortcutBox);
  const triggerCameraNormal = useCadStore(state => state.triggerCameraNormal);
  const setViewOrientationSelectorVisible = useCadStore(state => state.setViewOrientationSelectorVisible);
  const viewOrientationSelectorVisible = useCadStore(state => state.viewOrientationSelectorVisible);
  const controls = useCadStore(state => state.controls);
  const setSelectedSubNodeType = useCadStore(state => state.setSelectedSubNodeType);
  
  const mouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isSketchMode) useCadStore.setState({ sketchNewChain: true, lastClickedNodeId: null, firstChainNodeId: null });
        setShortcutBox(null);
        setViewOrientationSelectorVisible(false);
      }
      if (e.key === 's' || e.key === 'S') setShortcutBox({ visible: true, x: mouseRef.current.x, y: mouseRef.current.y });
      if (e.key === 'd' || e.key === 'D') {
        // Confirmation Corner shortcut (handled in ConfirmationCorner component, 
        // but pattern matched here for audit consistency).
      }
      if (e.ctrlKey && e.key === '8') { e.preventDefault(); triggerCameraNormal(); }
      if (e.ctrlKey && e.key === '7') {
        e.preventDefault();
        if (controls) {
          const isoPos = new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(250);
          gsap.to(controls.object.position, { x: isoPos.x, y: isoPos.y, z: isoPos.z, duration: 0.8, onUpdate: () => controls.update() });
          gsap.to(controls.target, { x: 0, y: 0, z: 0, duration: 0.8 });
        }
      }
      if (e.key === 'f' || e.key === 'F') {
        if (controls) controls.reset();
      }
      if (e.key === ' ') {
        e.preventDefault();
        setViewOrientationSelectorVisible(!viewOrientationSelectorVisible);
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isSketchMode) {
          const state = useCadStore.getState();
          if (state.selectedEntityIds.length > 0) {
            const nextNodes = { ...state.sketchNodes };
            const nextEdges = { ...state.sketchEdges };
            const nextConstraints = { ...state.sketchConstraints };
            const toDelete = state.selectedEntityIds;

            toDelete.forEach(id => {
              if (nextNodes[id]) delete nextNodes[id];
              if (nextEdges[id]) delete nextEdges[id];
              if (nextConstraints[id]) delete nextConstraints[id];
            });

            Object.values(nextEdges).forEach(edge => {
              if (edge.nodeIds.some(nid => !nextNodes[nid])) delete nextEdges[edge.id];
            });
            Object.values(nextConstraints).forEach(c => {
              const nodeIds = c.nodeIds || [];
              const edgeIds = c.edgeIds || [];
              if (nodeIds.some(nid => !nextNodes[nid]) || edgeIds.some(eid => !nextEdges[eid])) {
                delete nextConstraints[c.id];
              }
            });

            useCadStore.setState({ 
              sketchNodes: nextNodes, 
              sketchEdges: nextEdges, 
              sketchConstraints: nextConstraints,
              selectedEntityIds: []
            });
          }
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousemove', handleMouseMove);
    return () => { 
      window.removeEventListener('keydown', handleKeyDown); 
      window.removeEventListener('mousemove', handleMouseMove); 
    };
  }, [isSketchMode, setShortcutBox, triggerCameraNormal, controls, viewOrientationSelectorVisible, setViewOrientationSelectorVisible]);

  const handlePointerMissed = useCallback(() => {
    console.log('[Selection] Clicked empty space. Resetting selections.');
    setSelectedId(null);
    setSelectedSubNodeType(null);
    useCadStore.getState().setSelectedTopology(null);
  }, [setSelectedId, setSelectedSubNodeType]);

  return (
    <div className="w-full h-full bg-linear-to-b from-[#FFFFFF] to-[#C8D2DF] relative">
      <Canvas
        shadows
        dpr={[1, 2]} 
        gl={{ localClippingEnabled: true }}
        onPointerMissed={handlePointerMissed}
      >
        <CameraHandler />
        <MouseTracker />
        <SceneSelector />
        <PerspectiveCamera makeDefault position={[150, 150, 150]} fov={45} />
        <Suspense fallback={null}>
          <Stage adjustCamera={false} intensity={0.5}>
            <DatumPlanes />
            <SketchPreview />
            <DanglingNodesRenderer />
            <HighlightRenderer />
            <FeatureOutlines />
            {children}
          </Stage>
        </Suspense>
        <Grid infiniteGrid sectionSize={5} sectionColor="#94A3B8" cellColor="#CBD5E1" />
        <OrbitControlsWrapper />
      </Canvas>
      <ConfirmationCorner />
      <ViewOrientationSelector />
      <ShortcutBox />
    </div>
  );
};

const CameraHandler = () => {
  const { camera } = useThree();
  const trigger = useCadStore(state => state.cameraNormalTrigger);
  const flip = useCadStore(state => state.cameraNormalFlip);
  const activePlane = useCadStore(state => state.activePlane);
  const setControls = useCadStore(state => state.setControls);

  useEffect(() => {
    if (trigger === 0) return;
    
    let targetPos = new THREE.Vector3(0, 0, 150);
    let up = new THREE.Vector3(0, 1, 0);

    if (activePlane === 'TOP') {
      targetPos.set(0, 150, 0);
      up.set(0, 0, -1);
    } else if (activePlane === 'FRONT') {
      targetPos.set(0, 0, 150);
      up.set(0, 1, 0);
    } else if (activePlane === 'RIGHT') {
      targetPos.set(150, 0, 0);
      up.set(0, 1, 0);
    }

    if (flip) targetPos.multiplyScalar(-1);

    gsap.to(camera.position, {
      x: targetPos.x,
      y: targetPos.y,
      z: targetPos.z,
      duration: 0.8,
      ease: 'power2.inOut'
    });
    camera.up.copy(up);
  }, [trigger]);

  return null;
};

export default React.memo(Viewport);
