/**
 * 影片 2（How it's Designed「Ultimate Solidworks Nut and Bolt Tutorial!」）的 M10 六角螺帽。
 * 規格依 ISO 4032 推導：對邊距 16、高度 8.4、M10×1.5 內螺紋。
 * 期望不變量為手算（公式見下），非 Kernel 回填。
 *
 * 待使用者看影片確認：頂面 30° 倒角退距 2（ISO 不定值，常見教學取法）？底孔 Ø8.5（M10 攻牙鑽徑）？
 * 面數不斷言：內螺紋螺旋面數手算不可靠。
 */
import type { ThreadFeature } from '@3db/model';
import type { ParityCase } from '../types';
import { build, circle, edge, front, sketch, extrude } from '../../phase1/builders';
import { hexagon } from '../hex';
import { stdThreadCutPerMm } from '../threadvol';

const S = 16;
const M = 8.4;
const HOLE_D = 8.5; // M10×1.5 攻牙鑽徑
const HEX = (Math.sqrt(3) / 2) * S * S; // 正六角柱截面積 = 221.7025
const CHAMFER_SETBACK = 2; // 頂面倒角水平退距，30° 斜面 → 垂直深度 2·tan30
const H = CHAMFER_SETBACK * Math.tan(Math.PI / 6);
const CHAMFER_30 = HEX * H * (1 - (1 + 9 / 16 + 3 / 4) / 3); // 截頭稜柱，內切圓 8→6
const HOLE = (Math.PI / 4) * HOLE_D * HOLE_D * M;
const THREAD = M * stdThreadCutPerMm('M10', 'internal', HOLE_D / 2); // ISO 68-1 牙型裁至 Ø8.5 孔壁，Pappus 推導
const VOLUME = HEX * M - CHAMFER_30 - HOLE - THREAD;

const topEdges = [0, 1, 2, 3, 4, 5].map((i) => edge(`{e1:cap:end|e1:side:s1.hl${i}}`));

export default {
  id: '002-m10-nut',
  source: {
    label: 'Ultimate Solidworks Nut and Bolt Tutorial!（How it’s Designed）— 螺帽',
    url: 'https://www.youtube.com/watch?v=fu1qawNQsr8',
  },
  trust: 'B',
  notes:
    'ISO 4032：s=16、m=8.4、M10×1.5。特徵樹：六角伸長 → 頂緣 30° 倒角(退距 2，待確認) → Ø8.5 通孔除料 → 標準內螺紋 cut 全長。' +
    `體積手算：六角柱 ${(HEX * M).toFixed(2)} − 倒角 ${CHAMFER_30.toFixed(2)} − 孔 ${HOLE.toFixed(2)} − 內螺溝 ${THREAD.toFixed(2)} = ${VOLUME.toFixed(2)} mm³。`,
  expected: {
    volume: VOLUME,
    bbox: [S, (2 * S) / Math.sqrt(3), M],
  },
  doc: () =>
    build(
      sketch('s1', front, hexagon('h', S)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: String(M) }),
      {
        id: 'ch1',
        type: 'chamfer',
        name: 'ch1',
        suppressed: false,
        edges: topEdges,
        mode: 'distanceDistance',
        distance: String(CHAMFER_SETBACK),
        second: String(H),
      },
      sketch('s2', front, circle('c', 0, 0, HOLE_D / 2)),
      extrude('e2', 's2', 'cut', { type: 'throughAll', reverse: true }),
      {
        id: 'th1',
        type: 'thread',
        name: 'th1',
        suppressed: false,
        profileMode: 'standard',
        standardDesignation: 'M10',
        standardTarget: 'internal',
        axis: { kind: 'face', name: 'e2:side:s2.c' },
        op: 'cut',
        hand: 'right',
        length: String(M),
      } satisfies ThreadFeature,
    ),
} satisfies ParityCase;
