import * as THREE from 'three';
import type { PlaneFrame } from './overlay';

/** A finite datum sheet centred at its real frame origin, large enough to cover the projected model. */
export function referencePlaneCorners(frame: PlaneFrame, box: THREE.Box3): THREE.Vector3[] {
  if ([frame.origin, frame.xDir, frame.yDir, frame.normal].some(v => v.length !== 3 || !v.every(Number.isFinite))) throw new RangeError('Invalid datum plane frame');
  const origin = new THREE.Vector3(...frame.origin), x = new THREE.Vector3(...frame.xDir), y = new THREE.Vector3(...frame.yDir);
  const normal = new THREE.Vector3(...frame.normal);
  if ([x, y, normal].some(v => Math.abs(v.lengthSq() - 1) > 1e-6) || Math.abs(x.dot(y)) > 1e-6 || x.clone().cross(y).dot(normal) < 1 - 1e-6) throw new RangeError('Invalid datum plane basis');
  let halfU = 50, halfV = 50;
  if (!box.isEmpty()) {
    if (![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)) throw new RangeError('Invalid datum display bounds');
    const corners = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(origin));
    const us = corners.map(c => c.dot(x)), vs = corners.map(c => c.dot(y));
    const margin = Math.max(0.1 * Math.max(Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs)), 5);
    halfU = Math.max(...us.map(Math.abs)) + margin;
    halfV = Math.max(...vs.map(Math.abs)) + margin;
  }
  if (![halfU, halfV].every(Number.isFinite)) throw new RangeError('Datum display bounds overflow');
  const corners = [[-halfU, -halfV], [halfU, -halfV], [halfU, halfV], [-halfU, halfV]].map(([u, v]) => origin.clone().addScaledVector(x, u!).addScaledVector(y, v!));
  if (corners.some(p => !p.toArray().every(Number.isFinite))) throw new RangeError('Datum display corners overflow');
  return corners;
}
