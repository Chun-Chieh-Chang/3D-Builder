# 交接文件 (Handoff & Resume Guide)

> **接手快速指引**（2026-10-21 更新）
> - **同步基準**：`origin/main`；本機另有未推送的提交時以 `git log origin/main..main` 為準。
> - **新電腦**：`git pull origin main` → `npm install` → `npm run doctor` → `npm run check`（型別＋分層＋i18n＋全部測試）。
> - **瀏覽器驗收**：`npm run verify:ui -- --only "<檔名片段>"`。跑的期間不要改原始碼（Vite 熱更新會讓整輪作廢）；匯出的檔案存在這一輪自己的暫存資料夾，不會進「下載」。
> - **一次一條工作線（2026-10-20 整理）**：這個資料夾只能有一個工作階段在改程式碼。
>   - 要平行做事，就讓另一個工作階段用自己的 worktree（`isolation: worktree`）。
>   - 不要在 fork 自舊對話的工作階段裡繼續開發：它的認知停在 fork 當時，可能是好幾週前。
>   - 接手前一律先 `git pull --ff-only origin main`，再讀本檔。
> - **本檔只放現在**：目前狀態、下一步、文件地圖、約定。每次交付的細節在 [DEV_LOG.md](DEV_LOG.md)，舊的交接段落在 [docs/handoff-history.md](docs/handoff-history.md)。

---

## 〇、目前狀態（2026-10-21 統整）

| 項目 | 現值 |
|---|---|
| 零件／組合件／工程圖 Schema | 72／7／25（ADR 0178 只改命令，不改 Schema） |
| ADR | 0001–0178，共 178 份，在 `docs/adr/`，全部列在 §2 |
| 全閘門 | 分支 `claude/ecstatic-hertz-078773`（main ＋ 第 2 批）：vitest 3346 通過、0 失敗、25 略過；typecheck、lint:rules／deps／i18n 通過；完整 `verify:ui` 158/158、0 Console 錯誤（2026-10-21，自有埠 5591／9533／5593） |
| 瀏覽器腳本 | `tests/e2e/` 共 144 個檔案（含 3 個輔助檔；`npm run verify:ui` 依檔頭的呼叫逐項跑） |
| 實機驗證清單 | [docs/manual-verification.html](docs/manual-verification.html) 91 項（新增 C27） |
| 階段 | Phase 0–7 開發完成。Phase 0–2 閘門通過；3a–7 有條件通過：只用手算的金樣與種子固定的隨機測試驗過，尚未用真實檔案對照（§3、§8） |
| 最近完成 | **介面交互審查第 2 批：草圖移動／複製／旋轉／縮放圖元與草圖陣列（ADR 0178，2026-10-21 已合併並推送）**；第 1 批右鍵選單（ADR 0176）；工程圖尺寸類型與右鍵（ADR 0177）；G6 草圖參照較前面的草圖（ADR 0175）；草圖參照第一批 G1–G5（ADR 0170–0174） |
| 已知缺口 | 曲線本體在 UI 的本體清單仍歸在曲面本體一類（ADR 0168 §5）；工程圖「隱藏個別的邊」不作用在相切邊上（ADR 0146 §7）。完整待辦見〈一〉 |

### 工作線統整（2026-10-21）

2026-10-20～21 同時有幾個工作階段，各自在主資料夾或 worktree 工作。統整時全部閒置，狀態如下：

| 工作線 | 位置 | 狀態 |
|---|---|---|
| 工程圖尺寸類型與右鍵（ADR 0177，原 0175） | 主資料夾 → `main` | 已合併、已推送（`a5fbc2b`，與 G6 撞號後改號） |
| 第 1 批：零件／草圖／組合件右鍵選單（ADR 0176） | `claude/zealous-elion-0bae8c` | 已合併進 `main`（`346933b`）、已推送 |
| G6 草圖參照較前面的草圖（ADR 0175）、塗彩相切邊 | `main`（`ea37dff`、`d8b20a2`） | 已推送 |
| **第 2 批：草圖移動／複製／旋轉／縮放與陣列（ADR 0178）** | **`claude/ecstatic-hertz-078773`** | 已同步 `main`（`96d58dc`）並改號（`2ce9809`）；2026-10-21 經使用者同意 fast-forward 合併進 `main` 並推送（`8fa2ef5`） |
| 組合件零件基準面可供結合（Qoder 任務） | `main` | 已完成（`manual-asm-component-datums.js`） |
| 其他 worktree：`drawing-dims-menu`、`zealous-elion-0bae8c`（detached）、`~/.qoder/...` 兩個、`~/.local/share/opencode/...` 一個（共 5 個） | 各自資料夾 | **2026-10-21 經使用者同意全部移除**（內容都已在 `main`）；被忽略的 `out/`（截圖、vitest 紀錄）與 Qoder 的 `scratch/parity-brief-v1-discarded-2026-10-16/` 先複製到主資料夾 `scratch/archived-worktrees/`（git 忽略）再刪。已合併的本機分支 `drawing-partial-section`、`shade-lines`、`worktree-drawing-dims-menu` 保留未刪 |

**本機的工作階段（2026-10-21 盤點，只算這台電腦、未封存的；其他電腦的不在內）**：17 個，全部閒置。逐一讀了每個的最後回報，並以 `main` 的提交與檔案核對：

| 工作階段（最後活動） | 做了什麼 | 結果是否在 `main` |
|---|---|---|
| 草圖移動／複製／旋轉／縮放與陣列（10-21，本工作階段） | 第 2 批，ADR 0178 | 是（`8fa2ef5`，M1 已完成） |
| 工程圖六項問題（10-21） | 合併並推送 `a5fbc2b`；工程圖尺寸 ADR 改號 0177 | 是 |
| 零件／草圖／組合件右鍵選單統一（10-20） | 第 1 批，ADR 0176 | 是（`346933b`） |
| 組合件零件基準面可供結合（Qoder 任務，10-20） | 零組件基準面供結合 | 是（`manual-asm-component-datums.js`） |
| 工程圖完整尺寸標註與右鍵選單（10-20） | ADR 0177（原 0175）、審查報告 | 是 |
| Git pull（10-20） | 同步；派出上面兩個 | 是 |
| 新工程圖存檔後被自動最適比例改成未存檔（10-15） | 存檔前先最適比例 | 是（`manual-drawing-save-before-fit.js`） |
| Handoff 任務進度彙整（10-15） | 交給 Qoder 任務 | 是（同上） |
| FreeCAD 頂角面與側邊面修正（10-15） | 同一曲面判定、求解穩定性；當時等待決定是否先 pull Qoder 的 D-I2／D-I4／D-I7a／D-I1b | 是（`sameSurface.ts`、`solve-determinism.test.ts`、`3f05c97`…`c6e586c`、`theme.ts` 都在） |
| 昨日開發進度分析與審查（10-14） | 空白鍵與視角方塊 | 是（`40f1e9e`） |
| 零件2軸向旋轉受限（10-14） | 只讀碼與討論，未改檔 | —（無產出） |
| UI 元素高級感（10-14） | 介面樣式 | 是（`ffa13a7`） |
| 控制棒回溯消失問題（10-14） | 退回控制棒 | 是（`252507f`） |
| 螺牙構建缺損分析（10-14） | ISO 80369-7 參數對照（諮詢，未改檔）；牙底寬待查 Table B.3 | —（使用者待辦） |
| 減少人工實機驗證項目（10-08） | 手冊重播自動化 | 是 |
| 人工實機驗證（10-08） | `THIRD_PARTY_NOTICES.md` 抽樣比對 | 是 |
| Handoff 待辦事項交接（10-06） | C1–C5 驗證與交接 | 是 |

結論：除了第 2 批，本機所有工作階段的產出都已在 `main`；那些當時「等決定」的未提交修改，後來都已由其他工作階段提交。診斷用的 `tests/phase3/zz-diag-naming.test.ts` 與 `vui.txt` 沒有進版本庫、主資料夾也已不存在（屬暫存）。**這 16 個舊工作階段已於 2026-10-21 經使用者同意封存**（可從側欄的已封存清單還原）。仍待使用者處理的只有螺牙的牙底寬（Table B.3）。

**合併第 2 批時要知道的**：
- 分支已含 `origin/main` 到 `a5fbc2b`，合併是 fast-forward 等級的單純。
- ADR 0177 已被工程圖尺寸類型用掉，第 2 批改為 0178；程式註解、測試、手冊 C27、DEV_LOG 都已同步。
- 另一工作階段推送前的全量測試曾有一次 knurl 測試失敗（單獨跑會過，推測是負載下逾時）；本分支其後三次全量 vitest 都 0 失敗。若再出現，依 AGENTS §3.3 先 profiling，不放寬門檻。

### 最近完成：塗彩視圖不畫被遮住的相切邊（2026-10-20，ADR 0146 §7，檔案格式不變）

使用者回報「圖彩部份會出現突兀的線條」。量測確認：B2.3 讓核心把看得到與被遮住的相切邊合在 `tangent`，繪圖層全畫成細實線（定位板等角視圖後方圓角的線畫在頂面上；「移除隱藏線」同樣有錯）。改為 `tangent`／`tangentHidden` 分開，被遮住的只在「隱藏線可見」（虛線）與「線架構」畫。vitest 3230 過、0 失敗；`manual-drawing-shade-tangent.js` 5 步；完整 `verify:ui` 153/153。未處理：B2.2「隱藏個別的邊」不作用在相切邊上。
### 最近完成：草圖參照第一批 G1–G5（對比 SW／FreeCAD，2026-10-20）— 已推送 `7549315..39fcf62`

**使用者決策（2026-10-19）**：
- 第一批做 G1–G5；
- 維持 FreeCAD 式看得見的參照圖元；
- 跨草圖參照（G6）只允許參照較前面的草圖；
- 每一項各一份 ADR、一個 commit；
- 工作期間每 5 分鐘回報進度。

| 項目 | 內容 | ADR／Schema | 提交 |
|---|---|---|---|
| G1 | 草圖內建水平軸、垂直軸（`@axisH`／`@axisV`） | 0170／v68 | `2d2e7aa` |
| G2 | 模型頂點投影成點（點的 `ref` 種類為 vertex） | 0171／v69 | `6cc8e57` |
| G3 | 基準軸、點、面進草圖（`ref` 種類為 datum）；**順帶補上 DAG**：草圖的父項含其圖元參照的元素 | 0172／v70 | `564e035` |
| G4 | 任意曲線的貫穿點（kernel `edgePlaneCrossings`，Heap +0.00 MiB） | 0173 | `e858676` |
| G5 | 參考平面「垂直於曲線」（kernel `edgeNearest`），並以彈簧掃出驗證整條流程 | 0174／v71 | `39fcf62` |

**最後一次全閘門**：3223 通過、0 失敗。各項的 `verify:ui` 都全數通過。已於 2026-10-20 經使用者同意推送。

第二批 G6–G9 見下面的〈一、待辦與建議的優先順序〉；G6 已於 2026-10-20 完成。

**本次學到的事**：
- `verify:ui` 跑的期間不能改原始碼；
- 版本測試不得寫死版號，也不得用 `??` 退化；
- Git Bash 的 heredoc 會吞掉 `\` 和 `'`：反斜線用 `chr(92)`，英文說明避免撇號；
- 前端的 `viewer.elementsAt` 收的是 client 座標；
- 參考平面的 `frame.origin` 是世界原點在平面上的垂足。

---


## 一、待辦與建議的優先順序（2026-10-21 統整；開工前先跟使用者確認範圍與順序）

**現況**：`main` = `origin/main`，主資料夾工作區乾淨，所有工作線都已在 `main`（第 2 批於 2026-10-21 合併，`8fa2ef5`）。

### 1.1 待辦清單

| # | 類別 | 項目 | 來源 | 誰 |
|---|---|---|---|---|
| A1 | 真實檔案對照 | 3a–7 只用手算金樣與種子固定的隨機測試驗過：鈑金支架的平板型式與 DXF、塑膠件的拔模／底切／厚度、檢具的偏移／縫織／厚面、工程圖 PDF 與 DXF 用真實程式開 | §3、§8 | 使用者（用 eDrawings 或其他 CAD 檢視，不需 SW） |
| A2 | 實機驗證清單 | 90 項，含 I10、F7、D9 實體操作與視口、F6 外部 PDF、F4／K2 用語、G5／I9 外部 CAD 檢視、J 樣本、K 標準決定 | [docs/manual-verification.html](docs/manual-verification.html) | 使用者 |
| B1 | 已知缺口 | 曲線本體在 UI 的本體清單仍歸在曲面本體一類 | ADR 0168 §5 | 開發 |
| B2 | 已知缺口 | 工程圖 B2.2「隱藏個別的邊」不作用在相切邊上 | ADR 0146 §7 | 開發 |
| B3 | 文件不一致 | 藍圖 D5.3a–c（推斷線、吸附到模型幾何、快速抓取）仍寫「**未做**」，但 `interact.ts`／`snaps.ts` 已有對齊、象限點、交點、相切、垂直等抓取，ADR 0136 已做模型邊的吸附；`sketch-snapping-plan.md` 的狀態停在 10-06「未提交」。要逐項核對驗收條件後改寫，**尚未核對，不可直接標成已做** | `docs/blueprint.md` 附錄 C | 開發 |
| C1 | 待使用者決定 | 4 個只有測試用到的函式：`suggestScale`（C16.1）、`balloonItems`、`listThreadsBySystem`、`valueIn`——接到畫面，或連測試一起刪 | `docs/cleanup-candidates.md` §G | 使用者 |
| D1 | 草圖參照第二批 | G7 草圖附著：X 方向取自一條邊、原點放在頂點、翻轉、偏移（FreeCAD 有完整的 Attachment；SW 只能事後「修改草圖」） | 2026-10-19 盤點 | 開發 |
| D2 | 草圖參照第二批 | G8 整條固定（Block）、圓與圓的最近／最遠距離（SW 的圓弧條件）、傾斜的圓精確投影成橢圓（ADR 0175 §5 目前明確拒絕） | 同上 | 開發 |
| D3 | 草圖參照第二批 | G9 曲率相等、對稱於一點、側影輪廓線（藍圖 C1.37 原本標為不做） | 同上 | 開發 |
| D4 | 藍圖 | C8.2 投影曲線（草圖投影到草圖、草圖投影到面）；ADR 與 Schema 編號開工時再取 | 藍圖 | 開發 |
| D5 | 藍圖 | C9 曲面子集（直紋曲面、放射曲面）、C10 直接編輯（取代面） | 藍圖 | 開發 |
| — | 已完成 | ~~M1 第 2 批合併進 `main` 並推送~~（2026-10-21，`8fa2ef5`） | | |
| — | 已完成 | ~~M2 清理 5 個 worktree、封存 16 個舊工作階段~~（2026-10-21） | | |
| E3 | 介面審查第 3 批 | 組合件 Triad：拖軸、拖平面、拖環旋轉、步進貼齊、中心輸入座標，只沿結合留下的自由度（差距 #3，H） | `docs/ui-interaction-audit.md` §8 | 開發 |
| E4 | 介面審查第 4 批 | 3D 框選（零件、組合件）、SmartMates、Instant3D（差距 #5–#7，M） | 同上 | 開發 |
| E5 | 介面審查第 5 批 | 工程圖補完：沒有工具時的預選高亮、既有尺寸「顯示為半徑／直徑／線性」、基線與倒角尺寸 | 同上 | 開發 |
| E6 | 介面審查第 6 批 | Enter 重複指令、Tab 翻轉結合、選取仍有自由度的圖元、獨立的「自動關係」開關、3D 雙擊特徵就地改尺寸 | 同上 | 開發 |
| E2+ | 第 2 批的後續 | 延展圖元（Stretch）、陣列副本與原圖元連動、線性陣列第二方向 | ADR 0178 §4 | 開發（使用頻率低，暫不排） |
| — | 已完成 | ~~G6 參照其他草圖~~：2026-10-20 完成（ADR 0175，Schema 72，`ea37dff`） | | |
| — | 已完成 | ~~介面審查第 1 批（ADR 0176）、第 2 批（ADR 0178）~~ | | |

### 1.2 建議的下一步（2026-10-21 統整後；理由在每項後面）

**原則：先收尾，再一次只開一條開發線。** 這兩天的混亂來自同時有三、四條工作線各自改同一個資料夾，還有 ADR 編號兩度撞號（0175、0177）。收尾之後，開發一次只走一條線；要平行時，另一條必須在自己的 worktree，並在開工時才取 ADR 編號、寫進共用筆記。

1. ~~M1 合併第 2 批、M2 清理 worktree 與封存舊工作階段~~：2026-10-21 都已完成，`main` 就是全部，本機只剩一個工作階段。
2. **A1 真實檔案對照**（你來做，與開發平行，不衝突）：仍是品質上最大的風險。3a–7 沒有一項用真實檔案驗過，新功能只會擴大未驗證的面積。最小一步：挑一個真實鈑金支架，走 §8 對應的 A 項，把結果貼回來。
3. **E3 組合件 Triad**（下一條開發線）：審查報告裡唯一剩下的 H 級差距；精確擺放零件現在只能自由拖或在面板打數字。驗收比照第 2 批：拖曳後位姿以矩陣比對、受限方向不動、Fuzz、e2e。
4. **B1、B2 已知缺口**（各一個小提交，可插在 E3 前後）：範圍明確、可測，修完〈已知缺口〉就清空。
5. **B3 文件核對**：藍圖 D5.3a–c 寫「未做」但程式已做，只改文件。
6. 之後依序：E5 工程圖補完 → D1 G7 草圖附著 → E4（3D 框選優先）→ D4 投影曲線 → E6 小項 → D2、D3、D5、E2+。
7. C1 隨時可以決定，不擋任何開發。

**假設**（未經你確認）：你的夾治具工作以鈑金與檢具為主，所以 A1 先挑鈑金支架；E3 排在 D1 前面，是因為審查報告把它列為 H、而草圖參照系列已大致完整。若你更常做組合件以外的工作，E5 或 D1 可以提前。

---

## 0. 換電腦

### 0.3 不在版本庫、只存在某台電腦的東西

| 東西 | 在哪裡 | 換電腦時 |
|---|---|---|
| ~~藍圖~~ | 已在版本庫 `docs/blueprint.md`（0.1） | 不用做什麼 |
| 使用者的全域規則 `CLAUDE.md`（SkillsBuilder 開發標準、反向提問、智囊團審查、檔案刪除保護） | 每台電腦各自的 `C:\Users\<使用者>\.claude\CLAUDE.md` | 從舊電腦複製，或依那份檔案最後一行的說明執行 SkillsBuilder 的 `INSTALL.ps1 -Global`。沒有它，§7 的工作約定不會自動生效 |
| 桌面版的建置環境（Rust 1.99、rustup、VS 2022 Build Tools 的 C++ 工作負載、`@tauri-apps/cli`） | **每台電腦各自裝**（`npm run doctor` 會說這台有沒有）：Rust（`winget install Rustlang.Rustup`，在 `%USERPROFILE%\.cargo\bin`，新終端機要把它加進 PATH）；C++ 編譯器 VS Build Tools（2022 或 2026 都行，MSVC 14.44 與 14.50 都有人用過，Tauri 認得；若 winget 對 2022 版說「已安裝」卻失敗，是有一個不完整的舊實例，改用 `setup.exe modify` 補 C++ 工作負載，或直接用已有的 2026 版）與 Windows SDK。2026-10-04 在先前使用的那台電腦裝好並用 Phase 4a–7 的程式重建了安裝檔（安裝檔在 `target/`，不在版本庫，各電腦自己建）；`node_modules` 之外都不在版本庫 | 新電腦要建桌面版：照 `apps/desktop/README.md` 的「需要」裝；只用網頁版不需要 |
| SolidWorks 樣本（專有檔案，不進版本庫） | `<使用者資料夾>\Downloads\SW樣本`：`T1405001.SLDASM`、兩個單一實體的 STEP | 看 §8 第 1 項；用到它的測試靠環境變數 `SW_SAMPLE_DIR`，沒設就略過 |
| 實機測試用的專案資料夾 | `<使用者資料夾>\Downloads\3DB實機確認` | 只是金樣零件的複本，可從 `tests/golden/` 重建（三個檔案：`定位板.3dbx`、`V型塊.3dbx`、`零件\削邊銷.3dbx`） |
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
| [ADR 0118](docs/adr/0118-dev-auto-close.md) | `npm run dev:auto`：最後一個連著的瀏覽器分頁關掉 30 秒後，開發伺服器自己結束（Schema 不變；`apps/web/dev/autoClose.ts`，`--mode autoclose`）；`npm run dev` 不變 |
| [ADR 0119](docs/adr/0119-movable-balloons-and-tables.md) | 號球與表格可以用滑鼠拖（工程圖 Schema 9：`balloonAt`；`buildScene` 回傳 `tableBoxes` 與 `balloons`；面板「號球自動排列」） |
| [ADR 0120](docs/adr/0120-relief-shapes.md) | 離隙的形狀：長圓（底端半圓）與撕裂（0.05 mm 細縫）（零件 Schema 50：`relief.shape`；平板型式共用 `relief.ts`） |
| [ADR 0121](docs/adr/0121-sheet-break-corner.md) | 鈑金斷開角落（零件 Schema 51）：獨立 `breakCorner` 特徵，凸緣自由端外角倒角或倒圓，折疊與平板型式同步 |
| [ADR 0122](docs/adr/0122-surface-cut-vector.md) | 以曲面除料的方向向量與保留側（零件 Schema 52）：任意 XYZ 向量、保留前側或後側，舊的平面方向相容 |
| [ADR 0117](docs/adr/0117-select-edges-idle.md) | 沒有在編輯時也能選邊線與頂點（Schema 不變）：`UiState.selectedElements`，Ctrl 加選；選擇濾器三個勾選平常也生效；圓角、導角、邊線凸緣、摺邊與三個曲面邊線指令開始時帶入已選的邊（預先選取） |
| [ADR 0116](docs/adr/0116-sketch-picture.md) | 草圖圖片（零件 **Schema 49**）：草圖上放 PNG／JPEG 當描圖底圖（`pictures`，資料是 `blobs/<sha>.png`／`.jpg`），不參加輪廓與關係，只在編輯那張草圖時顯示；以兩點校正比例；三個指令都能復原；eDrawings 存圖 → 描圖是沒有 SW 時的重建做法 |
| [ADR 0115](docs/adr/0115-flat-in-3d-view.md) | 在 3D 視窗顯示展開的狀態（Schema 不變）：平板型式視窗的勾選，worker 一起傳平板型式的網格，3D 視窗換成它，顯示時不能點選；沒有動畫 |
| [ADR 0114](docs/adr/0114-bent-base-flange-flat.md) | 折過的基材上的凸緣的平板型式（Schema 不變）：基材記路徑的每一段直線與它在條裡的起點，凸緣記 `host`；每一段有自己的運動，凸緣的運算沿用；六種擺法的長度與面積手算 |
| [ADR 0113](docs/adr/0113-cuts-in-flat-pattern.md) | 折彎之後才切的孔進平板型式（Schema 不變）：重算時記下基材凸緣之後各特徵拿走的材料（`SheetInfo.cuts`），平板型式用每一塊板的運動放回去；折彎裡、跨部分、折過的基材做不到的列在 `notIncluded` 並在視窗說明；孔位置與面積手算 |
| [ADR 0112](docs/adr/0112-thicken-sharp-edge.md) | 厚面遇到尖角時拒絕（Schema 不變）：根因是 OCCT 簡單厚面不在尖角算交線；用面與網格各算一次體積，差超過 0.5% 就拒絕並說明 |
| [ADR 0111](docs/adr/0111-mid-bend.md) | 中間折彎（S-3，零件 **Schema 48**）：`midBend`（草圖一條線、角度、半徑、固定側、方向）；三塊（不動、折彎區、轉的）＋剛體運動，折彎區必須是單純長條；平板型式＝原來的板加一條折彎線；限制：只對封閉輪廓的板、前後都不能有凸緣、一個零件一個、折彎區不能有孔 |
| [ADR 0110](docs/adr/0110-miter.md) | 邊線凸緣的斜接（S-2，零件 **Schema 47**）：`miter`＝兩凸緣的間隙；45° 垂直面，鄰居切回、這個凸緣延長再切回；平板型式在角落是折彎中立層的曲線（24 段）；只做兩個 90°、同半徑、材料在內、垂直相鄰的凸緣；體積與面積都對手算 |
| [ADR 0109](docs/adr/0109-mutual-trim.md) | 互相修剪曲面（P-3，零件 **Schema 46**）：`mutualTrim`（`a`、`b`、`discard`）；核心 `trimSurfaces`（一般融合＋合併同曲面的面）；片沿用原面名、分成幾片加 `#k`；點一片去掉；限制：兩個自由曲面互相相交沒測、片數變了名字可能對不上；順手記下：厚面在尖銳折彎的體積（924 vs 手算 1140）未解 |
| [ADR 0108](docs/adr/0108-thicken-both-keep.md) | 厚面的「兩側」與「保留曲面」（零件 **Schema 45**）：`both`、`keepSurface`；兩側＝偏移半厚再加厚（不做融合）；保留曲面時實體是新本體、面名前加 `copy`；限制：只有對稱、急彎曲面未測 |
| [ADR 0107](docs/adr/0107-snap-hook-window.md) | 卡榫的「鉤下面的窗」做成選項（零件 **Schema 44**）：`windowClearance`、`windowDepth`；窗從樑前面到鉤尖再加間隙、兩側加間隙，尺寸從鉤算出；底切分析確認有窗時卡面不是底切；面板勾選；限制：窗只有矩形、深度手填 |
| [ADR 0106](docs/adr/0106-flat-pattern-in-drawing.md) | 工程圖的展平圖（S-1，**工程圖 Schema 6**）：視圖方向 `flat`，worker 用 `sheet` 做 `flatPattern` 轉成視圖線（外形與孔實線、折彎線 `center` 鏈線），不能再投影或剖面（細部放大可以）、還不能標註尺寸；非鈑金件寫原因；手冊 I6；限制：沒有折彎表與註記 |
| [ADR 0105](docs/adr/0105-form-sub-assembly.md) | 形成次組合件（E-3，Schema 不變）：選的零組件與兩端都在其中的結合進新的 `.3dba`（位置取解出來的、裡面沒有固定的就固定第一個），組合件留一個代表它的零組件在原點（零件都不動）；一端在外面的結合改成通過次組合件（`path`）、爆炸步驟改名；排列／鏡射用到的拒絕；指令 `formSubAssembly` 一步復原、`FormSubPanel`、檔寫在組合件旁邊；金樣夾具手算 < 1e-6；限制：不能選資料夾、沒有解散 |
| [ADR 0104](docs/adr/0104-several-exploded-views.md) | 多組爆炸（E-2，**組合件 Schema 7**）：`explosions: ExplodeView[]`（id、名稱、步驟）與 `activeExplosion`；舊的 `explosion` 在 6 → 7 遷移成「爆炸視圖1」；既有的步驟指令作用在顯示中的那一組（沒有時建第一組）；新指令 `insertExplosion`／`renameExplosion`／`deleteExplosion`／`setActiveExplosion`；刪除零組件清掉各組的步驟；面板「爆炸視圖組」（下拉、新增、刪除、改名）；限制：只能移動頂層零組件 |
| [ADR 0103](docs/adr/0103-explode-lines-animation.md) | 爆炸線與動畫（E-1，檔案格式不變）：每個被爆炸的零組件一條深藍虛線（從組裝位置的包圍盒中心經過每個步驟之後的位置，`explosionOffsets.paths`、`leavesCentre`、`Viewer.setGuides`）；爆炸與收合半秒緩入緩出（`explodeT`、`EXPLODE_MS`，`exploded` 仍是目標）；面板「顯示爆炸線」；限制：背景分頁時動畫暫停、每段是直線 |
| [ADR 0102](docs/adr/0102-dxf-dimension-entities.md) | DXF 的 DIMENSION 圖元（D-2）：每個尺寸一個 DIMENSION＋匿名圖塊 `*D<n>`（原來的線、箭頭、字，看圖軟體照畫）；字用 `1` 蓋寫成模型算好的字；種類 線性（旋轉／對齊）、直徑、半徑、二線角度，定義點取自繪圖時算好的紙面座標；DIMSTYLE `STANDARD`；`Scene.dimensions` 與項目的 `group`（SVG／PDF 不變）；`readDxf`／`checkDxf`／`dimensionMeasure`／`drawnEntities`；**沒有真正的 CAD 開過**（手冊 F6） |
| [ADR 0101](docs/adr/0101-hole-callouts-thread-countersink.md) | 螺紋孔與錐孔的孔標註（D-1）：錐孔讀形狀（孔口的圓錐：口徑與夾角）、螺紋讀特徵（`holeFeatures`，包括衍生本體的主模型；形狀上它只是底孔）；`M6 貫穿（底孔 Ø5）`、`錐孔 Ø12 90°`；定位銷入口的導角在有特徵時不當錐孔；自動尺寸有孔標註時只併註記相同的孔；孔表同字；`孔標註.3dbx` 進驗證包；限制：螺紋深＝鑽孔深、匯入模型的導角讀成錐孔 |
| [ADR 0100](docs/adr/0100-drawing-angle-dimension.md) | 工程圖的角度尺寸（工程圖 **Schema 5**）：`angle`（兩個面或直線邊、弧半徑、補角）；夾角是從兩線交點朝各元素中間伸出的射線所夾的角；視圖特徵加 `slant`（斜面）；弧畫成折線、延伸線、箭頭；手冊 F3 加一步；同日命令列改成下拉選單（按需展開）；限制：介面只列平面、DXF 仍不是 DIMENSION 圖元 |
| [ADR 0099](docs/adr/0099-sketch-snapping.md) | 草圖吸附與推斷（S-1 到 S-4）：一個決定點 `updateSnap`、優先順序（點與中點 → 模型點 → 交點 → 四分之一點 → 切點與垂足 → 圖元上 → 模型邊 → 推斷 → 對齊 → 長度／角度／網格）、按下去加的關係、`SnapSettings`（總開關、逐項、網格與角度預設不啟用）與快速抓取；限制：沒有「平行」抓取（用推斷）、網格不畫格線 |
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
| [ADR 0123](docs/adr/0123-thread-feature.md) | ADR 0123：真實螺牙特徵資料結構與再生管道（零件 Schema 52 → 53） |
| [ADR 0124](docs/adr/0124-knurl-feature.md) | ADR 0124：壓花特徵（零件 Schema 53 → 54） |
| [ADR 0125](docs/adr/0125-drawing-surface-finish-and-one-sided-tolerance.md) | ADR 0125：工程圖表面粗糙度標註與單向極限公差（工程圖 Schema 9 → 10） |
| [ADR 0126](docs/adr/0126-worker-heap-recycling.md) | ADR 0126：幾何核心的記憶體高水位自動重啟（Worker Heap Recycling） |
| [ADR 0127](docs/adr/0127-sketch-plane-entries.md) | ADR 0127：草圖平面的入口與圖面上的基準幾何（Schema 版本不變） |
| [ADR 0128](docs/adr/0128-drawing-language.md) | ADR 0128：工程圖語言獨立於介面語言（工程圖 Schema 10 → 11） |
| [ADR 0129](docs/adr/0129-drawing-interaction-roadmap.md) | ADR 0129：工程圖交互改進路線（提前 C16 的 P2 項） |
| [ADR 0130](docs/adr/0130-drawing-multi-selection.md) | ADR 0130：工程圖的多重選取與一次修改（D-I1a） |
| [ADR 0131](docs/adr/0131-drawing-views-by-pointer.md) | ADR 0131：比照 SolidWorks，在圖紙上拖曳與點選產生視圖和剖面（D-V） |
| [ADR 0132](docs/adr/0132-drawing-annotations-gdt.md) | ADR 0132：工程圖的註解、基準、幾何公差與手動中心線（D-I3，工程圖 Schema 11 → 12） |
| [ADR 0133](docs/adr/0133-drawing-sidebar-like-solidworks.md) | ADR 0133：工程圖側邊欄比照 SolidWorks 的結構（D-I1b 提前） |
| [ADR 0134](docs/adr/0134-drawing-main-view-first.md) | ADR 0134：新工程圖從空白圖頁開始，先選主視圖，尺寸按需標註（D-V2） |
| [ADR 0135](docs/adr/0135-dev-shutdown-button.md) | ADR 0135：「關閉伺服器」按鈕徹底結束開發中的系統（Schema 不變） |
| [ADR 0136](docs/adr/0136-sketch-snap-projected-edges.md) | ADR 0136：草圖吸附延伸到草圖平面外的模型邊（投影）與貫穿點（Schema 不變） |
| [ADR 0137](docs/adr/0137-deterministic-rebuilds.md) | ADR 0137：重建的決定性（B3.1）——求解輸出上網格、每次重建全新求解器、布林結果面命名繼承 |
| [ADR 0138](docs/adr/0138-drawing-named-view-edges.md) | ADR 0138：視圖的邊與頂點有名字，尺寸可以標在頂點與邊上，等角視圖也行（D-I2，第一部分） |
| [ADR 0139](docs/adr/0139-drawing-ordinate-arrange.md) | ADR 0139：座標尺寸、尺寸對正與自動排列（D-I4） |
| [ADR 0140](docs/adr/0140-drawing-open-part.md) | ADR 0140：從工程圖的視圖開啟零件，返回後自動更新（D-I7(a)） |
| [ADR 0141](docs/adr/0141-drawing-commands-menus-tree.md) | ADR 0141：工程圖的 CommandManager 頁籤、右鍵選單與特徵樹（D-I1b） |
| [ADR 0142](docs/adr/0142-drawing-slanted-section.md) | ADR 0142：任意角度的剖面線（D-I5 第一部分） |
| [ADR 0143](docs/adr/0143-drawing-stepped-aligned-section.md) | ADR 0143：階梯剖面與對正剖面（D-I5 第一部分之二） |
| [ADR 0144](docs/adr/0144-assembly-component-datums-in-tree.md) | ADR 0144：組合件設計樹展開零件——零件自己的原點、基準面與特徵，拿來做結合 |
| [ADR 0145](docs/adr/0145-selection-filter-sw-toolbar.md) | ADR 0145：選擇濾器比照 SolidWorks 工具列（隱藏預設、F5/F6、單選） |
| [ADR 0146](docs/adr/0146-drawing-sw-parity-six.md) | ADR 0146：工程圖六項與 SolidWorks 對齊——回到零件、顯示樣式與塗彩、剖面解除對齊、尺寸樣式、斜角等角投影 |
| [ADR 0147](docs/adr/0147-drawing-fit-before-save.md) | ADR 0147：新工程圖的「最適比例」與存檔——存檔等它、它併入放視圖那一步 |
| [ADR 0148](docs/adr/0148-assembly-view-normal-and-filter.md) | ADR 0148：組合件的「正視於」與選擇濾器——兩者原本只限零件 |
| [ADR 0149](docs/adr/0149-view-normal-nearest-and-cube-flip.md) | ADR 0149：「正視於」沒有可看的平面時轉到最近的標準視角、視角方塊加翻面鈕 |
| [ADR 0150](docs/adr/0150-drawing-title-block-text-style.md) | ADR 0150：標題欄的文字樣式——欄位名稱、數值與標題的字高，以及超出儲存格時自動縮小 |
| [ADR 0151](docs/adr/0151-drawing-break-view.md) | ADR 0151：斷裂視圖（D-I6 第一部分） |
| [ADR 0152](docs/adr/0152-drawing-crop-view.md) | ADR 0152：裁剪視圖（D-I6 第二部分） |
| [ADR 0153](docs/adr/0153-drawing-auxiliary-view.md) | ADR 0153：輔助視圖（D-I6 第三部分） |
| [ADR 0154](docs/adr/0154-drawing-pages.md) | ADR 0154：工程圖多圖頁——資料模型與遷移（B2.8 第一部分） |
| [ADR 0155](docs/adr/0155-sidebar-tabs-hidden-contract.md) | ADR 0155：零件／組合件側邊欄的兩分頁與「切換只隱藏」契約（E1-P2） |
| [ADR 0156](docs/adr/0156-cosmetic-threads.md) | ADR 0156：裝飾螺紋線特徵與全鏈路渲染出圖（零件 Schema 56 → 57） |
| [ADR 0157](docs/adr/0157-sketch-ellipse.md) | ADR 0157: 草圖橢圓圖元與長出實體全鏈路架構 (Sketch Ellipse Feature) |
| [ADR 0158](docs/adr/0158-split-body.md) | ADR 0158: 實體分割特徵 (Split Body Feature, C7.4) |
| [ADR 0159](docs/adr/0159-sheet-metal-jog.md) | ADR 0159：鈑金凸折特徵（Sheet Metal Jog Feature，零件 Schema 60） |
| [ADR 0160](docs/adr/0160-sketch-spline.md) | ADR 0160: 草圖樣條曲線圖元與造型實體全鏈路架構 (Sketch Spline Feature) |
| [ADR 0161](docs/adr/0161-sheet-metal-break-corner.md) | ADR 0161: 鈑金斷開角落與角落修剪全鏈路架構 (Sheet Metal Break Corner Feature) |
| [ADR 0162](docs/adr/0162-convert-entities.md) | ADR 0162: 草圖參考圖元與相交曲線全鏈路實作 (Sketch Convert Entities & Intersection Curves) |
| [ADR 0163](docs/adr/0163-sketch-text.md) | ADR 0163: 草圖文字特徵與 3D 刻印/雕刻管線 (Sketch Text Feature & 3D Engraving/Embossing) |
| [ADR 0164](docs/adr/0164-move-copy-body.md) | ADR 0164: 實體移動與複製本體特徵 (Move/Copy Body Feature, C7.3) |
| [ADR 0165](docs/adr/0165-delete-keep-body.md) | ADR 0165: 實體刪除與保留本體特徵 (Delete / Keep Body Feature, C7.3) |
| [ADR 0166](docs/adr/0166-curve-driven-pattern.md) | ADR 0166: 沿曲線/邊線複製排列特徵 (Curve-driven Pattern Feature, C6.4) |
| [ADR 0167](docs/adr/0167-variable-radius-fillet.md) | ADR 0167: 變化半徑圓角 (Variable Radius Fillet, C5.2) |
| [ADR 0168](docs/adr/0168-helix-spiral-curve.md) | ADR 0168: 螺旋曲線與渦捲線特徵 (Helix / Spiral Curve Feature, C8.3) |
| [ADR 0169](docs/adr/0169-sweep-along-helix.md) | ADR 0169：沿螺旋曲線掃出（彈簧） |
| [ADR 0170](docs/adr/0170-sketch-origin-axes.md) | ADR 0170：草圖內建水平軸與垂直軸（G1） |
| [ADR 0171](docs/adr/0171-sketch-vertex-points.md) | ADR 0171：模型頂點投影成草圖點（G2） |
| [ADR 0172](docs/adr/0172-sketch-datum-references.md) | ADR 0172：基準軸、基準點、基準面進草圖（G3）；草圖參照補入 DAG |
| [ADR 0173](docs/adr/0173-pierce-any-curve.md) | ADR 0173：任意曲線的貫穿點（G4） |
| [ADR 0174](docs/adr/0174-plane-normal-to-curve.md) | ADR 0174：參考平面「垂直於曲線」（G5） |
| [ADR 0175](docs/adr/0175-sketch-references-to-sketches.md) | ADR 0175：草圖參照較前面的草圖（G6） |
| [ADR 0176](docs/adr/0176-graphics-area-context-menus.md) | ADR 0176：零件、草圖、組合件畫面的右鍵選單 |
| [ADR 0177](docs/adr/0177-drawing-dimension-kinds-and-context-menu.md) | ADR 0177：工程圖尺寸類型與右鍵選單（原本地編為 0175，與 G6 撞號後改號） |
| [ADR 0178](docs/adr/0178-sketch-move-copy-rotate-scale-and-patterns.md) | ADR 0178：草圖的移動／複製／旋轉／縮放圖元與線性、環狀草圖陣列（原本地編為 0177，與上一列撞號後改號） |
| [docs/assembly-explode-plan.md](docs/assembly-explode-plan.md) | 組合件：爆炸線與動畫、多組爆炸、形成新次組合件（計畫） |
| [docs/cleanup-candidates.md](docs/cleanup-candidates.md) | 清理候選清單（2026-10-07） |
| [docs/decisions-2026-10-11.html](docs/decisions-2026-10-11.html) | 3D-Builder 待辦與待裁決選擇題（2026-10-11） |
| [docs/decisions-2026-10-14.html](docs/decisions-2026-10-14.html) | 3D-Builder 未做／待裁選擇題（2026-10-14） |
| [docs/decisions-2026-10-14b.html](docs/decisions-2026-10-14b.html) | 3D-Builder 未做／待裁選擇題（2026-10-14 晚） |
| [docs/decisions-2026-10-17.html](docs/decisions-2026-10-17.html) | 3D-Builder 未做／待裁選擇題（彙整，2026-10-16） |
| [docs/decisions-2026-10-18.html](docs/decisions-2026-10-18.html) | 3D-Builder 未做／待裁選擇題（2026-10-17 之後） |
| [docs/decisions-2026-10-19.html](docs/decisions-2026-10-19.html) | 3D-Builder 未做/待裁選擇題(2026-10-19,重整理) |
| [docs/decisions-e1p2-b28-shape2.html](docs/decisions-e1p2-b28-shape2.html) | 決策單：E1-P2 收尾 ＋ B2.8 shape 2（多圖頁 UI） |
| [docs/drawing-callouts-plan.md](docs/drawing-callouts-plan.md) | 工程圖：螺紋孔與錐形沉孔的標註、DXF 的 DIMENSION 圖元（計畫） |
| [docs/drawing-interaction-gap-plan.md](docs/drawing-interaction-gap-plan.md) | 工程圖交互邏輯：與 SolidWorks / FreeCAD TechDraw 的差距分析與改進規劃（草案） |
| [docs/fillet-picking-impact.md](docs/fillet-picking-impact.md) | 圓角在工程圖上可點選的影響面盤點（E1a） |
| [docs/handoff-history.md](docs/handoff-history.md) | 10. Phase 2 組合件 MVP（完成，閘門通過） |
| [docs/hardening-plan.md](docs/hardening-plan.md) | 鞏固計畫（Phase 3a–7 之後） |
| [docs/help-plan.md](docs/help-plan.md) | 說明系統計畫（比照 SolidWorks 的「說明」；單一來源 SSOT） |
| [docs/manual-verification.html](docs/manual-verification.html) | 3D-Builder 實機驗證清單 |
| [docs/sheet-metal-drawing-plan.md](docs/sheet-metal-drawing-plan.md) | 鈑金：平板型式進工程圖、斜接、凸折（計畫） |
| [docs/sidebar-parity-plan.md](docs/sidebar-parity-plan.md) | 零件 / 組合件側邊欄比照工程圖(ADR 0133)重做 — 範圍與方案 |
| [docs/surface-trim-plan.md](docs/surface-trim-plan.md) | 曲面互相修剪（P-3）：小驗證與計畫 |
| [docs/thread-plan.md](docs/thread-plan.md) | 螺牙（真實螺紋實體）：計畫與驗證方案 |
| [docs/verification-coverage.md](docs/verification-coverage.md) | 人工驗證清單的自動化覆蓋（更新至 2026-10-14） |
| [docs/verify-user-list.html](docs/verify-user-list.html) | 3D-Builder 實機驗證:只列要你親自做的 |
| 本文件 | 狀態、待辦、下一步、約定 |

## 3. 各階段的狀態紀錄

> 下面每一行是寫下當天的狀態（日期在行內），測試數字與 Schema 版本以當天為準；**現況看本檔最上方的〇**。

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
- **分支與遠端**：只在 `main` 開發。遠端 `origin` = https://github.com/Chun-Chieh-Chang/3D-Builder（私人），`main` 追蹤 `origin/main`。（`spike/occt-gaps` 已刪除，2026-10-20 確認不在。）
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
npm run dev:auto     # 同上；最後一個分頁關掉 30 秒後伺服器自己結束（ADR 0118）
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
- **e2e 腳本的路徑**：`tests/e2e/*.js` 的 `H.GOLDEN` 已改成由 `import.meta.url` 推出，不再寫死使用者路徑。載入腳本時用實際的檢出位置，例如 `await import('/@fs/F:/Self-developed_Apps/G3/3D-Builder/tests/e2e/phase2-assembly.js?' + Date.now())`。本文件其他處的 `<檢出路徑>` 是舊機器上的路徑。Vite 會把 `new URL('字面值', import.meta.url)` 當成資源匯入而改寫，所以腳本裡用字串處理。
- **Vite 對別的磁碟的檔案**：開發伺服器在 `F:`，`/@fs/C:/…` 的請求會拿到首頁（HTML，內容 560 位元組），不是檔案，e2e 存進 OPFS 的就是那份 HTML，載入時會報「檔案不是有效的 JSON」。要在瀏覽器測放在別的磁碟的樣本，起一個只讀、只綁 127.0.0.1 的小型靜態伺服器（Node `http`，加 `Access-Control-Allow-Origin: *`，只提供該資料夾的 `.step`），`H.project` 用它的網址取檔；用完停掉。不要為了測試複製使用者的檔案。
- **頁面沒有繪製時的 e2e**：瀏覽器窗格隱藏、Claude 視窗被擋住時截圖逾時，依游標拾取的流程（`H.pickOn`，例如 `__asm.fixture()` 的結合）會失敗（「could not get the cursor onto face …」）。這種情況改用指令加入結合；`__asm.exportStep()` 就是這樣做的。
- **連接埠**：5173 是本機其他 Vite 專案在用的預設埠。本專案固定使用 `127.0.0.1:5391`，並開啟 strictPort；埠被占用時直接報錯，不會換埠。
- **預覽伺服器**：app 可能在回合之間停掉它。請使用者開網址前，先用 `preview_list` 和 curl 確認。Phase 0 驗收 ② 第一次失敗就是因為沒有確認。
- **Vite 設定檔的相對匯入要自帶副檔名**：`apps/web/vite.config.ts` 寫成 `./dev/autoClose.ts`（含 `.ts`），因為 Vite 下一大版本預設的 `configLoader: 'native'` 不解析無副檔名的路徑；啟動時那句 `(!) Your Vite config uses features that are unsupported by configLoader: 'native'` 就是在講這件事，加了副檔名之後 `npm run dev` 與 `npm run dev:auto` 都不再出現。TypeScript 端要跟著開 `tsconfig.json` 的 `allowImportingTsExtensions`（已有 `noEmit: true` 才合法，否則 `tsc` 報 TS5097）。其餘 763 處無副檔名的相對匯入（分布在 312 個檔案）使用者 2026-10-08 決定不跟著改，見 §8 第 7 項。
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
  - 用法：在頁面中 `await import('/@fs/<檢出路徑>/tests/e2e/phase1-demo-parts.js?' + Date.now())`，再 `await __demo.plate()`（或 `vblock()`、`pin()`）。
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

> 實機驗證清單現為 **90 項**（[docs/manual-verification.html](docs/manual-verification.html)，2026-10-20 點算）；下面依階段的待辦保留寫下當天的內容。

### 最新狀態（2026-10-09；以下 Phase 分項保留歷史參考）

- 程式與自動驗證已完成並推送到 `main`（commit `1a2dd3b`）。最近完整驗證：`verify:ui` 125/125；`npm run check` 183 檔通過、3 檔略過，2481 項通過、22 項略過；`npm run build` 成功，伴隨兩項 Vite 警告。
- 尚待實機／外部確認：I10、F7、D9 實體操作；D9 375／390／768 視口；F6 外部 PDF 開啟；F4／K2 標註用語；G5／I9 外部 CAD 檢視；J 樣本與 SolidWorks 對照；K 標準決定；L 項目的許可與選做收尾。
- 瀏覽器對 localhost 權限被阻擋時不得改走其他瀏覽器路徑繞過。自動化截圖／合成事件不能標成實機通過。
- 公開樣本已從 OSF 取得並測試匯入；真正的 SolidWorks 特徵樹、分析及製造結果比對尚未完成。

**逐項的實機驗證清單（88 項，含步驟、預期結果、回報格式）：[docs/manual-verification.html](docs/manual-verification.html)**，用瀏覽器開，狀態與備註存在瀏覽器裡，做完按「複製結果」貼回來。以下是各階段的原始待辦。

**Phase 7 鈑金的待辦（2026-10-04；ADR 0091 的最後一節有完整版）**

- A. **一個真實的鈑金支架**：用同一個板厚、半徑、K 因子在 SW 看平板型式的外包尺寸與折彎線位置，與這裡的「平板型式」視窗對（差距多半來自定義：凸緣長度量到外側／內側虛擬交點、K 因子）；把輸出的 DXF 用你的 CAD 或雷射切割軟體開，看輪廓、`BEND` 層與註記。
- B. 真人走一遍：「鈑金」頁的基材凸緣（平板、折過的板）、邊線凸緣、摺邊、縮短與離隙、平板型式、量規表、檢查，回報不順的地方。
- C. **你要決定**：沒做的——凸折（板中間，需要切開並移動一半實體的新核心操作）、（封閉角落已在 H-6 做完，ADR 0095）、斷開角落、長圓與撕裂離隙、折過的基材上的凸緣的平板型式、3D 視圖的展開／摺疊切換、除料特徵進平板型式（折彎之後才切的孔）、平板型式進工程圖；（2026-10-09：長圓與撕裂離隙 ADR 0120 已做。）（2026-10-07 之後：斜接 ADR 0110、中間折彎 ADR 0111、折彎後的孔進平板型式 ADR 0113、折過基材上的凸緣的平板型式 ADR 0114、3D 視窗展開 ADR 0115 都已做完；平板型式進工程圖 ADR 0106。）摺邊的最小半徑：ADR 0093 已決定不另訂規則（金樣的假警報已消除），等有工廠的數值再加。
- D. 檢查的預設比例（半徑 1 倍板厚、平直段 4 倍、孔到折彎 2 倍）是我的起點，不是標準——請改成你工廠的規定；量規表沒有預設列。

**Phase 6 塑膠件的待辦（2026-10-04；ADR 0082 的最後一節有完整版）**

- A. **一個真實的塑膠件**（STEP 或你的零件檔）：各跑拔模、底切、厚度分析，與 SW 的同一種分析對顏色與數字（厚度的定義我不知道 SW 用哪個；真實件的曲面壁、肋、圓角的取樣行為沒試過）。
- B. 真人走一遍：開零件 → 工具頁的三種分析（方向、要求角度、厚度上下限）→ 特徵頁的唇與溝槽、螺柱、卡榫、卡榫的窗、排氣口、不等殼厚的薄殼，回報不順的地方。
- C. **你要決定**：（螺柱孔的拔模已在 H-4 做完，ADR 0093：選項 A，孔有自己的拔模角）；卡榫站在底上要開窗：已做成卡榫的選項（ADR 0107）。
- D. 瀏覽器裡殘留的「找到沒有儲存的零件」是舊的測試副本，按「捨棄」；之後的 e2e 腳本會自己收尾（`H.tidy()`）。

**Phase 4b 檢具的待辦（2026-10-03；ADR 0073 的最後一節有完整版）**

- A. **一個真實的沖壓件或塑膠件 STEP**：放進主模型（輸入修復會先處理），畫草圖投影到要做型面的面，偏移 3 mm（看 PropertyManager 說的間隙），厚面，回報哪裡失敗（曲面是修剪過的 B 樣條、面多又小時，偏移、縫織、分割線的穩定度只有真實檔案知道）。
- B. 真人走一遍：開零件 → 分割線 → 偏移曲面 → 延伸／修剪／縫織 → 厚面或以曲面除料，回報不順的地方；畫布上真的點選與曲面的顯示（雙面）我沒有人眼確認。
- C. 輸出的 STEP（型面塊）用別的 CAD 開：偏移曲面已轉成 B 樣條（ADR 0072），讀不讀得進沒有試過；轉換器中止時輸出會警告。
- D. 已做：曲面之間的「互相修剪」（ADR 0109）、厚面「兩側」與保留曲面（ADR 0108）；厚面遇到尖角會拒絕（ADR 0112）。還沒做：除料用任意向量當方向。

**Phase 5 工程圖的待辦（2026-10-03；ADR 0065 的最後一節有完整版）**

- A. **用真實的程式開輸出**：用 Chrome 開一張夾具圖的 PDF、用你的 CAD（AutoCAD、DraftSight…）開同一張的 DXF：看線寬、虛線、箭頭、中文、尺寸文字的位置。PDF 要中文請先在工程圖面板的「PDF 字型…」選一個字型檔（例如 `C:\Windows\Fonts\msjh.ttc`）。這是 Phase 5 驗收②的 B 段。
- B. 真人走一遍：開零件或組合件 →「新工程圖」→ 自動尺寸、孔表、剖面、零件表與號球 → 輸出，回報不順的地方（尺寸堆疊太擠、號球位置、孔表欄寬）。
- C. 對照你的標準：公差表（ISO 286，`packages/model/src/tolerance.ts`，表值是手打的）、孔標註的用語（貫穿、深、沉頭）、標題圖塊的欄位與位置。
- D. 號球與表格的拖曳（2026-10-09，ADR 0119，工程圖 Schema 9）已做。（螺紋孔與錐孔的孔標註 2026-10-07 已做，ADR 0101；角度尺寸 ADR 0100；DXF 的 DIMENSION 圖元 ADR 0102，沒有真正的 CAD 開過。）

**Phase 4a 的待辦（2026-10-03，使用者決定先走完開發、對接時再修正；ADR 0059 的最後一節有完整版）**

- A. **一個真實的夾具案例**：工件 STEP（含曲面更好）、你在 SW 做的夾具截圖、你常用的廠商定位銷與螺絲的 STEP。第一步：把真實工件放進主模型（輸入本體、標為參考本體），走 `tests/phase4/acceptance-4a.test.ts` 同一條流程，看輸入修復、衍生零件、結合、干涉與餘隙的實況。
- B. 用 eDrawings（或 SW）開輸出的組合件 STEP，目測階層、位置與顏色。
- C. 真人走一遍：新零件做主模型 →「從本體產生組合件」→ 插入零組件的「標準件圖庫」→ 結合（含進階結合）→ 干涉／餘隙 → 改主模型，回報不順的地方。
- D. 對照你的標準：圖庫的尺寸表（ISO 4762／8734／7089）、定位銷孔的公差表（ISO 286-1），都在 `packages/library`、`packages/model/src/dowel.ts`，表值是手打的。
- 還有：Phase 3 的補驗收（下面的 0–6 項）仍然順延。



0. **桌面版的人工驗收（3b-6 第 3、7 項，2026-10-03）**：在沒裝過開發工具的 Windows 帳號（或另一台電腦）安裝 `3D-Builder_0.1.0_x64-setup.exe`，斷網啟動，用**原生對話框**存、開 `.3dbx` 與 `.3dba`，開一個真的專案資料夾，最後解除安裝；步驟在 [ADR 0052](docs/adr/0052-desktop-shell.md)「要使用者做的」。安裝檔不在版本庫，在這台 `npm run build -w @3db/desktop` 重做就有。
1. **Phase 2 驗收樣本（已結案，範圍降低）**：藍圖要的是使用者的一個 SW 組合件（10–20 個零組件）。
   - **使用者沒有 SW，只有 eDrawings（2026-09-30）**：所以藍圖驗收 ③「在 SW 開啟」與「用 SW 樣本重組」都無法照原文做。改為把金樣夾具（15 個零組件）輸出成 `<使用者資料夾>\Downloads\金樣夾具-15零組件.step`（`STEP_OUT_DIR=<資料夾>` 跑 `tests/phase2/golden-assembly.test.ts` 產生），用 eDrawings 開啟目測。**使用者已開啟，看到的與下述一致**（eDrawings 不是 OCCT，是獨立於我們的讀取器），並**明確接受這個較低的範圍作為 Phase 2 閘門（2026-09-30）**。該檔案有：3 塊定位板並排（x = 0、120、240）、每塊 2 支削邊銷插在孔中（x ± 40）、2 個疊起來的 V 型塊在板的正中央（底面在 y = 15 與 55）。
   - **之後若有人有 SW**：可補做原本的驗收，需要一個保留結構的組合件 STEP（下面的說明）。不阻擋 Phase 3。
   - **目前狀態（2026-09-30）**：`<使用者資料夾>\Downloads\SW樣本` 有 `CIV0000467治具_step.STEP`、`3D_MT17203_CIV0000467_Porduct.STEP` 與 `T1405001.SLDASM`，**都不能用來驗收**：兩個 STEP 各只有 1 個 `PRODUCT`、1 個實體、0 個 `NEXT_ASSEMBLY_USAGE_OCCURRENCE`（AP203，組合件被併成單一實體；治具 2004 個面、130×100×10 mm，產品件 340 個面）；`.SLDASM` 是 SW 的專有壓縮格式，讀不出零件參照，我們沒有讀取器，它的零件檔（`.SLDPRT`）也沒給。需要重新輸出：每個不同的零件各一個 STEP，外加一個保留組合件結構的組合件 STEP（檢查：搜尋 `NEXT_ASSEMBLY_USAGE_OCCURRENCE`，應有 10 次以上）。
   - （2026-10-01）樣本資料夾多了 `組合件1.step`（16 MB）：檔頭是 Open CASCADE 8.0、2 個實體、2 個 `NEXT_ASSEMBLY_USAGE_OCCURRENCE`，是本工具自己輸出的（治具加產品件），不是 SW 的輸出，不能當 3b 的樣本。
   - 每個不同的零件各自輸出 STEP；重複使用的零件只要一份。這些檔案輸入後當零件用。
   - 整個組合件的 STEP，或各零組件位置的截圖，用來比對位置。組合件 STEP 輸入是 Phase 3b，所以只拿來對照。
   - 最晚在 2F 前提供；越早越好，2E 的 STEP 組合件輸出也能拿它對照。
2. **2A–2E 實機確認（已完成，2026-09-30）**：使用者用自己的瀏覽器走完下面五組（建立與存檔、結合、移動與參考檔、輸出 STEP、載入進度），系統的資料夾與存檔對話框都確認過。過程中發現右鍵旋轉沒有任何提示，已補上圖面提示（`f14d266`）。測試用的專案資料夾是 `<使用者資料夾>\Downloads\3DB實機確認`（金樣零件的複本）。伺服器是用背景程序加暫存設定啟動的（`F:` 磁碟不能 `npm run dev`，見 §6「工作區連結」）。以下是當時的步驟，留作日後再測的清單：
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
7. **2026-10-08 已裁的兩項，不要重複提出**：
   - ① **推送**：2026-10-08 已推，`origin/main` 現在是 `92f3476`（這台電腦之前未推的四個提交都上去了：`9e9f617` 組合件的資料夾／剖面／眼睛／右鍵選單、`f5e8377` Vite 設定檔的 `.ts` 副檔名、`2270fd9` 與 `92f3476` 兩版本文件）。**要留意的**：推的時候 H9 的人工實機項目還沒走完（使用者要自己走一遍）。`9e9f617` 那版沒有動任何 `*.test.ts`，只加了三個瀏覽器重播腳本（`tests/e2e/manual-h9-folder.js`、`manual-asm-section.js`、`manual-asm-menu.js`），所以 `packages/render/src/viewer.ts` 的 124 行改動（新增 116、刪除 8）與 `AssemblyViewport.tsx`、`Viewport.tsx` 的渲染改動**不在 `npm run check` 的保護範圍內**——之後再碰這些地方，驗法要用 `npm run verify:ui`（它重播手冊並抓 Console 錯誤），只跑 `npm run check` 擋不住渲染回歸。
   - ①b **推送（2026-10-09）**：`bf25dcf`（工程圖視圖連動：前視圖整組移動、上視／右視沿對齊方向滑動、右下角把手改比例、`sheet.shift` 與視圖 `slide`，圖紙檔 Schema 7）與 `0bd7031`（「最適比例」把標註算進去，`fit.ts`）。這兩版與 `9e9f617` 不同：**有單元測試**（`tests/phase5/drawing-linked.test.ts` 17 項、`drawing-fit.test.ts` 8 項），所以排版與格式部分受 `npm run check` 保護；視窗互動（拖曳、把手）仍只有瀏覽器腳本 `manual-drawing-linked.js`。推送前依上一條的要求跑了：`npm run check` 2395 項通過；完整 `npm run verify:ui` **120 支全過、0 個 Console 錯誤**（包含 `9e9f617` 那三支剖面／眼睛／右鍵／資料夾重播）。
   - ② **「import 一律自帶副檔名」的全倉庫統一：不做。**帶副檔名的只有兩處——`apps/web/vite.config.ts`（Vite 的硬性要求）與 `tests/phase8/auto-close.test.ts`（跟著統一）；剩下 763 處／312 個檔案維持無副檔名。要重開這件事的時機：Vite 真的把 `configLoader` 改成 `native` 預設，或還有別的設定檔需要帶副檔名時；屆時單獨一版，不要混進功能提交。


## 9. 歷史存檔紀錄

- Phase 1、Phase 2 與藍圖的歷史紀錄：2026-10-10 歸檔。
- 2026-10-12 到 2026-10-19 的交付紀錄與舊 §0.0–0.2：2026-10-20 歸檔。

兩次都歸檔到 [docs/handoff-history.md](docs/handoff-history.md)，內容不改，只把指向另一台電腦的絕對路徑改成相對連結，並更正一處 ADR 編號（裝飾螺紋是 0156）。
