# ADR 0128：工程圖語言獨立於介面語言（工程圖 Schema 10 → 11）

- 狀態：**已完成**。
- 需求追溯：`docs/blueprint.md` **C16.1**（圖框與標題欄，ISO 7200）與 **C16.4**（尺寸公差）；延續 [ADR 0125](0125-drawing-surface-finish-and-one-sided-tolerance.md) 的單向極限（「最大」／`MAX`）。

## 背景

ADR 0125 讓 `toleranceText` 走 i18n：zh-TW 介面出圖寫「最大」，英文介面寫 `MAX`。但圖面上**所有**文字（公差用語、標題欄標籤、視圖名稱）都跟著介面語言跑——同一個 `.3dbd` 由兩個介面語言不同的人打開，匯出的圖會出現兩種文字。

工程圖不是給自己看的：圖離開程式、交到加工者手上，上面寫什麼必須是**圖面自己的選擇**，不能隨讀圖者的介面而變。原圖寫 `MAX`，若讀圖者介面是 zh-TW，出圖就會變成「最大」，與原圖不符——這在「依圖施工」的場合是實質錯誤。

## 決定

1. **工程圖 Schema 版本由 10 升至 11**。`DrawingSheet` 新增選用欄位 `language?: Locale`：**未設＝跟隨介面**（與舊圖行為一致，舊檔照讀、無需轉換，遷移 `10: (doc) => doc`）。舊程式讀新檔會被版本擋下，與過去升版一致。
2. **新增 `withLocale(language, fn)`**（`packages/i18n/src/index.ts`）：在**同步**建構期間把模組層級 locale 換成圖面語言，於 `finally` 還原；**刻意不通知監聽者**——換的是一次建構的語言，不是使用者的介面偏好，通知會讓介面跟著跳。
3. **`buildScene` 包一層**：以 `doc.sheet.language ?? getLocale()` 決定這張圖的語言，其餘（`evaluateDimension`／`autoDimensions`／`toDxf`／`toPdf`）全在建構內同步執行，故不會交錯。**不**把語言一路穿進九十餘個 `t()` 呼叫點。
   - 註：`packages/drawing` 內共 93 處 `t()`，其中 `dxfRead.ts`／`pdfRead.ts`（54 處）是**讀取器**而非出圖，不受影響；真正出圖文字約 20 處，全在 `buildScene` 的同步路徑上。
4. **指令 `setSheet`** 接受 `language?: Locale | null`：`null` 表示「回到跟隨介面」（把欄位拿掉），有值時必須在 `LOCALES` 內，否則拋 `drawing.badLanguage`。
5. **介面**：`DrawingPanel.tsx` 於「單位」列之後新增「圖面語言」下拉（跟隨介面／繁體中文／English）。
6. **i18n**：新增 `drawing.badLanguage`／`drawingUi.language`／`drawingUi.language.auto`，zh-TW 與 en 對齊；語言名稱沿用既有 `options.languageZh`／`options.languageEn`。

## 驗收成果

- `tests/phase5/drawing-layout.test.ts` 新增案例：`texts('zh-TW')` 含「比例」、`texts('en')` 含 `Scale`（標題欄標籤本身即證明預設生效，不必依賴某個尺寸的公差詞）；`null` 跟隨介面；在另一語言下建構後 `getLocale()` 不變（介面不受影響）。
- 因 Schema 10 → 11，既有硬編 `10` 的斷言全數改為 `DRAWING_SCHEMA_VERSION`（`drawing-angle`／`drawing-annotations`／`drawing-derived`／`drawing-dimensions`／`drawing-moved-tables`／`drawing-document`／`drawing-linked`／`phase7/flat-view`），並保留 `drawing-linked` 一處 literal `11` 作為版本哨兵；「未來版本」案例改用 `DRAWING_SCHEMA_VERSION + 1`。
- 閘門：`tests/phase5`（含新增案例）與 `packages/i18n/test` 全綠；`lint:rules`／`lint:deps`／`lint:i18n` 通過。
