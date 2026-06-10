# SolidWorks「可使用的 1:1」路線圖 (Usable Parity Roadmap)

> **文件角色**：定義「機械工程師可完成真實工作日」的最低 SolidWorks 工作流對標，並將 M0→M4 里程碑、驗收測試與時程帶綁定。  
> **查核日期**：2026-05-29  
> **對照基準**：[SOLIDWORKS_MASTER_PLAN.md](../../SOLIDWORKS_MASTER_PLAN.md)、[PRODUCTIZATION_PLAN.md](./PRODUCTIZATION_PLAN.md)、[SOLIDWORKS_GAP_AUDIT.md](./SOLIDWORKS_GAP_AUDIT.md)  
> **建議克隆基準**：**SolidWorks 2015 核心工作流**（零件 + 基礎組合 + 基礎工程圖 + STEP 交換）。不追求 2024+ 雲端/MBD/高階曲面模組。

---

## 1. 誠實現況：我們不是 1:1，也不是「今天就能取代 SW」

| 維度 | 估計達成度 | 說明 |
|------|-----------|------|
| **零件日工作流**（草圖→特徵→存檔→STEP） | **~32%** | 主路徑可演示；圓角/旋轉有入口但拓撲引用脆弱；無嚮導式 PM。 |
| **組合件日工作流**（插入件→Mate→干涉） | **~18%** | 基本 Mate + 求解有；無 `.3dbasm` 正式流、BOM/爆炸圖/路徑 Mate 缺。 |
| **工程圖日工作流**（三視圖→標註→PDF） | **~15%** | 投影與 PDF 有雛形；標題欄/BOM/剖視/公差未達交付級。 |
| **SW 2015 核心 UI/交互殼** | **~40%** | FeatureManager、Heads-up、S 鍵、StatusBar、Rollback 骨架在；多處仍為佔位或開發者向面板。 |
| **全產品（含鈑金/曲面/Sim/PDM）** | **&lt;5%** | 明確在 1.0 前禁止宣稱（見 PRODUCTIZATION_PLAN §1.2）。 |

**綜合「可上班用」對標（零件+組合+圖紙+匯出一日）**：約 **22–28%**。  
**仍偏 Demo 的部分**：ShortcutBox 空 action、PropertyManager 原始 key 列表、無 STEP 匯入 UI、父子刪除無 SW 式確認、Golden 測試未進 CI 必跑、無 OCC 時 mock 網格冒充 B-Rep。

---

## 2. 「可使用的 1:1」在本專案的定義

> **1:1** = 工作流順序、面板位置、模式切換、快捷鍵習慣與 SolidWorks **同代**一致（允許副檔名為 `.3dbpart`、不支援 `.sldprt` 原生）。  
> **可使用** = 一位機械/加工工程師**無需改用手動 mesh 工具**，能在 **8 小時內**完成下方「參考日」且產出可被工廠/同事接受的交付物。

### 2.1 參考工作日（SW 2015 經典鏈路）

```mermaid
flowchart LR
  A[新零件] --> B[基準面草圖]
  B --> C[約束+尺寸]
  C --> D[凸台/切除/圓角/陣列]
  D --> E[存 .3dbpart]
  E --> F[插入組合]
  F --> G[Mate 定位]
  G --> H[干涉檢查]
  H --> I[工程圖三視圖]
  I --> J[標註+標題欄]
  J --> K[匯出 PDF + STEP]
```

### 2.2 最低能力清單（M4 前必須全部為 ✅）

| # | 能力 | SW 2015 對照 |
|---|------|----------------|
| 1 | 草圖：線/弧/圓/矩形 + H/V/相切/同心/固定 + 智慧尺寸 | Sketch toolbar |
| 2 | 草圖：封閉輪廓檢查 + 欠定/過定/衝突狀態 | Sketch status colors |
| 3 | 特徵：Extrude Boss/Cut、Revolve、Fillet、Chamfer、Linear/Circular Pattern | Features tab |
| 4 | 特徵：Rollback、Suppress、編輯草圖截斷後續 | FM rollback bar |
| 5 | 拓撲：選面草圖、Fillet 選邊重建後仍可用（≥80% 標準測試件） | TNS 初版 |
| 6 | 檔案：`.3dbpart` 存開、Undo/Redo、髒狀態提示 | File menu |
| 7 | 交換：STEP/STL/IGES 匯出；STEP 匯入 dumb solid | Import/Export |
| 8 | 組合：≥2 零件、Coincident/Concentric/Distance Mate、固定/浮動 | Assembly |
| 9 | 圖紙：三視圖 + 等角 + 至少線性/直徑標註 + A4 PDF + 標題欄欄位 | Drawing |
| 10 | 評估：距離/角度/面積/體積/質量屬性 | Evaluate |
| 11 | UX：Heads-up 顯示模式、Normal To、選取篩選、刪除父特徵確認 | Shell |
| 12 | 品質：Golden 回歸 CI 必過；無 OCC 時明確標示「非 B-Rep 預覽」 | Release gate |

**明確不在「可使用 1:1」範圍內（2.0+）**：Sweep/Loft 全套、鈑金展開、曲面、Simulation、PDM、`.sldprt` 原生、大型萬零部件裝配。

---

## 3. 建議對標版本：SolidWorks 2015

| 選擇理由 | 說明 |
|----------|------|
| 工作流穩定 | 零件/組合/工程圖三分模式與 FeatureManager 結構與現有 UI 骨架一致。 |
| 範圍可控 | 不含 2019+ 結構系統、2020+ 大幅 UI 改版、雲端 3DEXPERIENCE。 |
| 工廠仍常見 | 許多 SMB 機械設計仍以 2012–2018 技能為主，教學與驗收案例充足。 |

**克隆清單（2015 核心，非全部功能）**：

- 零件：Sketch + Boss/Cut Extrude + Revolve + Fillet/Chamfer + Pattern + 參考幾何（Front/Top/Right + 自訂面）
- 組合：Insert Component + Standard Mates + Interference + 簡單 BOM 表（圖紙）
- 圖紙：Model View 三視圖 + Model Items 基礎標註 + Sheet format 標題欄
- 交換：STEP AP214 匯出、STEP dumb import

---

## 4. 里程碑 M0–M4

### M0 — 現況基線（**現在**，2026-05-29）

**定位**：Alpha 演示 + 工程師內部試用；**不可**對外宣稱取代 SolidWorks。

| 項目 | 狀態 |
|------|------|
| `.3dbpart` 存開、Rollback、Live Rebuild（debounce） | ✅ |
| Extrude/Cut、Pattern、Box/Cylinder | ✅ |
| Revolve / Fillet / Chamfer 後端 + 前端入口（`page.tsx` 工具列） | ⚠️ |
| `SketchSolverService` 後端 NR + 本地 fallback（滑鼠釋放） | ⚠️ 已接線，需 Golden 驗證 residual |
| `viewportDisplayMode` ↔ `OcctShape` | ✅（Phase 19） |
| 組合 Mate 求解、工程圖投影 API | ⚠️ |
| STEP 匯入 UI | ❌ |
| CI Golden + pythonocc 必跑 | ❌ |

**M0 驗收（回歸腳本，允許 SKIP 若無 OCC）**：

```bash
# 開發機有 pythonocc 時應全綠
python tests/regression/run_golden.py
npx tsc --noEmit
```

- [ ] `geometry_check.py`：L-Bracket 體積誤差 &lt; 0.5%
- [ ] `roundtrip_check.py`：`.3dbpart` 存開後 feature 數一致
- [ ] `export_validation.py`：STEP 匯出再匯入體積誤差 &lt; 1%（需 OCC）

---

### M1 — Alpha-usable 零件（**目標：8–12 週**，1 名全職核心 + 0.5 QA）

**一句話**：工程師可**只在本產品內**完成 PRODUCTIZATION_PLAN §6.1 八件標準測試件中的 **6/8**，且不靠 mock 網格（CI 強制 OCC）。

| 工作包 | 內容 |
|--------|------|
| M1-A 草圖 | 封閉輪廓強化；SW 式黑/藍/紅；SmartDim 打通 ShortcutBox；Trim 初版 |
| M1-B 特徵 | Extrude 嚮導式 PM（方向/深度/薄壁）；Fillet/Chamfer 穩定選邊 + 失敗訊息 |
| M1-C 拓撲 | `geometric-signature` + 重建後 Fillet 邊解析 ≥80% Golden |
| M1-D 品質 | `run_golden.py` 進 CI；無 OCC 建置顯示「預覽模式」橫幅 |

**M1 驗收測試（必須可腳本或檢查清單勾選）**：

| ID | 測試 | 通過標準 |
|----|------|----------|
| M1-T1 | L-Bracket | 從零建模；體積與 `lbracket_benchmark.py` 期望誤差 &lt;0.5%；存 `.3dbpart` 再開啟 mesh 一致 |
| M1-T2 | Base plate w/ holes | 內孔輪廓 Extrude Cut 成功；欠定草圖有藍色提示 |
| M1-T3 | Shaft revolve | Revolve 360°；無「profile open」誤報 |
| M1-T4 | Flange | Circular pattern 8 孔；圓角 R2 重建後仍有效 |
| M1-T5 | Fillet stress | 半徑過大 → UI 顯示可讀錯誤（非 console only） |
| M1-T6 | Rollback edit | 回滾至草圖編輯 → 改尺寸 → 後續特徵自動抑制重建 → 體積更新 |
| M1-T7 | Undo/Redo | 連續 20 次 feature 操作 undo 回到初始狀態 |
| M1-T8 | Precise sketch | 100×50 矩形對角距離約束 50mm；`commitPreciseSketchSolve` 後 residual &lt; 1e-3 mm（後端 ON） |

**仍非目標**：組合、工程圖交付、STEP 匯入。

---

### M2 — Assembly-usable（**M1 後 +10–14 週**）

**一句話**：兩零件以上裝配定位，干涉報告可截圖給同事。

| 工作包 | 內容 |
|--------|------|
| M2-A 格式 | `.3dbasm` schema v1；插入外部 `.3dbpart` |
| M2-B Mate | Parallel/Angle Mate；Mate 衝突報告；干涉檢測 UI |
| M2-C 樹 | 組合 FeatureManager 樹；固定/浮動；輕量變換 gizmo |
| M2-D 求解 | `solve_assembly` 穩定；≥5 個 Mate 的支架+軸系案例 |

**M2 驗收測試**：

| ID | 測試 | 通過標準 |
|----|------|----------|
| M2-T1 | Shaft in bracket | 2 零件 + Concentric + Coincident；拖動軸仍約束 |
| M2-T2 | Distance mate | 支架面間距 10mm ±0.01 模型單位 |
| M2-T3 | Interference | 故意重疊 → 干涉列表 ≥1 項，高亮體積 &gt; 0 |
| M2-T4 | Save/load asm | `.3dbasm` 存開後 Mate 數與 transform 誤差 &lt; 1e-6 |
| M2-T5 | Part edit propagate | 改零件孔徑 → 重開組合 → 重建無手動重 Mate |

---

### M3 — Drawing / export-usable（**M2 後 +8–12 週**）

**一句話**：圖紙可給鉗工；STEP 可給外協。

| 工作包 | 內容 |
|--------|------|
| M3-A 圖紙 | 三視圖+等角穩定；線性/直徑標註；標題欄模板（圖號/比例/材料） |
| M3-B 匯出 | PDF A4 公差；STEP AP214 選項；匯出驗證腳本 |
| M3-C 匯入 | STEP dumb solid UI + 放入零件樹 |
| M3-D 量測 | Evaluate 與圖紙尺寸聯動（改 3D 標註更新） |

**M3 驗收測試**：

| ID | 測試 | 通過標準 |
|----|------|----------|
| M3-T1 | Drawing PDF | L-Bracket 三視圖 PDF；A4 尺寸；人工目視線條完整 |
| M3-T2 | Dimension | 總長標註與 3D bounding box 誤差 &lt; 0.1mm |
| M3-T3 | STEP export | FreeCAD 重開；體積誤差 &lt; 1% |
| M3-T4 | STEP import | 外購 STEP 匯入；可作為固定零件插入組合 |
| M3-T5 | Title block | 圖號/名稱/比例欄位可編輯並出現在 PDF |

---

### M4 — Beta parity（**M3 後 +12–16 週** → 對齊 PRODUCTIZATION 1.0 Gate）

**一句話**：種子用戶（5–20 人）完成「參考日」無需回退 SolidWorks。

**M4 驗收 = §2.2 十二項全 ✅ + PRODUCTIZATION_PLAN §18 Release Gate**：

| ID | 測試 | 通過標準 |
|----|------|----------|
| M4-T1 | Reference day | 新人在 8h 內完成：支架零件 + 軸零件 + 組合 + 圖紙 + PDF + STEP（檢查清單由 QA 簽字） |
| M4-T2 | 10 models | §13.1 六模型 + 自訂 4 模型全通過 Golden |
| M4-T3 | Stability | 連續 20 次 rebuild 無 crash；Autosave 恢復 |
| M4-T4 | Installer | Windows 安裝/解除；bundled Python+OCC 啟動 &lt; 5s |
| M4-T5 | Docs | Quick Start + Known Limitations 列出所有刻意不做的 SW 功能 |

**時程帶（誠實、單團隊假設）**：

| 里程碑 | 累計自 M0 |
|--------|-----------|
| M1 | +2–3 個月 |
| M2 | +5–6 個月 |
| M3 | +7–9 個月 |
| M4（1.0 候選） | +10–14 個月 |

並行人力可壓縮 30–40%，但**不可**宣稱已達 M4。

---

## 5. 與內部 Phase 編號對照（15–19 與產品化 Phase）

| 內部 Phase | 內容（文件/提交脈絡） | 對應里程碑 |
|------------|----------------------|------------|
| **Phase 15** | Master Plan、Layout（FM/Heads-up/StatusBar/PropertyManager 骨架） | M0 |
| **Phase 16**（隱含） | `.3dbpart`、`part-file.ts`、rollback、feature-tree-relations | M0→M1 |
| **Phase 17**（隱含） | `usePartRebuild`、增量重建指紋、`geometric-signature`、assembly_solver | M1 |
| **Phase 18**（隱含） | `mate-payload`、`run_golden.py`、`test_incremental_rebuild.py` | M1→M2 |
| **Phase 19** | GAP 查核、`viewportDisplayMode`、`PartFeaturePropertyManager` 拆分 | M0 文件化；未解 P0 |

**PRODUCTIZATION_PLAN 對照**：

| 產品化 Phase | 路線圖里程碑 |
|--------------|-------------|
| Phase 0 Stabilization | M0 前半 |
| Phase 1 Alpha | **M1** |
| Phase 2 Private Beta | M1 末 – **M2** |
| Phase 3 Public Beta | **M3** |
| Phase 4 1.0 | **M4** |
| Phase 5–6（1.5/2.0） | M4 之後 Sweep/進階圖紙/大裝配 |

---

## 6. Top 10 缺口（阻擋「可使用」）

| 排名 | 缺口 | 阻擋原因 | 目標里程碑 |
|------|------|----------|------------|
| 1 | **真 B-Rep CI 必跑** | 無 OCC 時 mock 網格；體積可對但非工業幾何 | M1 |
| 2 | **封閉輪廓 + Extrude 錯誤 UX** | 新手卡在「為何不能拉伸」 | M1 |
| 3 | **拓撲引用 / Fillet 重建** | 改參數後選邊失效 → 不信任參數化 | M1 |
| 4 | **PropertyManager 嚮導式** | 原始 key 列表無法當生產工具 | M1 |
| 5 | **STEP 匯入 UI** | 外購件無法進裝配鏈 | M3（M2 可先做後端） |
| 6 | **ShortcutBox / 空 action** | SW 肌肉記憶斷裂 | M1 |
| 7 | **刪除父特徵確認** | 誤刪特徵樹毀損 | M1 |
| 8 | **`.3dbasm` + 裝配樹** | 無法持久化多零件專案 | M2 |
| 9 | **工程圖標註/標題欄** | 無法交付車間 | M3 |
| 10 | **Electron 打包 + 後端健康** | 工程師無法「安裝即用」 | M4 |

---

## 7. Demo vs 生產路徑（代碼取樣結論）

| 區域 | 生產路徑 | Demo / 缺口 |
|------|----------|-------------|
| 重建 | `usePartRebuild` → `POST /rebuild` + fingerprint | 無 OCC → mock mesh |
| 草圖 | `SketchSolverService` PBD + `solve_sketch` | SmartDim S 鍵空 action；樣條/偏移缺 |
| 特徵 | `geometry_service` OCC | Shell/Loft/Sweep 無 UI |
| 組合 | `MatePanel` + `solve_assembly` | 無正式 asm 檔；進階 Mate 缺 |
| 圖紙 | `DrawingSheet` + `/project` | BOM/剖視/公差缺 |
| 檔案 IO | `.3dbpart` export/import | STEP 匯入僅後端 |
| UI 殼 | FM / Heads-up / PM 拆分中 | `page.tsx` 仍過大；剖面 disabled |

---

## 8. 維護規則

1. 完成任一 M 里程碑項目前，先更新本文件勾選與 [SOLIDWORKS_GAP_AUDIT.md](./SOLIDWORKS_GAP_AUDIT.md) 狀態表。  
2. `task_plan.md` 只保留**下一輪 3–5 項**工程優先級，必須指向 M1–M4 測試 ID。  
3. 禁止在 README/行銷文案寫「已 1:1 對標 SolidWorks」直至 **M4-T1** 簽字。

---

*本文件為 Usable Parity 的 Plan of Record；與 PRODUCTIZATION_PLAN 衝突時，以「可使用」驗收測試為準進行 RCA。*
