# 3D Builder (Powered by SkillsBuilder)

3D Builder 是一個基於 Web 的新世代參數化 3D CAD 建模工具，旨在提供工業級的草圖約束引擎與三維幾何構建能力，並透過 Electron 封裝成本地端應用程式。

本專案底層採用了 **Graph-driven Development (圖論驅動)** 架構，並具備即時響應的 **Position-Based Dynamics (PBD)** 約束求解器。開發過程全程受到 [SkillsBuilder](https://github.com/Chun-Chieh-Chang) 智慧開發系統的護航，遵循嚴格的 PDCA 循環與防迴歸確效紀律。

---

## 🎯 核心功能 (Core Features)

### 1. Graph-based 2D 草圖引擎 (Sketcher)
- 拋棄傳統的依賴陣列，改用原生的圖論結構 (`SketchNode` 與 `SketchEdge`)。
- 內建 **PBD (Position-Based Dynamics) 約束求解器**，支援即時的水平、垂直、共點、等長等約束條件解算，畫面零延遲回饋。
- **Hit-Testing**: 精準的滑鼠選取與懸浮高亮，並具備不可見的粗體選取框 (Hitbox) 以提升 UX。

### 2. 極致的使用者介面 (Premium UI/UX)
- 採用 **Sea Salt Blue** 品牌色系。
- 高質感的毛玻璃效果 (Glassmorphism) 參數面板 `<SketchPropertyManager />`，在淺色與深色模式下皆展現無可挑剔的對比與視覺層次。

### 3. IPC 與後端架構 (Electron + PythonOCC)
- **Frontend**: Next.js 14, Zustand, TailwindCSS, React Three Fiber.
- **Backend**: PythonOCC (基於 OpenCASCADE) 提供工業級的 3D 布林運算、圓角、抽殼能力。
- **通訊**: 透過 Electron 的 `contextBridge` 進行高效率的 JSON 幾何指令傳遞，將前台的 2D 閉環草圖發送至後台進行 3D 擠出與渲染。

---

## 🧠 AI Agentic Capabilities (Integrated SkillsBuilder)

本專案已深度整合 **SkillsBuilder** 全明星技能庫，為 AI 助理提供以下增益：

- **193+ 專家角色 (Personas)**: 位於 `raw/external/agency-agents-zh/`，涵蓋工程、設計、財務等全領域專家引導。
- **ClawHub 技能庫**: 內建 `tavily` (研究)、`gitnexus` (代碼圖譜)、`last30days` (趨勢) 等 15+ 項工業級 AI 技能。
- **Gemini & Claude 擴充**: 支援 `gemini-extension.json` 與 `.claude-plugin`，實現 IDE 原生插件級別的開發體驗。
- **Nexus 協作協議**: 遵循 `wiki/concepts/nexus-protocols.md` 進行標準化的 AI 任務交接。

---

## 🚀 系統架構與文件 (Documentation)

專案遵循嚴格的 **MECE (相互獨立、完全窮盡)** 原則進行文檔歸檔：

- [系統架構總覽 (SYSTEM_DESIGN.md)](docs/architecture/SYSTEM_DESIGN.md)
- [PBD 約束引擎規格 (constraint_solver_spec.md)](docs/constraint_solver_spec.md)
- [開發日誌與錯誤追蹤 (DEV_LOG.md)](DEV_LOG.md)
- [AI 交接與續寫指南 (handover_resume_guide.md)](handover_resume_guide.md)
- [長期功能路線圖 (SOLIDWORKS_FEATURE_ROADMAP.md)](SOLIDWORKS_FEATURE_ROADMAP.md)

---

## 🛠️ 開發與建置 (Development)

啟動開發伺服器：
```bash
npm install
npm run dev
```

嚴格型別檢查 (推送前必做)：
```bash
npx tsc --noEmit
```

## 📜 許可證
MIT License
