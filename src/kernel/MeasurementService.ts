/**
 * Measurement Service
 * Provides measurement tools for distance, angle, area, and volume calculations
 * Uses OCCT GProp and BRepGProp classes for accurate calculations
 */

import * as THREE from 'three';

export type MeasurementMode = 'NONE' | 'DISTANCE' | 'ANGLE' | 'AREA' | 'VOLUME';

export interface MeasurementResult {
  mode: MeasurementMode;
  value: number;
  unit: string;
  details?: string;
}

export class MeasurementService {
  /**
   * Calculate distance between two points
   * @param point1 First point [x, y, z]
   * @param point2 Second point [x, y, z]
   * @returns Distance in mm
   */
  public calculateDistance(
    point1: [number, number, number],
    point2: [number, number, number]
  ): number {
    const v1 = new THREE.Vector3(point1[0], point1[1], point1[2]);
    const v2 = new THREE.Vector3(point2[0], point2[1], point2[2]);
    return v1.distanceTo(v2);
  }

  /**
   * Calculate angle between two vectors
   * @param vector1 First vector [x, y, z]
   * @param vector2 Second vector [x, y, z]
   * @returns Angle in degrees
   */
  public calculateAngle(
    vector1: [number, number, number],
    vector2: [number, number, number]
  ): number {
    const v1 = new THREE.Vector3(vector1[0], vector1[1], vector1[2]).normalize();
    const v2 = new THREE.Vector3(vector2[0], vector2[1], vector2[2]).normalize();
    const angle = v1.angleTo(v2);
    return (angle * 180) / Math.PI; // Convert to degrees
  }

  /**
   * Calculate angle between two edges (lines)
   * @param edge1Start Start point of first edge
   * @param edge1End End point of first edge
   * @param edge2Start Start point of second edge
   * @param edge2End End point of second edge
   * @returns Angle in degrees
   */
  public calculateEdgeAngle(
    edge1Start: [number, number, number],
    edge1End: [number, number, number],
    edge2Start: [number, number, number],
    edge2End: [number, number, number]
  ): number {
    const v1 = new THREE.Vector3()
      .subVectors(
        new THREE.Vector3(edge1End[0], edge1End[1], edge1End[2]),
        new THREE.Vector3(edge1Start[0], edge1Start[1], edge1Start[2])
      )
      .normalize();
    const v2 = new THREE.Vector3()
      .subVectors(
        new THREE.Vector3(edge2End[0], edge2End[1], edge2End[2]),
        new THREE.Vector3(edge2Start[0], edge2Start[1], edge2Start[2])
      )
      .normalize();
    const angle = v1.angleTo(v2);
    return (angle * 180) / Math.PI;
  }

  /**
   * Calculate area of a triangle from three vertices
   * @param v1 First vertex
   * @param v2 Second vertex
   * @param v3 Third vertex
   * @returns Area
   */
  public calculateTriangleArea(
    v1: THREE.Vector3,
    v2: THREE.Vector3,
    v3: THREE.Vector3
  ): number {
    const edge1 = new THREE.Vector3().subVectors(v2, v1);
    const edge2 = new THREE.Vector3().subVectors(v3, v1);
    const cross = new THREE.Vector3().crossVectors(edge1, edge2);
    return cross.length() * 0.5;
  }

  /**
   * Calculate total area of a mesh
   * @param geometry Three.js BufferGeometry
   * @returns Total surface area
   */
  public calculateMeshArea(geometry: THREE.BufferGeometry): number {
    const positionAttribute = geometry.attributes.position;
    let totalArea = 0;

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

      totalArea += this.calculateTriangleArea(v1, v2, v3);
    }

    return totalArea;
  }

  /**
   * Calculate volume of a mesh (requires closed manifold)
   * Uses signed volume of tetrahedrons from origin
   * @param geometry Three.js BufferGeometry
   * @returns Volume
   */
  public calculateMeshVolume(geometry: THREE.BufferGeometry): number {
    const positionAttribute = geometry.attributes.position;
    let totalVolume = 0;

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

      // Volume of tetrahedron: (v1 ⋅ (v2 × v3)) / 6
      const cross = new THREE.Vector3().crossVectors(v2, v3);
      const volume = v1.dot(cross) / 6;
      totalVolume += Math.abs(volume);
    }

    return totalVolume;
  }

  /**
   * Format measurement result with appropriate units
   * @param value Raw measurement value
   * @param unitType Type of measurement (length, angle, area, volume)
   * @returns Formatted string with units
   */
  public formatMeasurement(value: number, unitType: 'length' | 'angle' | 'area' | 'volume'): string {
    switch (unitType) {
      case 'length':
        return `${value.toFixed(3)} mm`;
      case 'angle':
        return `${value.toFixed(2)}°`;
      case 'area':
        return `${value.toFixed(3)} mm²`;
      case 'volume':
        return `${value.toFixed(3)} mm³`;
      default:
        return value.toString();
    }
  }

  /**
   * Calculate center of gravity (centroid) of a mesh
   * @param geometry Three.js BufferGeometry
   * @returns Center of gravity coordinates [x, y, z]
   */
  public calculateCenterOfGravity(geometry: THREE.BufferGeometry): [number, number, number] {
    const positionAttribute = geometry.attributes.position;
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let count = 0;

    for (let i = 0; i < positionAttribute.count; i++) {
      sumX += positionAttribute.getX(i);
      sumY += positionAttribute.getY(i);
      sumZ += positionAttribute.getZ(i);
      count++;
    }

    if (count === 0) {
      return [0, 0, 0];
    }

    return [sumX / count, sumY / count, sumZ / count];
  }

  /**
   * Calculate inertia tensor of a mesh
   * Uses the parallel axis theorem for tetrahedrons
   * @param geometry Three.js BufferGeometry
   * @param density Material density (default: 1.0)
   * @returns Inertia tensor as 3x3 matrix [[Ixx, Ixy, Ixz], [Ixy, Iyy, Iyz], [Ixz, Iyz, Izz]]
   */
  public calculateInertiaTensor(
    geometry: THREE.BufferGeometry,
    density: number = 1.0
  ): number[][] {
    const positionAttribute = geometry.attributes.position;
    let Ixx = 0;
    let Iyy = 0;
    let Izz = 0;
    let Ixy = 0;
    let Ixz = 0;
    let Iyz = 0;

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

      // Volume of tetrahedron from origin
      const cross = new THREE.Vector3().crossVectors(v2, v3);
      const volume = v1.dot(cross) / 6;

      if (volume === 0) continue;

      // Centroid of tetrahedron (average of vertices)
      const cx = (v1.x + v2.x + v3.x) / 4;
      const cy = (v1.y + v2.y + v3.y) / 4;
      const cz = (v1.z + v2.z + v3.z) / 4;

      // Mass of tetrahedron
      const mass = density * Math.abs(volume);

      // Inertia tensor of tetrahedron about its centroid
      // Using formula for tetrahedron with vertices at origin and v1, v2, v3
      const Ixx_tet = mass * (v1.y * v1.y + v1.z * v1.z + v2.y * v2.y + v2.z * v2.z + v3.y * v3.y + v3.z * v3.z - v1.y * v1.z - v2.y * v2.z - v3.y * v3.z) / 20;
      const Iyy_tet = mass * (v1.x * v1.x + v1.z * v1.z + v2.x * v2.x + v2.z * v2.z + v3.x * v3.x + v3.z * v3.z - v1.x * v1.z - v2.x * v2.z - v3.x * v3.z) / 20;
      const Izz_tet = mass * (v1.x * v1.x + v1.y * v1.y + v2.x * v2.x + v2.y * v2.y + v3.x * v3.x + v3.y * v3.y - v1.x * v1.y - v2.x * v2.y - v3.x * v3.y) / 20;

      const Ixy_tet = -mass * (v1.x * v1.y + v1.x * v2.y + v2.x * v1.y + v2.x * v2.y + v1.x * v3.y + v3.x * v1.y + v2.x * v3.y + v3.x * v2.y + v3.x * v3.y) / 40;
      const Ixz_tet = -mass * (v1.x * v1.z + v1.x * v2.z + v2.x * v1.z + v2.x * v2.z + v1.x * v3.z + v3.x * v1.z + v2.x * v3.z + v3.x * v2.z + v3.x * v3.z) / 40;
      const Iyz_tet = -mass * (v1.y * v1.z + v1.y * v2.z + v2.y * v1.z + v2.y * v2.z + v1.y * v3.z + v3.y * v1.z + v2.y * v3.z + v3.y * v2.z + v3.y * v3.z) / 40;

      // Parallel axis theorem: I = I_cm + m * (d^2 * I - d * d^T)
      const dx = cx;
      const dy = cy;
      const dz = cz;

      Ixx += Ixx_tet + mass * (dy * dy + dz * dz);
      Iyy += Iyy_tet + mass * (dx * dx + dz * dz);
      Izz += Izz_tet + mass * (dx * dx + dy * dy);
      Ixy += Ixy_tet + mass * dx * dy;
      Ixz += Ixz_tet + mass * dx * dz;
      Iyz += Iyz_tet + mass * dy * dz;
    }

    return [
      [Ixx, Ixy, Ixz],
      [Ixy, Iyy, Iyz],
      [Ixz, Iyz, Izz],
    ];
  }

  /**
   * Format inertia tensor for display
   * @param tensor 3x3 inertia tensor matrix
   * @returns Formatted string representation
   */
  public formatInertiaTensor(tensor: number[][]): string {
    return `[[${tensor[0][0].toFixed(2)}, ${tensor[0][1].toFixed(2)}, ${tensor[0][2].toFixed(2)}],\n [${tensor[1][0].toFixed(2)}, ${tensor[1][1].toFixed(2)}, ${tensor[1][2].toFixed(2)}],\n [${tensor[2][0].toFixed(2)}, ${tensor[2][1].toFixed(2)}, ${tensor[2][2].toFixed(2)}]]`;
  }
}
