# SolidWorks 對標查核報告 (Gap Audit)

> **查核日期**：2026-05-29  
> **對照基準**：[SOLIDWORKS_MASTER_PLAN.md](../../SOLIDWORKS_MASTER_PLAN.md)、[PRODUCTIZATION_PLAN.md](./PRODUCTIZATION_PLAN.md)  
> **結論摘要**：本專案**尚未**達到「完全對標 SolidWorks」；已具備 **Alpha～Private Beta 等級**的零件建模主路徑，但大量 SW 模組仍缺件或未打通前後端。

---

## 1. 總體結論（直接回答）

| 問題 | 答案 |
|------|------|
| 操作介面是否已完全對標 SolidWorks？ | **否**。骨架（FeatureManager、PropertyManager、Heads-up、S 鍵選單、StatusBar）已有，但多處為佔位、未連通或文案/邏輯不完整。 |
| 前端與後端是否都已打通？ | **部分打通**。重建、質量屬性、匯出、草圖求解 API、組合求解、干涉檢測有端點；多項 UI 仍只用前端 mock/本地求解，或未呼叫後端。 |
| SolidWorks 所有交互與草圖/3D 特徵是否都已具備？ | **否**。僅覆蓋 SW 零件模式的一小部分（見下表）。 |

產品化計畫已明確：**1.0 前禁止宣稱「完整取代 SolidWorks」**——與實際代碼狀態一致。

---

## 2. Master Plan 四板塊達成度

### 2.1 引擎與約束（Kernel & Solver）

| 項目 | 狀態 | 說明 |
|------|------|------|
| B-Rep / OpenCASCADE | ⚠️ 部分 | 後端 `geometry_service` 有 OCC 路徑；本機無 OCC 時走 **mock 網格**，體積可對但非真 B-Rep。 |
| PBD 草圖預覽 | ✅ | `ConstraintSolver.ts` 本地 PBD/拖曳。 |
| 精準求解（NR / 後端） | ⚠️ | `SketchSolverService.commitPreciseSketchSolve` 於約束提交/草圖點擊後呼叫 `solve_sketch`；後端離線時 fallback 本地 PBD。 |
| 完全/欠定義/衝突配色 | ⚠️ | `analyzeSketchDefinitions` + StatusBar；視覺未完全對齊 SW 黑/藍/紅規範。 |
| 拓撲命名 / 面 ID 追蹤 | ⚠️ | 幾何簽名初版、`face_metadata`；重建後 Fillet 選邊仍易失效，無完整 TNS。 |

### 2.2 參數化數據流（Feature Chain）

| 項目 | 狀態 | 說明 |
|------|------|------|
| `.3dbpart` 正式 schema | ✅ | `part-file.ts` + 存檔流程。 |
| Rollback Bar | ✅ | `rollbackIndex` + 特徵樹控制棒。 |
| 編輯草圖自動 rollback | ✅ | `handleRebuild` 編輯時截斷後續特徵。 |
| 父子刪除提示/連帶刪除 | ❌ | 僅 UI 顯示 Parent/Child，**刪除父特徵無確認對話框**。 |
| Live Rebuild 150ms | ✅ | debounce + dirty flag + 增量形狀快取（需 OCC）。 |
| 重建進度條 | ❌ | 僅 `loading` 遮罩，無進度百分比。 |

### 2.3 介面交互（Professional UX）

| 項目 | 狀態 | 說明 |
|------|------|------|
| Heads-up 工具列 | ⚠️ | 有 Zoom / 視向 / Normal To / Exit Sketch；**剖面按鈕 disabled**；顯示模式已接 `OcctShape`。 |
| S 鍵快捷選單 | ⚠️ | `ShortcutBox` 有草圖/零件工具；**Extrude 等 action 為空**、無 Fillet/Revolve 入口。 |
| PropertyManager | ⚠️ | 特徵參數面板為 **raw key 列表**，非 SW 式 Rollout；草圖用 `SketchPropertyManager` 較完整。 |
| 空間尺寸 Callout | ⚠️ | `SketchPreview` 有 `Html` 尺寸與雙擊編輯；**非全 SW 尺寸線樣式**。 |
| 多模式左側欄結構分離 | ⚠️ | 草圖/組合/零件以條件渲染區分，**非獨立 DOM 區塊 id**（多模式規範待強化）。 |

### 2.4 前後端通連（Geometry Pipeline）

| API | 前端是否使用 | 備註 |
|-----|-------------|------|
| `POST /rebuild` | ✅ | `usePartRebuild` + `fromFeatureIndex` + 指紋。 |
| `POST /mass_properties` | ✅ | 質量屬性對話框。 |
| `POST /export` | ✅ | STEP/IGES/STL。 |
| `POST /project` | ✅ | 工程圖投影線。 |
| `POST /solve_sketch` | ✅ | `SketchSolverService` 於約束提交與 DatumPlanes 點擊後精準求解；拖曳中仍用本地 PBD 預覽。 |
| `POST /solve_assembly` | ✅ | `MatePanel` + `mate-payload`。 |
| `POST /detect_interference` | ⚠️ | 客戶端有方法，UI 入口有限。 |
| STEP **匯入** | ❌ | 後端 `import_step_file` 有；**前端無匯入工作流**。 |

---

## 3. 草圖功能對照 SolidWorks

| SolidWorks 草圖能力 | 本專案 |
|---------------------|--------|
| 線、矩形、圓 | ✅ 線/圓/矩形（部分經由點陣列 legacy） |
| 弧、樣條、橢圓 | ⚠️ 工具列有 ARC；**樣條/橢圓缺** |
| 幾何關係（H/V/相切/同心…） | ✅ SketchPropertyManager + 約束圖 |
| 智能尺寸 | ⚠️ 拖曳/距離約束；ShortcutBox SmartDim **空 action** |
| 轉換實體、偏移、鏡射 | ❌ |
| 草圖圖案、文字 | ❌ |
| 封閉輪廓偵測 | ⚠️ `GraphAdapter` / `CycleFinder`；擠出前檢查不完整 |
| 3D 草圖 | ❌ |

---

## 4. 3D 特徵對照 SolidWorks

### 4.1 後端（`geometry_service`）支援

| 特徵 | 後端 | 前端建立入口 |
|------|------|-------------|
| Extrude 凸台/切除 | ✅ | ✅ 工具列 + 草圖退出擠出 |
| Box / Cylinder / Sphere | ✅ | ✅ |
| Revolve | ✅ | ✅ Ribbon「Revolve」+ `handleRevolveFromSketch`（封閉輪廓） |
| Fillet / Chamfer | ⚠️ 需邊引用 | ✅ Ribbon 選邊 → `edge_start`/`edge_end`/`signature` |
| Shell / Loft | ⚠️ 程式碼存在 | ❌ |
| Pattern 線性/圓周 | ✅ | ✅ |
| Sweep | ❌ | ❌ |
| 參考平面/軸 | ⚠️ 部分 | ❌ 完整 UI |
| 鏡射特徵 | ❌ | ❌ |
| 草稿角 Draft | ❌ | ❌ |

### 4.2 特徵編輯

- 選特徵後 PropertyManager 可改 **parameters 任意欄位**（開發者向，非 SW 嚮導）。
- **無**特徵嚮導式 Extrude（方向2、薄壁、拔模等）。
- Fillet/Chamfer 具 Ribbon 選邊流程；**無** PropertyManager 嚮導式半徑/距離編輯 Rollout。

---

## 5. 組合件 / 工程圖 / 其他模組

| 模組 | 狀態 |
|------|------|
| 組合件 Mate | ⚠️ 基本 Coincident/Concentric/Distance + 擴充求解；無路徑/齒輪/凸輪 |
| 組合件樹 / 多零件 | ⚠️ `components` + 插入元件；非完整 SW 裝配樹 |
| 工程圖 | ⚠️ `DrawingSheet` 三視圖 + PDF；標註/標題欄/ BOM 不完整 |
| 鈑金 / 曲面 / 模具 / Simulation / PDM | ❌ 計畫外（1.0 前禁止宣稱） |

---

## 6. 已具備且可演示的「主路徑」（對標 SW 新手入門）

以下流程在 **後端已啟動 + OCC 或 mock** 下可跑通：

1. 選基準面 → 進入草圖 → 繪製輪廓 → 加尺寸/約束  
2. 退出草圖 → 凸台拉伸 / 切除拉伸  
3. 特徵樹 Rollback → 修改參數 → Live Rebuild  
4. 存 `.3dbpart` → 再開啟  
5. 匯出 STEP/STL/IGES  
6. 質量屬性 / 基礎量測  
7. 簡單 Mate + 工程圖預覽  

**不等於** SolidWorks 功能全集。

---

## 7. 優先缺件清單（建議 P0→P2）

### P0 — 主路徑缺口（影響「像不像 SW」）

1. ~~Heads-up **顯示模式**接視埠~~ ✅ Phase 19  
2. ~~**solve_sketch** 後端精準求解接線~~ ✅ `SketchSolverService`  
3. ~~特徵工具：**圓角/倒角/旋轉** 前端入口~~ ✅ Ribbon + 選邊；軸向/多邊選取仍待強化  
4. ShortcutBox / 工具列 **action 空實作** 補全  
5. 刪除父特徵 **確認與連帶刪除**  

### P1 — 產品化門檻（Release Gate）

6. ~~STEP **匯入** UI（dumb solid）~~ ✅ Phase 24
7. ~~重建 **進度**與取消（Abort 已有，需 UI）~~ ✅ Phase 26
8. ~~PropertyManager **Rollout 嚮導式**（Extrude/Fillet 等）~~ ✅ Phase 25
9. ~~CI 安裝 pythonocc → Golden STEP / 增量 B-Rep 必跑~~ ✅ Phase 27

### P2 — 進階對標

10. Sweep、鏡射、參考幾何完整 UI  
11. 剖面視圖（3D Section View）  
12. 組合件 Mate 路徑/機械連動  
13. 工程圖智慧標註與 BOM  

---

## 8. 與內部路線圖文件之差異

[docs/architecture/SOLIDWORKS_FEATURE_ROADMAP.md](../architecture/SOLIDWORKS_FEATURE_ROADMAP.md) 多項仍標 `[ ]`，與實際代碼（如 Extrude、Topology 選取、Measurement）**不同步**。建議以 **本文件 + MASTER_PLAN** 為查核單一真相來源，並在下一輪 PDCA 同步勾選 roadmap。

---

## 9. Phase 19 本次實作（延續開發）

- [x] `PartFeaturePropertyManager` 自 `page.tsx` 拆分  
- [x] `viewportDisplayMode` 全域狀態 + Heads-up ↔ OcctShape  
- [x] `SketchSolverService` + 草圖精準求解接線  
- [x] Fillet / Chamfer / Revolve Ribbon 與選邊流程  
- [x] 本查核文件納入 `task_plan.md` Act 項  
- [x] [SOLIDWORKS_USABLE_PARITY_ROADMAP.md](./SOLIDWORKS_USABLE_PARITY_ROADMAP.md)（M0–M4 可使用 1:1 路線圖）

---

## 10. Usable 1:1 Roadmap（摘要）

完整里程碑、驗收測試 ID、時程帶與 Top 10 缺口見：  
**[SOLIDWORKS_USABLE_PARITY_ROADMAP.md](./SOLIDWORKS_USABLE_PARITY_ROADMAP.md)**

| 里程碑 | 一句話 | 累計時程（自 M0，單團隊） |
|--------|--------|---------------------------|
| **M0** | 現況：Alpha 演示主路徑 | 現在 |
| **M1** | 零件可上班（6/8 標準件 + Golden CI） | +2–3 月 |
| **M2** | 組合可定位（`.3dbasm` + 干涉） | +5–6 月 |
| **M3** | 圖紙+STEP 可交付 | +7–9 月 |
| **M4** | 種子用戶「參考日」無需回退 SW | +10–14 月 |

**誠實達成度（2026-05-29）**：零件日工作流 ~32%；全日（零件+組合+圖）~22–28%。**不是 1:1 今天可用。**

**建議 SW 克隆基準**：SolidWorks **2015** 核心（零件 / 基礎 Mate / 三視圖 / PDF / STEP）。
