import * as THREE from 'three';
import { useCadStore } from '../store/useCadStore';

export type TopologyType = 'FACE' | 'EDGE' | 'VERTEX';

export interface EdgeSignature {
  length: number;
}

export interface FaceSignature {
  area: number;
  curvature?: string;
  v_count: number;
}

export interface SelectedTopology {
  type: TopologyType;
  id: string;
  coordinates: [number, number, number];
  normal?: [number, number, number];
  signature?: FaceSignature | EdgeSignature;
  edgeData?: {
    start: [number, number, number];
    end: [number, number, number];
  };
}

export class TopologySelector {
  private raycaster: THREE.Raycaster;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private threshold: number = 3.0; // Distance threshold in model units

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.raycaster = new THREE.Raycaster();
    this.scene = scene;
    this.camera = camera;
  }

  /**
   * Helper function to calculate distance from a point to a line segment
   */
  private distanceToSegment(
    p: THREE.Vector3,
    a: THREE.Vector3,
    b: THREE.Vector3,
    outProjection: THREE.Vector3
  ): number {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ap = new THREE.Vector3().subVectors(p, a);
    const abLenSq = ab.lengthSq();
    
    if (abLenSq === 0) {
      outProjection.copy(a);
      return p.distanceTo(a);
    }
    
    let t = ap.dot(ab) / abLenSq;
    t = Math.max(0, Math.min(1, t)); // Clamp to segment bounds
    outProjection.copy(a).addScaledVector(ab, t);
    return p.distanceTo(outProjection);
  }

  /**
   * Select a topology element at NDC coordinates (Normalized Device Coordinates)
   * @param ndcX Normalized X coordinate (-1 to 1)
   * @param ndcY Normalized Y coordinate (-1 to 1)
   * @returns Selected topology or null
   */
  public selectAtPosition(
    ndcX: number,
    ndcY: number,
    preserveIfNoHit: boolean = false,
    filterType: 'ALL' | 'FACE_ONLY' | 'EDGE_ONLY' | 'VERTEX_ONLY' | 'FACE_EDGE' = 'ALL'
  ): SelectedTopology | null {
    // Update raycaster
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    // Intersect recursively with all objects in the scene, then filter for standard B-Rep solid meshes
    const intersects = this.raycaster.intersectObjects(this.scene.children, true)
      .filter(hit => hit.object instanceof THREE.Mesh && hit.object.userData && hit.object.userData.type === 'B_REP_SHAPE');

    if (intersects.length > 0) {
      const hit = intersects[0];
      const mesh = hit.object as THREE.Mesh;
      const geometry = mesh.geometry;

      if (!geometry || !hit.face) return null;

      const positionAttr = geometry.attributes.position;
      const indexAttr = geometry.index;

      if (!positionAttr) return null;

      // Extract vertex indices for the hit face
      const idxA = hit.face.a;
      const idxB = hit.face.b;
      const idxC = hit.face.c;

      // Retrieve world positions of vertices
      const vA = new THREE.Vector3().fromBufferAttribute(positionAttr, idxA).applyMatrix4(mesh.matrixWorld);
      const vB = new THREE.Vector3().fromBufferAttribute(positionAttr, idxB).applyMatrix4(mesh.matrixWorld);
      const vC = new THREE.Vector3().fromBufferAttribute(positionAttr, idxC).applyMatrix4(mesh.matrixWorld);

      const hitPoint = hit.point;

      // 1. VERTEX PICKING
      if (filterType === 'ALL' || filterType === 'VERTEX_ONLY') {
        const distA = hitPoint.distanceTo(vA);
        const distB = hitPoint.distanceTo(vB);
        const distC = hitPoint.distanceTo(vC);

        if (distA < this.threshold) {
          const topology: SelectedTopology = {
            type: 'VERTEX',
            id: `${mesh.uuid}_v_${idxA}`,
            coordinates: [vA.x, vA.y, vA.z],
          };
          useCadStore.getState().setSelectedTopology(topology);
          return topology;
        }
        if (distB < this.threshold) {
          const topology: SelectedTopology = {
            type: 'VERTEX',
            id: `${mesh.uuid}_v_${idxB}`,
            coordinates: [vB.x, vB.y, vB.z],
          };
          useCadStore.getState().setSelectedTopology(topology);
          return topology;
        }
        if (distC < this.threshold) {
          const topology: SelectedTopology = {
            type: 'VERTEX',
            id: `${mesh.uuid}_v_${idxC}`,
            coordinates: [vC.x, vC.y, vC.z],
          };
          useCadStore.getState().setSelectedTopology(topology);
          return topology;
        }
        
        if (filterType === 'VERTEX_ONLY') {
          if (!preserveIfNoHit) useCadStore.getState().setSelectedTopology(null);
          return null;
        }
      }

      // 2. EDGE PICKING
      if (filterType === 'ALL' || filterType === 'EDGE_ONLY' || filterType === 'FACE_EDGE') {
        const projAB = new THREE.Vector3();
        const projBC = new THREE.Vector3();
        const projCA = new THREE.Vector3();

        const distAB = this.distanceToSegment(hitPoint, vA, vB, projAB);
        const distBC = this.distanceToSegment(hitPoint, vB, vC, projBC);
        const distCA = this.distanceToSegment(hitPoint, vC, vA, projCA);

        const minDist = Math.min(distAB, distBC, distCA);

        if (minDist < this.threshold) {
          let selectedEdge: [THREE.Vector3, THREE.Vector3] = [vA, vB];
          let edgeId = `${mesh.uuid}_e_${idxA}_${idxB}`;
          let centerPoint = projAB;

          if (minDist === distBC) {
            selectedEdge = [vB, vC];
            edgeId = `${mesh.uuid}_e_${idxB}_${idxC}`;
            centerPoint = projBC;
          } else if (minDist === distCA) {
            selectedEdge = [vC, vA];
            edgeId = `${mesh.uuid}_e_${idxC}_${idxA}`;
            centerPoint = projCA;
          }

                      const topology: SelectedTopology = {
              type: 'EDGE',
              id: edgeId,
              coordinates: [centerPoint.x, centerPoint.y, centerPoint.z],
              edgeData: {
                start: [selectedEdge[0].x, selectedEdge[0].y, selectedEdge[0].z],
                end: [selectedEdge[1].x, selectedEdge[1].y, selectedEdge[1].z],
              },
              signature: {
                length: selectedEdge[0].distanceTo(selectedEdge[1])
              }
            };
          useCadStore.getState().setSelectedTopology(topology);
          return topology;
        }

        if (filterType === 'EDGE_ONLY') {
          if (!preserveIfNoHit) useCadStore.getState().setSelectedTopology(null);
          return null;
        }
      }

            // 3. FACE PICKING
      if (filterType === 'ALL' || filterType === 'FACE_ONLY' || filterType === 'FACE_EDGE') {
        const metadata = mesh.userData.face_metadata as any[];
        let signature: FaceSignature | undefined;
        
        if (metadata && hit.faceIndex !== undefined) {
            // Map Three.js faceIndex to OCC face using index_range
            // Three.js faceIndex is triangle index. Every 3 indices = 1 triangle.
            // Vert index in geometry.index = faceIndex * 3
            const triangleStartIdx = (hit.faceIndex as number) * 3;
            const vertIdx = geometry.index ? geometry.index.getX(triangleStartIdx) : triangleStartIdx;
            
            const faceMatch = metadata.find(m => vertIdx >= m.index_range[0] && vertIdx < m.index_range[1]);
            if (faceMatch) {
                signature = { area: faceMatch.area, v_count: faceMatch.v_count, curvature: faceMatch.curvature };
            }
        }

        const topology: SelectedTopology = {
          type: 'FACE',
          id: `${mesh.uuid}_f_${hit.faceIndex}`,
          signature,
          coordinates: [hitPoint.x, hitPoint.y, hitPoint.z],
          normal: hit.face.normal
            ? [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z]
            : undefined,
        };

        useCadStore.getState().setSelectedTopology(topology);
        return topology;
      }
    }

    // Clear selection if nothing hit
    if (!preserveIfNoHit) {
      useCadStore.getState().setSelectedTopology(null);
    }
    return null;
  }

  /**
   * Clear current selection
   */
  public clearSelection(): void {
    useCadStore.getState().setSelectedTopology(null);
  }

  /**
   * Get current selection from Zustand
   */
  public getCurrentSelection(): SelectedTopology | null {
    return useCadStore.getState().selectedTopology;
  }
}
