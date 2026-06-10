# SOLIDWORKS 線上說明 v2025 開發驗證標準

> **來源**: [SOLIDWORKS Design 說明 2025 – 歡迎使用 SOLIDWORKS 線上說明](https://help.solidworks.com/2025/chinese/SolidWorks/sldworks/r_welcome_sw_online_help.htm)
> **文件角色**: 本文件定義 3D-Builder 所有功能對標 SolidWorks 的驗證標準、測試門檻與 acceptance criteria。所有 Do (開發) 必須在此標準下進行，Check (查核) 以此為準，偏差則觸發 RCA/CAPA。
> **版本**: v1.0 — 2026-06-10
> **適用範圍**: 全部 Phase 1-6 所有功能板塊

---

## 目錄

1. [總則與驗證框架](#1-總則與驗證框架)
2. [功能板塊驗證標準總覽](#2-功能板塊驗證標準總覽)
3. [各板塊詳細驗證標準](#3-各板塊詳細驗證標準)
4. [RCA/CAPA 標準流程](#4-rcacapa-標準流程)
5. [自動化測試要求](#5-自動化測試要求)

---

## 1. 總則與驗證框架

### 1.1 驗證原則

本專案驗證框架建立以下核心原則：

| 原則 | 說明 |
|------|------|
| **Golden Test** | 每個功能板塊必須建立至少一個「黃金零件 (Golden Part)」，其拓撲、體積、重心等數據須與 SolidWorks 導出結果 100% 匹配 |
| **Event-Chain Reality Audit** | 所有 UI 交互事件必須追蹤完整链路：React 事件 → Store Action → Renderer Hook → Viewport Primitive |
| **參數化重建一致性** | 修改任一特徵參數後，全特徵樹必須在 150ms 內觸發防抖重建，且結果與 SolidWorks 一致 |
| **MECE 文件規範** | 所有功能板塊的開發、查核、修正記錄必須無重複 (Mutually Exclusive) 且無遺漏 (Collectively Exhaustive) |
| **Dirty Flagging** | 僅對受影響的特徵分支進行後端重建，避免全樹重建導致的效能瓶頸 |

### 1.2 查核工具鏈

| 工具 | 命令 | 用途 |
|------|------|------|
| TypeScript | `npx tsc --noEmit` | 全域型別安全檢查 |
| PDCA | `npm run pdca:check` | 文件與治理規範一致性 |
| 單元測試 | `npm run test` | 核心演算法與 API 合約 |
| 黃金零件比對 | `npm run test:golden` | 拓撲數據與 SolidWorks 一致性 |
| 回歸測試 | `npm run test:regression` | 已驗證功能的長期穩定性 |

### 1.3 驗證分級

| 等級 | 名稱 | 適用範圍 | 嚴格度 |
|------|------|----------|--------|
| L1 | 基礎驗證 | 每個功能提交 | 自動化工具 |
| L2 | 功能驗證 | 每個 Feature/Module | 手動 + 自動 |
| L3 | 板塊驗證 | 每 Phase 結案 | Golden Test + SOP |
| L4 | Release Gate | 每 Phase 轉換 | 完整 PDCA 查核 |
