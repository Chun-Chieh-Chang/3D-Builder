# 交接文件

- 最後更新：2026-10-06（手動驗證做到 C5，要換電腦繼續，見 §0.0 的「在另一台電腦繼續實機驗證」與「2026-10-06 的進度」）。**Phase 0 到 7 的開發都完成**：0、1、2 的閘門完全通過（2 的驗收範圍降低，使用者接受）；3a、3b、4a、4b、5、6、7 是**有條件通過**（只用手算的金樣與種子固定的隨機測試驗過，沒有真實檔案），未做的真實樣本與實機確認見 §8 與 [docs/manual-verification.html](docs/manual-verification.html)。零件 Schema 43、`npm run check` 2150 項通過。各階段的歷史在 §3，每個里程碑的決策在 [ADR](docs/adr)，最新狀態以 `git log` 為準。先讀 §0.0。
- 用途：讓下一個工作階段（人或 AI）不讀對話紀錄也能接手。
- 本文件只記錄「目前狀態、待辦、下一步、工作約定」。範圍與設計以藍圖、ADR、程式碼為準；若有衝突，以它們為準並更新本文件。

## 0. 換電腦之前，先讀這裡

### 0.0 快速接手（2026-10-04，H-11 之後，換電腦先看這段）

**狀態**：Phase 0 到 7 開發完成；`npm run check` 1996 項通過、21 項略過；零件 Schema 42、組合件 Schema 6、工程圖 Schema 4。已經沒有「進行中」的里程碑；使用者採納「先鞏固再加功能」，鞏固 H-1 到 H-11 已做完（[hardening-plan](docs/hardening-plan.md)）。每個里程碑的 ADR、驗收表與限制在對應的 ADR，§3 有一行摘要。

**換電腦（本專案要能在不同電腦開發，下面都是每台電腦自己的事，程式與文件不依賴任何一台）**：`git pull`（私人專案）→ **`npm run doctor`**（唯讀診斷：Node、git、`node_modules` 的工作區連結是否指向這個資料夾、這個磁碟能不能做連結、埠 5391、Rust 與 C++ 工具；每個問題都附修法）→ 有問題照它說的做（多半是 `npm install`）→ `npm run check`（應全過）→ `npm run dev`。**只用網頁版不需要 Rust 與 MSVC**；要建桌面版才裝（`apps/desktop/README.md` 的「需要」）。

**在另一台電腦繼續「實機驗證」（2026-10-05 起的任務，照這個順序做）**
- **進度（2026-10-06，使用者在 `D:\Self-developed_Apps\G3\3D-Builder` 這台做完 C5）**：[docs/manual-verification.html](docs/manual-verification.html) 的 84 項，**P1 到 P3、B1、C1、C2、C3、C4、C5 通過**（共 9 項；B1 與 P 系列是 10-05 在 `C:\Users\3kids` 那台做的）；**下一個是 C6**，接著 C7 到 C22，再 D、E、F、G、H、I（標「必做」的優先，「需樣本」「需你決定」的先不做）。狀態存在使用者的瀏覽器 localStorage，**不會跟著 git 換電腦**：換電腦後手冊會全部顯示「未做」，請照這一行把上面已通過的項目在手冊裡選「通過」（或直接從 C6 開始，不必補），做完一個段落按「複製結果」貼給 Claude。
- **手冊改寫（2026-10-06，使用者說「怎麼做」很不清楚，要小白也看得懂）**：[manual-verification.html](docs/manual-verification.html) 的 C1 到 I10 已改寫成「先準備＋一步一個動作＋每步下面『→』接預期畫面」，最前面加了「先看這裡」（畫面怎麼認、滑鼠鍵盤、共用做法 A 到 H、名詞表）；A、B、J、K、L 與 0 章維持原樣。寫的時候每個按鈕與欄位名稱都對過動作清單與 `packages/i18n/src/zh-TW`，C1、C6、C8、G1、鈑金（基材凸緣、邊線凸緣、摺邊、平板型式）、薄殼盒與三個塑膠分析在內建瀏覽器實際走過，數字對得上。**走的時候發現而寫進手冊的事實**：編輯草圖時「方程式」「檔案屬性」是灰的；過多定義用手做不出來（尺寸工具會把多的尺寸變成從動尺寸）；間隙要調「間隙容差」才看得到；分割線的圓要整個落在面內；鈑金用上基準面做時預設值（板厚 1.5、半徑 1.5、K 0.5）直接可用。**沒有預跑、手冊標「選做，沒有預跑」的**：旋轉的薄件、掃出的空心管／弧形路徑／錯誤情境、疊層拉伸除料與方形對圓形、肋材階梯板、相切基準面、拔模（塑膠）、卡榫與窗、排氣口、曲面的延伸／修剪／縫織／填補、量規表以外的鈑金檢查（孔到折彎）；組合件與工程圖的步驟（D、E、F）依程式的面板與腳本寫成，沒有在真正的資料夾選擇視窗走過。這次也修了一個顯示問題：「成形至本體」把本體接起來之後，面板誤顯示「（遺失參考）」（`PropertyManager.tsx` 的 `EndRef`，改成看特徵自己的報告）。
- **2026-10-06 的進度（C1 到 C5 的發現，都已處理並提交）**：
  - **手冊**：C1 的步驟做不下去（編輯草圖時「方程式」「檔案屬性」是灰的），改成離開草圖後用方程式視窗的「草圖尺寸」表改；C3 的「診斷報告」要**雙擊**「輸入1」才看得到（單擊只是選取）；C5 與 C6 的「先準備」改成逐步寫；手冊「先看這裡」補了：單擊與雙擊、沒有關閉檔案按鈕（用「新零件」）、復原按鈕在哪、草圖吸附現況。
  - **程式**：① **復原／重做變成每個分頁都看得到的按鈕**（原本只在特徵與組合件分頁，藏在 40 個按鈕的最尾端，`CommandBar.tsx`）；② **設計樹的本體列縮排**在「實體(N)」底下；③ 「成形至本體」把本體接起來後不再誤顯示「（遺失參考）」；④ **偏移圖元、鏡射圖元、幾何建構線沒選取就按**，左邊面板最上方會顯示提示（`ControllerView.message`），原本只在最下方狀態列閃一行。
  - **待決定的新功能**：草圖吸附與推斷（虛線對齊線、吸附到模型的邊與頂點、快速抓取）——[sketch-snapping-plan.md](docs/sketch-snapping-plan.md)，依 SW 2010 繁中說明寫成，使用者決定 C 章走完再排優先序。**後面的草圖項目（C6、C7）若因為沒有吸附而做不下去，請告訴使用者並評估提前做 S-2。**
  - **這台的開發伺服器**：Claude 桌面版的預覽會定時停掉它，所以後來改用獨立的背景程式（`Start-Process npm.cmd run dev -w @3db/web`）；換電腦後在新電腦開自己的終端機執行 `npm run dev` 即可。
- **步驟**：① `git pull` → `npm run doctor` → 有問題照它說的做（多半是 `npm install`）→ `npm run check`（應 **1996 項通過、21 項略過**；`undercut-analysis` 的 4 秒門檻與 4a 驗收在機器忙時可能失敗，單獨跑會過）。② **產生驗證用的檔案**：它們在版本庫之外，每台電腦要自己產生。PowerShell：`$env:KIT_OUT = 'C:\3DB實機確認'; npm run make:kit`（沒設 `KIT_OUT` 時寫到 `D:\3DB實機確認`，這個磁碟不存在就會失敗；清單 P2 說的 4 個檔案就在這個資料夾的根目錄，另有夾具組、塑膠件、鈑金、`STEP替身/`、`輸出/`）。PDF 的中文要這台有 `C:\Windows\Fonts\msjh.ttc`，沒有時 PDF 的中文是 `?`。③ `npm run dev`，用 **Edge 或 Chrome** 開 http://127.0.0.1:5391（要用瀏覽器的檔案系統存取）；在**同一個瀏覽器**直接開 `docs/manual-verification.html`（檔案路徑）填寫。④ 做完（或做到一半要換電腦）按頁面上方的「複製結果」，**把文字貼進對話**：狀態與備註只存在那個瀏覽器的 localStorage，不跨電腦、不進 git。⑤ 對 Claude 說：「讀取 handoff.md，接手實機驗證」。
- **B1 的發現（2026-10-05，已處理）**：① 原點預設是顯示、三個基準面隱藏（程式照設計，與 SW 一致），清單原本寫錯，已改。② 「關掉再開」的做法清單沒寫，已補（儲存檔案 → 新零件 → 開啟舊檔）。③ 清單說「刪掉伸長」會讓圓角的邊遺失參考，實際只會得到「圓角之前沒有本體」，沒有「改用最接近的」；這個功能用 `tests/phase1/repair.test.ts` 與瀏覽器裡的腳本驗過（按下後體積 991.416 mm³），清單的這一步標為略過。④ 在設計樹按右鍵會出瀏覽器的原生選單：根因是程式選單本身、原點與基準面列、「實體」列、空白處都沒有攔右鍵，右鍵落在開著的程式選單上時原生選單蓋上來（擴充功能不是原因，InPrivate 視窗一樣）；修法是整個頁面統一攔下，只放過文字輸入（`apps/web/src/nativeMenu.ts`，`tests/phase8/native-menu.test.ts`），使用者確認連按右鍵不再出現。
- **預跑（2026-10-05，使用者要求「驗證速度太慢」之後）**：39 項必做裡，有 `tests/e2e/` 瀏覽器腳本的項目（C2 到 I8）全部在內建瀏覽器（視窗 1280×720）跑過，都過；C1 方程式用頁面手動走過。每一項的結果與「腳本沒涵蓋」的步驟寫在清單的「預跑」一行；H9、I10 是真人走一遍，沒有預跑。預跑時修了 6 個過時的腳本（`phase3-shell`、`phase3-subassembly`、`phase3-step-import`、`phase3-component-pattern`、`phase5-dimensions`、`phase5-views`，加 `phase2-assembly.js` 的 `H.decodeStep`；原因：STEP 輸出回傳 `{text}`、名稱改成 `\X2\` 逃脫碼、孔標註帶「貫穿」、剖面避開被佔住的一側、薄殼多了提示列）；清單修了檔案名稱（D1 的次組合件要由 `金樣夾具_巢狀.step` 匯入得到 `工位.3dba`）、D4 的數量、C2 的體積、D2 的按鈕名稱、F1 的路徑。**預跑不能代替人**：腳本驗的是功能與數字，視覺、手感、原生對話框、外部軟體仍要使用者做。跑這些腳本的做法：每支在剛載入的頁面 `await import('/@fs/F:/…/tests/e2e/<檔>.js?'+Date.now())` 再呼叫它的 `run()`；上一支沒收尾會留下自動存檔副本，下一次載入會跳出「找到沒有儲存的零件」，要按「捨棄」。
- **驗證檔案的位置**：這台放在版本庫根目錄的 `3DB實機確認/`（已加進 `.gitignore`，不會被提交）；`make:kit` 的 `KIT_OUT` 可以指到這裡。
- **Claude 接手時**：使用者貼回結果後，逐項判讀；有問題的按 PDCA 修（先給計畫與量化驗收，修完 `npm run check` 全過、更新 ADR 與本文件、使用者同意才提交與推送）；修好的在重新產生的驗證檔案上再確認。**eDrawings 檢查不必重做**（0b 已做完）。**桌面版安裝檔等驗證結束再重建一次**（要 Rust 與 MSVC，`npm run doctor` 會說這台有沒有）。
- **這些替身不是真實 SolidWorks 檔案**：J 章（真實零件、組合件 STEP、沖壓件、塑膠件與 SW 分析對照、鈑金平板型式對照）仍要使用者提供樣本，`SW_SAMPLE_DIR` 沒設時相關測試略過。

**下一步（建議順序）**
0. **驗證用的檔案（2026-10-05）**：`npm run make:kit` 產生 `D:\3DB實機確認`（可用環境變數 `KIT_OUT` 改位置）：金樣零件、夾具組、15 個零組件的金樣組合件、塑膠外殼與蓋、鈑金支架、STEP 替身，另有 `輸出/`（每個零件與夾具組合件的 STEP、基板加工圖的 DXF 與 PDF、支架的平板型式 DXF）與 `輸出/看圖清單.md`（用 eDrawings 或 CAD 開時每個檔案要看什麼、核心算的數字）。這些是程式自己做的替身，**不是真實的 SolidWorks 檔案**，不能代替 J 章。產生器在 `tests/kit/`，不在 `npm test` 裡；金樣定義是從驗收測試複製的（它們沒有匯出），驗收測試改了要跟著改。**程式啟動時現在是空白零件**（原本開示範件），示範件是「檔案 → 新示範件」；桌面版安裝檔**還沒用這個改動重建**，等實機驗證完再一次打（`npm run build -w @3db/desktop`）。用 eDrawings 開 `輸出/` 的檔案的檢查**已在 2026-10-05 做完**（結果在 0b），不必重做。
0b. **eDrawings 驗證的結果與待決定（2026-10-05）**：用 eDrawings 2026 逐一開 `輸出/` 與 `STEP替身/` 的檔案（形狀、孔、圓角、凸緣、組合件位置都對；細節在 `看圖清單.md`）。已修：STEP 的中文名稱原本寫成原始 UTF-8，eDrawings 讀成亂碼，現在寫成 `\X2\…\X0\`（`kernel/src/stepText.ts`）；剖面視圖的那一側被別的視圖佔住時（第一角的上視圖正好在前視的下方）改放到母視圖的旁邊，原本兩者疊在一起（`layout.ts`）。**使用者決定之後再處理（已記錄、未做；2026-10-05 使用者對 (a)、(b) 的決定是「不處理」，除非日後有需要）**：(a) 巢狀組合件（`金樣夾具_巢狀.step`）的子組合件名稱「工位」在 eDrawings 的零件樹仍是亂碼，檔案內容合法、我們自己的讀取器讀得回，原因不明（平的組合件與單件都正常）；(b) 工程圖 DXF 在 eDrawings 裡 `×` 與中文顯示成 `?`（標題圖塊、孔表標題、「貫穿」；Ø 正常），不知道是 eDrawings 的字型還是 DXF 的文字寫法；(c) 平板型式 DXF 的折彎註記「UP 135° R2」是上下顛倒的（文字方向跟著折彎線的方向）；(d) 「量測」在 eDrawings 沒量出數值、STEP 沒有質量特性，所以尺寸只用像素比例目視核對，沒有精確比對。PDF 沒用 eDrawings 看（它不開 PDF），要用 Chrome。
1. **使用者的實機驗證**：[docs/manual-verification.html](docs/manual-verification.html)（85 項，每項有步驟、預期結果、回報格式；做完按「複製結果」貼回來）。這是現在最大的缺口：3a、3b、4a、4b、5、6、7 的閘門都只是「有條件通過」。
2. **真實樣本**（卡在使用者提供）：3 個真實 SW 零件（3a-10）、保留結構的組合件 STEP（3b-7 B 段）、真實夾具案例（4a）、真實沖壓件或塑膠件（4b）、真實塑膠件與 SW 分析對照（6）、真實鈑金與 SW 平板型式對照（7）；用到它們的測試靠環境變數 `SW_SAMPLE_DIR`，沒設就略過。
3. **要使用者許可才能動的**：刪檔（全域規則）。目前沒有待決定的（`%LOCALAPPDATA%` 下桌面版的使用者資料夾 `app.3dbuilder.desktop` 已在 2026-10-04 經使用者許可刪除；它是 WebView2 的網頁暫存與自動存檔的還原副本，之後執行桌面版會重新產生）。
4. **要使用者決定的下一個功能**（§8 與清單的 K4）：**草圖吸附與推斷（參照 SolidWorks）**：吸附到模型的邊與頂點、虛線對齊線、快速抓取。2026-10-06 手動驗證 C3 時使用者提出並要求規劃；**計畫與驗收在 [docs/sketch-snapping-plan.md](docs/sketch-snapping-plan.md)**（SW 的行為已依 SW 2010 繁中說明寫進計畫（推斷、14 種草圖抓取、快速抓取）；里程碑 S-0 到 S-5：S-0 請使用者用 SW 確認說明沒寫的 4 件事，S-2 吸附到模型幾何最有感，S-1 水平／垂直推斷虛線）；藍圖目錄 D5.3a 到 D5.3c；手冊 K4 有勾選項。使用者決定 C 章走完再排優先序，現在不做；Phase 7 的凸折、斷開角落、長圓與撕裂離隙、折過的基材上的凸緣的平板型式、平板型式進工程圖；卡榫「鉤下面的窗」做成選項；檢具的曲面相互修剪；工程圖的螺紋孔標註、角度尺寸、DXF 的 DIMENSION 圖元；桌面版自動更新與簽章；次組合件內部的干涉檢查。
4a. **草圖吸附進度（2026-10-06，未提交）**：使用者決定先做吸附並與 SW 對齊、做完一起提交。S-1（水平點／垂直點虛線與關係）與共線／平行／垂直推斷已實作並提交（e982739）；S-2（吸附模型的邊、端點、圓心、中點，未提交）已實作，細節與驗證在 [sketch-snapping-plan.md](docs/sketch-snapping-plan.md) 的狀態行；`npm run check` 2064 通過。**待做**：S-3 其餘抓取、快速抓取與「啟用抓取」開關（自動關係會讓之後手動加的關係變冗餘，要能關）、手冊 C 章加吸附檢查項、ADR。
4b. **說明系統（2026-10-06，未提交）**：使用者要求比照 SW 的說明按鈕，且基於 SSOT（驗證後修正，說明跟著改）。已實作 H-A：說明文字只在 i18n 目錄 `help.<主題>.*`（[help.ts](packages/i18n/src/zh-TW/help.ts)），主題 id = `ACTIONS` 的 id（草圖工具 `tool-<tool>`）或 `concept.*`；工具提示、說明窗（功能列「說明」或 F1，依目前的工具／特徵／草圖開對的主題，有搜尋與目錄）、「這是什麼？」（點任何帶 `data-help` 的按鈕或面板）都讀同一份。**防漏**：`tests/phase8/help.test.ts` 在新增動作或草圖工具卻沒有一句話時失敗；[docs/help-links.json](docs/help-links.json) 記每個手冊項目驗證哪些主題。**工作約定（加進 §7）：加指令必須同時加 `help.<id>.summary`；手冊項目標「有問題」並修好時，依 help-links.json 同步改對應主題的文字。** 計畫與驗收見 [help-plan.md](docs/help-plan.md)；待補：其餘主題的內文（H-B）、英文（H-D）、手冊項目下顯示對應主題（H-C）。
5. **圓角與導角可以選面、面圓角、完整圓角（2026-10-06，已完成）**：[fillet-by-face-plan](docs/fillet-by-face-plan.md)、[ADR 0097](docs/adr/0097-fillet-by-face-validation.md)（驗證）、[ADR 0098](docs/adr/0098-fillet-by-face.md)（實作）；手冊 C23 到 C25；UI 腳本 `tests/e2e/phase3-fillet-face.js`（`__ff.constant／chamfer／face／full`）。**沒做、日後可列**：不相鄰面之間的面圓角、兩側不平行的完整圓角、變數半徑、選特徵與迴路。

**工作約定提醒**（完整在 §7）：動手前先給計畫、量化驗收標準、反向提問；刪檔先問；限制與沒做的驗收要誠實寫出；每個里程碑更新 ADR、本文件與對應的計畫文件；推送前先確認（使用者在 H-11 要求推送前做資安與數據隱私盤點、取得許可）。

### 0.1 藍圖（已完成）

- 藍圖曾經只存在家裡電腦，從來沒進過 git，是單點故障（2026-09-30 在另一台電腦上找不到它，Phase 3 的規劃因此卡住）。
- **2026-09-30 已放進版本庫**：[docs/blueprint.md](docs/blueprint.md)（提交 `80964b6`，與原檔 SHA-256 相同）。原檔 `C:\Users\3kids\.claude\plans\solidworks-3d-solidworks-solidworks-3d-serene-crayon.md` 是同一份的舊副本；**之後只改 `docs/blueprint.md`**，不要兩邊各改。
- `.claude/plans/` 裡沒有這個專案的其他計畫檔。
- 藍圖有幾處技術描述已過時，範圍不受影響：OCCT 7.9.x（實際是 libcascade 3.0.2 的 OCCT 8.0.1）、pnpm（實際是 npm workspaces）、「現況為空目錄」。
- §11 是藍圖遺失時用的備援摘要；現在藍圖在版本庫，有衝突時以藍圖為準。

### 0.2 接手藍圖之後的工作

1. §2 文件地圖的藍圖那一列已改成 [docs/blueprint.md](docs/blueprint.md)。
2. **Phase 3 的里程碑與驗收標準**：[docs/phase3-plan.md](docs/phase3-plan.md)。§6 的決定 1–6 使用者都已決定（2026-09-30）；**§5 的驗收數值（對稱差體積 < 1e-6 等）是我的建議值，使用者暫時認定為 Pass（2026-10-01）**：先照做，3a-10 之前若樣本顯示不合理再調整。3a-0、3a-pre、3a-i18n、3a-1、3a-2、3a-3 已完成並推送；3a-4 草圖工具 P1 分 4a 繪圖與編輯工具（已實作）、4b 限制條件與從動尺寸（已實作，Schema 11）、4c 衝突診斷、草圖檢查與輪廓選取（已實作，Schema 12）、4d 跟著模型走的參考圖元與「貫穿」（已實作，Schema 13）；3a-4 完成。3a-5 特徵 I（5a 伸長／旋轉 P1、5b 薄殼、5c 拔模）與 3a-6 特徵 II（6a 異型孔、6b 掃出、6c 疊層拉伸、6d 肋材）也已完成並推送；**下一個是 3a-7 參考幾何與複製排列**（phase3-plan §3），已確認分 7a 參考幾何、7b 直線與環狀複製排列、7c 鏡射，**都已實作**，見 §10。3a-8 材質、屬性與輸出（8a/8b/8c）也已實作；3a-9 分 9a／9b／9c，9a、9b 已實作，9c-1 檢視（顯示類型、視角選擇方塊、剖面）已實作（ADR 0042），9c-2 選取（濾器、選擇其他、迴圈與相切、BVH）已實作（ADR 0043），9c-3 系統選項與英文（ADR 0044）已實作，**3a-9 全部做完**；3a-10 驗收的工具與不需樣本的部分已完成（ADR 0045）；**需要使用者 3 個真實零件的部分，使用者於 2026-10-02 決定先跳過**（3a 閘門因此是「有條件通過」：自動化全過，真實零件的對照與實機點選驗收未做；樣本到手時用 `tests/support/acceptance.ts` 補做）。組合件介面的 183 行中文還沒搬。

### 0.3 不在版本庫、只存在某台電腦的東西

| 東西 | 在哪裡 | 換電腦時 |
|---|---|---|
| ~~藍圖~~ | 已在版本庫 `docs/blueprint.md`（0.1） | 不用做什麼 |
| 使用者的全域規則 `CLAUDE.md`（SkillsBuilder 開發標準、反向提問、智囊團審查、檔案刪除保護） | 每台電腦各自的 `C:\Users\<使用者>\.claude\CLAUDE.md` | 從舊電腦複製，或依那份檔案最後一行的說明執行 SkillsBuilder 的 `INSTALL.ps1 -Global`。沒有它，§7 的工作約定不會自動生效 |
| 桌面版的建置環境（Rust 1.99、rustup、VS 2022 Build Tools 的 C++ 工作負載、`@tauri-apps/cli`） | **每台電腦各自裝**（`npm run doctor` 會說這台有沒有）：Rust（`winget install Rustlang.Rustup`，在 `%USERPROFILE%\.cargo\bin`，新終端機要把它加進 PATH）；C++ 編譯器 VS Build Tools（2022 或 2026 都行，MSVC 14.44 與 14.50 都有人用過，Tauri 認得；若 winget 對 2022 版說「已安裝」卻失敗，是有一個不完整的舊實例，改用 `setup.exe modify` 補 C++ 工作負載，或直接用已有的 2026 版）與 Windows SDK。2026-10-04 在 `C:\Users\3kids` 這台裝好並用 Phase 4a–7 的程式重建了安裝檔（安裝檔在 `target/`，不在版本庫，各電腦自己建）；`node_modules` 之外都不在版本庫 | 新電腦要建桌面版：照 `apps/desktop/README.md` 的「需要」裝；只用網頁版不需要 |
| SolidWorks 樣本（專有檔案，不進版本庫） | `C:\Users\ws61\Downloads\SW樣本`：`T1405001.SLDASM`、兩個單一實體的 STEP | 看 §8 第 1 項；用到它的測試靠環境變數 `SW_SAMPLE_DIR`，沒設就略過 |
| 實機測試用的專案資料夾 | `C:\Users\ws61\Downloads\3DB實機確認` | 只是金樣零件的複本，可從 `tests/golden/` 重建（三個檔案：`定位板.3dbx`、`V型塊.3dbx`、`零件\削邊銷.3dbx`） |
| 對話紀錄與 Claude 的記憶 | 各電腦本機，不同步 | 沒有：**本文件是唯一的交接** |
| `node_modules` | 各電腦自己 `npm install` | 見 0.4 |

### 0.4 在新電腦接手

1. 安裝 Node（開發用 26）與 git。
2. `git clone https://github.com/Chun-Chieh-Chang/3D-Builder`（私人專案，需要 GitHub 登入）。
3. **專案要放在支援符號連結的磁碟**（NTFS，例如 `C:`），不要放在 exFAT 或 FAT 的 USB 隨身碟：npm workspaces 靠符號連結，在 USB 上 `node_modules/@3db` 是空的，`npm run check`、`npm run dev`、`npm run build` 都會失敗（另一台電腦就是這樣，繞法見 §6「工作區連結」）。
4. `npm run doctor`（診斷這台電腦；搬過專案或換過磁碟代號時，`node_modules` 裡的連結是絕對路徑，會指到不存在的地方，它會說，修法是 `npm install`），然後 `npm run check`（型別、分層、全部測試，應全過），`npm run dev`，用 Chrome 或 Edge 開 http://127.0.0.1:5391。
5. 行尾：`.gitattributes` 規定文字檔一律以 LF 存、LF 檢出，不管這台電腦的 `core.autocrlf`；若隨身碟帶來的工作檔是 CRLF，`git status` 不會因此變髒，提交時也會自動轉成 LF。
6. 確認 `docs/blueprint.md` 在；不在的話，先 `git pull`。
7. 對 Claude 說：「讀取 handoff.md，接手開發任務」。

## 1. 專案

類 SolidWorks（下稱 SW）的參數式 3D CAD：

- Web 先行，一人 + AI 開發。
- 對標 SW 早期的基礎建模能力，之後延伸到夾治具 → 工程圖 → 塑膠件 → 鈑金。
- 模具不做。

## 2. 文件地圖

每份文件各管一件事：

| 文件 | 內容 |
|---|---|
| [藍圖 docs/blueprint.md](docs/blueprint.md) | 範圍、架構、階段與驗收標準。範圍以附錄 C 目錄與 §3 階段規則為準（§0.1）。備援摘要：§11 |
| [README.md](README.md) | 快速開始、套件結構 |
| [ADR 0001](docs/adr/0001-ssot-mece-rules.md) | SSOT/MECE 程式碼守則，各套件擁有的目錄 ID |
| [ADR 0002](docs/adr/0002-phase0-kernel-and-solvers.md) | Phase 0 的求解器決策、持久命名文法 |
| [ADR 0003](docs/adr/0003-occt-binding-gaps.md) | OCCT 綁定缺口驗證，改用 libcascade 3.0.2 |
| [ADR 0004](docs/adr/0004-sketch-editing.md) | 草圖編輯：可讀且不重用的 ID、Schema v2、拖曳、逐圖元狀態、端點相切、推斷規則 |
| [ADR 0005](docs/adr/0005-features-and-booleans.md) | 特徵與布林：布林後的命名、合併共面、分割面的解析、終止型態、旋轉、導角、模型平面上的草圖、Schema v3 |
| [ADR 0006](docs/adr/0006-feature-tree-operations.md) | 設計樹操作：連帶抑制、刪除與相依、指紋解析的警告、錯誤為何、雙向選取同步、回溯選單 |
| [ADR 0007](docs/adr/0007-reference-planes.md) | 基準面：Schema v4、基準面參考的命名、框架規則、頂點持久命名、拾取優先順序、圖面顯示 |
| [ADR 0008](docs/adr/0008-part-file.md) | 零件檔 `.3dbx`：ZIP 內容、自寫 ZIP、固定輸出、輸入資料以雜湊命名、舊檔相容、本機檔案、已修改標記 |
| [ADR 0009](docs/adr/0009-step-import.md) | STEP 輸入：Schema v5、只在需要時修復、輸入面的命名與金樣、讀取快取、兩個入口 |
| [ADR 0010](docs/adr/0010-phase1-acceptance-fixes.md) | Phase 1 驗收的修正：整圈旋轉面的命名、角度尺寸量放置那一側（Schema v6）、零件名稱就是檔名 |
| [ADR 0011](docs/adr/0011-assembly-skeleton.md) | 組合件骨架：組合件文件與版本線、相對路徑的參考（不存雜湊）、專案資料夾、另存到別的資料夾時改寫路徑與復原記錄、`.3dba`、Worker 依內容快取零件 |
| [ADR 0012](docs/adr/0012-mate-solver.md) | 結合求解器：`@3db/assembly`、組合件 Schema 2（結合）、LM 從擺放位置解起、分組、依設計樹順序找衝突、自由度、支援的結合、零件的解析幾何、旋轉件平面法向的修正 |
| [ADR 0013](docs/adr/0013-mate-ui.md) | 結合的介面：Worker 求解與預覽、結合 PropertyManager、零組件上的拾取與浮出樹、設計樹的狀態與結合資料夾、錯誤為何、開始組合件、STEP 零組件 |
| [ADR 0014](docs/adr/0014-moving-and-reference-files.md) | 移動零組件與參考檔：求解器的移動目標、拖曳與數值移動、放開時寫入整組擺放位置、重新指定零件檔、找不到的檔案、零件改過後更新、開啟零件與返回組合件、記住專案資料夾 |
| [ADR 0015](docs/adr/0015-step-assembly-export.md) | STEP 組合件輸出：XCAF 單層結構、寫出圖面上的位姿、位姿由四元數與平移組成的原因、非單位四元數與讀不到的零件檔一律拒絕 |
| [ADR 0016](docs/adr/0016-component-mesh-and-load-progress.md) | 零組件的網格（容差 1‰、角度 0.5 rad，比編輯零件粗）與載入進度（階段、秒數）、沒有本體的零件檔視為錯誤、量到的時間分佈 |
| [ADR 0017](docs/adr/0017-phase3a-technical-validation.md) | Phase 3a-0 技術驗證：薄殼、拔模、掃出、疊層拉伸的演化歷史夠命名、移動面的「延伸板」做法、重算時間量測、Phase 1 遺留 P0 的盤點、成形至下一面（**驗證結果，決策待確認**） |
| [ADR 0018](docs/adr/0018-visibility-and-reference-repair.md) | 顯示/隱藏（D4.6，Schema v7 `visibility`，存進檔案）與遺失參考的修復（B4.3，`replaceRef`、候選帶指紋、「改用這個」按鈕） |
| [ADR 0019](docs/adr/0019-i18n-mechanism.md) | 多語系的機制（D9.1）：`@3db/i18n`、語意鍵加編譯期檢查的佔位、zh-TW 為來源語言、`npm run lint:i18n` 的「只減不增」基準（639 行待搬）、Worker 語言同步 |
| [phase0-verification.md](docs/phase0-verification.md) | Phase 0 驗收紀錄與 SW 人工核對步驟 |
| [phase1-verification.md](docs/phase1-verification.md) | Phase 1 驗收紀錄：三個示範零件、金樣與 TNP、驗收中發現的問題 |
| [phase3-plan.md](docs/phase3-plan.md) | Phase 3 的里程碑、驗收標準、需要的樣本與決定（決定 1–6 已確認；§5 數值暫時認定為 Pass） |
| [ADR 0050](docs/adr/0050-parts-list-and-exploded-view.md) | 零件表與爆炸視圖（3b-4，C15.16、C15.14，**組合件 Schema 5**）：`buildBom`（扁平／縮排、次組合件展開、排列與鏡射算數量、廠商／料號取自零件檔屬性）、CSV（BOM、引號）、`explosion`（步驟只存意圖，位移相加，展開／收合只是顯示，爆炸中不能動、STEP 仍是組裝位置） |
| [ADR 0051](docs/adr/0051-evaluation-tools.md) | 評估工具（3b-5，E1.1、E1.2、E2.1、E3.1，Schema 不變）：物質特性（慣性矩、主慣性矩、零件合成）、測量（精確距離、銳角、位姿與鏡射）、干涉檢查（頂層零組件、接觸不算、紅色重疊）、檢查模型幾何；7 項驗收與限制 |
| [phase4a-plan.md](docs/phase4a-plan.md) | Phase 4a 的里程碑、量化驗收（金樣）、預設假設（使用者沒有 SW 與真實工件，2026-10-03 決定先走完開發）、設計取捨與風險 |
| [phase5-plan.md](docs/phase5-plan.md) | Phase 5 工程圖的里程碑、預設假設（第一角、A3、ISO 128、PDF 中文字型內嵌）、量化驗收、風險 |
| [ADR 0068](docs/adr/0068-surface-bodies.md) | 曲面本體與核心的曲面方法（4b-1，零件 **Schema 28**）：`Kernel` 的偏移／縫織／填補／厚面／以曲面除料／投影分割（都量測間隙，0.05 mm）；曲面本體不是零件（質量、零件表、干涉、工程圖不算，STEP 當殼）；`offsetSurface` 特徵（核心；介面在 4b-3）；限制：轉 B 樣條在自由曲面邊的接合面會失敗、衍生零件與組合件顯示曲面本體還沒決定 |
| [ADR 0069](docs/adr/0069-split-line.md) | 分割線特徵（4b-2，零件 **Schema 29**）：草圖的封閉外圈沿法向投影到一個面，面被切成區域；區域面叫 `<特徵>:side:<草圖>.<圈>`、其餘保留原名，改草圖後名字不變；投影不到、面不見、草圖沒封閉都說原因；限制：沒有介面（4b-3）、線貼著週期面接縫會失敗、只投影外圈與封閉線 |
| [ADR 0070](docs/adr/0070-gauge-ui.md) | 分割線與偏移曲面的介面（4b-3）：功能區指令、PropertyManager 面板、編輯時顯示自己的結果（訊息框看得到失敗原因）、偏移曲面的量測間隙顯示（`FeatureResult.info`）、特徵自己的面不能選；限制：只用腳本驗證、視覺與畫布點選待使用者 |
| [ADR 0071](docs/adr/0071-surface-editing.md) | 縫織／填補／平坦／修剪／延伸曲面（4b-4，零件 **Schema 30**）：五個特徵與介面；縫織保留面名、結果是第一個本體；填補只有單一相鄰面的邊才相切，相切與 G0 都量測、不相切被拒；修剪＝投影分割＋保留一側（`keepFaces`）；延伸用 `BRepLib::ExtendFace`（試驗穩定，只限單一面的曲面本體）；限制：延伸限單一面、修剪只用外圈與草圖、清單是快照、只用腳本驗證 |
| [ADR 0072](docs/adr/0072-thicken-cut.md) | 厚面與以曲面除料（4b-5，零件 **Schema 31**）：厚面取代曲面本體成為實體、面名跟著模型；除料以曲面掃成刀具、曲面不變；STEP 輸出把偏移曲面轉成 B 樣條（轉換器中止時照原樣輸出並警告）；衍生本體保留曲面標記；組合件裡的曲面本體畫出來但不算零件；限制：厚面不保留曲面、除料只用平面法向、轉換後別的 CAD 讀不讀得進沒有試過 |
| [ADR 0073](docs/adr/0073-acceptance-4b.md) | Phase 4b 驗收 A 段（4b-6）：金樣工件（放樣自由曲面、含圓角的方塊，STEP 讀進來）做型面塊，間隙偏差 5e-5 mm、體積對辛普森與手算、接進 4a 夾具無干涉且塊到工件 3.000、剖面積手算；限制：**真實的沖壓件或塑膠件 STEP 待使用者**、剖面弧是折線、別的 CAD 讀 B 樣條沒試過 |
| [ADR 0074](docs/adr/0074-plastic-validation.md) | 塑膠件的技術驗證（6-0）：拔模角用**曲面本身在網格節點的法向**（網格平均法向在 5° 錐面差 0.1°、三角形法向差 0.38°、曲面法向 2e-15°）；底切＝沿拔模方向兩端的射線都被擋住（側孔壁 0%、沿拔模方向的孔 100% 可見）；厚度＝沿內法向的射線（均勻殼每面 2.000、楔形對手算、邊緣面量到整面牆高）；不等殼厚＝殼加 `moveFace`（地板 4 的盒子 19584）；唇溝＝`BRepOffsetAPI_MakeOffset` 的環（192 mm²）；發現：同一形狀的網格只做一次、暴力射線只夠小件 |
| [ADR 0075](docs/adr/0075-draft-analysis.md) | 拔模分析（6-1）：核心的 `draftAnalysis`（曲面法向在網格複本的節點上求值，每面最小與最大角、四類）、「工具」頁的分析視窗（方向、要求角度、各類面數與面積、各面角度、圖面上色）；分析不進文件、模型改了自動重算；限制：取樣只在節點、沒有連續色階與分模線、方向只有六軸與平面法向；教訓：`useStore` 的選擇器不能建新物件 |
| [ADR 0076](docs/adr/0076-undercut-analysis.md) | 底切分析（6-2）：包圍盒樹的射線（`buildBvh`/`anyHit`，對暴力法逐條相同）、核心的 `undercutAnalysis`（每個三角形一個取樣點，沿拔模方向兩端各射一條線，上方／下方／都看不到的比例，七類）、「工具」頁視窗與顏色；射線起點偏出網格容差的 0.75 倍（球赤道 5.6 mm² 的錯）；2.5 萬個三角形 0.4 秒；限制：只取三角形中心、門檻是我定的、只有一個拔模方向 |
| [ADR 0077](docs/adr/0077-thickness-analysis.md) | 厚度分析（6-3）：核心的 `thicknessAnalysis`（沿內法向射線、只算迎面的面、每面最小／**中位數**／最大、最薄最厚的地方、五類）、「工具」頁視窗與顏色（三個分析一次只開一個）；**拔模與底切共用的取樣 `forEachSample`**（每個面至少 400 個點，平的大面不再只有兩個點）；發現：邊角附近射線沿鄰牆走完全程所以最大與平均不可靠；空心球中位數誤差 0.15%、4.9 萬個三角形 0.85 秒；限制：定義與 SW 是否相同不知道、沒有連續色階、肋根的縮水風險沒做 |
| [ADR 0078](docs/adr/0078-unequal-shell.md) | 不等殼厚（6-4，零件 **Schema 32**）：薄殼的 `faceThickness`（先均勻做殼，再把由指定面長出的內側平面移動 `指定 − 壁厚`，用名稱追蹤，每步檢查位置與外包）、PropertyManager 的「壁厚不同的面」模式與清單、`setShell` 的選用參數；地板 4 的盒子 19584、加一面壁 3 是 20520；發現：地板厚過頭時 `moveFace` 回有效的本體（板長到本體外）所以要檢查外包；限制：只限平面的壁、結果在 ✔ 之後才看得到 |
| [ADR 0079](docs/adr/0079-lip-groove.md) | 唇與溝槽（6-5，零件 **Schema 33**）：`lipGroove`（平面、種類、離邊緣、寬度、高度）；核心的 `ringTool`（外輪廓向內偏移兩次的環，沿法向長出或切入，環要整個在面上否則拒絕）；面以輪廓的邊命名（外側 `side:ring.<邊>`、內側加 `~`）；環 192 mm²、唇 230.4、圓角矩形 185.13；限制：環只跟外輪廓、沒有自動的蓋子配合、`Intersection` 接合 |
| [ADR 0095](docs/adr/0095-closed-corner.md) | 封閉角落（H-6，C11.4，零件 **Schema 42**）：邊線凸緣的 `corner: {start?, end?}`（與鄰接凸緣的間隙）：折彎不變（仍由縮短躲開），折彎之後的平直段繼續長到離鄰接凸緣的內側剩這個間隙；找面向這一端並蓋住平直段中間的凸緣；平板型式的折彎窄、平直段寬；只做垂直於邊的鄰接凸緣，斜接／重疊／斷開角落沒做 |
| [ADR 0098](docs/adr/0098-fillet-by-face.md) | 圓角與導角選面、面圓角、完整圓角（零件 **Schema 43**）：存面不存邊、每次重算展開（略過接縫、單鄰面與相切的邊）；導角距離 1 量在選的面上；面圓角＝兩組面相接的邊（不相接明確拒絕）；完整圓角用布林切除半圓柱外的條狀區域並檢查體積（中央面要長方形、側面平行且不比半徑矮）；介面的圓角種類與面組；手冊 C23 到 C25；限制：不相鄰的面圓角、兩側不平行的完整圓角、變數半徑、選特徵與迴路沒做 |
| [ADR 0097](docs/adr/0097-fillet-by-face-validation.md) | 圓角與導角選面的技術驗證（F-0，[計畫](docs/fillet-by-face-plan.md)）：對面的所有邊倒圓角的頂點是斜接（手算與 OCCT 差 2e-10）、導角距離 1 量在選的面上、`Kernel.smoothEdges` 找相切邊、完整圓角不能用兩個圓角（R=w/2 失敗、略小留細條）所以用布林切除（精確）、凹邊補料、不相鄰的面沒有做法（明確拒絕） |
| [ADR 0096](docs/adr/0096-inventory-cleanup.md) | 鞏固 H-11 全面盤點與清理：移除沒用到的 import／匯出／只寫不讀的欄位（不改行為）、handoff 與 README 對齊現況、資安與隱私盤點（私人倉庫、無金鑰）；沒有 DEV_LOG.md 與 wiki/（單一來源是 handoff＋ADR＋git log）；跨電腦開發（`npm run doctor`、行尾規則 `eol=lf`）；桌面版安裝檔已用 4a–7 重建（2026-10-04） |
| [ADR 0094](docs/adr/0094-random-tests.md) | 鞏固 H-5：種子固定的隨機零件測試（鈑金溫和 36＋嚴苛 60、鏈 24、折過的基材 24、塑膠 40、一般零件 40）檢查任意參數都必須成立的性質；找到並修了兩個真問題：自己穿過自己的鈑金輪廓做出無效實體卻說成功、螺柱的肋四片以上面名重複；限制：只證明沒找到反例，引擎仍不檢查每個特徵的結果是否有效；補充 H-9：隨機組合件（疊塊、結合位置、3 自由度、干涉體積）與隨機工程圖（視圖、剖面、標註、SVG／DXF／PDF 讀回）也通過，沒有新問題；補充 H-10：距離加齊平、銷插孔、有圓角倒角的工程圖也通過 |
| [ADR 0093](docs/adr/0093-hole-draft-hem-rule.md) | 鞏固 H-4（零件 **Schema 41**）：螺柱 `holeDraft`（孔往孔底縮小，孔徑指孔口，空白＝直孔，不遷移；「同外壁」鈕；金樣的螺柱孔 +1.000° 不再需要拔模）；`sheetChecks` 的最小半徑略過摺邊（180°），金樣九項檢查全過 |
| [ADR 0092](docs/adr/0092-naming-merge.md) | 鞏固 H-1：併面時舊面保留原名（`faceBaseName` 同種來源取索引小的，本體在前）；修好 ADR 0085 的缺口：凸緣可以以任何順序做、在板上點的邊不再因別的凸緣併面而遺失；9 項測試（三種順序、塊上兩個共面凸台、前面插入基準面、壓抑再恢復） |
| [ADR 0091](docs/adr/0091-acceptance-7.md) | Phase 7 驗收 A 段（7-8）：金樣支架（板 120 × 60 × 1.5 加兩個孔、90° 凸緣縮短加離隙、135° 凸緣、摺邊）；摺疊的體積、平板大小與面積、折彎線、DXF 讀回、檢查全對手算；K 0.4（量規）、板長 140、板厚 2 全部跟著；找到：摺邊的內側半徑 0.5 在起始比例下不過檢查、相鄰邊的凸緣要手動縮短 |
| [ADR 0090](docs/adr/0090-gauge-checks.md) | 量規表與可製造性檢查（7-7，零件 **Schema 40**）：`PartDoc.sheetGauges`（名稱、板厚、內側半徑、K；沒有預設列，套用 = 複製數字進基材凸緣，不連動）；`sheetChecks`：內側半徑、折彎後平直段、孔到折彎區、縮短沒離隙，比例在平板型式視窗裡改（預設是我的起點，不是標準），每個檢查都回報過不過；孔距 4.0／2.0／1.0 對手算；限制：孔只認圓、規則不隨材料變 |
| [ADR 0089](docs/adr/0089-flat-pattern-dxf.md) | 平板型式的 DXF（7-6）：`flatPatternDxf`（`OUTLINE` 層的真 LINE／ARC／CIRCLE、`BEND` 層的虛線折彎線加註記 `UP 90° R2`、`T=… K=…`，移到原點）；`toDxf` 多 `extras`、`readDxf`／`checkDxf` 認得 LINE／ARC／CIRCLE；平板型式視窗的「輸出 DXF」；限制：沒有用真的 CAD／CAM 開過、沒有折彎表、沒有進工程圖 |
| [ADR 0088](docs/adr/0088-flat-pattern.md) | 平板型式（7-5，檔案格式不變）：`flatPattern(kernel, sheet)` 從折彎資料算（不展開實體）：基材放著、每個凸緣用剛體運動（折彎轉回去 + 移一個裕度）接在長出它的那一片上，核心做一片薄實體，輪廓與折彎線從它讀；127.3197 長（90° 凸緣）、摺邊 111.927、45° 129.2604、U 形槽展開 94.639 × 40；K 0.5 體積守恆；視窗（SVG、尺寸、折彎表）；限制：折過的基材上的凸緣沒做、沒有 3D 視圖的展開切換 |
| [ADR 0087](docs/adr/0087-insets-reliefs.md) | 凸緣縮短與離隙（7-4，零件 **Schema 39**）：邊線凸緣與摺邊的 `inset`（兩端各縮短，起端 = 面在前方外側在右手時開始的那端）與 `relief`（縮短處旁的矩形缺口）；相鄰邊的凸緣在角落留縫不再相貼；缺口 11.25 mm³ 對手算；限制：沒有封閉／斷開角落、離隙只有矩形、自動離隙要手填 |
| [ADR 0086](docs/adr/0086-hem.md) | 摺邊（7-3，零件 **Schema 38**）：`hem`（180° 折彎、間隙 = 兩層內側面的距離、回折的平直段；閉合摺邊就是很小的間隙）；與邊線凸緣共用 `foldEdge`（7-2 測試不改全過）；間隙 1 長 10 材料在內 8394.52 mm³；**凸折（板中間）沒做**——需要切開實體並移動一半的新核心操作，邊上的凸折用兩個邊線凸緣組成；限制：沒有淚滴與捲邊 |
| [ADR 0085](docs/adr/0085-edge-flange.md) | 邊線凸緣（7-2，零件 **Schema 37**）：`edgeFlange`（點板端面的一條直邊；長度從外側／內側虛擬交點或折彎之後量、角度、半徑、材料在內或折彎在外、往另一面折）；折彎是端面斷面繞中心旋轉、凸緣是同一斷面沿切線拉伸；板切掉的與加上去的體積逐步檢查；板 100 × 50 × 1.5 90° 長 30 材料在內 9548.98 mm³、45° 外側角在虛擬交點 + 30；凸緣上的凸緣；限制：只有直邊整條寬度、併面改名使邊線參考在重排特徵後會遺失、編輯時看不到結果 |
| [ADR 0084](docs/adr/0084-base-flange.md) | 鈑金參數與基材凸緣（7-1，零件 **Schema 36**）：`baseFlange`（板厚、內側半徑、K 因子；封閉輪廓是平板、開放折線是折過的板，轉角自動倒圓：轉向板厚那邊倒 r+T、轉離倒 r，內側半徑永遠是 r）；折彎資料 `RebuildResult.sheet`（裕度 θ(r+K·T)、展開長度 = 直段 + 裕度）；U 形槽 5678.3 mm³、展開長度 94.639、K 0.5 體積守恆；功能區新增「鈑金」頁；限制：只有基材凸緣、折線只能是直線、半徑整個零件一個 |
| [ADR 0083](docs/adr/0083-sheet-metal-validation.md) | 鈑金的技術驗證（7-0）：折彎是旋轉的矩形（45°–180° 體積 θ·T·w·(r + T/2)）、板＋折彎＋凸緣一個有效實體 10073.98 mm³、K = 0.5 的體積守恆是平板長度唯一獨立的檢查、折過的輪廓一次拉伸、角落留缺口；決定特徵原生、不展開任意實體；沒有改產品程式 |
| [ADR 0082](docs/adr/0082-acceptance-6.md) | Phase 6 驗收 A 段（6-8）：金樣外殼（壁 2、底 3 為變數、拔模 1°、唇、兩個螺柱、卡榫與底窗）與蓋；體積對手算積分、拔模 ±1.000°、底切恰好 187.2 mm²（卡榫自己）、厚度 2.000／3.000、蓋進 4a 的干涉（無；缺窗時 36 mm³）；找到：卡榫站在底上是底切（要在底開窗）、螺柱的孔沒有拔模；e2e 加 `H.tidy()` |
| [ADR 0081](docs/adr/0081-snap-hook-catch-vent.md) | 卡榫、窗、排氣口（6-7，零件 **Schema 35**）：`snapHook`（懸臂樑加楔形鉤，一個截面拉出寬度）、`snapCatch`（矩形窗）、`vent`（一排槽，可圓頭）都取草圖的自由點；窗與槽共用一個方法；面以點與槽號命名（蓋面改名成 `floor`／`lid`）；窗在殼的開口方向上被底切分析找到；限制：深度手填、沒有穿過第一道壁就停、不算樑的應變 |
| [ADR 0080](docs/adr/0080-screw-boss.md) | 螺柱（6-6，零件 **Schema 34**）：`screwBoss`（草圖的自由點上各一根柱：外徑、先導孔、高度、孔深、外壁拔模、三角形肋）；柱是旋轉的截面（埋進本體 0.5 mm 以接上，沒接到本體就是錯誤）、肋是通過軸的平面上的三角形、面以點與部位命名，殼的底厚改了螺柱跟著；柱 233.656 mm³、肋對數值積分；限制：孔徑手填、只長一個方向、只有三角形肋 |
| [sketch-snapping-plan.md](docs/sketch-snapping-plan.md) | 草圖吸附與推斷（參照 SW，**已規劃、未排入開發**）：現況與缺口、SW 的行為（出處是 SW 2010 繁中說明）、做法、里程碑 S-0 到 S-5 與量化驗收、風險與預設假設 |
| [phase7-plan.md](docs/phase7-plan.md) | Phase 7 鈑金的里程碑、預設假設（K 因子 0.5、半徑 = 厚度、外側虛擬交點、特徵原生不展開實體…）、驗收、風險 |
| [phase6-plan.md](docs/phase6-plan.md) | Phase 6 塑膠件的里程碑 6-0 到 6-8、預設假設（分析不是特徵、拔模四類、底切＝兩端被擋、厚度定義、不等殼厚只限平面、卡榫是簡化版）、驗收用金樣（與手算一致，SW 對照待使用者）、風險 |
| [ADR 0067](docs/adr/0067-surface-validation.md) | 檢具曲面的技術驗證（4b-0）：偏移（誤差 1e-6 到 3e-5 mm）、縫織、填補、厚面、投影分割、以曲面除料都可行；**偏移失敗時給有效但錯的形狀，必須量測結果**；整體偏移要包成實體、厚面要檢查反向、偏移曲面輸出轉 B 樣條 |
| [phase4b-plan.md](docs/phase4b-plan.md) | Phase 4b 檢具的里程碑、預設假設（間隙檢查 0.05 mm、曲面本體不是零件…）、驗收、風險 |
| [ADR 0066](docs/adr/0066-acceptance-5.md) | Phase 5 驗收 A 段（5-6）：4a 夾具的基板加工圖（過兩個 Ø6 H7 孔的剖面 1319.5 mm²、孔表、尺寸與公差）與組合圖（零件表、四個號球），手算、DXF／PDF 讀回；改主模型後圖跟著變；修正有倒角的孔被當成盲孔 |
| [ADR 0065](docs/adr/0065-dxf-and-pdf-output.md) | DXF（AC1015，`\U+XXXX`）與 PDF（向量、Helvetica、可內嵌 TrueType 子集）輸出（5-5，F3.1、F3.2）：三種輸出同一個場景；自寫的 DXF／PDF／TrueType 讀取器與檢查；限制：**尺寸是線與文字不是 DIMENSION 圖元**、**尚未在真實 CAD 與 PDF 檢視器開過（使用者待辦）**、PDF 字型每次要重選 |
| [ADR 0064](docs/adr/0064-assembly-drawing.md) | 組合件工程圖（5-4b，C16.6，Schema 4 不變）：組合件當視圖來源（讀齊零件、解結合、去掉隱藏與參考本體）；零件表（3b-4 的 BOM 畫成表）；零件號球（質心、沿視圖外緣滑開）；「新工程圖」從開啟的組合件；限制：號球不能拖、組合件視圖沒有尺寸與孔表 |
| [ADR 0063](docs/adr/0063-annotations-and-hole-table.md) | 中心記號與中心線、孔標註、孔表（5-4a，C16.5、C16.6，**工程圖 Schema 4**）：由零件算出不存；`holeInfo`（貫穿、盲孔、深度、沉頭）；孔表（字母分組、從左下平面量起、公差等級）；限制：不看螺紋與錐形沉孔、隱藏的孔也畫中心記號 |
| [ADR 0062](docs/adr/0062-dimensions.md) | 尺寸與公差（5-3，C16.4，**工程圖 Schema 3**）：尺寸存持久名稱不存數值（零件改了跟著走）；線性／直徑／半徑；自動尺寸（總長寬、孔徑與圓弧、孔位置）；ISO 286 公差（`H7`、`m6`…，IT5–IT12、500 mm 內）；畫法（箭頭、延伸線、導線）；限制：不能在畫布點選元素、沒有角度與孔深標註 |
| [ADR 0061](docs/adr/0061-derived-drawing-views.md) | 投影、剖面與細部放大視圖（5-2，C16.3，**工程圖 Schema 2**）：視圖四種聯集（衍生視圖不存來源與視角）；投影視圖的視角與對齊；剖面線箭頭、切平面、`Kernel.sectionView`（布林切除＋HLR＋切面外框）；45° 剖面線（奇偶規則）；細部圓裁切；面板數字輸入；限制：只有單一水平或垂直剖面、沒有畫布拖曳 |
| [ADR 0060](docs/adr/0060-drawing-document-and-views.md) | 工程圖文件 `.3dbd`（5-1，C16.1、C16.2，**工程圖 Schema 1**）：只存圖頁、標題、視圖；`Kernel.projectView`（精確 HLR，被可見線蓋住的隱藏線拿掉）；`@3db/drawing`（圖頁、第一角排版、場景、SVG）；`DrawingStore` 與畫布；限制：只畫零件、沒有剖面與尺寸與 DXF／PDF |
| [ADR 0059](docs/adr/0059-acceptance-4a.md) | 4a 驗收 A 段（不需樣本）：自製方塊工件的夾具從主模型到衍生零件、圖庫的銷與螺絲結合、干涉／餘隙／取放空間、零件表、STEP 往返、改基板厚度；B 段待使用者；面上草圖的原點是零件原點的投影 |
| [ADR 0058](docs/adr/0058-clearance-and-collision.md) | 餘隙確認、取放空間與拖曳碰撞偵測（4a-5，E2.2、A3.6，Schema 不變）：精確距離、保守前進＋二分找接觸、拖曳停在接觸前並標紅、`involving` 篩選、20 零組件 4–7 ms |
| [ADR 0057](docs/adr/0057-standard-parts-library.md) | 標準件圖庫（4a-4，F6.1，Schema 不變）：新套件 `@3db/library`，內六角螺絲／定位銷／平墊圈（ISO 4762／8734／7089）用變數做成零件檔，插入面板的「標準件圖庫」；廠商 STEP＝專案資料夾；沒有螺紋 |
| [ADR 0056](docs/adr/0056-dowel-pin-holes.md) | 定位銷孔（4a-3，C4.8，**零件 Schema 27**）：異型孔第五種 `dowel`（公差等級 H6／H7／H8、入口導角）、ISO 286-1 表（`dowel.ts`）、孔以標稱直徑做出（壓入的銷不被當成干涉）、面板顯示配合 |
| [ADR 0055](docs/adr/0055-advanced-mates.md) | 進階結合（4a-2，C15.9，**組合件 Schema 6**）：寬度、相互對稱、距離／角度的限制；求解器的結合泛化成 N 個端點；限制是「超出範圍的量」的殘差（距離剛好落在界線、角度可能在界線內側）；介面的進階結合與最小／最大欄位 |
| [ADR 0054](docs/adr/0054-derived-bodies.md) | 衍生本體與從本體產生組合件（4a-1，C7.5，**零件 Schema 26**）：`derivedBody`（只存來源與本體 id）、`SourceProvider`、名稱沿用主模型、內容鍵含主模型、零件表排除參考零件；限制：不即時更新、跨零件不共用主模型重算 |
| [ADR 0053](docs/adr/0053-acceptance-3b.md) | 3b 驗收 A 段（3b-7，不需樣本）：金樣夾具 STEP → 檔案 → 再輸出，平的與巢狀；B、C 段待使用者；測試支援 `goldenJig.ts`、`stepRoundTrip.ts` |
| [ADR 0052](docs/adr/0052-desktop-shell.md) | 桌面版（3b-6，F8.1）：Tauri 2 包網頁版，`files.ts` 不改（WebView2 的選擇器可用）、NSIS、離線；驗收第 3、7 項待使用者；`useLocalToolsDir` 的坑 |
| [ADR 0049](docs/adr/0049-step-assembly-import.md) | STEP 組合件輸入（3b-3，F2.8，Schema 不變）：`Kernel.readAssemblyStep`（階層、名稱、剛體位置、零件形狀、面顏色）、`stepAssemblyPlan`／`stepAssemblyFiles`（一個產品一個檔案：`.3dba`、`組件/`、`零件/`）、「檔案」→「輸入 STEP 組合件…」（每次選資料夾，寫入模式）、組合件輸出帶面顏色、顏色往返；金樣夾具 15 個零組件匯入 129 ms |
| [ADR 0048](docs/adr/0048-component-patterns-and-mirrors.md) | 零組件的複製排列與鏡射（3b-2，**組合件 Schema 4**）：只存定義（`patterns`，可省略）、實例是衍生位姿跟著種子、方向與軸可選組合件軸或零組件的元素、鏡射件在載入時由原件算出（不另存檔，取代決定 4）、`mirroredPose`、STEP 的鏡射產品；2a–2d 都做完 |
| [ADR 0047](docs/adr/0047-rigid-sub-assemblies.md) | 剛性次組合件與零組件隱藏／抑制／透明（3b-1，**組合件 Schema 3**）：次組合件是 `.3dba` 檔的零組件、`MateRef.path` 帶路徑的參考、父層視為一個剛體、旗標是可省略欄位、`findReferenceCycle` 讀檔偵測循環；1a–1e 都做完（巢狀 STEP 輸出、帶路徑的結合、抑制／隱藏／透明） |
| [ADR 0046](docs/adr/0046-phase3b-technical-validation.md) | 3b-0 技術驗證（2026-10-02）：鏡射零組件＝鏡射零件檔加剛體位姿（面序不變，OCCT 雖寫得出 det −1 的位姿但只有它自己讀過）、干涉檢查（20 個小零件 190 對 1.0 s，包圍盒先濾 0.5 s，Worker 內按需執行）、STEP 巢狀組合件讀回的結構對應（原型→零件檔、組合件原型→次組合件、只取每層相對位姿）、桌面版只做了調查（缺 Rust 與 MSVC，等使用者決定安裝）；證據 `spikes/occt-gaps/phase3b-validation.test.ts` |
| [ADR 0045](docs/adr/0045-acceptance-3a.md) | 3a 驗收（3a-10）不需樣本的部分：`tests/support/acceptance.ts`（對稱差、與參考形狀比對、關鍵尺寸 50%–200% 掃描）、`tests/phase3/acceptance.test.ts`（工具自測、三個金樣與兩類合成零件共 15 個關鍵尺寸 × 5 值全過）；§5 逐項狀態；等使用者的 3 個零件 |
| [ADR 0044](docs/adr/0044-system-options-english.md) | 系統選項與英文（3a-9c-3，Schema 不變）：`options.ts`（localStorage `3db.options`、`parseOptions`）、`OptionsDialog`、`Autosaver.enabled/delayMs/cancel`、`packages/i18n/src/en/`（860 多個文字全翻）；零件側文字已搬，程式碼裡剩 183 行（組合件） |
| [ADR 0043](docs/adr/0043-selection.md) | 選取（3a-9c-2，Schema 不變）：`three-mesh-bvh`（indirect，一條射線 10 ms → 0.13 ms）、`pickFilter`、右鍵選單（選取其他、相切邊線／面、迴圈）、`selectionSets.ts` 的 `Topology`（由名稱＋網格，10° 門檻）、`store.pickMany` |
| [ADR 0042](docs/adr/0042-view-options.md) | 顯示類型、視角選擇方塊、剖面視圖（3a-9c-1，Schema 不變）：`DisplayMode` 五種、`Viewer.cubeMatrix`／`subscribeView`、軸向剖面（裁切平面）、`contentBounds`；透視（D4.5）未做；順便修了指令列撐寬畫面 |
| [ADR 0041](docs/adr/0041-tree-order-folders-templates-shortcuts.md) | 設計樹的順序與資料夾與註解、範本、快速鍵（3a-9b，**Schema 25**）：`arrange` 指令（整個新順序加資料夾，一個復原步驟）、`orderProblem` 由父子關係檢查、拖放、資料夾要連續、註解／標籤／過濾、重新命名、`createPartFromTemplate`、`shortcuts.ts`（localStorage 覆寫） |
| [ADR 0040](docs/adr/0040-autosave-and-text-tools.md) | 自動存檔與當機復原（3a-9a）：存零件檔位元組進 IndexedDB、最後一次變更後 5 秒、頁面藏起來立刻存、下次開啟問復原或捨棄；`scripts/3dbx.mjs`（cat／unpack／pack）與 `npm run setup:git` 讓 `git diff` 看得到 `.3dbx` 裡的文字；B3.2／B3.4 量過不需要（53 個特徵 0.85 秒） |
| [ADR 0039](docs/adr/0039-output.md) | 輸出（3a-8c）：自寫二進位 STL（用文件設定的網格品質）、STEP 先問選項（AP214／AP242、顏色、座標系統）、座標系統當輸出座標系（`intoFrame`）、影像輸出（PNG）、AP242 設定要等第一個寫入器做出來才存在的陷阱 |
| [ADR 0038](docs/adr/0038-appearance.md) | 外觀與顏色（3a-8b）：零件／本體／特徵／面四種對象與優先序、`faceColors` 一處算出畫面與 STEP 用的顏色、STEP 面色以 sRGB 寫入、參考本體不輸出 |
| [ADR 0037](docs/adr/0037-material-and-settings.md) | 材質、質量與文件設定（3a-8a，**Schema 24**）：材質存名稱與密度（內建表複製進文件）、質量＝體積×密度、製圖標準／尺寸小數位數／顯示與輸出品質 |
| [ADR 0036](docs/adr/0036-mirror.md) | 鏡射（3a-7c，**Schema 23**）：`mirror` 特徵（對象是特徵或本體）、特徵的鏡射就是只有一個實例的排列（共用 `repeat`）、本體鏡射走既有的 `apply`（合併或獨立本體）、面名稱 `<鏡射>:mirror:<原名>`、鏡射面是任何平面、3a-7 驗收標準逐項 |
| [ADR 0035](docs/adr/0035-patterns.md) | 線性與環狀複製排列（3a-7b，**Schema 22**）：排列的是種子特徵對本體加上與移除的材料（幾何圖樣：之前與之後的本體相減）、實例的面名稱 `<排列>:inst<標籤>:<原名>`、`count` 型別的運算式、`Kernel.transformed`（3 × 4 矩陣）、要跳過的實例、三種可讀的錯誤（沒碰到本體、成了分開的一塊、互相重疊） |
| [ADR 0034](docs/adr/0034-reference-geometry.md) | 參考幾何（3a-7a，**Schema 21**）：基準面的平行／垂直／中間／相切、`refAxis` 基準軸、`refPoint` 參考點、`coordSys` 座標系統（永遠右手系）；`kind: 'datum'` 的參考指向基準特徵 ID；`defRefs`／`mapDefRefs` 一處管所有定義的參考；選取方塊的一張表 `datumSlots.ts`；屬性管理員的基準按鈕（開著屬性管理員時設計樹被蓋住）；圖面顯示 |
| [ADR 0033](docs/adr/0033-rib.md) | 肋材（3a-6d，**Schema 20**）：`rib` 特徵（草圖裡一條直線＋厚度＋厚度的位置＋反轉）、牆在草圖面內垂直於線長到本體（既有的「伸長至本體」加接合）、不自動選方向而是說明要反轉、面名稱 `<肋材>:side:<草圖>.<線>.neg／pos／end1／end2` 與 `cap:start` |
| [ADR 0032](docs/adr/0032-loft.md) | 疊層拉伸（3a-6c，**Schema 19**）：`loft` 特徵（截面草圖依序，每張一個封閉輪廓、沒有洞）、`ThruSections` 平滑通過（兩個截面時是直紋，不提供直紋選項與原因）、截面對齊交給 OCCT、面用第一個截面的邊命名、結果必須是有效實體、`Kernel.bounds` 對平滑曲面偏大的觀察 |
| [ADR 0031](docs/adr/0031-sweep.md) | 掃出（3a-6b，**Schema 18**）：`sweep` 特徵（輪廓草圖＋路徑草圖，路徑一條開放的線與圓弧）、從路徑落在輪廓平面上的那一端開始、跟隨路徑（修正的 Frenet）、封閉路徑 OCCT 給體積 0 所以拒絕、面名稱 `<掃出>:side:<輪廓草圖>.<輪廓圖元>@<路徑圖元>`（兩個產生清單的交集）、有洞的輪廓＝外輪廓掃出減洞掃出、結果必須是有效實體 |
| [ADR 0030](docs/adr/0030-hole-wizard.md) | 異型孔精靈（3a-6a，**Schema 17**）：`hole` 特徵（草圖的每個單獨點、四種孔、內建 ISO 表只存運算式）、旋轉刀具＋除料、面名稱 `<孔>:side:<草圖>.<點>.<部位>`、`includedAngle` |
| [ADR 0029](docs/adr/0029-draft-feature.md) | 拔模特徵（3a-5c，**Schema 16**）：`draft` 特徵（中立面＋面＋角度＋反轉）、方向規則（離中立面越遠越窄）、與伸長拔模共用 `Kernel.draftFaces`、`ModifiedShape` 讓名稱不變、切線相連的面要一起選、薄殼「OCCT 回報完成卻原封不動」的防呆 |
| [ADR 0028](docs/adr/0028-shell.md) | 薄殼（3a-5b，**Schema 15**）：`shell` 特徵（移除面＋壁厚＋向外）、MakeThickSolid、面的演化（保留 same／開口環 modified／內側 generated from face）、命名 `<薄殼>:shell:<原面>` 與一個曾踩到的命名錯誤、壁厚太大是可讀的錯誤 |
| [ADR 0027](docs/adr/0027-extrude-revolve-p1.md) | 伸長與旋轉的 P1（3a-5a，**Schema 14**）：成形到下一面（從幾何決定）／至頂點（只是深度）／至本體／從曲面偏移（只做平行平面）、方向 2（遠端蓋叫 `cap:start`）、拔模（先伸長再 DraftAngle，面靠 `ModifiedShape` 找回，名稱不變）、薄件（自己的精確偏移，環與帶，面名加後綴） |
| [ADR 0026](docs/adr/0026-sketch-entities-that-follow-the-model.md) | 跟著模型走的草圖圖元（3a-4d，**Schema 13**）：參考圖元是帶 `ref` 的一般圖元、重算時依模型移動並固定（圓弧固定圓心、起點與弦長）、只轉直線與平行於草圖面的圓／圓弧、面的外框、貫穿、遺失參考是草圖的錯誤、投影在 Worker 做 |
| [ADR 0025](docs/adr/0025-sketch-diagnosis-check-and-contours.md) | 草圖的衝突診斷、檢查與修復、輪廓選取（3a-4c，**Schema 12**）：診斷只列求解器證實有效的處理、六種檢查問題與只做不需要決定的修復、輪廓用外圈圖元 ID 記住並以共用一半以上找回、沒有選擇就是全部 |
| [ADR 0024](docs/adr/0024-sketch-relations-and-driven-dimensions.md) | 草圖 P1 限制條件與從動尺寸（3a-4b，**Schema 11**）：同心同徑與交錯是一個限制條件、合併是操作（兩點之間有尺寸就拒絕）、弧長尺寸、從動尺寸（`driving: false`）的建立／改回與被運算式引用時的拒絕、過多定義的尺寸改成從動、從動顯示量到的值 |
| [ADR 0023](docs/adr/0023-sketch-tools-p1.md) | 草圖工具 P1（3a-4a，Schema 不變）：每個工具是一個回傳 `SketchEdit` 的純函式、`editSketch` 指令的順序、圓角／導角的虛擬交點、狹槽／多邊形的自由度、靜態鏡射加對稱、修剪／延伸／偏移的規則與拒絕的情形、相切接續偏移的冗餘 |
| [ADR 0022](docs/adr/0022-multiple-bodies.md) | 多本體（3a-3，Schema 10）：本體的身分與切開的編號、名稱不加本體前綴、合併結果與除料切開的行為、組合特徵、參考本體、合併視圖讓其餘程式不必知道有幾個本體、本體的隱藏要重算 |
| [ADR 0021](docs/adr/0021-direct-editing-and-import-repair.md) | 直接編輯與輸入修復（3a-2，Schema 9）：刪除面（Defeaturing）與「刪除鑽孔」的意圖、移動面的兩種做法（掃出／延伸板）與拒絕的情形、只重新分組鄰面、輸入診斷與縫合（容差存在特徵上）、置換面未做 |
| [ADR 0020](docs/adr/0020-expressions-and-variables.md) | 運算式、全域變數與檔案屬性（3a-1，Schema 8）：帶量綱的求值、`D1@草圖1` 引用、循環偵測、先解析成數字再交給求解器、改名連動、由運算式推導父子關係、方程式與檔案屬性對話框 |
| 本文件 | 狀態、待辦、下一步、約定 |

## 3. 目前狀態

- **Phase 0 行走骨架**：驗收全部通過。① ③ ④ 由自動化測試證明；② 使用者已在 SW 核對通過（2026-09-27）。
- **OCCT 缺口技術驗證**：完成，幾何核心已改用 `libcascade` 3.0.2（OCCT 8.0.1）。
  - 仍缺 `BRepOffset_MakeOffset`（C10.1 移動面），Phase 3a 前決定做法。
- **Phase 1A 草圖編輯器**：完成並已提交。細節見 ADR 0004 與 §9。
- **Phase 1B 特徵與布林**：完成，已提交並推送（`61bac81`）。細節見 ADR 0005 與 §9。
- **Phase 1D 樹狀結構操作**：完成，已提交並推送（`ca85736`）。細節見 ADR 0006 與 §9。
- **Phase 1C 基準面**：完成並提交。細節見 ADR 0007 與 §9。
- **Phase 1E 檔案**：完成並提交。細節見 ADR 0008 與 §9。系統檔案對話框已由使用者實機確認（2026-09-28）。
- **Phase 1F STEP 輸入**：完成並提交。細節見 ADR 0009 與 §9。使用者以自己的 SW 樣本驗收通過（2026-09-28）；輸入特徵的名稱「輸入1」已確認。
- **Phase 1G 驗收**：藍圖 Phase 1 驗收 ①②③ 都已完成，**閘門已由使用者確認通過（2026-09-28）**。細節見 [phase1-verification.md](docs/phase1-verification.md)。
  - 驗收中發現的 3 個問題都已修正，見 ADR 0010：整圈旋轉平面的命名、角度尺寸的量測側、零件名稱不隨檔名。
- **Phase 1 零件 MVP**：完成。
- **Phase 2 組合件 MVP**：完成（里程碑 2A–2F，§10）。**閘門已由使用者確認通過（2026-09-30）**，但驗收範圍低於藍圖原文：使用者沒有 SW，改以金樣夾具（15 個零組件、39 個結合）的自動測試、輸出 STEP 在 eDrawings 的目測與兩個真實 STEP 的部分驗收取代「用 SW 樣本重組」與「在 SW 開啟」。
  - **2A 組合件骨架**：完成並已提交推送（`7906934`）。細節見 ADR 0011 與 §10。系統的資料夾與存檔對話框已由使用者實機確認（2026-09-30，§8）。
  - **2B 結合求解器**：完成並已提交推送（`d10c2ad`）。細節見 ADR 0012 與 §10。另修正一個 Phase 1 的問題：旋轉件平面的法向（ADR 0012「修正」）。
  - **2C 結合的介面與管理**：完成並已提交推送（`c3f3860`）。細節見 ADR 0013 與 §10。驗收：只用 UI 把三個金樣零件組成小夾具並完全定義，矛盾的結合被正確指出。STEP 檔可直接當零組件插入。
  - **2D 移動零組件與參考檔**：完成並已提交推送。細節見 ADR 0014 與 §10。驗收：拖曳部分定義的零組件只沿剩餘自由度移動；零件檔改名後開啟組合件會詢問並可重新指定；從組合件開啟零件改尺寸、返回後結合仍成立。
  - **2E STEP 組合件輸出**：已實作並通過自動與瀏覽器驗證，已提交推送（`49e93c7`）。細節見 ADR 0015 與 §10。「檔案」→「輸出 STEP」在組合件中可用，寫出一個組合件，每個零件檔一個原型、每個零組件一個帶位姿的實例。金樣夾具的輸出檔已由使用者在 eDrawings 開啟確認（§8）。
  - **2F 驗收**：見 §10。金樣組合件測試（15 個零組件）、兩個真實 STEP 的部分驗收，閘門通過。
- **分支與遠端**：只在 `main` 開發。遠端 `origin` = https://github.com/Chun-Chieh-Chang/3D-Builder（私人），`main` 追蹤 `origin/main`。`spike/occt-gaps` 已合併、未推送，可以刪除。
- **2F 之後的收尾（2026-09-30，已提交推送 `92a434d`）**：零組件的網格變粗（三角形約減六成）、載入進度提示（階段與秒數）、壞的 STEP 檔顯示錯誤。細節見 ADR 0016。
- **Phase 1 遺留的 P0 已補（2026-09-30，ADR 0018，已提交推送）**：D4.6 顯示/隱藏（基準面、草圖、原點；本體與軸要等 3a-3、3a-7）與 B4.3 遺失參考的「改用這個」。**Schema 升為 7**（`visibility`），所以 Phase 3a-1 的 Schema 是 v8，不是 v7。
- **多語系機制已完成（2026-09-30，ADR 0019）**：新套件 `@3db/i18n`（**在新電腦或 pull 之後要再 `npm install`，工作區才會連上它；開發伺服器也要重啟**）。新的使用者可見文字一律 `t()`，寫進 `packages/i18n/src/zh-TW/`；`npm run check` 多一道 `lint:i18n`，既有的 639 行中文字串記在 `scripts/i18n-baseline.json`，只能減少。英文翻譯與設定畫面留到 3a-9。
- **3a-1 運算式與變數已完成（2026-09-30，ADR 0020）**：**Schema 升為 8**（v7 是 D4.6 的 `visibility`）。`packages/model/src/expr/`（解析器與求值）、`params.ts`（變數與尺寸的分析、解析、相依、改名連動）；`Regenerator.rebuild` 與草圖求解前先把運算式解析成數字，PlaneGCS 與 OCCT 沒有改。新的介面文字都走 `t()`。
- **3a-2 輸入修復與直接編輯已實作（2026-10-01，ADR 0021，`78e0cad`）**：**Schema 升為 9**。「特徵」分頁多了「刪除面」（`BRepAlgoAPI_Defeaturing`，含「刪除鑽孔」勾選，存成意圖 `hole`，重算時由模型找出孔壁的另一半、孔底、孔口倒角）與「移動面」（平面，沿外法向；鄰面都垂直時掃出該面，否則延伸板；相切、非凸又有斜鄰面、往內移超過厚度都拒絕並說明）；輸入本體的屬性管理員多了診斷報告與「縫合容差」（只有曲面的檔案縫成實體，縫不起來就說還有幾條邊沒接上）。置換面使用者決定先不做。實作在 `packages/kernel/src/kernel.ts`（`deleteFaces`、`moveFace`、`repairImport`）、`packages/regen/src/engine.ts`（`deleteFace`、`moveFace`、`holeFaces`、匯入快取以雜湊加容差為鍵）、`packages/model`（兩種特徵、`setFaces`、`setMoveFace`、`setImportOptions`）。
- **3a-3 多本體已實作（2026-10-01，ADR 0022，已提交推送）**：**Schema 升為 10**。重算的狀態是一串本體（`packages/regen/src/bodies.ts` 的 `Bodies`），`RebuildResult.body` 仍是「所有本體接起來的視圖」（只有一個本體時就是它），另有 `RebuildResult.bodies`；填料的「合併結果」（預設合併接觸的本體，沒接觸就成為新本體）、除料作用於碰到的所有本體並把切開的幾塊各成一個本體、「組合」特徵（加入／減除／共同）、參考本體（不計質量與零件 STEP）、本體的隱藏／重新命名；輸入的多實體 STEP 每個實體一個本體。名稱沒有加本體前綴（ADR 0022 決策 2）。`kernel.splitSolids／join／clone／solidCount`、`naming.nameFromFaces` 是新的。
- **3a-7a 參考幾何已實作（2026-10-01，ADR 0034，Schema 21，提交後推送）**：基準面多了平行、垂直、中間、相切四種；新增基準軸、參考點、座標系統三種特徵（「特徵」分頁的新按鈕）。實作在 `packages/regen/src/engine.ts`（`refPlane`、`refAxis`、`refPoint`、`coordSys`）、`packages/model`（定義型別、`setRefAxis`／`setRefPoint`／`setCoordSys`、`defRefs`／`mapDefRefs`）、`apps/web/src/state/datumSlots.ts`、`packages/render` 的 `setDatums`。
- **3a-7b 線性與環狀複製排列已實作（2026-10-01，ADR 0035，Schema 22，提交後推送）**：「特徵」分頁的「線性複製排列」「環狀複製排列」。實作在 `packages/regen/src/engine.ts`（`planPatterns`、`snapshot`、`captureDelta`、`placements`、`pattern`、`noOverlap`）、`packages/regen/src/placements.ts`（平移／轉動／鏡射矩陣）、`packages/kernel`（`transformed`）、`packages/model`（`PatternFeature`、`setPattern`、`patterns.ts`、`count` 型別運算式）、`apps/web`（`PatternPanel`、`datumSlots` 的方向與旋轉軸格子）。
- **3a-7c 鏡射已實作（2026-10-01，ADR 0036，Schema 23，提交後推送）；3a-7 到此完成**：「特徵」分頁的「鏡射」。實作在 `packages/regen/src/engine.ts`（`mirror`、`mirrorFeatures`、`mirrorBodies`、與排列共用的 `repeat`）、`packages/model`（`MirrorFeature`、`setMirror`）、`apps/web`（`MirrorPanel`）。
- **3a-8 材質、屬性與輸出已實作（2026-10-01，ADR 0037–0039，Schema 24，提交後推送）；3a-8 到此完成**：「工具」分頁的「檔案屬性」多了材質與文件設定、「外觀」；「檔案」分頁的「輸出 STEP」先問選項、多了「輸出 STL」「輸出影像」。範圍是使用者 2026-10-01 確認的：材質與質量、外觀與顏色、STL、AP242 與影像輸出，加上座標系統當 STEP 輸出座標系。
- **3a-9a 自動存檔與文字化格式工具已實作（2026-10-01，ADR 0040，Schema 不變，提交後推送）**：有未存檔的變更時 5 秒後在瀏覽器留一份；下次開啟會問「復原」或「捨棄」。`node scripts/3dbx.mjs cat|unpack|pack`；每個 clone 跑一次 `npm run setup:git` 後 `git diff` 看得到零件檔裡的變更。
- **3a-9b 設計樹與範本與快速鍵已實作（2026-10-01，ADR 0041，Schema 25，提交後推送）**：設計樹的列可以拖放調整順序（受父子關係約束）、有資料夾、註解與標籤、過濾、重新命名；「檔案」→「新零件（範本）…」；「工具」→「快速鍵…」。
- **3b-0 技術驗證進行中（2026-10-02，ADR 0046）**：② 鏡射零組件、③ 干涉檢查效能、④ STEP 組合件結構對應已量測並有決定；**① 桌面版（Tauri）卡在這台沒有 Rust 與 MSVC 建置工具**（`rustc`、`cargo`、`vswhere` 都找不到，WebView2 154 有、`winget` 有），安裝要使用者許可；檔案存取集中在 `apps/web/src/files.ts` 一個模組。**使用者 2026-10-02 決定先跳過 ①（3b-6 桌面版開工時再裝 Rust 與 MSVC 並驗證 File System Access、WASM 本機載入）；下一步是 3b-1 剛性次組合件。**
- **3b-1 剛性次組合件進行中（2026-10-02，ADR 0047，**組合件 Schema 升為 3**）**：使用者確認的範圍：只做插入現有 `.3dba`（不做「形成新次組合件」）、父層結合可選次組合件內零件的面與邊（`MateRef.path`）、每個子步驟提交後也推送。計畫與 12 項驗收標準見該次對話（摘要在 ADR 0047）。步驟：**1a 資料格式與循環偵測（已完成）**→ **1b 求解（已完成：`solveSubAssembly`、`mateGeometryIn` 沿路徑走，不合併幾何；與攤平版本位姿差 < 1e-6、內部相對位姿變化 < 1e-9）**→ **1c Store／Worker／介面（已完成：插入 `.3dba`、設計樹展開、帶路徑的結合、開啟次組合件與返回、巢狀缺檔會說檔名；瀏覽器腳本 `tests/e2e/phase3-subassembly.js`：`await __sub.open()`／`move()`／`insert()`；與驗收標準 9 的出入見 ADR 0047 決定 11）**→ **1d 隱藏／抑制／透明（已完成：`setComponentState` 指令、抑制不求解且結合跟著抑制、隱藏不畫、透明改材質；設計樹右鍵選單；`__sub.states()`）**→ **1e 巢狀 STEP 輸出（已完成：`Kernel.exportAssemblyStep` 的 `subs`、`stepStructure`；`__sub.step()`）。3b-1 全部做完；只剩驗收標準第 11 項的 eDrawings 目測要使用者做（ADR 0047 最後一節）。下一個是 3b-2 複製排列與鏡射零組件（phase3-plan §4）。**
- **3b-2 零組件複製排列與鏡射進行中（2026-10-02，ADR 0048，組合件 Schema 升為 4）**：使用者確認：實例是衍生位姿（不能再加結合）、鏡射件載入時由原件算出不另存檔、驗收標準 1–9（見 ADR 0048；其中第 5 項「面名稱對得上」改為「鏡射件的面與原件逐面對得上」，因為實例不當結合對象）。**3b-2 全部做完（2a 資料格式、2b 葉子與 Worker 的鏡射網格、2c 屬性管理員與設計樹、2d STEP）**；瀏覽器腳本 `tests/e2e/phase3-component-pattern.js`（`await __pat.run()`、`__pat.step()`）。驗收 5 部分通過（實例不能當結合對象，見 ADR 0048 決定 11）；限制：次組合件自己檔案裡的排列在上一層不顯示、鏡射面只有組合件的前上右基準面。**下一個是 3b-3 STEP 組合件輸入（F2.8）。**
- **3b-3 STEP 組合件輸入已完成（2026-10-02，ADR 0049，Schema 不變）**：使用者確認：每次選資料夾、顏色一起做。命令「檔案」→「輸入 STEP 組合件…」；瀏覽器腳本 `tests/e2e/phase3-step-import.js`（`await __imp.run()`）。限制：零組件名稱用「檔名＋編號」不沿用 STEP 的；沒有真實的（別家軟體輸出的）保留結構的組合件 STEP 可驗，要補需要使用者提供（§8）；寫入失敗時的清除沒有測試。**下一個是 3b-4 零件表與爆炸視圖（phase3-plan §4）。**
- **3b-4 零件表與爆炸視圖已完成（2026-10-02，ADR 0050，組合件 Schema 升為 5）**：使用者確認：零件表兩種結構可切換、爆炸方向用軸或任一元素。命令列「組合件」→「零件表…」「爆炸視圖」；瀏覽器腳本 `tests/e2e/phase3-bom.js`（`await __bom.run()`）、`tests/e2e/phase3-explode.js`（`await __exp.run()`）。限制：爆炸只能動頂層零組件、沒有爆炸線與動畫、只有一組爆炸視圖；CSV 不防公式注入；廠商／料號從真實零件檔屬性到零件表沒用真實檔走過一次。**下一個是 3b-5 評估（測量、物質特性、檢查模型幾何、干涉檢查，phase3-plan §4）。**
- **3b-5 評估已完成（2026-10-03，ADR 0051，Schema 不變）**：使用者確認：干涉的比對單位是頂層零組件（次組合件一個，排列與鏡射的複製品各一個）、結果是清單加圖面紅色重疊體積。命令：零件「工具」→「測量」「物質特性…」「檢查幾何…」；組合件「組合件」→「測量」「干涉檢查」「物質特性…」「檢查幾何…」。瀏覽器腳本 `tests/e2e/phase3-physical.js`（`await __physical.run()`）、`phase3-measure.js`（`__measure.assembly()`／`.part()`）、`phase3-interference.js`（`__interference.run()`）、`phase3-check.js`（`__check.assembly()`／`.part()`）。核心新增 `inertia`、`distance`、`common`、`check`、`subShape`；model 的 `mass.ts`、`measure.ts`、`interference.ts`；regen 的 `measure.ts`、`interference.ts`；`Viewer.setHighlights`。限制：次組合件內部的干涉不查（**夾具裡削邊銷的 r=5 本體站在板的 r=4 孔裡，約 405 mm³ 一支，是夾具本身的幾何**）；接觸不算干涉，重疊 < 1e-3 mm³ 不報；夾角是銳角；表面積是各零件的總和；20 個零組件單獨跑 1.04 s 牆上時間，整套平行時測試改量 CPU 時間（預算 4 s，只擋退步）；紅色重疊是用 Viewer 物件驗證的，沒有用眼睛看截圖（截圖在這台機器上不穩）；沒用第三方零件檔驗證。**下一個是 3b-6 桌面版（Tauri，需要裝 Rust 與 MSVC，先問使用者許可）。**
- **3b-6 桌面版已完成（2026-10-03，ADR 0052，Schema 不變）**：使用者確認：用 winget 裝 Rust 與 VS Build Tools、先驗證 WebView2 再決定要不要原生外掛、NSIS。`apps/desktop`（Tauri 2.12）只是載入 `apps/web/dist` 的視窗，**`files.ts` 沒動**（WebView2 裡三個選擇器、OPFS、IndexedDB 都可用，來源 `http://tauri.localhost` 是安全環境）。`npm run build -w @3db/desktop` 產生 `apps/desktop/src-tauri/target/release/bundle/nsis/3D-Builder_0.1.0_x64-setup.exe`（首次建置 11.02 MiB；2026-10-04 用 4a–7 重建後 11.13 MiB）；`tests/e2e/desktop-probe.mjs` 用 DevTools Protocol 檢查視窗並在裡面跑瀏覽器腳本（9 個全過）。**驗收 7 項裡第 3 項（原生對話框開啟、儲存）與第 7 項（沒裝過開發工具的帳號安裝）沒做，要使用者做（ADR 0052 有步驟）；第 2 項斷網沒真的拔網路。** 限制：沒有自動更新、安裝檔沒簽章、圖示是暫用的、解除安裝留下 `%LOCALAPPDATA%\app.3dbuilder.desktop`（使用者資料）。坑：在 Claude 桌面版的工作階段裡建置，`%LOCALAPPDATA%` 被重新導向，Tauri 改 NSIS 工具資料夾名稱會失敗，所以設了 `bundle.useLocalToolsDir`。**下一個是 3b-7 驗收（phase3-plan §4，需要真實樣本，見 §8）。**
- **3b-7 A 段已完成（2026-10-03，ADR 0053）**：`tests/phase3/acceptance-3b.test.ts` 11 項。金樣夾具（15 零組件、39 結合）輸出 STEP → `stepAssemblyFiles` → 重新開啟 → 再輸出，平的與巢狀（次組合件用 3 次）樹、名稱、位姿（差 0 mm，標準 < 0.01）、零件體積（對手算）都一致，且為不動點。**沒做：**真實第三方 STEP（B 段）、eDrawings 目測、桌面版人工驗收（C 段）。3b 閘門因此是「有條件通過」。這台電腦要先 `npm install` 才有 `node_modules/@3db` 連結。
- **Phase 4a 開發完成（2026-10-03，ADR 0054–0059），閘門是有條件通過**：4a-1 衍生本體與從本體產生組合件、4a-2 進階結合、4a-3 定位銷孔、4a-4 標準件圖庫（`@3db/library`）、4a-5 餘隙與取放空間與拖曳碰撞、4a-6 A 段驗收（金樣夾具）。B 段（真實工件與廠商件、eDrawings／SW）待使用者（§8）。
- **Phase 5 工程圖進行中（2026-10-03，使用者決定先做 5 再做 4b；計畫見 [phase5-plan](docs/phase5-plan.md)，驗收用金樣）**：
  - **5-0／5-1（ADR 0060）**：`Kernel.projectView`（精確隱藏線）、工程圖文件 `.3dbd`（第三種文件 `drawing`）、圖頁與標題圖塊、標準三視圖（第一角）、`@3db/drawing`（場景、SVG）、App 的工程圖模式。
  - **5-2（ADR 0061，Schema 2）**：投影、剖面（`Kernel.sectionView`、45° 剖面線）、細部放大視圖。
  - **5-3（ADR 0062，Schema 3）**：尺寸指到零件元素的持久名稱（不存數值）、自動尺寸、ISO 286 公差。
  - **5-4a（ADR 0063，Schema 4）**：中心記號與中心線、孔標註、孔表。**5-4b（ADR 0064）**：組合件當視圖來源、零件表、零件號球；「新工程圖」也能從開啟的組合件。
  - **5-5（ADR 0065）**：DXF（AC1015）與 PDF（Helvetica、可內嵌 TrueType 子集）輸出，附自寫的讀取器與檢查。**尚未在真實 CAD 與 PDF 檢視器開過（§8）。**
  - **5-6（ADR 0066）**：驗收 A 段：4a 的夾具出兩張圖（基板加工圖：三視圖、過兩個定位銷孔的剖面 1319.5 mm²、孔表、尺寸與 H7 公差；組合圖：零件表與四個號球），每個數字手算，輸出 DXF／PDF 讀回；改主模型後圖跟著變。**Phase 5 開發完成，閘門有條件通過。** 驗收中修了一個問題：有倒角的孔被當成盲孔。
  - **4b 檢具開發完成（2026-10-03），閘門有條件通過**：使用者說「接著做 4b 檢具」。[phase4b-plan](docs/phase4b-plan.md)（型面塊＝工件型面退一個間隙再加厚；預設假設、里程碑 4b-0 到 4b-6、驗收用金樣）。
    - **4b-0 已做（ADR 0067，`tests/phase4b/surface-spike.test.ts` 17 項）**：偏移自由曲面（含圓角的區域、整個實體、向內）間隙誤差 1e-6 到 3e-5 mm，遠小於 0.05 mm；縫織、填補（相切 0.02 mm）、厚面、投影分割（區域面積對手算積分 1e-5）、以曲面除料（2e-6 mm）都可行。**發現：偏移失敗時 OCCT 給「有效但錯」的形狀（間隙誤差 1.99 mm），所以每個曲面特徵都要量測結果**；整個實體的偏移是殼要包成實體；厚面可能整個反向；偏移曲面輸出前轉 B 樣條。
    - **4b-1 已做（ADR 0068，零件 Schema 28）**：`Kernel` 的 `gapReport`、`offsetFaces`、`offsetSolid`、`knit`、`fillSurface`、`flatSurface`、`thicken`、`cutWithSurface`、`splitByProjection`、`toBSpline`（每個都有手算測試，結果都量測間隙、超過 0.05 mm 就失敗並說出量到的誤差）；**曲面本體**（沒有實體，不是零件：實體特徵不碰它、質量與零件表與干涉與工程圖不算它、STEP 當殼、設計樹標「（曲面）」）；`offsetSurface` 特徵與 `setOffsetSurface` 指令（沒有介面）。發現：OCCT 的偏移結果要連幾何複製才能在建構物件釋放後使用；已是 B 樣條的接合面轉 B 樣條會中止。
    - **4b-2 已做（ADR 0069，零件 Schema 29）**：`splitLine` 特徵（草圖、面、方向、穿透全部）與 `setSplitLine` 指令（沒有介面）；核心的 `splitByProjection` 改成收多個圈並回傳每個區域是哪一圈；區域面叫 `<特徵>:side:<草圖>.<圈>`（圈＝最小的實體編號），其餘的面保留原名；區域面積對手算積分、選區域做偏移曲面也對手算。發現：投影的線貼著週期面的接縫會讓結果無效（退化情形，未處理）。
    - **4b-3 已做（ADR 0070，檔案格式不變）**：功能區「特徵」頁的「分割線」「偏移曲面」；PropertyManager 面板（面選擇框、距離、接合、草圖下拉、反轉、穿透全部）；編輯時顯示特徵自己的結果，失敗原因在訊息框；偏移曲面的**量測間隙**經 `FeatureResult.info` 顯示；特徵自己做出的面不能選回去。只用腳本驗證（`tests/e2e/phase4b-gauge-ui.js`），畫布上真的點選與視覺待使用者看。
    - **4b-4 已做（ADR 0071，零件 Schema 30）**：`knit`、`fillSurface`、`flatSurface`、`trimSurface`、`extendSurface` 五個特徵（指令、重算、命名、介面）；核心的 `knit` 回傳面的來源、新增 `keepFaces`、`extendFace`。延伸先驗證（`BRepLib::ExtendFace` 穩定，只限單一面的曲面本體）。**發現**：圓柱壁上的相切填補 OCCT 給平面圓盤（離邊線很近、切線差 90°），所以填補的相切也量測並拒絕（0.02 弧度）；只有「恰好一個相鄰面」的邊才能相切。縫織的曲面本體清單是開始時的快照。只用腳本驗證（`tests/e2e/phase4b-surface-edit-ui.js`）。
    - **4b-5 已做（ADR 0072，零件 Schema 31）**：`thicken`（結果取代曲面本體、成為實體；面保留名、新面 `<特徵>:thicken:…`）與 `cutWithSurface`（曲面沿平面法向掃成刀具除料，曲面不變，新面 `<特徵>:cut:…`）的特徵、指令、重算、介面；核心的 `thicken` 回傳面的來源、新增 `surfaceTool`。**決定了三件事**：STEP 輸出把偏移曲面型別轉成 B 樣條（`portableShape`；轉換器中止時照原樣輸出並警告，worker 的輸出改回傳 `{ text, warnings }`）；衍生本體是曲面時仍是曲面（修了漏帶標記）；組合件裡的曲面本體和參考本體一樣畫出來、不算零件。縫織用的清單改成所有本體的快照（`bodyPool`）。只用腳本驗證（`tests/e2e/phase4b-thicken-cut-ui.js`，兩段各載入一次頁面再跑）。
    - **4b-6 已做（ADR 0073）**：驗收 A 段：金樣工件（放樣自由曲面、含圓角的方塊，輸出成 STEP 再讀進來）→ 分割線 → 偏移 3 → 厚面 → 型面塊；**間隙偏差 5e-5 mm（容許 0.05）**、厚面體積對辛普森積分（把區域偏移 3、7、11 量面積）差 1.2e-5、圓角件的塊 31631.86 mm³（手算）；接進 4a 的夾具（衍生零件、組合件）無干涉、塊到工件 3.000 mm；塊的剖面積 790.8 mm²（手算，剖面弧是折線差 0.24）；工件改了塊跟著更新、名稱不變。`tests/support/sectionArea.ts` 是 5 與 4b 共用的剖面積讀法。**B 段（真實的沖壓件或塑膠件 STEP）待使用者（§8）。**
- **Phase 6 塑膠件開發完成（2026-10-04，ADR 0074–0082），閘門是有條件通過**：[phase6-plan](docs/phase6-plan.md)。6-0 計畫與技術驗證、6-1 拔模分析、6-2 底切分析、6-3 厚度分析、6-4 不等殼厚（零件 Schema 32）、6-5 唇與溝槽（33）、6-6 螺柱（34）、6-7 卡榫與窗與排氣口（35）、6-8 驗收 A 段（金樣外殼，每個數字手算）。B 段（真實塑膠件與 SW 的分析對照、真人走一遍）待使用者（§8）。
- **Phase 7 鈑金開發完成（2026-10-04，ADR 0083–0091），閘門是有條件通過**：[phase7-plan](docs/phase7-plan.md)。「特徵原生」做法：建立時記錄折彎資料，平板型式由它算出（不展開實體）。7-1 基材凸緣（Schema 36）、7-2 邊線凸緣（37）、7-3 摺邊（38）、7-4 縮短與離隙（39）、7-5 平板型式、7-6 平板型式 DXF、7-7 量規表（40）與可製造性檢查、7-8 驗收 A 段。沒做：凸折、斷開角落、長圓與撕裂離隙、折過的基材上的凸緣的平板型式、平板型式進工程圖。B 段（真實支架與 SW 的平板型式對照、真的 CAD 開 DXF）待使用者（§8）。
- **鞏固 H-1 到 H-11（2026-10-04，使用者採納「先鞏固再加功能」）**：[hardening-plan](docs/hardening-plan.md)。H-1 併面時舊面保留原名（ADR 0092）、H-2 畫面小修、H-3 效能、H-4 螺柱孔拔模（Schema 41）與摺邊不算最小半徑（ADR 0093）、H-5 到 H-10 種子固定的隨機測試（ADR 0094：零件、鈑金、STEP 來回、疊層拉伸與掃出與旋轉、組合件的結合與干涉、工程圖的視圖與剖面與輸出，共找到並修了 2 個真問題）、H-6 封閉角落（Schema 42，ADR 0095）、H-11 全面盤點清理（移除沒用到的 import 與沒人用的匯出與只寫不讀的欄位、文件對齊、資安與隱私盤點）與跨電腦開發（使用者要求專案能在不同電腦開發：`npm run doctor` 診斷這台電腦、`.gitattributes` 的 `* text=auto eol=lf`；套件解析不靠符號連結的做法評估後決定不做，見 ADR 0096）；桌面版安裝檔 2026-10-04 用 Phase 4a–7 的程式重建（11,673,078 位元組，SHA-256 開頭 `08c70f0e`，探測腳本確認視窗載入且有「鈑金」分頁；沒有在乾淨帳號安裝過）；註解與 handoff 裡被反斜線吃掉的字還原。逐項的實機驗證清單（84 項）：[docs/manual-verification.html](docs/manual-verification.html)。
- **檢查**：**1996 項測試通過、21 項略過**（`npm run check`：型別、分層、i18n、測試；2026-10-05 STEP 名稱與剖面版面修正之後）；每個里程碑的數字見對應的 ADR 與 `git log`。`tests/phase3/rebuild-speed.test.ts` 與草圖效能預算測試在機器同時有別的負載時可能超過時間預算，單獨跑會過（§6「效能測試」）。`F:` 磁碟（USB，不支援符號連結）上的做法見 §6「工作區連結」。

## 4. 如何執行

```bash
npm install          # 第一次
npm run dev          # 自動開啟 http://127.0.0.1:5391
npm run check        # 型別檢查 + 分層檢查 + 全部測試
npm run build        # 正式版建置
npm run build -w @3db/desktop   # 桌面版安裝檔（要 Rust 與 MSVC，見 apps/desktop/README.md）
```

- 內建瀏覽器的預覽伺服器設定在 `.claude/launch.json`，名稱是 `web`。
- `spikes/occt-gaps/` 是 ADR 0003 的證據腳本，不屬於產品程式碼。

## 5. 架構速覽

資料流：

1. UI 送出 `Command`。
2. `DocHistory`（Immer patches）更新文件，並處理復原/重做。
3. Worker 重新計算：草圖求解 → 輪廓 → OCCT 特徵 → 持久命名。
4. Worker 回傳網格、名稱、指紋、物質特性。
5. `Viewer` 顯示結果。

必須維持的不變式：

1. 文件只存設計意圖。B-Rep、網格、名稱、DOF 等衍生資料一律不寫回文件。
2. 參考 = 持久名稱 + 幾何指紋，不存拓撲索引。命名文法見 ADR 0002。
3. UI 只能送 `Command`。一次編輯會話 = 一次交易，✔ 提交、✖ 還原。
4. 分層由 `scripts/check-deps.mjs` 強制。主執行緒不得在執行期匯入 kernel、regen、sketch、io；例外只有 `@3db/regen/dag`、`@3db/io`、`@3db/sketch/interact`（純 TS）。
5. 拾取到的索引（頂點、邊線、面），一律對照「畫面上正在顯示的那份結果」解析（`Viewport` 的 `displayed`）。
6. 草圖點座標是「擺放意圖」，只在畫圖與拖曳時寫入；求解結果不寫回（ADR 0004）。
7. 新物件的 ID 由 UI 用 `IdAllocator` 發放並放進指令；ID 永不重用。
8. 布林結果的名稱，依「目標在前、工具在後」的來源繼承；合併共面時，保留較早特徵的名稱（ADR 0005）。
9. 輸入的資料（STEP）以 SHA-256 識別，隨 `.3dbx` 存放；Worker 在執行使用它的指令之前就要拿到資料（ADR 0009）。
10. 零件名稱只有一個來源：存檔或開檔後就是檔名（`partName`）。「新零件」不把名稱寫進文件（ADR 0010）。
11. 角度尺寸記錄放置的扇形（`flip`）；沒有 `flip` 的舊尺寸意義不變（ADR 0010）。
12. 組合件以「相對於組合件檔所在資料夾」的路徑引用零件檔，每個檔案只存一筆；不存零件的雜湊值。組合件存到別的資料夾時，路徑與復原記錄一起改寫（`History.rebase`，ADR 0011）。
13. 一次開一份文件。組合件的狀態在 `AssemblyStore`（每開一份就建一個）；`AppStore` 依目前文件轉送檔案、復原/重做、重新計算（ADR 0011）。
14. 結合只存設計意圖。零組件的位置、狀態、自由度都是求解出來的衍生資料；每次都從擺放位置解起，結合沒拘束的自由度保持擺放的樣子；衝突依設計樹順序判定（ADR 0012）。
15. 面的外法向由曲面本身的偏導數決定，不用 OCCT `Plane()` 等回報的座標系方向（ADR 0012）。
16. 結合草稿不寫進文件：它和文件一起求解做預覽，✓ 之後才成為指令（ADR 0013）。
17. 移動零組件（拖曳、數值）只在放開或「套用」時寫入文件：與它一起求解的零組件，位置改變的擺放位置一起改為目前位置，一個指令、一個復原步驟；拖曳中的位置是衍生資料（ADR 0014）。
18. 零件檔的路徑只在 `FileRef` 一處：重新指定、搬移都只改它；零組件以 ID 引用檔案，結合以持久名稱引用元素（ADR 0014）。
19. 工程圖文件只存意圖（圖頁、標題、視圖、尺寸、表格）；**線條、尺寸的數值、孔表的列、零件表的列都由模型重算**，不存（ADR 0060–0064）。視圖的來源是零件或組合件檔的相對路徑。
20. 尺寸指到零件的面、邊、頂點的持久名稱加指紋；元素不見時說「找不到」，不悄悄改接（ADR 0062）。
21. `buildScene` 的場景（圖紙座標 mm、y 向上的折線與文字）是 SVG、DXF、PDF 的唯一來源；`@3db/drawing` 只依賴 model 與 i18n，不用核心（ADR 0060、0065）。

## 6. 已知陷阱

**libcascade（詳見 ADR 0003）**

- 多載以參數個數分派。例如 `BRepPrimAPI_MakeRevol` 一律傳 4 個參數。
- 沒有綁定 UTF-16 字串。
- handle 需要手動 `delete()`，用 `Arena` 管理。
- 例外要用 `getExceptionMessage` 解碼。
- `BRepAlgoAPI_Fuse`/`Cut` 的建構子本身就會執行運算，不要再呼叫 `Build()`。
- `BRepPrimAPI_MakeHalfSpace` 只以傳入的面為界。要以整個曲面為界，先用 `BRep_Tool.Surface` 加上 `MakeFace(surface, tol)` 做出無界的面。
- `BRepPrimAPI_MakeRevol` 旋轉整圈時，`Generated(edge)` 對與軸垂直的輪廓線回傳空集合，但它們掃出的平面確實在結果中。要同時查 `mk.Revol().Shape(edge)`，否則這些面會失去名稱（1G 發現）。
- `Regenerator.rebuild()` 會釋放上一次結果的形狀。測試必須先量完這次的結果，才能再做下一次 rebuild。
- 旋轉特徵掃出的平面，`BRepAdaptor_Surface.Plane()` 的法向不一定與曲面參數化一致；只看它與面的 Orientation 會把部分平面算成朝內（2B 發現）。外法向要用 `EvalD1` 的 ∂u × ∂v。圓柱等的 `Direct()` 同理不可靠。

**libcascade（3a-2 發現，細節見 ADR 0021）**

- `BRep_Tool.CurveOnSurface(edge, face, …)` 的綁定壞了（丟 `Cannot read properties of undefined (reading 'name')`）。要在鄰面上找邊線對應的曲面點，用 `GeomLib_Tool.Parameters(曲面, 點, 容差)` 取 (u, v)，再 `BRepAdaptor_Surface.EvalD1`。
- `BRepClass_FaceClassifier(face, gp_Pnt, 容差, true, 0.1).State()` 可以判斷點在不在面內（`TopAbs_IN`）。
- `ShapeUpgrade_UnifySameDomain` 預設會把**整個本體**的共面合起來；在 2004 個面的輸入件上只動一個小面，就會合掉 48 個不相干的面、改掉別人在用的名稱。用 `KeepShape(邊)` 保護不該合的邊（`kernel.moveFace`）。
- `BRepAlgoAPI_Defeaturing` 不能中斷，對某些面（產品件的 `import1:f254`）永遠不回來。核心沒有綁定可中斷的進度指示器，所以由 `store.ts` 的重算時間上限保護。
- STEP 讀入器自己會修好小缺陷（移動過的頂點、沒共用邊的面再組成實體），所以做不出「讀進來就無效」的檔案；`Kernel.repairImport(shape)` 是公開的，測試在記憶體裡做缺陷再交給它。
- 對曲面（沒有實體）的 STEP 用 `BRepBuilderAPI_Sewing` + `ShapeFix_Solid.SolidFromShell`；縫合後的面序固定，所以 `imp:f<k>` 的名稱成立。
- 2000 面的本體，體積積分只準到約 1e-6 倍整體體積：比對體積變化時要以整體的比例為容差，不能以變化量的比例。

**屬性管理員與設計樹（3a-7a 發現）**

- 開著屬性管理員時，左邊的設計樹被它整個換掉（`App.tsx`），所以 ADR 0007 決定 8 說的「在設計樹點選基準面當參考」其實點不到；3a-7a 在屬性管理員裡加了基準按鈕（ADR 0034 決定 9）。瀏覽器腳本要在屬性管理員開著時選基準，用 `.property-manager .datum-picker button`，不要用 `H.treeClick`。
- 自動化瀏覽器（雲端工作階段）：預裝的 Chromium 在 `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`，Playwright 在 `/opt/node22/lib/node_modules/playwright`；用 `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` 才有 WebGL。載入腳本用 `import('/@fs/<檢出路徑>/tests/e2e/…js')`。唯一會出現的主控台錯誤是 favicon 的 404。

**3a-8 發現的陷阱**

- `useStore((s) => s.result?.bodies ?? [])` 每次都回傳新陣列，React 以為狀態一直在變而無限重繪（整個畫面當掉，只有瀏覽器才看得到）：選擇器要回傳穩定的值，預設值放在 `useStore(...)` 外面（`useStore((s) => s.result?.bodies) ?? []`）。
- OCCT 的 STEP 輸出設定（`write.step.schema`、`write.step.unit`）是全函式庫共用的，而且要等第一個 `STEPCAFControl_Writer` 做出來才存在；先做寫入器再設，輸出完設回預設（ADR 0039 決定 3）。
- 顏色以 `Quantity_TOC_sRGB` 建立，否則 STEP 裡的灰色會變亮（ADR 0038 決定 4）。
- 一個形狀會保留給過它的最細網格：測不同網格品質要各重算一個形狀。
- 零件的「輸出 STEP」現在會先開對話框；`tests/e2e/phase1-demo-parts.js` 的 `H.exportStep` 已改成按對話框的「輸出」。

**開發與測試環境**

- **i18n 的鍵不能跨區域重名**：各區域的目錄用 `...spread` 合併，後面的悄悄蓋掉前面的，不會有任何警告（3b-2 撞到零件排列的 `pattern.count`、`pattern.direction1`、`pattern.instanceName`，差點把零件排列的文字蓋掉）。新增鍵之前先 grep 一下，或用新的前綴（組合件的零組件排列用 `pattern.comp…`／`pattern.step…`）。
- **Node 25.8 的 `fs.cpSync` 在 Windows 上，目的地資料夾名稱含非 ASCII 字元時會讓整個程序崩潰**（vitest 顯示 `Worker exited unexpectedly with exit code 3221226505`，沒有任何測試輸出）。測試複製資料夾時目的地用 ASCII 名稱（`tests/phase3/subassembly-files.test.ts`）。
- **推送**：這台（`D:`）沒有 `gh`，直接 `git push` 即可（Git 的憑證管理員有登入）；上面 §7 的 `gh` 憑證指令是另一台電腦的。
- **PowerShell 工具的兩個陷阱**：雙引號字串會吃掉 `${…}`（改用單引號的 here-string 或 Edit 工具）；`Set-Content -Encoding utf8` 在 Windows PowerShell 5.1 會加 BOM。指令中同時有 `Remove-Item` 與某些字串（例如 `//`、`\n`）時，工具會當成「刪除系統路徑」而拒絕整個指令：刪檔單獨一個指令。
- **暫時用的樣本伺服器**：真實 STEP 不複製、不進版本庫；要在瀏覽器測就起一個只讀、只綁 127.0.0.1 的小型靜態伺服器，用完停掉（做法見下面「Vite 對別的磁碟的檔案」）。

- **工作區連結（`F:` 磁碟）**：專案在 `F:\Self-developed_Apps\G3\3D-Builder`（USB 磁碟，不支援符號連結），`node_modules/@3db` 是空的，所以 `npm run typecheck`、`npm test`、`npm run build`、`npm run dev` 都找不到 `@3db/*`。在支援符號連結的磁碟（例如 C:）上 `npm install` 就正常。在 `F:` 上驗證的做法（2E 用過）：在暫存區放三個設定檔，各自加上 `@3db/<套件>` → `packages/<套件>/src/index.ts` 的別名（另有 `@3db/regen/dag`、`@3db/sketch/interact`），專案內不留檔案：
  - tsc：`extends` 專案的 `tsconfig.json`，加 `paths`、`typeRoots`（`node_modules/@types` 與 `node_modules`）與絕對路徑的 `include`；`baseUrl` 已被移除，不能用；
  - vitest：`root` 指向專案，`resolve.alias` 用正規表示式（`/` 要跳脫），執行 `vitest run --config … --maxWorkers=4`。並行 worker 太多（預設約 26 個）會耗盡 WASM 記憶體而崩潰；
  - vite：設定檔用 `file:///…/node_modules/vite/dist/node/index.js` 匯入 `defineConfig` 與 react 外掛，`root` 設成 `apps/web`，`build.outDir` 指向暫存區。開發伺服器用背景程序啟動（`npx vite --config …`），再以 `preview_start` 的 `url` 開分頁；用完停掉。
- **e2e 腳本的路徑**：`tests/e2e/*.js` 的 `H.GOLDEN` 已改成由 `import.meta.url` 推出，不再寫死使用者路徑。載入腳本時用實際的檢出位置，例如 `await import('/@fs/F:/Self-developed_Apps/G3/3D-Builder/tests/e2e/phase2-assembly.js?' + Date.now())`。本文件其他處的 `C:/Users/3kids/Downloads/3D-Builder` 是舊機器上的路徑。Vite 會把 `new URL('字面值', import.meta.url)` 當成資源匯入而改寫，所以腳本裡用字串處理。
- **Vite 對別的磁碟的檔案**：開發伺服器在 `F:`，`/@fs/C:/…` 的請求會拿到首頁（HTML，內容 560 位元組），不是檔案，e2e 存進 OPFS 的就是那份 HTML，載入時會報「檔案不是有效的 JSON」。要在瀏覽器測放在別的磁碟的樣本，起一個只讀、只綁 127.0.0.1 的小型靜態伺服器（Node `http`，加 `Access-Control-Allow-Origin: *`，只提供該資料夾的 `.step`），`H.project` 用它的網址取檔；用完停掉。不要為了測試複製使用者的檔案。
- **頁面沒有繪製時的 e2e**：瀏覽器窗格隱藏、Claude 視窗被擋住時截圖逾時，依游標拾取的流程（`H.pickOn`，例如 `__asm.fixture()` 的結合）會失敗（「could not get the cursor onto face …」）。這種情況改用指令加入結合；`__asm.exportStep()` 就是這樣做的。
- **連接埠**：5173 是本機其他 Vite 專案在用的預設埠。本專案固定使用 `127.0.0.1:5391`，並開啟 strictPort；埠被占用時直接報錯，不會換埠。
- **預覽伺服器**：app 可能在回合之間停掉它。請使用者開網址前，先用 `preview_list` 和 curl 確認。Phase 0 驗收 ② 第一次失敗就是因為沒有確認。
- **別的工作階段的開發伺服器**：
  - 如果 5391 已被另一個工作階段的 Vite 佔用，用 `preview_start` 加 `url: http://127.0.0.1:5391` 開分頁，就能使用它。
  - 它的檔案監看可能漏掉修改，症狀是「does not provide an export named …」，或 curl 取回的模組是舊內容。這時對來源檔執行 `touch`，再重新載入頁面。
- **內建瀏覽器**：
  - 窗格隱藏時頁面是 0×0，視角與拾取都會算錯。測試前先 `resize_window` 1280×720，測完用 `desktop` 預設值還原。
  - Claude 視窗最小化時頁面不繪製，座標點擊與截圖都會失敗。改用 JS 觸發 DOM 的 `click()`，並對畫布送 `PointerEvent`。畫布座標用 `store.viewer.screenOf(frame, p)` 換算。
  - 在 console 裡動態 `import` store 會載入第二個實例。要用 `performance.getEntriesByType('resource')` 裡的確切網址。
- **PlaneGCS**：
  - 共用端點的相切必須用 `angle_via_point`，否則會被誤判為冗餘。
  - 它的法向慣例：直線為方向逆時針轉 90°，圓指向圓心。
- **系統檔案對話框**：`showOpenFilePicker`、`showSaveFilePicker`、`showDirectoryPicker` 必須由真人點擊觸發；腳本的 `click()` 不算，非同步流程中途也不能再開（所以專案資料夾用一個對話框承接點擊）。自動測試時以替身取代它們，真正的對話框請使用者確認。
- **組合件的瀏覽器測試**（`tests/e2e/phase2-assembly.js`）：
  - 專案資料夾用瀏覽器的私有檔案系統（OPFS，`navigator.storage.getDirectory()`）。它的控制代碼是真的，`resolve()`、讀寫都走瀏覽器本身的程式；對話框替身回傳其中的檔案。
  - 用法：在剛載入的頁面 `await import('/@fs/<檢出路徑>/tests/e2e/phase2-assembly.js?' + Date.now())`（路徑見上），再 `await __asm.all()`、`await __asm.extras()`；2C：`__asm.fixture()`、`__asm.mateExtras()`；STEP：`__asm.step()`；2D：`__asm.move()`、`__asm.files()`，重新載入後 `__asm.remembered()`；2E：`__asm.exportStep()`（自己組夾具，不必先跑 `fixture()`）；載入進度：`__asm.progress('http://127.0.0.1:5393/')`（要有提供 `CIV0000467治具_step.STEP` 的只讀伺服器，見上面「Vite 對別的磁碟的檔案」；約 15 秒，工具逾時 45 秒，要在背景跑並輪詢 `window.__result`）。
  - 專案資料夾會記在 IndexedDB（2D）。要測「第一次選資料夾」的流程（`__asm.openFresh()`），先 `await __asm.forget()` 再重新載入頁面。OPFS 的資料夾讀取權限永遠是「已允許」，所以記住的資料夾會直接使用；`__asm.remembered()` 以替身讓它回報「要再詢問」，測試對話框的「使用「X」」按鈕。
  - 每個流程開頭都會「新組合件」：上一個流程留下未存的組合件時會跳出「要儲存變更嗎？」而卡住，先重新載入頁面。流程超過 45 秒時，在背景執行並輪詢 `window.__result`。
  - 拖曳用 `H.drag(path, 'left' | 'right')`：合成的 PointerEvent 帶 `buttons`；`setPointerCapture` 對合成事件會拋錯（已忽略）。找零組件上的點用 `H.onComponent`（確認游標真的落在它上面）；等角視圖中被其他零件擋住時改用上視圖。
- **效能測試**：全部測試同時跑時（約 26 個 worker），加上開發伺服器與瀏覽器，牆上時間可能是實際工作的好幾倍。求解器的預算測試改量 CPU 時間（`process.cpuUsage`，Windows 以約 15.6 ms 為單位，所以每次量五次取平均，三批取最小；見 `packages/assembly/test/solver.test.ts`）。
- **瀏覽器腳本的指標座標要取整數**：`MouseEvent` 的 `clientX/Y` 是整數，`PointerEvent` 可以有小數；懸停用小數、點擊被取整，兩者就可能落在不同元素上（2C 遇到：懸停在面上，點擊卻選到 10 px 內的頂點）。真實滑鼠沒有這個問題。
- **在組合件中點選元素**：`tests/e2e/phase2-assembly.js` 的 `H.pickOn` 把游標移到元素上的點，確認圖面認得是那個元素才按下；看不到時轉視角、放大。被別的零件蓋住的面（例如坐在板上的底面）點不到，改選看得到的邊線，同 SW 的做法。
- **看不到畫面時檢查繪圖**：視窗隱藏時截圖會逾時，WebGL 畫布的 `toDataURL`、`drawImage` 也只得到背景。在同一段 JS 裡先呼叫 `store.viewer.render()`，再用 `gl.readPixels` 讀回像素，就能確認畫了什麼。
- **UI 驗收腳本**（`tests/e2e/phase1-demo-parts.js`）：
  - 用法：在頁面中 `await import('/@fs/C:/Users/3kids/Downloads/3D-Builder/tests/e2e/phase1-demo-parts.js?' + Date.now())`，再 `await __demo.plate()`（或 `vblock()`、`pin()`）。
  - 規則：點擊一律落在畫布可見範圍內；先用滾輪縮放、Ctrl+中鍵平移到合適比例（空草圖按「全部顯示」會放大到約 700 px/mm）。
  - 被擋住的邊線點不到，要先轉動視角或換標準視角。
  - 短線要點中段，因為 7 px 內有點時會選到點。
  - 瀏覽器窗格隱藏時重新載入的頁面不會繪製，畫布的 ResizeObserver 不觸發，畫布停在 300×150。腳本在每個零件開始時呼叫 `store.viewer.resize()`（`H.ready()`）。
- **舊版樣本檔**：`tests/fixtures/old-versions/` 由舊版程式寫出，不可修改（產生方式見該目錄的 README）。
- **STEP 金樣**：`tests/fixtures/step/` 的檔案固定輸入面的順序；升級幾何核心後若這個測試失敗，代表輸入面的名稱會變，要先處理遷移。
- **ShapeFix**：對乾淨的檔案也會回報「已修改」，所以只在有效性檢查失敗時才修復（ADR 0009）。
- **網路工具**：WebSearch/WebFetch 在此環境會失敗，改用內建瀏覽器查資料。SW 2010 的線上說明可以讀：`https://help.solidworks.com/2010/english/SolidWorks/help_list.htm?id=18.5.13`（伸長）這類頁面，網址從左側目錄的連結取得；第一次會有 cookie 橫幅，選「只用必要的 cookies」。
- **開發伺服器的快取**：新增工作區套件（要先 `npm install`）、搬動或刪除原始檔（例如 `expr.ts` 變成 `expr/`）之後，Vite 會記著舊的解析結果而回 500／404；重啟開發伺服器（`preview_stop` 再 `preview_start`）。
- **Windows**：
  - Git 的 LF→CRLF 警告無害。
  - 沒有 pnpm，使用 npm workspaces。
  - Node 26。
- **這一輪（3b-5、3b-6）踩到的坑**（2026-10-03）：
  - **PowerShell 5.1 與中文**：`.ps1` 檔沒有 BOM 時會以 ANSI 讀，裡面的中文會變亂碼而解析失敗。要改含中文的檔案：把中文放進 UTF-8 的 JSON 或文字檔，腳本只有 ASCII，用 `[IO.File]::ReadAllText(路徑, (New-Object Text.UTF8Encoding($false)))` 讀；直接寫在命令列裡的中文沒問題。多行修改用 Edit 工具，不要在 PowerShell 字串裡用反引號、`${`、`\n`。`handoff.md` 是 CRLF、**沒有 BOM**，不要用 `Get-Content | Set-Content`。
  - **Claude 桌面版把 `%LOCALAPPDATA%` 重新導向到它的套件資料夾**（`C:\WpSystem\…\Claude_*\LocalCache\Local`）：Rust 的 `fs::rename` 在那裡會失敗（「系統無法將檔案移到不同的磁碟機」）。Tauri 的 NSIS 工具因此要設 `bundle.useLocalToolsDir`（已設）；環境變數 `TAURI_BUNDLER_TOOLS_PATH`、改 `LOCALAPPDATA` 都沒用。別的 Rust 工具若遇到同樣的錯，也是這個原因。Claude 的「終端機」面板的 shell 整合在這台壞了（`claude-desktop.ps1` 找不到），`run_in_terminal` 打不出命令。
  - **計時型測試會隨負載波動**：`rebuild-speed`、`interference` 在整套平行跑時時間會變成三倍以上。`rebuild-speed` 量 CPU 時間（預算 5000 ms）；`interference` 以「比對的零件對數」把關（37 對，不是 190 對），時間只留寬鬆的上限；真正的時間要在安靜時單獨跑量（20 個零組件約 1.0 s 牆上時間）。
  - **預覽伺服器的埠 5391 是 `strictPort`**：`npm run dev -w @3db/desktop`（`tauri dev`）會自己開 vite，要先 `preview_stop` 內建瀏覽器的伺服器。
  - **內建瀏覽器**：視窗約 1024 × 768，截圖常逾時，改用 `read_page`、`javascript_tool` 驗證；`computer` 的座標是縮放後的截圖座標（800 × 600），不是頁面座標。要模擬畫布上的點擊，對 `canvas` 派發 `click` 事件（`MouseEvent`，帶 `clientX`、`clientY`；先 `mousemove`），Viewer 聽的是 `click`。舊的 `tests/e2e/phase2-assembly.js`（`__asm.all`）假設 1280 × 720，在這個視窗和桌面視窗都失敗，不要拿它當證據。
  - **干涉與測量的資料**：夾具裡削邊銷的 r = 5 本體站在板的 r = 4 孔裡（每支約 405 mm³），是夾具本身的幾何；次組合件內部不比對，所以頂層檢查看不到。
- **Docker**：canary 映像已刪，但 `docker_data.vhdx` 仍佔 25 GB（非稀疏檔）。要把空間還給 C 槽，需要壓縮這個檔案：要系統管理員權限，並會暫停 Docker/WSL。

## 7. 與使用者的工作約定

- **語言**：
  - 回覆與文件用繁體中文，術語採 SW 2010 繁中版。
  - 程式碼識別名稱用英文。
- **全域規則**（`~/.claude/CLAUDE.md`）：
  - 第一性原理，不迎合。
  - 需求模糊先問，做了假設要明說。
  - 使用者提出方案或決策時，用五位顧問組成的智囊團審查，再由主席結論。結論要包含：
    - 值得做 / 需要改 / 應該放棄；
    - 最大風險；
    - 最缺的證據；
    - 今天最小的一步；
    - 可信度。
- **Git**：
  - 使用者要求時才提交。
  - 提交訊息結尾加 `Co-Authored-By: <當次工作階段的模型名稱> <noreply@anthropic.com>`（3a-6b 之後是 Claude Sonnet 5.5）。
  - 3a-5、3a-6 的每個子里程碑都是做完就提交推送（使用者在驗收標準第 7 項確認）；推送用 gh 的憑證：`GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git -c credential.helper= -c "credential.helper=!gh auth git-credential" push`。
- **說明（單一來源，2026-10-06）**：UI 的使用說明只存在 i18n 目錄的 `help.<主題>.*`（主題 id = `ACTIONS` 的 id、草圖工具 `tool-<tool>` 或 `concept.*`）。**新增指令或草圖工具必須同時寫 `help.<id>.summary`**（`tests/phase8/help.test.ts` 會擋）；驗證手冊的項目標為「有問題」並修好後，依 [docs/help-links.json](docs/help-links.json) 同步改它對應主題的文字；說明裡的數字取自驗證過的預期值。
- **需要先徵求同意的動作**：下載、刪除/覆寫、對外動作。
- **階段閘門**：每個階段由使用者在 SW 對照驗收，通過後才進下一階段。

## 8. 使用者的待辦

**逐項的實機驗證清單（87 項，含步驟、預期結果、回報格式）：[docs/manual-verification.html](docs/manual-verification.html)**，用瀏覽器開，狀態與備註存在瀏覽器裡，做完按「複製結果」貼回來。以下是各階段的原始待辦。

**Phase 7 鈑金的待辦（2026-10-04；ADR 0091 的最後一節有完整版）**

- A. **一個真實的鈑金支架**：用同一個板厚、半徑、K 因子在 SW 看平板型式的外包尺寸與折彎線位置，與這裡的「平板型式」視窗對（差距多半來自定義：凸緣長度量到外側／內側虛擬交點、K 因子）；把輸出的 DXF 用你的 CAD 或雷射切割軟體開，看輪廓、`BEND` 層與註記。
- B. 真人走一遍：「鈑金」頁的基材凸緣（平板、折過的板）、邊線凸緣、摺邊、縮短與離隙、平板型式、量規表、檢查，回報不順的地方。
- C. **你要決定**：沒做的——凸折（板中間，需要切開並移動一半實體的新核心操作）、（封閉角落已在 H-6 做完，ADR 0095）、斷開角落、長圓與撕裂離隙、折過的基材上的凸緣的平板型式、3D 視圖的展開／摺疊切換、除料特徵進平板型式（折彎之後才切的孔）、平板型式進工程圖；以及摺邊要不要有自己的最小半徑規則（金樣的摺邊內側半徑 0.5 在起始比例下不過）。
- D. 檢查的預設比例（半徑 1 倍板厚、平直段 4 倍、孔到折彎 2 倍）是我的起點，不是標準——請改成你工廠的規定；量規表沒有預設列。

**Phase 6 塑膠件的待辦（2026-10-04；ADR 0082 的最後一節有完整版）**

- A. **一個真實的塑膠件**（STEP 或你的零件檔）：各跑拔模、底切、厚度分析，與 SW 的同一種分析對顏色與數字（厚度的定義我不知道 SW 用哪個；真實件的曲面壁、肋、圓角的取樣行為沒試過）。
- B. 真人走一遍：開零件 → 工具頁的三種分析（方向、要求角度、厚度上下限）→ 特徵頁的唇與溝槽、螺柱、卡榫、卡榫的窗、排氣口、不等殼厚的薄殼，回報不順的地方。
- C. **你要決定**：（螺柱孔的拔模已在 H-4 做完，ADR 0093：選項 A，孔有自己的拔模角）；卡榫站在底上要開窗（做法在 ADR 0082），要不要把「鉤下面的窗」做成卡榫的選項。
- D. 瀏覽器裡殘留的「找到沒有儲存的零件」是舊的測試副本，按「捨棄」；之後的 e2e 腳本會自己收尾（`H.tidy()`）。

**Phase 4b 檢具的待辦（2026-10-03；ADR 0073 的最後一節有完整版）**

- A. **一個真實的沖壓件或塑膠件 STEP**：放進主模型（輸入修復會先處理），畫草圖投影到要做型面的面，偏移 3 mm（看 PropertyManager 說的間隙），厚面，回報哪裡失敗（曲面是修剪過的 B 樣條、面多又小時，偏移、縫織、分割線的穩定度只有真實檔案知道）。
- B. 真人走一遍：開零件 → 分割線 → 偏移曲面 → 延伸／修剪／縫織 → 厚面或以曲面除料，回報不順的地方；畫布上真的點選與曲面的顯示（雙面）我沒有人眼確認。
- C. 輸出的 STEP（型面塊）用別的 CAD 開：偏移曲面已轉成 B 樣條（ADR 0072），讀不讀得進沒有試過；轉換器中止時輸出會警告。
- D. 還沒做：曲面之間的「相互」修剪、厚面「兩側」與保留曲面、除料用任意向量當方向。

**Phase 5 工程圖的待辦（2026-10-03；ADR 0065 的最後一節有完整版）**

- A. **用真實的程式開輸出**：用 Chrome 開一張夾具圖的 PDF、用你的 CAD（AutoCAD、DraftSight…）開同一張的 DXF：看線寬、虛線、箭頭、中文、尺寸文字的位置。PDF 要中文請先在工程圖面板的「PDF 字型…」選一個字型檔（例如 `C:\Windows\Fonts\msjh.ttc`）。這是 Phase 5 驗收②的 B 段。
- B. 真人走一遍：開零件或組合件 →「新工程圖」→ 自動尺寸、孔表、剖面、零件表與號球 → 輸出，回報不順的地方（尺寸堆疊太擠、號球位置、孔表欄寬）。
- C. 對照你的標準：公差表（ISO 286，`packages/model/src/tolerance.ts`，表值是手打的）、孔標註的用語（貫穿、深、沉頭）、標題圖塊的欄位與位置。
- D. 還沒做：螺紋與錐形沉孔的孔標註、角度尺寸、號球與表格的拖曳、DXF 的 DIMENSION 圖元（尺寸現在是線與文字）。

**Phase 4a 的待辦（2026-10-03，使用者決定先走完開發、對接時再修正；ADR 0059 的最後一節有完整版）**

- A. **一個真實的夾具案例**：工件 STEP（含曲面更好）、你在 SW 做的夾具截圖、你常用的廠商定位銷與螺絲的 STEP。第一步：把真實工件放進主模型（輸入本體、標為參考本體），走 `tests/phase4/acceptance-4a.test.ts` 同一條流程，看輸入修復、衍生零件、結合、干涉與餘隙的實況。
- B. 用 eDrawings（或 SW）開輸出的組合件 STEP，目測階層、位置與顏色。
- C. 真人走一遍：新零件做主模型 →「從本體產生組合件」→ 插入零組件的「標準件圖庫」→ 結合（含進階結合）→ 干涉／餘隙 → 改主模型，回報不順的地方。
- D. 對照你的標準：圖庫的尺寸表（ISO 4762／8734／7089）、定位銷孔的公差表（ISO 286-1），都在 `packages/library`、`packages/model/src/dowel.ts`，表值是手打的。
- 還有：Phase 3 的補驗收（下面的 0–6 項）仍然順延。



0. **桌面版的人工驗收（3b-6 第 3、7 項，2026-10-03）**：在沒裝過開發工具的 Windows 帳號（或另一台電腦）安裝 `3D-Builder_0.1.0_x64-setup.exe`，斷網啟動，用**原生對話框**存、開 `.3dbx` 與 `.3dba`，開一個真的專案資料夾，最後解除安裝；步驟在 [ADR 0052](docs/adr/0052-desktop-shell.md)「要使用者做的」。安裝檔不在版本庫，在這台 `npm run build -w @3db/desktop` 重做就有。
1. **Phase 2 驗收樣本（已結案，範圍降低）**：藍圖要的是使用者的一個 SW 組合件（10–20 個零組件）。
   - **使用者沒有 SW，只有 eDrawings（2026-09-30）**：所以藍圖驗收 ③「在 SW 開啟」與「用 SW 樣本重組」都無法照原文做。改為把金樣夾具（15 個零組件）輸出成 `C:\Users\ws61\Downloads\金樣夾具-15零組件.step`（`STEP_OUT_DIR=<資料夾>` 跑 `tests/phase2/golden-assembly.test.ts` 產生），用 eDrawings 開啟目測。**使用者已開啟，看到的與下述一致**（eDrawings 不是 OCCT，是獨立於我們的讀取器），並**明確接受這個較低的範圍作為 Phase 2 閘門（2026-09-30）**。該檔案有：3 塊定位板並排（x = 0、120、240）、每塊 2 支削邊銷插在孔中（x ± 40）、2 個疊起來的 V 型塊在板的正中央（底面在 y = 15 與 55）。
   - **之後若有人有 SW**：可補做原本的驗收，需要一個保留結構的組合件 STEP（下面的說明）。不阻擋 Phase 3。
   - **目前狀態（2026-09-30）**：`C:\Users\ws61\Downloads\SW樣本` 有 `CIV0000467治具_step.STEP`、`3D_MT17203_CIV0000467_Porduct.STEP` 與 `T1405001.SLDASM`，**都不能用來驗收**：兩個 STEP 各只有 1 個 `PRODUCT`、1 個實體、0 個 `NEXT_ASSEMBLY_USAGE_OCCURRENCE`（AP203，組合件被併成單一實體；治具 2004 個面、130×100×10 mm，產品件 340 個面）；`.SLDASM` 是 SW 的專有壓縮格式，讀不出零件參照，我們沒有讀取器，它的零件檔（`.SLDPRT`）也沒給。需要重新輸出：每個不同的零件各一個 STEP，外加一個保留組合件結構的組合件 STEP（檢查：搜尋 `NEXT_ASSEMBLY_USAGE_OCCURRENCE`，應有 10 次以上）。
   - （2026-10-01）樣本資料夾多了 `組合件1.step`（16 MB）：檔頭是 Open CASCADE 8.0、2 個實體、2 個 `NEXT_ASSEMBLY_USAGE_OCCURRENCE`，是本工具自己輸出的（治具加產品件），不是 SW 的輸出，不能當 3b 的樣本。
   - 每個不同的零件各自輸出 STEP；重複使用的零件只要一份。這些檔案輸入後當零件用。
   - 整個組合件的 STEP，或各零組件位置的截圖，用來比對位置。組合件 STEP 輸入是 Phase 3b，所以只拿來對照。
   - 最晚在 2F 前提供；越早越好，2E 的 STEP 組合件輸出也能拿它對照。
2. **2A–2E 實機確認（已完成，2026-09-30）**：使用者用自己的瀏覽器走完下面五組（建立與存檔、結合、移動與參考檔、輸出 STEP、載入進度），系統的資料夾與存檔對話框都確認過。過程中發現右鍵旋轉沒有任何提示，已補上圖面提示（`f14d266`）。測試用的專案資料夾是 `C:\Users\ws61\Downloads\3DB實機確認`（金樣零件的複本）。伺服器是用背景程序加暫存設定啟動的（`F:` 磁碟不能 `npm run dev`，見 §6「工作區連結」）。以下是當時的步驟，留作日後再測的清單：
   - 先建立一個專案資料夾（例如「文件\CIV0000467」），把 STEP 檔（或 .3dbx）放進去；不建議直接選「下載」。
   - 「檔案」→「新組合件」：直接進入「開始組合件」，先選這個專案資料夾（Windows 的選資料夾視窗只顯示資料夾，看不到檔案是正常的；瀏覽器會詢問是否允許讀取）；清單會列出資料夾裡的 .3dbx 與 STEP 檔；
   - 在清單點一個零件、按 ✓ 放在原點（固定）；再用「組合件」→「插入零組件」插入零件，其中一個插入兩次，在圖面點一下放置；
   - 「儲存檔案」存進這個資料夾（或它的子資料夾）→「新零件」→「開啟舊檔」開回組合件，位置應該不變。
   - （2C）「組合件」→「結合」：點孔的內壁與銷的柄（小孔要先用滾輪放大），PropertyManager 會建議「同軸心」，按 ✓；再點板面與凸緣的底邊 → 「重合」→ ✓。設計樹的結合資料夾會列出它們，零組件前的 (-) 表示還能動。
   - （2D）用左鍵拖曳還能動的零組件：沒有結合的會跟著游標平移；插在孔裡的銷只會繞孔轉。右鍵拖曳是旋轉。固定或完全定義的零組件拖不動，狀態列會說明。「組合件」→「移動零組件」可以輸入 Delta XYZ、至 XYZ 位置，「旋轉零組件」輸入角度。
   - （2D）設計樹在零組件上按右鍵 →「開啟零件」：改一個尺寸、存檔，再按零件設計樹上方的「返回組合件」，組合件會顯示改過的零件，結合仍成立。
   - （2D）在檔案總管把一個零件檔改名，再開啟組合件：會出現「找不到參考的檔案」，按「瀏覽…」選改名後的檔案。
   - （2D）重新整理頁面後開啟組合件：資料夾對話框會有「使用「資料夾名稱」」，瀏覽器會再問一次是否允許讀取（可以選「每次造訪都允許」，之後就不再問）。
   - （2E）在有零組件的組合件按「檔案」→「輸出 STEP」，會下載 `<組合件名>.step`。用 SW 開啟：應該是一個組合件，零件名稱是檔名，零組件名稱如「削邊銷<2>」，位置與畫面一致（結合移動過的零件是移動後的位置）。若零件檔遺失，會顯示檔名並中止，不產生檔案。
3. **Phase 3 驗收樣本**：3 個真實零件的 SW 輸出 STEP、特徵清單、關鍵尺寸；沒有 SW 的替代驗收**使用者已接受（2026-09-30）**；還缺哪 3 個零件。給同事的說明已寫在 `docs/sw-export-request.md`（未追蹤，使用者決定先擱置）。細節見 [docs/phase3-plan.md](docs/phase3-plan.md) §5、§6。
4. Phase 4 樣本：1–2 個夾治具案例、常用廠商標準件的 STEP。
5. （可選）壓縮 Docker 虛擬磁碟；刪除 `spike/occt-gaps` 分支。
6. **3a-1 到 3a-6 的實機確認（使用者 2026-10-01 決定先保留）**：各項要驗收的步驟寫在 §10 對應的段落（運算式、輸入修復與直接編輯、多本體、草圖工具、特徵 I、異型孔、掃出——尤其「直線加圓弧」的路徑、疊層拉伸、肋材）。自動化測試與瀏覽器腳本都已通過，但還沒有人用滑鼠走過一遍；3a-10 驗收前要補。

## 9. Phase 1 零件 MVP（完成，閘門通過）

**範圍**：藍圖 §3 的 Phase 1，加上附錄 C 中、非 Phase 2 的 P0 項。Phase 0 已全部驗收，閘門已開。

| 里程碑 | 內容（目錄 ID） | 完成條件 | 狀態 |
|---|---|---|---|
| 1A 草圖編輯器 | C1.1–C1.7、C1.14、C1.25–C1.28 的 P0 部分、C1.31、A2.6、D5.3、D6.1–D6.2 | 只用 UI 畫出並完全定義一個含圓弧與圓孔的輪廓；可拖曳求解；逐圖元以定義狀態著色 | **完成**（瀏覽器實測通過） |
| 1B 特徵與布林 | C4.1–C4.3 的 P0 部分（終止型態、除料、旋轉）、C5.3 導角、A1.5 布林、在模型平面上繪製草圖 | 布林後的持久命名回歸測試全綠 | **完成**（`tests/phase1/tnp.test.ts` 全綠、瀏覽器實測通過） |
| 1C 基準面 | C3.2 的 P0 部分（偏移、角度、三點） | 基準面上的草圖與特徵正確重建 | **完成**（`tests/phase1/planes.test.ts` 全綠、瀏覽器實測通過） |
| 1D 樹狀結構操作 | B2.6 抑制連帶子特徵、B2.8 刪除時處理相依、D1.6/D7.1 錯誤提示、在回溯位置插入特徵；另含 D1.2 雙向選取同步 | 對應行為測試通過 | **完成**（`tests/phase1/tree.test.ts` 全綠、瀏覽器實測通過） |
| 1E 檔案 | `.3dbx`（ZIP：`document.json` + `blobs/`）、F7.1 本機檔案、B9.2 版本遷移 | 舊版檔案可開啟；存檔/開檔往返一致 | **完成**（`tests/phase1/files.test.ts` 全綠、瀏覽器實測通過；系統對話框已由使用者確認） |
| 1F STEP 輸入 | F2.1 輸入本體特徵；命名 = blob 雜湊 + 拓撲索引 + 指紋 | 使用者的 SW 零件 STEP：輸入 → 加特徵 → 輸出 → 在 SW 開啟正確 | **完成**（`tests/phase1/import.test.ts` 全綠、瀏覽器實測通過；使用者以 SW 樣本驗收通過） |
| 1G 驗收 | 金樣與 TNP 回歸套件；只用 UI 完成 3 個示範零件 | 藍圖 §3 Phase 1 驗收 ①②③ | **完成**（`tests/golden/` 全綠；三個零件只用 UI 建模；③ 使用者確認）；**閘門通過** |

**1A 完成的內容**（設計決策見 ADR 0004）：

- **操作流程**：
  1. 在設計樹選基準面，按「草圖」分頁的「草圖」，視角會正視於該基準面。
  2. 畫圖、加入限制條件、標尺寸。
  3. 按確認角落的 ✔ 離開草圖。
  4. 選取草圖，按「特徵」分頁的「伸長填料/基材」。
- **工具**：直線、中心線、邊角/中心矩形、圓、周邊圓、中心點圓弧、切線弧、三點定弧、點、智慧型尺寸、幾何建構線。
- **草圖內操作**：
  - 推斷與吸附：重合、中點、在圖元上、水平/垂直、從圓弧端點的相切。
  - 修改方塊：按兩下尺寸。
  - 選取：點選、Ctrl 多選、方塊選取。
  - 拖曳求解；Delete 刪除；Esc 結束工具。
  - 草圖內可以復原/重做。
- **PropertyManager**：草圖狀態與 DOF、現有限制條件（可刪除）、可加入的限制條件、幾何建構線。
- **新特徵的工作階段**：伸長、圓角都在工作階段中建立，✖ 會移除。檔案分頁新增「新零件」。
- **已知限制**：尺寸位置是自動配置。

**1B 完成的內容**（設計決策見 ADR 0005）：

- **「特徵」分頁**：伸長填料/基材、旋轉填料/基材、伸長除料、旋轉除料、圓角、導角。
  - 伸長與旋轉作用在設計樹中選取的草圖。
  - 除料在設計樹顯示為「除料-伸長 n」「除料-旋轉 n」。
- **伸長**：
  - 終止型態：給定深度、兩側對稱、完全貫穿、成形至某一面。「成形至某一面」選了之後，在圖面點選終止面。
  - 反轉方向；除料預設往材料內部。
  - 會併入或除去既有本體。
- **旋轉**：
  - 旋轉軸是草圖中的直線，預設取中心線。
  - 旋轉類型：給定深度或兩側對稱，加上角度。
- **導角**：角度-距離或距離-距離、反轉方向，點選邊線（與圓角共用邊線清單）。
- **在模型平面上繪製草圖**：
  1. 閒置時在圖面點選面（滑過會高亮，下方提示持久名稱）。
  2. 選到平面後，按「草圖」分頁的「草圖」。
  3. 面移動時（例如上游尺寸改變），草圖會跟著移動。
- **已知限制**：見 ADR 0005。
  - 被分割的邊只會解析到最接近的一段。
  - 方向 2、拔模、薄件屬於 P1。
  - 在基準面草圖上做除料，可能要手動反轉方向。

**1D 完成的內容**（設計決策見 ADR 0006）：

- **右鍵選單**：
  - 編輯特徵/草圖；
  - 抑制、恢復抑制、恢復抑制（含相依特徵）；
  - 刪除…；
  - 回溯（到此特徵之前）、推進至最後；
  - 父子關係…；
  - 錯誤為何？（只出現在有錯誤或警告的特徵上）。
- **刪除**：
  - 在設計樹選取特徵後按 Delete，或從右鍵選單進入。
  - 「確認刪除」對話框可選擇同時刪除子特徵、被吸收的草圖，兩項預設都不勾。
- **錯誤與警告**：
  - 參考靠幾何指紋找回時，特徵旁顯示黃色三角形。
  - 狀態列的「錯誤為何？（n）」可列出全部錯誤與警告，點一列就選取該特徵。
- **雙向選取同步**：在設計樹選取特徵，圖面高亮它的面；在圖面點選面，設計樹標出建立它的特徵。

**1C 完成的內容**（設計決策見 ADR 0007）：

- **建立**：「特徵」分頁的「基準面」。預設從選取的基準面或模型平面偏移 10 mm；沒有選取時用前基準面。
- **PropertyManager**：
  - 基準面類型：偏移距離、角度、三點；
  - 參考方塊：參考面、旋轉軸、點 1–3，遺失的參考會標出；
  - 偏移距離或角度；反轉方向。
- **點選參考**：
  - 參考面：點選模型平面，或在設計樹點選基準面；
  - 旋轉軸：點選模型的直線邊線；
  - 三點：點選頂點，再點一次移除。
  - 拾取優先順序：頂點 > 邊線 > 面。
- **使用**：在設計樹選取基準面，按「草圖」即可在上面繪製。上游尺寸改變時，基準面與它上面的草圖、特徵一起移動。
- **顯示**：基準面以半透明方框顯示，大小隨模型；選取中的會高亮；預設基準面只在選取時顯示。
- **PropertyManager 頂端**：所有特徵都會顯示目前的錯誤訊息，例如「請選擇旋轉軸」。
- **已知限制**（見 ADR 0007）：
  - 旋轉軸只能是模型邊線（還沒有基準軸）；
  - 不能在圖面中直接點選基準面；
  - 沒有顯示/隱藏切換；
  - 三點基準面的法向依點選順序決定，需要時勾「反轉方向」。

**1E 完成的內容**（設計決策見 ADR 0008）：

- **「檔案」分頁**：新零件、新示範件、開啟舊檔（Ctrl+O）、儲存檔案（Ctrl+S）、另存新檔、輸出 STEP。
- **`.3dbx` 零件檔**：ZIP，內含 `document.json` 與 `blobs/`。可以用任何解壓工具打開來看。
- **Chrome/Edge**：開檔、存檔都直接在原檔上進行；其他瀏覽器改為下載。
- **舊版 `.3db.json`**：照樣開啟，第一次儲存時另存為 `.3dbx`。
- **已修改標記**：標題與 CommandManager 右側顯示檔名，已修改時加「*」。
- **防止遺失**：要開其他檔或建新零件時，先問「要儲存變更嗎？」；關閉分頁前也會詢問。

**1F 完成的內容**（設計決策見 ADR 0009）：

- **「特徵」分頁的「輸入 STEP」**：把 STEP 檔的實體插在回溯控制棒的位置，設計樹顯示「輸入1」。
- **「開啟舊檔」也能選 STEP**：建立以檔名命名、尚未儲存的新零件，同 SW。
- **輸入的本體可以繼續加特徵**：在它的平面上畫草圖、在它的邊線上做圓角或導角、伸長到它的面。
- **資料隨 `.3dbx` 存放**：之後開檔不需要原始 STEP 檔。
- **診斷**：有缺陷的幾何會自動修復並顯示黃色警告；沒有實體或不是 STEP 時顯示錯誤原因。
- **已知限制**（見 ADR 0009）：
  - 只收實體，多個實體會成為一個本體；
  - 不讀顏色與名稱；
  - 沒有修復選項。

**1G 完成的內容**（細節見 [phase1-verification.md](docs/phase1-verification.md)）：

- **三個夾治具示範零件**：定位板、V 型塊、削邊銷，只用 UI 建模（`tests/e2e/phase1-demo-parts.js`），存成 `tests/golden/*.3dbx`。
- **金樣測試**（`tests/golden/golden.test.ts`）：
  - 體積與手算值相同；
  - 完全定義、無警告、模型有效；
  - STEP 往返；
  - 改變關鍵尺寸後，特徵仍留在原本的元素上。
- **修正**（ADR 0010）：
  - 整圈旋轉產生的平面以輪廓線命名，原本依位置編號。修正前存檔、且參考了這類平面的零件，會顯示遺失參考，需要重新選擇；
  - 角度尺寸量放置的那一側，同 SW（Schema v6）；
  - 零件名稱就是檔名，用在設計樹、標題與 STEP 輸出；
  - 補上 v4、v5 的舊版樣本。

## 10. Phase 2 組合件 MVP（完成，閘門通過）

**範圍**：藍圖 §3，2026-09-28 與使用者確認。

- **目錄項目**：C15.1–15.3、C15.8、C15.12、A3.1、A3.2、A3.4、A3.5、F1.2、B9.4。
- **隱含的 P0**：組合件文件型別（B1.1、B1.2）、設計樹的結合資料夾（D1.1）、零組件上的拾取與幾何查詢（A5.1、A5.2）。
- **使用者的決定**：
  - 次組合件在 Phase 3b，隨 C15.4 剛性次組合件一起做；Phase 2 只做一層，零組件都是零件。
  - 一次開一份文件：從組合件「開啟零件」切換過去（先詢問是否儲存），零件存檔後回到組合件時自動更新。
  - 驗收用你的 SW 組合件，準備方式見 §8。
  - 「移動零組件」拖曳時沿剩餘自由度移動（A3.5，原為 P1）提前到 Phase 2，因為 SW 的基本移動本來就遵守結合。
- **不含**：
  - A3.3 耦合（P2）；進階與機械結合（Ph4a、P2）；
  - 零組件複製排列、爆炸視圖、零件表、干涉檢查、STEP 組合件輸入（都在 Phase 3b）。

**驗收**（藍圖 §3）：

1. 10–20 個零組件的組合件可完成結合；
2. DOF 顯示正確；
3. STEP 組合件在 SW 開啟時，結構與位置正確。

**已查證的技術前提**：

- libcascade 有 XCAF 組合件 API：`NewShape`、`AddComponent`（帶位置）、`GetComponents`、`GetLocation`、`GetReferredShape`。組合件 STEP 輸出可行，也能讀回做往返測試。
- 位姿可用 `gp_Trsf.SetTransformation(四元數, 平移)` 轉成 `TopLoc_Location`。
- 曲面與曲線的幾何都查得到：`Plane`、`Cylinder`、`Cone`、`Sphere`、`Torus`、`Line`、`Circle`（含軸、圓心、半徑）。結合需要的幾何可以從零件取出。

| 里程碑 | 內容（目錄 ID） | 完成條件 | 狀態 |
|---|---|---|---|
| 2A 組合件骨架 | B1.1/B1.2 組合件文件 `.3dba`；C15.1 插入零組件（多實例）；C15.2 第一個零組件固定、其餘浮動；A3.1 位姿；B9.4 以相對路徑引用專案資料夾中的零件檔（瀏覽器授權一次資料夾）；Worker 依內容快取重建零件並以位姿顯示；存檔/開檔；設計樹列出零組件 | 只用 UI：新組合件 → 插入兩個零件（其中一個插入兩次）→ 存檔 → 重開後位置不變；零件檔改過後重開，組合件跟著更新 | **完成**（瀏覽器腳本 `__asm.all()` 全部通過；見 ADR 0011）；系統對話框已由使用者實機確認（2026-09-30）；已提交 `7906934` |
| 2B 結合求解器 | `@3db/assembly`（純 TS）：位姿參數化；A5.2 從零件 B-Rep 取出結合幾何（平面、軸、點、圓柱、圓錐、球）；A3.2 C15.8 全部標準結合（重合/共線/共點、平行、垂直、相切、同軸心、鎖住、距離、角度，含對齊方向）；LM 求解、依連通分量分解；A3.4 以 SVD 的秩求剩餘 DOF、過多定義與衝突診斷 | 每種結合都有解析解測試；典型組態的 DOF 正確（例：銷入孔 = 1 個旋轉自由度，方塊貼三面 = 0）；衝突的結合被指名；20 個零組件求解在 50 ms 內 | **完成**（見 ADR 0012；最壞情況一組 19 個約 12–18 ms）；已提交 `d10c2ad` |
| 2C 結合 UI 與管理 | C15.8 結合 PropertyManager（選兩個元素 → 建議結合類型、對齊反轉、距離/角度）；零組件上的面、邊、頂點與基準面拾取；C15.12 結合資料夾、編輯/抑制/刪除、結合錯誤與「錯誤為何？」、選取結合時標示它的兩個元素；A3.4 零組件狀態 (f)/(-)/(+) | 只用 UI 把 Phase 1 的三個金樣零件組成小夾具並完全定義；故意加入衝突結合時，正確指出是哪幾個 | **完成**（`__asm.fixture()`、`__asm.mateExtras()` 全部通過；見 ADR 0013）；已提交 `c3f3860` |
| 2D 移動零組件與參考檔 | C15.3 移動/旋轉：拖曳沿剩餘自由度移動（A3.5）、數值移動；B9.4 零件檔遺失或改名時重新指定、零件改過後自動更新、資料夾授權跨工作階段保存；從組合件「開啟零件」切換文件 | 零件檔改名後開啟組合件 → 提示並重新指定；改零件尺寸後結合仍成立；部分定義的零組件拖曳時只沿剩餘自由度移動 | **完成**（`__asm.move()`、`__asm.files()`、`__asm.remembered()` 全部通過；見 ADR 0014）；已提交 |
| 2E STEP 組合件輸出 | F1.2：XCAF，每個零件一個原型、每個實例一個帶位姿的零組件，名稱取自檔名；單層結構 | 輸出再讀回：結構、名稱、位置一致；使用者在 SW 開啟正確 | **完成**（讀回測試與 `__asm.exportStep()` 通過；見 ADR 0015）；已提交 `49e93c7`；使用者在 eDrawings 開啟輸出檔確認一致（沒有 SW，見 §8 第 1 項） |
| 2F 驗收 | 用 UI 重組你的 SW 組合件（10–20 個零組件）；金樣組合件測試 | 藍圖 §3 Phase 2 驗收 ①②③ | **完成，閘門通過（範圍降低）**：金樣組合件測試（`tests/phase2/golden-assembly.test.ts`，8 項全過）；金樣夾具 STEP 在 eDrawings 目測一致；部分驗收（兩個真實 STEP 當零組件）；用 SW 樣本的驗收 ①②③ 無法進行（使用者沒有 SW），使用者已明確接受降低的範圍（§8 第 1 項） |

**順序的理由**：

- **2A 先做**：組合件是第一個跨多個檔案的文件，整合風險最高，先打通骨架。
- **2B 技術風險最高**：它是純 TS，可以脫離 UI、用測試完全釘住。
- **2E 放在後面**：需要的 XCAF API 已查證存在，風險低。

**2A 的結果**（ADR 0011）：

- 「檔案」分頁多了「新組合件」；組合件開啟時，指令分頁換成「組合件／檔案／檢視」。
- 「插入零組件」列出專案資料夾內的零件檔（也可以「瀏覽」）；零件的半透明預覽跟著游標，點一下放置，✓ 放在原點。第一個零組件固定。
- 設計樹：基準面、原點、「(f) 定位板<1>」「(-) 削邊銷<2>」…、結合資料夾（2C 使用）。右鍵可固定/浮動、刪除；Delete 鍵刪除選取的零組件。
- 零件檔遺失時，該零組件在設計樹顯示錯誤、其餘照常顯示，狀態列說明幾個檔案無法載入；補回檔案後按「重新計算」即可。
- 驗收腳本的一次執行：兩個削邊銷點選放在 (22.823, 25.423, −48.246) 與 (−51.65, 32.23, 19.419)；存到「組合件/夾具.3dba」後路徑改為 `../定位板.3dbx`、`../零件/削邊銷.3dbx`；重開後位置完全相同；定位板伸長 15 → 20 後重開，定位板的厚度變成 20，只有它重新建構。

**2A 刻意留到後面的**：

- 專案資料夾的授權跨工作階段保存、遺失檔案重新指定、從組合件「開啟零件」：2D（已完成，ADR 0014）。
- 移動/旋轉已放置的零組件：2D（已完成，ADR 0014）。
- 組合件的 STEP 輸出：2E（已完成，ADR 0015；2A 時「輸出 STEP」在組合件中停用）。

**2B 的結果**（ADR 0012）：

- 求解器 `@3db/assembly`：8 種標準結合、7 種元素（平面、直線、點、圓、圓柱、圓錐、球）；從擺放位置解起，沒拘束的自由度保持原樣；依設計樹順序指出衝突；每個零組件的自由度與 (f)/(-)/(+) 狀態。
- 組合件 Schema 2：結合資料夾與指令（新增、修改、抑制、刪除；刪除零組件時一併刪除它的結合）。v1 樣本 `tests/fixtures/old-versions/v1-assembly.3dba` 由 2A 的程式寫出。
- 零件幾何（A5.2）：拓撲的面與邊附上解析幾何；`@3db/regen` 的 `solveAssembly` 以持久名稱找到元素並求解。
- 真實零件驗證：削邊銷插入定位板的孔、凸緣貼面 → 剩 1 個自由度；削平面對齊板側面 → 完全定義；矛盾的距離被指名；零件改尺寸後結合照樣成立。
- 發現並修正 Phase 1 的問題：旋轉件平面的法向（在這類面上畫的草圖原本朝內）。

**2C 的結果**（ADR 0013）：

- 「組合件」分頁的「結合」：PropertyManager 選兩個元素，自動建議類型、對齊與目前的距離/角度，預覽會不會矛盾，✓ 加入後接著做下一個。
- 零組件上的面、邊、頂點直接在圖面點選；基準面與原點在圖面左上的浮出樹中選。
- 設計樹：零組件的 (f)/(-)/(+)、結合資料夾（編輯、抑制、刪除、錯誤為何）；選取結合時標示它的兩個元素。狀態列顯示「完全定義 / 定義不足 / 過多定義」。
- 驗收：三個金樣零件組成小夾具（兩支削邊銷、一個 V 型塊在定位板上），9 個結合全部只用 UI 完成、完全定義；矛盾的距離結合被指名。
- 使用者回報找不到「組合件」分頁：原因是開發伺服器在我的回合結束時被 App 關掉，頁面不是 2A 的程式。另外「新組合件」現在直接進入「開始組合件」，也直接切到「組合件」分頁（同 SW）。
- 使用者回報資料夾裡的 STEP 檔沒有出現：STEP 檔現在可以直接當零組件插入（清單標示 STEP，Worker 把它當成只有「輸入1」的零件）；找零件時略過 `node_modules` 與隱藏資料夾，最多看 20000 個項目；選資料夾的對話框說明系統視窗只顯示資料夾。

**2D 的結果**（ADR 0014）：

- 求解器多了「移動目標」：拖曳或數值移動一個零組件時，只在結合允許的方向上走，第一項要求（例如抓住的點跟著游標）優先，其次保持方向；走完再解一次結合，所以繞孔轉動也跟得上。
- 圖面：左鍵拖曳移動、右鍵拖曳旋轉；固定或完全定義的零組件不能拖；Esc 取消；放開時才寫入（同一組零組件的擺放位置，一個復原步驟）。游標移到零組件上時，圖面下方的提示會說：「左鍵拖曳移動，右鍵拖曳旋轉」（開著「旋轉零組件」時左鍵也是旋轉）、「已固定，不能拖曳」或「已被結合完全定義，不能拖曳」（`state/movability.ts`；使用者實機測試時發現右鍵旋轉沒有任何提示，2026-09-30 補上）。
- 「移動零組件」「旋轉零組件」PropertyManager：自由拖曳、依據 Delta XYZ、至 XYZ 位置；旋轉依據 Delta XYZ（依序繞 X、Y、Z，轉軸過零件中心）。
- 參考檔：開啟時找不到的零件檔會列出，可選同名的檔案（被搬到別的資料夾）或「瀏覽…」；設計樹右鍵「重新指定零件檔…」也能把 STEP 零組件改指向它存成的 .3dbx。
- 「開啟零件」切到零件（一次開一份文件）；「返回組合件」重新開啟組合件，改過的零件因此更新。視窗重新取得焦點時，也會重讀在別處存過的零件檔。
- 專案資料夾記在瀏覽器的 IndexedDB：下次開啟時資料夾對話框提供「使用「X」」。
- 未做（留待之後）：沿著組合件 XYZ、沿著圖元、對於圖元、拖曳時碰撞偵測（Phase 4a）。右鍵旋轉是軌跡球，無法繞視線方向轉；要從上方轉一支直立的銷，用左鍵繞著它拖。

**2E 的結果**（ADR 0015）：

- `Kernel.exportAssemblyStep`：一個根組合件、每個零件檔一個原型（名稱 = 檔名）、每個零組件一個實例（名稱 = 設計樹名稱）；位姿以 `SetRotation` + `SetTranslationPart` 組成。非單位四元數會被拒絕（OCCT 會靜默走樣）。
- 輸出的是圖面上的位姿（`poseOf`），不是存下來的擺放位置。零件檔讀不到、沒有本體、結合正在求解都會中止並說明，不會輸出缺零件的組合件。
- 驗證：kernel 讀回 6 項；金樣夾具（板、V 型塊、兩支銷）位姿 1e-6、體積 1e-9、結合移動過的銷寫的是求解位置；瀏覽器 `__asm.exportStep()`。測試的讀回輔助在 `tests/support/readAssemblyStep.ts`。
- 未做：顏色（F1.3）、次組合件、組合件 STEP 輸入（Phase 3b）。

**2F 的金樣組合件測試**（`tests/phase2/golden-assembly.test.ts`）：

- 夾具：三塊定位板排成一列（側面、後面、頂面共面），每塊有兩支削邊銷（A 在左孔，同軸心 + 凸緣貼頂面 + 削邊平行於側面；B 在右孔，只有前兩個結合）與兩個疊起來的 V 型塊。共 15 個零組件、39 個結合，全部用持久名稱；板的側面與 V 型塊的頂面、底面由幾何找出，並檢查是真正的持久名稱。零組件的擺放位置是「使用者隨手放在附近」：偏移幾 mm、稍微傾斜。
- 驗證：
  - 39 個結合全部成立；
  - 自由度與手算一致：1 個固定、11 個完全定義、3 支銷 B 各剩 1 個旋轉；
  - 每個零組件的位置是結合決定的位置（板間距 120、銷在孔中、V 型塊疊在板上）；
  - 求解約 3 ms（CPU 時間，預算 50 ms）；
  - 存檔重開後位姿完全相同；
  - 板厚 15 → 20 後結合全部成立、銷與 V 型塊跟著升高；
  - 輸出 STEP 讀回：3 個原型、15 個實例、名稱等於設計樹、位姿 1e-6。
- 測試位置：全部測試共 297 項通過。

**2F 的部分驗收：兩個真實 STEP 當零組件**（2026-09-30；`tests/phase2/real-sample.test.ts`，設 `SW_SAMPLE_DIR` 才會跑，否則略過；樣本不進版本庫）。這不是藍圖 §3 的驗收 ①②③，只說明真實大檔的表現：

- 讀入與重建：治具（7.3 MB、2004 個面）約 3.2 s，網格 1.0 s、7.4 萬個三角形；產品件（2 MB、340 個面）0.9 s，網格 0.4 s，**4.4 萬個三角形**（一個 21 mm 的小件，自由曲面的網格偏密，之後若圖面吃力可調網格容差）。兩個都是有效實體、無警告。
- 結合在匯入面上（`import1:f<n>` 的持久名稱）：治具頂面 ↔ 產品件底面（重合，反向）＋治具孔 ↔ 產品件圓柱（同軸心）。兩個結合成立；治具固定，產品件剩 1 個旋轉自由度；產品件底面落在治具頂面（z = 10）。圓柱的軸向是 +z 與 −z，所以同軸心要選「反向對齊」；選同向會與重合矛盾而被判為衝突（是預期的行為，不是求解器問題）。
- 求解：Worker 內 0.5 ms、往返 2–7 ms。
- STEP 輸出：2 個原型、2 個實例、位姿 1e-6、共 16 MB、0.8 s（node）／2.0 s（瀏覽器）。
- 存檔重開：位姿相同。
- 瀏覽器（真實 UI 插入兩個 STEP，結合以指令加入）：插入治具 10.5 s、產品件 3.9 s（含讀檔、建構、網格、傳回主執行緒），0 Console 錯誤。第一個 STEP 插入要 10 秒，使用者會感覺到，之後可考慮進度提示。
- **觀察（非 2E 造成）**：產品件的體積在「零件層級」STEP 輸出再輸入後差 3.5e-6（989.8939 → 989.8974 mm³），組合件輸出與零件輸出完全一致，治具的差是 −1.4e-14。**已查明（2026-09-30，`tests/phase2/step-roundtrip.test.ts`，設 `SW_SAMPLE_DIR` 才跑）：形狀沒有變，不需修改。** 邊長 ≤ 1e-9、頂點 ≤ 1e-10 mm、面數與曲面種類完全一致，細網格體積只差 2e-7；只有 38 個被計算出的曲線修剪的面（24 個錐面、14 個 B 樣條面）面積不同。不是積分器的問題（自適應積分收斂後給出同樣的 3.49e-6）。約一半來自寫出檔宣告的精度：原檔 1e-5，OCCT 寫出的是形狀自己的公差 1e-4；以 1e-5 讀入或寫出則剩 1.5e-6。是一次性的：第二次往返完全相同（7.7e-15）。解析形狀（治具）是 1e-14。3.5 ppm 低於檔案本身的公差。

**Phase 1 遺留的 P0（D4.6、B4.3）已補完（ADR 0018）。要驗收的：**設計樹每一列右邊的眼睛（原點、三個預設基準面、草圖、基準面），預設值符合 SW（用過的草圖隱藏、預設基準面隱藏），存檔重開後保持；把圓角的邊弄壞，「錯誤為何？」與屬性管理員都有「改用最接近的」。使用者尚未實機確認。

**Phase 3a-0 技術驗證已做完（2026-09-30，ADR 0017，已提交推送）**：四個進階特徵的歷史夠命名；C10.1 只做平面，用延伸板，不必重建 libcascade；52 個簡單特徵重算約 0.39 s；D4.6 顯示/隱藏未做、B4.3 只做一半。腳本在 `spikes/occt-gaps/phase3-*`。**未驗證**：曲面輪廓的掃出、3 個以上截面的疊層拉伸、含圓角與薄殼的 50 特徵零件的重算時間（詳見 ADR 0017 §1、§3）。

**3a-1 運算式、全域變數與屬性已完成（2026-09-30，ADR 0020）。要驗收的（使用者尚未實機確認）：**「工具」分頁的「方程式」：新增變數 `w = 30`，把尺寸改成 `w*2`，模型跟著變；壞運算式被擋下並顯示原因；循環引用被擋下並顯示路徑；改變數名稱、草圖名稱、尺寸名稱後，用到它的運算式一起更新；屬性管理員的數值框輸入 `h/2` 會在旁邊顯示「= 7.5 mm」；「檔案屬性」加一個「板厚 = 4mm」，用 `property('板厚')` 驅動深度；草圖裡由運算式驅動的尺寸顯示 `Σ60`。

**3a-2 輸入修復與直接編輯已實作（2026-10-01，ADR 0021，`78e0cad`）。要驗收的（使用者尚未實機確認）：**
- 「特徵」分頁的「刪除面」：開著示範件，點圓角的面再按 ✔，圓角消失（體積回到 1000 mm³、6 個面）；對有孔的零件，點孔壁、勾「刪除鑽孔」，孔（含盲孔的孔底、孔口的倒角）消失；不能刪的面，特徵旁出現錯誤，「錯誤為何？」說明原因。
- 「移動面」：點一個平面，輸入距離（正值往外、負值往材料內）；斜壁維持斜度。點與圓角相切的面會被拒絕，訊息說明「請先移動連同的圓角，或先刪除圓角」。
- 輸入本體（例如把只有曲面的 STEP 開起來）：屬性管理員有「診斷報告」與「縫合容差」；縫隙太寬時特徵顯示錯誤「仍有 n 條邊沒有接上」，把縫合容差加大就會接上。
- 重算超過 60 秒（OCCT 卡住）會換掉 Worker 並說明；開發時可用 `store.rebuildLimitMs = 8000` 縮短，用產品件的 `import1:f254` 重現（見 ADR 0021 §9）。
- 瀏覽器腳本：`await import('/@fs/<檢出路徑>/tests/e2e/phase3-direct-edit.js?' + Date.now())`，再 `await __d3.deleteFillet()`、`moveFace()`、`refuseNextToFillet()`；`importRepair()` 需要在 127.0.0.1:5393 提供 `faces-only.step` 與 `gapped.step` 的只讀靜態伺服器（由 `tests/support/stepSamples.ts` 製造）。真實 STEP：`$env:SW_SAMPLE_DIR='C:\Users\ws61\Downloads\SW樣本'; npx vitest run tests/phase3/real-sample-edit.test.ts`（約 10 分鐘，每次重算 3–6 秒）。

**3a-3 多本體已實作（2026-10-01，ADR 0022，已提交推送）。要驗收的（使用者尚未實機確認）：** 畫兩個分開的塊 → 設計樹出現「實體(2)」；第三個塊與第一個重疊，在伸長的屬性管理員取消「合併結果」→ 第三個本體；「特徵」分頁的「組合」選類型、主要本體與要組合的本體（也可以在圖面點選面）；本體列的眼睛隱藏後圖面看不到也點不到；雙擊本體列重新命名；右鍵「設為參考本體」後質量扣掉它；除料把一個本體切成兩塊會變成兩個本體（最大的保留原 id，另一個叫 `<除料>#2`）；存檔重開仍在。瀏覽器腳本：`await import('/@fs/<檢出路徑>/tests/e2e/phase3-bodies.js?' + Date.now())`，再 `await __b.all()`。

**3a-9b 設計樹與範本與快速鍵（2026-10-01，ADR 0041，Schema 25）：** 設計樹：拖曳特徵的列調整順序（放在別的列上半＝之前、下半＝之後；放到會跑到它依賴的特徵之前的位置會被擋下並說明）；右鍵特徵：重新命名…、註解與標籤…、放進新資料夾／移出資料夾；資料夾列可收合、雙按改名、右鍵解散；樹上方的欄位過濾（名稱、類型、標籤、註解）。「檔案」→「新零件（範本）…」選空白／碳鋼／鋁件／塑膠件／CNS 製圖。「工具」→「快速鍵…」點欄位按組合鍵。**沒做：** 多選拖放、資料夾收合狀態記憶、自訂範本、英制單位、組合件設計樹的這些功能。**要驗收的（使用者尚未實機確認）：** 真的用滑鼠拖一個特徵到別處、把兩個特徵放進同一個資料夾、改一個快速鍵後用它。

**3a-9a 自動存檔與文字化格式（2026-10-01，ADR 0040）：** 編輯零件後 5 秒瀏覽器自動留一份；強制關閉分頁再開，會出現「找到沒有儲存的零件」，按「復原」得到一份尚未儲存的零件（要另存新檔），按「捨棄」丟掉。命令列：`node scripts/3dbx.mjs cat 檔.3dbx`（印出 document.json）、`unpack 檔.3dbx [資料夾]`、`pack 資料夾 檔.3dbx`；`npm run setup:git` 之後 `git diff` 看得到 `.3dbx` 的文字差異。瀏覽器腳本 `tests/e2e/phase3-recovery.js`（兩段：編輯、重新載入後復原）。**沒做：** 組合件的自動存檔、匯入結果快取、自動存檔間隔的設定。**要驗收的（使用者尚未實機確認）：** 編輯後直接關閉瀏覽器視窗再開，看復原視窗；用 `git diff` 看一個金樣檔的變更。

**3a-8 材質、屬性與輸出（2026-10-01，ADR 0037–0039，Schema 24）：** 「工具」→「檔案屬性」：最上面選材質（內建 14 種或自訂名稱與密度），狀態列出現「質量」；下面是文件設定（製圖標準、尺寸小數位數、顯示與輸出品質：粗／一般／細）。「工具」→「外觀」：對象是零件、選取的本體（設計樹的實體列）、選取的特徵或點選的面，挑顏色按「套用」，優先序面＞特徵＞本體＞零件，畫面上用頂點色畫，STEP 帶面色。「檔案」→「輸出 STEP」會先開對話框（AP214／AP242、帶顏色、座標系統）；「輸出 STL」「輸出影像」直接下載。瀏覽器腳本：`tests/e2e/phase3-output.js`（`__o.run()`）。**沒做：** 影像解析度與透明背景、STL ASCII、STL 的座標系統介面、外觀的面參考遺失修復。**要驗收的（使用者尚未實機確認）：** 選碳鋼看質量、改細／粗看畫面網格、上色與輸出 STEP 用 eDrawings 看顏色、選座標系統輸出後在別的軟體看原點與軸向。

**3a-7c 鏡射（2026-10-01，ADR 0036，Schema 23）：** 選一個填料、除料、孔、圓角或導角（或不選），「特徵」分頁的「鏡射」；屬性管理員的「鏡射什麼」可選「特徵」（勾選清單，同排列）或「本體」（勾選清單加「合併結果」），鏡射面預設是右基準面，在圖面點平面或按基準按鈕換。特徵鏡射的面叫 `<鏡射>:mirror:<原名>`；本體鏡射合併時與碰到的本體（包括原來的）連成一塊，不合併則是另一個本體（`<鏡射>#1`）。瀏覽器腳本：`await import('/@fs/<檢出路徑>/tests/e2e/phase3-mirror.js?' + Date.now())`，等幾秒再 `await __m.run()`（約 30 秒）；測試 716 項通過、20 項略過（`tests/phase3/mirror.test.ts` 15 項、v22 樣本 1 項）。**要驗收的（使用者尚未實機確認）：** 板上一根柱鏡射過板的中間；孔鏡射；鏡射面改位置時鏡像跟著動；鏡射到板外時的訊息；本體鏡射成獨立本體與合併。**3a-7 逐項驗收見 ADR 0036 末段。**

**3a-7b 線性與環狀複製排列（2026-10-01，ADR 0035，Schema 22）：** 選一個填料、除料、孔、圓角或導角（或不選，用最近一個），「特徵」分頁的「線性複製排列」或「環狀複製排列」；屬性管理員有「要排列的特徵」（勾選清單，可以勾一串連續的特徵，例如凸台加圓角）、方向（直線邊線、基準軸、平面法向）或旋轉軸（邊線、基準軸、圓柱面）的選取方塊與基準按鈕、間距、實例數（含原始特徵，可寫運算式）、反轉；線性可以「加入方向 2」排成格子；環狀有角度與「等間距」；最下面是「要跳過的實例」按鈕列。實例的面叫 `<排列>:inst<編號>:<原名>`（格子是 `inst2x1`）。做法是幾何圖樣：每個實例是種子加上與移除的材料的一份移動過的複製，所以實例的終止型態不會隨位置改變（成形至下一面不會停在別處）。錯誤：實例沒有碰到本體、成了分開的一塊、互相重疊（會說第幾個）、實例數不是 2 到 200 的整數。瀏覽器腳本：`await import('/@fs/<檢出路徑>/tests/e2e/phase3-pattern.js?' + Date.now())`，等幾秒再 `await __p.run()`（約 40 秒，在背景跑並輪詢）；測試 700 項通過、20 項略過（`tests/phase3/pattern.test.ts` 24 項、`packages/kernel/test/transform.test.ts` 4 項、v21 樣本 1 項）。**要驗收的（使用者尚未實機確認）：** 板上一根柱排成一列、改實例數與間距、跳過一個、間距太小的重疊訊息；異型孔排成一列；格子（方向 2）；繞基準軸環狀排列，等間距與否；種子改尺寸所有實例跟著改；排列之後的圓角倒實例的邊。

**3a-7a 參考幾何（2026-10-01，ADR 0034，Schema 21）：** 「特徵」分頁多了「基準軸」「參考點」「座標系統」三個按鈕，「基準面」的屬性管理員多了平行（通過點）、垂直（通過點）、中間面、相切（圓柱）四種類型。每個屬性管理員上方是類型，下面是「參考」選取方塊（每格有 × 可清空）與一排**基準按鈕**（預設基準面、這個特徵之前的基準面／軸／點；開著屬性管理員時設計樹被蓋住，所以選基準軸與參考點要按這些按鈕）；邊線、面、頂點在圖面上點，會放進第一個接受它而且還空著的格子（格子表在 `apps/web/src/state/datumSlots.ts`）。基準軸：直線邊線／兩點／圓柱或圓錐面的軸／兩平面交線；參考點：座標（運算式）／邊線或面的中心／軸與平面交點；座標系統：原點（不選＝零件原點）＋X、Y 方向（邊線、軸或平面法向）＋反轉 X、Y，永遠右手系。圖面上軸是紫色線、點是紫色圓點、座標系統是三支箭頭，點不到它們（用屬性管理員或設計樹選）。瀏覽器腳本：`await import('/@fs/<檢出路徑>/tests/e2e/phase3-datums.js?' + Date.now())`，等幾秒再 `await __g.run()`（約 25 秒；先切到等角視圖才點得到垂直邊線）；測試 671 項通過、20 項略過（`tests/phase3/datums.test.ts` 30 項、v20 樣本 1 項）。**沒做：** 座標系統當 STEP 輸出座標系與量測基準（C3.4 的用途，目前只能建立與顯示）、角平分面、過一點的相切面、在圖面上點基準軸／點。**要驗收的（使用者尚未實機確認）：** 沿垂直邊線做基準軸；參考點取面的中心；基準面「垂直」用軸與點；中間面用兩個平行面；相切面用圓柱（先伸長一個圓柱）；座標系統選點、軸、右基準面；改上游尺寸時這些跟著動；抑制基準軸連帶抑制用它的基準面。

**3a-6d 肋材（2026-10-01，ADR 0033，Schema 20）：** 在一張草圖裡畫**一條直線**（例如右基準面上板子上方的一條水平線），選取該草圖後「特徵」分頁的「肋材」；屬性管理員有肋材厚度、厚度的位置（兩側／草圖法向的一側／另一側）、反轉方向。牆從線在草圖面內垂直於線的方向長出去，碰到第一個本體的面為止，並與本體接合；預設往「草圖法向 × 線的畫法方向」長，長錯方向時訊息會說「勾選反轉方向」。做法是既有的「伸長至本體」加接合，沒有新的 OCCT 呼叫。折線與弧形的肋材、自動選方向沒做。瀏覽器腳本：`await import('/@fs/<檢出路徑>/tests/e2e/phase3-rib.js?' + Date.now())`，等幾秒再 `await __r.run()`（約 20 秒，在背景跑並輪詢 `window.__result`）；測試 640 項通過、20 項略過（`tests/phase3/rib.test.ts` 7 項）。**要驗收的（使用者尚未實機確認）：** 板子上方畫一條線做肋材，體積 = 厚度 × 線長 × 高；改厚度；反轉方向的訊息；有階梯的板（肋材停在第一個碰到的面）；肋材邊上做圓角。

**3a-6c 疊層拉伸（2026-10-01，ADR 0032，Schema 19）：** 先在平行（或任意）的平面上各畫一張草圖，每張一個封閉輪廓（沒有洞），選取其中一張後「特徵」分頁的「疊層拉伸填料/基材」或「疊層拉伸除料」；屬性管理員是有順序的截面清單（上移、下移、移除）與「加入截面…」；新建時的截面是選取的草圖加最近畫了圖元的另一張，順序要自己調。截面不必對齊起點與方向，邊數不同也可以（方形對圓形）。瀏覽器腳本：`await import('/@fs/<檢出路徑>/tests/e2e/phase3-loft.js?' + Date.now())`，等幾秒再 `await __l.run()`（約 25 秒，在背景跑並輪詢 `window.__result`）；測試 632 項通過、20 項略過（`tests/phase3/loft.test.ts` 11 項）。**要驗收的（使用者尚未實機確認）：** 偏移 10 的基準面上畫較小的矩形，兩個截面疊層拉伸，體積 = 角錐台公式；加第三個截面；方形對圓形；除料。

**3a-6b 掃出（2026-10-01，ADR 0031，Schema 18）：** 先畫路徑草圖（一條連在一起的線或圓弧，一端在輪廓的平面上）與輪廓草圖（封閉輪廓，可以有洞，例如管子），選取輪廓草圖後「特徵」分頁的「掃出填料/基材」或「掃出除料」；路徑預設是最近畫了線或圓弧的另一張草圖，屬性管理員的清單可以換。路徑沒有一端在輪廓的平面上、沿著輪廓的平面走、封閉、分成好幾條、輪廓掃進自己，都有說明的錯誤。**封閉的路徑還不支援**（OCCT 回報有效實體但體積為 0，`spikes/occt-gaps/phase3-sweep-closed.mjs`）。瀏覽器腳本：`await import('/@fs/<檢出路徑>/tests/e2e/phase3-sweep.js?' + Date.now())`，等幾秒再 `await __w.run()`（約 20 秒，在背景跑並輪詢 `window.__result`）；測試 620 項通過、20 項略過（`tests/phase3/sweep.test.ts` 13 項，手算與帕普斯體積、命名、錯誤、舊檔 v17）。**要驗收的（使用者尚未實機確認）：** 用 UI 畫一條直線路徑與一個矩形輪廓做掃出；用「切線弧」畫一條「直線＋圓弧」的路徑，體積 = 面積 × 路徑長（輪廓在路徑中央）；管子（兩個同心圓）；除料做一條溝。

**3a-6a 異型孔精靈（2026-10-01，ADR 0030，Schema 17，提交後推送）：** 先在面上畫一張草圖、放幾個單獨的點，選取該草圖後「特徵」分頁的「異型孔」：種類（直孔／柱孔／錐孔／螺紋孔底孔）、規格（M3–M20，填入孔徑；或自訂）、深度或完全貫穿、反轉。草圖放在板上時它的原點是板面的投影原點（不一定在面中心）。瀏覽器腳本：`await import('/@fs/<檢出路徑>/tests/e2e/phase3-hole.js?' + Date.now())`，等幾秒再 `await __h.run()`（整個腳本約 1 分鐘）；測試 605 項通過、20 項略過。

**3a-5c 拔模特徵（2026-10-01，ADR 0029，Schema 16，已提交推送 3ec02db）：** 「特徵」分頁的「拔模」：第一次點的面是中立面，之後點的面是要拔模的面；角度與「反轉」；編輯時顯示拔模之前的模型。瀏覽器腳本：`await import('/@fs/<檢出路徑>/tests/e2e/phase3-draft.js?' + Date.now())`，等幾秒再 `await __d.run()`（用 `store.execute` 把四個壁放進清單）；測試 597 項通過、20 項略過（`tests/phase2/golden-assembly.test.ts` 的 50 ms 測試在機器忙時會超過，單獨跑會過）。**3a-5 完成**，驗收標準七項都達成（見下一段的清單；樣本用 SW 的真實零件做的核對在 3a-10）。

**3a-5b 薄殼（2026-10-01，ADR 0028，Schema 15，已提交推送 bba1d3f）：** 「特徵」分頁的「薄殼」：先在圖面點要移除的面（或先選好再按），屬性管理員設壁厚與「向外加厚」；編輯時圖面顯示薄殼之前的模型，按「確定」後才看到結果（與圓角相同）。瀏覽器腳本：`await import('/@fs/<檢出路徑>/tests/e2e/phase3-shell.js?' + Date.now())`，再 `await __s.run()`（頁面剛載入要等一下再跑，否則 viewer 還沒好；用 `store.execute` 改成向外來看第二個體積）；測試 590 項通過、20 項略過。

**3a-5a 伸長／旋轉的 P1（2026-10-01，ADR 0027，Schema 14，已提交推送 92adb71）：** 伸長的屬性管理員分成「方向 1」「方向 2」「薄件」；終止型態多了成形到下一面、至頂點、至本體、從曲面偏移（要點選的在圖面上點：面、頂點、本體上的任一面）；每個方向可勾「拔模」（角度、往內）；旋轉也有「薄件」。瀏覽器腳本：`await import('/@fs/<檢出路徑>/tests/e2e/phase3-extrude-p1.js?' + Date.now())`，再 `await __x.run()`（一個屬性管理員 session 裡依序拔模、方向 2、薄件的三種，每一步的體積與手算比對）；測試 581 項通過、20 項略過。**3a-5 的驗收標準（使用者 2026-10-01 確認）：**（1）相容：舊測試不改仍過、舊檔都能開、每次升 Schema 補樣本；（2）每個新功能有手算或解析的體積測試；（3）持久命名：加進含圓角與孔的零件後之後的圓角／導角／草圖參考仍找得到、改尺寸重算 0 失敗、新特徵的面有穩定唯一名稱；（4）錯誤可讀（壁厚太大、找不到目標面、拔模面不可拔、開放輪廓沒開薄件等各有明確訊息的測試）；（5）結果有效（BRepCheck）、重算不明顯變慢；（6）介面與瀏覽器腳本實跑、0 Console 錯誤；（7）`npm run check` 全過、lint:i18n 基準不增加、每個子里程碑有 ADR（0027–0029）並提交推送。5b 薄殼、5c 拔模特徵也已做完（使用者選：薄殼＝多個移除面＋均勻壁厚＋向外／向內；拔模＝中立面（平面）＋要拔模的面＋角度＋反轉；對含圓角與孔的零件有命名回歸測試，非切線相連的面組未驗證，遇到時報錯不猜）。

**3a-4d 跟著模型走的圖元（2026-10-01，ADR 0026，Schema 13，已提交推送 e87249b）：** 草圖分頁的「轉換實體引用」：在草圖編輯中點模型的邊線（轉成跟著它的直線／圓／圓弧）或平面（轉它的外框與孔）；「貫穿」：點直線邊線，在它穿過草圖面處放一個點。使用這兩個工具時左鍵點的是模型；垂直於草圖面的邊線要先轉個角度（例如「等角」）才點得到。參考圖元是紫色的、固定的，模型改了就跟著走，邊線不見了草圖報「遺失參考」。瀏覽器腳本：`await import('/@fs/<檢出路徑>/tests/e2e/phase3-sketch-references.js?' + Date.now())`，再 `await __f.outlineAndPierce()`（需先重新載入頁面；用 `store.execute` 把方塊加寬來看圖元跟著走）；測試 555 項通過、20 項略過。**3a-4（草圖工具 P1）到此完成。**

**3a-4c 草圖診斷、檢查與輪廓選取（2026-10-01，ADR 0025，Schema 12，已提交推送 7041a21）：** 草圖過多定義時屬性管理員出現「過多定義診斷」，列出求解器證實有效的處理（刪除某個限制條件／把某個尺寸改為從動），一個按鈕；「檢查草圖用於特徵」列出開放端點、間隙、分岔、重複、長度 0、相交，按一下選取相關圖元，「修復草圖」一次刪重複、合併容差內的間隙（容差在同一區塊）；伸長與旋轉的屬性管理員在草圖有兩個以上輪廓時有「所選輪廓」勾選清單。瀏覽器腳本（每個都要先重新載入頁面）：`await import('/@fs/<檢出路徑>/tests/e2e/phase3-sketch-checks.js?' + Date.now())`，再 `await __k.diagnose()`、`repair()`、`contours()`（前兩個為了做出「過多定義」與 0.05 mm 的間隙，用 `store.execute` 準備草圖）；測試 543 項通過、20 項略過。

**3a-4b 草圖限制條件與從動尺寸（2026-10-01，ADR 0024，Schema 11，已提交推送 f774c3b）：** 屬性管理員選兩個圓／圓弧 →「同心同徑」；選一個點與兩條曲線 →「交錯」；選兩個點 →「合併」；選一條圓弧 →「標註弧長」；尺寸清單每列有「設為從動／驅動」，過多定義的尺寸自動成為從動（灰色斜體、括號、顯示量到的值）。瀏覽器腳本（每個都要先重新載入頁面）：`await import('/@fs/<檢出路徑>/tests/e2e/phase3-sketch-relations.js?' + Date.now())`，再 `await __r.coradial()`、`intersection()`、`merge()`、`arcLengthAndDriven()`、`driven()`；測試 525 項通過、20 項略過。

**3a-4a 草圖工具（2026-10-01，ADR 0023，已提交推送 027a70d）：** 狹槽、多邊形、草圖圓角／導角、修剪、延伸、偏移圖元、鏡射圖元（「草圖」分頁的新按鈕；多邊形邊數、半徑、距離在屬性管理員）。鏡射與偏移要先選取圖元再按工具。瀏覽器腳本（每個都要先重新載入頁面）：`await import('/@fs/<檢出路徑>/tests/e2e/phase3-sketch-tools.js?' + Date.now())`，再 `await __t.slot()`、`polygon()`、`fillet()`、`trim()`、`offset()`；測試 510 項通過、20 項略過。

**3a-6 特徵 II 已確認的範圍與驗收標準（使用者 2026-10-01 確認，已完成）。與下面標準不同之處：6b 封閉的路徑不支援（OCCT 給體積 0，ADR 0031）；6c 邊數不同不是錯誤而是 OCCT 自己拆開對齊（方形對圓形成立，所以標準（4）的「截面邊數不同」沒有變成錯誤），方轉圓只驗了介於圓柱與方柱之間、名稱唯一，錐台公式改用圓到圓與方到方的角錐台驗證，也沒有提供「直紋」選項（ADR 0032）。** 順序 6a 異型孔 → 6b 掃出 → 6c 疊層拉伸 → 6d 肋材，每個做完提交推送、各一個 ADR（0030–0033）。6a 孔型：直孔、柱孔（沉頭）、錐孔（埋頭）、螺紋孔（只做底孔直徑與標示，不做真實螺紋）；孔位由草圖點決定、孔的面要有穩定名稱；內建 ISO 表（M3–M20 的底孔、沉頭孔尺寸），CNS 先用同一份並標明來源，也可直接輸入自訂直徑。6b 掃出：輪廓＋路徑（直線與圓弧組成的路徑草圖），不做導引曲線與扭轉；6c 疊層拉伸：2 個以上截面草圖（點選順序）、閉合輪廓、不做導引曲線；6d 肋材：一條線的草圖＋厚度＋方向，拉伸到與本體接觸（備案：伸長加布林）。掃出／疊層拉伸的面名稱用輪廓邊與截面編號，要有命名回歸測試。驗收：（1）相容（舊測試不改、舊檔能開、升 Schema 補樣本）；（2）手算或解析體積／幾何（孔＝圓柱／沉頭／圓錐體積公式；掃出直線＝面積×長、圓弧＝帕普斯定理；疊層相同截面＝柱體、方轉圓＝錐台公式；肋材＝厚度×長×高）；（3）命名：面有穩定唯一名稱，加進含圓角與孔的零件後之後的參考找得到、改尺寸重算 0 失敗；（4）錯誤可讀（孔位不在面上、路徑不連續、截面邊數不同、肋材沒碰到本體等各有測試）；（5）結果有效、重算不明顯變慢；（6）介面與瀏覽器腳本實跑、0 Console 錯誤；（7）`npm run check` 全過、lint:i18n 基準不增加、ADR、handoff、提交推送。

**3a-9c-1 檢視（2026-10-01，ADR 0042，Schema 不變）：** 圖面左上的選項列選顯示類型（帶邊線塗彩／塗彩／移除隱藏線／顯示隱藏線／線架構）、「剖面」按鈕（垂直於 X／Y／Z、滑桿、反向）；右上角的視角選擇方塊（按面轉視角，跟著相機轉）。透視／正交（D4.5）沒做，檢視器是正交相機。**要驗收的（使用者尚未實機確認）：** 真的用滑鼠轉視角、拖剖面滑桿、切顯示類型。

**3a-9c-2 選取（2026-10-01，ADR 0043，Schema 不變）：** 圖面左上有「選擇濾器」（面／邊線／頂點）；右鍵：圓角／導角中點邊線 →「選取相切的邊線」「選取迴圈（面 …）」，刪除面／薄殼／拔模中點面 →「選取相切的面」，面疊了好幾個時 →「選取其他…」列出由前到後的面。大模型的射線改走 BVH。**要驗收的（使用者尚未實機確認）：** 圓角整圈外框一次選好、選到被擋住的面。

**3a-9c-3a 系統選項與英文（2026-10-01，ADR 0044，Schema 不變）：** 「工具」→「系統選項…」：語言、自動存檔（開關、秒數）、新零件的範本、開始時可點選的元素；英文目錄 `packages/i18n/src/en/` 全部翻完，零件側的介面（指令列、屬性管理員、對話框、狀態列、設計樹選單、錯誤訊息）也都搬進目錄了；程式碼裡還有 183 行中文（組合件介面與示範件的內容），所以組合件的畫面仍是中文，文件裡存的特徵名稱（「伸長1」）是使用者的資料。

**下一步：3a-10 驗收（3a-9c 全部已做）。**（原 9c 清單：A4.3 檢視類型：帶邊線塗彩／塗彩／移除隱藏線／顯示隱藏線／線架構；D4.3 視角選擇方塊；D4.4 剖面視圖（動態）；D4.5 透視／正交；D5.4 選擇濾器、D5.5 選擇其他與從透明中選擇、D5.6 選擇迴圈／相切／連續；D1.8 動態參考視覺化；D6.3 三度空間參考拖曳操控；A5.3 BVH 空間索引；D8.1 系統選項（含自動存檔間隔與預設單位）；D9.1 英文翻譯與語言設定）。項目多，可以再切：9c-1 檢視（A4.3、D4.3–D4.5）、9c-2 選取（D5.4–D5.6、A5.3）、9c-3 系統選項與英文（D8.1、D9.1）；D1.8、D6.3 視需要。ADR 編號 0042 起。可用的現成東西：`Viewer`（`packages/render`）、`shortcuts.ts`、`Autosaver`、屬性對話框、`MESH_QUALITY`。ADR 0017 沒有驗證的：曲面輪廓的掃出、3 個以上截面的疊層拉伸，要用樣本或製造的案例驗證。phase3-plan §5 的驗收數值已暫時認定為 Pass。已知的 Phase 3 相關事項：
- 3a：置換面（C10.2）使用者決定先不做；移動面只做平面的偏移（沒有平移 XYZ 與旋轉）；Defeaturing 對某些面會跑很久（見 ADR 0021 §9），有時間上限保護但沒有真正解決；真實的壞 STEP 檔要補一個（目前只有製造的樣本）。
- 3b：次組合件（剛性次組合件 C15.4）、零組件複製排列、爆炸視圖、零件表、干涉檢查、STEP 組合件輸入。
- Phase 2 留下的：拖曳時碰撞偵測（Phase 4a）、沿著組合件 XYZ／圖元的移動、STEP 顏色（F1.3）。
- 已查明（§10 部分驗收）：自由曲面 STEP 往返的體積差 3.5e-6 是曲線修剪範圍的一次性微調，形狀沒變，不需修改。
- 已處理（ADR 0016）：小件網格偏密（零組件改為約 1.9 萬個三角形）、第一個大 STEP 插入的等待（加了進度提示，插入時間約 8.8 s）。**還沒解決的是等待本身**：時間主要花在 STEP 匯入與命名（治具 Node 2.6 s、瀏覽器約 3 倍），要縮短得把匯入結果快取在 IndexedDB，或依視圖距離調細緻度（LOD）。

## 11. 藍圖的備援摘要（從專案文件重建，不是藍圖）

**用途**：藍圖遺失或暫時拿不到時，讓人知道已經決定過什麼、目錄 ID 是什麼意思。**只收版本庫的文件（ADR、本文件、`spikes/occt-gaps/inventory.md`、程式碼與測試）裡有證據的內容**；藍圖的原文、Phase 3 之後的範圍與驗收標準、目錄裡沒被用到的項目，這裡都沒有。與藍圖衝突時以藍圖為準。標「推」的是從用法推得的意思，不確定。

### 11.1 階段

| 階段 | 內容 | 狀態 |
|---|---|---|
| 0 | 行走骨架：草圖求解、OCCT、持久命名的最小版 | 完成 |
| 1（1A–1G） | 零件 MVP：草圖、伸長與旋轉與布林、基準面、設計樹操作、`.3dbx`、STEP 輸入、三個示範零件 | 完成 |
| 2（2A–2F） | 組合件 MVP：組合件文件、結合求解與介面、移動與參考檔、STEP 組合件輸出、驗收 | 完成 |
| 3a | 進階特徵：掃出（C4.4）、疊層拉伸（C4.5）、肋材（C4.7，備案伸長＋布林）、薄殼（C5.4）、拔模（C5.5）、複製排列與鏡射（C6.1–3）、移動與偏移面（C10.1，libcascade 缺 `BRepOffset_MakeOffset`）、刪除面與鑽孔（C10.2）、外觀顏色（C14.2、F1.3） | 未開始 |
| 3b | 次組合件（剛性，C15.4）、STEP 組合件輸入（F2.8）、零組件複製排列、爆炸視圖、零件表、干涉檢查（C7.2 的共同體積）、布林前檢查（E2.1）、STL 輸出（F4.1）；**包成桌面版**（ADR 0003：「Phase 3b 包成桌面版後改從本機載入」） | 未開始 |
| 4a | 拖曳時碰撞偵測（A3.6）、進階與機械結合（Ph4a、P2）；Phase 4 的樣本：1–2 個夾治具案例、常用廠商標準件的 STEP | 未開始 |
| 4b | 檢具：分割線（C8.1）、偏移／填補／平坦曲面、修剪／延伸／縫織、厚面、以曲面除料（C9.2–9.4）（4b-0 到 4b-6 已做，ADR 0067–0073） | 開發完成，閘門有條件通過（B 段待使用者） |
| 5 | 精確隱藏線（A4.4）：工程圖（5-0 到 5-6 已做：文件、視圖、剖面、尺寸、註記與表格、組合件圖、DXF／PDF、驗收 A 段） | 完成（有條件通過：B 段待使用者） |
| 6 | 塑膠件：拔模分析（E3.2）、底切分析（E3.3）、厚度分析（E3.5）、不等殼厚（C5.4）、扣接特徵（C4.11：唇與溝槽、螺柱、卡榫、排氣口）（6-0 計畫與技術驗證、6-1 拔模分析、6-2 底切分析、6-3 厚度分析、6-4 不等殼厚、6-5 唇與溝槽、6-6 螺柱、6-7 卡榫與窗與排氣口、6-8 驗收 A 段已做，ADR 0074–0082） | 開發完成，閘門有條件通過（B 段待使用者） |
| 7 | 鈑金：基材凸緣、邊線凸緣、摺邊、離隙與角落、展開與平板型式、DXF（C11.1–11.4）（7-0 計畫與技術驗證、7-1 基材凸緣、7-2 邊線凸緣、7-3 摺邊、7-4 縮短與離隙、7-5 平板型式、7-6 DXF、7-7 量規表與檢查、7-8 驗收 A 段已做，ADR 0083–0091） | 開發完成，閘門有條件通過（B 段待使用者） |
| P2 | IGES 輸入輸出（F1.4、F2.2）、耦合結合（A3.3）等 | 未排 |

範圍的大方向（本文件 §1）：對標 SW 早期的基礎建模，之後夾治具 → 工程圖 → 塑膠件 → 鈑金；模具不做。以上階段號碼 3–6 與內容對應是從 `spikes/occt-gaps/inventory.md` 的「Phase」欄推得，**鈑金放在哪個階段不明**。

### 11.2 目錄 ID 的分區（ADR 0001）

| 分區 | 意思（推） | 擁有的套件 |
|---|---|---|
| A1 | 幾何核心：A1.5 布林 | `@3db/kernel` |
| A2 | 草圖求解（A2.6 拖曳） | `@3db/sketch` |
| A3 | 組合件求解：A3.1 位姿、A3.2 標準結合、A3.3 耦合（P2）、A3.4 自由度與衝突、A3.5 沿剩餘自由度移動、A3.6 碰撞 | `@3db/assembly`、`@3db/model`（A3.1） |
| A4 | 顯示：A4.1 網格、A4.2 繪圖、A4.4 隱藏線 | `@3db/kernel`、`@3db/render` |
| A5 | 拾取與幾何查詢：A5.1 拾取、A5.2 零件的解析幾何 | `@3db/render`、`@3db/kernel` |
| B1 | 文件型別：B1.1、B1.2（含組合件）、B1.3 ID 不重用、B1.4 新零件的預設基準面 | `@3db/model` |
| B2 | 設計樹操作：B2.4、B2.6 抑制連帶、B2.8 刪除與相依 | `@3db/regen` |
| B3 | 重新計算 | `@3db/regen` |
| B4 | 持久命名（B4.1 布林後的面演化歷史） | `@3db/naming` |
| B5–B8 | 文件資料（B8.3 為 P1） | `@3db/model` |
| B9 | 檔案：B9.1 零件檔、B9.2 舊版遷移、B9.3（P1）、B9.4 組合件以相對路徑引用零件檔、B9.6 | `@3db/model`、`@3db/io` |
| C1、C2 | 草圖：C1.1、C1.25–C1.28 限制與尺寸、C1.29（P1）、C1.31 圖元的定義狀態 | `@3db/sketch` |
| C3 | 基準：C3.2 基準面（偏移、角度、三點為 P0，其餘 P1）、C3.3 基準軸（推） | |
| C4 | 特徵：C4.1–C4.3 伸長、旋轉、除料與終止型態、C4.4 掃出、C4.5 疊層拉伸、C4.7 肋材 | |
| C5 | 圓角類：C5.3 導角、C5.4 薄殼、C5.5 拔模 | |
| C6 | 複製排列與鏡射（C6.1–3） | |
| C7 | 多本體：C7.1（P1）、C7.2 共同體積 | |
| C8、C9 | C8.1 分割線與截交線、C9.2 填補曲面 | |
| C10 | C10.1 移動與偏移面、C10.2 刪除面 | |
| C14 | C14.2 外觀與顏色 | |
| C15 | 組合件：C15.1 插入零組件、C15.2 第一個固定、C15.3 移動與旋轉、C15.4 剛性次組合件、C15.8 標準結合、C15.12 結合的管理 | `@3db/assembly`、`@3db/model` |
| D | 介面：D1.1 設計樹、D1.2 雙向選取、D1.6 與 D7.1 錯誤提示、D4.6 基準面顯示、D5.3 與 D6 草圖介面 | `@3db/render`、`apps/web` |
| E | 量測與檢查：E1.1 距離、E2.1 布林前檢查、E3.2 拔模分析、E3.5 厚度分析 | `@3db/kernel` |
| F | 轉檔：F1.1 STEP 零件輸出、F1.2 STEP 組合件輸出、F1.3 STEP 顏色、F1.4 IGES、F2.1 STEP 輸入、F2.2 修復（P1）、F2.8 STEP 組合件輸入、F4.1 STL、F7.1 本機檔案 | `@3db/io`、`@3db/kernel` |

優先順序標記是 P0（一定要）、P1、P2。**新功能要先在藍圖附錄 C 登記 ID 與擁有套件，再寫程式**（ADR 0001 第 7 條）。

### 11.3 使用者已經做過的範圍決定

- 次組合件放在 Phase 3b，隨 C15.4 剛性次組合件一起做；Phase 2 只做一層（2026-09-28）。
- 一次開一份文件；從組合件「開啟零件」是切換過去，先詢問是否儲存（2026-09-28）。
- 「移動零組件」拖曳時沿剩餘自由度移動（A3.5，原為 P1）提前到 Phase 2（2026-09-28）。
- 驗收用使用者自己的 SW 樣本，每個階段由使用者在 SW 對照後才進下一階段（階段閘門）。**Phase 2 的閘門是在沒有 SW 的情況下，以金樣夾具、eDrawings 目測與兩個真實 STEP 的部分驗收通過的**，範圍低於藍圖原文，使用者已明確接受（2026-09-30，§8）。
- 幾何核心用 `libcascade` 3.0.2（OCCT 8.0.1）；缺 `BRepOffset_MakeOffset`、`BRepFeat_MakeLinearForm`（ADR 0003）。
- 模具不做。

### 11.4 藍圖沒有、但工作約定寫明的

見 §7：繁體中文、術語採 SW 2010 繁中版；需求模糊先問；使用者提出方案要用五位顧問審查；驗收標準要在計畫擬定後隨即制訂並經使用者確認；檔案刪除、下載、對外動作要先徵得同意；使用者要求時才提交。

