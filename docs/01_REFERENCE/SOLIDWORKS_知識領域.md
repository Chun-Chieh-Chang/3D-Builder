# SOLIDWORKS 知識基準索引

> 所有文件都來自 https://help.solidworks.com/2025/chinese/SolidWorks/sldworks/r_welcome_sw_online_help.htm

## 核心文件

| 文件名稱 | 描述 | 用途 |
|---------|------|------|
| [SOLIDWORKS_2025_參考標準.md](./SOLIDWORKS_2025_參考標準.md) | 專家知識標準 | 開發驗證基準 |
| [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md) | 開發路線圖 | 專案規劃指導 |
| [gap-audit-report.md](../gap-audit-report.md) | 功能缺口審計報告 | 缺口分析依據 |

## 知識領域分類

### 1. 基礎知識領域
- 使用者介面設計
- 3D 渲染顯示
- 2D/3D 轉換概念
- 模型組態管理

### 2. 核心建模功能
- 零件和特徵系統
- 草圖繪製工具
- 基本特徵操作
- 進階特徵功能

### 3. 組件管理系統
- 組件佈局與配合
- 大型組件處理
- 爆炸視圖功能
- 配置管理

### 4. 工程圖系統
- 工程圖基本要素
- 尺寸標準規範
- 標註系統
- BOM 表生成

### 5. 專業模組
- 模擬分析 (Simulation)
- 鈑金設計 (Sheet Metal)
- 模具設計 (Mold Design)
- 線路設計 (Wire Routing)

## 驗證標準

所有功能開發必須符合以下標準：

1. **功能完整性**：對照 SOLIDWORKS 2025 規格
2. **使用者體驗**：操作邏輯符合 SOLIDWORKS 習慣
3. **資料相容性**：輸出格式與 SOLIDWORKS 相容
4. **進階功能**：逐步實現專家級功能

## 更新機制

- 每月對照 SOLIDWORKS 官方文件更新
- 每次新功能開發後更新 Gap Report
- 定期驗證開發路線圖合理性