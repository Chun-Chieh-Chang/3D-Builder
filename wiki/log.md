# Project Changelog & Milestones

This log documents the chronological progress, architectural decisions, and version changes of the **3D-Builder** project, now integrated with the **SkillsBuilder** engine.

---

## [2026-05-23] 智能工作流與 SolidWorks 邏輯對標 🧠
*   **上下文感知起草 (Context-Aware Sketching)**：
    - 實作了 SolidWorks 核心邏輯：當使用者選取實體表面時點擊「草圖」或「伸長」工具，系統會自動在該面上開啟草圖模式，而非死板地回到前基準面。
    - 整合了自動相機正視 (Normal To) 動畫，確保起草體驗流暢。
*   **數據鏈完整性強化**：修正了 Ribbon Tab 與特徵工具間的連動邏輯，確保從「特徵」模式無縫過度到「草圖」模式，數據狀態實時同步。
*   **介面按鈕功能激活**：清理並激活了「伸長-實體」、「伸長-除料」等按鈕的智能引導功能。

## [2026-05-23] 參數化互動與 SolidWorks 體驗對標 🛠️
*   **尺寸標註互動強化**：
    - 點擊尺寸標籤會觸發高亮（桃紅色 #ec4899），並在左側 `SketchPropertyManager` 同步顯示屬性面板。
    - 支持雙擊尺寸標籤直接在視埠中彈出編輯輸入框，實時驅動幾何變形。
*   **屬性管理器 (PropertyManager) 聯動**：實作了選取點、線、尺寸時的屬性回饋。選取尺寸時，側邊欄會顯示參數修改欄位，實現「雙向參數編輯」。
*   **全域選取反映**：所有草圖元素（點、線、圓、尺寸）在被點擊時都會有明顯的視覺反映（選取色、線寬加粗），完全符合 SolidWorks 的互動直覺。

## [2026-05-23] UI 視覺細緻化 (Visual Refinement) 🎨
*   **線條與點位細化**：將草圖線段寬度從 3.0 縮減至 1.5，草圖點半徑從 0.4 縮減至 0.2，並同步縮小幾何約束圖示。
*   **特徵輪廓優化**：將 3D 特徵的邊緣高亮線條細化，提升空間感，解決原先 UI「龐大/粗糙」的視覺問題，全面對標 SolidWorks 專業美學。
*   **UX 保留**：在縮減視覺寬度的同時，保留了寬大的隱形點擊區域 (Hitbox)，確保操作靈敏度不打折。

## [2026-05-23] 零件建構模擬與流程驗證 (L-Bracket) ✅
*   **端到端建模驗證**：成功模擬使用者從「前基準面」起草、建立「L型基座特徵」，再到「特徵表面起草」建立「除料孔」的完整 CAD 工作流。
*   **參數化測試**：驗證了 `3D-BUILDER-PARAMETRIC-SCHEMA` 能完整保存包含多重特徵與嵌套草圖的零件數據。
*   **PDCA 實踐**：透過 [L-Bracket.sldprt.md](file:///c:/Users/3kids/Downloads/3D-Builder/L-Bracket.sldprt.md) 輸出的規格與計畫，確認了目前介面與核心引擎的整合可靠度。

## [2026-05-23] 全域狀態列 (Global Status Bar) 與定義反饋 🚀
*   **全域狀態列 (StatusBar)**：實作視窗底部的狀態列，整合「操作提示 (Hint)」、「座標即時顯示 (Mouse XYZ)」與「單位系統 (MMGS)」。
*   **草圖定義狀態回饋**：即時分析並顯示草圖狀態（欠定義 Under Defined / 完全定義 Fully Defined / 過度定義 Over Defined），對標 SolidWorks 核心工作流。
*   **座標即時捕捉**：透過 3D 視埠中的 MouseTracker，實現滑鼠在當前工作平面上的精確座標顯示。
*   **引導式 UI**：根據當前選取的工具（直線、圓、量測等）動態顯示操作說明，降低學習曲線。

## [2026-05-23] UI/UX 深度對標 SolidWorks 升級 🎨
*   **前景視圖工具欄 (Heads-up View Toolbar)**：在視埠上方新增半透明工具欄，整合「整頁縮放」、「視圖定向（前/上/右/等角）」、「顯示樣式切換」等核心功能。
*   **空間尺寸標註 (Dimension Callouts) 強化**：為草圖中的距離約束新增標準 CAD 尺寸線與箭頭，支援雙擊標籤實時修改數值並驅動 PBD 求解器。
*   **幾何約束視覺化**：在視埠中實時渲染水平、垂直、共點等幾何關係圖示（綠色小方塊），大幅提升草圖定義狀態的可視性。
*   **工作流優化**：移除冗餘的右側視圖按鈕，將操作重心集中於視埠中央，更符合 SolidWorks 的 Heads-up 使用習慣。

## [2026-05-23] PBD Constraint Solver & Graph-based Sketch Core 重構 🚀
*   **重構核心**：徹底摒棄舊有的連續 `sketchPoints` 數組儲存，轉換為 Graph 圖論模型，透過 `sketchNodes`、`sketchEdges`、`sketchConstraints` 儲存草圖拓撲。
*   **約束求解**：引入 `ConstraintSolver.ts` 採用 PBD (Position-Based Dynamics) 迭代鬆弛算法，目前支援共點、水平、垂直、距離、等長五種約束。
*   **前端 Hit-Testing 升級**：在 `SketchPreview.tsx` 中實作邊線的寬 Hitbox 偵測（外層加粗 15px 透明邊），解決滑鼠難以拾取精細線段的痛點。
*   **SOP & 技能整合**：成功運行 `SkillsBuilder` 安裝腳本，將 global 技能與 Graphify Git Hooks 註冊進專案生命週期中，並初始化 `wiki/` 架構。

## [2026-05-23] 示範建構清除與特徵加固 ✅
*   **UI 淨化**：移除 legacy 的 `🎥 示範建構` 按鈕與對應狀態機，移除視口中無特徵時的球體佔位，維持潔淨視埠。
*   **防禦阻斷**：為 `旋轉-實體` 特徵工具加裝輸入驗證，無效或輪廓不足 3 點時會主動進行 Electron `appAPI.notify` 或 `alert` 提示，阻斷 Phantom 可樂瓶幾何生成。

## [2026-05-21] 視埠與設計樹雙向連動與草圖編輯管理器 ✅
*   **選取連動**：實作 `getFeatureDistance` 空間近鄰求解器，支援 3D Viewport 與 FeatureManager 設計樹的雙向高亮連動。
*   **嵌套子草圖**：特徵樹以 SolidWorks 風格嵌套渲染子草圖（`↳ 草圖1`），選取子草圖時視埠以經典桃紅色 (`#ec4899`) 渲染草圖線框。
*   **專屬草圖屬性管理器**：新增 `SketchPropertyManager.tsx` 用於顯示基準面、幾幾何點數量，並提供快捷按鈕進入編輯模式。

---

## [2026-05-23] Feature | Graphify Local Graph & Low-Token Query Mandate (Integrated from SkillsBuilder)
*   **Action**: Integrated `graphifyy` into SkillsBuilder to provide serverless codebase indexing.
*   **Changes**: 
    - Created `skills/dev/graphify/SKILL.md` for AI-agent guidance.
    - Updated `INSTALL.ps1` to detect environment, auto-provision `graphifyy` and Git hooks.
    - Added `wiki/global_rules.md` Section 4.5 enforcing 71.5x token budget efficiency.
    - Refined `.gitignore` to exclude `graphify-out/` outputs.

## [2026-05-03] Ingest | ClawHub All-Star Skill Library
*   **Source**: [resource/](file:///f:/Self-developed_Apps/SkillsBuilder/resource/) (ClawHub screenshots).
*   **Action**: Fully populated the library with the "Top 15" industry-standard skills.
*   **Changes**: 
    - Added `core/`: last30days, x-trends, vetter, skill-onboarding.
    - Added `dev/`: github, web-coder, soul-evolution, skill-creator.

## [2026-05-03] Architecture | Global Skill Library Transformation
*   **Action**: Restructured `skills/` and centralized core capabilities.
*   **Changes**: 
    - Created `skills/core/` and `skills/dev/` hierarchy.
    - Stored `tavily`, `summarize`, `planning`, and `youtube` skills in the repo.
    - Upgraded `INSTALL.ps1` for recursive symbolic linking.
    - Created `skill-library.md` concept page.

[... Rest of SkillsBuilder logs can be found in history ...]
