import type { Translation } from '../index';

/** subassembly: sub-assemblies and the flags of a component (C15.4, C15.5). */
export const subassembly: Translation = {
  'subassembly.pathNeedsComponent': "The assembly's own planes and origin have no component path",
  'subassembly.badPath': "The path of the mate element's component inside the sub-assembly is not valid",
  'subassembly.cycle': 'This would make the assembly contain itself: {chain}',
  'subassembly.selfReference': 'An assembly cannot use itself as a component: {file}',
};
