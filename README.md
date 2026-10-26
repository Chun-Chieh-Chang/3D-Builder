# 3D-Builder

類SolidWorks的參數式3D CAD：Web先行，另有共用前端的Windows Tauri桌面殼。設計意圖存在文件模型，B-Rep、網格與STEP由原生核心重建；參考以持久名稱連結。

目前交付、能力邊界與待辦見[產品現況](docs/project-state.md)。已有公開真實STEP與外部FreeCAD／DXF／PDF探針，仍不能據此宣稱SolidWorks特徵樹相容或製造認證。歷史階段通過數不代表目前版本全部驗證通過。

## 開始開發

在儲存庫根目錄執行，開發使用Node 26與npm：

```sh
npm ci
npm run doctor
npm run dev
```

預設Web位址`http://127.0.0.1:5391`。Windows、Linux與macOS的Web開發共用npm指令；工作區磁碟需支援連結，不搬移`node_modules`。完整步驟、跨平台差異、針對性測試與Windows桌面打包見[開發操作](docs/development.md)與[桌面README](apps/desktop/README.md)。

## 開發文件

| 需要的資訊 | 唯一入口 |
|---|---|
| 接手目前工作 | [handoff.md](handoff.md) |
| 已有功能／限制／待辦 | [產品現況](docs/project-state.md) |
| 文件責任與所有文件索引 | [文件導覽](docs/README.md)、[自動盤點](docs/repository-inventory.md) |
| 程式版本、工作區、npm指令、測試入口與依賴 | [從程式衍生的盤點](docs/repository-inventory.md) |
| 範圍與架構 | [藍圖](docs/blueprint.md)、[ADR](docs/adr/) |
| 驗證方法與實機操作 | [自動驗收](docs/automated-acceptance.md)、[手冊](docs/manual-verification.html) |
| 交付證據與失敗分析 | [DEV_LOG](DEV_LOG.md) |
| 工作守則與已知原生Heap限制 | [AGENTS](AGENTS.md) |

程式在`packages/`與`apps/`，驗收與資料在`tests/`，開發守門在`scripts/`，歷史技術探針在`spikes/`。套件相依的唯一准許表是[scripts/check-deps.mjs](scripts/check-deps.mjs)；完整工作區名稱由盤點產生。新Ribbon仍是[設計稿](docs/design/menu-redesign/preview.html)，正式介面保留圖示＋工具名稱。

## 驗證與文件同步

```sh
npm run typecheck
npm run lint:repo
npm test -- tests/phase5/drawing-hole-depth.test.ts
npm run build
npm run docs:sync
```

`npm run check`可執行完整核心檢查；使用者目前要求優先只跑新增／受影響案例，失敗只重試失敗項。UI驗收期間不改原始碼，詳開發操作。`docs:sync`只重建衍生盤點，`lint:repo`防止文件／Schema／指令清單漂移，不代替人工核對功能語意。

## 授權

本專案自己的程式碼目前未附LICENSE。第三方元件包含OCCT與PlaneGCS的LGPL義務及SolidCraft MIT圖示，見[第三方聲明](THIRD_PARTY_NOTICES.md)。鎖定版本與平台可選套件由盤點列出，不能將舊人工審閱的依賴數當成目前完整散佈認證。
