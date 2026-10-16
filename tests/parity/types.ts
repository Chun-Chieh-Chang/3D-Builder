/**
 * Parity 規格檔的型別：一支 YouTube SolidWorks 影片沉澱為一個 case（特徵樹＋期望不變量＋信賴等級）。
 * 期望不變量只能來自影片讀值或手算——嚴禁先用本專案的 Kernel 跑完回填（AGENTS.md §2.4 零 Mock 原則，
 * 否則比對變成恆真式假綠）。
 */
import type { PartDoc } from '@3db/model';

/** A：影片有顯示質量性質（體積/質量）；B：尺寸全部可讀但無質量性質；C：參數不完整，僅結構近似。 */
export type ParityTrust = 'A' | 'B' | 'C';

export interface ParitySource {
  /** 影片標題／頻道；harness 自我檢查的案例標為「手算自我檢查（無影片）」。 */
  label: string;
  url?: string;
  timestamps?: string;
}

export interface FaceCountExpect {
  /** 面總數。 */
  total: number;
  planes?: number;
  cylinders?: number;
  cones?: number;
  spheres?: number;
  toruses?: number;
  bsplines?: number;
  /**
   * true 時各計數允許 ±1 誤差（僅 C 級案例使用：參數不全、面數為目視估計）。
   * 各計數的斷言是精確的；不確定就別填該項，不要用寬容差掩蓋。
   */
  approx?: boolean;
}

export interface ParityExpect {
  /** 體積 mm³。A 級 ±0.5%、B 級 ±2%、C 級 ±5%（預設，可用 tolerance 覆寫）。 */
  volume?: number;
  /** 外形尺寸 [dx, dy, dz] mm；斷言時三軸各自排序後比對（不受模型方位影響）。A/B 級 ±0.05 mm、C 級 ±0.5 mm。 */
  bbox?: [number, number, number];
  /** 面數與面型計數（plane/cylinder/cone/sphere/torus/bspline，其餘歸 other）。 */
  faces?: FaceCountExpect;
}

export interface ParityCase {
  id: string;
  source: ParitySource;
  trust: ParityTrust;
  /** 給審查者的影片筆記摘要：特徵樹順序、草圖尺寸、讀到的質量/體積值、哪裡不確定。 */
  notes?: string;
  expected: ParityExpect;
  tolerance?: {
    volumeRel?: number;
    bboxAbs?: number;
  };
  /** 用 tests/phase1/builders 或原始 Feature 物件組出特徵樹。 */
  doc: () => PartDoc;
}
