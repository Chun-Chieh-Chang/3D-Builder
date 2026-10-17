# ADR 0155：零件／組合件側邊欄的兩分頁與「切換只隱藏」契約（E1-P2）

- 狀態：**已完成（2026-10-17）**。純介面，**檔案格式與 Schema 不動**。
- 需求追溯：`docs/sidebar-parity-plan.md`（E1 側邊欄比照工程圖）、[ADR 0133](0133-drawing-sidebar-like-solidworks.md)（工程圖側邊欄，本項要「比照」的對象）、`docs/decisions-2026-10-19.html` 的 E1。使用者在動工前裁定：**指令維持在側邊欄；組合件只換外框成兩分頁、6 個模式面板維持浮動（不動其內部）；先零件（P1）再做組合件（P2）**。E1-P1（零件／組合件兩分頁外框，`4ba2765`）已完成。

## 背景

`docs/sidebar-parity-plan.md` §1 記錄：零件與組合件的側邊欄仍是舊樣式——`App.tsx` 只有兩個**不可點**的標籤（`<span>` `FeatureManager`／`PropertyManager`），樹與屬性是**互斥的兩個畫面**。工程圖在 ADR 0133 已重做成真正的分頁。

E1-P1（`4ba2765`）把 `App.tsx` 的 `<span>` 換成可點的 `.sw-tabs` 按鈕，並把內容包進 `.sw-panel`（零件與組合件皆然）。E1-P2 要補的是**契約**與**組合件的一致性**。

計畫 §2.4 是整個重構的前提：「收合/切換**只用 `hidden`**，所有欄位留在 DOM（`data-field`／`data-action` 找得到）——**這是 129 支 e2e 能不動的前提**」。E1-P1 的實作是**條件渲染**（`panel === 'properties' && editing ? … : …`），切換分頁會把另一邊**卸載**，與 §2.4 不符。

## 決定

1. **兩個分頁**：`.sw-tabs` 的 `role="tab"` 按鈕（`FeatureManager`／`PropertyManager`）；編輯工作階段開啟時自動切到屬性頁（`useEffect` 觀察 `editing`），**FeatureManager 頁仍可點**——可在工作階段中查看樹而不必離開（此**放寬** ADR 0034 決定 9「整個工作階段藏起樹」）。

2. **切換只隱藏、不卸載**（`apps/web/src/App.tsx`）：兩個 `.sw-pane` **都在 DOM**，只以 `hidden` 藏起非當前頁。

   ```tsx
   <div className="sw-pane" hidden={panel !== 'tree'}>{assembly ? <AssemblyTree /> : <FeatureTree />}</div>
   <div className="sw-pane" hidden={panel !== 'properties'}>…</div>
   ```

   `.sw-panel [hidden] { display: none !important; }`（`app.css`:669）確保 `hidden` 勝過 `.sw-pane { display: flex }`，面板因此可被腳本找到卻不顯示。`PropertyManager` 在零件工作階段全程留在 DOM（切到樹頁也不卸載）。

3. **依使用者裁定（計畫 §8.2）：組合件只換外框**。**不**把 6 個模式面板收斂成 PM 群組（推翻計畫 §3 的措辭），模式面板的內部一律不動。

4. **模式面板不能同時掛載**：`MatePanel`／`InsertComponentPanel`／`MovePanel`／`PatternPanel`／`ExplodePanel`／`FormSubPanel` 都對工作階段狀態用**非空斷言**（`asm.mate!`、`asm.insert!`、`asm.move!`…），沒有對應狀態就會在解參考時崩潰。因此**只掛載當前那一個**；切到樹頁時它**仍在 DOM**（`hidden` 只藏不拆），故 §2.4 仍成立。

5. **移除死 CSS**：`.panel-tabs`（`app.css` 舊 148–150 行）在 E1-P1 之後已無人引用（全 repo 僅 `app.css` 與計畫文件提到），移除之。

6. **搜尋列比照 FeatureTree（E1-P2 補完）**：依使用者裁定「再加上 AssemblyTree 比照 FeatureTree」，`AssemblyTree` 補上與 `FeatureTree` **相同的** `div.tree-filter`（`.search-field` 搜尋框，加 `tree.filterNone` 無結果提示）。判定規則抽成純模組 `apps/web/src/components/treeFilter.ts`（`treeNeedle`／`treeFilterMatches`），**兩棵樹共用**（`FeatureTree` 原本自己的一份 `matches` 一併收斂過去），由 `tests/phase8/tree-filter.test.ts` 在 `node` 環境直接驗證。**未做**階層／平面檢視切換：`FeatureTree` 用它把草圖收進消耗它的特徵，組合件的零組件沒有「消耗它的特徵」這種對應概念，加上去只會是空轉控制項（AGENTS.md §3.2）。

7. **除第 6 點（使用者明確要求）外不做新功能**（計畫 §5）：不改任何特徵參數或幾何邏輯。

## 驗收

| 標準 | 結果 |
|---|---|
| 零件與組合件都有**可點**的 FeatureManager／PropertyManager 分頁 | `App.tsx`：`.sw-tabs` 的 `role="tab"` 按鈕；`aria-selected` 隨 `panel` 變 |
| 工作階段開啟時自動進屬性頁；FeatureManager 頁仍可點 | `useEffect(() => setPanel(editing ? 'properties' : 'tree'), [editing])`；樹頁按鈕無 `disabled` |
| **切換分頁不卸載另一頁**（§2.4：欄位留在 DOM） | 兩個 `.sw-pane` 皆無條件輸出，只加 `hidden`；`PropertyManager` 於零件工作階段全程留在 DOM |
| 不因模式面板的非空斷言而崩潰 | 模式面板僅在該工作階段狀態存在時掛載（與變更前相同的掛載集合） |
| 組合件 6 個模式面板維持浮動、內部未動 | 本次未編輯任何 `*Panel.tsx` |
| 與工程圖側邊欄視覺一致 | 沿用 `.sw-panel`／`.sw-tabs`／`.sw-pane`（ADR 0133 同一組樣式） |
| 死 CSS 移除後無殘留引用 | 全 repo `panel-tabs` 僅剩計畫文件一處敘述 |
| 組合件樹有與零件樹相同的搜尋框，看得到、打得了字 | `AssemblyTree`：`div.tree-filter` ＋ `label.search-field` ＋ `input[type=search]`（`aria-label={t('tree.filter')}`） |
| 搜尋規則有單元測試，不靠瀏覽器 | `tests/phase8/tree-filter.test.ts`（7 項）；`treeFilterMatches`／`treeNeedle` 為純函式，`node` 環境直接跑 |
| 未輸入時組合件樹與變更前逐列相同 | `treeFilterMatches` 對空字串／純空白恆真 → `shownComponents`／`shownPatterns`／`shownExplodeSteps`／`shownMates` 與原清單同序同內容；資料列（datum）不受搜尋影響（與 `FeatureTree` 一致） |
| typecheck 0、lint 全過、全量測試 0 失敗 | typecheck **0**；`lint:rules`／`lint:deps`／`lint:i18n`（181 行，未逾基準）全過；全量 vitest **240 檔（236 過／4 略）、0 失敗** |
| `verify:ui` | **未執行**（本機逾時 > 25 分鐘，與 B2.6／B2.7 相同）→ **介面未經瀏覽器驗證** |

## 已知限制與差異（明示，非默默降級）

- **組合件樹仍缺 `FeatureTree` 的階層／平面檢視切換**（搜尋框已補上，見決定 6）。**刻意不做**：`FeatureTree` 的 `treeMode` 只影響草圖要不要收進消耗它的特徵；組合件的零組件沒有這個概念，放一顆切換鈕只會是空轉控制項（AGENTS.md §3.2）。
- **PropertyManager 仍由「工作階段（editing）」驅動，尚未做到計畫 §2.2 的「點選圖面→自動切到屬性、依選取切換群組框」**。本次只交付分頁外框與 §2.4 契約；選取驅動的切換屬後續（需動 `PropertyManager.tsx` 的標題／群組，風險較大）。
- **未經瀏覽器驗證**：分頁在零件／組合件下的實際外觀與行為，待 `verify:ui`／實機確認（E1-P1 亦然）。
- 指令仍在側邊欄（依使用者裁定），未移到頂端 CommandBar。
