import type { Translation } from '../index';

/** evaluate: measuring, mass properties, geometry check and interference (E1, E2, E3). */
export const evaluate: Translation = {
  'measure.noElement': 'The element to measure is not there',
  'measure.noDistance': 'The distance between these two elements cannot be worked out',
  'physical.act': 'Mass Properties…',
  'physical.title': 'Mass Properties',
  'physical.mass': 'Mass',
  'physical.volume': 'Volume',
  'physical.area': 'Surface area',
  'physical.center': 'Center of mass',
  'physical.inertia': 'Moments of inertia (about the center of mass, along the axes)',
  'physical.principal': 'Principal moments (smallest first) and their directions',
  'physical.parts': 'Parts',
  'physical.qty': 'Qty.',
  'physical.each': 'Mass of one',
  'physical.noMaterial': 'Parts with no material chosen are not in the mass: {names}',
  'physical.unknown': 'Parts not read yet: {names}',
  'physical.areaNote': 'The surface area is the sum of the surfaces of the parts, not the area of the assembly shell.',
  'physical.unitNote': 'Mass in g, volume in mm³, area in mm², center in mm, inertia in g·mm² (the density is the material in the part file properties).',
  'physical.noBody': 'There is no body to compute.',
  'physical.assemblyIs': 'Assembly: its parts put together at their positions (the exploded view does not matter).',
};