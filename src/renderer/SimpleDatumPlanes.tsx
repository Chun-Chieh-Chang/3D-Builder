import React from 'react';
import { Plane, Html } from '@react-three/drei';
import * as THREE from 'three';

export const SimpleDatumPlanes = React.memo(() => {
  return (
    <group>
      <Plane
        name="FRONT"
        args={[200, 200]}
        position={[0, 0, 0]}
        rotation={[0, 0, 0]}
        visible={true}
      >
        <meshBasicMaterial 
          color="#475569" 
          transparent 
          opacity={0.15} 
          side={THREE.DoubleSide} 
          depthWrite={false}
        />
        <lineSegments>
          <edgesGeometry args={[new THREE.PlaneGeometry(200, 200)]} />
          <lineBasicMaterial color="#475569" />
        </lineSegments>
        <Html position={[100, 100, 0]} center className="pointer-events-none">
          <div className="px-2 py-1 rounded bg-slate-900/80 backdrop-blur-sm border border-slate-700 text-slate-500 text-xs font-mono select-none whitespace-nowrap">
            Front Plane
          </div>
        </Html>
      </Plane>
      
      <Plane
        name="TOP"
        args={[200, 200]}
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={true}
      >
        <meshBasicMaterial 
          color="#475569" 
          transparent 
          opacity={0.15} 
          side={THREE.DoubleSide} 
          depthWrite={false}
        />
        <lineSegments>
          <edgesGeometry args={[new THREE.PlaneGeometry(200, 200)]} />
          <lineBasicMaterial color="#475569" />
        </lineSegments>
        <Html position={[100, 100, 0]} center className="pointer-events-none">
          <div className="px-2 py-1 rounded bg-slate-900/80 backdrop-blur-sm border border-slate-700 text-slate-500 text-xs font-mono select-none whitespace-nowrap">
            Top Plane
          </div>
        </Html>
      </Plane>
      
      <Plane
        name="RIGHT"
        args={[200, 200]}
        position={[0, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
        visible={true}
      >
        <meshBasicMaterial 
          color="#475569" 
          transparent 
          opacity={0.15} 
          side={THREE.DoubleSide} 
          depthWrite={false}
        />
        <lineSegments>
          <edgesGeometry args={[new THREE.PlaneGeometry(200, 200)]} />
          <lineBasicMaterial color="#475569" />
        </lineSegments>
        <Html position={[100, 100, 0]} center className="pointer-events-none">
          <div className="px-2 py-1 rounded bg-slate-900/80 backdrop-blur-sm border border-slate-700 text-slate-500 text-xs font-mono select-none whitespace-nowrap">
            Right Plane
          </div>
        </Html>
      </Plane>
    </group>
  );
});

SimpleDatumPlanes.displayName = 'SimpleDatumPlanes';
