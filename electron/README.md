# Electron Desktop Application

本目錄包含 3D-Builder 的 Electron 桌面包裝配置。

## 架構

```
electron/
├── main.ts          # 主進程：建立視窗、管理生命週期
├── preload.ts       # 預加載腳本：安全的 IPC 通訊
├── renderer.ts      # 渲染進程整合：提供 API 介面
├── tsconfig.json    # TypeScript 配置
└── package.json     # Electron 專屬依賴
```

## 技術棧

- **Electron 34** - 桌面應用框架
- **TypeScript** - 類型安全
- **Next.js** - 前端框架 (保留現有代碼)
- **React Three Fiber** - 3D 渲染

## 功能

### 已實現
- ✅ 原生檔案系統存取 (open/save/read)
- ✅ 檔案對話框 (Open/Save)
- ✅ 外部 URL 開啟
- ✅ IPC 通訊 (Main ↔ Renderer)
- ✅ 生產/開發模式切換

### 待實現
- ⏳ 檔案最近使用列表
- ⏳ 檔案關聯 (STEP/STL/IGES)
- ⏳ 自動更新
- ⏳ 多視窗支援
- ⏳ 快速鍵快捷方式
- ⏳ 系統通知

## 開發

### 安裝依賴
```bash
cd electron
npm install
```

### 開發模式
```bash
# 同時啟動 Next.js 開發伺服器和 Electron
npm run dev
```

### 生產建置
```bash
# 建置 Next.js
npm run build

# 建置 Electron
npm run build:electron

# 建置安裝程式
npm run dist
```

## 檔案操作 API

### 開啟檔案
```typescript
import { fileAPI } from './electron/renderer';

const result = await fileAPI.open();
if (result) {
  console.log('Selected file:', result.path);
}
```

### 儲存檔案
```typescript
const result = await fileAPI.save('file content');
if (result?.success) {
  console.log('Saved to:', result.path);
}
```

### 讀取檔案
```typescript
const result = await fileAPI.read('/path/to/file');
if (result.success) {
  console.log('Content:', result.content);
}
```

## 原生 API 存取

### 檔案對話框
- `dialog.showOpenDialog()` - 開啟檔案對話框
- `dialog.showSaveDialog()` - 儲存檔案對話框

### 檔案系統
- `fs.promises.readFile()` - 讀取檔案
- `fs.promises.writeFile()` - 寫入檔案
- `fs.promises.unlink()` - 刪除檔案
- `fs.promises.readdir()` - 列出目錄

### 外部應用
- `shell.openExternal()` - 在瀏覽器中開啟 URL
- `shell.showItemInFolder()` - 在檔案管理器中顯示項目
- `shell.trashItem()` - 移至回收桶

## 跨平台支援

### Windows
- 目標：NSIS 安裝程式
- 圖示：`assets/icon.ico`

### macOS
- 目標：DMG 檔案
- 圖示：`assets/icon.icns`

### Linux
- 目標：AppImage
- 圖示：`assets/icon.png`

## 注意事項

1. **安全性**：
   - 使用 `contextIsolation: true` 防止 XSS 攻擊
   - 使用 `sandbox: true` 限制 Renderer Process 權限
   - 預加載腳本提供受控的 API 存取

2. **效能**：
   - 主進程與渲染進程分離
   - 使用 IPC 通訊而非 remote 模組
   - 避免阻塞主進程

3. **維護**：
   - 保留現有 Next.js 代碼
   - 使用 TypeScript 類型安全
   - 遵循 Electron 最佳實踐

## 故障排除

### 問題：Electron 無法啟動
- 檢查 `npm run build` 是否成功
- 確認 `out/main.js` 存在
- 查看開發者工具錯誤訊息

### 問題：IPC 通訊失敗
- 確認 `preload.ts` 已正確載入
- 檢查 `contextBridge.exposeInMainWorld` 是否執行
- 驗證 `window.electronAPI` 是否可用

### 問題：檔案操作失敗
- 確認 Main Process 已註冊 IPC handler
- 檢查檔案路徑是否正確
- 驗證使用者權限

## 下一步

1. **實作檔案關聯**
   - 讓 .step/.stl/.iges 檔案雙擊開啟
   - 註冊為預設應用程式

2. **實作自動更新**
   - 使用 electron-updater
   - 檢查並下載更新

3. **實作多視窗**
   - 支援多個 3D 檢視
   - 檔案管理器視窗

4. **實作快速鍵**
   - Ctrl+S 儲存
   - Ctrl+O 開啟
   - Ctrl+N 新建

5. **實作系統通知**
   - 建模完成通知
   - 錯誤警告
