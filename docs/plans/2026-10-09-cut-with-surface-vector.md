# 以曲面除料：任意向量與保留側實作計畫

> **執行說明：** 這是獨立實作計畫；保留既有 plane/face 方向與反轉語意，分別完成模型向後相容、核心布林、UI 和驗證。

**目標：** 讓「以曲面除料」可沿使用者輸入的固定 XYZ 向量掃掠曲面，並明確選擇保留掃掠方向後側或前側。

**架構：** 文件方向成為 `Ref` 或帶標籤的固定向量兩者之一；舊文件的 `Ref` 形式不變。再生器把方向解析成向量，利用既有 `Kernel.surfaceTool` 造刀具，並使用差集保留 behind 或交集保留 ahead；`reverse` 仍反轉實際方向。此版不做沿自由曲面逐點法向移動的非直線掃掠。

**技術：** TypeScript、`@3db/model`、OCCT/libcascade kernel、regen、React PropertyManager、Vitest、既有 E2E 重播。

---

## 範圍與語意

- 特徵仍有單一實體 target、一個曲面 body、一個 direction、一個 reverse 旗標；新 direction 可為既有平面／平面面 Ref 或 `{ kind: 'vector', value: [x,y,z] }`。
- XYZ 以零件文件模型座標系輸入；顯示值允許任意比例，幾何核心會正規化；全零、非有限值或數值溢位向量拒絕。
- `reverse` 反轉方向向量；`keep: 'behind' | 'ahead'` 指定保留曲面原位置相對於實際方向的哪一側。向量改號且 keep 改側的組合須與等價幾何相同。
- 舊文件未寫 `keep` 時固定採 `behind`，與現行差集結果相同。舊 plane/face `direction` 和 `reverse` 仍有效。
- Surface body 不變；target 仍要求單一實體；刀具未切中、切掉全部、保留側空集合、參考遺失或方向無效均有清楚錯誤。
- 不新增局部曲面法向掃掠、多向量路徑、曲面延伸、多實體 target 或布林後自動修復。

## 檔案責任

- `packages/model/src/schema.ts`：新增 `CutDirection` 型別，將 feature `direction` 改為 Ref 或 vector union，新增 `keep`，schema 版本 51（若斷開角落先行改版，實作時採當時主線版本遞增，不覆蓋其 migration）。
- `packages/model/src/commands.ts`、`params.ts`、`refs.ts`、`serialize.ts`：方向型別／非零有限向量命令驗證、參數保留、只追蹤方向為 Ref 時的拓樸參考、舊檔 migration。
- `packages/kernel/src/kernel.ts`：確認/補足任意方向刀具的 reach 計算、保留側差集與交集共用的 kernel 操作；面生成來源不變。
- `packages/regen/src/engine.ts`、`dag.ts`：解析 Ref 法向或向量，套用 reverse 與 keep，再透過 boolBodies 處理命名、本體碎片與錯誤。
- `apps/web/src/state/store.ts`、`components/PropertyManager.tsx`、`i18n`：方向模式切換、平面選擇或 XYZ 欄位、保留前／後側選項、操作說明與字串。
- `tests/phase4b/thicken-cut.test.ts`：kernel／regen／schema／舊檔／新方向／兩側結果測試。
- `tests/e2e/phase4b-surface-vector-ui.js`：瀏覽器重播方向輸入、反轉、保留側、錯誤提示。
- `docs/adr/0122-cut-with-surface-vector.md`、`docs/manual-verification.html`、`handoff.md`：決策、手冊步驟與交接。

## 實作步驟

### 1. 以測試定義方向語意

- [ ] 在 `tests/phase4b/thicken-cut.test.ts` 加入可計算金樣：40×30×20 方塊、60×50 平面曲面置於 z=12；沿 +z 切得 behind 厚 12、ahead 厚 8；現有 reverse 測試預期不變。
- [ ] 加入斜向量金樣：使用法向與 [1,2,2] 平行的裁切平面；在盒體上直接計算切面到外框的截面與兩側體積，驗證未正規化的 [2,4,4] 得相同結果。
- [ ] 加入方向等價測試：`(+v, behind)` 與 `(-v, ahead)` 留下同一實體；`reverse` 單獨改變保留／去除區域的方向。
- [ ] 加入全零、NaN、Infinity、無法形成實體刀具、未命中、保留側無實體與切光 target 的拒絕測試。
- [ ] 加入 migration 測試：舊 v31 文件採原 Ref + reverse + 默認 behind，重建結果和目前基線一致。

### 2. 更新文件型別與命令

- [ ] 在 schema 定義 `type CutDirection = Ref | { kind: 'vector'; value: Vec3 }`；`CutWithSurfaceFeature.direction` 使用該型別，新增可選 `keep`，缺省等於 `behind`。
- [ ] 提升 schema 版本一級並新增空轉 migration；如同一分支已先納入斷開角落，合併到較新版本並逐級保留兩條遷移，不重用 schema 編號。
- [ ] 修改 `setCutWithSurface` command 接受 CutDirection 與 keep；Ref 僅准 datum 或 face，vector 三分量皆需 `Number.isFinite` 且範數大於容差。
- [ ] params 不對向量分量套長度運算式；`refs.ts` 僅在 `direction.kind !== 'vector'` 時列出方向參考。
- [ ] 確認 `Feature` union、feature reference visitor、dag 未把 vector 當成面或基準資料；序列化/反序列化保留向量數值與 keep。

### 3. 接通再生器和核心保留側

- [ ] 將 `Engine.cutWithSurface` 分解為 `directionVector` 解析：Ref 用既有 plane resolver normal；vector 用輸入；reverse 在正規化前後等價地改號。
- [ ] 對長度非有限或低於 `1e-12` 的向量回傳 `FeatureError`，防止 NaN 流入 OCCT。
- [ ] 呼叫 `Kernel.surfaceTool` 生成刀具；`keep === 'behind'` 用 target 減刀具，`ahead` 用 target 與刀具交集。保留 `nameElements`、`boolBodies`、surface 面來源命名和 `changed`／空結果檢查。
- [ ] 確認 kernel 刀具 reach 能覆蓋斜向穿過 target bounding box 的最遠路徑；若測試反例失敗，將 reach 改成方向投影的 target 對角範圍加 surface 外伸界限與容差，且不改既有垂直案例。
- [ ] 驗證改尺寸、換向量、換 keep 後面名稱穩定且唯一；target 被切成多塊時沿用一般除料的 body 命名／碎片規則。

### 4. 接入屬性面板與說明

- [ ] Store 的新建預設方向保持 `plane:front`、keep 預設 behind，舊面板的 datum/face 模式不變。
- [ ] PropertyManager 加方向來源選擇「基準面／平面」與「XYZ 向量」；vector 模式顯示三個數值輸入，初始 [0,0,1]，即時顯示合成箭頭方向；保持面選取行為和 Ref 模式。
- [ ] 增加「保留方向後側／前側」選項；reverse 仍呈現原有反轉方向控制。組合操作文字明確指出 keep 相對於反轉後方向。
- [ ] Enter／失焦提交合法有限數值；零向量或非數字顯示欄位錯誤且不執行 regen；Undo/Redo、取消編輯及重新開檔保留一致。
- [ ] 加繁中與英文 UI 字串和 help topic summary，說明座標系、reverse 與保留側的關係。
- [ ] E2E 重播：Ref 預設功能、輸入斜向量、正反向、前後側、向量無效、切中結果和不相交訊息；確認 0 Console errors。

### 5. 文件、驗收與交付

- [ ] 新增 ADR 0122，記錄 direction union、vector 座標系、keep/reverse 次序、零向量限制、kernel reach 與不做局部曲面法向的範圍。
- [ ] 在 `docs/manual-verification.html` 增加平面參考相容、斜向量前後側與錯誤向量驗證步驟；更新 `handoff.md` 測試與限制。
- [ ] 按使用者要求執行 `npm run check`、`npm run verify:ui -- --only phase4b-surface-vector-ui` 和完整 `npm run verify:ui`；記錄實際結果與略過項。
- [ ] 使用者要求時才提交／推送；此項獨立交付，不併入鈑金斷開角落提交。

## 驗收條件

1. 舊 Ref 方向及舊文件輸出維持基線幾何；schema 升版舊檔遷移不改變結果。
2. 任意有限非零 XYZ 方向都正確建刀具，向量比例不影響幾何。
3. behind/ahead 與 reverse 組合符合定義；手算金樣的體積／截面吻合。
4. 零向量、非有限、未命中、切光、無效參考均有可讀錯誤，不洩漏 kernel handle、不留下部分結果。
5. UI E2E 無主控台錯誤，`npm run check` 和使用者要求的 UI 驗證通過。

## 明確不做

沿曲面局部法向移動的彎曲掃掠、曲線路徑、可調刀具延伸距離、多個實體 target、曲面自動延伸、額外的「切除兩側」模式。
