# Automated acceptance evidence

This project keeps two kinds of evidence separate:

| Verification need | Agent-run evidence | Remaining independent input |
|---|---|---|
| Public STEP samples and sheet-metal geometry | `npm run verify:external-samples`; SHA-256, import diagnostics, topology, mass properties, folded/flat volume and STEP round trip | A reviewed external CAD baseline only when equivalence with that CAD is required |
| PDF and DXF output | `tests/phase5/drawing-output.test.ts`, `tests/e2e/phase5-output.js`, and `npm run verify:drawing-export` (FreeCAD DXF import & Chromium PDF rendering) | A different CAD/PDF consumer if a named third-party compatibility target is required |
| UI commands and visual state | `npm run verify:ui` replays the workflows and checks application state, downloads and browser errors | Physical-device ergonomics and accessibility testing when those are requirements |
| Native SolidWorks feature history and analysis | None: `.sldprt` is not parsed by this repository | A reviewed SolidWorks export or a machine-readable measurement baseline with units and settings |
| Company standards and drafting wording | Parameterized tests can enforce a supplied table | The approved table, tolerance policy and terminology |

## External drawing export probe (DXF & PDF)

Run:

```powershell
npm run verify:drawing-export
```

To retain the evidence as JSON, choose an absolute output path:

```powershell
$env:DRAWING_ACCEPTANCE_REPORT = 'D:\reports\drawing-acceptance.json'
npm run verify:drawing-export
```

Optionally override the FreeCAD executable or Chromium binary:

```powershell
$env:FREECAD_CMD = 'C:\Program Files\FreeCAD 26.3\bin\FreeCADCmd.exe'
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run verify:drawing-export
```

This probe establishes verifiable external consumer facts for representative production drawings (`凸緣襯套加工圖` and `壓花旋鈕銷加工圖`):
- **FreeCAD DXF Import**: runs FreeCAD command-line to import the generated DXF, verifying that FreeCAD creates 100+ native geometry objects, preserves required ISO layers (`VISIBLE`, `HIDDEN`, `CENTER`, `THIN`, `FRAME`, `DIMENSION`, `TEXT`), and validates that the drawing boundary geometry adheres strictly to ISO A3 margin boundaries (`20..410 mm` along X, `10..287 mm` along Y).
- **Chromium PDF Rendering**: runs headless Chromium via Chrome DevTools Protocol (CDP) to load the generated PDF in the built-in PDF reader, confirming `contentType === 'application/pdf'` and non-empty rendering without renderer crash.

## External sheet-metal probe

Run:

```powershell
npm run verify:external-samples
```

To retain the evidence as JSON, choose an absolute output path:

```powershell
$env:SHEET_METAL_ACCEPTANCE_REPORT = 'D:\reports\sheet-metal-acceptance.json'
npm run verify:external-samples
```

The report is deliberately limited to facts the agent can establish: fixture identity, importer diagnostics, topology counts, mass properties and STEP round-trip differences. It does not assert SolidWorks equivalence or manufacturing acceptability.

### FreeCAD command-line check

When FreeCAD is installed, an agent can also check that application reads the same two public STEP files:

```powershell
$env:FREECAD_CMD = 'C:\Program Files\FreeCAD 26.3\bin\FreeCADCmd.exe'
$env:FREECAD_ACCEPTANCE_REPORT = 'D:\reports\freecad-sheet-metal-acceptance.json'
npm run verify:freecad-sheet-metal
```

This command requires an absolute executable path and writes an absolute JSON report. It checks that both files load to solids with positive volume, then compares their material volumes. FreeCAD currently uses OCCT too, so this is an external-application import check rather than independent-kernel validation.

## 孔／裝飾螺紋標註的外部驗收（2026-10-23）

### 三項延伸（ADR 0185）

目前已實作圖紙樣式預設、側視螺紋引線及模型公差等級。新增的 4 種模型為側視外螺紋、側視內螺紋、側視攻牙孔、繼承圖紙預設的沉頭孔，中英文 × 文字／符號，共 **16 組**。全部製造值、外部讀取及 FreeCAD 幾何檢查通過；20 份 PDF（含缺字回退）由兩套讀取器比對，DXF/PDF 渲染皆已目視。

```bash
CALLOUT_EXTENSIONS=1 CALLOUT_ACCEPTANCE_OUT=out/thread-extensions npx --no-install vitest run --config tests/acceptance/vitest.callouts.config.ts
/usr/bin/python3 /workspace/.cloud-setup/freecad-run.py scripts/freecad-callout-report.py out/thread-extensions
python scripts/check-callout-exports.py out/thread-extensions --extensions
python scripts/render-callout-dxf.py out/thread-extensions
# 使用新啟動的開發伺服器，避免沿用舊 worker 的轉譯快取。
VERIFY_UI_ORIGIN=http://127.0.0.1:5397 CHROME_PATH=/workspace/.cloud-setup/chromium npm run verify:ui -- --only 'manual-thread-extensions' --json out/thread-extensions/ui.json
```

側視引線在 DXF 中輸出普通線與 TEXT，檢查器嚴格要求該類案例 **0 個 DIMENSION**，並從 VISIBLE/HIDDEN 輪廓量測間距來核對直徑；其他案例仍要求 1 個正確 DIMENSION。公差必須與模型的標準、內／外類型相符，不由圖紙自行發明。這些公差是規格註記，未新增極限尺寸求值。

對應日常單元測試 `tests/phase5/drawing-thread-extensions.test.ts` 的 6 項均有通過結果，另有原有相關測試 10 項；瀏覽器 1/1。依使用者限制採新功能／相關案例及失敗重試，沒有重跑完整套件。

FreeCAD 與 ezdxf Unicode／字型適配邊界仍同下節；未宣稱 AutoCAD/SHX 認證。舊驗證報告的「尚未實作」是當時狀態，以本節及 ADR 0185 的新驗證為準。

### 先前盲孔深度修正

**修正後的定向重驗**：依使用者要求，只重跑盲孔沉頭與盲孔錐孔，共 8 組。
`holeInfo` 補入實際入口沉頭圓柱／錐段的軸向長度，總深分別恢復 15 與 12。
數值、DXF/PDF 讀取、FreeCAD 幾何均 **8/8**；日常回歸測試 **2/2**，型別通過。
前次報告留存，沒有重跑原先通過的其他 6 個模型。重跑命令：

```bash
CALLOUT_ACCEPTANCE_OUT=out/callout-depth-recheck npx --no-install vitest run --config tests/acceptance/vitest.callouts.config.ts -t '^(counterbore|blind-countersink):'
npx --no-install vitest run tests/phase5/drawing-hole-depth.test.ts
/usr/bin/python3 /workspace/.cloud-setup/freecad-run.py scripts/freecad-callout-report.py out/callout-depth-recheck
python scripts/check-callout-exports.py out/callout-depth-recheck --failed-depth-only
python scripts/render-callout-dxf.py out/callout-depth-recheck
```

`--failed-depth-only` 嚴格要求這 8 個具名組合完整存在，不是接受任意數量的樣本。
外部 DXF 渲染另外需要 Inkscape：ezdxf TEXT frontend 不會自行解碼 R2000 Unicode escape，腳本用該庫公開的 decoder 處理記憶體中的文字，並註冊 Noto Sans TC 字型（需以檔名引用，完整路徑會讓該庫回退到系統字型）。不改寫來源 DXF，也不宣稱這等同未經適配的 AutoCAD/SHX 原生渲染。
`render-callout-dxf.py <資料夾> <樣本 ID>...` 可只重畫指定的失敗圖，聯絡表沿用其他已成功圖片；本輪中文文字模式的 2 份缺字圖就是這樣重驗。
8 份 DXF 與 PDF 聯絡表均已目視確認；10 份 PDF 已由 MuPDF 與 Poppler 比對。成果在 `out/callout-depth-recheck/`。

以下為**修正前的完整驗證流程與歷史失敗結果**：

這組探針從真實模型再生、投影與 `elementFacts` 建立圖紙，不以假的孔資料替代幾何。
涵蓋 8 個模型 × 中英文 × 文字／符號，共 32 組；另產生 8 份缺字型回退 PDF。
輸出包含原始零件、圖紙、SVG、DXF、PDF 與 manifest，預設寫入 git 忽略的 `out/callout-acceptance/`。

```bash
# 需已安裝專案依賴、核心 WASM、Noto Sans TC 與包含 ↧⌴⌵ 的 OSI font。
# 字型位置可用 CALLOUT_CJK_FONT、CALLOUT_SYMBOL_FONT 指定。
npx --no-install vitest run --config tests/acceptance/vitest.callouts.config.ts
# 外部讀取器依賴：ezdxf、PyMuPDF、Pillow，以及 Poppler 的 pdftotext。
python scripts/check-callout-exports.py
```

產生器與外部檢查器**都會在加工數值錯誤時回傳非零**，但仍留下全部檔案與報告供追查。
不可因產生器失敗而省略外部檢查，也不可將實際錯值改成預期值。
外部檢查分開記錄：DXF audit、DIMENSION 覆寫與繪圖 block 的文字、直徑；PDF 的文字、A3 尺寸、文字邊界、文字互相重疊、實際點陣墨跡；Poppler 再讀一次文字。
`pdf-contact-sheet.png` 用於人工確認符號與回退字串；墨跡存在本身不能證明字形正確，文字不重疊也不能證明沒有與模型線條重疊。

FreeCAD 幾何探針另用 `scripts/freecad-callout-report.py <輸出資料夾>`。本次 Linux 系統的 `freecadcmd` 在啟動時崩潰，因此實際使用系統 Python 載入 FreeCAD 1.0，搭配官方 legacy DXF importer：

- 附加 Python 路徑：`/usr/lib/freecad-python3/lib`、`/usr/share/freecad/Ext`、`/usr/share/freecad/Mod` 下的各模組目錄。
- 官方套件來源：<https://github.com/yorikvanhavre/Draft-dxf-importer>，固定提交 `e060ef0d8fe7143c2e0ce34734b686ba073f3cc1`，將其目錄加入 Python 路徑。
- `FreeCAD.ParamGet('User parameter:BaseApp/Preferences/Mod/Draft')` 設 `dxfUseLegacyImporter=True` 與 `dxftext=True`，再執行探針。這是系統提供的匯入模式，不需改產品或系統 FreeCAD 程式碼。
- 目前環境可重跑：`/usr/bin/python3 /workspace/.cloud-setup/freecad-run.py scripts/freecad-callout-report.py out/callout-acceptance`，接著重跑 `check-callout-exports.py` 納入結果；JSON 以來源 SHA-256 防止誤用舊結果。

**結果**：DXF/PDF 外部讀取檢查 32/32；40 份 PDF 由兩套讀取器比對，FreeCAD 幾何 32/32；加工標註僅 24/32。
盲孔沉頭（總深 15、沉頭深 8）誤標總深 7；盲孔錐孔（總深 12、Ø6→Ø12、90°）誤標總深 9。
原因是取了縮徑後直圓柱的長度；中英文與兩種樣式均受影響。原始失敗報告留存於 `out/callout-acceptance/`；後續修正與定向重驗見本節開頭。

FreeCAD 此無介面模式不保留尺寸覆寫文字，不能據其匯入成功宣稱標註排版正確。
沒有 AutoCAD／SHX、實體列印的驗證；目前只測 mm、正視圖。全圖樣式預設、側視獨立螺紋引線、公差等級欄位尚未實作，不列為通過。

## Adding an independent baseline

Add the source file hash and the following metadata beside any baseline before writing a comparison assertion:

- exporting application and version;
- source units, sheet thickness, bend radius and K-factor;
- export settings;
- measured dimensions or a separately exported neutral format;
- reviewer and review date.

Tests must fail on a missing baseline. They must not substitute a zero value or derive their expected result from the same implementation being tested.
