# 📚 3D-Builder 文件索引 (MECE 結構)

> 本專案採用 MECE (Mutually Exclusive, Collectively Exhaustive) 文件架構。
> 每個文件只歸屬於一個目錄，所有文件合起來覆蓋完整專案知識。

## 目錄結構

```
docs/
├── 00_INDEX.md                       ← 本文件 (總索引)
├── 01_REFERENCE/                     ← 參考標準
│   ├── SOLIDWORKS_2025_基準.md        ← SOLIDWORKS 2025 專家知識標準
│   └── SOLIDWORKS_知識領域.md          ← 知識領域分類
├── 02_SPEC/                          ← 技術規格
│   ├── feature-schema.md             ← 特徵資料模型
│   ├── geometry-api.md               ← 幾何 API 規格
│   ├── part-file-format.md           ← 零件檔案格式
│   ├── release-gates.md              ← 發布門檻
│   ├── sketch-schema.md              ← 草圖資料模型
│   ├── SOLIDWORKS_VERIFICATION_STANDARD.md
│   ├── SOLIDWORKS_VERIFICATION_STANDARD_FEATURES.md
│   ├── SOLIDWORKS_VERIFICATION_STANDARD_FEATURES_2.md
│   ├── SOLIDWORKS_VERIFICATION_STANDARD_FEATURES_3.md
│   ├── SOLIDWORKS_VERIFICATION_STANDARD_RCA.md
│   ├── SOLIDWORKS_VERIFICATION_STANDARD_TESTS.md
│   └── UI_ENHANCEMENT_SPEC.md
├── 03_ARCHITECTURE/                  ← 架構設計
│   ├── ARCHITECTURE_MAP.md           ← 架構總覽
│   ├── implementation_plan.md        ← 實作計畫
│   ├── SOLIDWORKS_FEATURE_ROADMAP.md ← 功能路線圖
│   ├── SOLIDWORKS_MASTER_PLAN.md     ← 總設計計畫
│   ├── SYSTEM_DESIGN.md              ← 系統設計
│   └── video-driven-gap-detection.md   ← 影片驅動缺口檢測
├── 04_DEVELOPMENT/                   ← 開發指南
│   ├── ROADMAP.md                    ← 開發路線圖
│   └── GUIDE.md                      ← 開發指南
├── 05_GOVERNANCE/                    ← 治理流程
│   ├── PDCA_GOVERNANCE.md            ← PDCA 治理流程
│   ├── RCA_CAPA_TEMPLATE.md          ← 根本原因分析模板
│   └── master_workflow_hook.md       ← 主工作流 hook
├── 06_PRODUCTIZATION/                ← 產品化報告
│   ├── (各功能 Gap Report)
│   └── SOLIDWORKS_GAP_AUDIT.md       ← 總體缺口報告
├── 07_BENCHMARKS/                    ← 實作練習
│   ├── (EXERCISE_*.md)
│   └── FOUNDATIONAL_BLOCK_SOP.md
├── 08_LEARNINGS/                     ← 經驗學習
│   ├── LEARNINGS.md                  ← 學習筆記 (自進化防呆)
│   ├── SELF_EVOLVING_GUARD.md        ← 防呆機制說明
│   └── INTEGRATION_REPORT.md         ← 整合報告
├── constraint_solver_spec.md         ← 約束求解器規格 (核心技術)
├── karpathy_coding_standards.md      ← Karpathy 編碼標準
├── pdca-system.html                  ← PDCA 視覺化系統
└── skill_usage_guide.md              ← 技能使用指南
```

## 文件類別定義

| 編號 | 類別 | 內容範圍 | 負責人 |
|------|------|---------|--------|
| 01 | 參考標準 | 外部標準、專家知識、基準 | 全體 |
| 02 | 技術規格 | API、資料模型、檔案格式 | 開發者 |
| 03 | 架構設計 | 系統架構、設計決策、路線圖 | 架構師 |
| 04 | 開發指南 | 開發流程、規範、工具使用 | 開發者 |
| 05 | 治理流程 | PDCA、品質管理、決策流程 | PM |
| 06 | 產品化報告 | Gap Report、交付報告、驗證 | 全體 |
| 07 | 實作練習 | 練習 SOP、專家指南 | 全體 |
| 08 | 經驗學習 | 教訓記錄、防呆機制、報告 | 全體 |

## 快速連結

- [SOLIDWORKS 2025 基準](01_REFERENCE/SOLIDWORKS_2025_基準.md)
- [開發路線圖](04_DEVELOPMENT/ROADMAP.md)
- [系統設計](03_ARCHITECTURE/SYSTEM_DESIGN.md)
- [發布門檻](02_SPEC/release-gates.md)
- [學習筆記](08_LEARNINGS/LEARNINGS.md)
- [自進化防呆](08_LEARNINGS/SELF_EVOLVING_GUARD.md)
