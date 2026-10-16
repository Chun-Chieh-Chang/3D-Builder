/** Parity case 登錄表：新影片案例在此匯入加入。 */
import type { ParityCase } from './types';
import demoPlate from './cases/000-demo-plate';
import m10Bolt from './cases/001-m10-bolt';
import m10Nut from './cases/002-m10-nut';

export const parityCases: ParityCase[] = [demoPlate, m10Bolt, m10Nut];
