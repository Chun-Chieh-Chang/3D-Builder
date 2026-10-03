export * from './types';
export { SURFACE_TOLERANCE, Kernel, type Frame, type Region, type Segment, type SweepSpec, type Until } from './kernel';
export type { LoadOptions } from './occt';
export { anyHit, buildBvh, nearestHit, nearestHitAt, triangleNormal, type Bvh } from './rays';
export { forEachSample, type SampleMesh } from './sampling';
