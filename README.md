# 🎯 3D-Builder 專案說明

## 專案概述

3D-Builder 是一個基於 SOLIDWORKS 2025 專家知識標準开发的 3D CAD 應用程式。本專案嚴格遵循 SOLIDWORKS 操作邏輯和專家級功能標準，提供專業的 3D 建模和設計能力。

## 核心特色

### 符合 SOLIDWORKS 2025 專家標準
- ✅ 完整的零件和特徵系統
- ✅ 專業的草圖繪製工具
- ✅ 進階組件管理功能
- ✅ 符合使用者操作習慣

### 技術架構
- **前端**: React + TypeScript + Three.js
- **後端**: Python + FastAPI + OCCT
- **狀態管理**: Zustand
- **UI 框架**: Tailwind CSS

## 快速開始

### 環境需求
- Node.js 18+
- Python 3.10-3.12
- Git

### 安裝步驟
```bash
# 複製專案
git clone [repository-url]
cd 3D-Builder

# 安裝前端依賴
npm install

# 安裝 Python 依賴
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 啟動開發環境
npm run dev
```

## 開發指南

### 文件結構
```
docs/
├── 00_INDEX.md              ← 總索引
├── 01_REFERENCE/            ← SOLIDWORKS 參考標準
├── 02_SPEC/                 ← 技術規格
├── 03_ARCHITECTURE/         ← 架構設計
├── 04_DEVELOPMENT/          ← 開發指南
├── 05_GOVERNANCE/           ← 治理流程
├── 06_PRODUCTIZATION/       ← 產品化報告
├── 07_BENCHMARKS/           ← 實作練習
└── 08_LEARNINGS/            ← 經驗學習
```

- [📚 文件總索引](docs/00_INDEX.md)

### 開發流程
1. **需求分析**: 對照 SOLIDWORKS 2025 參考標準
2. **設計規劃**: 參考開發路線圖
3. **開發實作**: 遵循專家知識標準
4. **測試驗證**: 確保功能完整性

### 代碼規範
- 遵循 TypeScript 最佳實踐
- 使用 ESLint + Prettier
- 提交訊息遵循 conventional commits

## 功能模組

### 核心建模
- 基本特徵：拉伸、旋轉、掃描、包覆
- 進階特徵：圓角、倒角、抽殼、筋條
- 草圖系統：幾何約束、尺寸驅動

### 組件管理
- 配合關係系統
- 大型組件處理
- 配置管理

### 工程圖
- 工程圖基本要素
- 尺寸標準規範
- 標註系統

## 驗證標準

本專案所有功能開發都必須符合以下標準：

1. **功能完整性**: 對照 SOLIDWORKS 2025 規格
2. **使用者體驗**: 操作邏輯符合 SOLIDWORKS 習慣
3. **資料相容性**: 輸出格式與 SOLIDWORKS 相容
4. **進階功能**: 逐步實現專家級功能

## 貢獻指南

### 提交代碼
```bash
git add .
git commit -m "feat: 新增 [功能名稱]"
git push origin main
```

### 回報問題
- 使用 GitHub Issues
- 提供重現步驟
- 附上螢幕擷圖

### 功能建議
- 描述功能需求
- 說明使用情境
- 提供參考文件

## 授權條款

本專案採用 MIT 授權條款。

## 聯絡資訊

- 專案維護者: [Your Name]
- Email: [your-email@example.com]
- GitHub: [your-github-username]

---

**本專案嚴格遵循 SOLIDWORKS 2025 專家知識標準開發**