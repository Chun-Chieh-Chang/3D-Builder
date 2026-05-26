/**
 * Topology Mapping Utility
 * Maps Three.js objects to OCCT TopoDS entities
 * 
 * This utility provides bidirectional mapping between:
 * - Three.js Mesh/Face/Edge/Vertex and OCCT TopoDS_Face/TopoDS_Edge/TopoDS_Vertex
 */

import * as THREE from 'three';

/**
 * Map Three.js face normal to OCCT direction
 */
export function mapFaceNormalToOCCT(normal: THREE.Vector3): [number, number, number] {
  return [normal.x, normal.y, normal.z];
}

/**
 * Map Three.js vertex position to OCCT point
 */
export function mapVertexToOCCT(point: THREE.Vector3): [number, number, number] {
  return [point.x, point.y, point.z];
}

/**
 * Map OCCT direction to Three.js Vector3
 */
export function mapOCCTToVector3(dir: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(dir[0], dir[1], dir[2]);
}

/**
 * Map OCCT point to Three.js Vector3
 */
export function mapOCCTPointToVector3(point: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(point[0], point[1], point[2]);
}

/**
 * Calculate face area from Three.js geometry
 * Uses OCCT BRepGProp_Face equivalent logic
 */
export function calculateFaceArea(geometry: THREE.BufferGeometry): number {
  // Simplified calculation - in production, use OCCT BRepGProp_Face
  const positionAttribute = geometry.attributes.position;
  let area = 0;
  
  for (let i = 0; i < positionAttribute.count; i += 3) {
    const v1 = new THREE.Vector3(
      positionAttribute.getX(i),
      positionAttribute.getY(i),
      positionAttribute.getZ(i)
    );
    const v2 = new THREE.Vector3(
      positionAttribute.getX(i + 1),
      positionAttribute.getY(i + 1),
      positionAttribute.getZ(i + 1)
    );
    const v3 = new THREE.Vector3(
      positionAttribute.getX(i + 2),
      positionAttribute.getY(i + 2),
      positionAttribute.getZ(i + 2)
    );
    
    // Calculate triangle area: 0.5 * |(v2-v1) × (v3-v1)|
    const edge1 = new THREE.Vector3().subVectors(v2, v1);
    const edge2 = new THREE.Vector3().subVectors(v3, v1);
    const cross = new THREE.Vector3().crossVectors(edge1, edge2);
    area += cross.length() * 0.5;
  }
  
  return area;
}

/**
 * Calculate edge length from Three.js geometry
 * Uses OCCT GProp_Edge equivalent logic
 */
export function calculateEdgeLength(
  start: THREE.Vector3,
  end: THREE.Vector3
): number {
  return start.distanceTo(end);
}

/**
 * Map Three.js mesh UUID to OCCT shape ID
 * This is a placeholder - in production, you'd use OCCT's TopoDS_Shape::HashCode()
 */
export function mapMeshToShapeUUID(meshUUID: string): string {
  // In production, this would map to OCCT TopoDS_Shape hash code
  return `occt_shape_${meshUUID}`;
}

/**
 * Map OCCT TopoDS_Face to Three.js face index
 * This requires raycasting and face normal comparison
 */
export function mapOCCTFaceToThreeFace(
  faceNormal: [number, number, number],
  geometry: THREE.BufferGeometry
): number | null {
  const normal = new THREE.Vector3(faceNormal[0], faceNormal[1], faceNormal[2]);
  const positionAttribute = geometry.attributes.position;
  
  // Find the face with matching normal
  for (let i = 0; i < positionAttribute.count; i += 3) {
    const v1 = new THREE.Vector3(
      positionAttribute.getX(i),
      positionAttribute.getY(i),
      positionAttribute.getZ(i)
    );
    const v2 = new THREE.Vector3(
      positionAttribute.getX(i + 1),
      positionAttribute.getY(i + 1),
      positionAttribute.getZ(i + 1)
    );
    const v3 = new THREE.Vector3(
      positionAttribute.getX(i + 2),
      positionAttribute.getY(i + 2),
      positionAttribute.getZ(i + 2)
    );
    
    const edge1 = new THREE.Vector3().subVectors(v2, v1);
    const edge2 = new THREE.Vector3().subVectors(v3, v1);
    const calculatedNormal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
    
    if (calculatedNormal.dot(normal) > 0.99) {
      return i / 3;
    }
  }
  
  return null;
}
