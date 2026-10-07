import type { Translation } from '../index';

/** stepasm: importing an assembly from a STEP file (F2.8). */
export const stepasm: Translation = {
  'stepasm.unreadable': 'This STEP file cannot be read',
  'stepasm.noShapes': 'The STEP file holds no shapes',
  'stepasm.notRigid': 'The position of the component "{name}" holds a mirror or a scale, which is not a rigid position, so it cannot be imported',
  'stepasm.act': 'Import STEP Assembly…',
  'stepasm.reading': 'Reading the structure of "{name}"…',
  'stepasm.askFolder': '"{name}" has {parts} parts and {subs} sub-assemblies. To write them as part files and assembly files, choose a folder to put them in (an empty one is best; files already in it are left alone).',
  'stepasm.folderHint': 'This folder is written into: the browser asks whether you allow editing it. Once imported it is the project folder.',
  'stepasm.done': 'Imported "{name}": {parts} part files and {subs} sub-assemblies, written in "{folder}"',
  'stepasm.failed': 'Importing the STEP assembly failed: {why}',
  'stepasm.folderParts': 'Parts',
  'derived.assemblyName': '{name} Assembly',
  'derived.act': 'Make Assembly from Bodies',
  'derived.saveFirst': 'Save the part first: the derived parts read its file',
  'derived.noBodies': 'The part has no body',
  'derived.askFolder': 'Pick the folder that holds {name}: a part file for each of its {n} bodies and an assembly are written into it',
  'derived.notThatFolder': 'The folder has to be the one that holds {name} itself',
  'derived.done': 'Made an assembly of {parts} derived parts in {folder}',
  'derived.failed': 'Could not make the assembly: {why}',
  'stepasm.folderSubs': 'Sub-assemblies',
  'stepasm.unnamed': 'Unnamed {n}',
  'stepasm.emptyAssembly': 'The assembly "{name}" has no components',
};