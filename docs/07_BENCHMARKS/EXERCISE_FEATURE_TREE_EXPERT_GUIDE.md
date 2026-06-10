# SolidWorks Expert Guide: FeatureManager Tree Logic

**Source**: [YouTube: SolidWorks - Feature Manager Tree](https://www.youtube.com/watch?v=CiHbw68BnmY)
**Reference**: Standard SOLIDWORKS 2000+ History-Based Modeling

## 1. FeatureManager Design Tree (設計樹) 核心邏輯
設計樹是 SolidWorks 的靈魂，它不僅是「歷史紀錄」，更是「控制中心」。

### A. 父子關係的可視化 (Parent/Child Relations)
在 SolidWorks 中，當選取一個特徵時：
1. **動態連結線 (Dynamic Reference Visualization)**：
   - 藍色線條（向上）指向「父項 (Parents)」特徵（例如，此 Extrude 依賴的 Sketch）。
   - 紫色線條（向下）指向「子項 (Children)」特徵（例如，依賴此 Extrude 面生成的 Fillet）。
2. **依賴關係管理**：
   - 刪除父項會自動提示刪除或孤立子項。
   - 拖動特徵（Reordering）時，不能將父項拖到子項之後。

### B. 特徵狀態顯示
- **退回棒 (Rollback Bar)**：拖動藍色退回棒可以暫時隱藏後續特徵，回到過去的建模狀態進行修改。
- **壓縮 (Suppress)**：灰色的圖標表示特徵被壓縮，暫時不參與計算。
- **草圖嵌套 (Sketch Nesting)**：特徵（如 Extrude）應「吞噬」其使用的草圖，以「↳」符號顯示在特徵下方。

## 2. 專案對標缺口 (Gap Checklist)
- [x] **Rollback Bar**：已實作基礎拖動。
- [x] **Nesting**：已實作 `↳ 草圖` 顯示。
- [ ] **動態父子連線**：`FeatureManagerPanel.tsx` 雖有 `PARENT/CHILD` 染色，但缺乏 SolidWorks 標誌性的 **「動態藍/紫連線 (Reference Visualization)」**。
- [ ] **特徵重命名**：目前難以透過單擊或 F2 快速重新命名特徵。
- [ ] **特徵說明 (Description)**：缺乏滑鼠懸停顯示特徵摘要的能力。

## 3. 預期行為 (SOP)
1. 在 FeatureManager 選取一個特徵。
2. 系統應即時高亮其所有父項（綠色/藍色）與子項（深藍）。
3. 支援將特徵在合法範圍內上下拖動（不違反父子邏輯）。
