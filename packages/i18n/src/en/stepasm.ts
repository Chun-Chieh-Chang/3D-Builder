import type { Translation } from '../index';

/** stepasm: importing an assembly from a STEP file (F2.8). */
export const stepasm: Translation = {
  'stepasm.unreadable': 'This STEP file cannot be read',
  'stepasm.noShapes': 'The STEP file holds no shapes',
  'stepasm.notRigid': 'The position of the component "{name}" holds a mirror or a scale, which is not a rigid position, so it cannot be imported',
  'stepasm.failedWhy': 'Reading the STEP file failed: {why}',
};