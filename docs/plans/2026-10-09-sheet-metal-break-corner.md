# 鈑金斷開角落實作計畫

> **執行說明：** 分階段實作；先完成幾何與平板型式的垂直切片，再接 UI。此功能單獨交付，不與曲面除料混在同一提交。

**目標：** 新增獨立「斷開角落」特徵，在邊線凸緣自由端的外角做倒角或倒圓，且折疊模型與平板型式輪廓一致。

**架構：** 文件特徵以持久邊參考記錄角落、型式與尺寸；再生器只接受可辨識的凸緣自由端外角，透過 kernel 的既有倒角／圓角能力修改實體，並把展開操作記入 `SheetInfo`。`flatPattern` 以同一倒角／圓角尺寸在已展開的凸緣平面修剪薄板，避免用折疊後 B-Rep 反推展開幾何。

**技術：** TypeScript、`@3db/model`、`@3db/kernel`、`@3db/regen`、React PropertyManager、Vitest、既有 `verify:ui` E2E 重播。

---

## 範圍與語意

- 獨立特徵；使用者選一個或多個外角邊，每個特徵可選 `chamfer` 或 `fillet`，共用一個正尺寸欄位。
- v1 僅接受邊線凸緣自由端、與板厚方向平行的外角邊；不接受折彎邊、內角、凸緣面選取、基材外角、摺邊、斜接邊及自動收集全部角落。
- 矩形板厚方向角落的倒角在平板上等價為直線切角；倒圓在平板上等價為圓弧切角。平板型式和 DXF 使用同一展開幾何。
- 一個角落尺寸若超過可用材料、kernel 建立失敗、或持久名稱無法重新解析成支援角落，特徵報明確錯誤；不可默默跳過該角。
- 既有零件檔不含新特徵，Schema 遞增且 migration 空轉。

## 檔案責任

- `packages/model/src/schema.ts`：新增 `BreakCornerFeature`、方向/型式/尺寸/持久邊參考資料並納入 `Feature` 聯集；遞增 `SCHEMA_VERSION`。
- `packages/model/src/commands.ts`、`params.ts`、`refs.ts`、`serialize.ts`、`regen/src/dag.ts`：命令驗證、尺寸解析、參考追蹤、migration 與相依順序。
- `packages/regen/src/engine.ts`：解析所選邊、判斷為凸緣自由端，執行 fillet/chamfer，建立穩定面名，回報清楚的 FeatureError；輸出展開操作資料。
- `packages/regen/src/engine.ts` 的 `SheetInfo` 型別與建構路徑：記錄角落相對於所屬 flange、起／末端、型式與已解析尺寸的展開意圖。
- `packages/regen/src/flatPattern.ts`：將角落展開位置轉成 2D cutter，對薄板作布林修剪；讓 outline/DXF 自動讀到線段或圓弧。
- `apps/web/src/actions.ts`、`state/store.ts`、`components/PropertyManager.tsx`、`components/Icon.tsx`、`help/topics.ts` 與 `packages/i18n/src/zh-TW`、`en`：指令入口、屬性面板、選取、圖示、說明與雙語字串。
- `tests/phase7/break-corner.test.ts`：文件、再生、幾何、面命名、展開與 DXF 的單元測試。
- `tests/e2e/phase7-break-corner-ui.js`：重播新增特徵、選取、倒角／倒圓、錯誤回饋與取消／重算。
- `docs/adr/0121-sheet-break-corner.md`、`docs/manual-verification.html`、`handoff.md`：決策、操作驗證項與交接狀態。

## 實作步驟

### 1. 建立模型表示與舊檔相容

- [ ] 新增 `BreakCornerFeature`，內容為 `corners: Ref[]`、`kind: 'chamfer' | 'fillet'`、`size: Expr`；把它加入 `Feature` 聯集及 `FeatureType` 對照表。
- [ ] 將零件 schema 50 升至 51；在 `serialize.ts` 加 50→51 空轉 migration，驗證 schema 50 範例仍照常載入。
- [ ] 新增 `setBreakCorner` command：只收 edge refs；`kind` 僅兩種；尺寸必須是正長度運算式；呼叫共用 `checkExprs`。
- [ ] 加入 params 對尺寸做 `positive` 長度驗證，並加入 refs／DAG 的 breakCorner 分支，使選取邊在上游拓樸改變時按既有持久命名規則解析。
- [ ] 在命令測試加入有效設定、錯誤 Ref 種類、非法型式、零／負尺寸與既有文件 migration 案例。

### 2. 先保護角落分類和折疊幾何

- [ ] 在 `tests/phase7/break-corner.test.ts` 建立金樣：100×60×1.5 板，加一條高 30 的 90° 邊線凸緣；確認自由端兩個角落邊各自可由持久名稱取得。
- [ ] 先寫失敗測試：選自由端的厚度方向直邊可接受；選折彎端、底板直邊、面、弧線邊、內角或其他本體邊均返回指定錯誤。
- [ ] 用拓樸面法向與凸緣 `SheetInfo` fold frame 判斷外角及 flange 端點，不以 topology index 作儲存參照；將解析結果縮成 `{ flangeFeature, end, cornerKey }` 的內部資料。
- [ ] 對每一角落呼叫 kernel fillet 或 chamfer；同一特徵的所有角落需原子成功，任一失敗則釋放中間 shape 並使整項失敗。
- [ ] 用 `nameElements` 以 breakCorner feature ID 和輸入 body names 命名輸出面；測量角落面名稱唯一且尺寸重算後仍能解析原始角落 refs。
- [ ] 驗證 BRep 有效、單一實體、倒角移除體積符合 `0.5 × size² × thickness`（90° 等截面）及倒圓移除面積 `size² × (1 − π/4)` 乘板厚；不適用此理想截面時，以解析面積／體積和 kernel 幾何共同檢查。

### 3. 把特徵意圖帶到平板型式

- [ ] 擴充 `SheetInfo` 加上 `cornerBreaks`；每筆資料只包含已解析且可展開的 flange feature ID、start/end 角位、型式和尺寸，不保存拓樸索引。
- [ ] 再生 breakCorner 成功時把同一筆已分類資料附到 sheet metadata；若選取角落不是 sheet flange 自由端則拒絕，禁止折疊模型已改、平板型式卻遺漏。
- [ ] 在 `flatPattern.ts` 找到該 flange 已展開自由端的局部 2D 點，對薄板厚度方向建立 2D chamfer 或 quarter-circle fillet cutter，布林切除後再抽 outline。
- [ ] 加測手算平板面積差：倒角每角 `size²/2`，倒圓每角 `size² × (1−π/4)`；平板體積等於面積乘板厚；展開尺寸按角落修剪改變，彎曲線不移動。
- [ ] 驗證倒圓輪廓輸出為 ARC、倒角為 LINE，`flatPatternDxf` 往返解析保持實體輪廓和 bend layer；兩角同時選取時面積差為單角差的兩倍。
- [ ] 對半徑大於相鄰邊可用長度／與其他修剪相交的情況給明確 `FlatError`，測試不產生自交或無效形狀。

### 4. 接入指令、UI 與說明

- [ ] `actions.ts` 僅在零件含鈑金且有結果 body 時啟用「斷開角落」。
- [ ] Store 建立新特徵、從拾取 edge 建立 `Ref`、支援新增／移除多個角落並送出 `setBreakCorner`。
- [ ] PropertyManager 提供「倒角／倒圓」選項、尺寸輸入、角落清單及明確的選取提示；重用既有 body/edge pick 流程，不建立新的選取系統。
- [ ] 加入繁中、英文字串與 help topic summary；說明支援範圍和尺寸限制。
- [ ] E2E 重播兩種型式成功、切換後幾何更新、無效角落錯誤可見、取消不寫入、重新開檔結果仍一致；確認 0 Console errors。

### 5. 文件、驗收與交付

- [ ] 新增 ADR 0121，記錄限定角落、持久參考、展開資料來源、倒角／倒圓等價輪廓、失敗規則與限制。
- [ ] 在 `docs/manual-verification.html` 增加一個有可重播步驟的鈑金斷開角落項目，並在 `handoff.md` 更新版本、測試結果、限制及待人工確認。
- [ ] 按使用者要求執行 `npm run check`、`npm run verify:ui -- --only phase7-break-corner-ui` 和完整 `npm run verify:ui`；保存實際結果，不以未執行結果宣稱通過。
- [ ] 使用者要求時才提交／推送；功能、測試、ADR、手冊與 handoff 一起完成後再交付。

## 驗收條件

1. schema 50 舊檔無修改即可載入；schema 51 新特徵可儲存、重開與參數重算。
2. 支援角落能做倒角／倒圓；不支援或幾何無效的邊有明確錯誤，不出錯誤實體。
3. 折疊模型有效、角落面命名唯一且重算後 refs 可解析。
4. 平板型式面積／體積滿足上述手算，展開輪廓與 DXF 線／弧正確，彎曲線保持不動。
5. UI 重播無主控台錯誤，`npm run check` 和使用者要求的 UI 驗證全過。

## 明確不做

凸緣面選取、內角或底板角、摺邊、斜接的交界角、自動收集角落、薄板以外的通用圓角、以折疊 B-Rep 自動推導展開，以及機械可製造性告警規則。
