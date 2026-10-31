# 草圖互動方案：執行驗收表

更新：2026-10-30（P1 第二批完成）。使用者已核准[方案](plan.md)。本表為實作進度與案例驗收的單一來源；不把部分通過改寫成整階段完成。

整合基準：推送前發現遠端新增7項提交，已整合至6019692之上，保留交點尺寸參照、非退化拘束及重複拘束提示；原盤點78faeda是歷史比較基準。整合後8個相關檔案175項測試通過，包含遠端交點／拘束退化／同心同徑回歸；新增候選及兩項交點瀏覽器流程3/3通過（out/sketch-p0-merged-ui.json）。型別、靜態守門及建置通過，遠端CI仍以本次提交實際結果為準。

## P0 第一批：選取消歧、工具狀態與取消

已實作：選取模式的候選清單、Tab／Shift+Tab循環預覽、畫布確認、面板明確選取與Ctrl加選。保留點優先預設；離開候選區、文件變更、換工具即解除鎖定；Esc取消候選不清除原選取。清單顯示類型、ID及已轉換模型圖元的來源名稱。吸附提示補上來源圖元 ID（如端點附帶所屬曲線、中點、交點雙來源、相切目標）。全域快捷鍵與各尺寸／數值輸入框加入 IME 組字防護（`isComposing || keyCode === 229`），避免輸入法組字按 Enter 或 Esc 誤觸工具或工作階段取消。針對 1000 圖元無拘束草圖新增 PlaneGCS 原生自由度診斷快速路徑，解除個別點／圓重覆試解瓶頸。

工具與工作平面名稱、目前參照放到草圖屬性面板狀態標題（`[data-sketch-tool-status]`），保留文字。Esc取消拖曳／框選不再於放開滑鼠時提交；Worker對取消請求重新求解已提交草圖，消除殘留預覽。沒有更動文件Schema。

| 案例 | 狀態 | 已有證據／仍缺項 |
|---|---|---|
| A01 平面入口 | 通過 | 30° 旋轉自訂平面正視於與等角視圖下游標落點與真實求解線段兩端誤差均 < 1e-4 mm；工具狀態明確顯示草圖名稱、旋轉平面名稱、工具名稱與下一步提示。`manual-sketch-plane.js` 全部 12 步通過（`out/sketch-p0-ui.json`）。 |
| A02 Esc分層與IME防護 | 通過 | 全域快捷鍵、尺寸修改框、斷面輸入框及屬性面板輸入框均已加入 IME 組字防護（`isComposing || keyCode === 229`）；尺寸修改框普通 Esc 正確關閉修改框而不退出草圖／工具。12 種建立工具首點後 Esc、中途多階段取消、修改工具 Esc 退回選取及一次 Undo 還原原生與瀏覽器實測全部通過。 |
| A03 完成／取消整個草圖 | 通過 | 真實瀏覽器建立帶驅動尺寸的矩形，重新編輯新增圓後取消還原；再次編輯完成後Undo／Redo還原實體及尺寸（`manual-sketch-session-rollback.js` 通過）。 |
| A04 重疊／短線消歧 | 通過 | 三種縮放（25%、100%、400% 即 4.5、18、72 px/mm）× 兩種 DPR（1 與 2）下的 Tab／Shift+Tab 循環預覽、畫布點選確認、候選面板按鈕可見性與 pointer 命中斷言均通過（`manual-sketch-selection-candidates.js`）。 |
| A05 多選／右鍵與操作 | 通過 | 原生左右雙向框選、Ctrl 多選／反選、右鍵鎖定候選保留、右鍵多選點選端點保留多選、鏈選 `selectChain`、刪除與一次 Undo 全部通過（`sketcher.test.ts` 與 `manual-sketch-selection-candidates.js`）。 |
| A06 吸附穩定性與來源提示 | 通過 | 吸附提示明確包含來源圖元 ID（如端點附帶所屬曲線、中點、交點雙來源、相切目標）；原生密集端點、中點、交點、垂直、相切軌跡重播測試與 Ctrl 暫停吸附斷言通過（`sketcher.test.ts`）。 |
| E02 效能與診斷加速 | 通過 | 1000 圖元無拘束自由度診斷快速路徑建立；Node 原生基準：1000 圖元求解+診斷 23.3 ms、select p95 0.45 ms、line snap p95 1.27 ms；Windows Headless Chrome 瀏覽器實測：1000 圖元 Worker 往返含輪廓與診斷 333.9 ms、select p95 0.3 ms、line snap p95 2.3 ms，均遠低於 8 ms 門檻。150 組隨機配置固定點／半徑拘束核對真值一致。 |
| E03 跨縮放／DPR／平台 | 部分通過（Linux + Windows 通過，macOS 待 CI） | 控制器原生支援各比例；瀏覽器 3 種縮放（25%、100%、400%）× 2 種 DPR（1、2）在 Windows Headless Chrome 實測全數通過；Linux 容器前測通過；CI 已新增跨平台入口（Ubuntu、Windows、macOS），macOS 桌面瀏覽器仍待實機／CI 結果回報。 |

P0 核心功能與驗收項目已全數跑通（Windows 瀏覽器 `manual-sketch-plane`、`manual-sketch-selection-candidates`、`manual-sketch-session-rollback` 3/3 PASS；原生單元 21 檔 309 項全數通過）。

## P1 第一批：繪製時輸入尺寸（G01：直線／中心線、圓、邊角／中心矩形）

2026-10-30。使用者確認：角度 0°～180°（不含）、方向由游標在起點上方或下方決定；部分鎖值按 Enter 即完成；鎖值優先於吸附並於提示列說明；槽與多邊形（G16）留下一批。實作與 RCA 見 DEV_LOG 同日條目。

| 案例 | 狀態 | 證據／仍缺項 |
|---|---|---|
| B01 線長 30、角 30° | 通過 | 原生：Tab 切欄、Enter 建立，真實求解長 30、角 π/6 皆 ≤1e-6；兩個驅動尺寸；拖動自由端長度與角度不變；一次 Undo 清空、一次 Redo 還原；起點下方時為順時針角。瀏覽器 `manual-sketch-entry.js` 同步驗證打字聚焦、Tab、Enter、Undo／Redo。 |
| B02 矩形 40×25 | 通過 | 原生：中心矩形與邊角矩形各四象限，真值 ≤1e-6；只鎖寬時游標仍可改高；全鎖時游標落在既有點上不吸附、不加關係，提示列列出未吸附的圖元 ID。瀏覽器：中心矩形 40×25。 |
| B03 Ø／R、單位、表達式、冷重開 | 通過 | 原生：Ø8 切 R 為 R4，只產生一個 `radius`；`0.5in` 切 Ø 為 `(0.5in)*2`，半徑 12.7；尺寸值 `hole`（變數）改 8→10 時半徑 4→5；`serializePart`／`parsePart` 後拘束全等、求解一致。瀏覽器：按鈕切換 Ø8→R4。 |
| B04／T09 非法輸入與 IME | 通過 | 原生：長度欄 10 種、角度欄 5 種非法值就地顯示原因、不提交（Enter 與點擊）、文件不變。瀏覽器：IME 組字（`isComposing`、keyCode 229）的 Enter 不建立；寬 0 就地提示（`role="alert"`）。 |
| B05 狹槽中心距、角度與槽寬 | 通過 | 原生：第一階段長度 40、角度 30°，Enter 推進至第二階段；第二階段槽寬 12，Enter 完成狹槽，自動產生 `distance` (40)、`angle` (30) 與 `diameter` (12) 3 個驅動尺寸；幾何圓弧半徑精確為 6；1 步 Undo 清空實體與尺寸，1 步 Redo 恢復；Esc 先清槽寬文字、再退回第一階段還原長度/角度值、再清長度文字、再取消首點、最後退出工具。純滑鼠繪製時加真值存在性防呆，Esc 即時清除預覽線。瀏覽器 `manual-sketch-entry.js` 同步驗證 30 長度、0° 角度與 10 寬度及 Esc 分層與 Undo/Redo。 |
| B06 多邊形半徑／邊長與方向角 (G16) | 通過 | 原生：支援外接圓半徑模式（`radius`）與邊長模式（`edge`）數值輸入與切換按鈕；輸入半徑 30、角度 30° 自動建立中心到頂點構造射線與 `angle` (30) 角度尺寸、`radius` (30) 尺寸；輸入邊長 15 自動標註 `distance` (15) 邊長尺寸；六邊形邊長真值一致；角度 0° 自動水平定向。1 步 Undo 清空多邊形、構造方位線與所有尺寸，1 步 Redo 恢復。瀏覽器 `manual-sketch-entry.js` 同步驗證 R/L 按鈕切換、半徑 15、角度 30° 建立與 Undo/Redo。 |
| Esc 分層 | 通過 | 原生與瀏覽器：先清輸入值（連續線不中斷）→ 結束本段 → 回選取；已建立圖元不變；狹槽多階段分層回退與純滑鼠中途取消均通過。 |
| 隨機幾何 Fuzzing 壓力測試 | 通過 | 原生：180 組全隨機線段、矩形、圓形、狹槽與多邊形跨 4 象限輸入數值，100% 求解成功且幾何真值誤差 ≤ 1e-6 mm。 |
| E03 跨縮放／DPR／平台 | 部分通過（Linux + Windows 通過，macOS 待 CI） | 控制器原生支援各比例；瀏覽器 3 種縮放（25%、100%、400%）× 2 種 DPR（1、2）在 Windows Headless Chrome 實測全數通過；Linux 容器前測通過；CI 已新增跨平台入口（Ubuntu、Windows、macOS），macOS 桌面瀏覽器仍待實機／CI 結果回報。 |

回歸：完整 `verify:ui` 246/248；兩項失敗經乾淨 HEAD 對照判定為既有失敗（assembly-section-captions）與整批不穩定（drawing-linked，單獨重跑 2/2 通過）。

已知限制：PlaneGCS 對約 900 個以上拘束、大多已定義的草圖會 `Aborted(OOM)`（不經本功能、直接寫入的 150 個標尺寸矩形即可重現；100 個 52 ms）。此為既有限制，另案處理。

## P2-1：共用操作計畫預覽管道（G06，trim 為代表）

2026-10-30。依[方案](plan.md) P2「修改預覽與連續路徑」首刀：PICK 工具（修剪／延伸／圓角／倒角／偏移／鏡射）目前點擊即提交、無最終結果預覽。本批先建立「操作計畫」管道——hover 時以與提交完全相同的純 op（`trim()`）算出候選 `SketchEdit`，預覽以 `remove`／`change`／`add` 三種角色畫在發生位置；確認才試解提交，取消零文件變更；預覽不產生 Undo。文件 Schema 未變更。

| 案例 | 狀態 | 證據／仍缺項 |
|---|---|---|
| G06 trim 預覽管道 | 部分通過（管道與 trim 完成，其餘工具 P2-2 鋪開） | 原生 `sketch-op-preview.test.ts` 3 項：①直線中段修剪 hover 顯示保留段的 `change` 形狀 ((−10,0)→(0,0)) 且文件不變；②游標離開圖元不再預覽、文件逐字不變；③圓修剪 hover 同時顯示 `remove` 的圓與 `add` 的保留弧（a0=π→a1=0），點擊提交後求解真值與計畫一致（±1e-6）、圓消失、無殘留預覽（文件的計畫即時失效）、一次 Undo 還原。其他五個工具已於 P2-2 鋪開（見下節）。 |
| 預覽=提交結果 | 通過 | 預覽與提交呼叫同一純 op；新增點以 op 計算的暫存座標渲染（`Parts.point` 自帶 x/y），提交後求解真值與計畫差 ≤1e-6 mm。 |

回歸：`apps/web` 全量 30 檔 308 項通過（含新增 3 項）；typecheck、lint:rules／deps／repo／i18n 全 PASS；瀏覽器 `manual-sketch-entry` 煙霧 1/1（同時驗證新 `--sketch-op-*` 主題變數可解析）。

## P2-2：操作計畫預覽鋪開至全部六個 PICK 工具（G06 完成）

2026-10-31。`operationPlan()` 從 trim 擴為全部 PICK 工具；抽出 `cornerPair()` 供 hover 與點擊共用（角落行為逐項保持原樣）；偏移特例——確認點不需落在圖元上（游標只決定抄到哪一側），hover 無命中也出計畫；鏡射 hover 需在鏡射軸曲線上。

| 案例 | 狀態 | 證據／仍缺項 |
|---|---|---|
| G06 六工具 preview=提交 | 通過 | `sketch-op-preview.test.ts` 8 項：延伸 stub hover 顯示 `change` (−10,0)→(10,0)、點擊後 l1 端點 x=10；圓角 hover 於角落點即顯示 `add` 弧 r=5＋兩腿 `change`、無需先揀第一條線；倒角 `add` 斜線；偏移（預選、hover 在線外）`add` 平行線 (0,5)-(20,5)、原線不動；鏡射（hover 於軸曲線）`add` 鏡射線 (0,0)-(-10,0)。各項含點擊提交同計畫、提交後無殘留預覽、一次 Undo 逐項還原。 |
| 圓角／倒角落選次序相容 | 通過 | hover 在線上但 `picks` 空→無預覽（點擊才存第一條）；hover 於角落點→即時預覽；點擊通知 `sketch.cornerPick`、存 pick、成功清 picks 的行為與 P2 之前一致（既有 `sketcher.test.ts` 全過）。 |
| 已知缺口 | 記錄待辦 | 鏡射以草圖軸（非曲線）參照時 hover 無預覽，點擊仍可提交（`pickedCurve(…, true)` 支援軸；hover `hitTest` 的軸開關不載 mirror）。偏移兩側／封口為 P2-3。 |

回歸：`apps/web` 30 檔 **313 項**通過；typecheck／lint 全 PASS；完整 `verify:ui` **249/250**——唯一失敗 `manual-drawing-linked` 依乾淨 HEAD `--only` 對照（同簽名 `box.centred:false`，mid[1]=173.5 對 172.5）與 DEV_LOG 2026-10-29 先例判定為**既有／環境性失敗**，非本批造成，另案追蹤。


## P2-3:偏移兩側與封口(G09 部分)

2026-10-31。`offset()` 沿用 P2-1/P2-2 的預覽管道,本批加上「兩側同時偏移」與「開放鏈兩端封口」,並把兩個選項接到 PropertyManager;因為 hover 與提交呼叫同一個純 op,結果預覽免費獲得。

| 案例 | 狀態 | 證據/仍缺項 |
|---|---|---|
| G09 兩側偏移 | 通過 | `offset()` 主體收斂為 `runSide(forced)`;`entry.both` 時跑 `[1, -1]` 兩趟,各側以自己的驅動距離偏移。`ops.test.ts`:矩形四腿兩側共 8 條複本,外擴/內縮各 2(x∈{−2,2,28,32}、y∈{−2,2,18,22}),求解 `fully`、`redundant` 空;每側 1 條驅動距離(值 2),含指名者每側 4 條。任一側不成立(R5 圓內縮 6 → −1)即回 `sketch.offsetTooSmall`,不靜默只做一側。`sketch-op-preview.test.ts`:兩側 hover 預覽 2 條 `add` 平行線(y∈{−5,5}),點擊落成 3 條線、預覽清空、一次 Undo 完整還原。 |
| G09 封口 | 通過 | `entry.caps` 於非環狀鏈兩端各加一直線接回原端點,直線腿加 `perpendicular`。`ops.test.ts`:兩線開放鏈封口得 4 條新線(2 腿 + 2 封口)、2 條 `perpendicular`、`findProfiles.regions` 1 個封閉區域、`conflicting` 空。`sketch-op-preview.test.ts`:封口 hover 預覽 3 條 `add`、點擊落成 4 條線、預覽清空、一次 Undo 還原。 |
| 預覽=提交結果 | 通過 | 兩側/封口皆走既有管道;hover 與 `operationClick` 傳同一 `entry`。`setOption` 變更選項時丟棄依舊選項畫出的 `opPlan` 並在游標仍在時立即重算(不留失配預覽)。 |
| 已知缺口 | 記錄待辦 | 曲線(自由曲線)offset 仍留 P5 探針;掃掠修剪 P2-4、延伸選邊界 P2-5、相切弧接續 P2-6。 |

回歸:`apps/web` + `packages/sketch` 全量 **50 檔 550 項**通過(含新增 4 項);typecheck、lint:rules/deps/repo/i18n 全 PASS;完整 `verify:ui` **249/250**——唯一失敗 `manual-drawing-linked`(同簽名 `centred:false`)為既有/環境性失敗,另案追蹤。


## P2-4:拖曳掃掠修剪(G07)

2026-10-31。修剪工具支援「按下滑過多段」:一筆畫過的每條曲線各以同一個純 `trim()` 修剪一次,放開時折成單一 `editSketch`(一次 Undo)。

| 案例 | 狀態 | 證據/仍缺項 |
|---|---|---|
| G07 掃掠修剪 | 通過 | `sketch-op-preview.test.ts` 4 項:1一筆畫過三條垂直線(y=0 穿越),hover 期間逐步顯示各段 `change`+`add` 預覽(2→3),放開一次提交、線數 8、各線上下兩段(spans 上端 −2、下端 2)、預覽清空、一次 Undo 回復原數原拘束;2同一筆反向重穿同三段 → 仍只修剪一次(線數 8,非 12);3空拖曳不加 Undo、文件版本不變、無殘留預覽;4掃掠中 `Esc` 立即清預覽、放開零文件變更。 |
| 預覽=提交結果 | 通過 | 掃掠預覽與提交皆由 `mergedTrims()`(同一純 `trim()`)折出的同一 `SketchEdit`;`mergeEdits` entities/constraints 串接、remove 去重、add 合併。 |
| 已知限制 | 記錄待辦 | 指針落在與曲線重疊的「點」(如原點)時 `hitTest` 回該點,該曲線不被修剪——與既有單擊 trim 同,非本刀新增;延伸選邊界 P2-5、相切弧接續 P2-6。 |

回歸:`apps/web` + `packages/sketch` 全量 **50 檔 554 項**通過(含新增 4 項);typecheck、lint:rules/deps/repo/i18n 全 PASS;完整 `verify:ui` **249/250**(唯一失敗 `manual-drawing-linked` 為既有/環境性,已定案並將於下一提交單獨修;見 [handoff §3d](../../../handoff.md))。

## P2-5:延伸明示邊界(G08 部分)

2026-10-31。延伸工具可**先選一條曲線作為邊界**(預選即邊界,與 offset/mirror 同一模式):延伸跨過中間的曲線直達所選邊界。未預選時維持既有「取該方向首個有效交點」的預設。

| 案例 | 狀態 | 證據/仍缺項 |
|---|---|---|
| C03 明示目標可越過近線 | 通過 | e2e `manual-extend-rectangle.js`:矩形外放 x=30、x=40 兩條平行目標線;選 x=40 為邊界後延伸矩形邊 → 接續段 `(20,0)-(40,0)` 一筆跨過 x=30,原矩形與尺寸不變、一次 Undo 還原;隨後既有步驟仍測「未選邊界 → 先到 x=30」與「遞進到 x=40」。`ops.test.ts` 同情境(有/無邊界、邊界=本體)以真實求解核對。 |
| 預覽=提交結果 | 通過 | `sketch-op-preview.test.ts`:預選遠牆、hover 於短檔 → 預覽 `change` a=[-10,0] b=[16,0](跨過 x=10);點擊提交後 geometry 相同;未預選 → b=[10,0]。 |
| 明示拒絕而非靜默改目標 | 通過 | `ops.test.ts`:邊界在端點後方 → `sketch.extendBoundaryMissed`(不退回最近、不縮短);選定遠邊界但接續段與既有共線段重疊 → `sketch.extendOverlap`;`boundary === entityId` → 回舊預設最近交點。 |
| 已知缺口 | 記錄待辦 | 獨立 Split(P5:須定義 ID/尺寸/外部參照繼承,不能只畫新線);以自由曲線為邊界留 P5;相切弧接續 P2-6。 |

回歸:`apps/web` + `packages/sketch` 全量 **50 檔 557 項**通過(含新增 3 項);typecheck、lint:rules/deps/repo/i18n 全 PASS;完整 `verify:ui` **250/250** 通過(0 失敗)。

## P2-6:線與相切弧互換仍保留鏈(G05 部分)

2026-10-31。直線、中心線與相切弧三種繪製工具互相切換時保留鏈:切到相切弧時,鏈的終點就是起點(單擊即為終點);相切弧提交後以弧的終點續鏈,繞回首點即結束鏈。相切仍由既有推斷決定(只有沿切線方向才加),偏離切線不偷偷加錯相切;Esc 結束鏈,不留半成品。

| 案例 | 狀態 | 證據/仍缺什麼 |
|---|---|---|
| G05 跨工具續鏈 | 通過 | `sketcher.test.ts`:直線 (0,0)-(10,0) → 切到切線弧(提示「設定終點」)→ 點擊 (14,4) 成弧 → 切回直線 → (14,10);實體 2 線 1 弧、`tangent` 2 條、第 2 條線起點即為弧端點(同一點非兩點)、求解 `under` 且無冗餘。e2e `manual-tangent-chain.js`:工具列直接換工具(不經 Esc),驗預覽圓心 (10,4)、點擊鏈始點不生新圖元、弧端點 (14,4)、續鏈線起點等於弧端點、相切 2 條。 |
| T03 無半成品 | 通過 | `sketcher.test.ts`:Esc 後文件與鏈前完全相同(無弧、無游離點),提示回到「端點」,第二次 Esc 回選取;重合點擊(`lineClick` 與切線弧)以 1e-9 判定直接返回,不建零長線段。 |
| 不悄悄加錯相切 | 通過 | `sketcher.test.ts`:自弧端點離去但既不沿切線也不沿軸時,鏈照樣續接(2 條線),`tangent` 僅弧自身 1 條。 |
| 已知缺口 | 記錄待辦 | G05 的「切換時展示關係候選」目前僅以既有推斷呈現,未另開候選 UI;相切弧的起點仍限既有線/弧端點。 |

回歸:`apps/web` + `packages/sketch` 全量 **50 檔 562 項**通過(含新增 5 項);typecheck、lint:rules/deps/repo/i18n 全 PASS;完整 `verify:ui` **251/251** 通過(0 失敗)。

#### 交付前紅隊抓到的回歸:守門不得用拾取半徑

第一版守門以「落點距鏈端起點 ≤ `PICK_PX * px`(7px)」判定「點在同一個點」,會吞掉被對齊吸附拉近鏈端、但其實是另一個點的合法點擊:完整 `verify:ui` 因此出現唯一失敗 `manual-thread`(牙型退化、除料無效);以乾淨 HEAD 單跑該 e2e 通過,證明是本刀造成。改為在建立處以 `dist(起點, 落點) < 1e-9` 判重合(與既有零尺寸矩形/圓同慣例),並補回歸測試;詳 [DEV_LOG 2026-10-31 P2-6](../../../DEV_LOG.md)。

## 測試與失敗紀錄

- `apps/web/test/sketcher.test.ts` 75項、`packages/sketch/test/solve-options.test.ts` 16項（含150組隨機配置核對）、`apps/web/test/sketch-pointer-baseline.test.ts` 2項、`tests/phase8/view-normal.test.ts` 7項，合計100項測試全數通過。
- 相關草圖原生測試套件 21 檔 309 項全量回歸通過（耗時 6.91s，0 失敗）。
- 瀏覽器 E2E 驗收 `npm run verify:ui -- --only "manual-sketch-selection-candidates|manual-sketch-session-rollback|manual-sketch-plane"` 3/3 通過（`out/sketch-p0-ui.json`）。
- **失敗紀錄與 RCA 1（1000 圖元自由度診斷卡死）**：1000 圖元基準測試時頁面等待逾時。原因為 `PlaneGcsSolver.analyze` 在無拘束時仍為每個點與圓重新試解整張草圖。修正：在確認無拘束、無衝突、純點線圓且原生 DOF 等於預期時走 fast-path，以 150 組隨機配置核對一致，求解時間降至 23.3 ms。
- **失敗紀錄與 RCA 2（IME 組字 Enter/Esc 誤關閉）**：中文輸入法選字時按 Enter 或 Esc 會觸發全域快捷鍵與尺寸修改框關閉。修正：在全域與各輸入框頂部加入 `isComposing || keyCode === 229` 守門，並補單元測試與瀏覽器測試。
- **失敗紀錄與 RCA 3（右鍵 contextPick 多選覆蓋）**：多選兩圖元後在共用端點右鍵會被端點單選覆蓋。修正：當點選位置已有圖元在現有選取集合中時，保留現有選取。
- **失敗紀錄與 RCA 4（E2E 換零件未儲存卡住與圖元 ID 重複）**：`manual-sketch-selection-candidates` 換到 100 圖元測試時直接呼叫 `新零件`，因既有零件 dirty 觸發未儲存對話框，導致新零件未建立、舊草圖 ID 重複使 `addSketchItems` 被拒。修正：在腳本中明示 `store.newPart(); if (store.getState().unsaved) await store.answerUnsaved('discard');` 確保乾淨起手。
- **失敗紀錄與 RCA 5（旋轉基準面斜視測試視角漂移）**：`manual-sketch-plane` 在第 9 步直接中途旋轉視角導致第 10 步參考點座標偏移。修正：將旋轉基準面的正視／等角落點測試移至第 12 步收尾時驗證，且在斜視測試後以 `previousView()` 還原，確保各步驟完全隔離。

## 控制器與瀏覽器效能基準

### 1. Node.js 控制器基準（Windows 12th Gen Intel Core i3-12100，Node v26.7.0，`out/sketch-p0-pointer-baseline.json`）
測資為間距10mm／半徑3mm的圓陣列，點與圓合計100／1000圖元（50／500圓）。pixelSize=0.1mm/px；每模式預熱100次、量300次。

| 圖元數 | 模式 | p50 ms | p95 ms | 求解+診斷 ms |
|---|---|---:|---:|---:|
| 100 | 選取 | 0.059 | 0.215 | 61.0 |
| 100 | 畫線吸附 | 0.103 | 1.158 | 61.0 |
| 1000 | 選取 | 0.091 | 0.449 | 23.3 |
| 1000 | 畫線吸附 | 0.553 | 1.266 | 23.3 |

### 2. 真實 Headless Chrome 瀏覽器端基準（Windows 1280×720，`out/sketch-p0-ui.json`）
包含 DOM 事件分派、前端狀態更新、Worker 往返、輪廓計算與自由度診斷。

| 圖元數 | Worker往返 ms | 選取 pointermove p50 / p95 ms | 畫線吸附 pointermove p50 / p95 ms | 驗收門檻 | 判定 |
|---|---:|---:|---:|---:|:---:|
| 100 | 50.3 | 0.00 / 0.10 | 0.10 / 0.20 | p95 ≤ 8.0 ms | **PASS** |
| 1000 | 333.9 | 0.20 / 0.30 | 0.60 / 2.30 | p95 ≤ 8.0 ms | **PASS** |

2026-10-28 後續追查：原正視圖選 z31 頂點與 z25 支撐面投影重合，實際選到後者；座標系草圖未退出連帶影響軸臂及rollback步驟。改用等角視圖作測試前置，原數值、軸臂和等待分支斷言不變，失敗流程重跑全部通過。此為驗收腳本選點修正，不宣稱正視圖重疊目標已能消歧。

2026-10-29：整合 Claude Code 的943dfc9（拘束選項試解過濾），新增A03真實瀏覽器驗收。初次腳本誤用樹狀圖輔助函式名稱，改為既有treeEdit後僅重跑該案例通過；未放寬任何斷言。P0其他案例仍待驗。

2026-10-29：拉取至510b6a9後，以真實PlaneGCS逐一驗12種草圖建立工具：首點後Esc不提交半成品、再按Esc回選取；僅執行新增測試，1項通過。此項尚不涵蓋各工具所有中間步驟或IME。
