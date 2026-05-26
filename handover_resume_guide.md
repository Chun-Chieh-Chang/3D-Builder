# 3D-Builder 開發續寫指南 (Handover Resume Guide)

> **⚠️ 緊急事項 (Critical Priority)**:
> 請優先完成 **"視圖重置問題" (Viewport Reset Issue)** 的修復，這是目前最緊迫的問題。

---

## 🚨 當前開發狀態 (Current Development Status)

### ✅ 已完成 (Completed)
- 基礎 3D 視圖渲染與 OrbitControls
- 草圖模式與特徵模式切換
- SketchHUD 拖曳功能修復
- 前後端一鍵啟動 (start-all.bat / start-all.ps1)

### 🚧 進行中 (In Progress)
- **視圖重置問題 (Viewport Reset Issue)** - **最高優先級修復中**

---

## 🔴 最高優先級：視圖重置問題 (Viewport Reset Issue)

### 問題描述 (Problem Description)
- 當縮放或旋轉視圖後，只要移動滑鼠或點擊平面，視圖就會自動重置到預設位置
- 這是目前最影響用戶體驗的問題

### 已確認的根本原因 (Confirmed Root Causes)
1. **DatumPlanes 元件的滑鼠事件**：
   - 當用戶點擊或鬆開滑鼠時，如果游標在基準面上，會觸發 `onPointerUp` 或 `onPointerDown` 事件
   - 這些事件處理函數會操作 Zustand store (`setActivePlane`, `setSketchMode` 等)
   - 操作 store 會導致元件重新渲染
   - 重新渲染會導致視圖重置

2. **Canvas 的 onPointerMissed 事件**：
   - 類似的問題，當點擊空白區域時會操作 store
   - 也會導致重新渲染和視圖重置

### 當前的臨時修復 (Temporary Fix Applied)
- 創建了 `SimpleDatumPlanes.tsx` - 最簡單的版本
  - 只顯示三個基準面（Front、Top、Right）
  - **不處理任何滑鼠事件**（完全禁用 onPointerOver、onPointerUp、onPointerDown 等）
  - 使用 `React.memo` 包裝，避免不必要的重新渲染
- 在 `Viewport.tsx` 中替換了 `DatumPlanes` 為 `SimpleDatumPlanes`
- 禁用了 Canvas 的 onPointerMissed 事件（或只打印日誌不操作 store）

### 當前的限制 (Current Limitations)
- ❌ 無法點擊基準面進入草圖模式
- ❌ 無法在草圖模式中繪圖（因為沒有滑鼠事件處理）
- ❌ 點擊空白區域不會清除選擇

### 下一步修復計劃 (Next Steps for Fix)

#### 階段 1：優化 DatumPlanes 元件
目標：讓滑鼠事件處理函數不直接操作 store，而是通過 ref 來避免重新渲染

**修改位置**：`src/renderer/DatumPlanes.tsx`

**策略**：
1. 使用 `useRef` 來存儲 store 的函數引用，而不是直接解構
2. 所有滑鼠事件處理函數都用 `useCallback` 包裝，並且不依賴任何會改變的狀態
3. 對 store 的操作都通過 `storeRef.current.getState()` 來進行

**示例代碼結構**：
```typescript
const DatumPlanes = React.memo(() => {
  const storeRef = useRef<any>(null);
  
  useEffect(() => {
    storeRef.current = useCadStore;
  }, []);

  const handlePlaneClick = useCallback((plane: string, event: any) => {
    if (!storeRef.current) return;
    const state = storeRef.current.getState();
    // 只在非草圖模式時才進入草圖模式
    if (!state.isSketchMode) {
      state.setActivePlane(plane);
      state.setSketchMode(true);
    }
    // 在草圖模式中才處理繪圖
    else if (state.isSketchMode && state.activePlane === plane) {
      // 處理繪圖邏輯...
    }
  }, []);

  return (
    <group>
      <Plane
        onPointerUp={(e) => handlePlaneClick('FRONT', e)}
        // ... 其他屬性
      />
      {/* ... 其他平面 */}
    </group>
  );
});
```

#### 階段 2：分離狀態管理
目標：將 DatumPlanes 的本地狀態（hovered、isDragging 等）與 store 操作完全分離

**策略**：
1. 本地狀態（視覺相關）：使用 `useState`，但確保不會導致不必要的重新渲染
2. Store 操作（功能相關）：只在真正需要時才進行，並且通過 ref 進行

#### 階段 3：優化 Viewport 元件
目標：確保 Viewport 不會因為 store 狀態改變而重新渲染

**修改位置**：`src/renderer/Viewport.tsx`

**策略**：
1. Viewport 不解構任何會改變的 store 狀態
2. 如果需要操作 store，通過 `useCadStore.getState()` 來進行
3. Canvas 的 onPointerMissed 事件也通過同樣的方式處理

---

## 📁 關鍵文件位置 (Key File Locations)

### 視圖相關 (Viewport Related)
- `src/renderer/Viewport.tsx` - 主要視圖元件（當前已簡化）
- `src/renderer/SimpleDatumPlanes.tsx` - 臨時簡化版本（當前使用中）
- `src/renderer/DatumPlanes.tsx` - 完整版本（待修復）

### 狀態管理 (State Management)
- `src/store/useCadStore.ts` - Zustand store

---

## 🛠️ 開發工具與檢查 (Development Tools & Checks)

### 型別檢查 (Type Check)
```bash
npm run typecheck
# 或
npx tsc --noEmit
```

### PDCA 完整檢查 (Full PDCA Check)
```bash
npm run pdca:full
```

### 啟動開發伺服器 (Start Dev Server)
```bash
# 一鍵啟動前後端
.\start-all.bat

# 或分別啟動
# 後端：cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8400 --reload
# 前端：npm run dev
```

---

## 📝 注意事項 (Important Notes)

1. **禁止猜測性修復**：所有修改都必須經過 RCA（根因分析）和 CAPA（糾正預防措施）
2. **型別安全**：任何修改都必須通過 `npm run typecheck`，確保零紅色波浪線
3. **逐步驗證**：每次修改一個小部分，立即測試確認沒有引入新問題
4. **文件更新**：每次完成重要修改，都要更新此文件和 DEV_LOG.md

---

## 📞 繼續開發的起點 (Where to Resume)

如果您是接手此專案的開發者，請按照以下順序進行：

1. **閱讀此文件**，特別是「視圖重置問題」部分
2. **啟動開發伺服器**，確認當前狀態
3. **按照「下一步修復計劃」**，逐步修復 DatumPlanes 元件
4. **每次修改後立即測試**，確保視圖不會重置
5. **完成修復後**，更新此文件和 DEV_LOG.md

祝您好運！🚀
