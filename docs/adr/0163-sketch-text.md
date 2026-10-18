# ADR 0163: 草圖文字特徵與 3D 刻印/雕刻管線 (Sketch Text Feature & 3D Engraving/Embossing)

- **狀態**：Accepted
- **日期**：2026-10-18
- **藍圖追溯**：`docs/blueprint.md` 之 **C1.13 草圖文字 (P2)**
- **Schema 版本**：`SCHEMA_VERSION = 62`（PartDoc）

---

## 1. 背景與需求 (Context)

在機械設計、工業產品開發與模具製造中，在零件表面添加文字標記是核心操作：
1. **銘板與零件號碼刻印**（Part Identification）：如 `REV A`、`PART-001`、`M6`。
2. **表面凸字雕刻 (Embossing / Extrude Boss)**：模具字模、商標與警示凸塊。
3. **表面凹字切除 (Engraving / Extrude Cut)**：雷射/CNC 雕刻深度標記、沉槽刻度與流道標記。
4. **解散文字 (Dissolve Sketch Text)**：比照 SolidWorks，支援將文字輪廓解散為常規草圖圖元（直線、圓弧、樣條），供使用者手動微調或施加尺寸約束。

過往 3D-Builder 草圖模組支援點、線、圓、弧、橢圓與樣條，缺乏文字圖元定義與輪廓生成能力，無法直接實現文字拉伸長出與除料切除。

---

## 2. 第一性原理架構設計 (First Principles & Architecture)

### 2.1 資料結構 (`@3db/model`)
在 `SketchEntity` 新增 `type: 'text'`：
```typescript
export interface SketchTextEntity {
  id: Id;
  type: 'text';
  /** 文字內容（如 "3D-BUILDER", "M6", "ABC"） */
  text: string;
  /** 錨點圖元 ID（草圖座標系定位點） */
  at: Id;
  /** 大寫字高（公釐，size > 0） */
  size: number;
  /** 逆時針旋轉角度（度，預設 0） */
  angle?: number;
  /** 字型名稱（預設 'sans-serif'） */
  font?: string;
  /** 粗體樣式（預設 false） */
  bold?: boolean;
  /** 斜體樣式（預設 false） */
  italic?: boolean;
  /** 水平對齊：'left' | 'center' | 'right'（預設 'left'） */
  align?: 'left' | 'center' | 'right';
  /** 建構線註記：若為 true 則不參與特徵拉伸（預設 false） */
  construction?: boolean;
}
```

### 2.2 輪廓生成與無依賴工業字型引擎 (`@3db/sketch/font`)
為確保在 Node.js 無頭測試（無 DOM/Canvas/網絡）與瀏覽器環境下 100% 一致與零外部相依：
1. **內建標準工業 Sans-Serif 幾何向量字庫**：
   - 涵蓋完整 ASCII 字母（A-Z, a-z）、數字（0-9）與工程常用標點（`-`, `_`, `.`, `/`, `+`, `:`, `*`, `#`, `(`, `)`, `=`, ` `）。
   - 每個字符以標準 1000 單位正規化座標定義閉合外環（Outer CCW）與內孔（Inner Hole CW）。
   - 帶孔字符（如 `O`, `A`, `B`, `D`, `P`, `R`, `0`, `4`, `6`, `8`, `9`, `Q`）明確區分外環與內孔，確保島嶼/孔洞拓樸完全符合 ISO/SolidWorks 標準。
2. **向量幾何變換管線**：
   - 字元依 Kerning / Tracking 依序平移排版。
   - 依據 `align`（左、中、右）計算總寬度偏移。
   - 乘上縮放因子 $S = size / 1000$。
   - 依據 `angle` 進行 2D 剛體旋轉：
     $$x' = x \cos\theta - y \sin\theta + x_{at}$$
     $$y' = x \sin\theta + y \cos\theta + y_{at}$$
   - 若啟用 `italic`，施加水平剪切變換（Shear $\tan 15^\circ$）。

### 2.3 輪廓偵測與特徵拉伸無縫整合 (`findProfiles`)
- `findProfiles` 走訪草圖實體時，對非建構文字實體展開為閉合多邊形 loops。
- `findProfiles` 的 Nesting 演算法自動計算有向面積與包含性：
  - 文字各字元外環判定為獨立閉合 region。
  - 字元內孔（如 'O' 內部）自動分配至該 region 的 `holes` 清單中。
- 再生引擎（`@3db/regen`）與核心（`@3db/kernel`）直接透過 `extrude(frame, regions, ...)` 完成凸字與凹字造型，核心底層零侵入。

### 2.4 解散文字為常規圖元 (`dissolveText`)
- 提供 `dissolveText(sketch, textEntityId, idAlloc)` 輔助函數：
  - 將指定文字展開為草圖 `line`（與 `spline`）圖元。
  - 自動生成端點 `point` 並加入重合約束（`coincident`）或共享頂點。
  - 移除原文字圖元，達成與 SolidWorks 完全一致的「解散文字」編輯體驗。

---

## 3. 紅隊破壞性邊界四問（AGENTS.md §2.1）

1. **輸入破壞 (Input Corruption)**：
   - 空字串或全空白：命令層與求解器防禦，不產生空 loop，不丟給底層求解器。
   - 尺寸 $size \le 0$、NaN、$\infty$、負數：顯式拋出錯誤 `sketch.textSizeInvalid`，嚴禁靜默使用 `Math.abs` 篡改。
   - 錨點未定義或遺失：顯式拋出 `sketch.textAnchorNotFound`。
   - 未知特殊字符：安全退化為空格或方框，不崩潰。
2. **拓樸與幾何相交破壞 (Geometric Self-Intersection Defense)**：
   - 字符內孔（如 'B' 的雙孔、'8' 的雙孔）：外環嚴格正規化為 CCW、內孔為 CW，避免布林面翻轉造成非流形實體。
   - 字符之間自相交防禦：預設字距保留安全間距（Character Spacing）。
3. **依賴鏈完整性 (Dependency Graph Integrity)**：
   - 覆蓋完整管線：`schema.ts` $\rightarrow$ `serialize.ts` $\rightarrow$ `sketch-rules.ts` $\rightarrow$ `planegcs.ts` $\rightarrow$ `profiles.ts` $\rightarrow$ `ops.ts` $\rightarrow$ `interact.ts` $\rightarrow$ `i18n` $\rightarrow$ `apps/web` (`PropertyManager.tsx`, `actions.ts`, `strings.ts`, `Viewport.tsx`)。
4. **規格真實性與零 Mock 原則 (Zero-Mock & Ground Truth)**：
   - 驗收測試必須在真實實體表面拉伸長出文字（凸字）與除料凹槽（凹字）。
   - 體積斷言使用真實 B-rep 物理量測，並與未刻字基準體進行差值對帳。
   - 底層 WASM Heap 指標斷言 `byteLength > 0` 防呆。
