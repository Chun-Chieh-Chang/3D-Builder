/**
 * Harness 自我檢查案例（無影片）：80×50×12 平板，中央 (40,25) 鑽 Ø10 通孔。
 * 期望不變量全部手算——體積 48000 − 300π、包圍盒 12/50/80、面數 7（6 平面＋1 圓柱孔壁），
 * 用來驗證 parity 執行器本身的重建、量測與斷言路徑。
 */
import type { ParityCase } from '../types';
import { build, circle, front, rectangle, sketch, extrude } from '../../phase1/builders';

export default {
  id: '000-demo-plate',
  source: { label: '手算自我檢查（無影片）' },
  trust: 'A',
  notes: '伸長 boss 80×50×12；同面草圓 (40,25) r5 通孔除料。體積 = 80·50·12 − π·5²·12；面：4 側面＋上下平面＋孔圓柱 = 7。',
  expected: {
    volume: 48000 - 300 * Math.PI,
    bbox: [80, 50, 12],
    faces: { total: 7, planes: 6, cylinders: 1 },
  },
  doc: () =>
    build(
      sketch('s1', front, rectangle('r', 0, 0, 80, 50)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '12' }),
      sketch('s2', front, circle('c', 40, 25, 5)),
      extrude('e2', 's2', 'cut', { type: 'throughAll', reverse: true }),
    ),
} satisfies ParityCase;
