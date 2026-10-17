# 零件 / 組合件側邊欄比照工程圖(ADR 0133)重做 — 範圍與方案

狀態:**待使用者確認方向後開工**(未動任何程式)
日期:2026-10-19

## 1. 現況(已核對程式碼)

- 工程圖的側邊欄在 2026-10-13 已比照 SolidWorks 重做([ADR 0133](adr/0133-drawing-sidebar-like-solidworks.md)):`DrawingPanel.tsx` 用 `.sw-panel` / `.sw-tabs` 樣式,分「工程圖樹 / 屬性」,屬性依選取切換、可收合群組框、常駐指令列、右側工作窗格。
- **零件與組合件仍是舊樣式**(ADR 0133 §限制 第一條明載「要等使用者確認方向後再比照」):
  - `App.tsx` 的左面板只有兩個**不可點的標籤**(`<span>` `FeatureManager` / `PropertyManager`),內容用一個大三元式切換:
    - 零件:`editing ? <PropertyManager/> : <FeatureTree/>`(編輯時換面板,平常是樹)
    - 組合件:`mating/inserting/moving/patterning/exploding/forming ? <各 Panel/> : <AssemblyTree/>`
  - 也就是「樹」與「屬性」是**互斥的兩個畫面**,不是 SW 的兩個分頁 + 依選取切換的 PropertyManager。

| 檔案 | 行數 | 角色 |
|---|---|---|
| `apps/web/src/App.tsx` | 92 | 左面板分頁與內容切換(要改) |
| `apps/web/src/components/FeatureTree.tsx` | 689 | 零件設計樹 |
| `apps/web/src/components/PropertyManager.tsx` | **3140** | 零件屬性(全部特徵面板都在這) |
| `apps/web/src/components/AssemblyTree.tsx` | 332 | 組合件樹 |
| `apps/web/src/components/{Mate,InsertComponent,Move,Pattern,Explode,FormSub}Panel.tsx` | 各 | 組合件的模式面板 |
| `apps/web/src/components/CommandBar.tsx` | 147 | 頂端指令列 |
| `apps/web/src/app.css` | 621 | 另有 `.sw-panel`/`.sw-tabs` 樣式可重用 |
| `tests/e2e/*.js` | **129** | 大量依賴 `data-field`/`data-action`/`data-view` |

## 2. 目標(比照 ADR 0133)

1. **兩個真正的分頁**(可點):FeatureManager(樹)/ PropertyManager(屬性);在圖面點到東西→自動切到屬性,在樹上點選→留在樹。
2. **PropertyManager 依選取切換內容**:標題列(圖示 + 種類 + 名稱 + ✓),內容是可收合的**群組框**(零件:特徵參數;組合件:結合/移動/排列…)。
3. **用 `.sw-panel` 樣式**,和工程圖視覺一致。
4. **收合/切換只用 `hidden`**,所有欄位留在 DOM(`data-field`/`data-action` 找得到)——這是 129 支 e2e 能不動的前提。
5. (可選,見 §8)**指令**是否移到頂端 CommandBar。

## 3. 分階段做法(建議)

- **E1-P0 盤點(唯讀)**:列出 `App.tsx` 切換、`panel-tabs`、以及 e2e 依賴的選擇器(`data-field`/`data-action`/`.panel-tabs`/`.pm-row`…),產出一張「不能動的介面契約」清單。
- **E1-P1 零件**:`App.tsx` 分頁改成可點、`FeatureTree`/`PropertyManager` 外包 `.sw-panel`、`PropertyManager` 依 `selected/editing` 切換標題與群組框。**不動**任何 `data-*`。
- **E1-P2 組合件**:比照 P1,把 6 個模式面板收斂成 PM 群組;`AssemblyTree` 比照 `FeatureTree`。
- **E1-P3 樣式與 i18n**:`app.css`、分頁/群組標題的中英文鍵。
- **E1-P4 驗證**:全量 `verify:ui` 必須維持綠(見 §6)。

## 4. 風險與緩解

| 風險 | 影響 | 緩解 |
|---|---|---|
| `PropertyManager.tsx` 3140 行、橫跨所有特徵 | 一次改動面極大、易 regression | **只改外框(分頁/標題/群組),不改各特徵的欄位邏輯**;分批提交 |
| 129 支 e2e 依賴既有 DOM | 改結構會整批紅 | P0 先鎖「介面契約」;全程保留 `data-*`;每批跑 `verify:ui --only` |
| 已存在的 typecheck 阻塞 | 目前 `npm run check` 卡在他人 B2.2 的 `DrawingViewport.tsx` | 開工前先確認那個工作階段收尾 |
| 工作樹有其他工作階段檔案 | 多階段衝突 | 在 worktree 隔離(勿動他人檔案) |

## 5. 不做(本次範圍外)

- 不改任何特徵的參數邏輯或檔案格式(Schema 不動)。
- 不做新功能。
- 組合件右側「工作窗格/調色盤」若沒有對應物,不強做(見 §8)。

## 6. 驗證計畫(每批)

- 全量 `npx vitest run` 綠(含既有 e2e 等價的單元)。
- 全量 `npm run verify:ui` **維持既有通過數**(工程圖那批後的最新基準需先實測)。
- 反向對照:至少一項刻意改壞要紅(AGENTS.md §2)。
- 記憶體:純 UI,不碰核心,WASM 議題不適用(§3.5)。

## 7. 工作量(粗估)

- P0 + P1(零件):中等(1 批)
- P2(組合件):中等(1 批)
- P3 + P4:小~中
- 合計:**約 2~3 批**(建議放在額度重置後)。

## 8. 已裁定(使用者 2026-10-19)

1. **指令位置**:維持在側邊欄(與工程圖現況一致)。
2. **組合件浮動面板**:只換外框成兩分頁,6 個模式面板維持浮動(不動其內部)。
3. **分階段**:先零件(P1)通過驗證,再做組合件(P2)。