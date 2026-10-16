# ADR 0150：標題欄的文字樣式——欄位名稱、數值與標題的字高，以及超出儲存格時自動縮小

- 狀態：**已完成（2026-10-16）**，同日收尾（決定 8／9：不合法先擋並寫原因、被拒絕的框填回實畫值）。**工程圖 Schema 19 → 20**（新增選填的 `sheet.titleStyle`，無需轉換）。
- 需求追溯：使用者在 [ADR 0146](0146-drawing-sw-parity-six.md) 的尺寸樣式之後，以一張 A4「C.3 檢具」工程圖追問「工程圖中這些預設的字體、大小或箭頭參數能否編輯」。調查（2026-10-16）：箭頭與尺寸字高已可由 ADR 0146 調整；標題欄的三個字高寫死在 `sheetItems`；字體家族不可選。使用者核准新增標題欄文字樣式，並指定**連「欄位名稱字高」與「水平自動縮放」一起做**。藍圖外功能，比照慣例以 ADR 追溯（工程圖路線圖見 [ADR 0129](0129-drawing-interaction-roadmap.md)）。
- 範圍裁定：本 ADR 只做**字高與縮放**；**字體家族仍固定**（畫面與 SVG 為 sans-serif，PDF 為 Helvetica＋選配的「PDF 字型」補字，DXF 為 STANDARD 文字型式），要可選字型另案。

## 背景（查明的現況）

| 項目 | 現況 |
|---|---|
| 標題欄文字 | `sheetItems` 寫死：欄位名稱 2.2 mm（基線在格頂下 3 mm）、數值 3.5 mm（基線 y+2.2）、標題大字 6 mm（基線 y+3.5） |
| 版面 | ISO 7200 固定：180×48 mm，四列高 10／16／11／11，11 個儲存格（`titleCells`） |
| 輸出 | SVG `font-size＝height×1.4`、PDF `size＝height/cap`、DXF TEXT 群組碼 40——三者都直接吃 `SceneText.height`，**輸出端不需要改** |
| 溢出 | 文字比儲存格寬就照畫、蓋過隔壁格，從不縮小，也沒有量測可用（尺寸線只有 `length×height×0.62` 的粗估） |

## 決定

1. **`TitleStyle`**（`sheet.titleStyle`，選填）：`label`（欄位名稱字高）、`value`（數值字高）、`title`（標題大字字高）、`fit`（超出儲存格時自動縮小）。預設 `TITLE_STYLE_DEFAULT = { label: 2.2, value: 3.5, title: 6, fit: true }`，`resolveTitleStyle` 合成；`null` 或空物件＝沒有樣式（回到預設），與 ADR 0146 的 `dimStyle` 語意一致。
2. **範圍由格幾何推導**（mm）：`label 2–5`、`value 2–5`、`title 3–9.5`，另加**合計規則**——名稱懸在格頂下 0.8 mm、數值基線 y+2.2、標題基線 y+3.5，所以在最窄的 10 mm 公司列不重疊要 `label + value ≤ 7`，16 mm 標題列要 `label + title ≤ 11.7`。每欄的上限都取到「搭配另一欄下限」仍可達，不留碰不到的死上限。超出、非數字、`fit` 不是布林、未知欄位一律 `CommandError` 拒絕並說明，**不四捨五入、不夾到範圍內**（AGENTS.md §2.1）。
3. **名稱改為頂對齊**：基線 = `y + h − 0.8 − label`。預設 2.2 mm 時即舊式的 `y + h − 3`，**舊圖面逐位元不變**；名稱變高時向格內長，不會頂出框線。
4. **水平自動縮放**（`fit`，預設開）：`textWidthMm(text, height)` 以 Helvetica 的 AFM 真度量逐字累加，標準字型沒有的字元（CJK 等）以 1 em 全形計——與 PDF 排版同一個來源，因此**圖面上放得下的，PDF 也放得下**。文字寬 > 格寬 − 3（左內縮 2、右留 1）時等比縮小到剛好放得下；**只縮不放大**；封底 `TITLE_FIT_MIN = 1.8` mm，仍放不下就照 1.8 溢出。關掉 `fit` 即維持舊行為（照字高溢出）。
   - **行為變更（誠實記載）**：`fit` 預設為開，今天會溢出格子的標題欄文字（例如 4.5 mm 的日期在 30 mm 格）在新版會被縮小；今天放得下的文字完全不變。
5. **輸出零改動**：字高寫進 `SceneText.height` 後，SVG 的 `font-size`、DXF 的群組碼 40、PDF 的 `Tf` 大小自動跟隨；三份輸出一致（同一個 scene）。
6. **Schema 19 → 20**：新欄位選填、無須轉換（遷移表 `19: doc => doc`）；版本的作用仍是讓舊程式不開它看不懂的文件（舊版會把會溢出的標題欄照舊畫出去）。
7. **介面**：圖頁屬性「格式」群組（標題欄內容之下）加「欄位名稱字高／數值字高／標題字高」三個數字框、「超出儲存格時自動縮小」勾選（提示寫明各欄範圍）與「恢復預設」（`TitleStyleFields`，比照 `DimStyleFields`）。
8. **面板先問同一條規則**（同日的收尾，使用者裁定「兩件都做」的第一件）：`TitleStyleFields` 把要送的值交给 `titleStyleProblem`——命令層用的同一個檢查，拆成不丟擲、回「為什麼不行」或 null——不合法就**不送出**，框標紅（`invalid`／`aria-invalid`）並在該列下方寫出原因（與命令拒絕時同一句訊息，不是另編一套）。範圍與合計都從模型層的 `TITLE_STYLE_LIMITS`／`TITLE_STYLE_SUM_LIMITS` 推導，面板沒有第二份寫死的數字。
9. **送出去但被拒絕時，框填回實畫的值**（第二件）：`NumberBox` 在送出時記住送前的值，下一個渲染若文件的值仍是那個值（代表命令拒絕），就把框填回去。這是共用元件，自 ADR 0146 起 23 處呼叫端（尺寸、引線標注、公差、樣式群組…）一起受益，**呼叫端一行沒改**；`onCommit` 的「火后不問」語意不需要改成可回報。命令層照舊是唯一的裁判：該拒仍拒、不四捨五入、不夾範圍（§2.1）。

## 驗收

| 標準 | 結果 |
|---|---|
| A1：沒有 `titleStyle` 時，每個儲存格的名稱在 `y + h − 3`、2.2 mm，數值 3.5／標題 6——與今日逐位元一致 | `drawing-title-style.test.ts`「the title block as it has always been drawn」 |
| A2：設字高後**由實際畫出的文字量測**等於設定；名稱維持格頂下 0.8 mm | 同上「the heights drawn are the style's」；`null`／空物件回到預設 |
| A3：長文縮小量＝溢出比例，縮後以同一量測放得下；短文不放大；`fit:false` 照舊溢出；封底 1.8 mm | 「a text too wide for its cell」三項 |
| A4：範圍外、NaN、∞、字串、`fit` 非布林、未知欄位、**合計超標但單欄合法**皆拒絕；範圍邊界與合計邊界允許 | 「what the style refuses」兩項 |
| A5：200 組隨機（樣式 × 文字，含 CJK 與 40 個 `M`）：至多等於設定、放得下、縮小量正確 | fuzz 測試（拒絕的抽樣重抽，湊滿 200 組） |
| A6：SVG `font-size`、DXF TEXT 40、PDF `Tf` 都帶著畫出的字高 | 「the outputs draw it」 |
| A7：存檔往返保留 `titleStyle`；v19 檔讀入沒有它且升到 v20 | 「the file keeps it」 |
| 反向對照 | 把 `fit` 的封底拿掉（`Math.max` 改回原式）A3 第三項失敗；把名稱基線改回 `y + h − 3`（不減字高）A2 失敗；還原後全過 |
| typecheck、lint、phase5、全量 | 本改動檔案 typecheck 0 錯誤（當時全repo `npm run typecheck` EXIT=1，2 個 TS2345 都在另一階段未追蹤的 `tests/phase3/step-frag-probe.test.ts`，非本改動；該檔其後由另一階段自行修好，同日 e2e 完成後再跑為 **EXIT=0**，`npm run check` 不再卡在 typecheck）；lint:rules／deps／i18n 各 EXIT=0；phase5 單獨跑 419 過、1 略過（既有 D1）、0 失敗；全量 vitest 2887 過、27 略過、1 失敗，那 1 項即上述別人的探針檔（`Kernel.deleteFaces` 拒絕），本 ADR 的 `drawing-title-style.test.ts` 11 項在同一次全量跑全綠；三處「目前版本 19」錨定斷言隨版本更新為 20 |
| e2e 實機：`tests/e2e/manual-drawing-title-style.js`（9 步） | 走真實的「檔案→新工程圖」（harness 以 OPFS 專案資料夾取代選檔對話框）與圖頁屬性「格式」面板的輸入框；斷言讀自畫面——字高取自場景、SVG `font-size` 等於字高的 1.4 倍、縮放與否以**瀏覽器自己量的排版寬**（`getBBox().width`，圖面 viewBox 即公釐）對照格子預算 `w − 3`；日期縮到 3.79077 mm 後排版寬 27.03 mm 對 27 mm（+0.1%）、關掉 `fit` 變 34.22 mm 確實溢出、19 個全形字標題縮到 3.6656 mm 後 97.48 mm 對 97 mm（+0.49%，在格子自留的 1 mm 餘量內）。`npm run verify:ui -- --only manual-drawing-title-style` → **KNOWN、6.9s、VUI_EXIT=0**，9 步全過並記載下方已知缺陷（該缺陷同日修好，腳本長到 11 步、分級轉為 PASS，見下一節） |

**已知缺陷（同日已修，見決定 8／9）**：原先提交被拒絕後，`NumberBox` 留住使用者打的數字（輸入框顯示 4 mm 而實畫仍是 2.2 mm）——文件與圖面不受影響，但框與實畫不一致；這是 ADR 0146 起每一欄共有的元件行為，当时的 e2e 以 runner 的 `knownIssue` 機制每次執行都列出來。使用者裁定「兩件都做」後：標題欄三欄由面板先問同一條規則（不合法不送出、標紅、寫原因），其餘每一欄由共用元件在命令拒絕後把框填回實畫值。

## 驗收（收尾）

| 標準 | 結果 |
|---|---|
| 面板先問同一條規則：打 4 mm 的名稱被擋住、框標紅、原因列寫在同一格下方的獨立一列，文件與圖面不動，且**不產生 toast**（命令根本沒被呼叫） | e2e 步 3：`invalid`＋`aria-invalid`＋computed 邊框／底色與旁邊乾淨的框不同（`oklch(0.5 0.16 27)`／`oklch(0.97 0.022 27)` 對 `oklch(0.84 0.021 172)`／`oklch(1 0 0)`）、原因文字含「欄位名稱字高」與「合計」、`notice === null`、名稱仍畫 2.2、文件仍是 `{title:9.5}` |
| 邊界照樣放行：與 9.5 mm 標題合計正好 11.7 的名稱 2.2 合法；2.3（合計 11.8，只超 0.1）擋下；改回 2.2 後紅框與原因一起消失 | e2e 步 3b |
| 沒有本地守門的欄位被命令拒絕時，框填回實畫值 | e2e 步 8：圖頁「尺寸樣式」文字高度送 0 → 拒絕並 `notice.kind === 'error'`，框回到送之前的數字，文件的 `dimStyle` 未多出 `text` |
| 「恢復預設」後三个框分别说 2.2／3.5／6（不再只是記錄，而是斷言） | e2e 步 7 |
| 反向對照（實際跑過，非宣稱） | 把 CSS 規則的特異性從 `.sw-panel .pm-row input.invalid` 退回 `.pm-row input.invalid`（會被後面 `.sw-panel input:not([type=checkbox])` 的 `border` 速寫蓋掉，紅框實際上看不見）→ 步 3 紅：髒框與乾淨框讀到同一個邊框色；還原後 2 支 e2e 全過。這是這一輪真實踩到的 bug：只量 `classList` 會假綠，量 computed 色才抓得住 |
| 排版（面板只有 284 mm 寬的畫面） | runner 的頁面把群組以 `hidden` 存在 DOM 裡（`DrawingPanel.tsx:174` 的既有設計，讓腳本永遠 reach 得到），所以 rect 全 0、幾何不放在 e2e 断言裡；改為在看得見的頁面把該群組的 `hidden` 解掉後量：原因列另佔一列（x 19、寬 246、高 48＝兩行）、stay 在該列內、不超出面板，框 148×26 仍在原位 |
| typecheck、lint、phase5、相鄰 e2e | 全repo `npm run typecheck` **EXIT=0**；`lint:i18n`（181 行文字、14 檔）／`lint:deps`／`lint:rules` 各 **EXIT=0**；`tests/phase5` 全目錄 **39 檔 419 過、1 略過（既有 D1）、0 失敗**；`verify:ui --only "manual-drawing-title-style\|manual-drawing-sw-parity"` → **2 of 2 pass、0 KNOWN、VUI_EXIT=0**（7.2s／14.7s）；`drawing-title-style.test.ts` 11 項全過，證明命令層的拒絕訊息逐字没變 |

## 紅隊四問（AGENTS.md §2）

1. **輸入破壞**：NaN、∞、負數、0、字串、未知欄位、`fit` 非布林全部在命令層拋 `CommandError` 並說明；不 `Math.round`、不夾範圍。合計規則用**合成後的生效值**檢查，部分欄位的送法（缺的欄用預設）也擋得住。
2. **幾何相交破壞**：兩個文字在同一格的垂直重疊是這個功能的「自相交」——以合計規則在前置階段攔截（由 10／16 mm 列的基線推導），不讓它畫出來才发现。水平溢出由 `fit` 處理，且封底後允許溢出（明確行為，不是默默吞掉）。
3. **依賴鏈**：`DrawingSheet.titleStyle`（model）→ `setSheet` 命令型別與 reducer → `serialize` v20 → `resolveTitleStyle` → `sheetItems`（scene）→ SVG／PDF／DXF（吃 `SceneText.height`，未改）→ `TitleStyleFields`（UI）→ i18n 中／英 → 測試。
4. **零 Mock**：斷言一律量測**畫出來的高度**（scene 文字項、SVG `font-size`、DXF 群組碼 40、PDF `Tf`），不讀回送進去的設定；縮放正確性用與 PDF 相同的 `textWidthMm` 反算實測寬度；無 WASM 新路徑，§3.5 記憶體議題不適用（純 JS 場景產生）。
