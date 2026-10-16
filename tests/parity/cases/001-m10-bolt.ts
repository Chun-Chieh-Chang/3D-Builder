/**
 * 影片 2（How it's Designed「Ultimate Solidworks Nut and Bolt Tutorial!」）的 M10 六角螺栓。
 * 規格依 ISO 4014 思路推導（描述自稱 actual M10 size）：
 *   對邊距 16、頭高 6.4、栓徑 Ø10、栓長 50（ISO 慣用長度）、螺紋 M10×1.5 長 26（L≤125 之 b 值）。
 * 期望不變量為手算（公式見下），非 Kernel 回填。
 *
 * 待使用者看影片確認：栓長 50？頭部倒角 1×45°（上下）？螺紋長 26 與 fade？
 *   頭下 R1 圓角：本案例「排除」——本專案 kernel 對凸邊圓角在 boss 底圓（環形面內緣）上
 *   會加料而非除料（+7.04 而非約 −6.1，最小複現：平板+boss 對底圓 R1），屬已知缺陷，另案回報。
 *   若影片實際有頭下圓角，請截圖告知，本案例再跟進。
 * 面數不斷言：螺牙螺旋面數取決於本專案螺牙特徵的離散方式，手算不可靠。
 */
import type { ThreadFeature } from '@3db/model';
import type { ParityCase } from '../types';
import { build, circle, edge, front, sketch, extrude } from '../../phase1/builders';
import { hexagon } from '../hex';
import { stdThreadCutPerMm } from '../threadvol';

const S = 16;
const K = 6.4;
const L = 50;
const B = 26;
const HEX = (Math.sqrt(3) / 2) * S * S; // 正六角柱截面積（對邊距 S）= 221.7025
const CHAMFER_45 = HEX * (1 - (1 + 49 / 64 + 7 / 8) / 3); // 頭緣 1×45°：截頭稜柱，內切圓 8→7，h=1
const SHANK = (Math.PI / 4) * 100 * L; // 栓 Ø10×50（與頭部 0..K 段重疊部分在聯集時自動扣除）
const THREAD = B * stdThreadCutPerMm('M10', 'external', 5); // ISO 68-1 牙型裁至 Ø10 表面，Pappus 推導
const VOLUME = HEX * K - 2 * CHAMFER_45 + SHANK - THREAD;

const topEdges = [0, 1, 2, 3, 4, 5].map((i) => edge(`{e1:cap:end|e1:side:s1.hl${i}}`));
const bottomEdges = [0, 1, 2, 3, 4, 5].map((i) => edge(`{e1:cap:start|e1:side:s1.hl${i}}`));

export default {
  id: '001-m10-bolt',
  source: {
    label: 'Ultimate Solidworks Nut and Bolt Tutorial!（How it’s Designed）— 螺栓本體',
    url: 'https://www.youtube.com/watch?v=fu1qawNQsr8',
  },
  trust: 'B',
  notes:
    'ISO 4014 思路：s=16、k=6.4、Ø10、L=50（慣用長度，待確認）、M10×1.5 螺紋長 26。' +
    '特徵樹：六角伸長(頭) → Ø10 伸長(頭+栓一體 56.4，ISO 語義栓長=頭頂以上 50) → 頭緣 1×45° 倒角×2 → 標準外螺紋 cut 26。' +
    `體積手算：六角柱 ${(HEX * K).toFixed(2)} − 倒角 ${(2 * CHAMFER_45).toFixed(2)} + 栓 ${SHANK.toFixed(2)} − 螺溝 ${THREAD.toFixed(2)} = ${VOLUME.toFixed(2)} mm³。` +
    '頭下 R1 圓角因 kernel 缺陷排除（見檔頭註解）。',
  expected: {
    volume: VOLUME,
    bbox: [S, (2 * S) / Math.sqrt(3), K + L], // 六角尖角向 2R = 32/√3 ≈ 18.475；總高 6.4+50
  },
  doc: () =>
    build(
      sketch('s1', front, hexagon('h', S)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: String(K) }),
      sketch('s2', front, circle('c', 0, 0, 5)),
      extrude('e2', 's2', 'boss', { type: 'blind', depth: String(K + L) }),
      { id: 'ch1', type: 'chamfer', name: 'ch1', suppressed: false, edges: topEdges, mode: 'distanceDistance', distance: '1', second: '1' },
      { id: 'ch2', type: 'chamfer', name: 'ch2', suppressed: false, edges: bottomEdges, mode: 'distanceDistance', distance: '1', second: '1' },
      {
        id: 'th1',
        type: 'thread',
        name: 'th1',
        suppressed: false,
        profileMode: 'standard',
        standardDesignation: 'M10',
        standardTarget: 'external',
        axis: { kind: 'face', name: 'e2:side:s2.c' },
        op: 'cut',
        hand: 'right',
        length: String(B),
      } satisfies ThreadFeature,
    ),
} satisfies ParityCase;
