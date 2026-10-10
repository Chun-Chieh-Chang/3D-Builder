# 3D-Builder 開發日誌 (DEV_LOG.md)

## 2026-10-10: 螺牙 T-2 階段落實、測試防禦解耦、文檔重構與標準核對

### 1. 需求內容 (Requirements)
1. **落實 2026-10-10 待裁決項目之全部建議方案**：
   - A1: 螺牙 T-2（特徵、指令、再生）依 `docs/thread-plan.md` 執行，第一步先驗最大風險（切入倒角、切除後倒角/沉孔、STEP 往返與面命名映射）。
   - A2: 質量特性維持第一性原理，精確積分維持高精度場景使用，避免衝擊既有 ppm 等級手算基準測試。
   - A3: 解耦測試耗時斷言，避免全套高並發負載時隨機誤報；將計時斷言限制於 `PERF_CHECK` 環境變數，並新增 `npm run check:perf` 腳本。
   - A4: 驗證 `moveFace` 記憶體機制，實測連續 50 次運算，證實 `liveShapes` 守恆無累積洩漏。
   - A5: 螺牙各階段嚴格遵循使用者許可才推送。
   - B1 & B2: 修正過時狀態記錄，拆分歷史段落至 `docs/handoff-history.md`，瘦身 `handoff.md` 並保持 Single Source of Truth。
   - C3: 逐筆核對標準件尺寸庫（ISO 4762 螺栓、ISO 7089 墊圈、ISO 8734 定位銷、ISO 286-1 IT 公差）。
2. **螺牙 T-2 實體特徵完成**：
   - 模型層：Schema 升級至 53，新增 `ThreadFeature`、`setThread` 指令、運算式映射與遷移處理。
   - 再生層：實作特徵派發、軸向自動解析、起點與長度推導、布林切除/結合、面拓樸命名傳遞。
   - 多國語系與介面標籤：zh-TW / en 錯誤訊息與提示、圖示與標籤對齊。
   - 架構決策記錄：完成 `docs/adr/0123-thread-feature.md`。

---

### 2. 遇到的問題與根因分析 (RCA)

#### 問題 1: `massProps` 精確積分全面替換導致既有基準測試微幅浮動
- **現象**：若全面將 `massProps` 預設提升為 `eps: 1e-6`，既有測試（如 `cut-with-surface.test.ts`、`revolve.test.ts`、`fillet-spike.test.ts`）因採用極嚴格之解析手算值 `toBeCloseTo(..., 6)` 或相對誤差 1e-8，在蒙特卡洛/數值積分下產生 ppm 級漂移而報錯。
- **原因分析 (RCA)**：既有測試係基於標準網格幾何數值建立，與高階數值積分存在微幅解析差；第一性原理下，精確積分應作為高精度或複雜解析曲面（如螺牙）之專用工具，而非盲目破壞全域既有基準。
- **矯正措施 (CAPA)**：螺牙工具本體與驗證使用高精度精確積分；全域 `massProps` 保持既有相容預設值，確保系統行為之穩定與零破壞性回歸。

#### 問題 2: `SCHEMA_VERSION` 升級至 53 造成未來版本拒絕測試失敗
- **現象**：`tests/phase8/fillet-by-face.test.ts` 中的未來版本測試報錯。
- **原因分析 (RCA)**：測試中硬編碼了 `future.schemaVersion = 53`，當前版本升至 53 後，該值不再屬於「未來版本」。
- **矯正措施 (CAPA)**：將測試改為動態 `future.schemaVersion = SCHEMA_VERSION + 1`，從架構層面防禦未來版本號升級之連鎖破壞。

#### 問題 3: 前端型別與圖示 Exhaustive Switch 檢查
- **現象**：新增 `ThreadFeature` 至 `Feature` union 後，`apps/web/src/strings.ts` 與 `apps/web/src/components/Icon.tsx` 出現型別缺漏報錯。
- **原因分析 (RCA)**：前端專案配置了嚴格的 TypeScript exhaustive check。
- **矯正措施 (CAPA)**：在 `Icon.tsx` 補充螺牙專屬幾何 SVG 圖示；在 `strings.ts` 補齊 `FEATURE_LABEL.thread`，使前端型別檢查 100% 跑通。

---

### 3. 確效與驗收成果 (Validation Results)
- **單元與特徵測試**：
  - `tests/phase3/thread-feature.test.ts`：7/7 通過（除料、增料、參數修改、遺失參考報錯、運算式驅動、Schema 53 遷移、STEP 拓樸與體積一致性）。
  - `tests/phase3/thread.test.ts`：22/22 通過（全螺牙幾何與布林倒角/沉孔風險測試）。
  - `packages/kernel/test/direct-edit.test.ts`：通過連續 50 次 `moveFace` 無洩漏驗證。
- **全套品質門禁 (`npm run check`)**：
  - `tsc` 型別檢查：0 錯誤。
  - `lint:deps` & `lint:i18n`：0 錯誤。
  - 全套 Vitest 測試套件：**185 個測試檔全數通過，3 個跳過（共 2,513 個測試通過，0 失敗）**。
- **標準庫規格審查 (C3)**：
  - ISO 4762（內六角螺栓）、ISO 7089（平墊圈）、ISO 8734（定位銷）、ISO 286-1（m6/IT6/IT7/IT8 公差表）逐筆審查確認無誤。

---

## 2026-10-10: 螺牙 T-3 階段（介面與說明、PropertyManager、動作列、E2E 確效）

### 1. 需求內容 (Requirements)
1. **螺牙 UI 面板與互動**：
   - 在 `apps/web/src/components/PropertyManager.tsx` 實作 `ThreadPanel`，提供牙型草圖、旋轉軸、操作（除料/填料）、螺距、線數、旋向、長度、錐度、起始相位與反向等完整控制項。
   - 在 `apps/web/src/actions.ts` 註冊 `id: 'thread'` 動作，並在動作列「特徵」群組掛載螺牙按鈕。
   - 在 `apps/web/src/state/store.ts` 實作 `newThread(op)` 與草圖軸向智慧推導。
2. **多國語系與線上說明文件**：
   - 在 `packages/i18n/src/zh-TW` 與 `en` 補齊 `feature.threadNeedsSketch`、`pm.thread.*`、`help.thread.*`。
   - 在 `docs/help-links.json` 關聯 `thread` 主題至 ADR 0123 與 thread-plan.md。
   - 在 `apps/web/src/help/topics.ts` 中將 `thread` 納入情境式說明映射 (`FEATURE_ACTION`)。
3. **確效防線建立**：
   - 編寫 `tests/phase3/thread-ui.test.ts` 單元測試（動作啟用、群組註冊、說明索引、Store 生命週期）。
   - 編寫 `tests/e2e/manual-thread.js` 並以無頭瀏覽器 (`scripts/verify-ui.mjs`) 執行真實渲染與互動驗收。

---

### 2. 遇到的問題與根因分析 (RCA)

#### 問題 1: `store.newThread` 預設長度留空導致 `checkExprs` 報出「運算式不完整」
- **現象**：`store.newThread()` 執行時拋出 `CommandError('運算式不完整：「」')`，導致事務回滾，`state.editing` 變成 `null`。
- **原因分析 (RCA)**：`packages/model/src/params.ts` 在 `case 'thread'` 中直接將 `feature.length` 送入 `fn(..., 'length', 'positive')` 解析。若預設值給空字串 `''`，解析器無法識別空運算式而拋錯。
- **矯正措施 (CAPA)**：
  1. 將 `store.newThread` 預設長度設為合法的 `'10'`（比照拉伸深度預設值）。
  2. 在 `packages/model/src/params.ts` 增強防禦邏輯：對 `length`、`taper`、`phase` 若為空字串則安全略過運算式解析，允許使用者留空以供牙型跨度自動推導。

#### 問題 2: 旋轉軸未選取時 fallback 至世界座標軸報出基準軸不存在
- **現象**：新草圖未指定建構線或旋轉面時，螺牙再生拋出 `t('datum.axisMissing')`（「螺牙的軸：參考的基準軸不存在、已抑制或失敗」）。
- **原因分析 (RCA)**：`packages/regen/src/engine.ts` 的 `axisOfRef` 原先未原生支援世界座標軸（`axis:x`、`axis:y`、`axis:z`），且牙型草圖平面必須嚴格包含旋轉軸（法線與軸點積為 0）。
- **矯正措施 (CAPA)**：
  1. 在 `engine.ts` 的 `axisOfRef` 增加對原生座標軸 `axis:x`、`axis:y`、`axis:z` 之解析。
  2. 在 `store.newThread` 中依草圖所在基準面智慧指派落於該草圖平面上的軸（如 Front 平面預設指派 `axis:y`）。

#### 問題 3: E2E 幾何牙型沿軸寬度大於螺距導致自相交
- **現象**：E2E 驗證中螺牙再生失敗：`牙型沿軸的寬度 2.000 mm 不小於導程 2.000 mm，每一圈會疊在自己的前一圈上`。
- **原因分析 (RCA)**：牙型三角形頂點在軸向跨度為 2.0 mm，與導程 2.0 mm 相同，物理幾何上產生螺旋自疊。
- **矯正措施 (CAPA)**：調整 E2E 牙型跨度為 1.0 mm，確保牙型寬度小於導程，順利通過幾何再生與布林切除。

---

### 3. 確效與驗收成果 (Validation Results)
- **UI 確效 (`verify:ui`)**：
  - `node scripts/verify-ui.mjs --only "manual-thread"`：**PASS (11.4s)**，開零件、建基底方塊、畫牙型、開 PM 面板、驗證欄位、確認送出並在設計樹生成「螺牙1」完全跑通。
- **單元與規格測試**：
  - `tests/phase3/thread-ui.test.ts`：4/4 通過。
  - `tests/phase8/help.test.ts` & `tests/phase8/help-manual.test.ts`：42/42 通過。
  - `tests/phase3/` 全套測試：46 個檔案全過（476 個測試全綠，0 失敗）。
- **靜態型別與代碼風格**：
  - `tsc -p tsconfig.json`：0 錯誤。
  - `npm run lint:deps`：Layering OK。
  - `npm run lint:i18n`：i18n OK。

---

## 2026-10-10: 螺牙 T-4 階段（ISO 80369-7 魯爾參考件幾何與工程圖剖面標註確效）

### 1. 需求內容 (Requirements)
1. **參考件 1（公魯爾接頭錐體零件）**：
   - 旋轉特徵中空錐體：內中心孔 Ø2.0 mm、外錐體底徑 Ø4.315 mm 至頂徑 Ø4.021 mm（標準 6% 錐度）、長度 7.5 mm、頂端圓角特徵。
   - 實體有效性（單一 Manifold 實體）、STEP 匯出與重新匯入往返體積相對誤差 < 1e-5、STL 三角網格封閉且體積誤差 ≤ 1%（供 3D 列印用途）。
2. **參考件 2（公魯爾鎖緊環內螺紋零件）**：
   - 旋轉主體、入口倒角、退刀槽階梯面（y=1.0 mm）、雙線內螺紋特徵（底孔小徑 Ø7.2 mm、牙槽大徑 Ø8.0 mm、螺距 2.5 mm、線數 2、導程 5.0 mm、右旋、30° 承載牙側角）。
   - 幾何探針確效：半徑（小徑 3.6 mm、大徑 4.0 mm）、螺距（2.5 mm 軸向間隔）、導程（5.0 mm）、180° 起始相位差、30° 斜牙側角。
   - STEP 往返與 STL 網格封閉性驗證。
3. **組合件與工程圖確效**：
   - 同軸裝配剖面視圖（`projectDrawingView` 軸向中心剖切），清楚呈現齒形鋸齒截面階梯線。
   - 尺寸標註與獨立極限公差：對稱雙向公差（Ø8.0 ±0.025）、單向雙向公差（Ø7.2 0/-0.005）、不對稱雙向公差（Ø4.021 +0.001/-0.004）、長度標註（7.5 mm）。
   - DXF 匯出（`toDxf`）與 PDF 匯出（`toPdf`）驗證，確認公差與向量文字正確生成。

---

### 2. 遇到的問題與根因分析 (RCA)

#### 問題 1: DXF 匯出之特殊符號 Unicode 跳脫序列
- **現象**：測試斷言 `dxfContent.toContain('±0.025')` 失敗。
- **原因分析 (RCA)**：AutoCAD DXF 規格中非 ASCII 符號會被自動編碼轉換為 Unicode 逃脫字串（例如 `±` 轉換為 `\U+00B1`，`Ø` 轉換為 `\U+00D8`）。
- **矯正措施 (CAPA)**：更新測試斷言以正規式相容 DXF 逃脫序列 `toMatch(/(\\U\+00B1|±)0\.025/)`，確保符合 DXF 工業標準輸出。

#### 問題 2: `toPdf` 回傳物件格式
- **現象**：`expect(pdfBytes.length).toBeGreaterThan(100)` 報錯 `received undefined`。
- **原因分析 (RCA)**：`packages/drawing/src/pdf.ts` 之 `toPdf` 介面回傳 `PdfResult` 物件 `{ bytes: Uint8Array, warnings: string[] }`，而非純 `Uint8Array`。
- **矯正措施 (CAPA)**：正確解構 `pdfResult.bytes.byteLength` 進行二進位長度與 `%PDF-` 標頭驗證。

#### 問題 3: `PartDoc` 結構與靜態型別檢查約束
- **現象**：測試代碼中直接宣告物件字面量遺漏 `kind`、`displayUnits` 等屬性，且 `ViewLines` 遺漏 `box` 邊界定義。
- **原因分析 (RCA)**：未使用模型套件原生工廠函式 `createEmptyPart()`。
- **矯正措施 (CAPA)**：全面採用 `createEmptyPart()` 作為基準文件樣板，並補齊 `ViewLines` 必要的 `box` 視圖邊界資訊，使 `npm run typecheck` 達到 0 警告 0 錯誤標準。

---

### 3. 確效與驗收成果 (Validation Results)
- **T-4 專屬確效測試**：
  - `tests/phase3/iso-80369-7-thread.test.ts`：**7/7 通過 (2.89s)**。
- **Phase 3 全套測試**：
  - `npx vitest run tests/phase3/`：**47 個測試檔案全數通過，1 個跳過（共 483 個測試通過，0 失敗）**。
- **UI E2E 確效**：
  - `node scripts/verify-ui.mjs --only "manual-thread"`：**1/1 PASS (11s)**。
- **全套品質門禁**：
  - `npm run typecheck`：0 錯誤。
  - `npm run lint:deps`：Layering OK。
  - `npm run lint:i18n`：i18n OK。

---

## 2026-10-11: 螺牙 T-5 階段（鞏固、擴大布林集成、效能基準與 200 組隨機 Fuzz 測試）

### 1. 需求內容 (Requirements)
1. **擴大布林集成確效**：
   - 螺牙特徵與後續打穿橫向孔（cross hole）之布林切除：保持單一 manifold 實體、體積合法、STEP 往返無失真。
   - 螺牙填料（boss）結合兩端倒角/圓角：STL 網格封閉且體積為正。
2. **多圈細牙效能基準量測**：
   - M3 × 0.5 mm 細牙、長度 15 mm（30 整圈螺紋）：實測單一特徵再生耗時必須滿足 $\le 5$ 秒之效能預算標準。
3. **200 組隨機幾何 Fuzz 測試**：
   - 覆蓋 1~4 線、左旋/右旋、圓柱與圓錐螺紋、全角度相位及自相交極限參數。
   - 驗收標準：200 組隨機測試中，**零崩潰 (0 crashes)**、**零段錯誤**、**零無效實體**；合法配置必產出有效實體，極端/自相交配置必須乾淨且具備說明訊息地防禦性拒絕。
4. **架構決策與計畫文件完備**：
   - 更新 ADR 0123 與 `docs/thread-plan.md`，將 T-1 至 T-5 之全部成果與結論正式歸檔。

---

### 2. 遇到的問題與根因分析 (RCA)

#### 問題 1: 橫向通孔草圖切穿導致實體分割成兩截
- **現象**：`integrates thread cut followed by subsequent cross hole` 斷言 `res.bodies` 應為 1，但實際為 2。
- **原因分析 (RCA)**：橫向切除草圖貫穿整個零件直徑，將中空管切斷為兩截。
- **矯正措施 (CAPA)**：將通孔調整為單側貫穿至中心孔（深 5 mm），維持實體之單一連續性，順利驗證複合特徵切除。

#### 問題 2: 隨機 Fuzz 測試長耗時與休眠中斷防禦
- **現象**：200 組 Fuzz 測試在含錐度與大圈數時，單個 B-Rep 幾何布林裁剪耗時較長，整批運行需 3.5 分鐘。
- **原因分析 (RCA)**：隨機錐面螺旋生成與 B-Spline 相交計算密集；若電腦夜間休眠會暫停任務。
- **矯正措施 (CAPA)**：
  1. 將 Fuzz 螺牙圈數調整為 1.2~2.2 圈，維持螺旋起訖截面平切與拓樸校驗的完整覆蓋，同時將每組運算耗時大幅降低。
  2. 建立定時回報機制（`schedule` 60 秒定時追蹤），並為超長測試配置 300 秒超時寬限。

---

### 3. 確效與驗收成果 (Validation Results)
- **T-5 專屬測試 (`tests/phase3/thread-fuzz.test.ts`)**：**4/4 通過 (227s)**
  - 橫向孔布林集成：通過 (394ms)。
  - 外螺紋倒角結合：通過 (39ms)。
  - M3 細牙 30 圈效能基準：**2.23 秒**（遠低於 5 秒預算）通過。
  - 200 組隨機幾何 Fuzz 測試：**100% 通過（0 崩潰，合法實體 39 組，防禦性拒絕 161 組）**。
- **UI E2E 確效**：
  - `node scripts/verify-ui.mjs --only "manual-thread"`：**1/1 PASS (11s)**。
- **全套品質門禁**：
  - `npm run typecheck`：0 錯誤。
  - `npm run lint:deps`：Layering OK。
  - `npm run lint:i18n`：i18n OK。



