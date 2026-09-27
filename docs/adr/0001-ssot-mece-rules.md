# ADR 0001：程式碼層的 SSOT/MECE 守則

- 狀態：已採用（Phase 0）
- 依據：開發藍圖 §2.9、附錄 A

## 決策

1. **一值一處**：設計意圖只存在 `@3db/model` 的 `PartDoc`；其他地方以 ID 或持久名稱引用。
2. **UI 不直接改文件**：所有修改都經過文件指令層（`Command` → `DocHistory.execute`）。UI、日後的腳本 API、錄製、協作共用同一路徑。
3. **衍生資料可重建**：B-Rep、網格、元素名稱、草圖解、DOF、物質特性、錯誤清單都由 `Regenerator.rebuild(doc)` 產生，永不寫回文件。重新計算是純函數：同一份文件永遠得到同一個結果。
4. **父子關係不另存**：`@3db/regen/dag` 從特徵內的參考即時推導。
5. **參考 = 持久名稱 + 幾何指紋**，禁止以拓撲索引引用（`Ref`）。
6. **分層只能向下**：由 `scripts/check-deps.mjs` 的 `ALLOWED` 表定義並強制（`npm run lint:deps`）。UI 主執行緒只能以 `import type` 使用 kernel/regen/sketch，OCCT 只在 Web Worker 執行。
7. **新功能先登記**：先在藍圖附錄 C 登記 ID 與擁有套件，再寫程式。

## 模組與目錄 ID 的擁有關係

| 套件 | 擁有的目錄 ID |
|---|---|
| `@3db/model` | B1、B5、B6、B7、B8、B9（資料） |
| `@3db/sketch` | A2、C1、C2 |
| `@3db/naming` | B4 |
| `@3db/kernel` | A1、A4.1、A5.2、E1（計算）、F1/F2 的轉檔機制 |
| `@3db/regen` | B2、B3 |
| `@3db/io` | F1、F2、F3、F4（檔案層） |
| `@3db/render` | A4.2、A5.1、D4 |
| `apps/web` | D1–D3、D5–D9（介面） |
