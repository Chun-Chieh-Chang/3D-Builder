# ADR 0127：草圖平面的入口與圖面上的基準幾何（Schema 版本不變）

- 狀態：**已完成**（2026-10-11）。
- 對應：C1.1（草圖放在平面上）、C3.2（基準面）、C3.4（座標系統）、D4.6（基準顯示）。三項都是**既有條目的入口補全**，不佔用藍圖新編號（比照 ADR 0123／0124 的慣例）。
- 取代：ADR 0034 決定 10 中「圖面上點不到基準面」這一句——**基準面、基準軸、參考點、座標系統現在都點得到**（畫出來的那一個才點得到，見決定 3）。

## 背景

使用者反映「無法在距離某一基準面處繪製草圖」。底層早就支援（`PlaneDefinition.mode:'offset'` 自 Phase 1C／schema v4 就在，草圖的 `plane` 是一般 `Ref`），證據是 `tests/phase1/planes.test.ts` 11/11 與 `npm run verify:ui -- --only c12` 在真實瀏覽器 PASS。真正缺的是**入口**，以及**一個非同步時序缺陷**：

1. **三步才畫得下去**：要在「特徵」分頁几十个按鈕裡找到「基準面」→ 按 ✔ → 回設計樹點那張面 → 再按「草圖」。
2. **座標系統被明令拒絕**：`commands.ts` 的 `planeRef` 只認預設面／基準面／平面面，雖然它的 `origin/x/y/z` 已經由重建算好放在 `systems`。
3. **基準面在圖面上點不到**：`Viewport.tsx` 只 `setPlanes()` 畫它，拾取管線沒有它；而設計樹又常被 PropertyManager 蓋住（ADR 0034 決定 9 已記過這件事）。
4. **時序缺陷**（使用者看到的「無法建立草圖」就是這條）：`store.frameOf()` 只查「上一次重建回傳的 `frames`」，而重建走 Worker、是非同步的（`store.run()`）。所以剛建立基準面、剛移動回溯條、或剛開大零件而第一次重建還沒回來時按「草圖」，`frameOf` 回傳 null → `enterSketch()` 走 `history.rollback()` → 只留下一句「找不到草圖所在的平面」。

## 決定

### 1. 「偏移草圖」一條命令

`act.offsetSketch`（草圖分頁，`enabled` 條件與「草圖」相同）。按下直接開啟「基準面」的偏移 PropertyManager，並在會話上掛 `EditSession.thenSketch = true`；按 ✔ 後 `commitEdit()` 於會話尾端呼叫 `newSketch({ kind:'datum', name: 那張基準面 })`，立刻進入草圖編輯器。

- **不**在 PropertyManager 裡另設一個「草圖偏移距離」欄位：`PlaneDefinition.offset.distance` 已經有，重複一個欄位就是兩個 SSOT。
- 樹裡**會**留下一個基準面特徵——這是刻意的：草圖的平面仍是一個 `Ref`（不變式 1：草圖不自己存座標系），抑制連動、改參考、DAG 全照 ADR 0034 決定 6／8 走，不必新路徑。
- 按 Esc 取消基準面會話 → 什麼都不產生（`thenSketch` 只在 `commitEdit` 那條路生效）。

### 2. 草圖等得到它的平面（`UiState.pendingSketch`）

`newSketch()` 先用新的 `planeFrameOf(ref)` 判斷：

| 狀況 | 行為 |
|---|---|
| 查得到框架 | 照常插入草圖並進入編輯器（原本的路徑） |
| 查不到、`spent = false` | 把請求存進 `pendingSketch`，**不插入任何特徵**；沒有重建在飛就自己起一次，然後等 `run()` 在 `this.set({ result })` 之後呼叫 `takePendingSketch()`，帶 `spent = true` 再問一次 |
| `spent = true` 仍查不到 | 明示 `sketch.planeNotFound`（基準面被抑制、在回溯條之後、或本來就建不出來），`doc.features.length` 不變 |

兩條分支都由 `tests/e2e/manual-sketch-plane.js` 步驟 5、6 在**真實 Worker 時序**上驗過；步驟 5 先斷言上一次結果確實沒有那張面的框架（`hadIt === false`）才按「草圖」，避免測成恆真（AGENTS.md §3.1 真值存在性防呆、§3.2 禁止空轉閘控）。

### 3. 圖面上點基準幾何（面、軸、點、座標系統）

`packages/render/src/viewer.ts`：

- **平面**：`paintPlanes()` 給每張面的 fill mesh 打上 `userData.planeKey`；新增 `setPlanePicking()`／`pickPlaneHit()`／`setHoveredPlane()` 與 `ViewerEvents.onPlaneClick`。
- **軸、點、座標系統**：`paintDatums()` 從「一批幾何共用一個 material」改成逐條線、逐個點各自成物件並打上 `userData.datumKey`；新增 `setDatumPicking()`／`pickDatum()` 與 `ViewerEvents.onDatumClick`。游標停在上面時用 `highlighted` 的顏色画，與 PropertyManager 已經選用的那一個同一種顯示，所以「已經在格子裡的」與「游標正要點的」看起來是同一件事。
- **優先序集中在一個 `pickOrder()`**：頂點 → 邊 → 基準幾何 → 「模型面」與「基準面」比遠近。基準幾何排在模型面**之前**，因為它畫的時候 `depthTest: false`、永遠蓋在模型上面——使用者看到什麼就點到什麼。這條是 e2e 步驟 8／10 抓出來的產品缺陷：先寫的版本讓模型面贏過紫色軸線，點下去選到的是面。
- **命中半徑一律是螢幕像素**，不隨縮放變形：線 6 px（`ray.params.Line.threshold` 依 `pixelSize()` 換算），點 ≤11 px（把點投影後比距離，與模型頂點 `pickVertex` 的 10 px 同一條規矩）。`THREE.Raycaster` 對 `Points` 的預設 threshold 是 **1 個世界單位**（這個縮放約 43 px），所以 `pickDatum()` 的射線只碰 `THREE.Line`，點交給那 11 px。缺陷由步驟 10b 量出來：離參考點 25 px、明明落在模型頂面上，選起來卻是 `point1`——基準幾何在 `pickOrder()` 裡排在面之前，這種半徑會把模型的點選吃光。
- 點下去走的是 `store.treeClick(key)`，與設計樹點**同一條路**：正在定義基準特徵時進選取方塊（`putDatumRef`），否則變成選取。不新第二條選取路徑。
- 只在「沒有 PropertyManager 會話、也不是量測」時開放（`picking().planes`／`.datums`）；正在定義某個基準特徵時，該特徵 `pickable()` 允許的那一類（面／邊／頂點／平面）照樣開放，所以面板開著也能把參考點點進方塊。
- **進 `PickFilter`（D5.4）**：多一個 `planes`（繁中「基準面」、英文 "Planes"，鍵 `select.filterPlanes`），`options.pickFilter` 多一個布林、預設開；舊的儲存值沒有這一欄時 `parseOptions` 當它開，升級不會把原本能點的東西關掉。軸／點／座標系統**不進濾鏡**——它們依 D4.6 本來就由設計樹的眼睛控制顯示，看不見的東西點不到，不必第二個開關。
- **兩套濾器分開是設計，不是缺陷**（本 ADR 第一次把這裡判成「閘控空轉」、還把 `patch.pickFilter` 接到 live，已被既有 e2e 反證撤回；過程見 `DEV_LOG.md` 2026-10-11（夜間三）問題 2）：「選項」那一列叫「**開始時**可以點選的元素」= `options.pickFilter`，是**下一份零件的起手值**，改它不動已經打開的那一頁；圖形區的「選擇濾器」（`.pick-filter`，走 `store.setPickFilter`）才是**這一頁的即時開關**。e2e 步驟 11 點的是圖形區那個「基準面」核取方塊，同一個像素在關／開兩種狀態各點一次來驗（關：選不到；開：選到基準面）。被打破過的既有行為現在由 `manual-c22.js` 的 `optionOff`／`startedOff` 守著。
- 預設基準面依 D4.6 本來是隱藏的（被選取或被引用才出現），所以這條入口主要服務「已經看得見的基準面」。

### 4. 座標系統可以當草圖平面

- `commands.ts` `planeRef()` 認 `coordSys`；太晚的給新訊息 `cmd.coordSysMustBeEarlier`（繁中＋英文）。
- `engine.planeOf()` 在 `planes` 查不到時改用 `systems`，框架由 `@3db/model` 新增的純函式 `systemFrame(c) = { origin, xDir: c.x, yDir: c.y, normal: c.z }` 給出。
- 重建的 `coordSys` 分派順帶把框架寫進 `frames`——`store.planeFrameOf()` 才查得到，與基準面同一條路（衍生資料，不寫回文件：不變式 1）。
- `datumSlots.datumType()` 把 `coordSys` 歸為 `plane`，於是「平面」方塊、`DatumPicker` 按鈕、指令驗證、DAG **四處不會各說各話**（ADR 0034 決定 8）。座標系統因此也順帶能當基準面的參考面、排列方向等（都讀同一張表、同一個 `planeOf`）。
- `Viewport` 的平面繪製多一條：座標系統被選取／被引用時，画出它 XY 那一格，讓「草圖會落在哪」看得見。

### 5. 「角度草圖」一條命令，與「記住上次的偏移距離」

- `act.angleSketch`（草圖分頁，`enabled` 條件與「草圖」相同）：`newAngleSketch()` 開一個 `{mode:'angle', plane: basePlane(), axis: emptyRef('axis'), angle:'45'}` 的基準面會話，照決定 1 掛 `thenSketch`。
- **轉軸留空是預期的起點，不是錯誤**：`planeDefinition()` 的 `case 'angle'` 本來就走 `axisRef()`，而空方塊在选取過程中是被允許的（`commands.ts` 的註解：References may still be empty while the user picks them）；什麼都不填就按 ✔，由既有的驗證／重建說明缺的是「旋轉軸」，不是另立一條新路徑。
- 轉軸怎麼填進去：圖面點一條直線邊或一條基準軸（決定 3 的 `pickOrder`），或按面板上的基準軸按鈕——兩條都走 `store.treeClick`。
- 平面框架仍由既有 `mode:'angle'` 算（0° 與參考面平行、90° 垂直）。e2e 步驟 9 用實測收：轉軸點 z 軸、角度 30，`result.frames` 裡那張面的法線 z 分量 = cos 30°（1e-6）。
- **記住距離**：`commitEdit()` 確定一個 `mode:'offset'` 的基準面時，把它的 `distance` 寫回 `options.datumOffset`，下一次「基準面」與「偏移草圖」都從那個值起算。只寫「是個有限數字」的值（`Number.isFinite(Number(...))`），`$h+2` 這種運算式**不被吞成數字**、就不會被記成錯的東西；`parseOptions` 讀回來時同樣只認純數字。e2e 步驟 7：第一次填 25 → 第二次面板顯示的是 25，改 40 → 新面在 z = 40。
- 記在**選項**而不是文件欄位：這是「這個人習慣的起手距離」，與零件無關，所以存檔格式與 Schema 都不動（決定 6）。

### 6. Schema 版本不變（54）

沒有新欄位、沒有新特徵。`Ref.kind = 'datum'` 本來就能指向任何基準特徵，而舊檔不可能寫出「草圖綁座標系統」（會被拒），因此**不需要遷移**，也不需要新舊檔樣本。

### 7. 說明（help）與手工條目

新增 `help.offsetSketch`／`help.angleSketch` 的 `summary／body／keywords／see`（繁中與英文成對；說明的鍵名不能用連字符，`offset-sketch` 要寫成 `offsetSketch`，見 `apps/web/src/help/topics.ts` 的 `helpKey()` 與 `packages/i18n/test/i18n.test.ts`），`help.sketch.summary` 補上「座標系統」。
兩篇 body 是**第二次才補的**：第一次刻意不寫，因為 `tests/phase8/help.test.ts` 規定「有 body 的主題必須被 `docs/help-links.json` 的手工驗證條目覆蓋」，而那次沒有新增手工條目。第二次照使用者裁示補條目：`docs/help-links.json` 的 `C14` 加上 `offset-sketch`、`angle-sketch`，`docs/manual-verification.html` 的 C14 加進步驟 8–11（偏移草圖與改距離連動、記住上次距離、轉軸沒填、角度 30 的斜面），並用 `SYNC_MANUAL_HELP=1 npx vitest run tests/phase8/help-manual.test.ts` 把條目的「程式內的說明」那一列同步過去。
C14 原本的步驟 7 寫著「軸、點、座標系統在圖面上點不到」，那是決定 3 之前的真相，現在是**錯的**——同版改成「都可以點，基準面要在選擇濾器裡勾著」，並把「已自動重播驗過」那列改成點名兩個腳本（`manual-c14.js` 步驟 1–7、`manual-sketch-plane.js` 步驟 7 的圖面點選與 8–11）。

## 實作位置

| 位置 | 做了什麼 |
|---|---|
| `packages/model/src/commands.ts` | `planeRef` 認 `coordSys`；`datumFeature` 型別加 `coordSys` |
| `packages/model/src/datums.ts` | `systemFrame(CoordSystem): PlaneFrame` |
| `packages/regen/src/engine.ts` | `planeOf` 的 datum 分支 fallback 到 `systems`；`coordSys` 分派寫入 `frames` |
| `apps/web/src/state/store.ts` | `EditSession.thenSketch`、`UiState.pendingSketch`、`planeFrameOf`／`frameOf` 拆分、`newSketch(plane, spent)`、`newOffsetSketch()`、`newAngleSketch()`、`openDatumPlane(def, thenSketch)`、`basePlane()`、`commitEdit()` 接續草圖並把 `offset` 距離寫回 `options.datumOffset`、`run()` 尾端 `takePendingSketch()`、`isPlane` 認 coordSys（曾把 `setOptions()` 的 `pickFilter` 接到 live，**已撤回**：那是「下一份零件的起手值」，即時開關是 `setPickFilter`） |
| `apps/web/src/actions.ts` | `sketchPlane` 認 coordSys；新動作 `offset-sketch`、`angle-sketch`（草圖分頁，`enabled` 與「草圖」同） |
| `apps/web/src/state/datumSlots.ts` | `datumType` 把 coordSys 歸 plane；`pickable()` 回報 `planes`（方塊允許圖面點的那一類） |
| `apps/web/src/components/Viewport.tsx` | `picking().planes`／`.datums`、`setPlanePicking`／`setDatumPicking`、`onPlaneClick`／`onDatumClick → store.treeClick`、coordSys 草圖平面繪製、濾器清單多 `planes` |
| `apps/web/src/components/PropertyManager.tsx` | `DatumPicker` 列出座標系統（給「平面」方塊） |
| `apps/web/src/components/ParametersDialogs.tsx`、`apps/web/src/strings.ts` | 「選項」的選取濾器多一欄「基準面」（`PICK_FILTER_LABEL` 帶 `select.filterPlanes`） |
| `apps/web/src/options.ts` | `pickFilter.planes`（預設開，舊儲存值沒有該欄時也當開）、`datumOffset`（預設 10，`parseOptions` 只認純數字） |
| `packages/render/src/viewer.ts` | `PickFilter.planes`、`setPlanePicking`／`pickPlaneHit`、`setDatumPicking`／`pickDatum`、`paintPlanes` 打 `planeKey`、`paintDatums` 逐線逐點打 `datumKey`（含 hover 上色）、`onPlaneClick`／`onDatumClick`、集中在 `pickOrder()` 的點擊優先序（頂點→邊→基準幾何→面與平面比遠近）、`setPickFilter` 清掉過期的 hover |
| `packages/i18n/src/zh-TW/`、`packages/i18n/src/en/` | `act.offsetSketch`／`act.angleSketch`、`select.filterPlanes`、`cmd.coordSysMustBeEarlier`、`help.offsetSketch`／`help.angleSketch` 的 `summary／body／keywords／see`（成對）、`help.sketch.summary` 補「座標系統」 |
| `docs/manual-verification.html`、`docs/help-links.json`、`docs/verification-coverage.md` | C14 步驟 7 的「點不到」改成「點得到」、新增步驟 8–11、`help-links.json` 的 C14 加兩個新主題、覆蓋表新增這支腳本那列 |
| `tests/phase1/planes.test.ts` | `describe('coordinate system planes')` 4 項：體積實測、跟隨參考點、被基準面引用、指令拒絕＋抑制連動 |
| `tests/e2e/manual-sketch-plane.js` | 14 步真實瀏覽器重播：等待／拒絕兩條分支、質量中心 z = 28 的實體量測、基準面／基準軸／參考點／座標系統在圖面點到即選取、基準點的命中半徑不外溢、角度 30 的法線 = cos 30、記住 25、濾器關／開同一個點 |

## 自我紅隊四問（AGENTS.md §2）

1. **輸入破壞**：偏移距離與角度仍由既有 `ValueInput` → `checkExprs` → `evalLength` 管（本次未改，非法運算式在指令層拒絕，沒有 `Math.round`／`Math.abs` 式的默默篡改）；新增的 `planeFrameOf() === null` 三種成因全部走「明示原因」，沒有 `?? 0` 式的靜默退化，也不插入特徵。「記住距離」只記 `Number.isFinite` 得到的值——`$h+2` 這種運算式**不被記成一個數字**；`parseOptions` 讀舊儲存時，缺 `planes` 欄當「開」、缺 `datumOffset` 或值不是純數字时用預設 10，升級不會讓功能靜默失靈，也不會記進一個不能用的值。
2. **幾何自相交**：本 ADR 不新增幾何運算路徑（沒有新的布林運算），故無新相交面。新增的是**點選命中**：半徑以螢幕像素計且有上界（線 6 px、點 ≤11 px，與模型頂點同一條規矩），基準幾何不搶走模型的面／邊／頂點——排序仍是頂點 → 邊 → 基準幾何 → 面與平面比遠近。反面證據由 e2e 步驟 10b 正面驗：離參考點 25 px、落點明明在模型頂面上，選到的必須是那個面（修 `THREE.Raycaster` 對 `Points` 預設 1 個世界單位的半徑之前，實測選到的是 `point1`）。
3. **依賴鏈完整**：`schema.ts`（未變）→ `commands.ts`（`planeRef`）→ `refs.ts`（`mapRefs` 的 sketch 分支本來就改 `plane`）→ `dag.ts`（`parentsOf` 對 datum 名稱即特徵 id，座標系統自動成為父項）→ `engine.ts`（`planeOf`／`frames`）→ `store.ts`／`actions.ts`／`Viewport.tsx`。測試正面斷言 `dependencies(doc).parents.get('s2') === ['y1']` 與抑制連動 `['y1','s2','e2']`。「角度草圖」多用的 `axis` 方塊走的是既有 `axisRef`／`slot.rotationAxis`／`DatumPicker` 那條，沒有新格子。
4. **規格真實性／零 Mock**：e2e 用 `result.mass.volume`、`result.mass.center`、`result.frames`、`result.points`、`result.systems` 實測；單測用 `kernel.massProps` 的體積（$12000 + \pi\cdot4^2\cdot6$）；兩條非同步分支都先斷言前提（`hadIt === false`、`waited === true`、`added === 0`），圖面點選也先斷言前提（選取已清空、該像素 `pickOrder` 的 `vertex<0 && edge<0 && datum===座標系統`），角度用 `|normal.z| = cos 30°` 而不是把期望寫死。

## 量測（2026-10-11）

- `npx vitest run tests/phase1/planes.test.ts`：**15/15 PASS**（原本 11 項全保留）。
- `node scripts/verify-ui.mjs --only sketch-plane`：**PASS**（6 步，14.6 s）。
- 相關瀏覽器回歸 `--only "sketch-plane|phase3-datums|phase3-select-elements|manual-c11|manual-c12|manual-d4"`：**6/6 PASS**（基準面的圖面點選沒有搶走模型面／邊／頂點的優先序，基準方塊多認一種 datum 也沒有打舊的腳本）。
- `npx tsc -p tsconfig.json --noEmit`：0 錯誤。
- `npm run lint:rules`／`lint:deps`／`lint:i18n`：全過。

### 第二批（決定 3 的軸／點／座標系統、決定 5、決定 7）量測，2026-10-11 夜

- `node scripts/verify-ui.mjs --only sketch-plane`：**PASS，14 步 27.6 s**（新步驟 4b「點座標系統的箭頭」、10b「基準點的命中不外溢」在內）。
- 拾取管線回歸 12 支：`--only "sketch-plane|manual-c14|manual-c21|manual-d6|manual-c26|manual-c23|manual-c7|manual-c12|manual-c20|manual-c11|phase3-select-elements|phase3-datums"` → 9 PASS；c23／c26／d6 三紅為同期他人提交引起的 HMR 重載（錯誤形如「button disabled: 圓角」），**單獨重跑 3/3 PASS**（47.6 s／20.3 s／30.5 s）。
- 缺陷 10b 的數值：修 `pickDatum` 之前，離參考點 25 px 的像素上 `pickDatum` 回 `point1`、`selected` 也是 `point1`、`face: null`；修後同一像素 `pickDatum !== point1` 且選到的是模型面。縮放換算：`pixelSize()` = 0.022956 mm/px，THREE 對 `Points` 的預設 threshold（1 世界單位）在這種縮放是 **≈ 43 px**。
- 步驟 4b 的第一次紅燈是前提斷言抓出來的：`pickDatum` 已回 `csys1`，但 `pickOrder` 回 `vertex: 1`（那個像素上 10 px 內確實有個模型頂點）→ 測試改成先轉等角、並把「該像素只有基準幾何」寫成斷言，優先序沒有動。
- `npx vitest run`：**2607 passed｜22 skipped（195 檔通過、3 檔略過），0 failed**（21:31 那份樹；之後另一位又加入了 `tests/redefine-sketch-plane.test.ts` 等，數字屬下一個時段）；`npx tsc -p tsconfig.json --noEmit`：0 錯誤；`lint:rules`／`lint:deps`／`lint:i18n`：全過。
- 375×667／768×1024 窄屏實測（數值與判定見 `DEV_LOG.md` 同日 §4）：新增控件本身沒有被裁、沒有挤出視口；被量出超出的是 `.menu-panel` 既有的錨定方式（375 時文件橫向溢出 345 px、768 打開「草圖」面板時 134 px），屬既有缺陷、影響所有分頁。**2026-10-11 使用者裁定：不動，只記錄**（新增控件本身在兩個視口下都沒有被擠或裁字）；同理，功能區按鈕 29 px 高／13 px 字維持與其他按鈕一致，不為觸控另開尺寸。
- 完整批次 `npm run verify:ui`（126 支）在 10-11 21:5x 跑到第 34 列**中止**：`Error: no answer to Page.navigate in 120s — the browser or the page is stuck`（620473d 的 deadline 把原本的無限卡死變成會報錯，但整批仍然斷在中途）；該列之前 `manual-d6` 只花 5.2 s（平常 30 s），是「頁面其實沒重載」的形。**尚未有今日的 126 支全數數字**，覆蓋表那列已改成這麼寫。
- 批次中跑出的一支**真紅燈**是這次的回歸：`manual-c22.js __manualC22.optionOff`／`startedOff`（`{"off":true,"stillOn":false}`）。根因是決定 3 那條「把 `setOptions` 的 `pickFilter` 接到 live」——**判定錯誤，已撤回**（「開始時可以點選的元素」是下一份零件的起手值，即時開關本来是 `setPickFilter`）。撤回＋步驟 11 改點圖形區那個 box 之後：`manual-c21` 19.3 s、`manual-c22` 46 s／3.2 s／2.4 s、`manual-sketch-plane` 28.2 s → **5/5 PASS**。
