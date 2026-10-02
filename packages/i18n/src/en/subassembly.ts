import type { Translation } from '../index';

/** subassembly: sub-assemblies and the flags of a component (C15.4, C15.5). */
export const subassembly: Translation = {
  'subassembly.pathNeedsComponent': "The assembly's own planes and origin have no component path",
  'subassembly.badPath': "The path of the mate element's component inside the sub-assembly is not valid",
  'subassembly.cycle': 'This would make the assembly contain itself: {chain}',
  'subassembly.selfReference': 'An assembly cannot use itself as a component: {file}',
  'subassembly.badState': 'Unknown component state: {state}',
  'subassembly.hide': 'Hide',
  'subassembly.show': 'Show',
  'subassembly.transparent': 'Transparent',
  'subassembly.opaque': 'Opaque',
  'subassembly.suppressedCannotMove': '"{name}" is suppressed and cannot be moved (right-click it in the tree and choose Unsuppress)',
  'subassembly.pathSeparator': ' / ',
  'subassembly.open': 'Open Sub-assembly',
  'subassembly.insideTip': 'A part inside the sub-assembly: it cannot be moved on its own here; open the sub-assembly to change it',
  'subassembly.notAssembly': '"{path}" is not an assembly',
  'subassembly.stillLoading': 'The sub-assembly is still loading, please wait',
  'subassembly.stepNotYet': 'An assembly with sub-assemblies cannot be exported to STEP yet',
  'subassembly.nestedProblem': 'A file a sub-assembly uses cannot be used: "{path}" ({why}); open that sub-assembly to repair it',
  'subassembly.notLoaded': "{what}: the component's file is not loaded",
  'subassembly.pathOnPart': '{what}: this component is a part, not a sub-assembly, so there is no path to follow',
  'subassembly.noComponent': '{what}: the sub-assembly has no component {id}',
};
