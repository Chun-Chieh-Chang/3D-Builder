export * from './types';
export { SURFACE_TOLERANCE, THREAD_MAX_STARTS, THREAD_MAX_TAPER, THREAD_MAX_TURNS, Kernel, type Frame, type Region, type Segment, type SweepSpec, type ThreadSpec, type Until } from './kernel';
export type { LoadOptions } from './occt';
export { anyHit, buildBvh, nearestHit, nearestHitAt, triangleNormal, type Bvh } from './rays';
export { forEachSample, type SampleMesh } from './sampling';
