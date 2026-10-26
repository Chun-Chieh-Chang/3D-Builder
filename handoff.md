# 交接與接續工作

更新日期：2026-10-26。接手先讀本檔、[產品現況](docs/project-state.md)與[AGENTS](AGENTS.md)，再看`git status --short --branch`、`git log -5 --oneline`。保留現有修改，乾淨時才`git pull --ff-only origin main`。

## 本批工作

全面清理已提交`9c78d31`。接續依使用者指定1→2→3：右鍵兩項舊失敗已處理並驗真實移動；三平台CI由使用者確認通過（代理無法讀遠端log）；螺紋導角有原生與持久參照探針、可重現的多邊限制及已驗替代工序，但原模型「任何選取都失敗」仍未定位，需原始3dbx與完整錯誤。詳見[產品現況](docs/project-state.md)與[DEV_LOG](DEV_LOG.md)，不能把替代流程當原問題已修好。

最近功能基準是`6c5e176`：右鍵網格與系統選項同步、點標籤能切換、組合件設定入口、三基準面顯示矩形共自身原點；前面`abe4b07`修正網格與模型深度，`4f01344`加入參數浮窗與動態拉伸。這些是功能基準，不是永遠的HEAD。

## 現況與下一步

- 目前能力、限制和未完成項只在[產品現況](docs/project-state.md)維護，不在本檔再抄一份版本／通過數。
- [自動盤點](docs/repository-inventory.md)由程式／設定衍生；UI腳本數不代表本版全量通過。
- 影片需求仍缺可讀內容；桌面ChatGPT／捷徑支線使用者已取消，不繼續，也沒有操作使用者Windows的權限。
- 新Ribbon仍為設計稿；螺紋邊原模型重現與外部製造驗收需求見產品現況，右鍵舊失敗已處理；新增CI測試清單的提交仍需看該輪遠端結果。
- 無法讀取帳戶剩餘額度百分比，不能保證精準在3%觸發；交付與中斷前主動更新本檔。

## 0. 換電腦

依[開發操作](docs/development.md)。本機使用者模型／客戶樣本、忽略的證據目錄、Rust工具鏈及browser資料不是Git的一部分。不要搬`node_modules`，不要把雲端路徑硬編到使用者電腦。

## 1. 專案

功能現況見[產品現況](docs/project-state.md)；程式Schema／工作區／npm指令見[衍生盤點](docs/repository-inventory.md)。

## 2. 文件地圖

見[文件導覽](docs/README.md)及[完整分類索引](docs/repository-inventory.md)。本地沒有wiki；遠端API回403、wiki Git查詢未取得可存取倉庫，未修改或宣稱同步遠端wiki。

## 3. 各階段的狀態紀錄

目前交付與驗收限制見[產品現況](docs/project-state.md)，歷史見[舊交接](docs/archive/handoff-through-2026-10-26.md)與[更早封存](docs/handoff-history.md)。舊Schema與當時通過數保留日期，不覆寫成今天。

## 4. 如何執行

見[開發操作](docs/development.md)。使用者偏好只測新增／受影響項，失敗只重試失敗項；不得改門檻掩蓋。UI驗收期間不修改原始碼。

## 5. 架構速覽

[藍圖](docs/blueprint.md)維護範圍，[ADR0001](docs/adr/0001-ssot-mece-rules.md)維護模組原則；依賴准許表只在[scripts/check-deps.mjs](scripts/check-deps.mjs)，不要另寫第二份手工相依表。

## 6. 已知陷阱

產品缺口見[產品現況](docs/project-state.md)，環境／跨平台／驗證陷阱見[開發操作](docs/development.md)，原生Heap限制與紅隊規則見[AGENTS](AGENTS.md)。

## 7. 與使用者的工作約定

繁體中文、圖示保留工具名稱；一次一條工作線，不覆寫其他修改。使用者明確的本次指示優先於歷史計畫／舊代理約定。提交作者與權限依目前實際工作階段，不冒用舊模型署名。不要擅自傳訊、動使用者本機資料或把歷史批准當新外部行動。

## 8. 使用者的待辦

影片內容、私有失敗模型、特定外部CAD／製造基準與本機驗收確認，見[產品現況](docs/project-state.md)。雲端通過不代表Windows已拉取或實機已驗收。

## 9. 歷史存檔紀錄

- [本輪清理前完整交接](docs/archive/handoff-through-2026-10-26.md)
- [先前交接歷史](docs/handoff-history.md)
- [歷史清理紀錄](docs/archive/cleanup-through-2026-10-20.md)
- [交付與RCA歷史](DEV_LOG.md)
