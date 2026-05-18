'use client';

import React, { Suspense, useEffect, useRef, useCallback, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Stage, PerspectiveCamera, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { useCadStore } from '../store/useCadStore';
import { DatumPlanes } from './DatumPlanes';
import { SketchPreview } from './SketchPreview';
import { TopologySelector } from '../kernel/TopologySelector';

const CameraHandler = () => {
  const { activePlane, isSketchMode, cameraNormalTrigger, cameraNormalFlip, controls, setIsCameraAnimating } = useCadStore();
  const { camera } = useThree();
  const lastTriggerRef = useRef(0);

  useEffect(() => {
    const triggerNormal = cameraNormalTrigger > lastTriggerRef.current;
    const oldTrigger = lastTriggerRef.current;
    lastTriggerRef.current = cameraNormalTrigger;

    console.log('[CameraHandler] useEffect fired:', {
      activePlane,
      isSketchMode,
      cameraNormalTrigger,
      oldTrigger,
      triggerNormal,
      controlsPresent: !!controls
    });

    if (!activePlane) return;
    if (!isSketchMode && !triggerNormal) return;

    console.log('[CameraHandler] Triggering camera GSAP animation for plane:', activePlane, 'Flip:', cameraNormalFlip);

    const DISTANCE = 150;
    const dir = cameraNormalFlip ? -1 : 1;
    let targetPos = new THREE.Vector3(DISTANCE, DISTANCE, DISTANCE);
    let upVector = new THREE.Vector3(0, 1, 0);

    if (activePlane === 'FRONT') {
      targetPos.set(0, 0, DISTANCE * dir);
      upVector.set(0, 1, 0); // Y remains up whether looking from front or back
    } else if (activePlane === 'TOP') {
      targetPos.set(0, DISTANCE * dir, 0);
      upVector.set(0, 0, dir === 1 ? -1 : 1); // Z flips up vector direction to maintain Right-Hand Rule
    } else if (activePlane === 'RIGHT') {
      targetPos.set(DISTANCE * dir, 0, 0);
      upVector.set(0, 1, 0); // Y remains up
    }

    // Cancel any active transitions to prevent conflicts
    gsap.killTweensOf(camera.position);
    if (controls) {
      gsap.killTweensOf(controls.target);
    }

    setIsCameraAnimating(true); // Tell React to declaratively disable OrbitControls

    // Animate camera position smoothly
    gsap.to(camera.position, {
      x: targetPos.x,
      y: targetPos.y,
      z: targetPos.z,
      duration: 0.8,
      ease: 'expo.out',
      onUpdate: () => {
        camera.up.copy(upVector);
        camera.lookAt(0, 0, 0);
      },
      onComplete: () => {
        setIsCameraAnimating(false); // Re-enable OrbitControls declaratively
        if (controls) {
          controls.update();
        }
      }
    });

    // Animate orbit target to origin
    if (controls) {
      gsap.to(controls.target, {
        x: 0,
        y: 0,
        z: 0,
        duration: 0.8,
        ease: 'expo.out'
      });
    }
  }, [activePlane, isSketchMode, cameraNormalTrigger, cameraNormalFlip, camera, controls]);

  return null;
};

// Global topology selector instance
let topologySelector: TopologySelector | null = null;

// R3F context initialization helper rendered inside Canvas
const SceneSelector = () => {
  const { scene, camera } = useThree();

  useEffect(() => {
    topologySelector = new TopologySelector(scene, camera);
    console.log('[Viewport] TopologySelector initialized with R3F scene and camera');
    return () => {
      topologySelector = null;
    };
  }, [scene, camera]);

  return null;
};

// Visual feedback and 3D measurement tags renderer
const HighlightRenderer = () => {
  const { selectedTopology, measurementPoints } = useCadStore();

  return (
    <group>
      {/* 1. Highlight currently selected topology element */}
      {selectedTopology && (() => {
        const { type, coordinates, edgeData } = selectedTopology;
        const posVec = new THREE.Vector3(...coordinates);
        
        if (type === 'VERTEX') {
          return (
            <mesh position={posVec}>
              <sphereGeometry args={[1.2, 16, 16]} />
              <meshBasicMaterial color="#EF4444" depthTest={false} transparent opacity={0.9} />
            </mesh>
          );
        } else if (type === 'EDGE' && edgeData) {
          const start = new THREE.Vector3(...edgeData.start);
          const end = new THREE.Vector3(...edgeData.end);
          const points = [start, end];
          const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
          const material = new THREE.LineBasicMaterial({
            color: 0x3b82f6,
            linewidth: 3,
            depthTest: false,
            transparent: true,
            opacity: 0.9,
          });
          const lineObj = new THREE.Line(lineGeometry, material);
          return <primitive object={lineObj} />;
        } else if (type === 'FACE') {
          return (
            <mesh position={posVec}>
              <sphereGeometry args={[1.0, 16, 16]} />
              <meshBasicMaterial color="#10B981" depthTest={false} transparent opacity={0.8} />
            </mesh>
          );
        }
        return null;
      })()}

      {/* 2. Highlight picked measurement markers */}
      {measurementPoints.map((pt, idx) => {
        const pos = new THREE.Vector3(...pt.coordinates);
        return (
          <group key={idx}>
            <mesh position={pos}>
              <sphereGeometry args={[1.0, 16, 16]} />
              <meshBasicMaterial color="#8B5CF6" depthTest={false} />
            </mesh>
            <Html position={pos} distanceFactor={15}>
              <div className="bg-indigo-600 text-white font-bold font-mono px-1 py-0.5 rounded text-[8px] whitespace-nowrap shadow-md pointer-events-none select-none">
                M{idx + 1}
              </div>
            </Html>
          </group>
        );
      })}

      {/* 3. Connecting measurement line */}
      {measurementPoints.length === 2 && (() => {
        const start = new THREE.Vector3(...measurementPoints[0].coordinates);
        const end = new THREE.Vector3(...measurementPoints[1].coordinates);
        const points = [start, end];
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const midPoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        const material = new THREE.LineBasicMaterial({
          color: 0x8b5cf6,
          linewidth: 2,
          depthTest: false,
        });
        const lineObj = new THREE.Line(lineGeometry, material);
        return (
          <group>
            <primitive object={lineObj} />
            <Html position={midPoint} distanceFactor={15}>
              <div className="bg-slate-900/90 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded text-[9px] font-bold font-mono whitespace-nowrap shadow-2xl pointer-events-none select-none">
                📏 {start.distanceTo(end).toFixed(2)} mm
              </div>
            </Html>
          </group>
        );
      })()}
    </group>
  );
};

const FeatureOutlines = () => {
  const { features, selectedId, setSelectedId, isSketchMode } = useCadStore();
  const [hoveredFeatureId, setHoveredFeatureId] = useState<string | null>(null);

  if (isSketchMode || features.length === 0) return null;

  // Helper to determine dependency color inside 3D viewport
  const getDependencyType = (featId: string) => {
    if (!selectedId) return 'NONE';
    const selectedFeature = features.find(f => f.id === selectedId);
    if (!selectedFeature) return 'NONE';

    const targetIdx = features.findIndex(f => f.id === selectedFeature.id);
    const featIdx = features.findIndex(f => f.id === featId);
    if (targetIdx === -1 || featIdx === -1) return 'NONE';

    // Check if parent (featIdx < targetIdx)
    if (featIdx < targetIdx) {
      if (selectedFeature.type === 'EXTRUDE') {
        if (selectedFeature.parameters.operation === 'CUT' && features[featIdx].type === 'EXTRUDE' && features[featIdx].parameters.operation === 'ADD') {
          return 'PARENT';
        }
      } else if (selectedFeature.type === 'FILLET' || selectedFeature.type === 'CHAMFER') {
        const f = features[featIdx];
        if (f.type === 'EXTRUDE' || f.type === 'BOX' || f.type === 'CYLINDER' || f.type === 'SPHERE' || f.type === 'REVOLVE') {
          return 'PARENT';
        }
      } else if (selectedFeature.type === 'REVOLVE') {
        if (features[featIdx].type === 'EXTRUDE' && features[featIdx].parameters.operation === 'ADD') {
          return 'PARENT';
        }
      }
    }

    // Check if child (featIdx > targetIdx)
    if (featIdx > targetIdx) {
      if (selectedFeature.type === 'EXTRUDE' && selectedFeature.parameters.operation === 'ADD') {
        const f = features[featIdx];
        if (f.type === 'EXTRUDE' || f.type === 'FILLET' || f.type === 'CHAMFER' || f.type === 'REVOLVE') {
          return 'CHILD';
        }
      } else if (selectedFeature.type === 'EXTRUDE' && selectedFeature.parameters.operation === 'CUT') {
        const f = features[featIdx];
        if (f.type === 'FILLET' || f.type === 'CHAMFER') {
          return 'CHILD';
        }
      }
    }

    return 'NONE';
  };

  return (
    <group>
      {features.map((feat) => {
        const depType = getDependencyType(feat.id);
        const isSelected = selectedId === feat.id;
        const isHovered = hoveredFeatureId === feat.id;

        let highlightColor = "#60A5FA"; // Default Reference Sky Blue
        let lineWidth = 1.5;
        let opacityVal = 0.4;

        if (isSelected) {
          highlightColor = "#ec4899"; // Magenta
          lineWidth = 4.5;
          opacityVal = 0.9;
        } else if (isHovered) {
          highlightColor = "#f59e0b"; // Amber Gold
          lineWidth = 3.5;
          opacityVal = 0.8;
        } else if (depType === 'PARENT') {
          highlightColor = "#10B981"; // Success Emerald Green
          lineWidth = 3.0;
          opacityVal = 0.75;
        } else if (depType === 'CHILD') {
          highlightColor = "#3B82F6"; // Accent Royal Blue
          lineWidth = 3.0;
          opacityVal = 0.75;
        }

        // 1. EXTRUDE Feature Outline
        if (feat.type === 'EXTRUDE') {
          const params = feat.parameters;
          const hasPoints = params && params.points;
          if (!hasPoints) return null;

          const plane = params.plane || 'TOP';
          const rawPoints = params.points;
          const depth = params.depth || 20.0;

          const get3DPoint = (u: number, v: number, zOffset: number) => {
            if (plane === 'FRONT') return new THREE.Vector3(u, v, zOffset);
            if (plane === 'TOP') return new THREE.Vector3(u, zOffset, v);
            if (plane === 'RIGHT') return new THREE.Vector3(zOffset, u, v);
            return new THREE.Vector3(u, v, zOffset);
          };

          // Base closed loop
          const basePts = rawPoints.map((p: number[]) => get3DPoint(p[0], p[1], 0));
          const baseClosed: [number, number, number][] = basePts.map((p: THREE.Vector3) => [p.x, p.y, p.z]);
          if (basePts.length > 1) {
            baseClosed.push([basePts[0].x, basePts[0].y, basePts[0].z]);
          }

          // Top closed loop
          const topPts = rawPoints.map((p: number[]) => get3DPoint(p[0], p[1], depth));
          const topClosed: [number, number, number][] = topPts.map((p: THREE.Vector3) => [p.x, p.y, p.z]);
          if (topPts.length > 1) {
            topClosed.push([topPts[0].x, topPts[0].y, topPts[0].z]);
          }

          return (
            <group key={feat.id}>
              {/* Base Loop */}
              <Line points={baseClosed} color={highlightColor} lineWidth={lineWidth} transparent opacity={opacityVal} />
              {/* Top Loop */}
              <Line points={topClosed} color={highlightColor} lineWidth={lineWidth} transparent opacity={opacityVal} />
              {/* Corner Connectors */}
              {basePts.map((pt: THREE.Vector3, idx: number) => {
                const tPt = topPts[idx];
                if (!tPt) return null;
                return (
                  <Line
                    key={idx}
                    points={[[pt.x, pt.y, pt.z], [tPt.x, tPt.y, tPt.z]]}
                    color={highlightColor}
                    lineWidth={lineWidth}
                    transparent
                    opacity={opacityVal}
                  />
                );
              })}
              
              {/* Transparent Click Receiver Meshes (around extrusion boundary) */}
              {basePts.map((pt: THREE.Vector3, idx: number) => {
                const nextPt = basePts[(idx + 1) % basePts.length];
                const tPt = topPts[idx];
                if (!nextPt || !tPt) return null;

                // Center of the side panel face
                const midX = (pt.x + nextPt.x + tPt.x + topPts[(idx + 1) % basePts.length].x) / 4;
                const midY = (pt.y + nextPt.y + tPt.y + topPts[(idx + 1) % basePts.length].y) / 4;
                const midZ = (pt.z + nextPt.z + tPt.z + topPts[(idx + 1) % basePts.length].z) / 4;

                return (
                  <mesh
                    key={`receiver_${idx}`}
                    position={[midX, midY, midZ]}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(feat.id);
                    }}
                    onPointerOver={(e) => {
                      e.stopPropagation();
                      setHoveredFeatureId(feat.id);
                    }}
                    onPointerOut={() => {
                      setHoveredFeatureId(null);
                    }}
                  >
                    <sphereGeometry args={[2.5, 8, 8]} />
                    <meshBasicMaterial opacity={0} transparent />
                  </mesh>
                );
              })}
            </group>
          );
        }

        // 2. REVOLVE Feature Outline
        if (feat.type === 'REVOLVE') {
          const params = feat.parameters;
          const points = params.points;
          if (!points || points.length === 0) return null;

          const get3DPoint = (u: number, v: number) => {
            return new THREE.Vector3(u, v, 0);
          };

          const outlinePoints: [number, number, number][] = points.map((p: number[]) => {
            const pt = get3DPoint(p[0], p[1]);
            return [pt.x, pt.y, pt.z];
          });

          return (
            <group key={feat.id}>
              <Line points={outlinePoints} color={highlightColor} lineWidth={lineWidth} />
              <Line
                points={outlinePoints}
                color="#000000"
                lineWidth={15}
                opacity={0}
                transparent
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(feat.id);
                }}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setHoveredFeatureId(feat.id);
                }}
                onPointerOut={() => {
                  setHoveredFeatureId(null);
                }}
              />
            </group>
          );
        }

        // 3. BOX Feature Outline
        if (feat.type === 'BOX') {
          const { width: w = 10, height: h = 10, depth: d = 10, x = 0, y = 0, z = 0 } = feat.parameters;
          return (
            <group key={feat.id}>
              <lineSegments position={[x + w/2, y + h/2, z + d/2]}>
                <edgesGeometry args={[new THREE.BoxGeometry(w, h, d)]} />
                <lineBasicMaterial color={highlightColor} linewidth={isSelected ? 3 : 1.5} />
              </lineSegments>
              <mesh
                position={[x + w/2, y + h/2, z + d/2]}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(feat.id);
                }}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setHoveredFeatureId(feat.id);
                }}
                onPointerOut={() => {
                  setHoveredFeatureId(null);
                }}
              >
                <boxGeometry args={[w, h, d]} />
                <meshBasicMaterial opacity={0} transparent />
              </mesh>
            </group>
          );
        }

        // 4. CYLINDER Feature Outline
        if (feat.type === 'CYLINDER') {
          const { radius: r = 5, height: h = 10, x = 0, y = 0, z = 0 } = feat.parameters;
          return (
            <group key={feat.id} position={[x, y, z + h/2]} rotation={[Math.PI / 2, 0, 0]}>
              <lineSegments>
                <edgesGeometry args={[new THREE.CylinderGeometry(r, r, h, 16)]} />
                <lineBasicMaterial color={highlightColor} linewidth={isSelected ? 3 : 1.5} />
              </lineSegments>
              <mesh
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(feat.id);
                }}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setHoveredFeatureId(feat.id);
                }}
                onPointerOut={() => {
                  setHoveredFeatureId(null);
                }}
              >
                <cylinderGeometry args={[r, r, h, 16]} />
                <meshBasicMaterial opacity={0} transparent />
              </mesh>
            </group>
          );
        }

        // 5. SPHERE Feature Outline
        if (feat.type === 'SPHERE') {
          const { radius: r = 5, x = 0, y = 0, z = 0 } = feat.parameters;
          return (
            <group key={feat.id} position={[x, y, z]}>
              <lineSegments>
                <edgesGeometry args={[new THREE.SphereGeometry(r, 16, 16)]} />
                <lineBasicMaterial color={highlightColor} linewidth={isSelected ? 3 : 1.5} />
              </lineSegments>
              <mesh
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(feat.id);
                }}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setHoveredFeatureId(feat.id);
                }}
                onPointerOut={() => {
                  setHoveredFeatureId(null);
                }}
              >
                <sphereGeometry args={[r, 16, 16]} />
                <meshBasicMaterial opacity={0} transparent />
              </mesh>
            </group>
          );
        }

        // 6. FILLET or CHAMFER Outline
        if (feat.type === 'FILLET' || feat.type === 'CHAMFER') {
          const { edge_start, edge_end } = feat.parameters;
          if (!edge_start || !edge_end) return null;

          const start = new THREE.Vector3(...edge_start);
          const end = new THREE.Vector3(...edge_end);

          return (
            <group key={feat.id}>
              <Line
                points={[[start.x, start.y, start.z], [end.x, end.y, end.z]]}
                color={highlightColor}
                lineWidth={isSelected ? 5.5 : isHovered ? 4.5 : 2.5}
              />
              <Line
                points={[[start.x, start.y, start.z], [end.x, end.y, end.z]]}
                color="#000000"
                lineWidth={15}
                opacity={0}
                transparent
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(feat.id);
                }}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setHoveredFeatureId(feat.id);
                }}
                onPointerOut={() => {
                  setHoveredFeatureId(null);
                }}
              />
            </group>
          );
        }

        return null;
      })}
    </group>
  );
};

interface ViewportProps {
  children?: React.ReactNode;
}

export default function Viewport({ children }: ViewportProps) {
  const { isSketchMode, features, setControls, isCameraAnimating } = useCadStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Handle topology selection click
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isSketchMode) return; // Don't select topology during sketching
    
    // Get mouse position
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    
    if (topologySelector) {
      const selected = topologySelector.selectAtPosition(ndcX, ndcY);
      console.log('[Topology] Click at NDC:', ndcX, ndcY, 'Selected:', selected);
    }
  }, [isSketchMode, canvasRef]);

  return (
    <div className="w-full h-full bg-linear-to-b from-[#FFFFFF] to-[#C8D2DF] relative">
      <Canvas 
        shadows 
        dpr={[1, 2]} 
        ref={canvasRef}
        onClick={handleCanvasClick}
      >
        <CameraHandler />
        <SceneSelector />
        <PerspectiveCamera makeDefault position={[100, 100, 100]} fov={45} />
        <Suspense fallback={null}>
          <Stage environment="city" intensity={0.5}>
            <DatumPlanes />
            <SketchPreview />
            <HighlightRenderer />
            <FeatureOutlines />

            {children || (
              <mesh>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color="#60A5FA" />
              </mesh>
            )}
          </Stage>
        </Suspense>
        <Grid
          infiniteGrid
          fadeDistance={50}
          fadeStrength={5}
          cellSize={1}
          sectionSize={5}
          sectionColor="#94A3B8"
          cellColor="#CBD5E1"
        />
        <OrbitControls 
          ref={(ref) => {
            if (ref) setControls(ref);
          }}
          makeDefault 
          enableRotate={!isSketchMode}
          enabled={!isCameraAnimating}
          enableDamping={!isCameraAnimating}
        />
      </Canvas>

      <div className="absolute top-4 left-4 glass-effect p-2 rounded-lg text-xs font-mono text-slate-700 pointer-events-none">
        VIEWPORT: {isSketchMode ? 'SKETCHING MODE (LOCKED)' : 'PERSPECTIVE'}
      </div>
    </div>
  );
}
